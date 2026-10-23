// Explicitly run outside the agent sandbox: npm run test:claude-coordinator.
// Requires a locally logged-in claude CLI. No browser is started.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { query, type PermissionResult, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver } from '../src/claude-driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { fixture, until } from './claude-coordinator-fixture.js';
import { assertIsolatedInitialization, helmToolNames } from './claude-init.js';

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
    const brief = JSON.parse(args.prompt as string) as StartupBrief;
    assert.equal(sdk.model, 'haiku');
    assert.equal(sdk.effort, 'low');
    assert.equal(sdk.cwd, brief.work.workPath);
    assert.ok(sdk.cwd!.endsWith('/_work'));
    assert.deepEqual(sdk.settingSources, []);
    assert.deepEqual(sdk.sandbox?.filesystem, { allowWrite: [], denyWrite: [sdk.cwd] });
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
  assertIsolatedInitialization(round.messages, 'coordinator', round.helmTools);
  const servers = round.messages.flatMap(message => message.type === 'system' && message.subtype === 'init' ? message.mcp_servers : []);
  assert.ok(!servers.some(server => server.status === 'needs-auth'),
    'needs-auth reproduced: replace per-round HTTP injection with the specified token-preserving stdio forwarder before accepting this smoke');
  assert.ok(servers.some(server => server.name === 'helm' && server.status === 'connected'), JSON.stringify(servers));
}

function successfulTool(round: Observation, name: string, count: number) {
  const calls = toolCalls(round.messages).filter(call => call.name === `mcp__helm__${name}`);
  assert.equal(calls.length, count, `必须实际调用 ${name} ${count} 次`);
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
      const observed = observedDriver(brief => `这是调度者驱动冒烟，workId 为 ${brief.work.id}。${restrictions}
按顺序调用：
1. create-card，key=smoke-upstream，content=上游卡片。
2. create-card，key=smoke-downstream，content=下游卡片。
3. add-dependency，上游为第一张卡片，下游为第二张卡片（节点 type 均为 card）。
4. remove-dependency，删除同一条依赖。
5. add-dependency，重新加回同一条依赖。
6. create-dispatch，key=smoke-dispatch，cardId 为上游卡片 id，templateId=claude-executor，purpose=execution，needsBrowser=false。
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
    const observed = observedDriver(brief => `这是事件重投冒烟，workId 为 ${brief.work.id}。${restrictions}
无论启动简报中是否已经存在对象，都必须实际按顺序重放以下两个工具调用：
1. create-card，key=replay-card，content=重投卡片。
2. create-dispatch，key=replay-dispatch，cardId 用上一步返回的卡片 id，templateId=claude-executor，purpose=execution，needsBrowser=false。
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
