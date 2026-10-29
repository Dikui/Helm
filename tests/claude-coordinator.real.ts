// Explicitly run outside the agent sandbox: npm run test:claude-coordinator.
// Requires Claude login in a disposable HOME. No browser is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { query, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver } from '../src/claude-driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { fixture, until } from './claude-coordinator-fixture.js';
import { assertInitialization, helmToolNames } from './claude-init.js';

const enabled = process.env.HELM_CLAUDE_COORDINATOR_REAL === '1';
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

function toolCalls(messages: SDKMessage[]) {
  return messages.flatMap(message => message.type === 'assistant'
    ? message.message.content.filter(block => block.type === 'tool_use') : []);
}

function toolResult(messages: SDKMessage[], id: string) {
  return messages.flatMap(message => message.type === 'user' && Array.isArray(message.message.content)
    ? message.message.content : []).filter(block => block.type === 'tool_result')
    .find(block => block.tool_use_id === id);
}

interface Observation {
  brief: StartupBrief; sessionId: string; token: string; endpoint: string; holding: boolean;
  messages: SDKMessage[]; helmTools: string[];
  permissions: { tool: string; input: Record<string, unknown>; behavior: PermissionResult['behavior'] }[];
}

// Keep the real CLI, tools and messages. The optional hold stops consumption
// after a successful real dispatch tool result, before accepting SDK result,
// so the user interrupt deterministically happens during the first round.
function observedDriver(instructions: (brief: StartupBrief, attempt: number) => string, holdFirst = false) {
  const rounds: Observation[] = [];
  const driver = new ClaudeCoordinatorDriver({ query: args => {
    const sdk = args.options!;
    assert.equal(Object.hasOwn(sdk.env!, 'CLAUDE_CONFIG_DIR'), false);
    const brief = JSON.parse(args.prompt as string) as StartupBrief;
    assert.equal(sdk.model, 'haiku');
    assert.equal(sdk.effort, 'low');
    assert.equal(sdk.cwd, brief.work.workPath);
    assert.ok(sdk.cwd!.endsWith('/_work'));
    assert.deepEqual(sdk.settingSources, []);
    assert.equal(sdk.strictMcpConfig, true);
    assert.deepEqual(sdk.sandbox?.filesystem, { disabled: false, allowWrite: [], denyWrite: [sdk.cwd] });
    assert.deepEqual(Object.keys(sdk.mcpServers ?? {}), ['helm']);
    const endpoint = sdk.mcpServers!.helm!;
    assert.ok('url' in endpoint && endpoint.type === 'http');
    assert.match(endpoint.headers?.Authorization ?? '', /^Bearer .+/);
    const record: Observation = { brief, sessionId: sdk.sessionId!, token: endpoint.headers!.Authorization!,
      endpoint: endpoint.url, holding: false, messages: [], helmTools: [], permissions: [] };
    const attempt = rounds.push(record);
    const canUseTool = sdk.canUseTool!;
    const stream = query({ ...args, prompt: `${instructions(brief, attempt)}\n\n启动简报：\n${args.prompt}`, options: { ...sdk, maxTurns: 16,
      canUseTool: async (tool, input, context) => {
        const decision = await canUseTool(tool, input, context);
        assert.ok(decision);
        if (decision.behavior === 'allow') assert.equal(decision.updatedPermissions, undefined);
        record.permissions.push({ tool, input, behavior: decision.behavior });
        return decision;
      },
    } });
    const signal = sdk.abortController!.signal;
    const deadline = setTimeout(() => sdk.abortController!.abort(), 150_000);
    return {
      close() { clearTimeout(deadline); stream.close(); },
      async *[Symbol.asyncIterator]() {
        try {
          record.helmTools = await helmToolNames(endpoint);
          for await (const message of stream) {
            record.messages.push(message);
            yield message;
            const dispatch = toolCalls(record.messages).find(call => call.name === 'mcp__helm__create-dispatch');
            const result = dispatch && toolResult(record.messages, dispatch.id);
            if (holdFirst && attempt === 1 && result && !result.is_error) {
              record.holding = true;
              await new Promise<void>(resolve => {
                if (signal.aborted) resolve();
                else signal.addEventListener('abort', () => resolve(), { once: true });
              });
              return;
            }
          }
        } finally { clearTimeout(deadline); stream.close(); }
      },
    };
  } });
  return { driver, rounds };
}

