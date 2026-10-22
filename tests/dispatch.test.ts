import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep, type SessionOptions } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startHelmd } from '../src/server.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
type ApiCall = (name: string, params?: object, token?: string) => Promise<any>;

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待派单状态超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, script: FakeStep[], executors: FakeScript[], config: {
  after?: FakeScript; alignment?: FakeStep[]; executorDriver?: Driver; beforeConfirm?: (call: ApiCall) => Promise<void>;
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-dispatch-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  // Separate drivers keep executor scripts independent of coordinator wake timing.
  const options = { port: 0, dataDir, executorDriver: config.executorDriver ?? new FakeDriver(executors), driver: new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '执行派单', boundary: '本机', criteria: '成果可读' }), check: ok },
    ...(config.alignment ?? []),
  ], [...script, { type: 'end', reason: 'completed', finalAnswer: 'dispatch-script-finished' }], ...(config.after ? [config.after] : [])]) };
  const daemon = await startHelmd(options);
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}, token?: string) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '实现卡片' })).result.work;
  const events = async () => (await call('get-events', { workId: work.id })).result as any[];
  await until(events, events => events.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  await config.beforeConfirm?.(call);
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const finished = async () => {
    const values = await until(events, events => events.filter(event => event.action === 'round-ended').length >= 2);
    assert.equal(values.filter(event => event.action === 'round-ended')[1].details.finalAnswer, 'dispatch-script-finished', JSON.stringify(values));
  };
  return { ...daemon, call, work, events, finished, dataDir, repo, git, directory };
}

const create: FakeStep = { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '写实现并报告结果' }), saveAs: 'card', check: ok };
const dispatch = (key = 'dispatch'): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key, templateId: 'claude-executor' }), saveAs: key, check: ok });

test('执行派单经 MCP 写卡片副本和提交结论，保存步骤、结果、成果并唤醒调度者', async t => {
  let token = '';
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [create, dispatch()], [ctx => {
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    assert.equal(ctx.options.sandbox.mode, 'workspace-write');
    assert.deepEqual(ctx.options.sandbox.writableRoots, [ctx.options.cwd]);
    return [
      { type: 'write', path: 'result.txt', content: '实现完成\n' },
      { type: 'output', text: '检查结果\n第二行' },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: '尚未检查' }, check: ok },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '检查通过' }, check: ok },
      { type: 'end', reason: 'completed', finalAnswer: '实现已完成', usage: { inputTokens: 11, outputTokens: 7 } },
    ];
  }], { after: ctx => { brief = JSON.parse(ctx.input); return []; } });
  await daemon.finished();
  const ended = await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  const event = ended.find(event => event.action === 'dispatch-ended');
  const params = { workId: daemon.work.id, dispatchId: event.dispatchId };
  const result = (await daemon.call('get-dispatch', params)).result;
  assert.equal(result.status, 'ended');
  assert.equal(result.endReason, 'completed');
  assert.equal(result.finalAnswer, '实现已完成');
  assert.equal(result.conclusion, 'completed');
  assert.equal(result.conclusionReason, '检查通过');
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: result.cardId })).result;
  assert.equal(card.workPath, join(daemon.dataDir, 'worktrees', daemon.work.id, card.id));
  assert.equal(card.cardBranch, `helm-card/${daemon.work.id}/${card.id}`);
  assert.equal(card.status, 'executing');
  assert.equal(card.currentStep, 5);
  assert.equal(card.lastEndReason, 'completed');
  assert.equal(card.lastConclusion, 'completed');
  assert.equal(await readFile(join(card.workPath, 'result.txt'), 'utf8'), '实现完成\n');
  assert.match(daemon.git('log', '-1', '--format=%B', card.cardBranch), new RegExp(`${result.id}.*completed`));
  assert.equal(daemon.git('show', `${card.cardBranch}:result.txt`), '实现完成');
  assert.equal(daemon.git('show', 'main:README.md'), 'baseline');
  assert.equal(daemon.git('rev-parse', `helm/${daemon.work.id}`), daemon.git('rev-parse', 'main'));
  const steps = (await daemon.call('get-dispatch-output', { ...params, fromStep: 2, toStep: 2 })).result;
  assert.deepEqual(steps, [{ type: 'output', step: 2, text: '检查结果\n第二行' }]);
  const artifacts = (await daemon.call('get-dispatch-artifacts', params)).result;
  assert.ok(artifacts.some((artifact: any) => artifact.kind === 'branch' && artifact.ref === card.cardBranch));
  const file = artifacts.find((artifact: any) => artifact.kind === 'file' && artifact.name === 'result.txt');
  assert.equal((await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: file.id })).result.content, '实现完成\n');
  assert.equal((await daemon.call('submit-conclusion', { conclusion: 'completed', reason: '用户不能代答' })).error.code, 'FORBIDDEN');
  assert.equal((await daemon.call('submit-conclusion', { conclusion: 'completed', reason: '结束后令牌失效' }, token)).status, 401);
  await until(daemon.events, events => events.some(event => event.action === 'round-started' && event.details.eventIds.includes(eventId(ended))));
  function eventId(events: any[]) { return events.find(event => event.action === 'dispatch-ended').id; }
  assert.ok(brief?.cardGraph.some((node: any) => node.id === card.id));
});

