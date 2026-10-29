import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep, type SessionOptions } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';

const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const create = (key: string): FakeStep => ({ type: 'tool', name: 'create-card',
  arguments: ctx => ({ workId: workIdOf(ctx), key, content: key }), saveAs: key, check: ok });
const dispatch = (key: string): FakeStep => ({ type: 'tool', name: 'create-dispatch',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id, key, agentId: 'claude-executor' }), check: ok });

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待用户操作结果超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, script: FakeStep[] = [], executors: FakeScript[] = [], after: FakeScript[] = [], config: {
  confirm?: boolean; executorDriver?: Driver; beforeRoundStart?: (options: SessionOptions) => Promise<void>;
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-user-operations-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const briefs: StartupBrief[] = [];
  const driver = new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '用户操作', boundary: '本机', criteria: '状态正确' }), check: ok },
  ], [...script, { type: 'end', reason: 'completed', finalAnswer: 'setup-finished' }], ...after]);
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), executorDriver: config.executorDriver ?? new FakeDriver(executors), driver: {
    async start(options) {
      await config.beforeRoundStart?.(options);
      const session = await driver.start(options);
      return { ...session, async send(input) { briefs.push(JSON.parse(input)); await session.send(input); } };
    },
  } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}, token?: string) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '开始' })).result.work;
  const params = { workId: work.id };
  const events = async () => (await call('get-events', params)).result as any[];
  await until(events, events => events.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  if (config.confirm !== false) {
    ok(await call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
    await until(events, events => events.some(event => event.action === 'round-ended' && event.details.finalAnswer === 'setup-finished'));
    // New cards do not wake the coordinator, so a user message starts the follow-up rounds.
    if (after.length) ok(await call('send-message', { ...params, key: 'next-round', body: '继续' }));
  }
  const card = async (key: string) => (await call('get-card-graph', params)).result.find((node: any) => node.type === 'card' && node.key === key);
  return { ...daemon, call, work, params, events, git, card, briefs, directory, gate };
}

test('用户暂停卡片会中止派单并拒绝新派单，恢复推导状态且唤醒调度者', async t => {
  let token = '';
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await fixture(t, [create('running'), dispatch('running'), create('idle')], [[
    { type: 'write', path: 'progress.txt', content: '暂停前的进度\n' }, { type: 'hang' },
  ]], [ctx => { token = ctx.options.mcpServers.helm!.headers.Authorization!; return [{ type: 'hang', until: hold }]; }]);
  await until(async () => token, value => Boolean(value));
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  const card = await daemon.card('running');
  const params = { ...daemon.params, cardId: card.id };
  const paused = await daemon.call('pause-card', params);
  ok(paused);
  assert.equal(paused.result.status, 'paused');
  assert.equal((await daemon.call('create-dispatch', { ...params, key: 'paused', agentId: 'claude-executor' }, token)).error.code, 'CARD_NOT_DISPATCHABLE');
  ok(await daemon.call('pause-card', params));
  const result = (await daemon.call('list-dispatches', daemon.params)).result[0];
  assert.equal(result.endReason, 'aborted');
  assert.equal(result.abortReason, '卡片暂停');
  assert.equal(daemon.git('show', `${card.cardBranch}:progress.txt`), '暂停前的进度');
  assert.equal((await daemon.call('resume-card', params)).result.status, 'executing');
  const idle = await daemon.card('idle');
  ok(await daemon.call('pause-card', { ...daemon.params, cardId: idle.id }));
  assert.equal((await daemon.call('resume-card', { ...daemon.params, cardId: idle.id })).result.status, 'ready');
  release();
  const events = await until(daemon.events, events => events.some(event => event.action === 'round-started'
    && event.details.eventIds.some((id: number) => events.some(item => item.id === id && item.action === 'card-resumed'))));
  assert.equal(events.filter(event => event.action === 'card-paused' && event.cardId === card.id).length, 1);
});

test('用户取消卡片会中止派单、删除副本，后继跳过且取消为终态', async t => {
  const daemon = await fixture(t, [create('upstream'), dispatch('upstream'), create('downstream'),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx),
      upstream: { type: 'card', id: saved(ctx, 'upstream').id }, downstream: { type: 'card', id: saved(ctx, 'downstream').id } }), check: ok },
  ], [[{ type: 'write', path: 'discarded.txt', content: '取消时丢弃' }, { type: 'hang' }]]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step'));
  const card = await daemon.card('upstream');
  const params = { ...daemon.params, cardId: card.id };
  ok(await daemon.call('cancel-card', { ...params, reason: '方向改变' }));
  const result = (await daemon.call('list-dispatches', daemon.params)).result[0];
  assert.equal(result.endReason, 'aborted');
  assert.equal(result.abortReason, '卡片取消');
  assert.equal(existsSync(card.workPath), false);
  assert.equal(daemon.git('for-each-ref', '--format=%(refname)', `refs/heads/${card.cardBranch}`), '');
  assert.equal((await daemon.card('downstream')).status, 'skipped');
  assert.equal((await daemon.call('pause-card', params)).error.code, 'TERMINAL_CARD');
  assert.equal((await daemon.call('resume-card', params)).error.code, 'TERMINAL_CARD');
  ok(await daemon.call('cancel-card', { ...params, reason: '重试取消' }));
  const events = await until(daemon.events, events => events.some(event => event.action === 'round-started'
    && event.details.eventIds.some((id: number) => events.some(item => item.id === id && item.action === 'card-cancelled'))));
  assert.equal(events.filter(event => event.action === 'card-cancelled').length, 1);
  assert.ok((await daemon.call('get-dispatch-output', { ...daemon.params, dispatchId: result.id })).result.length > 0);
});

