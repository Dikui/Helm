import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, realpath, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { CodexExecutorDriver } from '../src/codex-driver.js';
import type { DriverEvent, SessionOptions } from '../src/driver.js';
import type { AgentTemplate } from '../src/templates.js';
import { codexErrors } from './fixtures/codex-errors.js';

async function fixture(t: TestContext, notifications: object[], script: object = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-codex-driver-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const record = join(directory, 'requests.jsonl');
  await writeFile(record, '');
  const path = join(directory, 'script.json');
  await writeFile(path, JSON.stringify({ record, notifications, ...script }));
  const driver = new CodexExecutorDriver({ command: { file: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/codex-app-server.js', import.meta.url)), path] } });
  const template: AgentTemplate = { id: 'codex-executor', role: 'executor', driver: 'codex', model: 'test-model',
    reasoningEffort: 'low', fast: true, home: 'shared', description: '执行', prompt: '测试策略', directory, skillsPath: join(directory, 'skills') };
  const options: SessionOptions = { template, cwd: directory, dataDir: join(directory, 'dispatch'),
    env: { HOME: directory, PATH: process.env.PATH!, NO_PROXY: 'example.test', no_proxy: 'internal.test' },
    sandbox: { mode: 'workspace-write', writableRoots: [directory] },
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer dispatch-token' } } } };
  const requests = async () => (await readFile(record, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { driver, options, directory, requests };
}

async function collect(events: AsyncIterable<DriverEvent>) {
  const result: DriverEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

const notification = (method: string, params: object) => ({ method, params: { threadId: 'thread-scripted', turnId: 'turn-scripted', ...params } });
const completed = (status = 'completed', error: object | null = null) => notification('turn/completed', { turn: { id: 'turn-scripted', status, error, items: [] } });

test('Codex 执行者按会话配置沙箱、MCP、fast、skills、主目录并记录 total token，等 turn/completed 才结束', async t => {
  const ctx = await fixture(t, [
    notification('item/completed', { item: { id: 'comment', type: 'agentMessage', text: '仍在执行', phase: 'commentary' } }),
    notification('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 80 }, last: { inputTokens: 7, outputTokens: 2 } } }),
    notification('item/completed', { item: { id: 'answer', type: 'agentMessage', text: '已完成', phase: 'final_answer' } }),
    completed(),
  ]);
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  await session.send('实现派单');
  const events: DriverEvent[] = [];
  for await (const event of session.events) events.push(event);
  assert.equal(session.id, 'thread-scripted');
  assert.equal(session.sqlitePath, join(ctx.directory, 'dispatch', 'codex-sqlite'));
  assert.deepEqual(events.at(-1), { type: 'end', step: events.length, reason: 'completed', finalAnswer: '已完成', usage: { inputTokens: 120, outputTokens: 9 } });
  const requests = await ctx.requests();
  assert.deepEqual(requests.map(r => r.method), ['initialize', 'initialized', 'skills/extraRoots/set', 'thread/start', 'turn/start']);
  assert.deepEqual(requests[2].params, { extraRoots: [ctx.options.template!.skillsPath] });
  const thread = requests[3].params;
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'workspace-write');
  assert.equal(thread.config.service_tier, 'fast');
  assert.deepEqual(thread.config.mcp_servers, { helm: { url: 'http://127.0.0.1:4242/mcp', http_headers: { Authorization: 'Bearer dispatch-token' }, default_tools_approval_mode: 'approve' } });
  assert.match(thread.developerInstructions, /测试策略/);
  assert.match(thread.developerInstructions, /submit-conclusion/);
  assert.deepEqual(requests[4].params.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [ctx.directory], networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true });
  assert.equal(requests[4].params.effort, 'low');
  const env = JSON.parse(events.filter(e => e.type === 'output').map(e => e.text).find(text => text.includes('fixture/environment'))!).params.env;
  assert.equal(env.CODEX_HOME, join(ctx.directory, '.helm', 'agent-homes', 'codex'));
  assert.equal(env.CODEX_SQLITE_HOME, session.sqlitePath);
  assert.equal(env.NO_PROXY, 'example.test,internal.test,127.0.0.1,localhost');
  assert.equal(env.no_proxy, env.NO_PROXY);
  assert.ok(events.filter(e => e.type === 'output').some(e => e.text.includes('initializeDurationMs')));
});

for (const sample of codexErrors) test(`Codex 结束分类：${sample.name}`, async t => {
  const ctx = await fixture(t, [
    notification('error', { error: sample.error, willRetry: false }),
    notification('item/completed', { item: { type: 'agentMessage', text: '失败时丢弃的回答' } }),
    completed('failed', sample.error),
  ]);
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  await session.send('执行');
  const events = await collect(session.events);
  const end = events.at(-1)!;
  assert.equal(end.type, 'end');
  if (end.type === 'end') {
    assert.equal(end.reason, sample.quota ? 'quota-exhausted' : 'error');
    assert.equal(end.finalAnswer, undefined);
  }
});

test('Codex 成功优先于重试中的额度错误；普通回答中的额度词不改变结束方式，忽略其他 turn 的通知', async t => {
  const ctx = await fixture(t, [
    notification('error', { error: codexErrors[0].error, willRetry: true }),
    notification('turn/completed', { turnId: 'old-turn', turn: { id: 'old-turn', status: 'failed', error: codexErrors[0].error } }),
    notification('item/completed', { item: { type: 'agentMessage', text: 'You exceeded your current quota' } }), completed(),
  ]);
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'completed');
});

test('Codex 续跑使用 thread/resume，API 主目录、关闭 fast 和空 skills 均取当前模板', async t => {
  const ctx = await fixture(t, [completed()]);
  ctx.options.template = { ...ctx.options.template!, id: 'api-codex', home: 'template', fast: false, skillsPath: null, reasoningEffort: 'max' };
  ctx.options.resumeSessionId = 'thread-scripted';
  const session = await ctx.driver.start(ctx.options);
  await session.send('继续');
  const events = await collect(session.events);
  const requests = await ctx.requests();
  assert.equal(requests[3].method, 'thread/resume');
  assert.equal(requests[3].params.threadId, 'thread-scripted');
  assert.deepEqual(requests[2].params.extraRoots, []);
  assert.equal(requests[4].params.effort, 'xhigh');
  const env = JSON.parse(events.filter(e => e.type === 'output').map(e => e.text).find(text => text.includes('fixture/environment'))!).params.env;
  assert.equal(env.CODEX_HOME, join(ctx.directory, '.helm', 'agent-homes', 'api-codex'));
  assert.notEqual(requests[3].params.config.service_tier, 'fast');
  assert.equal(requests[3].params.serviceTier, 'default');
  assert.equal(requests[3].params.config.service_tier, undefined);
});

test('Codex 中断、崩溃、RPC 拒绝、取消初始化均能收尾；无 turn/completed 不算成功', async t => {
  await t.test('interrupted', async t => {
    const ctx = await fixture(t, [completed('interrupted')]);
    const session = await ctx.driver.start(ctx.options);
    await session.send('执行');
    const end = (await collect(session.events)).at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'aborted');
  });
  for (const method of ['initialize', 'skills/extraRoots/set', 'thread/start']) await t.test(`RPC ${method}`, async t => {
    const ctx = await fixture(t, [], { rejectOn: method });
    await assert.rejects(ctx.driver.start(ctx.options), /scripted RPC failure/);
  });
  await t.test('unexpected exit', async t => {
    const ctx = await fixture(t, [], { exitOn: 'turn/start' });
    const session = await ctx.driver.start(ctx.options);
    t.after(() => session.cancel());
    await assert.rejects(session.send('执行'), /exited without turn\/completed/);
  });
  await t.test('cancel during initialize', async t => {
    const ctx = await fixture(t, [], { hangOn: 'initialize' });
    const controller = new AbortController();
    const starting = ctx.driver.start({ ...ctx.options, signal: controller.signal });
    const rejection = assert.rejects(starting);
    controller.abort();
    await rejection;
  });
  await t.test('cancel waiting for turn completion', async t => {
    const ctx = await fixture(t, []);
    const session = await ctx.driver.start(ctx.options);
    await session.send('执行');
    const collecting = collect(session.events);
    session.cancel();
    assert.ok(!(await collecting).some(e => e.type === 'end' && e.reason === 'completed'));
  });
});

test('Codex 拒绝错误的沙箱和多个可写根，启动前不创建 app-server', async t => {
  const ctx = await fixture(t, []);
  for (const sandbox of [{ mode: 'read-only', writableRoots: [] }, { mode: 'workspace-write', writableRoots: [ctx.directory, tmpdir()] }] as const) {
    await assert.rejects(ctx.driver.start({ ...ctx.options, sandbox: { ...sandbox, writableRoots: [...sandbox.writableRoots] } }), /executor card copy/);
  }
  assert.deepEqual(await ctx.requests(), []);
});

test('Codex 可用性只检查临时 HOME 中的文件元数据，软链接幂等、不复制凭据；API 只查 config.toml', async t => {
  const ctx = await fixture(t, []);
  const previousHome = process.env.HOME;
  process.env.HOME = ctx.directory;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  const template = ctx.options.template!;
  assert.equal((await ctx.driver.checkAvailability(template)).available, false);
  const source = join(ctx.directory, '.codex', 'auth.json');
  await mkdir(join(ctx.directory, '.codex'));
  await writeFile(source, 'not real credentials');
  const old = new Date('2020-01-01T00:00:00Z');
  await utimes(source, old, old);
  const before = await stat(source);
  assert.equal((await ctx.driver.checkAvailability(template)).available, true);
  assert.equal((await ctx.driver.checkAvailability(template)).available, true);
  const target = join(ctx.directory, '.helm', 'agent-homes', 'codex', 'auth.json');
  assert.equal((await lstat(target)).isSymbolicLink(), true);
  assert.equal(await readlink(target), source);
  assert.equal((await stat(source)).atimeMs, before.atimeMs);
  await rm(source);
  assert.equal((await ctx.driver.checkAvailability(template)).available, false);
  const api = { ...template, id: 'codex-api', home: 'template' as const };
  const apiHome = join(ctx.directory, '.helm', 'agent-homes', 'codex-api');
  await mkdir(apiHome);
  assert.equal((await ctx.driver.checkAvailability(api)).available, false);
  await writeFile(join(apiHome, 'config.toml'), 'opaque, not parsed by Helm');
  assert.equal((await ctx.driver.checkAvailability(api)).available, true);
  await rm(target);
  await symlink(join(ctx.directory, 'wrong-auth'), target);
  await writeFile(source, 'not real credentials');
  assert.equal((await ctx.driver.checkAvailability(template)).available, false);
  assert.equal(await readlink(target), join(ctx.directory, 'wrong-auth'), '不覆盖非 Helm 链接');
});
