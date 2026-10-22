import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import type { StartupBrief } from '../src/rounds.js';

type AlignmentScript = FakeStep[] | ((context: FakeContext & { brief: StartupBrief }) => FakeStep[]);

async function fixture(t: TestContext, scripts: AlignmentScript[]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-alignment-')));
  const repo = join(directory, 'project');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  const driverScripts: FakeScript[] = scripts.map(script => typeof script === 'function'
    ? context => script({ ...context, brief: JSON.parse(context.input) }) : script);
  const daemon = await startHelmd({ port: 0, dataDir, driver: new FakeDriver(driverScripts) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const begin = async (key = 'start') => (await call('send-message', { projectId: project.id, body: '做一个软件项目', key })).result.work;
  const events = async (workId: string) => (await call('get-events', { workId })).result as any[];
  return { ...daemon, directory, dataDir, repo, git, call, begin, events };
}

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待外部状态超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const workIdOf = (context: FakeContext) => (JSON.parse(context.input) as StartupBrief).work.id;

const description = { requirements: '网页版游戏', boundary: '只做本地页面', criteria: '可以开始和重开' };

test('调度者经真实 MCP 起草工作说明、发消息和写调度笔记，用户确认后开出工作分支', async t => {
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), ...description, key: 'description-1' }) },
    { type: 'tool', name: 'send-message', arguments: ctx => ({ workId: workIdOf(ctx), body: '请确认工作说明', key: 'reply-1' }) },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '确认后开始拆分卡片' }) },
    { type: 'output', text: '对齐完成' },
    { type: 'end', reason: 'completed', finalAnswer: '等待用户确认', usage: { inputTokens: 10, outputTokens: 5 } },
  ]]);
  await writeFile(join(daemon.repo, 'uncommitted.txt'), '用户的未提交改动');
  const head = daemon.git('rev-parse', 'HEAD');
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  const pending = (await daemon.call('list-pending')).result[0];
  assert.deepEqual(pending.description.requirements, description.requirements);
  assert.equal(pending.description.status, 'draft');
  assert.equal(pending.baseRef, 'main');
  assert.equal(pending.baseCommit, head);
  assert.ok(pending.uncommittedChanges.includes('uncommitted.txt'));
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  assert.equal(conversation.at(-1).sender, 'coordinator-round');
  assert.equal(conversation.at(-1).body, '请确认工作说明');
  const confirmed = await daemon.call('decide-gate', { workId: work.id, gateId: pending.id, decision: 'confirm', descriptionId: pending.description.id });
  assert.equal(confirmed.status, 200);
  const current = (await daemon.call('get-work', { workId: work.id })).result;
  assert.equal(current.status, 'executing');
  assert.equal(current.workBranch, `helm/${work.id}`);
  assert.equal(daemon.git('rev-parse', current.workBranch), head);
  assert.equal(daemon.git('branch', '--show-current'), 'main');
  assert.equal(await readFile(join(current.workPath, 'README.md'), 'utf8'), 'baseline\n');
  assert.match(current.workPath, /\/_work$/);
  assert.equal(await readFile(join(daemon.repo, 'uncommitted.txt'), 'utf8'), '用户的未提交改动');
  const versions = (await daemon.call('get-work-descriptions', { workId: work.id })).result;
  assert.equal(versions[0].status, 'active');
  assert.ok((await daemon.events(work.id)).some(event => event.action === 'coordinator-notes-written' && event.details.body === '确认后开始拆分卡片'));
});