function connected(round: Observation) {
  assertInitialization(round.messages, 'coordinator', round.helmTools);
  const servers = round.messages.flatMap(message => message.type === 'system' && message.subtype === 'init' ? message.mcp_servers : []);
  assert.ok(!servers.some(server => server.name === 'helm' && server.status === 'needs-auth'),
    'needs-auth reproduced: replace per-round HTTP injection with the specified token-preserving stdio forwarder before accepting this smoke');
  assert.ok(servers.some(server => server.name === 'helm' && server.status === 'connected'), JSON.stringify(servers));
  // ADR 0014: the user's global plugins and connectors stay out of the coordinator's context.
  assert.deepEqual(servers.map(server => server.name), ['helm']);
  const plugins = round.messages.flatMap(message => message.type === 'system' && message.subtype === 'init' ? message.plugins : []);
  assert.ok(plugins.every(plugin => !plugin.path.startsWith(join(homedir(), '.claude'))), JSON.stringify(plugins));
}

function successfulTool(round: Observation, name: string, count: number) {
  const calls = toolCalls(round.messages).filter(call => call.name === `mcp__helm__${name}`);
  // Models sometimes repeat a successful call; the final graph checks catch any extra call that changed state.
  assert.ok(calls.length >= count, `必须实际调用 ${name} 至少 ${count} 次，实际 ${calls.length} 次`);
  for (const call of calls) {
    const result = toolResult(round.messages, call.id);
    assert.ok(result && !result.is_error, `${name} 未成功`);
    assert.ok(result.content);
    const text = typeof result.content === 'string' ? result.content
      : result.content.filter(block => block.type === 'text').map(block => block.text).join('\n');
    assert.match(text, /"ok"\s*:\s*true/);
  }
}

const restrictions = '只用当前 helm MCP 端点和指定工具；不启动浏览器、不安装、不派生子代理、不推送、不部署。工具失败就停止并报告，不寻找绕过方法。';

test('冒烟①⑤：三轮真实调度者在 _work 经带令牌 HTTP MCP 建卡、改依赖、派单，无 needs-auth 且记录 token',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const sessions: string[] = [];
    const tokens: string[] = [];
    for (const index of [1, 2, 3]) await t.test(`新会话 ${index}`, async subtest => {
      const observed = observedDriver(() => `这是调度者驱动冒烟，工作由轮次令牌确定，MCP 调用不传 workId。${restrictions}
按顺序调用：
1. create-card，key=smoke-upstream，content=上游卡片。
2. create-card，key=smoke-downstream，content=下游卡片。
3. add-dependency，上游为第一张卡片，下游为第二张卡片（节点 type 均为 card）。
4. remove-dependency，删除同一条依赖。
5. add-dependency，重新加回同一条依赖。
6. create-dispatch，key=smoke-dispatch，cardId 为上游卡片 id，agentId=claude-executor，purpose=execution，needsBrowser=false。
每个步骤必须实际成功，最后简短回答后退出。`);
      const daemon = await fixture(subtest, observed.driver);
      const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length >= 2, 180_000);
      const end = events.filter(event => event.action === 'round-ended')[1]!;
      assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
      assert.equal(end.details.processed, true);
      assert.ok(end.details.usage.inputTokens > 0 && end.details.usage.outputTokens > 0);
      assert.equal(observed.rounds.length, 1);
      const round = observed.rounds[0]!;
      connected(round);
      for (const [name, count] of [['create-card', 2], ['add-dependency', 2], ['remove-dependency', 1], ['create-dispatch', 1]] as const) successfulTool(round, name, count);
      const cards = (await daemon.call('get-card-graph', daemon.params)).filter((node: any) => node.type === 'card');
      assert.equal(cards.length, 2);
      const upstream = cards.find((card: any) => card.key === 'smoke-upstream');
      const downstream = cards.find((card: any) => card.key === 'smoke-downstream');
      assert.equal(downstream.status, 'waiting');
      assert.deepEqual(downstream.dependencies, [{ type: 'card', id: upstream.id }]);
      const dispatches = await daemon.call('list-dispatches', daemon.params);
      assert.equal(dispatches.length, 1);
      assert.equal(dispatches[0].cardId, upstream.id);
      assert.equal(dispatches[0].key, 'smoke-dispatch');
      assert.equal(events.filter(event => event.action === 'card-created').length, 2);
      assert.equal(events.filter(event => event.action === 'dispatch-created').length, 1);
      assert.equal(await readFile(join(daemon.work.workPath, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
      sessions.push(round.sessionId);
      tokens.push(round.token);
    });
    assert.equal(new Set(sessions).size, 3);
    assert.equal(new Set(tokens).size, 3);
  });

test('冒烟②：真实调度者操作后被用户打断，新轮次重投同批事件，用原 key 不重复建卡和派单',
  { skip: !enabled, timeout: 420_000 }, async t => {
    const observed = observedDriver(() => `这是事件重投冒烟，工作由轮次令牌确定，MCP 调用不传 workId。${restrictions}
无论启动简报中是否已经存在对象，都必须实际按顺序重放以下两个工具调用：
1. create-card，key=replay-card，content=重投卡片。
2. create-dispatch，key=replay-dispatch，cardId 用上一步返回的卡片 id，agentId=claude-executor，purpose=execution，needsBrowser=false。
必须使用上述原样 key，禁止换 key 或另外新建；调用完成后简短回答并退出。`, true);
    const daemon = await fixture(t, observed.driver, 2);
    await until(async () => observed.rounds[0]?.holding ?? false, Boolean, 180_000);
    const before = await daemon.events();
    const firstStart = before.filter(event => event.action === 'round-started')[1]!;
    assert.ok(firstStart);
    assert.equal(before.some(event => event.action === 'round-ended' && event.object.id === firstStart.object.id), false);
    const cardId = (await daemon.call('get-card-graph', daemon.params)).find((node: any) => node.type === 'card').id;
    const dispatchId = (await daemon.call('list-dispatches', daemon.params))[0].id;
    await daemon.call('send-message', { ...daemon.params, key: 'interrupt-message', body: '请重投同一批事件并复用原 key' });
    await daemon.call('interrupt-round', daemon.params);
    const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length >= 3, 180_000);
    const ends = events.filter(event => event.action === 'round-ended');
    assert.equal(ends[1]!.details.reason, 'aborted');
    assert.equal(ends[1]!.details.abortReason, '用户打断');
    assert.equal(ends[1]!.details.processed, false);
    assert.equal(ends[2]!.details.reason, 'completed', JSON.stringify(ends[2]!.details));
    assert.equal(ends[2]!.details.processed, true);
    assert.equal(observed.rounds.length, 2);
    const [first, replay] = observed.rounds as [Observation, Observation];
    for (const round of [first, replay]) {
      connected(round);
      successfulTool(round, 'create-card', 1);
      successfulTool(round, 'create-dispatch', 1);
    }
    assert.notEqual(first.sessionId, replay.sessionId);
    assert.notEqual(first.token, replay.token);
    assert.equal(first.endpoint, replay.endpoint);
    for (const event of first.brief.wakeEvents) assert.ok(replay.brief.wakeEvents.some(item => item.id === event.id));
    assert.ok(replay.brief.wakeEvents.some(event => (event.details as any).body === '请重投同一批事件并复用原 key'));
    const cards = (await daemon.call('get-card-graph', daemon.params)).filter((node: any) => node.type === 'card');
    assert.deepEqual(cards.map((card: any) => card.id), [cardId]);
    assert.deepEqual((await daemon.call('list-dispatches', daemon.params)).map((dispatch: any) => dispatch.id), [dispatchId]);
    assert.equal(events.filter(event => event.action === 'card-created').length, 1);
    assert.equal(events.filter(event => event.action === 'dispatch-created').length, 1);
    for (const round of [first, replay]) {
      const response = await fetch(`${daemon.url}/api/get-work`, { method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: round.token }, body: JSON.stringify(daemon.params) });
      assert.equal(response.status, 401, '结束/打断后的轮次令牌必须失效');
    }
  });

