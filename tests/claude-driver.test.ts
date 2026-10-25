import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CanUseTool, Options, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeDriver, ClaudeCoordinatorDriver, ClaudeExecutorDriver, type ClaudeQuery } from '../src/claude-driver.js';
import type { Driver, DriverEvent, SessionOptions } from '../src/driver.js';
import { AgentCatalog } from '../src/agents.js';
import { roleRules } from '../src/prompts.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { fixture as dispatchFixture, until } from './browser-fixture.js';
import { claudeErrors } from './fixtures/claude-errors.js';

async function fixture(t: TestContext, role: 'executor' | 'coordinator' = 'executor'): Promise<SessionOptions> {
  const cwd = await realpath(await mkdtemp(join(tmpdir(), 'helm-claude-')));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return {
    cwd, env: { HOME: cwd, PATH: '/test/bin', HTTPS_PROXY: 'http://proxy.invalid', no_proxy: 'example.test', HELM_PORT_START: '4500' },
    agent: { ...new AgentCatalog(fixtureAgentDir).get(`claude-${role}`), model: 'haiku', reasoningEffort: 'low' },
    sandbox: role === 'executor' ? { mode: 'workspace-write', writableRoots: [cwd] } : { mode: 'read-only', writableRoots: [] },
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer dispatch-token' } } },
  };
}

function result(overrides: Partial<SDKResultMessage> = {}): SDKResultMessage {
  return {
    type: 'result', subtype: 'success', is_error: false, result: '最终回答',
    uuid: 'result-uuid', session_id: 'session', duration_ms: 1, duration_api_ms: 1,
    num_turns: 1, stop_reason: 'end_turn', total_cost_usd: 0,
    usage: { input_tokens: 999, output_tokens: 999 },
    modelUsage: {
      main: { inputTokens: 10, outputTokens: 4, cacheReadInputTokens: 20, cacheCreationInputTokens: 3,
        webSearchRequests: 0, costUSD: 0, contextWindow: 200000, maxOutputTokens: 1000 },
      helper: { inputTokens: 2, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0,
        webSearchRequests: 0, costUSD: 0, contextWindow: 200000, maxOutputTokens: 1000 },
    },
    permission_denials: [], ...overrides,
  } as SDKResultMessage;
}

function fakeQuery(messages: SDKMessage[], inspect?: (args: Parameters<ClaudeQuery>[0]) => void): ClaudeQuery {
  return args => {
    inspect?.(args);
    return { close() {}, async *[Symbol.asyncIterator]() { yield* messages; } };
  };
}

async function collect(driver: Driver, options: SessionOptions) {
  const session = await driver.start(options);
  await session.send('派单内容');
  const events: DriverEvent[] = [];
  for await (const event of session.events) events.push(event);
  return { session, events, end: events.find(event => event.type === 'end') };
}

test('Claude 两种角色将 HTTP 和 stdio MCP 映射到 SDK，保留命令参数及环境变量和省略项', async t => {
  for (const role of ['coordinator', 'executor'] as const) {
    const options = await fixture(t, role);
    const mcpServers = {
      ...options.mcpServers,
      local: { type: 'stdio', command: 'node', args: ['server.js', '--stdio'], env: { TOKEN: 'local-secret' } },
      minimal: { type: 'stdio', command: 'local-mcp' },
      empty: { type: 'stdio', command: 'empty-mcp', args: [], env: {} },
    } satisfies SessionOptions['mcpServers'];
    for (const home of ['shared', 'dedicated'] as const) {
      let inspected = false;
      await collect(new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude', query: fakeQuery([result()], args => {
        inspected = true;
        assert.deepEqual(args.options!.mcpServers, {
          helm: { type: 'http', url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer dispatch-token' } },
          local: { type: 'stdio', command: 'node', args: ['server.js', '--stdio'], env: { TOKEN: 'local-secret' } },
          minimal: { type: 'stdio', command: 'local-mcp' },
          empty: { type: 'stdio', command: 'empty-mcp', args: [], env: {} },
        });
        assert.equal(Object.hasOwn(args.options!, 'strictMcpConfig'), false);
      }) }), { ...options, agent: { ...options.agent, home }, mcpServers });
      assert.equal(inspected, true);
    }
  }
});