test('同一工作串行调度，当前轮次中的消息合并到下一轮，启动简报带草稿、笔记和最近 20 条对话', async t => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let nextBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), ...description, key: 'draft' }) },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '下一轮先查看用户消息' }) },
    { type: 'hang', until: barrier },
    { type: 'end', reason: 'completed' },
  ], ctx => { nextBrief = ctx.brief; return []; }]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'coordinator-notes-written'));
  for (let index = 1; index <= 25; index++) {
    const message = { workId: work.id, body: `补充 ${index}`, key: `followup-${index}` };
    await daemon.call('send-message', message);
    if (index === 25) await daemon.call('send-message', message);
  }
  const waiting = await daemon.events(work.id);
  assert.equal(waiting.filter(event => event.action === 'round-started').length, 1);
  assert.equal(waiting.filter(event => event.action === 'round-ended').length, 0);
  release();
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  const starts = events.filter(event => event.action === 'round-started');
  const ends = events.filter(event => event.action === 'round-ended');
  assert.ok(ends[0].id < starts[1].id);
  assert.equal(starts[1].details.eventIds.length, 25);
  assert.ok(nextBrief);
  assert.equal(nextBrief.workDescription!.confirmation, '未确认');
  assert.equal(nextBrief.workDescription!.requirements, '网页版游戏');
  assert.equal(nextBrief.coordinatorNotes, '下一轮先查看用户消息');
  assert.equal(nextBrief.pendingGates.length, 1);
  assert.deepEqual(nextBrief.cardGraph, []);
  assert.equal(nextBrief.wakeEvents.length, 25);
  assert.equal(nextBrief.newEvents.some(event => event.action === 'coordinator-notes-written'), true);
  assert.equal(nextBrief.recentConversation.length, 20);
  assert.equal(nextBrief.recentConversation[0]!.body, '补充 6');
  assert.equal(nextBrief.recentConversation.at(-1)!.body, '补充 25');
});

test('轮次令牌隔离工作、限制用户操作，并在轮次结束时失效；新建工具按 key 去重', async t => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let headers: Record<string, string> | undefined;
  let ownWorkId = '';
  let otherWorkId = '';
  let firstDescription: any;
  let firstMessage: any;
  const results: any[] = [];
  const daemon = await fixture(t, [ctx => {
    headers = ctx.options.mcpServers.helm!.headers;
    ownWorkId = workIdOf(ctx);
    assert.equal(ctx.options.cwd, daemon.repo);
    assert.equal(ctx.options.sandbox.mode, 'read-only');
    assert.equal(ctx.options.resumeSessionId, undefined);
    assert.equal(ctx.options.env.NO_PROXY, '127.0.0.1,localhost');
    return [
      { type: 'hang', until: barrier },
      { type: 'tool', name: 'get-work', arguments: { workId: workIdOf(ctx) }, check: result => results.push(result) },
      { type: 'tool', name: 'send-message', arguments: () => ({ workId: otherWorkId, body: '跨工作', key: 'cross' }), check: result => results.push(result) },
      { type: 'tool', name: 'get-events', arguments: {}, check: result => results.push(result) },
      { type: 'tool', name: 'set-concurrency', arguments: { limit: 1 }, check: result => results.push(result) },
      { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), ...description, key: 'draft' }, check: result => { firstDescription = result; } },
      { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), ...description, requirements: '重试时不覆盖', key: 'draft' }, check: result => assert.deepEqual(result, firstDescription) },
      { type: 'tool', name: 'send-message', arguments: { workId: workIdOf(ctx), body: '原始消息', key: 'reply' }, check: result => { firstMessage = result; } },
      { type: 'tool', name: 'send-message', arguments: { workId: workIdOf(ctx), body: '重试时不覆盖', key: 'reply' }, check: result => assert.deepEqual(result, firstMessage) },
    ];
  }, []]);
  const work = await daemon.begin();
  await until(async () => headers, value => value !== undefined);
  otherWorkId = (await daemon.begin('other-work')).id;
  const crossRead = await fetch(`${daemon.url}/api/get-work`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ workId: otherWorkId }) });
  assert.equal(crossRead.status, 403);
  assert.equal((await crossRead.json() as any).error.code, 'WORK_SCOPE');
  release();
  const events = await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  assert.equal(events.find(event => event.action === 'round-ended').details.reason, 'completed');
  assert.equal(ownWorkId, work.id);
  assert.equal(results[0].result.id, work.id);
  assert.equal(results[1].error.code, 'WORK_SCOPE');
  assert.equal(results[2].error.code, 'WORK_SCOPE');
  assert.equal(results[3].error.code, 'FORBIDDEN');
  assert.ok(!results[3].error.allowedOperations.includes('set-concurrency'));
  assert.equal((await daemon.call('get-settings')).result.concurrencyLimit, 10);
  assert.equal((await daemon.call('get-work-descriptions', { workId: work.id })).result.length, 1);
  assert.equal(events.filter(event => event.action === 'message-sent' && event.actor.type === 'coordinator-round').length, 1);
  assert.equal(events.filter(event => event.action === 'work-description-drafted').length, 1);
  assert.equal(events.filter(event => event.action === 'round-started').length, 1);
  const expired = await fetch(`${daemon.url}/mcp`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(expired.status, 401);
  assert.equal((await expired.json() as any).error.code, 'INVALID_TOKEN');
  assert.equal((await daemon.call('draft-work-description', { workId: work.id, ...description, key: 'user-draft' })).error.code, 'FORBIDDEN');
});