test('同一卡片续跑复用副本和原模板会话，拒绝跨卡片续跑；撤销立即失效并提交进度', async t => {
  let firstDone!: () => void;
  let secondReady!: () => void;
  let resumeToken = '';
  let original: SessionOptions | undefined;
  const firstHold = new Promise<void>(resolve => { firstDone = resolve; });
  const secondHold = new Promise<void>(resolve => { secondReady = resolve; });
  t.after(() => { firstDone(); secondReady(); });
  const daemon = await fixture(t, [
    create, dispatch('first'), { type: 'hang', until: firstHold },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'other', content: '另一张卡片' }), saveAs: 'other', check: ok },
    // The first return was queued: read the completed dispatch to get its assigned session id.
    { type: 'tool', name: 'get-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), dispatchId: saved(ctx, 'first').id }), saveAs: 'previous', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'other').id, key: 'cross-card-real', templateId: 'claude-executor', resumeSessionId: saved(ctx, 'previous').sessionId }),
      check: value => assert.equal((value as any).error.code, 'INVALID_RESUME') },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'resume', templateId: 'claude-executor', resumeSessionId: saved(ctx, 'previous').sessionId }), saveAs: 'resume', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'resume-duplicate', templateId: 'claude-executor', resumeSessionId: saved(ctx, 'previous').sessionId }),
      check: value => assert.equal((value as any).error.code, 'DISPATCH_ACTIVE') },
    { type: 'hang', until: secondHold },
    { type: 'tool', name: 'revoke-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), dispatchId: saved(ctx, 'resume').id, reason: '调度者撤销：改变方向' }), check: ok },
    { type: 'tool', name: 'revoke-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), dispatchId: saved(ctx, 'resume').id, reason: '重复撤销' }), check: ok },
  ], [ctx => {
    original = ctx.options;
    return [{ type: 'write', path: 'first.txt', content: '第一轮\n' }];
  }, ctx => {
    assert.equal(ctx.options.cwd, original!.cwd);
    assert.equal(ctx.options.template?.id, original!.template?.id);
    assert.ok(ctx.options.resumeSessionId);
    resumeToken = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [{ type: 'write', path: 'resumed.txt', content: '续跑进度\n' }, { type: 'hang' }];
  }]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  const first = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result[0];
  const workPath = (await daemon.call('get-work', { workId: daemon.work.id })).result.workPath;
  await writeFile(join(workPath, 'new-upstream.txt'), '后来的工作分支进度\n');
  execFileSync('git', ['-C', workPath, 'add', 'new-upstream.txt']);
  execFileSync('git', ['-C', workPath, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'advance work branch'], { stdio: 'ignore' });
  firstDone();
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-step' && event.dispatchId !== first.id));
  secondReady();
  await daemon.finished();
  await until(daemon.events, events => events.filter(event => event.action === 'dispatch-ended').length === 2);
  const results = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result;
  const resumed = results.find((value: any) => value.key === 'resume');
  assert.equal(resumed.sessionId, first.sessionId);
  assert.equal(resumed.templateId, first.templateId);
  assert.equal(resumed.startCommit, first.endCommit);
  assert.notEqual(resumed.startCommit, daemon.git('rev-parse', `helm/${daemon.work.id}`));
  assert.equal(resumed.endReason, 'aborted');
  assert.equal(resumed.abortReason, '调度者撤销：改变方向');
  assert.equal(resumed.finalAnswer, null);
  assert.equal((await daemon.call('submit-conclusion', { conclusion: 'completed', reason: '撤销后无权提交' }, resumeToken)).status, 401);
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: first.cardId })).result;
  assert.equal(daemon.git('show', `${card.cardBranch}:first.txt`), '第一轮');
  assert.equal(daemon.git('show', `${card.cardBranch}:resumed.txt`), '续跑进度');
  assert.equal((await daemon.events()).filter(event => event.action === 'dispatch-revoked').length, 1);
});

