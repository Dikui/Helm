import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { CodexDriver, CodexCoordinatorDriver, CodexExecutorDriver } from '../src/codex-driver.js';
import type { DriverEvent, SessionOptions } from '../src/driver.js';
import { AgentCatalog, agentEnvironment, type AgentConfig } from '../src/agents.js';
import { roleRules } from '../src/prompts.js';
import { fixtureAgentDir } from './helmd-fixture.js';
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
  const agent: AgentConfig = { id: `codex-${role}`, role, driver: 'codex', model: 'test-model',
    reasoningEffort: 'low', fast: true, home: 'shared', description: '执行', prompt: '测试策略', rules: roleRules(role), directory, skillsPath: join(directory, 'skills') };
  const options: SessionOptions = { agent, cwd: directory, dataDir: join(directory, 'dispatch'),
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

test('Codex 执行者的 shell 策略保留项目 KEY，RPC 配置只有策略，没有变量值', async t => {
  const value = 'codex-project-env-shell-probe-17489';
  const ctx = await fixture(t, [completed()], { shellProbe: true });
  for (const resumeSessionId of [undefined, 'thread-scripted']) {
    const session = await ctx.driver.start({ ...ctx.options, env: { ...ctx.options.env, PROJECT_RUNTIME_KEY: value },
      projectEnvironmentNames: ['PROJECT_RUNTIME_KEY'], resumeSessionId });
    await session.send('读取项目变量，不输出值');
    const events = await collect(session.events);
    const probe = events.filter(event => event.type === 'output').map(event => JSON.parse(event.text)).find(message => message.method === 'fixture/shell');
    assert.equal(probe.params.text, value);
    session.cancel();
  }
  const requests = await ctx.requests();
  assert.ok(!JSON.stringify(requests).includes(value));
  for (const thread of requests.filter(request => ['thread/start', 'thread/resume'].includes(request.method))) {
    assert.equal(thread.params.config.shell_environment_policy.inherit, 'all');
    assert.equal(thread.params.config.shell_environment_policy.ignore_default_excludes, true);
    assert.deepEqual(thread.params.config.shell_environment_policy.set, {});
  }
});

test('Codex 两种角色将 HTTP 和 stdio MCP 写入会话配置，保留 command、args、env 和省略项', async t => {
  for (const role of ['coordinator', 'executor'] as const) {
    for (const home of ['shared', 'dedicated'] as const) {
      const ctx = await fixture(t, [completed()], {}, role);
      const mcpServers = {
        ...ctx.options.mcpServers,
        local: { type: 'stdio', command: 'node', args: ['server.js', '--stdio'], env: { TOKEN: 'local-secret' } },
        minimal: { type: 'stdio', command: 'local-mcp' },
        empty: { type: 'stdio', command: 'empty-mcp', args: [], env: {} },
      } satisfies SessionOptions['mcpServers'];
      const session = await ctx.driver.start({ ...ctx.options, agent: { ...ctx.options.agent, home }, mcpServers });
      t.after(() => session.cancel());
      await session.send('调用所选 MCP');
      assert.equal((await collect(session.events)).at(-1)?.type, 'end');
      const thread = (await ctx.requests()).find(request => request.method === 'thread/start');
      assert.deepEqual(thread.params.config.mcp_servers, {
        helm: { url: 'http://127.0.0.1:4242/mcp', http_headers: { Authorization: 'Bearer dispatch-token' }, default_tools_approval_mode: 'approve' },
        local: { command: 'node', args: ['server.js', '--stdio'], env: { TOKEN: 'local-secret' }, default_tools_approval_mode: 'approve' },
        minimal: { command: 'local-mcp', default_tools_approval_mode: 'approve' },
        empty: { command: 'empty-mcp', args: [], env: {}, default_tools_approval_mode: 'approve' },
      });
    }
  }
});

test('Codex 执行者按会话配置沙箱、MCP、fast、skills、主目录并记录 total token，等 turn/completed 才结束', async t => {
  const ctx = await fixture(t, [
    notification('item/completed', { item: { id: 'comment', type: 'agentMessage', text: '仍在执行', phase: 'commentary' } }),
    notification('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 120, outputTokens: 9, cachedInputTokens: 80, cacheWriteInputTokens: 6 }, last: { inputTokens: 7, outputTokens: 2 } } }),
    notification('item/completed', { item: { id: 'answer', type: 'agentMessage', text: '已完成', phase: 'final_answer' } }),
    completed(),
  ]);
  ctx.options.env = { ...agentEnvironment(ctx.options.agent!), ...ctx.options.env };
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  await session.send('实现派单');
  const events: DriverEvent[] = [];
  for await (const event of session.events) events.push(event);
  assert.equal(session.id, 'thread-scripted');
  assert.equal(session.sqlitePath, join(ctx.directory, 'dispatch', 'codex-sqlite'));
  assert.deepEqual(events.at(-1), { type: 'end', step: events.length, reason: 'completed', finalAnswer: '已完成', usage: { inputTokens: 120, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: 6 }, context: { tokens: 9 } });
  const requests = await ctx.requests();
  assert.deepEqual(requests.map(r => r.method), ['initialize', 'initialized', 'skills/extraRoots/set', 'thread/start', 'turn/start']);
  assert.deepEqual(requests[2].params, { extraRoots: [ctx.options.agent!.skillsPath] });
  const thread = requests[3].params;
  assert.equal(thread.approvalPolicy, 'never');
  assert.equal(thread.sandbox, 'workspace-write');
  assert.equal(thread.serviceTier, 'fast');
  assert.equal(thread.config.service_tier, 'fast');
  assert.deepEqual(thread.config.mcp_servers, { helm: { url: 'http://127.0.0.1:4242/mcp', http_headers: { Authorization: 'Bearer dispatch-token' }, default_tools_approval_mode: 'approve' } });
  assert.match(thread.developerInstructions, /测试策略/);
  assert.match(thread.developerInstructions, /submit-conclusion/);
  assert.match(thread.developerInstructions, /不要 git commit 或改 git 配置/);
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
  ctx.options.agent = { ...ctx.options.agent!, prompt: new AgentCatalog(fixtureAgentDir, ['codex']).get(`codex-${role}`).prompt };
  for (const resumeSessionId of role === 'executor' ? [undefined, 'thread-scripted'] : [undefined]) {
    const session = await ctx.driver.start({ ...ctx.options, resumeSessionId });
    t.after(() => session.cancel());
    await session.send('保留输入原文');
    const end = (await collect(session.events)).at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'completed');
    const requests = await ctx.requests();
    assert.deepEqual(requests.filter(r => r.method === 'turn/start').at(-1).params.input, [{ type: 'text', text: '保留输入原文' }]);
    const prompt = requests.filter(r => r.method === 'thread/start' || r.method === 'thread/resume').at(-1).params.developerInstructions;
    for (const rule of Object.values(roleRules(role))) assert.ok(prompt.includes(rule.trim()));
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

test('Codex 关闭插件后，用户启用的本地插件技能经 extraRoots 传入，未启用的不传', async t => {
  const ctx = await fixture(t, [completed()]);
  const codexDir = join(ctx.directory, '.codex');
  const cache = join(codexDir, 'plugins', 'cache');
  const write = async (path: string, content: string) => { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, content); };
  // Like gungnir: the manifest lists single skills grouped in folders; the highest version wins.
  await write(join(cache, 'market', 'listed', '4.10.0', '.claude-plugin', 'plugin.json'), JSON.stringify({ skills: ['./engineering/tdd', './engineering/implement', './productivity/grill-me'] }));
  for (const skill of ['engineering/tdd', 'engineering/implement', 'productivity/grill-me']) await write(join(cache, 'market', 'listed', '4.10.0', skill, 'SKILL.md'), '');
  await mkdir(join(cache, 'market', 'listed', '4.9.0'), { recursive: true });
  await write(join(cache, 'local', 'plain', '1.0.0', 'skills', 'review', 'SKILL.md'), '');
  await write(join(cache, 'market', 'off', '1.0.0', 'skills', 'x', 'SKILL.md'), '');
  await write(join(codexDir, 'config.toml'), [
    'model = "m"', '[plugins."listed@market"]', 'enabled = true', '', '[plugins."off@market"]', 'enabled = false',
    '[plugins."plain@local"]', 'enabled = true', '[plugins."missing@market"]', 'enabled = true', ''].join('\n'));
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  const requests = await ctx.requests();
  assert.deepEqual(requests[2].params.extraRoots, [ctx.options.agent!.skillsPath,
    join(cache, 'market', 'listed', '4.10.0', 'engineering'), join(cache, 'market', 'listed', '4.10.0', 'productivity'),
    join(cache, 'local', 'plain', '1.0.0', 'skills')]);
});

test('Codex 续跑使用 thread/resume，API 主目录、关闭 fast 和空 skills 均取当前 Agent', async t => {
  const ctx = await fixture(t, [completed()]);
  ctx.options.agent = { ...ctx.options.agent!, id: 'api-codex', home: 'dedicated', fast: false, skillsPath: null, reasoningEffort: 'ultra' };
  ctx.options.resumeSessionId = 'thread-scripted';
  const session = await ctx.driver.start(ctx.options);
  await session.send('继续');
  const events = await collect(session.events);
  const requests = await ctx.requests();
  assert.equal(requests[3].method, 'thread/resume');
  assert.equal(requests[3].params.threadId, 'thread-scripted');
  assert.deepEqual(requests[2].params.extraRoots, []);
  assert.equal(requests[4].params.effort, 'ultra');
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
  const agent = ctx.options.agent!;
  for (const exit of [0, 1]) {
    await writeFile(executable, `#!${process.execPath}\nconst fs = require('fs');\nfs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({args: process.argv.slice(2), env: process.env, cwd: process.cwd()}));\nconsole.error('opaque account information');\nprocess.exit(${exit});\n`);
    await chmod(executable, 0o755);
    const availability = await driver.checkAvailability(agent);
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
  assert.equal((await driver.checkAvailability(agent)).available, false, 'CLI 缺失时不可用');
  const api = { ...agent, id: 'codex-api', home: 'dedicated' as const };
  const apiHome = join(ctx.directory, '.helm', 'agent-homes', 'codex-api');
  assert.equal((await driver.checkAvailability(api)).available, false);
  await mkdir(apiHome, { recursive: true });
  assert.equal((await driver.checkAvailability(api)).available, false);
  await writeFile(join(apiHome, 'config.toml'), 'opaque, not parsed by Helm');
  assert.equal((await driver.checkAvailability(api)).available, true, 'API Agent 不调用登录检查');
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

test('Codex 调度者拒绝可写沙箱和错配角色，角色专用驱动不越界', async t => {
  const ctx = await fixture(t, [], {}, 'coordinator');
  for (const options of [
    { ...ctx.options, sandbox: { mode: 'workspace-write' as const, writableRoots: [ctx.directory] } },
    { ...ctx.options, sandbox: { mode: 'read-only' as const, writableRoots: [ctx.directory] } },
  ]) await assert.rejects(ctx.driver.start(options), /read-only coordinator round/);
  await assert.rejects(new CodexCoordinatorDriver().start({ ...ctx.options, agent: { ...ctx.options.agent!, role: 'executor' } }), /coordinator/);
  await assert.rejects(new CodexExecutorDriver().start(ctx.options), /executor card copy/);
  assert.deepEqual(await ctx.requests(), []);
});

test('Codex 经 model/list 翻页列出可见模型和原生推理强度，默认模型另列为 id null', async t => {
  const model = (id: string, extra: object = {}) => ({ id, model: id, displayName: id.toUpperCase(), hidden: false, isDefault: false,
    supportedReasoningEfforts: ['low', 'max', 'ultra'].map(reasoningEffort => ({ reasoningEffort, description: '' })), defaultReasoningEffort: 'low', ...extra });
  const ctx = await fixture(t, [], { modelPages: [
    { data: [model('gpt-a', { isDefault: true }), model('gpt-hidden', { hidden: true })], nextCursor: '1' }, { data: [model('gpt-b')], nextCursor: null },
  ] });
  const models = await ctx.driver.listModels();
  assert.deepEqual(models.map(item => item.id), [null, 'gpt-a', 'gpt-b']);
  assert.deepEqual(models[0], { id: null, label: 'GPT-A', efforts: ['low', 'max', 'ultra'], defaultEffort: 'low' });
  assert.deepEqual((await ctx.requests()).filter(r => r.method === 'model/list').map(r => r.params), [{}, { cursor: '1' }]);
});

test('Codex turn/plan/updated 归一 inProgress、替换和清空，忽略其他会话及无效计划', async t => {
  const ctx = await fixture(t, [
    notification('turn/plan/updated', { plan: [{ step: '读取', status: 'completed' }, { step: '执行', status: 'inProgress' }, { step: '检查', status: 'pending' }] }),
    notification('turn/plan/updated', { threadId: 'foreign', plan: [{ step: '串会话', status: 'pending' }] }),
    notification('turn/plan/updated', { turnId: 'foreign', plan: [] }),
    notification('turn/plan/updated', { plan: [{ step: '无效', status: 'unknown' }] }),
    notification('turn/plan/updated', { plan: [] }), completed(),
  ], {}, 'coordinator');
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  await session.send('列出计划');
  const events = await collect(session.events);
  assert.deepEqual(events.filter(event => event.type === 'plan').map(event => event.entries), [[
    { content: '读取', status: 'completed' }, { content: '执行', status: 'in_progress' }, { content: '检查', status: 'pending' },
  ], []]);
  assert.ok(events.every((event, i) => event.step === i + 1));
});

test('Codex 没有用量通知时保留未知，明确零用量时保留零', async t => {
  for (const [notifications, usage] of [
    [[completed()], { inputTokens: null, outputTokens: null }],
    [[notification('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 0, outputTokens: 0 } } }), completed()], { inputTokens: 0, outputTokens: 0 }],
  ] as const) {
    const ctx = await fixture(t, [...notifications]);
    const session = await ctx.driver.start(ctx.options);
    t.after(() => session.cancel());
    await session.send('用量');
    const end = (await collect(session.events)).at(-1);
    assert.deepEqual(end?.type === 'end' && end.usage, usage);
  }
});

test('Codex 调度者续跑 thread 时换上本轮令牌，结束时报告最近一次请求的占用和窗口', async t => {
  const usage = (input: number, output: number) => notification('thread/tokenUsage/updated', { tokenUsage: {
    total: { inputTokens: input * 3, outputTokens: output * 3 }, last: { inputTokens: input, outputTokens: output }, modelContextWindow: 258400 } });
  const ctx = await fixture(t, [usage(20, 1), usage(30, 4), completed()], {}, 'coordinator');
  const session = await ctx.driver.start({ ...ctx.options, resumeSessionId: 'thread-scripted',
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer round-2' } } } });
  await session.send('续跑简报');
  const end = (await collect(session.events)).at(-1)!;
  assert.deepEqual(end.type === 'end' && end.context, { tokens: 34, window: 258400 });
  const thread = (await ctx.requests()).find(request => request.method === 'thread/resume');
  assert.equal(thread.params.threadId, 'thread-scripted');
  assert.equal(thread.params.sandbox, 'read-only');
  assert.equal(thread.params.config.mcp_servers.helm.http_headers.Authorization, 'Bearer round-2');
});