test('确认后的工作说明修订需新关卡，旧版继续生效直到用户确认新版，笔记逐版保留事件', async t => {
  let revisionBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), ...description, key: 'v1' }) },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '笔记第一版' }) },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workIdOf(ctx), body: '笔记第一版' }) },
  ], ctx => {
    revisionBrief = ctx.brief;
    return [
      { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), ...description, criteria: '支持键盘', key: 'v2' } },
      { type: 'tool', name: 'write-coordinator-notes', arguments: { workId: workIdOf(ctx), body: '笔记第二版，等用户确认' } },
    ];
  }, []]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  const firstGate = (await daemon.call('list-pending')).result[0];
  const confirm = (gate: any) => daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  assert.equal((await confirm(firstGate)).status, 200);
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  assert.equal(revisionBrief!.workDescription!.confirmation, '已确认');
  assert.equal(revisionBrief!.work.workPath!.endsWith('/_work'), true);
  const pending = (await daemon.call('list-pending')).result;
  assert.equal(pending.length, 1);
  assert.notEqual(pending[0].id, firstGate.id);
  assert.equal(pending[0].description.version, 2);
  let versions = (await daemon.call('get-work-descriptions', { workId: work.id })).result;
  assert.deepEqual(versions.map((version: any) => version.status), ['active', 'draft']);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.activeDescriptionId, firstGate.description.id);
  const stale = await daemon.call('decide-gate', { workId: work.id, gateId: pending[0].id, descriptionId: firstGate.description.id, decision: 'confirm' });
  assert.equal(stale.error.code, 'STALE_DESCRIPTION');
  assert.equal((await confirm(pending[0])).status, 200);
  assert.equal((await confirm(pending[0])).status, 200);
  versions = (await daemon.call('get-work-descriptions', { workId: work.id })).result;
  assert.deepEqual(versions.map((version: any) => version.status), ['superseded', 'active']);
  assert.equal((await daemon.call('list-pending')).result.length, 0);
  assert.deepEqual((await daemon.call('get-coordinator-notes', { workId: work.id })).result, { body: '笔记第二版，等用户确认', version: 2 });
  const events = await daemon.events(work.id);
  assert.deepEqual(events.filter(event => event.action === 'coordinator-notes-written').map(event => event.details.body), ['笔记第一版', '笔记第二版，等用户确认']);
  assert.equal(events.filter(event => event.action === 'gate-decided').length, 2);
});