test('Claude Agent 叠加本地 skills 插件，两个角色均可调用 Agent、用户和内置 skill', async t => {
  const base = await fixture(t);
  const context = { signal: new AbortController().signal, toolUseID: 'skill', requestId: 'skill' };
  await Promise.all((['coordinator', 'executor'] as const).map(async role => {
    const id = `agent-${role}`;
    const directory = join(base.cwd, id);
    await mkdir(join(directory, 'skills', 'secret'), { recursive: true });
    await mkdir(join(directory, 'skills', 'not-a-skill'));
    await writeFile(join(directory, 'skills', 'README.md'), 'Not a skill');
    await writeFile(join(directory, 'skills', 'secret', 'SKILL.md'), '---\nname: "passphrase" # The frontmatter name overrides the directory.\ndescription: Test skill\n---\nSecret instructions');
    await mkdir(join(directory, 'skills', 'fallback'));
    await writeFile(join(directory, 'skills', 'fallback', 'SKILL.md'), 'No frontmatter; use the directory name.');
    await writeFile(join(directory, 'config.json'), JSON.stringify({
      role, driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: 'Test agent',
    }));
    await writeFile(join(directory, 'prompt.md'), 'Test strategy');
    const original = new AgentCatalog(base.cwd).get(id);
    const runtimeDirectory = join(base.cwd, `run-${role}`);
    await mkdir(join(runtimeDirectory, 'skills'), { recursive: true });
    const agent = { ...original, skillsPath: join(runtimeDirectory, 'skills') };
    let inspected = false;
    const driver = new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
      query: args => ({ close() {}, async *[Symbol.asyncIterator]() {
        inspected = true;
        const sdk = args.options!;
        assert.deepEqual(sdk.plugins, [{ type: 'local', path: runtimeDirectory, skipMcpDiscovery: true }]);
        assert.equal(sdk.skills, 'all');
        assert.ok((sdk.tools as string[]).includes('Skill'));
        assert.equal((await sdk.canUseTool!('Skill', { skill: `${id}:passphrase` }, context))?.behavior, 'allow');
        for (const skill of ['user-skill', 'loop']) {
          assert.equal((await sdk.canUseTool!('Skill', { skill }, context))?.behavior, 'allow');
        }
        yield result();
      } }) });
    await collect(driver, { ...base, agent,
      sandbox: role === 'coordinator' ? { mode: 'read-only', writableRoots: [] } : base.sandbox });
    assert.equal(inspected, true);
  }));
});

test('Claude 没有 skills 目录或目录为空时仍开放用户和内置 skills', async t => {
  const options = await fixture(t);
  const empty = join(options.cwd, 'skills');
  await mkdir(empty);
  for (const home of ['shared', 'dedicated'] as const) {
    for (const skillsPath of [null, empty]) {
      let inspected = false;
      await collect(new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
        query: fakeQuery([result()], args => {
          inspected = true;
          assert.equal(args.options!.skills, 'all');
          assert.ok((args.options!.tools as string[]).includes('Skill'));
          assert.deepEqual(args.options!.plugins, skillsPath === null ? undefined
            : [{ type: 'local', path: options.cwd, skipMcpDiscovery: true }]);
        }) }), { ...options, agent: { ...options.agent!, directory: options.cwd, skillsPath, home } });
      assert.equal(inspected, true);
    }
  }
});

test('Claude 订阅 Agent 沿用默认主目录，API 使用 Agent 主目录并加载用户设置', async t => {
  const options = await fixture(t);
  options.env.HOME = options.cwd;
  options.env.CLAUDE_CONFIG_DIR = '/caller/must-not-use';
  for (const home of ['shared', 'dedicated'] as const) {
    const agent = { ...options.agent!, id: 'api-executor', home };
    await collect(new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
      query: fakeQuery([result()], args => {
        assert.equal(Object.hasOwn(args.options!.env!, 'CLAUDE_CONFIG_DIR'), home === 'dedicated');
        if (home === 'dedicated') assert.equal(args.options!.env!.CLAUDE_CONFIG_DIR,
          join(options.cwd, '.helm', 'agent-homes', 'api-executor'));
        assert.deepEqual(args.options!.settingSources, home === 'shared' ? ['user', 'project', 'local'] : ['user']);
        assert.equal(Object.hasOwn(args.options!, 'strictMcpConfig'), false);
        assert.equal(typeof args.options!.settings, 'object');
        const settings = args.options!.settings as Exclude<NonNullable<Options['settings']>, string>;
        assert.equal(settings.fastMode, false);
        assert.equal(settings.autoMemoryEnabled, false);
        // Ask rules precede loaded allow rules, keeping the path checks reachable.
        assert.deepEqual(settings.permissions?.ask, ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash']);
        assert.equal(args.options!.permissionMode, 'default');
      }) }), { ...options, agent });
  }
});

test('Claude 可用性只让 CLI 查订阅登录；API 仅检查目录和设置文件存在', async t => {
  const options = await fixture(t);
  const previousHome = process.env.HOME;
  process.env.HOME = options.cwd;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  let loggedIn = false;
  let probes = 0;
  const driver = new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
    authStatus: async (executable, probe) => {
      probes++;
      assert.equal(executable, '/test/bin/claude');
      assert.equal(Object.hasOwn(probe.env, 'CLAUDE_CONFIG_DIR'), false);
      assert.equal(probe.env.ANTHROPIC_API_KEY, undefined);
      assert.equal(probe.cwd, options.cwd);
      return loggedIn;
    } });
  const unavailable = await driver.checkAvailability(options.agent!);
  assert.equal(unavailable.available, false);
  assert.match(unavailable.reason!, /登录/);
  assert.equal(unavailable.command, 'claude auth login');
  await assert.rejects(realpath(join(options.cwd, '.helm/agent-homes/claude')), { code: 'ENOENT' });
  loggedIn = true;
  assert.equal((await driver.checkAvailability(options.agent!)).available, true);
  const api = { ...options.agent!, id: 'api-example', home: 'dedicated' as const };
  assert.equal((await driver.checkAvailability(api)).available, false);
  const directory = join(options.cwd, '.helm/agent-homes/api-example');
  await mkdir(directory, { recursive: true });
  assert.equal((await driver.checkAvailability(api)).available, false);
  // Malformed contents deliberately pass: Helm must never parse this file.
  await writeFile(join(directory, 'settings.json'), 'not JSON; user-owned credentials');
  assert.equal((await driver.checkAvailability(api)).available, true);
  assert.equal(probes, 2, 'API Agent 不调用登录检查');
});