test('曾派单卡片在空闲时新增未决前置会阻塞；运行中新增前置不撤销，结束时重新阻塞', async t => {
  let firstDone!: () => void;
  let gateDecided!: () => void;
  let finishExecutor!: () => void;
  const firstHold = new Promise<void>(resolve => { firstDone = resolve; });
  const gateHold = new Promise<void>(resolve => { gateDecided = resolve; });
  const executorHold = new Promise<void>(resolve => { finishExecutor = resolve; });
  t.after(() => { firstDone(); gateDecided(); finishExecutor(); });
  const edge = (ctx: FakeContext, gate: string) => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, gate).id }, downstream: { type: 'card', id: saved(ctx, 'card').id } });
  const daemon = await fixture(t, [create, dispatch('first'), { type: 'hang', until: firstHold },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'gate', question: '继续吗？' }), saveAs: 'gate', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => edge(ctx, 'gate'), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id }), check: value => { ok(value); assert.equal((value as any).result.status, 'waiting'); } },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'blocked-again', templateId: 'claude-executor' }), check: value => assert.equal((value as any).error.code, 'CARD_NOT_DISPATCHABLE') },
    { type: 'hang', until: gateHold }, dispatch('second'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'late', question: '之后怎么办？' }), saveAs: 'late', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => edge(ctx, 'late'), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id }), check: value => { ok(value); assert.equal((value as any).result.status, 'executing'); } },
  ], [[], [{ type: 'hang', until: executorHold }]]);
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  firstDone();
  await until(daemon.events, events => events.some(event => event.action === 'operation-rejected' && event.details.code === 'CARD_NOT_DISPATCHABLE'));
  const gate = (await daemon.call('list-pending')).result.find((value: any) => value.key === 'gate');
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: '继续' }));
  gateDecided();
  await daemon.finished();
  const second = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result.find((value: any) => value.key === 'second');
  assert.equal(second.status, 'running');
  finishExecutor();
  await until(daemon.events, events => events.filter(event => event.action === 'dispatch-ended').length === 2);
  assert.equal((await daemon.call('get-card', { workId: daemon.work.id, cardId: second.cardId })).result.status, 'waiting');
});