test('轮次崩溃不处理已投递的事件，下一次用户唤醒仍收到它们，正常完成后不再重投', async t => {
  let retryBrief: StartupBrief | undefined;
  let nextBrief: StartupBrief | undefined;
  let headers: Record<string, string> | undefined;
  const daemon = await fixture(t, [ctx => {
    headers = ctx.options.mcpServers.helm!.headers;
    return [
      { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), ...description, key: 'once' } },
      { type: 'crash', message: '模拟进程崩溃' },
    ];
  }, ctx => {
    retryBrief = ctx.brief;
    return [{ type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), ...description, key: 'once' } }];
  }, ctx => { nextBrief = ctx.brief; return []; }]);
  const work = await daemon.begin();
  const failed = await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  assert.equal(failed.at(-1).details.reason, 'error');
  assert.equal(failed.at(-1).details.processed, false);
  assert.match(failed.at(-1).details.failure, /模拟进程崩溃/);
  const expired = await fetch(`${daemon.url}/api/get-work`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ workId: work.id }) });
  assert.equal(expired.status, 401);
  await daemon.call('send-message', { workId: work.id, body: '再试一次', key: 'retry' });
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  assert.deepEqual(retryBrief!.wakeEvents.map(event => (event.details as any).body), ['做一个软件项目', '再试一次']);
  assert.equal((await daemon.call('get-work-descriptions', { workId: work.id })).result.length, 1);
  await daemon.call('send-message', { workId: work.id, body: '第三次消息', key: 'third' });
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 3);
  assert.deepEqual(nextBrief!.wakeEvents.map(event => (event.details as any).body), ['第三次消息']);
});

test('驱动逐条输出带步骤号，压缩通知和结束消息保存在轮次输出中，并记录结束方式与 token', async t => {
  const daemon = await fixture(t, [[
    { type: 'output', text: '读取用户消息' },
    { type: 'compaction' },
    { type: 'output', text: '处理结束' },
    { type: 'end', reason: 'quota-exhausted', finalAnswer: '不能当作正常最终回答', usage: { inputTokens: 120, outputTokens: 30 } },
  ]]);
  const work = await daemon.begin();
  const events = await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  const ended = events.find(event => event.action === 'round-ended');
  assert.equal(ended.details.reason, 'quota-exhausted');
  assert.equal(ended.details.finalAnswer, undefined);
  assert.deepEqual(ended.details.usage, { inputTokens: 120, outputTokens: 30 });
  assert.equal(ended.details.processed, false);
  const outputPath = events.find(event => event.action === 'round-started').details.outputPath;
  const output = (await readFile(outputPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(output.map(event => event.step), [1, 2, 3, 4]);
  assert.deepEqual(output.map(event => event.type), ['output', 'compaction', 'output', 'end']);
  assert.equal(output[0].text, '读取用户消息');
  assert.equal(output[3].finalAnswer, undefined);
});

test('确认采用用户查看过的基准提交，HEAD 后续变动不改变工作起点', async t => {
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), ...description, key: 'pinned' }) },
  ], []]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  const gate = (await daemon.call('list-pending')).result[0];
  await writeFile(join(daemon.repo, 'README.md'), 'changed after draft\n');
  daemon.git('add', 'README.md');
  daemon.git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'later change');
  const laterHead = daemon.git('rev-parse', 'HEAD');
  assert.notEqual(laterHead, gate.baseCommit);
  const confirmed = await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  assert.equal(confirmed.status, 200);
  assert.equal(daemon.git('rev-parse', `helm/${work.id}`), gate.baseCommit);
  assert.equal(daemon.git('rev-parse', 'main'), laterHead);
});

test('确认时 git 外部动作失败不改变生效版本，移除阻碍后重试复用已创建的工作分支', async t => {
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), ...description, key: 'retry-confirm' }) },
  ], []]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  const gate = (await daemon.call('list-pending')).result[0];
  const workPath = join(daemon.dataDir, 'worktrees', work.id, '_work');
  await mkdir(join(daemon.dataDir, 'worktrees', work.id), { recursive: true });
  await writeFile(workPath, '路径被占用');
  const params = { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' };
  assert.equal((await daemon.call('decide-gate', params)).ok, false);
  const unchanged = (await daemon.call('get-work', { workId: work.id })).result;
  assert.equal(unchanged.status, 'aligning');
  assert.equal(unchanged.activeDescriptionId, null);
  assert.equal((await daemon.call('list-pending')).result[0].status, 'pending');
  assert.equal(daemon.git('rev-parse', `helm/${work.id}`), gate.baseCommit);
  await rm(workPath);
  assert.equal((await daemon.call('decide-gate', params)).status, 200);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'executing');
});