test('Claude 登录探针通过 CLI 替身获取状态，隔离配置和父环境，拒绝失败或非订阅登录', async t => {
  const options = await fixture(t);
  const previousConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = '/parent/must-not-use';
  t.after(() => { if (previousConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previousConfig; });
  const previousHome = process.env.HOME;
  process.env.HOME = options.cwd;
  t.after(() => { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; });
  const executable = join(options.cwd, 'claude-substitute');
  const evidence = join(options.cwd, 'probe.json');
  const driver = new ClaudeDriver({ pathToClaudeCodeExecutable: executable });
  for (const [status, exit] of [
    [{ loggedIn: true, authMethod: 'claude.ai' }, 0],
    [{ loggedIn: false, authMethod: 'none' }, 0],
    [{ loggedIn: true, authMethod: 'api_key' }, 0],
    [{ loggedIn: true, authMethod: 'claude.ai' }, 1],
    ['invalid-json', 0],
  ] as const) {
    await writeFile(executable, `#!${process.execPath}\nconst fs = require('fs');\nfs.writeFileSync(${JSON.stringify(evidence)}, JSON.stringify({args: process.argv.slice(2), env: process.env, cwd: process.cwd()}));\nconsole.log(${JSON.stringify(typeof status === 'string' ? status : JSON.stringify(status))});\nprocess.exit(${exit});\n`);
    await chmod(executable, 0o755);
    const availability = await driver.checkAvailability(options.agent!);
    assert.equal(availability.available, typeof status !== 'string' && status.loggedIn && status.authMethod === 'claude.ai' && exit === 0);
    const probe = JSON.parse(await readFile(evidence, 'utf8'));
    assert.deepEqual(probe.args, ['auth', 'status', '--json']);
    assert.equal(Object.hasOwn(probe.env, 'CLAUDE_CONFIG_DIR'), false);
    assert.equal(probe.cwd, options.cwd);
    assert.equal(probe.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(probe.env.CLAUDE_CODE_DESKTOP_SESSION, undefined);
  }
});

test('真实 Claude 驱动把默认调度规则注入 SDK 提示词，保留启动简报原文', async t => {
  const options = await fixture(t, 'coordinator');
  let inspected = false;
  const driver = new ClaudeCoordinatorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
    query: fakeQuery([result()], args => {
      inspected = true;
      assert.equal(args.prompt, '派单内容');
      const prompt = args.options?.systemPrompt;
      assert.equal(typeof prompt, 'string');
      for (const rule of Object.values(roleRules('coordinator'))) assert.ok((prompt as string).includes(rule.trim()));
    }) });
  assert.equal((await collect(driver, options)).end?.reason, 'completed');
  assert.equal(inspected, true, '必须实际到达真实驱动的 SDK 查询边界');
});

test('真实 Claude 驱动在新开和续跑派单中注入默认执行规则，保留派单原文', async t => {
  const options = await fixture(t);
  for (const resumeSessionId of [undefined, 'previous-executor-session']) {
    let inspected = false;
    const driver = new ClaudeExecutorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
      query: fakeQuery([result()], args => {
        inspected = true;
        assert.equal(args.prompt, '派单内容');
        const prompt = args.options?.systemPrompt;
        assert.equal(typeof prompt, 'string');
        for (const rule of Object.values(roleRules('executor'))) assert.ok((prompt as string).includes(rule.trim()));
      }) });
    assert.equal((await collect(driver, { ...options, resumeSessionId })).end?.reason, 'completed');
    assert.equal(inspected, true, '必须实际到达真实驱动的 SDK 查询边界');
  }
});

test('同一个 Claude 驱动按 Agent 角色选择会话权限，并在内置角色规则和 Agent 提示词后追加运行约定', async t => {
  for (const role of ['coordinator', 'executor'] as const) {
    const options = await fixture(t, role);
    options.agent = { ...options.agent!, prompt: '测试自定义策略' };
    const driver = new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
      query: fakeQuery([result()], args => {
        assert.match(args.options!.systemPrompt as string, role === "coordinator" ? /^你是 Helm 调度者.*\n\n测试自定义策略\n\n/s : /^你是 Helm 执行者.*\n\n测试自定义策略\n\n/s);
        assert.match(args.options!.systemPrompt as string, /不推送、不部署/);
        if (role === 'executor') {
          assert.match(args.options!.systemPrompt as string, /HELM_PORT_START.*HELM_PORT_END/);
          assert.match(args.options!.systemPrompt as string, /submit-conclusion/);
          assert.match(args.options!.systemPrompt as string, /卡片说明快照/);
          assert.match(args.options!.systemPrompt as string, /browser\/<文件名>/);
          assert.match(args.options!.systemPrompt as string, /不要 git commit 或改 git 配置/);
          assert.match(args.options!.systemPrompt as string, /不要自己安装或启动浏览器/);
          assert.ok((args.options!.tools as string[]).includes('Write'));
        } else assert.deepEqual(args.options!.tools, ['Bash', 'Read', 'Grep', 'Glob', 'Skill']);
      }) });
    assert.equal((await collect(driver, options)).end?.reason, 'completed');
  }
});

