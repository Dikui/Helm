// Outside the sandbox, after npm run build:
// HELM_INVALID_VERIFICATION_REAL=1 node --test dist/tests/invalid-verification.real.js
// Uses the logged-in local Claude CLI (sonnet/low). No browser is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver } from '../src/claude-driver.js';
import type { Dispatch } from '../src/dispatch.js';
import { FakeDriver, type Driver, type FakeStep } from '../src/driver.js';
import { defaultPromptDir } from '../src/prompts.js';
import type { HelmEvent } from '../src/store.js';
import { until } from './claude-coordinator-fixture.js';
import { configureTestAgent, fixtureAgentDir, startTestHelmd } from './helmd-fixture.js';

const enabled = process.env.HELM_INVALID_VERIFICATION_REAL === '1';
const invalidReason = '材料多，没查完';
const criteria = 'smoke.txt 的内容严格等于 invalid-verification-smoke 加一个换行。';
const checkSource = "const assert = require('node:assert/strict'); assert.equal(require('node:fs').readFileSync('smoke.txt', 'utf8'), 'invalid-verification-smoke\\n'); console.log('smoke.txt: PASS');";
const checkCommand = `node -e ${JSON.stringify(checkSource)}`;

function checkFile(cwd: string) {
  const output = execFileSync(process.execPath, ['-e', checkSource], { cwd, encoding: 'utf8' });
  assert.equal(output, 'smoke.txt: PASS\n');
  return output;
}

test('真实调度者：无证据的不通过重派验收，第二票通过后完成卡片，不返工或提关卡',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const daemon = await fixture(t, false);
    const state = await daemon.settled('completed');
    const verifications = assertRetry(state);
    assert.equal(verifications[1]!.conclusion, 'passed');
    assert.match(verifications[1]!.finalAnswer ?? '', /smoke\.txt: PASS/);
    assert.ok(verifications.slice(1).every(dispatch => dispatch.conclusion === 'passed'));
    assert.equal(state.target.status, 'completed');
    assert.equal(state.events.some(event => event.action === 'gate-created' && event.details.kind === 'general'), false,
      '包括已撤回的关卡在内，不得因无效票提决策关卡');
    assert.equal(daemon.calls('propose-gate').length, 0);
    assert.equal(execFileSync('git', ['-C', daemon.repo, 'show', `helm/${daemon.workId}:smoke.txt`], { encoding: 'utf8' }),
      'invalid-verification-smoke\n');
  });

test('真实调度者：同一原因再次出现无效票，提关卡④并用依赖阻塞卡片',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const daemon = await fixture(t, true);
    const state = await daemon.settled('gate');
    const verifications = assertRetry(state);
    assert.equal(verifications.length, 2, '同理由第二次无效后不能继续重派');
    assert.equal(verifications[1]!.conclusion, 'failed');
    assert.equal(verifications[1]!.conclusionReason, invalidReason);
    assert.equal(verifications[1]!.finalAnswer, invalidReason);
    const gates = state.events.filter(event => event.action === 'gate-created' && event.details.kind === 'general');
    assert.equal(gates.length, 1);
    const gate = gates[0]!;
    assert.equal(gate.actor.type, 'coordinator-round');
    assert.match(String(gate.details.body), /④/);
    assert.match(String(gate.details.body), /材料多.*没查完/s);
    assert.ok(gate.id > endedEvent(state, verifications[1]!.id).id, '关卡必须在第二次无效后提出');
    assert.ok(daemon.calls('propose-gate').length >= 1, '真实 Claude 必须调用 propose-gate');
    assert.deepEqual(state.target.dependencies, [{ type: 'gate', id: gate.object.id }]);
    assert.equal(state.target.status, 'waiting');
    assert.equal(state.events.some(event => event.action === 'card-completed' && event.object.id === state.target.id), false);
    assert.ok(state.pending.some(item => item.id === gate.object.id && item.kind === 'general'));
  });

interface GraphNode {
  type: 'card' | 'gate'; id: string; key: string; status: string; repairOfCardId?: string | null;
  dependencies: { type: string; id: string }[];
}
type Event = Omit<HelmEvent, 'details'> & { details: Record<string, unknown> };
interface State {
  graph: GraphNode[]; target: GraphNode; dispatches: Dispatch[]; events: Event[]; idle: boolean;
  pending: { id: string; kind: string }[];
}

function endedEvent(state: State, dispatchId: string) {
  const event = state.events.find(item => item.action === 'dispatch-ended' && item.object.id === dispatchId);
  assert.ok(event, `缺少派单结束事件：${dispatchId}`);
  return event;
}

