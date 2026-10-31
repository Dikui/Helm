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
import { credentialPaths } from '../src/driver.js';
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
  brief: StartupBrief; cwd: string; sessionId: string; resumeSessionId?: string; token: string; endpoint: string; holding: boolean;
  messages: SDKMessage[]; helmTools: string[];
  permissions: { tool: string; input: Record<string, unknown>; behavior: PermissionResult['behavior'] }[];
}

// Keep the real CLI, tools and messages. The optional hold stops consumption
// after a successful real dispatch tool result, before accepting SDK result,
// so the user interrupt deterministically happens during the first round.
function observedDriver(instructions: (brief: StartupBrief, attempt: number, cwd: string) => string, holdFirst = false) {
  const rounds: Observation[] = [];
  const driver = new ClaudeCoordinatorDriver({ query: args => {
    const sdk = args.options!;
    assert.equal(Object.hasOwn(sdk.env!, 'CLAUDE_CONFIG_DIR'), false);
    const brief = JSON.parse(args.prompt as string) as StartupBrief;
    assert.equal(sdk.model, 'haiku');
    assert.equal(sdk.effort, 'low');
    assert.ok(sdk.cwd);
    if (brief.work.workPath) {
      assert.equal(sdk.cwd, brief.work.workPath);
      assert.ok(sdk.cwd.endsWith('/_work'));
    } else assert.equal(brief.work.workBranch, null);
    assert.deepEqual(sdk.settingSources, []);
    assert.equal(sdk.strictMcpConfig, true);
    assert.deepEqual(sdk.sandbox?.filesystem, { disabled: false, allowWrite: [], denyWrite: [sdk.cwd], denyRead: credentialPaths() });
    assert.deepEqual(Object.keys(sdk.mcpServers ?? {}), ['helm']);
    const endpoint = sdk.mcpServers!.helm!;
    assert.ok('url' in endpoint && endpoint.type === 'http');
    assert.match(endpoint.headers?.Authorization ?? '', /^Bearer .+/);
    const record: Observation = { brief, cwd: sdk.cwd, sessionId: sdk.resume ?? sdk.sessionId!, resumeSessionId: sdk.resume, token: endpoint.headers!.Authorization!,
      endpoint: endpoint.url, holding: false, messages: [], helmTools: [], permissions: [] };
    const attempt = rounds.push(record);
    const canUseTool = sdk.canUseTool!;
    const stream = query({ ...args, prompt: `${instructions(brief, attempt, sdk.cwd)}\n\n启动简报：\n${args.prompt}`, options: { ...sdk, maxTurns: 16,
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

test('冒烟①⑤：三轮真实调度者从项目目录经带令牌 HTTP MCP 建卡、改依赖、派单后建立副本，无 needs-auth 且记录 token',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const sessions: string[] = [];
    const tokens: string[] = [];
    for (const index of [1, 2, 3]) await t.test(`新会话 ${index}`, async subtest => {
      const observed = observedDriver(() => `这是调度者驱动冒烟，工作由轮次令牌确定，MCP 调用不传 workId。${restrictions}
按顺序调用：
1. create-card，key=smoke-upstream，content=上游卡片，readOnly=false（写代码卡片）。
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
      assert.equal(round.cwd, daemon.repo);
      assert.equal(round.brief.work.workPath, null);
      assert.equal(round.brief.work.workBranch, null);
      connected(round);
      for (const [name, count] of [['create-card', 2], ['add-dependency', 2], ['remove-dependency', 1], ['create-dispatch', 1]] as const) successfulTool(round, name, count);
      const cards = (await daemon.call('get-card-graph', daemon.params)).filter((node: any) => node.type === 'card');
      assert.equal(cards.length, 2);
      const upstream = cards.find((card: any) => card.key === 'smoke-upstream');
      const downstream = cards.find((card: any) => card.key === 'smoke-downstream');
      // A read-only upstream would legitimately skip the work copy asserted below.
      assert.equal(upstream.readOnly, false);
      assert.equal(downstream.status, 'waiting');
      assert.deepEqual(downstream.dependencies, [{ type: 'card', id: upstream.id }]);
      const dispatches = await daemon.call('list-dispatches', daemon.params);
      assert.equal(dispatches.length, 1);
      assert.equal(dispatches[0].cardId, upstream.id);
      assert.equal(dispatches[0].key, 'smoke-dispatch');
      assert.equal(events.filter(event => event.action === 'card-created').length, 2);
      assert.equal(events.filter(event => event.action === 'dispatch-created').length, 1);
      const work = await daemon.call('get-work', daemon.params);
      assert.equal(work.workPath, join(daemon.directory, 'data', 'worktrees', work.id, '_work'));
      assert.equal(work.workBranch, `helm/${work.id}`);
      assert.equal(daemon.git('-C', work.workPath, 'branch', '--show-current'), work.workBranch);
      assert.equal(await readFile(join(work.workPath, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
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
    const work = await daemon.call('get-work', daemon.params);
    assert.equal(first.cwd, daemon.repo);
    assert.equal(first.brief.work.workPath, null);
    assert.equal(replay.cwd, work.workPath);
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

test('冒烟③调度者：对齐轮次在项目目录内 Bash 写入被真实沙箱拦截，读取正常且项目代码不变',
  { skip: !enabled, timeout: 240_000 }, async t => {
    let command = '';
    const observed = observedDriver((brief, _attempt, cwd) => {
      assert.equal(brief.work.status, 'aligning');
      command = `printf forbidden > ${shellQuote(join(cwd, 'coordinator-write.txt'))}`;
      return `这是只读沙箱冒烟。${restrictions}
1. 必须用 Bash 原样尝试一次：${command}
预期写入被沙箱拦下。禁止使用 dangerouslyDisableSandbox，禁止重试或其他写法。
2. 拒绝是预期结果，继续用 Read 读取当前项目目录的 README.md。
3. 简短回答实际读到的内容和写入错误，然后退出。`;
    });
    const daemon = await fixture(t, observed.driver, 1, { realFirstRound: true, roundTimeout: 180_000 });
    const events = await daemon.events();
    const end = events.find(event => event.action === 'round-ended')!;
    assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
    assert.equal(observed.rounds.length, 1);
    const round = observed.rounds[0]!;
    assert.equal(round.cwd, daemon.repo);
    assert.equal(round.brief.work.workPath, null);
    assert.equal(round.brief.work.workBranch, null);
    assert.equal(existsSync(join(daemon.directory, 'data', 'worktrees', daemon.work.id, '_work')), false);
    connected(round);
    const bash = toolCalls(round.messages).find(call => call.name === 'Bash' && (call.input as any).command === command);
    assert.ok(bash, '必须实际尝试项目目录内 Bash 写入');
    const denied = toolResult(round.messages, bash.id);
    assert.equal(denied?.is_error, true);
    assert.match(JSON.stringify(denied.content), /operation not permitted|permission denied|read-only file system|sandbox/i);
    assert.ok(!round.permissions.some(item => item.tool === 'Bash' && item.input.command === command && item.behavior === 'deny'), '写入必须由真实沙箱拒绝');
    await assert.rejects(readFile(join(daemon.repo, 'coordinator-write.txt')), { code: 'ENOENT' });
    assert.equal(await readFile(join(daemon.repo, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
    const read = toolCalls(round.messages).find(call => call.name === 'Read');
    assert.ok(read);
    const readResult = toolResult(round.messages, read.id);
    assert.ok(readResult && !readResult.is_error);
    assert.match(JSON.stringify(readResult.content), /coordinator read-only baseline/);
    assert.equal(daemon.git('status', '--porcelain'), '');
  });

test('冒烟④：对齐只读项目目录，首次写代码派单取最新基准建副本并提示差异，换目录后新开会话',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    const command = 'printf forbidden > alignment-write.txt';
    let original = '';
    let latest = '';
    const observed = observedDriver((brief, attempt, cwd) => {
      assert.equal(brief.work.baseRef, 'main');
      if (attempt === 1) {
        assert.equal(brief.work.status, 'aligning');
        assert.equal(brief.work.activeDescriptionId, null);
        assert.equal(brief.work.workPath, null);
        assert.equal(brief.work.workBranch, null);
        assert.equal(git(cwd, 'branch', '--show-current'), 'main');
        original = git(cwd, 'rev-parse', 'HEAD');
        return `这是按需副本的首个对齐轮次冒烟。${restrictions}
1. 用 Bash 执行 pwd，再用 Bash 执行 git branch --show-current。
2. 用 Read 读取当前项目目录的 README.md。
3. 必须用 Bash 原样尝试一次：${command}
预期写入被沙箱拒绝；禁止 dangerouslyDisableSandbox、重试或其他写法。拒绝后继续。
4. 调用 draft-work-description，key=alignment-copy，requirements=按需建立工作副本，boundary=临时项目，criteria=对齐只读项目目录，首次写代码执行派单前才建立副本。
然后简短回答读到的内容并退出。`;
      }
      if (attempt === 2) {
        assert.equal(brief.work.status, 'executing');
        assert.ok(brief.work.activeDescriptionId);
        assert.equal(brief.work.workPath, null, '确认工作说明不能创建工作副本');
        assert.equal(brief.work.workBranch, null);
        assert.equal(brief.work.baseCommit, original);
        assert.equal(git(cwd, 'branch', '--list', `helm/${brief.work.id}`), '');
        assert.equal(existsSync(join(cwd, '..', 'data', 'worktrees', brief.work.id, '_work')), false);
        // Advance main after confirmation, before the first real execution dispatch.
        // These host-side fixture edits are outside the coordinator's read-only sandbox.
        writeFileSync(join(cwd, 'base-latest.txt'), 'committed after confirmation\n');
        git(cwd, 'add', 'base-latest.txt');
        git(cwd, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'advance base after confirmation');
        latest = git(cwd, 'rev-parse', 'main');
        assert.notEqual(latest, original);
        git(cwd, 'checkout', '-b', 'user-switched');
        writeFileSync(join(cwd, 'README.md'), 'user checkout modified before dispatch\n');
        writeFileSync(join(cwd, 'uncommitted.txt'), 'must not enter the copy\n');
        return `这是首次写代码执行派单冒烟。${restrictions}
只按顺序调用：
1. create-card，key=on-demand-card，content=按需副本冒烟写代码卡片，readOnly=false。
2. create-dispatch，key=on-demand-dispatch，cardId 用上一步卡片 id，agentId=claude-executor，purpose=execution，needsBrowser=false。
两步必须实际成功；然后立即退出，不读取、等待或处理派单结果。`;
      }
      assert.equal(attempt, 3);
      return `这是工作副本建立后的下一轮调度者冒烟。${restrictions}
只用 Bash 执行 pwd 和 git branch --show-current，再用 Read 分别读取 README.md 和 base-latest.txt。
简短报告读到的结果后退出，不建卡、不派单。`;
    });
    const daemon = await fixture(t, observed.driver, 3, { realFirstRound: true, roundTimeout: 180_000 });
    const firstEvents = await daemon.events();
    const firstEnd = firstEvents.find(event => event.action === 'round-ended')!;
    assert.equal(firstEnd.details.reason, 'completed', JSON.stringify(firstEnd.details));
    assert.equal(observed.rounds.length, 1);
    const alignment = observed.rounds[0]!;
    connected(alignment);
    assert.equal(alignment.cwd, daemon.repo);
    assert.equal(daemon.work.workPath, null);
    assert.equal(daemon.work.workBranch, null);
    const workPath = join(daemon.directory, 'data', 'worktrees', daemon.work.id, '_work');
    assert.equal(existsSync(workPath), false);
    assert.equal(daemon.git('branch', '--list', `helm/${daemon.work.id}`), '');
    // The model may chain pwd with another command; the result still pins the actual cwd.
    const assertReadLocation = (round: Observation, path: string) => {
      const calls = toolCalls(round.messages);
      const pwd = calls.find(call => call.name === 'Bash' && /\bpwd\b/.test(String((call.input as any).command)));
      assert.ok(pwd, '真实 CLI 必须报告 cwd');
      const pwdResult = toolResult(round.messages, pwd.id);
      assert.ok(pwdResult && !pwdResult.is_error);
      assert.ok(JSON.stringify(pwdResult.content).includes(path));
      const read = calls.find(call => call.name === 'Read' && String((call.input as any).file_path).endsWith('README.md'));
      assert.ok(read);
      const result = toolResult(round.messages, read.id);
      assert.ok(result && !result.is_error);
      assert.match(JSON.stringify(result.content), /coordinator read-only baseline/);
      assert.doesNotMatch(JSON.stringify(result.content), /user checkout modified/);
    };
    assertReadLocation(alignment, daemon.repo);
    const write = toolCalls(alignment.messages).find(call => call.name === 'Bash' && (call.input as any).command === command);
    assert.ok(write);
    const denied = toolResult(alignment.messages, write.id);
    assert.equal(denied?.is_error, true);
    assert.match(JSON.stringify(denied.content), /operation not permitted|permission denied|read-only file system|sandbox/i);
    assert.ok(!alignment.permissions.some(item => item.tool === 'Bash' && item.input.command === command && item.behavior === 'deny'));
    assert.equal(existsSync(join(daemon.repo, 'alignment-write.txt')), false);
    assert.equal(daemon.git('status', '--porcelain'), '');
    successfulTool(alignment, 'draft-work-description', 1);

    const gate = (await daemon.call('list-pending')).find((item: any) => item.workId === daemon.work.id);
    const confirmed = await daemon.call('decide-gate', { ...daemon.params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
    assert.equal(confirmed.baseCommit, original);
    assert.equal(confirmed.workBranch, null);
    assert.equal(confirmed.workPath, null);
    const dispatchEvents = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length >= 2, 180_000);
    const dispatchEnd = dispatchEvents.filter(event => event.action === 'round-ended')[1]!;
    assert.equal(dispatchEnd.details.reason, 'completed', JSON.stringify(dispatchEnd.details));
    assert.equal(observed.rounds.length, 2);
    const dispatchRound = observed.rounds[1]!;
    connected(dispatchRound);
    assert.equal(dispatchRound.cwd, daemon.repo, '建副本的这一轮仍在项目目录');
    successfulTool(dispatchRound, 'create-card', 1);
    successfulTool(dispatchRound, 'create-dispatch', 1);
    const copied = await daemon.call('get-work', daemon.params);
    assert.equal(copied.workPath, workPath);
    assert.equal(copied.workBranch, `helm/${copied.id}`);
    assert.equal(copied.baseCommit, latest);
    assert.equal(git(workPath, 'branch', '--show-current'), copied.workBranch);
    assert.equal(git(workPath, 'rev-parse', 'HEAD'), latest);
    assert.equal(await readFile(join(workPath, 'base-latest.txt'), 'utf8'), 'committed after confirmation\n');
    assert.equal(await readFile(join(workPath, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
    assert.equal(existsSync(join(workPath, 'uncommitted.txt')), false);
    assert.equal(git(workPath, 'status', '--porcelain'), '');
    const dispatches = await daemon.call('list-dispatches', daemon.params);
    assert.equal(dispatches.length, 1);
    const cards = (await daemon.call('get-card-graph', daemon.params)).filter((item: any) => item.type === 'card');
    assert.equal(cards.length, 1);
    assert.equal(dispatches[0].cardId, cards[0].id);
    assert.equal(git(cards[0].workPath, 'rev-parse', 'HEAD'), latest);
    const conversation = await daemon.call('get-conversation', daemon.params);
    const notices = conversation.filter((item: any) => item.type === 'message' && item.sender === 'runtime' && item.body.includes('工作副本不包含'));
    assert.equal(notices.length, 1, '运行层必须提示项目目录与副本的差异');
    assert.match(notices[0].body, /基准分支 main 的最新提交/);
    assert.match(notices[0].body, /未提交改动/);
    assert.equal(daemon.git('branch', '--show-current'), 'user-switched');
    assert.equal(await readFile(join(daemon.repo, 'README.md'), 'utf8'), 'user checkout modified before dispatch\n');
    assert.equal(await readFile(join(daemon.repo, 'uncommitted.txt'), 'utf8'), 'must not enter the copy\n');
    assert.match(daemon.git('status', '--porcelain'), /M README.md/);
    assert.match(daemon.git('status', '--porcelain'), /\?\? uncommitted.txt/);

    await daemon.call('send-message', { ...daemon.params, key: 'check-copy-cwd', body: '请报告当前工作目录和基准文件' });
    const finalEvents = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length >= 3, 180_000);
    const finalEnd = finalEvents.filter(event => event.action === 'round-ended')[2]!;
    assert.equal(finalEnd.details.reason, 'completed', JSON.stringify(finalEnd.details));
    assert.equal(observed.rounds.length, 3);
    const next = observed.rounds[2]!;
    connected(next);
    assert.equal(next.cwd, workPath);
    assert.equal(next.resumeSessionId, undefined, '换目录不能续跑旧会话');
    assert.notEqual(next.sessionId, dispatchRound.sessionId);
    assert.equal(next.brief.resumed, undefined);
    assert.equal(finalEvents.filter(event => event.action === 'round-agent-loaded')[2]!.details.resumed, false);
    assertReadLocation(next, workPath);
    const latestRead = toolCalls(next.messages).find(call => call.name === 'Read' && String((call.input as any).file_path).endsWith('base-latest.txt'));
    assert.ok(latestRead);
    const latestResult = toolResult(next.messages, latestRead.id);
    assert.ok(latestResult && !latestResult.is_error);
    assert.match(JSON.stringify(latestResult.content), /committed after confirmation/);
  });