test('Claude 调度者每轮新开只读会话，保留带轮次令牌的 MCP 与单次读取权限', async t => {
  const base = await fixture(t);
  const cwd = join(base.cwd, '_work');
  await mkdir(cwd);
  const options: SessionOptions = { ...base, cwd,
    agent: { ...new AgentCatalog(fixtureAgentDir).get('claude-coordinator'), model: 'haiku', reasoningEffort: 'low' },
    sandbox: { mode: 'read-only', writableRoots: [] },
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer round-token' } } },
  };
  let permission: CanUseTool | undefined;
  const driver = new ClaudeCoordinatorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
    query: fakeQuery([result()], args => {
      const sdk = args.options!;
      assert.equal(sdk.cwd, cwd);
      assert.deepEqual(sdk.settingSources, ['user', 'project', 'local']);
      assert.equal(sdk.permissionMode, 'default');
      assert.deepEqual(sdk.tools, ['Bash', 'Read', 'Grep', 'Glob', 'Skill']);
      assert.deepEqual(sdk.sandbox, {
        enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
        filesystem: { disabled: false, allowWrite: [], denyWrite: [cwd] }, network: { allowLocalBinding: true },
      });
      assert.equal(Object.hasOwn(sdk, 'strictMcpConfig'), false);
      assert.deepEqual(sdk.mcpServers, { helm: { type: 'http', ...options.mcpServers.helm } });
      assert.equal(sdk.env?.NO_PROXY, 'example.test,127.0.0.1,localhost');
      assert.equal(sdk.model, 'haiku');
      assert.equal(sdk.effort, 'low');
      assert.equal(sdk.resume, undefined);
      permission = sdk.canUseTool;
    }) });
  const first = await collect(driver, options);
  const next = await collect(driver, options);
  assert.notEqual(first.session.id, next.session.id);
  assert.equal(first.end?.reason, 'completed');
  assert.ok(permission);
  const context: Parameters<CanUseTool>[2] = { signal: new AbortController().signal, toolUseID: 'tool', requestId: 'request',
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'userSettings' }] };
  for (const tool of ['Bash', 'Read', 'Grep', 'Glob', 'mcp__helm__create-card', 'mcp__helm__create-dispatch', 'mcp__helm__add-dependency', 'mcp__user__query', 'mcp__other__write', 'Skill']) {
    const input = { command: 'cat README.md' };
    assert.deepEqual(await permission(tool, input, context), { behavior: 'allow', updatedInput: input });
  }
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Agent', 'Task', 'AskUserQuestion', 'ExitPlanMode']) {
    assert.equal((await permission(tool, { file_path: join(cwd, 'file') }, context))?.behavior, 'deny', tool);
  }
  assert.equal((await permission('Bash', { command: 'touch file', dangerouslyDisableSandbox: true }, context))?.behavior, 'deny');
  assert.equal((await permission('Bash', { command: 'touch file' }, { ...context, blockedPath: cwd }))?.behavior, 'deny');
  assert.equal((await permission('Read', {}, { ...context, signal: AbortSignal.abort() }))?.behavior, 'deny');
  for (const invalid of [
    { ...options, sandbox: { mode: 'workspace-write' as const, writableRoots: [cwd] } },
    { ...options, sandbox: { mode: 'read-only' as const, writableRoots: [cwd] } },
    { ...options, agent: base.agent },
    { ...options, resumeSessionId: 'previous-round' },
  ]) await assert.rejects(driver.start(invalid), /fresh read-only coordinator round/);
});

test('Claude 执行者组装本机 CLI、沙箱、单端点令牌、 Agent 和新开/续跑选项', async t => {
  const options = await fixture(t);
  for (const resumeSessionId of [undefined, 'previous-session']) {
    let requestedId: string | undefined;
    const driver = new ClaudeExecutorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
      query: fakeQuery([result()], args => {
        assert.equal(args.prompt, '派单内容');
        const sdk = args.options!;
        assert.equal(sdk.pathToClaudeCodeExecutable, '/test/bin/claude');
        assert.equal(sdk.cwd, options.cwd);
        assert.deepEqual(sdk.settingSources, ['user', 'project', 'local']);
        assert.deepEqual(sdk.settings, { autoMemoryEnabled: false, fastMode: false,
          permissions: { ask: ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'] } });
        assert.deepEqual(sdk.tools, ['Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite', 'Skill']);
        assert.equal(sdk.permissionMode, 'default');
        assert.deepEqual(sdk.sandbox, {
          enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
          filesystem: { disabled: false, allowWrite: [options.cwd] }, network: { allowLocalBinding: true },
        });
        assert.deepEqual(sdk.mcpServers, { helm: { type: 'http', ...options.mcpServers.helm } });
        assert.equal(Object.hasOwn(sdk, 'strictMcpConfig'), false);
        assert.equal(sdk.model, 'haiku');
        assert.equal(sdk.effort, 'low');
        assert.equal(sdk.env?.HELM_PORT_START, '4500');
        assert.equal(sdk.env?.NO_PROXY, 'example.test,127.0.0.1,localhost');
        assert.equal(sdk.env?.no_proxy, sdk.env?.NO_PROXY);
        assert.equal(sdk.resume, resumeSessionId);
        if (resumeSessionId) assert.equal(sdk.sessionId, undefined);
        else assert.match(sdk.sessionId!, /^[0-9a-f-]{36}$/);
        requestedId = sdk.resume ?? sdk.sessionId;
      }) });
    const { session, end } = await collect(driver, { ...options, resumeSessionId });
    assert.equal(session.id, requestedId);
    assert.equal(end?.reason, 'completed');
  }
  assert.equal(options.env.NO_PROXY, undefined, '不能修改运行层传入的环境');
});

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  test(`${role}: Claude 只凭 result 结束，记录原始输出、压缩通知和所有模型的 token（含缓存输入）`, async t => {
    const options = await fixture(t, role);
    const messages = [
      { type: 'assistant', message: { content: [{ type: 'text', text: '已完成，额度用完' }] } },
      { type: 'system', subtype: 'compact_boundary', compact_metadata: { trigger: 'auto', pre_tokens: 100 } },
      result(),
    ] as SDKMessage[];
    const { events, end } = await collect(new DriverType({ pathToClaudeCodeExecutable: '/test/bin/claude', query: fakeQuery(messages) }), options);
    assert.equal(events.filter(event => event.type === 'compaction').length, 1);
    assert.deepEqual(events.map(event => event.step), [1, 2, 3, 4, 5]);
    assert.deepEqual(events.filter(event => event.type === 'output').map(event => JSON.parse(event.text)), messages);
    assert.deepEqual(end, { type: 'end', step: 5, reason: 'completed', finalAnswer: '最终回答', usage: { inputTokens: 35, outputTokens: 5 } });
  });
}

