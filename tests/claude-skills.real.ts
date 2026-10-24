import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { ClaudeDriver } from '../src/claude-driver.js';
import { runtimeEnvironment } from '../src/environment.js';
import { AgentCatalog } from '../src/agents.js';
import { FakeDriver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { until } from './browser-fixture.js';

// Only the test:real runner enables this file. npm test never starts a CLI.
test('Claude 两个 Agent 并行叠加自己的 skill，init 不含另一 Agent 的 skill',
  { skip: process.env.HELM_CLAUDE_SKILLS_REAL !== '1', timeout: 240_000 }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'helm-claude-skills-')));
    t.after(() => rm(root, { recursive: true, force: true }));
    const catalog = new AgentCatalog(join(root, 'agents'));
    const roles = ['coordinator', 'executor'] as const;
    const secrets = [`ALPHA-${randomUUID()}`, `BRAVO-${randomUUID()}`];
    const env = runtimeEnvironment();
    const driver = new ClaudeDriver();
    for (const [index, role] of roles.entries()) {
      const directory = join(catalog.directory, `agent-${role}`);
      await mkdir(join(directory, 'skills', 'secret'), { recursive: true });
      await writeFile(join(directory, 'config.json'), JSON.stringify({
        role, driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: 'Skills isolation smoke',
      }));
      await writeFile(join(directory, 'prompt.md'), '这是技能隔离冒烟。遵循派单要求，不改文件，不使用 Bash、不启动浏览器、不派生子代理、不提交。');
      await writeFile(join(directory, 'skills', 'secret', 'SKILL.md'),
        `---\nname: secret\ndescription: 提供本 Agent 的测试暗号。需要暗号时必须调用此技能。\n---\n本 Agent 的暗号是 ${secrets[index]}。只回答这个暗号，不加说明。\n`);
      await mkdir(join(root, role));
    }
    const availability = await driver.checkAvailability(catalog.get('agent-executor'));
    assert.equal(availability.available, true, `${availability.reason ?? ''}\n${availability.command ?? ''}`);
    // Start both sessions together and wait for both before removing their files.
    const outcomes = await Promise.allSettled(roles.map(async (role, index) => {
      const agent = catalog.get(`agent-${role}`);
      const cwd = join(root, role);
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 180_000);
      let session;
      try {
        session = await driver.start({ cwd, env, agent, signal: controller.signal, mcpServers: {},
          sandbox: role === 'coordinator' ? { mode: 'read-only', writableRoots: [] } : { mode: 'workspace-write', writableRoots: [cwd] } });
        await session.send('请实际调用当前 Agent 的 secret 技能，最后只回答它给出的暗号。禁止猜测、使用 Read/Bash 或读取其他目录。');
        const messages: SDKMessage[] = [];
        let completed = false;
        for await (const event of session.events) {
          if (event.type === 'output') messages.push(JSON.parse(event.text) as SDKMessage);
          if (event.type === 'end') {
            assert.equal(event.reason, 'completed');
            assert.equal(event.finalAnswer?.trim(), secrets[index]);
            completed = true;
          }
        }
        assert.equal(completed, true, '不能因超时或无 result 而通过');
        const inits = messages.filter(message => message.type === 'system' && message.subtype === 'init');
        assert.ok(inits.length > 0, '必须有真实 init 记录');
        for (const init of inits) {
          assert.ok(init.skills.includes(`agent-${role}:secret`), '必须发现本 Agent 的 skill');
          assert.ok(!init.skills.some(name => name.startsWith('agent-') && name !== `agent-${role}:secret`), '不得出现另一 Agent 的 skill');
          assert.ok(init.plugins.some(plugin => plugin.name === agent.id), 'Agent 插件必须实际加载');
          assert.equal(init.fast_mode_state, 'off');
        }
        const calls = messages.flatMap(message => message.type === 'assistant' ? message.message.content
          .filter(block => block.type === 'tool_use').filter(block => block.name === 'Skill') : []);
        assert.ok(calls.length > 0, '必须实际调用 Skill，不能仅复述提示词');
        for (const call of calls) {
          assert.equal((call.input as { skill: string }).skill, `agent-${role}:secret`);
          assert.ok(messages.some(message => message.type === 'user' && Array.isArray(message.message.content)
            && message.message.content.some(block => block.type === 'tool_result' && block.tool_use_id === call.id && !block.is_error)),
          'Skill 调用必须成功');
        }
        t.diagnostic(`${agent.id}: init.skills=${JSON.stringify(inits[0]!.skills)}; Skill 调用及暗号通过`);
      } finally {
        clearTimeout(deadline);
        session?.cancel();
      }
    }));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  });