function assertRetry(state: State) {
  const cards = state.graph.filter(node => node.type === 'card');
  assert.deepEqual(cards.map(card => card.key).sort(), ['smoke-implementation', 'smoke-overall'], '不得新增修复卡片');
  assert.ok(cards.every(card => !card.repairOfCardId));
  assert.equal(state.events.filter(event => event.action === 'card-created').length, 2);
  const executions = state.dispatches.filter(dispatch => dispatch.purpose === 'execution');
  assert.equal(executions.length, 1, '无效票不能触发执行返工');
  assert.equal(executions[0]!.cardId, state.target.id);
  assert.equal(executions[0]!.conclusion, 'completed');
  const verifications = state.dispatches.filter(dispatch => dispatch.cardId === state.target.id && dispatch.purpose === 'verification');
  assert.ok(verifications.length >= 2, '必须在原卡片重派验收');
  assert.equal(verifications[0]!.conclusion, 'failed');
  assert.equal(verifications[0]!.conclusionReason, invalidReason);
  assert.equal(verifications[0]!.finalAnswer, invalidReason, '第一票不能含标准或证据');
  assert.match(verifications[1]!.content, /核查清单/);
  const retry = state.events.find(event => event.action === 'dispatch-created' && event.object.id === verifications[1]!.id);
  assert.ok(retry && retry.id > endedEvent(state, verifications[0]!.id).id, '第二票必须在第一票结束后新派');
  const sessions = [executions[0]!, ...verifications].map(dispatch => dispatch.sessionId);
  assert.ok(sessions.every(Boolean));
  assert.equal(new Set(sessions).size, sessions.length, '执行和每次验收必须各用新对话');
  for (const dispatch of [executions[0]!, ...verifications]) {
    assert.equal(dispatch.status, 'ended');
    assert.equal(dispatch.endReason, 'completed', JSON.stringify(dispatch));
    assert.equal(dispatch.needsBrowser, false);
  }
  assert.ok(verifications.every(dispatch => dispatch.resumeSessionId === null));
  return verifications;
}