test('Claude canUseTool 只单次批准副本内写入，拒绝路径穿越、符号链接越界及沙箱逃逸', async t => {
  const options = await fixture(t);
  const outside = await fixture(t);
  await symlink(outside.cwd, join(options.cwd, 'escape'));
  await symlink(join(outside.cwd, 'not-created'), join(options.cwd, 'dangling'));
  await mkdir(join(options.cwd, 'nested'));
  await symlink(join(options.cwd, 'nested'), join(options.cwd, 'safe-link'));
  let canUseTool: CanUseTool | undefined;
  await collect(new ClaudeExecutorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude',
    query: fakeQuery([result()], args => { canUseTool = args.options?.canUseTool; }) }), options);
  assert.ok(canUseTool);
  const permission = (extra: Partial<Parameters<CanUseTool>[2]> = {}): Parameters<CanUseTool>[2] => ({
    signal: new AbortController().signal, toolUseID: 'tool', requestId: 'request',
    suggestions: [{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'userSettings' }], ...extra,
  });
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit']) {
    const key = tool === 'NotebookEdit' ? 'notebook_path' : 'file_path';
    for (const path of ['new/deep/file.txt', join(options.cwd, 'inside.txt'), 'safe-link/new.txt']) {
      const input = { [key]: path };
      const decision = await canUseTool(tool, input, permission());
      assert.deepEqual(decision, { behavior: 'allow', updatedInput: input });
    }
    for (const path of [join(outside.cwd, 'outside.txt'), '../outside.txt', `${options.cwd}-sibling/file`,
      'escape/deep/file.txt', 'dangling', 'dangling/deep/file.txt', '', undefined]) {
      const decision = await canUseTool(tool, { [key]: path }, permission());
      assert.equal(decision?.behavior, 'deny', `${tool}: ${path}`);
    }
  }
  assert.equal((await canUseTool('Bash', { command: 'touch file', dangerouslyDisableSandbox: true }, permission()))?.behavior, 'deny');
  assert.equal((await canUseTool('Bash', { command: 'touch file' }, permission({ blockedPath: outside.cwd })))?.behavior, 'deny');
  for (const [tool, input] of [['Bash', { command: 'npm test' }], ['mcp__helm__submit-conclusion', { conclusion: 'completed' }]] as const) {
    assert.deepEqual(await canUseTool(tool, input, permission()), { behavior: 'allow', updatedInput: input });
  }
  assert.equal((await canUseTool('Write', { file_path: 'inside' }, permission({ signal: AbortSignal.abort() })))?.behavior, 'deny');
});