test('内置模板只允许设置模型与推理强度，清理订阅冲突环境；本地远端推送被执行者环境拦截', async t => {
  const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_USE_BEDROCK', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'GH_TOKEN'];
  const previous = keys.map(key => process.env[key]);
  for (const key of keys) process.env[key] = 'helm-test-must-not-inherit';
  // Parent git commands need valid config; only the executor should replace this valid pair.
  process.env.GIT_CONFIG_COUNT = '1';
  process.env.GIT_CONFIG_KEY_0 = 'user.name';
  process.env.GIT_CONFIG_VALUE_0 = 'Parent User';
  t.after(() => keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; }));
  let options: SessionOptions | undefined;
  let token = '';
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await fixture(t, [create, dispatch()], [ctx => {
    options = ctx.options;
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    for (const key of keys.slice(0, 5)) assert.equal(ctx.options.env[key], undefined, key);
    assert.equal(ctx.options.env.GH_TOKEN, 'helm-push-disabled');
    assert.ok(ctx.options.env.NO_PROXY!.includes('127.0.0.1'));
    assert.equal(ctx.options.template?.model, 'small-test-model');
    assert.equal(ctx.options.template?.reasoningEffort, 'low');
    return [{ type: 'hang', until: hold }];
  }], { beforeConfirm: async call => {
    ok(await call('configure-agent-template', { templateId: 'claude-executor', model: 'small-test-model', reasoningEffort: 'low' }));
    const repo = (await call('list-projects')).result[0].path;
    const remote = join(dirname(repo), 'remote.git');
    execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, 'config', 'remote.named.url', remote]);
    execFileSync('git', ['-C', repo, 'config', 'remote.named.pushurl', remote]);
  } });
  await daemon.finished();
  await until(async () => options, value => value !== undefined);
  const templates = (await daemon.call('list-agent-templates')).result;
  assert.deepEqual(templates.map((value: any) => value.id), ['claude-coordinator', 'claude-executor']);
  ok(await daemon.call('configure-agent-template', { templateId: 'claude-executor', model: 'small-test-model', reasoningEffort: 'low' }));
  assert.equal((await daemon.call('configure-agent-template', { templateId: 'claude-executor', env: { ANTHROPIC_API_KEY: 'not-supported' } })).error.code, 'INVALID_PARAMS');
  assert.equal((await daemon.call('configure-agent-template', { templateId: 'unknown', model: 'no' })).error.code, 'INVALID_TEMPLATE');
  assert.equal((await daemon.call('configure-agent-template', { templateId: 'claude-executor', model: 'no' }, token)).error.code, 'FORBIDDEN');
  const remote = join(daemon.directory, 'remote.git');
  execFileSync('git', ['-C', options!.cwd, 'push', remote, 'HEAD:refs/heads/control'], { stdio: 'ignore' });
  assert.throws(() => execFileSync('git', ['-C', options!.cwd, 'push', remote, 'HEAD:refs/heads/forbidden'], { env: options!.env, stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/forbidden'], { stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['-C', options!.cwd, 'push', 'named', 'HEAD:refs/heads/forbidden-named'], { env: options!.env, stdio: 'pipe' }));
  assert.throws(() => execFileSync('git', ['--git-dir', remote, 'rev-parse', '--verify', 'refs/heads/forbidden-named'], { stdio: 'pipe' }));
  for (const url of ['git@example.invalid:repo', 'https://example.invalid/repo', 'ssh://git@example.invalid/repo', `file://${remote}`]) {
    daemon.git('config', 'remote.test.url', url);
    const rewritten = execFileSync('git', ['-C', options!.cwd, 'remote', 'get-url', '--push', 'test'], { env: options!.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    assert.match(rewritten, /^file:\/\/\/dev\/null\/helm-push-disabled\//);
  }
  release();
});

test('按实际步骤号读输出，步骤不连续仍可读取；重启后派单、成果和模板配置保留', async t => {
  const fake = new FakeDriver([[
    { type: 'write', path: 'kept.txt', content: '持久保存\n' },
    { type: 'output', text: '第二个实际步骤' },
  ]]);
  const driver: Driver = { async start(options) {
    const session = await fake.start(options);
    return { ...session, events: (async function* () { for await (const event of session.events) yield { ...event, step: event.step * 2 }; })() };
  } };
  const daemon = await fixture(t, [create, dispatch()], [], { executorDriver: driver });
  await daemon.finished();
  await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
  const result = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result[0];
  const params = { workId: daemon.work.id, dispatchId: result.id };
  assert.deepEqual((await daemon.call('get-dispatch-output', params)).result.map((event: any) => event.step), [2, 4, 6]);
  assert.deepEqual((await daemon.call('get-dispatch-output', { ...params, fromStep: 3, toStep: 5 })).result, [{ type: 'output', step: 4, text: '第二个实际步骤' }]);
  const artifacts = (await daemon.call('get-dispatch-artifacts', params)).result;
  ok(await daemon.call('configure-agent-template', { templateId: 'claude-executor', model: 'persisted-model', reasoningEffort: 'low' }));
  await daemon.close();
  const reopened = await startHelmd({ port: 0, dataDir: daemon.dataDir });
  t.after(() => reopened.close());
  const call = async (name: string, params: object) => (await (await fetch(`${reopened.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any).result;
  assert.deepEqual(await call('get-dispatch', params), result);
  assert.deepEqual(await call('get-dispatch-artifacts', params), artifacts);
  assert.equal((await call('list-agent-templates', {})).find((value: any) => value.id === 'claude-executor').model, 'persisted-model');
  assert.equal((await call('get-dispatch-output', { ...params, fromStep: 4, toStep: 4 }))[0].text, '第二个实际步骤');
});

test('派单按 key 去重，拒绝等待前置、取消、已有派单的卡片、无效模板和非法续跑', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const reject = (code: string) => (value: any) => assert.equal(value.error?.code, code, JSON.stringify(value));
  const params = (ctx: FakeContext, key: string, extra: object = {}) => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, templateId: 'claude-executor', key, ...extra });
  const daemon = await fixture(t, [
    create,
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'bad-template', { templateId: 'unknown' }), check: reject('INVALID_TEMPLATE') },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'coordinator-template', { templateId: 'claude-coordinator' }), check: reject('INVALID_TEMPLATE') },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'bad-resume', { resumeSessionId: 'no-such-session' }), check: reject('INVALID_RESUME') },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'gate', question: '等待决定' }), saveAs: 'gate', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'gate').id }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'blocked'), check: reject('CARD_NOT_DISPATCHABLE') },
    { type: 'tool', name: 'remove-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'gate').id }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: ok },
    dispatch(),
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'dispatch'), check: value => { ok(value); assert.equal((value as any).result.key, 'dispatch'); } },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'another'), check: reject('DISPATCH_ACTIVE') },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'cancelled', content: '取消卡片' }), saveAs: 'cancelled', check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'cancelled').id, reason: '不用了' }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => params(ctx, 'cancelled', { cardId: saved(ctx, 'cancelled').id }), check: reject('CARD_NOT_DISPATCHABLE') },
  ], [[{ type: 'hang', until: hold }]], { alignment: [
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: 'not-created', key: 'aligning', templateId: 'claude-executor' }), check: reject('WORK_NOT_EXECUTING') },
  ] });
  await daemon.finished();
  const dispatches = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result;
  assert.equal(dispatches.length, 1);
  assert.equal((await daemon.events()).filter(event => event.action === 'dispatch-created').length, 1);
  assert.equal((await daemon.call('create-dispatch', { workId: daemon.work.id, cardId: dispatches[0].cardId, key: 'user', templateId: 'claude-executor' })).error.code, 'FORBIDDEN');
  release();
});

test('派单令牌只暴露提交结论，SSE 实时给出当前步骤和一行摘要，测试输出成果可读', async t => {
  let token = '';
  let release!: () => void;
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const finalHold = new Promise<void>(resolve => { finish = resolve; });
  t.after(() => { release(); finish(); });
  const daemon = await fixture(t, [create, dispatch()], [ctx => {
    token = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [
      { type: 'output', text: '正在测试\n多行输出' },
      { type: 'write', path: 'test-output.txt', content: 'tests: 2; pass: 2\n' },
      { type: 'artifact', kind: 'test-output', path: 'test-output.txt' },
      { type: 'hang', until: hold },
      { type: 'output', text: '恢复后实时步骤\n多行输出' },
      { type: 'hang', until: finalHold },
    ];
  }]);
  await daemon.finished();
  const prior = await until(daemon.events, events => events.some(event => event.action === 'dispatch-step' && event.details.step === 3));
  const dispatchRecord = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result[0];
  const controller = new AbortController();
  const stream = await fetch(`${daemon.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workId: daemon.work.id, dispatchId: dispatchRecord.id, after: prior.at(-1).id }), signal: controller.signal });
  const reader = stream.body!.getReader();
  release();
  let text = '';
  while (!text.includes('恢复后实时步骤')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /event: dispatch-step/);
  assert.ok(text.includes('"summary":"恢复后实时步骤"'));
  controller.abort();
  await reader.cancel().catch(() => {});
  const client = new Client({ name: 'dispatch-token-test', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`), { requestInit: { headers: { Authorization: token } } }));
  try {
    assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['submit-conclusion']);
    const rejected = await client.callTool({ name: 'get-work', arguments: { workId: daemon.work.id } });
    assert.equal((rejected.structuredContent as any).error.code, 'FORBIDDEN');
    const invalid = await client.callTool({ name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '执行派单不能报通过' } });
    assert.equal((invalid.structuredContent as any).error.code, 'INVALID_PARAMS');
    const cross = await client.callTool({ name: 'submit-conclusion', arguments: { dispatchId: 'another', conclusion: 'completed', reason: '不能指定别的派单' } });
    assert.equal((cross.structuredContent as any).error.code, 'INVALID_PARAMS');
  } finally { await client.close(); }
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatchRecord.cardId })).result;
  assert.equal(card.currentStep, 4);
  assert.equal(card.latestStepSummary, '恢复后实时步骤');
  const artifact = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: dispatchRecord.id })).result.find((item: any) => item.kind === 'test-output');
  assert.equal((await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: artifact.id })).result.content, 'tests: 2; pass: 2\n');
  finish();
});

test('所有结束方式保留执行改动，异常结束的最终回答和自报结论无效，没调用结论记未声明', async t => {
  const cases = ['completed', 'blocked', 'error', 'quota-exhausted', 'timed-out', 'aborted', 'context-overflow', 'crash'] as const;
  for (const outcome of cases) await t.test(outcome, async t => {
    const steps: FakeStep[] = [{ type: 'write', path: 'progress.txt', content: `进度 ${outcome}\n` }];
    if (outcome !== 'completed') steps.push({ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: outcome === 'blocked' ? 'blocked' : 'completed', reason: '执行者自报' }, check: ok });
    steps.push(outcome === 'crash' ? { type: 'crash' } : { type: 'end', reason: outcome === 'blocked' ? 'completed' : outcome,
      finalAnswer: '仅正常完成保留', usage: { inputTokens: 5, outputTokens: 3 } });
    const daemon = await fixture(t, [create, dispatch()], [steps]);
    await daemon.finished();
    await until(daemon.events, events => events.some(event => event.action === 'dispatch-ended'));
    const result = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result[0];
    assert.equal(result.endReason, outcome === 'blocked' ? 'completed' : ['context-overflow', 'crash'].includes(outcome) ? 'error' : outcome);
    assert.equal(result.conclusion, outcome === 'blocked' ? 'blocked' : 'undeclared');
    assert.equal(result.finalAnswer, ['completed', 'blocked'].includes(outcome) ? '仅正常完成保留' : null);
    assert.equal(result.conclusionReason, outcome === 'blocked' ? '执行者自报' : null);
    if (outcome !== 'crash') assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3 });
    const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: result.cardId })).result;
    assert.equal(daemon.git('show', `${card.cardBranch}:progress.txt`), `进度 ${outcome}`);
    assert.match(daemon.git('log', '-1', '--format=%B', card.cardBranch), new RegExp(`${result.id}: ${result.endReason}`));
  });
});