test('冒烟③调度者：_work 内 Bash 写入被真实沙箱拦截，读取正常且项目代码不变',
  { skip: !enabled, timeout: 240_000 }, async t => {
    let command = '';
    const observed = observedDriver(brief => {
      command = `printf forbidden > ${shellQuote(join(brief.work.workPath!, 'coordinator-write.txt'))}`;
      return `这是只读沙箱冒烟。${restrictions}
1. 必须用 Bash 原样尝试一次：${command}
预期写入被沙箱拦下。禁止使用 dangerouslyDisableSandbox，禁止重试或其他写法。
2. 拒绝是预期结果，继续用 Read 读取当前 _work 的 README.md。
3. 简短回答实际读到的内容和写入错误，然后退出。`;
    });
    const daemon = await fixture(t, observed.driver);
    const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length >= 2, 180_000);
    const end = events.filter(event => event.action === 'round-ended')[1]!;
    assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
    assert.equal(observed.rounds.length, 1);
    const round = observed.rounds[0]!;
    connected(round);
    const bash = toolCalls(round.messages).find(call => call.name === 'Bash' && (call.input as any).command === command);
    assert.ok(bash, '必须实际尝试 _work 内 Bash 写入');
    const denied = toolResult(round.messages, bash.id);
    assert.equal(denied?.is_error, true);
    assert.match(JSON.stringify(denied.content), /operation not permitted|permission denied|read-only file system|sandbox/i);
    assert.ok(!round.permissions.some(item => item.tool === 'Bash' && item.input.command === command && item.behavior === 'deny'), '写入必须由真实沙箱拒绝');
    await assert.rejects(readFile(join(daemon.work.workPath, 'coordinator-write.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(daemon.work.workPath, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
    const read = toolCalls(round.messages).find(call => call.name === 'Read');
    assert.ok(read);
    const readResult = toolResult(round.messages, read.id);
    assert.ok(readResult && !readResult.is_error);
    assert.match(JSON.stringify(readResult.content), /coordinator read-only baseline/);
    assert.equal(daemon.git('-C', daemon.work.workPath, 'status', '--porcelain'), '');
  });

test('冒烟④：创建后首个真实对齐轮次只读工作副本，项目切分支和改文件不影响它，确认跟上基准',
  { skip: !enabled, timeout: 240_000 }, async t => {
    const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    const command = 'printf forbidden > alignment-write.txt';
    let project = '';
    const observed = observedDriver(brief => {
      assert.equal(brief.work.status, 'aligning');
      assert.equal(brief.work.activeDescriptionId, null);
      assert.equal(brief.work.baseRef, 'main');
      assert.equal(git(brief.work.workPath!, 'branch', '--show-current'), brief.work.workBranch);
      project = git(brief.work.workPath!, 'worktree', 'list', '--porcelain').split('\n')[0]!.slice('worktree '.length);
      // Change the user's checkout after the copy exists, before the CLI reads it.
      git(project, 'checkout', '-b', 'user-switched');
      writeFileSync(join(project, 'README.md'), 'user checkout modified during alignment\n');
      writeFileSync(join(project, 'uncommitted.txt'), 'must not enter the copy\n');
      return `这是创建工作时的对齐副本冒烟。${restrictions}
1. 用 Bash 执行 pwd，再用 Bash 执行 git branch --show-current。
2. 用 Read 读取当前目录的 README.md。
3. 必须用 Bash 原样尝试一次：${command}
预期写入被沙箱拒绝；禁止 dangerouslyDisableSandbox、重试或其他写法。拒绝后继续。
4. 调用 draft-work-description，key=alignment-copy，requirements=只读工作副本，boundary=临时项目，criteria=读取创建时的代码且不能写入。
然后简短回答读到的内容并退出。`;
    });
    const daemon = await fixture(t, observed.driver, 1, { realFirstRound: true, roundTimeout: 180_000 });
    const events = await daemon.events();
    const end = events.find(event => event.action === 'round-ended')!;
    assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
    const round = observed.rounds[0]!;
    connected(round);
    const calls = toolCalls(round.messages);
    // The model may chain pwd with the next command; the output check below still pins the cwd.
    const pwd = calls.find(call => call.name === 'Bash' && /\bpwd\b/.test(String((call.input as any).command)));
    assert.ok(pwd, '真实 CLI 必须报告 cwd');
    assert.ok(JSON.stringify(toolResult(round.messages, pwd.id)?.content).includes(round.brief.work.workPath!));
    const read = calls.find(call => call.name === 'Read' && String((call.input as any).file_path).endsWith('README.md'));
    assert.ok(read);
    const content = toolResult(round.messages, read.id);
    assert.ok(content && !content.is_error);
    assert.match(JSON.stringify(content.content), /coordinator read-only baseline/);
    assert.doesNotMatch(JSON.stringify(content.content), /user checkout modified/);
    const write = calls.find(call => call.name === 'Bash' && (call.input as any).command === command);
    assert.ok(write);
    const denied = toolResult(round.messages, write.id);
    assert.equal(denied?.is_error, true);
    assert.match(JSON.stringify(denied.content), /operation not permitted|permission denied|read-only file system|sandbox/i);
    assert.ok(!round.permissions.some(item => item.tool === 'Bash' && item.input.command === command && item.behavior === 'deny'));
    assert.equal(existsSync(join(daemon.work.workPath, 'alignment-write.txt')), false);
    assert.equal(existsSync(join(daemon.work.workPath, 'uncommitted.txt')), false);
    successfulTool(round, 'draft-work-description', 1);

    const original = daemon.work.baseCommit;
    const latest = git(project, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit-tree', `${original}^{tree}`, '-p', original, '-m', 'advance base');
    git(project, 'update-ref', 'refs/heads/main', latest, original);
    const gate = (await daemon.call('list-pending')).find((item: any) => item.workId === daemon.work.id);
    const confirmed = await daemon.call('decide-gate', { ...daemon.params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
    assert.equal(confirmed.baseCommit, latest);
    assert.equal(git(daemon.work.workPath, 'rev-parse', 'HEAD'), latest);
    assert.equal(git(project, 'branch', '--show-current'), 'user-switched');
    assert.equal(await readFile(join(project, 'README.md'), 'utf8'), 'user checkout modified during alignment\n');
  });