test('Claude 在 PATH 查找本机 CLI，拒绝缺失 CLI、只读角色和扩大的可写范围', async t => {
  const options = await fixture(t);
  const bin = join(options.cwd, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'claude');
  await writeFile(executable, '#!/bin/sh\nexit 0\n');
  await chmod(executable, 0o755);
  let path: string | undefined;
  await collect(new ClaudeExecutorDriver({ query: fakeQuery([result()], args => { path = args.options?.pathToClaudeCodeExecutable; }) }),
    { ...options, env: { PATH: bin } });
  assert.equal(path, executable);
  const driver = new ClaudeExecutorDriver({ query: fakeQuery([]) });
  await assert.rejects(driver.start({ ...options, env: { PATH: join(bin, 'missing') } }), /Local claude executable not found/);
  await assert.rejects(driver.start({ ...options, sandbox: { mode: 'read-only', writableRoots: [] } }), /executor card copy/);
  await assert.rejects(driver.start({ ...options, sandbox: { mode: 'workspace-write', writableRoots: [options.cwd, bin] } }), /only its card copy/);
});

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  test(`${role}: Claude 将订阅拒绝和结构化限额错误映射为额度用完，警告、预算和普通回答不误判`, async t => {
    const options = await fixture(t, role);
    const rejected = { type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } } as SDKMessage;
    const warning = { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } } as SDKMessage;
    const rateError = { type: 'assistant', error: 'rate_limit', message: { content: [] } } as unknown as SDKMessage;
    const ordinary = { type: 'assistant', message: { content: [{ type: 'text', text: "You've hit your limit" }] } } as SDKMessage;
    const error = result({ subtype: 'error_during_execution', is_error: true, errors: ['Request failed'] });
    const cases: { messages: SDKMessage[]; reason: string }[] = [
      { messages: [rejected, error], reason: 'quota-exhausted' },
      { messages: [rateError, error], reason: 'error' },
      { messages: [result({ subtype: 'success', is_error: true, result: "You've hit your limit · resets 3pm" })], reason: 'quota-exhausted' },
      { messages: [result({ subtype: 'error_during_execution', is_error: true, errors: ['Weekly usage limit reached'] })], reason: 'quota-exhausted' },
      { messages: [warning, error], reason: 'error' },
      { messages: [result({ subtype: 'error_max_budget_usd', is_error: true, errors: ['Max budget exceeded'] })], reason: 'error' },
      { messages: [result({ is_error: true, result: 'Authentication failed' })], reason: 'error' },
      { messages: [rejected, result()], reason: 'completed' },
      { messages: [ordinary, result()], reason: 'completed' },
    ];
    for (const { messages, reason } of cases) {
      const { end } = await collect(new DriverType({ pathToClaudeCodeExecutable: '/test/bin/claude', query: fakeQuery(messages) }), options);
      assert.equal(end?.reason, reason, JSON.stringify(messages));
      assert.deepEqual(end?.usage, { inputTokens: 35, outputTokens: 5 });
      assert.equal(end?.finalAnswer, reason === 'completed' ? '最终回答' : undefined);
    }
  });
}

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  test(`${role}: Claude 临时 429 留给 CLI 重试，只按最终 result 结束`, async t => {
    const options = await fixture(t, role);
    const sample = claudeErrors.find(sample => sample.name === 'transient 429')!;
    const diagnostic = { type: 'assistant', error: sample.error,
      message: { content: [{ type: 'text', text: sample.text }] } } as SDKMessage;
    const failure = result({ subtype: 'error_during_execution', is_error: true, errors: [sample.text] });
    for (const terminal of [failure, result()]) {
      const messages = [diagnostic, diagnostic, terminal];
      const { events, end } = await collect(new DriverType({ pathToClaudeCodeExecutable: '/test/bin/claude', query: fakeQuery(messages) }), options);
      assert.equal(end?.reason, terminal === failure ? 'error' : 'completed', sample.source);
      assert.equal(events.filter(event => event.type === 'end').length, 1);
      assert.deepEqual(events.filter(event => event.type === 'output').map(event => JSON.parse(event.text)), messages);
    }
  });
}

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  for (const sample of claudeErrors) {
    test(`${role}: Claude 真实错误样本 ${sample.name}`, async t => {
      const options = await fixture(t, role);
      const content = { content: [{ type: 'text', text: sample.text }] };
      const assistant = { type: 'assistant', error: sample.error, message: content } as SDKMessage;
      const ordinary = { type: 'assistant', message: content } as SDKMessage;
      const failure = result({ subtype: 'error_during_execution', is_error: true, errors: ['Request failed'] });
      const cases: { name: string; messages: SDKMessage[]; reason: string; answer?: string }[] = [
        { name: 'error result', messages: [result({ subtype: 'error_during_execution', is_error: true, errors: [sample.text] })], reason: sample.reason },
        { name: 'success subtype with is_error', messages: [result({ is_error: true, result: sample.text })], reason: sample.reason },
        { name: 'assistant diagnostic', messages: [assistant, failure], reason: sample.reason },
        { name: 'CLI recovered', messages: [assistant, result()], reason: 'completed', answer: '最终回答' },
        { name: 'ordinary assistant text', messages: [ordinary, failure], reason: 'error' },
        { name: 'successful answer quoting an error', messages: [result({ result: sample.text })], reason: 'completed', answer: sample.text },
      ];
      for (const { name, messages, reason, answer } of cases) {
        const { events, end } = await collect(new DriverType({ pathToClaudeCodeExecutable: '/test/bin/claude', query: fakeQuery(messages) }), options);
        assert.equal(end?.reason, reason, `${name}: ${sample.source}`);
        assert.equal(end?.finalAnswer, answer);
        assert.deepEqual(end?.usage, { inputTokens: 35, outputTokens: 5 });
        assert.deepEqual(events.filter(event => event.type === 'output').map(event => JSON.parse(event.text)), messages);
      }
    });
  }
}

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  test(`${role}: Claude 无 result 或 CLI 崩溃不能报告成功；结束和取消均关闭 SDK 查询流`, async t => {
    const options = await fixture(t, role);
    const config = { pathToClaudeCodeExecutable: '/test/bin/claude' };
    await assert.rejects(collect(new DriverType({ ...config, query: fakeQuery([
      { type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } } as SDKMessage,
    ]) }), options), /without a result/);
    await assert.rejects(collect(new DriverType({ ...config, query: () => ({
      close() {}, async *[Symbol.asyncIterator]() { throw new Error('Claude Code process exited with code 7'); },
    }) }), options), /exited with code 7/);
    let closed = false;
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const driver = new DriverType({ ...config, query: args => ({
      close() { closed = true; },
      async *[Symbol.asyncIterator]() {
        started();
        await new Promise<void>(resolve => args.options!.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
        throw new Error('Query aborted');
      },
    }) });
    const session = await driver.start(options);
    await session.send('派单');
    await assert.rejects(session.send('第二份输入'), /already received/);
    const pending = session.events[Symbol.asyncIterator]().next();
    await ready;
    session.cancel();
    assert.equal((await pending).done, true);
    assert.equal(closed, true);
    const beforeInput = await driver.start(options);
    beforeInput.cancel();
    assert.equal((await beforeInput.events[Symbol.asyncIterator]().next()).done, true);
    await assert.rejects(beforeInput.send('取消后'), /cancelled/);
    closed = false;
    await collect(new DriverType({ ...config, query: () => ({
      close() { closed = true; }, async *[Symbol.asyncIterator]() { yield result(); },
    }) }), options);
    assert.equal(closed, true);
  });
}

