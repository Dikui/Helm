import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { CodexDriver, CodexCoordinatorDriver, CodexExecutorDriver } from '../src/codex-driver.js';
import type { DriverEvent, SessionOptions } from '../src/driver.js';
import { TemplateCatalog, templateEnvironment, type AgentTemplate } from '../src/templates.js';
import { codexErrors } from './fixtures/codex-errors.js';

async function fixture(t: TestContext, notifications: object[], script: object = {}, role: 'executor' | 'coordinator' = 'executor') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-codex-driver-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'skills'));
  const record = join(directory, 'requests.jsonl');
  await writeFile(record, '');
  const path = join(directory, 'script.json');
  await writeFile(path, JSON.stringify({ record, notifications, ...script }));
  const driver = new CodexDriver({ command: { file: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/codex-app-server.js', import.meta.url)), path] } });
  const template: AgentTemplate = { id: `codex-${role}`, role, driver: 'codex', model: 'test-model',
    reasoningEffort: 'low', fast: true, home: 'shared', description: '执行', prompt: '测试策略', directory, skillsPath: join(directory, 'skills') };
  const options: SessionOptions = { template, cwd: directory, dataDir: join(directory, 'dispatch'),
    env: { CODEX_HOME: '/caller/must-not-use', HOME: directory, PATH: process.env.PATH!, NO_PROXY: 'example.test', no_proxy: 'internal.test' },
    sandbox: role === 'coordinator' ? { mode: 'read-only', writableRoots: [] } : { mode: 'workspace-write', writableRoots: [directory] },
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
  ctx.options.env = { ...templateEnvironment(ctx.options.template!), ...ctx.options.env };
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
  assert.equal(thread.serviceTier, 'fast');
  assert.equal(thread.config.service_tier, 'fast');
  assert.deepEqual(thread.config.mcp_servers, { helm: { url: 'http://127.0.0.1:4242/mcp', http_headers: { Authorization: 'Bearer dispatch-token' }, default_tools_approval_mode: 'approve' } });
  assert.match(thread.developerInstructions, /测试策略/);
  assert.match(thread.developerInstructions, /submit-conclusion/);
  assert.match(thread.developerInstructions, /不要自己 git commit、不要改 git 配置/);
  assert.match(thread.developerInstructions, /不要自己安装或启动浏览器/);
  assert.deepEqual(requests[4].params.sandboxPolicy, { type: 'workspaceWrite', writableRoots: [ctx.directory], networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true });
  assert.equal(requests[4].params.effort, 'low');
  const env = JSON.parse(events.filter(e => e.type === 'output').map(e => e.text).find(text => text.includes('fixture/environment'))!).params.env;
  assert.equal(Object.hasOwn(env, 'CODEX_HOME'), false);
  assert.ok(env.GIT_CONFIG_PARAMETERS);
  assert.equal(env.GIT_CONFIG_COUNT, undefined);
  await assert.rejects(stat(join(ctx.directory, '.helm', 'agent-homes', 'codex')), { code: 'ENOENT' });
  assert.equal(env.CODEX_SQLITE_HOME, session.sqlitePath);
  assert.equal(env.NO_PROXY, 'example.test,internal.test,127.0.0.1,localhost');
  assert.equal(env.no_proxy, env.NO_PROXY);
  assert.ok(events.filter(e => e.type === 'output').some(e => e.text.includes('initializeDurationMs')));
});

for (const role of ['coordinator', 'executor'] as const) test(`Codex ${role} 默认策略与运行约定进入实际 RPC 提示词`, async t => {
  const ctx = await fixture(t, [completed()], {}, role);
  ctx.options.template = { ...ctx.options.template!, prompt: new TemplateCatalog(undefined, ['codex']).get(`codex-${role}`).prompt };
  for (const resumeSessionId of role === 'executor' ? [undefined, 'thread-scripted'] : [undefined]) {
    const session = await ctx.driver.start({ ...ctx.options, resumeSessionId });
    t.after(() => session.cancel());
    await session.send('保留输入原文');
    const end = (await collect(session.events)).at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'completed');
    const requests = await ctx.requests();
    assert.deepEqual(requests.filter(r => r.method === 'turn/start').at(-1).params.input, [{ type: 'text', text: '保留输入原文' }]);
    const prompt = requests.filter(r => r.method === 'thread/start' || r.method === 'thread/resume').at(-1).params.developerInstructions;
    const requirements = role === 'coordinator' ? [
      /用户.*提问、说明和进展摘要.*send-message.*稳定.*key/,
      /最终回答.*用户看不到/,
      /派单内容.*本次具体要做什么.*验收标准和需要的证据/,
      /不要只写“按卡片说明实现”/,
      /卡片说明快照会自动附上.*派单内容仍要说明本次任务/,
      /执行派单.*真实浏览器自查页面.*needsBrowser=true/,
      /不要让执行者自己安装或启动浏览器/,
      /cardId、dispatchId、gateId.*工具返回结果原样复制.*不要手打或拼接/,
      /工具因 ID 被拒.*重新读取卡片图核对 ID.*再重试/,
      /两家或多家验收派单.*同一张整体验收卡片.*全部通过后才用 complete-card/,
      /不要提前完成后另开卡片/,
    ] : [
      /派单前附卡片说明快照/,
      /不要自己 git commit、不要改 git 配置/,
      /执行派单结束后由运行层提交/,
      /不要自己安装或启动浏览器/,
      /需要浏览器时只用注入的浏览器工具.*没有.*结论里说明/,
      /验收判定不通过前.*复核现象是否真的违反标准.*排除符合规则的边界行为/,
      /已经贴边时再往同方向操作没有变化/,
      /至少一条直接证据支撑不通过结论/,
      /submit-conclusion/,
    ];
    for (const requirement of requirements) assert.match(prompt, requirement);
  }
});

for (const role of ['executor', 'coordinator'] as const) for (const sample of codexErrors) test(`Codex ${role} 结束分类：${sample.name}`, async t => {
  const ctx = await fixture(t, [
    notification('error', { error: sample.error, willRetry: false }),
    notification('item/completed', { item: { type: 'agentMessage', text: '失败时丢弃的回答' } }),
    completed('failed', sample.error),
  ], {}, role);
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

for (const role of ['executor', 'coordinator'] as const) test(`Codex ${role} 中断、崩溃、RPC 拒绝、取消初始化均能收尾；无 turn/completed 不算成功`, async t => {
  await t.test('interrupted', async t => {
    const ctx = await fixture(t, [completed('interrupted')], {}, role);
    const session = await ctx.driver.start(ctx.options);
    await session.send('执行');
    const end = (await collect(session.events)).at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'aborted');
  });
  for (const method of ['initialize', 'skills/extraRoots/set', 'thread/start']) await t.test(`RPC ${method}`, async t => {
    const ctx = await fixture(t, [], { rejectOn: method }, role);
    await assert.rejects(ctx.driver.start(ctx.options), /scripted RPC failure/);
  });
  await t.test('unexpected exit', async t => {
    const ctx = await fixture(t, [], { exitOn: 'turn/start' }, role);
    const session = await ctx.driver.start(ctx.options);
    t.after(() => session.cancel());
    await assert.rejects(session.send('执行'), /exited without turn\/completed/);
  });
  await t.test('cancel during initialize', async t => {
    const ctx = await fixture(t, [], { hangOn: 'initialize' }, role);
    const controller = new AbortController();
    const starting = ctx.driver.start({ ...ctx.options, signal: controller.signal });
    const rejection = assert.rejects(starting);
    controller.abort();
    await rejection;
  });
  await t.test('cancel waiting for turn completion', async t => {
    const ctx = await fixture(t, [], {}, role);
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

test('Codex 订阅可用性由默认环境的 CLI 退出码决定，不依赖 auth.json；API 只查 config.toml', async t => {
  const ctx = await fixture(t, []);
  const previous = { HOME: process.env.HOME, CODEX_HOME: process.env.CODEX_HOME };
  process.env.HOME = ctx.directory;
  process.env.CODEX_HOME = '/parent/must-not-use';
  t.after(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
  const executable = join(ctx.directory, 'codex-substitute');
  const evidence = join(ctx.directory, 'login-probe.json');
  const driver = new CodexDriver({ command: { file: executable, args: [] } });
  const template = ctx.options.template!;
  for (const exit of [0, 1]) {
    await writeFile(executable, `#!${process.execPath}\nconst fs = require('fs');\nfs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({args: process.argv.slice(2), env: process.env, cwd: process.cwd()}));\nconsole.error('opaque account information');\nprocess.exit(${exit});\n`);
    await chmod(executable, 0o755);
    const availability = await driver.checkAvailability(template);
    assert.equal(availability.available, exit === 0);
    if (exit) assert.equal(availability.command, 'codex login');
    assert.doesNotMatch(JSON.stringify(availability), /opaque account information/);
    const probe = JSON.parse(await readFile(evidence, 'utf8'));
    assert.deepEqual(probe.args, ['login', 'status']);
    assert.equal(Object.hasOwn(probe.env, 'CODEX_HOME'), false);
    assert.equal(probe.env.HOME, ctx.directory);
    assert.equal(probe.cwd, ctx.directory);
    await assert.rejects(stat(join(ctx.directory, '.helm', 'agent-homes', 'codex')), { code: 'ENOENT' });
    await assert.rejects(stat(join(ctx.directory, '.codex')), { code: 'ENOENT' });
  }
  await rm(executable);
  assert.equal((await driver.checkAvailability(template)).available, false, 'CLI 缺失时不可用');
  const api = { ...template, id: 'codex-api', home: 'template' as const };
  const apiHome = join(ctx.directory, '.helm', 'agent-homes', 'codex-api');
  assert.equal((await driver.checkAvailability(api)).available, false);
  await mkdir(apiHome, { recursive: true });
  assert.equal((await driver.checkAvailability(api)).available, false);
  await writeFile(join(apiHome, 'config.toml'), 'opaque, not parsed by Helm');
  assert.equal((await driver.checkAvailability(api)).available, true, 'API 模板不调用登录检查');
});

test('Codex 调度者每轮新进程、新 thread，只读沙箱及轮次 MCP 配置生效', async t => {
  const ctx = await fixture(t, [
    notification('item/completed', { item: { type: 'agentMessage', phase: 'commentary', text: '进行中' } }),
    notification('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 13, outputTokens: 4 } } }),
    notification('item/completed', { item: { type: 'agentMessage', phase: 'final_answer', text: '等待派单' } }), completed(),
  ], {}, 'coordinator');
  const processes: number[] = [];
  ctx.options.onProcess = process => { processes.push(process.pid); };
  for (let round = 0; round < 2; round++) {
    const session = await ctx.driver.start({ ...ctx.options, dataDir: join(ctx.directory, `round-${round}`),
      mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: `Bearer round-${round}` } } } });
    await session.send('启动简报');
    const events = await collect(session.events);
    const end = events.at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'completed');
    assert.equal(end.type === 'end' && end.finalAnswer, '等待派单');
    assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 13, outputTokens: 4 });
    const env = JSON.parse(events.filter(e => e.type === 'output').map(e => e.text).find(text => text.includes('fixture/environment'))!).params.env;
    assert.equal(Object.hasOwn(env, 'CODEX_HOME'), false);
    await assert.rejects(stat(join(ctx.directory, '.helm', 'agent-homes', 'codex')), { code: 'ENOENT' });
    assert.equal(env.CODEX_SQLITE_HOME, join(ctx.directory, `round-${round}`, 'codex-sqlite'));
    assert.equal(env.NO_PROXY, 'example.test,internal.test,127.0.0.1,localhost');
    assert.equal(env.no_proxy, env.NO_PROXY);
  }
  assert.equal(new Set(processes).size, 2);
  const requests = await ctx.requests();
  assert.equal(requests.filter(r => r.method === 'thread/start').length, 2);
  assert.equal(requests.some(r => r.method === 'thread/resume'), false);
  for (const [round, thread] of requests.filter(r => r.method === 'thread/start').entries()) {
    assert.equal(thread.params.serviceTier, 'fast');
    assert.equal(thread.params.sandbox, 'read-only');
    assert.equal(thread.params.approvalPolicy, 'never');
    assert.equal(thread.params.config.sandbox_workspace_write, undefined);
    assert.deepEqual(thread.params.config.mcp_servers, { helm: { url: 'http://127.0.0.1:4242/mcp',
      http_headers: { Authorization: `Bearer round-${round}` }, default_tools_approval_mode: 'approve' } });
    assert.match(thread.params.developerInstructions, /项目代码只读/);
    assert.doesNotMatch(thread.params.developerInstructions, /submit-conclusion/);
  }
  for (const turn of requests.filter(r => r.method === 'turn/start')) {
    assert.deepEqual(turn.params.sandboxPolicy, { type: 'readOnly' });
    assert.equal(turn.params.approvalPolicy, 'never');
  }
});

test('Codex 调度者拒绝续跑、可写沙箱和错配角色，角色专用驱动不越界', async t => {
  const ctx = await fixture(t, [], {}, 'coordinator');
  for (const options of [
    { ...ctx.options, resumeSessionId: 'old-thread' },
    { ...ctx.options, sandbox: { mode: 'workspace-write' as const, writableRoots: [ctx.directory] } },
    { ...ctx.options, sandbox: { mode: 'read-only' as const, writableRoots: [ctx.directory] } },
  ]) await assert.rejects(ctx.driver.start(options), /fresh read-only coordinator round/);
  await assert.rejects(new CodexCoordinatorDriver().start({ ...ctx.options, template: { ...ctx.options.template!, role: 'executor' } }), /coordinator/);
  await assert.rejects(new CodexExecutorDriver().start(ctx.options), /executor card copy/);
  assert.deepEqual(await ctx.requests(), []);
});