async function fixture(t: TestContext, repeatedInvalid: boolean) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-invalid-verification-')));
  let daemon: Awaited<ReturnType<typeof startTestHelmd>> | undefined;
  t.after(async () => {
    try { await daemon?.close(); }
    finally { await rm(directory, { recursive: true, force: true }); }
  });
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'invalid verification smoke baseline\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const agentDir = join(directory, 'agents');
  // Only one executor is available; the rule permits the same driver with a fresh conversation.
  for (const id of ['claude-coordinator', 'claude-executor']) {
    await cp(join(fixtureAgentDir, id), join(agentDir, id), { recursive: true });
  }
  await configureTestAgent(agentDir, 'claude-coordinator', { model: 'sonnet', reasoningEffort: 'low' });
  const ok = (value: unknown) => assert.equal((value as { ok: boolean }).ok, true, JSON.stringify(value));
  const saved = (ctx: { results: Map<string, unknown> }, key: string) => (ctx.results.get(key) as { result: { id: string } }).result.id;
  // As in claude-coordinator-fixture, prepare alignment without consuming a real CLI turn.
  // Also seed the current plan, so this smoke measures result handling rather than planning variability.
  const setup = new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'draft', requirements: '新建 smoke.txt，写入指定文本。',
      boundary: '轻量；只改 smoke.txt，不增依赖。', criteria: `${criteria}\n运行 ${checkCommand}，输出 smoke.txt: PASS 才通过。` }, check: ok },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'smoke-implementation', content: `新建 smoke.txt\n${criteria}\n检查命令：${checkCommand}\n执行后由新上下文验收。`,
      needsVerification: true, writeScopes: ['smoke.txt'] }, saveAs: 'target', check: ok },
    { type: 'tool', name: 'create-card', arguments: { key: 'smoke-overall', content: `整体验收（只派验收）：\n${criteria}\n检查命令：${checkCommand}`, needsVerification: true }, saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ upstream: { type: 'card', id: saved(ctx, 'target') },
      downstream: { type: 'card', id: saved(ctx, 'overall') } }), check: ok },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ body: `## 编排计划
阶段：1 实现【当前】 → 2 整体验收
规模档：2 张卡片　力度：轻量（依据：工作说明）
### 阶段 1：实现
| key | cardId | 类型 | 执行 | 验收 | 依赖 |
| smoke-implementation | ${saved(ctx, 'target')} | 普通卡片 | claude-executor | claude-executor 新上下文，1 票 | 无 |
### 阶段 2：整体验收
| smoke-overall | ${saved(ctx, 'overall')} | 整体验收 | — | claude-executor 新上下文，2 票 | smoke-implementation |
## 计划变更
无
## 计数
尚未派单
## 已用 key
draft、smoke-implementation、smoke-overall
## 下一步
给 smoke-implementation 派执行单，按角色规则推进。
` }), check: ok },
  ]]);
  const messages: SDKMessage[] = [];
  const real = new ClaudeCoordinatorDriver({ query: args => {
    assert.equal(args.options!.model, 'sonnet');
    assert.equal(args.options!.effort, 'low');
    // Do not append the expected recovery/escalation behavior to the model's input.
    const stream = query({ ...args, options: { ...args.options, maxTurns: 32 } });
    const deadline = setTimeout(() => args.options!.abortController!.abort(), 180_000);
    return {
      close() { clearTimeout(deadline); stream.close(); },
      async *[Symbol.asyncIterator]() {
        try { for await (const message of stream) { messages.push(message); yield message; } }
        finally { clearTimeout(deadline); stream.close(); }
      },
    };
  } });
  let rounds = 0;
  const driver = { start(options) {
    if (rounds++ < 2) return setup.start(options);
    assert.equal(options.agent.rules.role, readFileSync(join(defaultPromptDir, 'coordinator-role.md'), 'utf8'));
    assert.equal(options.agent.rules.runtime, readFileSync(join(defaultPromptDir, 'coordinator-runtime.md'), 'utf8'));
    return real.start(options);
  } } satisfies Pick<Driver, 'start'>;
  let executionCard = '';
  const verificationCounts = new Map<string, number>();
  // A fresh FakeDriver per session selects scripts by purpose AND per-card attempt count.
  // Its tool steps use the dispatch-scoped MCP endpoint, exactly like a real executor.
  const executorDriver = { start(options) {
    return new FakeDriver([ctx => {
      const input = JSON.parse(ctx.input) as { cardId: string; purpose: string };
      assert.equal(ctx.options.resumeSessionId, undefined);
      if (input.purpose === 'execution') {
        executionCard = input.cardId;
        return [
          { type: 'write', path: 'smoke.txt', content: 'invalid-verification-smoke\n' },
          { type: 'tool', name: 'submit-conclusion', arguments: () => ({ conclusion: 'completed', reason: checkFile(ctx.options.cwd).trim() }), check: ok },
          { type: 'end', reason: 'completed', finalAnswer: `已写入 smoke.txt。\n命令：${checkCommand}\n实际输出：smoke.txt: PASS\n等待独立验收。` },
        ];
      }
      assert.equal(input.purpose, 'verification');
      const count = (verificationCounts.get(input.cardId) ?? 0) + 1;
      verificationCounts.set(input.cardId, count);
      if (input.cardId === executionCard && (count === 1 || repeatedInvalid)) return [
        { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: invalidReason }, check: ok },
        { type: 'end', reason: 'completed', finalAnswer: invalidReason },
      ];
      const output = checkFile(ctx.options.cwd);
      return [
        { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: `${criteria}检查输出 smoke.txt: PASS` }, check: ok },
        { type: 'end', reason: 'completed', finalAnswer: `标准：${criteria}\n命令：${checkCommand}\n实际输出：\n${output}` },
      ] satisfies FakeStep[];
    }]).start(options);
  } } satisfies Pick<Driver, 'start'>;
  daemon = await startTestHelmd({ port: 0, agentDir, dataDir: join(directory, 'data'), driver, executorDriver,
    browserCommand: { file: process.execPath, args: [fileURLToPath(new URL('./fixtures/browser-mcp.js', import.meta.url))] } });
  const call = async (name: string, params: object = {}): Promise<any> => {
    const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const { work } = await call('send-message', { projectId: project.id, key: 'start', body: '新建 smoke.txt，内容为 invalid-verification-smoke 加一个换行。' });
  const params = { workId: work.id };
  const events = (): Promise<Event[]> => call('get-events', params);
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).find((item: any) => item.workId === work.id);
  await call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  await until(events, values => values.filter(event => event.action === 'round-ended').length === 2);
  const snapshot = async (): Promise<State> => {
    const before = await events();
    const graph: GraphNode[] = await call('get-card-graph', params);
    const dispatches: Dispatch[] = await call('list-dispatches', params);
    const pending = (await call('list-pending')).filter((item: any) => item.workId === work.id);
    const after = await events();
    // A round may add the gate's dependency between API reads. Only accept a stable,
    // idle snapshot, so an older graph cannot be paired with a newer round-ended.
    const idle = before.at(-1)?.id === after.at(-1)?.id
      && after.filter(event => event.action === 'round-started').length === after.filter(event => event.action === 'round-ended').length;
    return { graph, target: graph.find(node => node.type === 'card' && node.key === 'smoke-implementation')!,
      dispatches, events: after, pending, idle };
  };
  const settled = async (outcome: 'completed' | 'gate') => {
    try {
      return await until(async () => {
        await new Promise(resolve => setTimeout(resolve, 250));
        return snapshot();
      }, state => state.idle && (outcome === 'completed' ? state.target.status === 'completed'
        : state.pending.some(item => item.kind === 'general')), 480_000);
    } catch (error) { t.diagnostic(JSON.stringify(await snapshot())); throw error; }
  };
  await call('send-message', { ...params, key: 'continue', body: '请继续按已确认工作说明和已有编排计划推进。' });
  const calls = (name: string) => messages.flatMap(message => message.type === 'assistant'
    ? message.message.content.filter(block => block.type === 'tool_use' && block.name === `mcp__helm__${name}`) : []);
  return { repo, workId: work.id as string, settled, calls };
}