test('库 skill 与 HTTP、stdio MCP 经 Agent 引用后由真实 Claude 派单加载并调用，保留全局重名警告验证',
  { skip: process.env.HELM_CLAUDE_SKILLS_REAL !== '1', timeout: 240_000 }, async t => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'helm-library-claude-')));
    let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
    t.after(async () => { await daemon?.close(); await rm(root, { recursive: true, force: true }); });
    const secret = `LIBRARY-${randomUUID()}`;
    const mcpSecret = `MCP-${randomUUID()}`;
    const stdioSecret = `STDIO-${randomUUID()}`;
    const authorization = `Bearer ${randomUUID()}`;
    let probeCalls = 0;
    const probe = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.headers.authorization !== authorization) {
        response.writeHead(401).end();
        return;
      }
      const server = new Server({ name: 'library-probe', version: '1.0.0' }, { capabilities: { tools: {} } });
      server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
        { name: 'read_secret', description: '返回本次库 HTTP MCP 冒烟暗号', inputSchema: { type: 'object', properties: {} } },
      ] }));
      server.setRequestHandler(CallToolRequestSchema, async request => {
        assert.equal(request.params.name, 'read_secret');
        probeCalls++;
        return { content: [{ type: 'text', text: mcpSecret }] };
      });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      response.once('close', () => { void server.close(); });
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of request) chunks.push(chunk);
        await server.connect(transport);
        await transport.handleRequest(request, response, JSON.parse(Buffer.concat(chunks).toString()));
      } catch (error) {
        t.diagnostic(`库 HTTP MCP 冒烟端点出错：${String(error)}`);
        if (!response.headersSent) response.writeHead(500).end(); else response.destroy();
      }
    });
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise<void>((resolve, reject) => {
      probe.closeAllConnections();
      probe.close(error => error ? reject(error) : resolve());
    }));
    const address = probe.address();
    assert.ok(address && typeof address !== 'string');
    const source = join(root, 'helm-library-probe');
    await mkdir(source);
    await writeFile(join(source, 'SKILL.md'),
      `---\nname: helm-library-probe\ndescription: 返回本次库 skill 冒烟的暗号。需要暗号时必须调用此技能。\n---\n本技能的暗号为 ${secret}。按派单指定格式回答。\n`);
    const repo = join(root, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    await writeFile(join(repo, 'README.md'), '库 skill 冒烟');
    execFileSync('git', ['-C', repo, 'add', 'README.md']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
    const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
    const coordinator = new FakeDriver([ctx => [{ type: 'tool', name: 'draft-work-description',
      arguments: { workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: '加载库 skill', boundary: '不改文件', criteria: '返回 skill 中的暗号' }, check: ok }],
    ctx => [
      { type: 'tool', name: 'create-card', arguments: { workId: JSON.parse(ctx.input).work.id, key: 'probe', content: '实际调用 helm-library-probe 技能、library-probe MCP 和 stdio-probe MCP 的 read_secret 工具。最后只回答三行：第一行是 skill 暗号，第二行是 HTTP MCP 暗号，第三行是 stdio MCP 暗号。禁止猜测、使用 Read/Bash、修改文件或派生子代理。' }, saveAs: 'card', check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
        cardId: (ctx.results.get('card') as any).result.id, key: 'probe', agentId: 'library-executor' }), check: ok },
    ]]);
    const claude = new ClaudeDriver();
    daemon = await startHelmd({ port: 0, dataDir: join(root, 'data'), drivers: { 'claude-sdk': {
      checkAvailability: agent => agent.role === 'coordinator' ? coordinator.checkAvailability(agent) : claude.checkAvailability(agent),
      start: options => (options.agent.role === 'coordinator' ? coordinator : claude).start(options),
    } } });
    const call = async (name: string, params = {}): Promise<any> => {
      const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) });
      const value = await response.json() as any;
      ok(value);
      return value.result;
    };
    await call('install-skill', { path: source });
    await call('register-mcp', { name: 'library-probe', config: { type: 'http', url: `http://127.0.0.1:${address.port}/mcp`, headers: { Authorization: authorization } } });
    await call('register-mcp', { name: 'stdio-probe', config: { type: 'stdio', command: process.execPath,
      args: [fileURLToPath(new URL('./fixtures/library-stdio-mcp.js', import.meta.url)), 'library-smoke'],
      env: { HELM_LIBRARY_MCP_SECRET: stdioSecret } } });
    for (const role of ['coordinator', 'executor']) {
      const agent = await call('save-agent', { id: `library-${role}`, mode: 'create', prompt: '不改文件，不使用 Bash，不启动浏览器，不派生子代理，不提交。',
        config: { role, driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', home: 'shared', description: '库 skill 冒烟',
          skills: role === 'executor' ? ['helm-library-probe'] : [], mcp: role === 'executor' ? ['library-probe', 'stdio-probe'] : [] } });
      assert.equal(agent.available, true, agent.reason ?? 'Agent 不可用');
    }
    // Construct the warning in a temporary HOME without changing the user's global skills.
    // Restore the host HOME before the real CLI checks login or starts a dispatch.
    const globalHome = join(root, 'global-home');
    await mkdir(join(globalHome, '.claude', 'skills', 'helm-library-probe'), { recursive: true });
    const previousHome = process.env.HOME;
    try {
      process.env.HOME = globalHome;
      const catalog = new AgentCatalog(join(root, 'data', 'agents'));
      const agent = catalog.list().find(agent => agent.id === 'library-executor');
      assert.ok(agent);
      assert.equal(agent.available, true);
      assert.equal(agent.warnings.length, 1);
      assert.match(agent.warnings[0]!, /helm-library-probe.*全局.*同名/);
      assert.equal(catalog.get('library-executor', 'executor').id, 'library-executor');
    } finally {
      if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    }
    const project = await call('register-project', { path: repo });
    await call('set-project-coordinator-agent', { projectId: project.id, agentId: 'library-coordinator' });
    const { work } = await call('send-message', { projectId: project.id, key: 'start', body: '加载库 skill' });
    const pending = await until(() => call('list-pending'), gates => gates.some((gate: any) => gate.descriptionId));
    const gate = pending.find((gate: any) => gate.kind === 'work-confirmation');
    await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.descriptionId, decision: 'confirm' });
    const dispatches = await until(() => call('list-dispatches', { workId: work.id }), values => values.length === 1 && values[0].status === 'ended', 180_000);
    const dispatch = dispatches[0];
    assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? '派单未正常结束');
    assert.equal(dispatch.finalAnswer?.trim(), `${secret}\n${mcpSecret}\n${stdioSecret}`);
    assert.ok(probeCalls > 0, '必须带登记的请求头实际调用库 HTTP MCP');
    assert.equal(dispatch.agent.skillsPath, join(dirname(dispatch.outputPath), 'skills'));
    assert.ok((await readFile(join(dispatch.agent.skillsPath, 'helm-library-probe', 'SKILL.md'), 'utf8')).includes(secret));
    const output = await call('get-dispatch-output', { workId: work.id, dispatchId: dispatch.id });
    const messages: SDKMessage[] = output.filter((event: any) => event.type === 'output').map((event: any) => JSON.parse(event.text));
    const init = messages.find(message => message.type === 'system' && message.subtype === 'init');
    assert.ok(init && init.type === 'system' && init.subtype === 'init', '须保留真实 init');
    const skill = init.skills.find(name => name.endsWith(':helm-library-probe'));
    assert.ok(skill, JSON.stringify(init.skills));
    assert.ok(init.plugins.some(plugin => plugin.path === dirname(dispatch.agent.skillsPath)), '须加载派单目录中的插件');
    const calls = messages.flatMap(message => message.type === 'assistant' ? message.message.content
      .filter(block => block.type === 'tool_use').filter(block => block.name === 'Skill' && (block.input as { skill: string }).skill === skill) : []);
    assert.ok(calls.length > 0, '须实际调用库 skill');
    assert.ok(calls.some(call => messages.some(message => message.type === 'user' && Array.isArray(message.message.content)
      && message.message.content.some(block => block.type === 'tool_result' && block.tool_use_id === call.id && !block.is_error))), '库 Skill 调用须成功');
    assert.ok(init.mcp_servers.some(server => server.name === 'library-probe' && server.status === 'connected'), '库 HTTP MCP 须实际连接');
    assert.ok(messages.some(message => message.type === 'assistant' && message.message.content.some(block =>
      block.type === 'tool_use' && block.name === 'mcp__library-probe__read_secret')), '须保留实际库 MCP 工具调用');
    assert.ok(init.mcp_servers.some(server => server.name === 'stdio-probe' && server.status === 'connected'), '库 stdio MCP 须实际连接');
    const stdioCalls = messages.flatMap(message => message.type === 'assistant' ? message.message.content
      .filter(block => block.type === 'tool_use').filter(block => block.name === 'mcp__stdio-probe__read_secret') : []);
    assert.ok(stdioCalls.length > 0, '须保留实际库 stdio MCP 工具调用');
    assert.ok(stdioCalls.some(call => messages.some(message => message.type === 'user' && Array.isArray(message.message.content)
      && message.message.content.some(block => block.type === 'tool_result' && block.tool_use_id === call.id && !block.is_error
        && JSON.stringify(block.content).includes(stdioSecret)))), 'stdio MCP 调用须成功返回环境变量中的暗号');
    t.diagnostic(`库 skill ${skill} 和 HTTP、stdio MCP 已由真实 Claude 派单加载并调用，三份暗号验证通过`);
  });