for (const [role, DriverType] of [['executor', ClaudeExecutorDriver], ['coordinator', ClaudeCoordinatorDriver]] as const) {
  test(`${role}: 运行层取消信号可在输入前或查询期间结束 Claude 会话`, async t => {
    const options = await fixture(t, role);
    for (const phase of ['before-start', 'before-input', 'query'] as const) {
      const controller = new AbortController();
      let closed = false;
      let ready!: () => void;
      const started = new Promise<void>(resolve => { ready = resolve; });
      const driver = new DriverType({ pathToClaudeCodeExecutable: '/test/bin/claude', query: args => ({
        close() { closed = true; },
        async *[Symbol.asyncIterator]() {
          ready();
          await new Promise<void>(resolve => args.options!.abortController!.signal.addEventListener('abort', () => resolve(), { once: true }));
        },
      }) });
      if (phase === 'before-start') {
        controller.abort();
        await assert.rejects(driver.start({ ...options, signal: controller.signal }), { name: 'AbortError' });
        continue;
      }
      const session = await driver.start({ ...options, signal: controller.signal });
      if (phase === 'before-input') {
        controller.abort();
        assert.equal((await session.events[Symbol.asyncIterator]().next()).done, true);
        await assert.rejects(session.send('取消后'), /cancelled/);
      } else {
        await session.send('运行中的验收');
        const pending = session.events[Symbol.asyncIterator]().next();
        await started;
        controller.abort();
        assert.equal((await pending).done, true);
        assert.equal(closed, true);
      }
    }
  });
}

test('Claude 进程组登记接入验收收尾：正常、额度用完、看门狗和暂停都先杀进程再重置', async t => {
  for (const mode of ['completed', 'quota-exhausted', 'timed-out', 'pause-card'] as const) await t.test(mode, async t => {
    const evidence = (await fixture(t)).cwd;
    let group = 0;
    let descendant = 0;
    let envRange: { start: number; end: number } | undefined;
    let closed = false;
    t.after(() => { if (group) try { process.kill(-group, 'SIGKILL'); } catch {} });
    const driver = new ClaudeExecutorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude', query: args => ({
      close() { closed = true; },
      async *[Symbol.asyncIterator]() {
        const sdk = args.options!;
        envRange = { start: Number(sdk.env!.HELM_PORT_START), end: Number(sdk.env!.HELM_PORT_END) };
        const file = join(sdk.cwd!, 'index.html');
        // Use the production SDK spawn hook with Node instead of Claude. Both
        // processes leave the copy, so only the registered group can find them.
        const child = sdk.spawnClaudeCodeProcess!({ command: process.execPath, args: ['-e', `
          const fs = require('fs');
          const child = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: '/', stdio: 'ignore' });
          fs.writeFileSync(${JSON.stringify(file)}, 'temporary SDK edit');
          process.on('SIGTERM', () => {
            fs.writeFileSync(${JSON.stringify(join(evidence, 'terminated.txt'))}, fs.readFileSync(${JSON.stringify(file)}, 'utf8'));
            process.exit(0);
          });
          process.chdir('/');
          console.log(process.pid + ':' + child.pid);
          setInterval(() => {}, 1000);
        `], cwd: sdk.cwd, env: sdk.env!, signal: new AbortController().signal });
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject);
          child.stdout.once('data', chunk => {
            [group, descendant] = String(chunk).trim().split(':').map(Number) as [number, number];
            resolve();
          });
        });
        const endpoint = sdk.mcpServers!.helm!;
        assert.ok('url' in endpoint);
        const client = new Client({ name: 'sdk-process-substitute', version: '1' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
          const conclusion = await client.callTool({ name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '提前通过' } });
          assert.equal((conclusion.structuredContent as any).ok, true);
          yield { type: 'system', subtype: 'compact_boundary' } as SDKMessage;
          if (mode === 'timed-out' || mode === 'pause-card') {
            await new Promise<void>(resolve => {
              const signal = sdk.abortController!.signal;
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
          } else yield mode === 'completed' ? result() : result({ subtype: 'error_during_execution', is_error: true, errors: ['Weekly usage limit reached'] });
        } finally { await client.close(); }
      },
    }) });
    const daemon = await dispatchFixture(t, [], { purpose: 'verification', executorDriver: driver,
      ...(mode === 'timed-out' ? { watchdog: { wallTimeoutMs: 1500, idleTimeoutMs: 10000 } } : {}) });
    if (mode === 'pause-card') {
      await until(daemon.events, events => events.some(event => event.action === 'conclusion-submitted'));
      const paused = await daemon.call('pause-card', { workId: daemon.work.id, cardId: daemon.dispatch.cardId });
      assert.equal(paused.result.status, 'paused');
    }
    const dispatch = await daemon.ended();
    assert.equal(dispatch.endReason, mode === 'pause-card' ? 'aborted' : mode, dispatch.failure);
    assert.equal(dispatch.conclusion, mode === 'completed' ? 'passed' : 'undeclared');
    assert.equal(dispatch.pgid, group);
    assert.ok(dispatch.processStartedAt);
    assert.deepEqual({ start: dispatch.portStart, end: dispatch.portEnd }, envRange);
    assert.equal(dispatch.endCommit, dispatch.startCommit);
    const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
    assert.equal(await readFile(join(card.workPath, 'index.html'), 'utf8'), '<h1>Helm browser dispatch</h1>');
    assert.equal(await readFile(join(evidence, 'terminated.txt'), 'utf8'), 'temporary SDK edit', '进程必须在 reset 前退出');
    assert.throws(() => process.kill(group, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
    const events = await daemon.events();
    const cleaned = events.find(event => event.action === 'dispatch-processes-cleaned');
    assert.ok(cleaned.details.pgids.includes(group));
    assert.ok(events.some(event => event.action === 'process-started' && event.details.pgid === group));
    assert.equal(closed, true);
    if (mode === 'quota-exhausted') {
      assert.equal((await daemon.call('get-work', { workId: daemon.work.id })).result.status, 'executing');
      assert.deepEqual(dispatch.usage, { inputTokens: 35, outputTokens: 5 });
    }
  });
});