test('工作暂停不改卡片状态，只投递用户消息，关卡仍可决定且自动事件在恢复后投递', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  let token = '';
  const daemon = await fixture(t, [create('running'), dispatch('running'), create('idle'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'choice', question: '接下来做什么？' }), check: ok },
  ], [[{ type: 'hang' }]], [ctx => {
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [{ type: 'hang', until: hold }];
  }]);
  await until(async () => token, token => Boolean(token));
  const running = await daemon.card('running');
  const idle = await daemon.card('idle');
  ok(await daemon.call('pause-work', daemon.params));
  assert.equal((await daemon.card('running')).status, running.status);
  assert.equal((await daemon.card('idle')).status, idle.status);
  const result = (await daemon.call('list-dispatches', daemon.params)).result[0];
  assert.equal(result.endReason, 'aborted');
  assert.equal(result.abortReason, '工作暂停');
  assert.equal((await daemon.call('create-dispatch', { ...daemon.params, cardId: idle.id, key: 'paused', agentId: 'claude-executor' }, token)).error.code, 'WORK_NOT_EXECUTING');
  const gate = (await daemon.call('list-pending')).result.find((gate: any) => gate.key === 'choice');
  ok(await daemon.call('decide-gate', { ...daemon.params, gateId: gate.id, decision: '先停下' }));
  const before = (await daemon.events()).filter(event => event.action === 'round-started').length;
  release();
  await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length === before);
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, before);
  ok(await daemon.call('send-message', { ...daemon.params, key: 'while-paused', body: '暂停期间也要回答' }));
  await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length === before + 1);
  const pausedBrief = daemon.briefs.at(-1)!;
  assert.equal(pausedBrief.work.status, 'paused');
  assert.deepEqual(pausedBrief.wakeEvents.map(event => event.action), ['message-sent']);
  assert.equal((await daemon.call('resume-work', daemon.params)).result.status, 'executing');
  await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length > before + 1);
  const resumedBrief = daemon.briefs.at(-1)!;
  for (const action of ['work-paused', 'dispatch-ended', 'gate-decided', 'work-resumed']) {
    assert.ok(resumedBrief.wakeEvents.some(event => event.action === action), action);
  }
});

test('打断立即取消轮次、废除令牌，将原事件和用户消息合并重投且不计失败', async t => {
  let token = '';
  const daemon = await fixture(t, [create('card')], [], [ctx => {
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [{ type: 'hang' }];
  }]);
  await until(async () => token, value => Boolean(value));
  const starts = (await daemon.events()).filter(event => event.action === 'round-started');
  const interrupted = starts.at(-1);
  ok(await daemon.call('send-message', { ...daemon.params, key: 'urgent', body: '紧急改变方向' }));
  ok(await daemon.call('interrupt-round', daemon.params));
  const events = await until(daemon.events, events => events.some(event => event.action === 'round-started' && event.id > interrupted.id));
  const ended = events.find(event => event.action === 'round-ended' && event.object.id === interrupted.object.id);
  assert.equal(ended.details.reason, 'aborted');
  assert.equal(ended.details.abortReason, '用户打断');
  assert.equal(ended.details.processed, false);
  const next = events.find(event => event.action === 'round-started' && event.id > interrupted.id);
  assert.ok(ended.id < next.id);
  for (const id of interrupted.details.eventIds) assert.ok(next.details.eventIds.includes(id));
  await until(async () => daemon.briefs.length, count => count > starts.length);
  assert.ok(daemon.briefs.at(-1)!.wakeEvents.some(event => event.action === 'message-sent' && (event.details as any).body === '紧急改变方向'));
  assert.equal((await daemon.call('get-work', daemon.params, token)).status, 401);
  assert.equal((await daemon.call('get-work', daemon.params)).result.status, 'executing');
});