test('假 SDK 查询流经真实派单端点提交结论、使用浏览器替身，HTTP 可读到 token 和压缩事件', async t => {
  for (const purpose of ['execution', 'verification'] as const) await t.test(purpose, async t => {
    const site = createServer((_request, response) => response.end('<h1>SDK browser substitute</h1>'));
    await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
    const address = site.address();
    assert.ok(address && typeof address !== 'string');
    const driver = new ClaudeExecutorDriver({ pathToClaudeCodeExecutable: '/test/bin/claude', query: args => ({
      close() {},
      async *[Symbol.asyncIterator]() {
        assert.equal(args.options!.resume, undefined);
        assert.ok(JSON.parse(String(args.prompt)).content.startsWith('卡片说明快照：'));
        await writeFile(join(args.options!.cwd!, 'index.html'), 'temporary SDK edit');
        const endpoint = args.options!.mcpServers!.helm;
        assert.ok(endpoint && 'url' in endpoint && endpoint.type === 'http');
        const client = new Client({ name: 'fake-sdk-query', version: '1' });
        try {
          await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers } }));
          const tools = (await client.listTools()).tools.map(tool => tool.name);
          assert.ok(tools.includes('submit-conclusion') && tools.includes('browser_navigate'));
          const navigation = await client.callTool({ name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } });
          assert.equal(navigation.isError, undefined);
          const snapshot = await client.callTool({ name: 'browser_snapshot', arguments: {} });
          assert.match(JSON.stringify(snapshot.content), /SDK browser substitute/);
          const conclusion = await client.callTool({ name: 'submit-conclusion', arguments: { conclusion: purpose === 'verification' ? 'passed' : 'completed', reason: 'SDK MCP round trip' } });
          assert.equal((conclusion.structuredContent as { ok: boolean }).ok, true);
          yield { type: 'system', subtype: 'compact_boundary' } as SDKMessage;
          yield result();
        } finally { await client.close(); }
      },
    }) });
    const daemon = await dispatchFixture(t, [], { purpose, needsBrowser: true, executorDriver: driver });
    const dispatch = await daemon.ended();
    assert.equal(dispatch.endReason, 'completed', dispatch.failure);
    assert.equal(dispatch.conclusion, purpose === 'verification' ? 'passed' : 'completed');
    assert.equal(dispatch.conclusionReason, 'SDK MCP round trip');
    assert.deepEqual(dispatch.usage, { inputTokens: 35, outputTokens: 5 });
    assert.ok((await daemon.events()).some(event => event.action === 'context-compacted' && event.dispatchId === dispatch.id));
    const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
    assert.equal(card.status, purpose === 'verification' ? 'verifying' : 'executing');
    assert.equal(await readFile(join(card.workPath, 'index.html'), 'utf8'), purpose === 'verification' ? '<h1>Helm browser dispatch</h1>' : 'temporary SDK edit');
    if (purpose === 'verification') assert.equal(dispatch.endCommit, dispatch.startCommit);
    else assert.notEqual(dispatch.endCommit, dispatch.startCommit);
    assert.deepEqual(card.usage, dispatch.usage);
    assert.deepEqual((await daemon.call('get-work', { workId: daemon.work.id })).result.usage, dispatch.usage);
  });
});

test('Claude 经 SDK supportedModels 列出模型和推理强度，default 记为 CLI 默认模型并关闭会话', async () => {
  let closed = 0;
  const driver = new ClaudeDriver({ pathToClaudeCodeExecutable: '/test/bin/claude', query: () => ({ close() { closed++; },
    async *[Symbol.asyncIterator]() {}, async supportedModels() { return [
      { value: 'default', displayName: 'Default', description: '', supportedEffortLevels: ['low', 'max'] },
      { value: 'haiku', displayName: 'Haiku', description: '' },
    ]; } }) });
  assert.deepEqual(await driver.listModels(), [
    { id: null, label: 'Default', efforts: ['low', 'max'], defaultEffort: null },
    { id: 'haiku', label: 'Haiku', efforts: [], defaultEffort: null },
  ]);
  assert.ok(closed >= 1);
});