test('取消工作等待全部派单与轮次停止，再删副本和 _work，保留工作分支、事件及输出且不再唤醒', async t => {
  let token = '';
  const daemon = await fixture(t, [create('one'), dispatch('one'), create('two'), dispatch('two'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'pending', question: '还继续吗？' }), check: ok },
  ], [[{ type: 'write', path: 'one.txt', content: '进度' }, { type: 'hang' }], [{ type: 'hang' }]], [ctx => {
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [{ type: 'hang' }];
  }]);
  await until(async () => token, value => Boolean(value));
  const work = (await daemon.call('get-work', daemon.params)).result;
  const cards = [await daemon.card('one'), await daemon.card('two')];
  const gate = (await daemon.call('list-pending')).result[0];
  const cancelled = await daemon.call('cancel-work', daemon.params);
  ok(cancelled);
  assert.equal(cancelled.result.status, 'cancelled');
  assert.equal((await daemon.call('list-pending')).result.some((gate: any) => gate.workId === daemon.work.id), false);
  for (const dispatch of (await daemon.call('list-dispatches', daemon.params)).result) {
    assert.equal(dispatch.status, 'ended');
    assert.equal(dispatch.endReason, 'aborted');
    assert.equal(dispatch.abortReason, '工作取消');
  }
  assert.equal(existsSync(work.workPath), false);
  for (const card of cards) {
    assert.equal(existsSync(card.workPath), false);
    assert.equal(daemon.git('for-each-ref', '--format=%(refname)', `refs/heads/${card.cardBranch}`), '');
  }
  assert.ok(daemon.git('rev-parse', work.workBranch));
  assert.equal(daemon.git('branch', '--show-current'), 'main');
  assert.equal((await daemon.call('get-work', daemon.params, token)).status, 401);
  for (const name of ['pause-work', 'resume-work', 'interrupt-round']) {
    assert.equal((await daemon.call(name, daemon.params)).error.code, 'TERMINAL_WORK');
  }
  assert.equal((await daemon.call('send-message', { ...daemon.params, body: '取消后不能发新消息', key: 'late' })).error.code, 'TERMINAL_WORK');
  assert.equal((await daemon.call('decide-gate', { ...daemon.params, gateId: gate.id, decision: '继续' })).error.code, 'TERMINAL_WORK');
  ok(await daemon.call('cancel-work', daemon.params));
  const events = await daemon.events();
  const cancelledEvent = events.find(event => event.action === 'work-cancelled');
  assert.equal(events.filter(event => event.action === 'work-cancelled').length, 1);
  assert.equal(events.filter(event => event.action === 'round-started' && event.id > cancelledEvent.id).length, 0);
  await daemon.close();
  const restarted = await startHelmd({ port: 0, dataDir: join(daemon.directory, 'data') });
  t.after(() => restarted.close());
  const response = await fetch(`${restarted.url}/api/get-events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(daemon.params) });
  const reopenedEvents = (await response.json() as any).result;
  assert.equal(reopenedEvents.filter((event: any) => event.action === 'round-started').length, events.filter(event => event.action === 'round-started').length);
  await restarted.close();
});

test('暂停的对齐工作可确认说明且保持暂停，恢复后进入执行中；未确认时恢复回对齐中', async t => {
  const daemon = await fixture(t, [], [], [], { confirm: false });
  ok(await daemon.call('pause-work', daemon.params));
  ok(await daemon.call('pause-work', daemon.params));
  assert.equal((await daemon.call('resume-work', daemon.params)).result.status, 'aligning');
  ok(await daemon.call('pause-work', daemon.params));
  const confirmed = await daemon.call('decide-gate', { ...daemon.params, gateId: daemon.gate.id, descriptionId: daemon.gate.description.id, decision: 'confirm' });
  ok(confirmed);
  assert.equal(confirmed.result.status, 'paused');
  assert.ok(existsSync(confirmed.result.workPath));
  assert.equal((await daemon.call('resume-work', daemon.params)).result.status, 'executing');
  ok(await daemon.call('resume-work', daemon.params));
  const events = await daemon.events();
  assert.equal(events.filter(event => event.action === 'work-paused').length, 2);
  assert.equal(events.filter(event => event.action === 'work-resumed').length, 2);
});

test('取消发生在驱动启动期间时，迟到的派单和轮次会话也被取消，清理等待它们结束', async t => {
  let releaseExecutor!: () => void;
  let releaseRound!: () => void;
  const executorHold = new Promise<void>(resolve => { releaseExecutor = resolve; });
  const roundHold = new Promise<void>(resolve => { releaseRound = resolve; });
  t.after(() => { releaseExecutor(); releaseRound(); });
  let executorOptions: SessionOptions | undefined;
  let roundToken = '';
  let starts = 0;
  const executor = new FakeDriver([[{ type: 'write', path: 'too-late.txt', content: '取消后不能写入' }]]);
  const daemon = await fixture(t, [create('card'), dispatch('card')], [], [[create('too-late')]], {
    executorDriver: { checkAvailability: async () => ({ available: true }), async start(options) {
      executorOptions = options;
      await executorHold;
      return executor.start(options);
    } },
    async beforeRoundStart(options) {
      if (++starts === 3) {
        roundToken = options.mcpServers.helm!.headers.Authorization!;
        await roundHold;
      }
    },
  });
  await until(async () => Boolean(executorOptions && roundToken), ready => ready);
  const work = (await daemon.call('get-work', daemon.params)).result;
  const cancellation = daemon.call('cancel-work', daemon.params);
  await until(daemon.events, events => events.some(event => event.action === 'work-cancelled'));
  assert.ok(existsSync(work.workPath));
  assert.equal((await daemon.call('get-work', daemon.params, roundToken)).status, 401);
  assert.equal((await daemon.call('submit-conclusion', { conclusion: 'completed', reason: '已经取消' }, executorOptions!.mcpServers.helm!.headers.Authorization)).status, 401);
  releaseExecutor();
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  assert.ok(existsSync(work.workPath));
  releaseRound();
  ok(await cancellation);
  assert.equal(existsSync(work.workPath), false);
  const graph = (await daemon.call('get-card-graph', daemon.params)).result;
  assert.deepEqual(graph.filter((node: any) => node.type === 'card').map((node: any) => node.key), ['card']);
  assert.equal(existsSync(executorOptions!.cwd), false);
  const events = await daemon.events();
  assert.equal(events.some(event => event.action === 'dispatch-step'), false);
  assert.equal(events.filter(event => event.action === 'round-ended').at(-1).details.abortReason, '工作取消');
});

test('卡片恢复按前置重新推导；用户无建卡、改依赖、派单、标完成和撤回关卡的操作', async t => {
  const daemon = await fixture(t, [create('blocked'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'gate', question: '决定前阻塞' }), saveAs: 'gate', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx),
      upstream: { type: 'gate', id: saved(ctx, 'gate').id }, downstream: { type: 'card', id: saved(ctx, 'blocked').id } }), check: ok },
  ]);
  const card = await daemon.card('blocked');
  const params = { ...daemon.params, cardId: card.id };
  ok(await daemon.call('pause-card', params));
  assert.equal((await daemon.call('resume-card', params)).result.status, 'waiting');
  const client = new Client({ name: 'user-operations-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`)));
  try {
    const tools = (await client.listTools()).tools.map(tool => tool.name);
    for (const name of ['create-card', 'update-card', 'add-dependency', 'remove-dependency', 'create-dispatch', 'complete-card', 'withdraw-gate']) assert.ok(!tools.includes(name), name);
    for (const name of ['pause-card', 'resume-card', 'cancel-card', 'pause-work', 'resume-work', 'cancel-work', 'interrupt-round']) assert.ok(tools.includes(name), name);
  } finally { await client.close(); }
  for (const name of ['create-card', 'add-dependency', 'create-dispatch', 'withdraw-gate']) {
    assert.equal((await daemon.call(name, daemon.params)).error.code, 'FORBIDDEN');
  }
});
