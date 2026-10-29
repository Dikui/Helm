import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { RuleError } from '../src/store.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待轮次状态超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, scripts: FakeScript[], executors: FakeScript[] = [], driver?: Driver, roundRetryDelaysMs: readonly [number, number] = [20, 40]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-round-failure-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  let daemon = await startHelmd({ port: 0, dataDir, driver: driver ?? new FakeDriver(scripts), executorDriver: new FakeDriver(executors), roundRetryDelaysMs });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const begin = async () => (await call('send-message', { projectId: project.id, body: '实现工作', key: 'start' })).result.work;
  const events = async (workId: string) => (await call('get-events', { workId })).result as any[];
  const confirm = async (workId: string) => {
    const gate = (await call('list-pending')).result.find((item: any) => item.workId === workId && item.kind === 'work-confirmation');
    ok(await call('decide-gate', { workId, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  };
  return { directory, repo, dataDir, call, begin, events, confirm,
    get url() { return daemon.url; },
    close: () => daemon.close(),
    async restart(next: Driver) {
      await daemon.close();
      daemon = await startHelmd({ port: 0, dataDir, driver: next, roundRetryDelaysMs });
    },
  };
}

const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft',
  requirements: '测试可靠性', boundary: '本机', criteria: '失败可恢复' }), check: ok };
const create: FakeStep = { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '实现卡片' }), saveAs: 'card', check: ok };
const dispatch: FakeStep = { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id,
  key: 'dispatch', agentId: 'claude-executor' }), check: ok };

test('连续失败三次暂停，推送待处理通知，消息和确认关卡不绕过暂停，重启后只由用户恢复', async t => {
  let pausedBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [
    [draft, { type: 'crash' }], [{ type: 'end', reason: 'error' }], [{ type: 'end', reason: 'context-overflow' }],
    ctx => { pausedBrief = JSON.parse(ctx.input); return []; },
  ]);
  const stream = await fetch(`${daemon.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(8_000) });
  const reader = stream.body!.getReader();
  t.after(() => reader.cancel());
  const notification = (async () => {
    let output = '';
    while (!output.includes('"kind":"runtime-pause"')) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      output += new TextDecoder().decode(chunk.value);
    }
    return output;
  })();
  const work = await daemon.begin();
  await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  assert.match(await notification, /event: needs-user-attention/);
  await reader.cancel();
  assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-ended').length, 3);
  assert.equal((await daemon.call('list-works')).result[0].runtimePauseReason, '调度者连续失败 3 次');
  assert.equal((await daemon.call('list-pending')).result.find((item: any) => item.kind === 'runtime-pause').workId, work.id);
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  assert.equal(conversation.at(-1).sender, 'runtime');
  assert.match(conversation.at(-1).body, /连续失败 3 次/);
  await daemon.call('send-message', { workId: work.id, key: 'while-paused', body: '请继续处理' });
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 4);
  assert.equal(pausedBrief!.work.status, 'paused');
  assert.deepEqual(pausedBrief!.wakeEvents.map(event => event.action), ['message-sent']);
  assert.equal((pausedBrief!.wakeEvents[0]!.details as any).body, '请继续处理');
  await daemon.confirm(work.id);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'paused');
  let resumedBrief: StartupBrief | undefined;
  await daemon.restart(new FakeDriver([ctx => { resumedBrief = JSON.parse(ctx.input); return [{ type: 'end', reason: 'error' }]; }, []]));
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'paused');
  assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-started').length, 4);
  const resumed = await daemon.call('resume-work', { workId: work.id });
  ok(resumed);
  assert.equal(resumed.result.status, 'executing');
  assert.equal(resumed.result.runtimePauseReason, null);
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 6);
  assert.ok(resumedBrief!.wakeEvents.some(event => (event.details as any).body === '实现工作'));
  assert.equal(resumedBrief!.wakeEvents.some(event => (event.details as any).body === '请继续处理'), false);
  assert.equal((await daemon.call('list-pending')).result.some((item: any) => item.kind === 'runtime-pause'), false);
});

test('调度者额度用完立即暂停，不重投，手动恢复对齐中的工作', async t => {
  const daemon = await fixture(t, [[{ type: 'end', reason: 'quota-exhausted' }], []]);
  const work = await daemon.begin();
  await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.runtimePauseReason, '调度者额度用完');
  assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-started').length, 1);
  assert.equal((await daemon.call('resume-work', { workId: work.id })).result.status, 'aligning');
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
});

test('成功轮次重置连续失败次数', async t => {
  const daemon = await fixture(t, [
    [{ type: 'end', reason: 'error' }], [],
    [{ type: 'end', reason: 'context-overflow' }], [{ type: 'end', reason: 'error' }], [],
  ]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  await daemon.call('send-message', { workId: work.id, key: 'next', body: '下一轮' });
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 5);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'aligning');
  assert.equal((await daemon.call('list-pending')).result.some((item: any) => item.kind === 'runtime-pause'), false);
});

test('运行层暂停期间的新用户消息仍可投递，再次额度用完后不重投旧消息', async t => {
  let pausedBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [
    [{ type: 'end', reason: 'quota-exhausted' }],
    ctx => { pausedBrief = JSON.parse(ctx.input); return [{ type: 'end', reason: 'quota-exhausted' }]; },
    [],
  ]);
  const work = await daemon.begin();
  await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  ok(await daemon.call('send-message', { workId: work.id, key: 'while-paused', body: '检查暂停原因' }));
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  assert.equal(pausedBrief!.work.status, 'paused');
  assert.deepEqual(pausedBrief!.wakeEvents.map(event => (event.details as any).body), ['检查暂停原因']);
  await daemon.restart(new FakeDriver([[]]));
  assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-started').length, 2);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.runtimePauseReason, '调度者额度用完');
  ok(await daemon.call('resume-work', { workId: work.id }));
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 3);
});

// Allow MCP startup and event delivery under parallel test load before expiring a round.
test('轮次看门狗设置持久化，空闲超时及总时长超时都会自动重投', async t => {
  for (const mode of ['idle', 'total'] as const) await t.test(mode, async t => {
    const daemon = await fixture(t, [[{ type: 'output', text: '开始后挂住' }, { type: 'hang' }], []]);
    const defaults = (await daemon.call('get-settings')).result;
    assert.equal(defaults.roundTotalTimeoutMs, 30 * 60_000);
    assert.equal(defaults.roundIdleTimeoutMs, 10 * 60_000);
    assert.equal((await daemon.call('set-round-watchdog', { totalTimeoutMs: 0 })).status, 400);
    assert.equal((await daemon.call('set-round-watchdog', { idleTimeoutMs: 2 ** 31 })).status, 400);
    ok(await daemon.call('set-round-watchdog', { totalTimeoutMs: mode === 'total' ? 1000 : 30_000, idleTimeoutMs: mode === 'idle' ? 1000 : 30_000 }));
    const work = await daemon.begin();
    const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
    const ended = events.filter(event => event.action === 'round-ended');
    assert.equal(ended[0].details.reason, 'timed-out');
    assert.match(ended[0].details.failure, /可在设置的运行页调整超时/);
    assert.equal(ended[0].details.processed, false);
    assert.equal(ended[1].details.reason, 'completed');
    await daemon.restart(new FakeDriver());
    const settings = (await daemon.call('get-settings')).result;
    assert.equal(settings.roundTotalTimeoutMs, mode === 'total' ? 1000 : 30_000);
    assert.equal(settings.roundIdleTimeoutMs, mode === 'idle' ? 1000 : 30_000);
  });
});

test('看门狗能结束驱动启动、发送或事件流挂住的轮次，过期轮次令牌和迟到会话均失效', async t => {
  for (const phase of ['start', 'send', 'events'] as const) await t.test(phase, async t => {
    let attempts = 0;
    let cancellations = 0;
    let lateStart: (() => void) | undefined;
    let headers: Record<string, string> = {};
    const fallback = new FakeDriver();
    const driver: Driver = { checkAvailability: async () => ({ available: true }), async start(options) {
      if (++attempts > 1) return fallback.start(options);
      headers = options.mcpServers.helm!.headers;
      const session = {
        id: 'hung-session',
        async send() { if (phase === 'send') await new Promise(() => {}); },
        cancel() { cancellations++; },
        events: (async function* () { await new Promise(() => {}); })(),
      };
      if (phase === 'start') return new Promise(resolve => { lateStart = () => resolve(session); });
      return session;
    } };
    const daemon = await fixture(t, [], [], driver);
    ok(await daemon.call('set-round-watchdog', { totalTimeoutMs: 1000, idleTimeoutMs: 30_000 }));
    const work = await daemon.begin();
    const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
    assert.equal(events.find(event => event.action === 'round-ended').details.reason, 'timed-out');
    const expired = await fetch(`${daemon.url}/api/get-work`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ workId: work.id }) });
    assert.equal(expired.status, 401);
    lateStart?.();
    await until(async () => cancellations, value => value > 0);
    assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'aligning');
  });
});

test('持续输出刷新无输出期限，但不会刷新轮次总时长期限', async t => {
  let attempts = 0;
  const fallback = new FakeDriver();
  const driver: Driver = { checkAvailability: async () => ({ available: true }), async start(options) {
    if (++attempts > 1) return fallback.start(options);
    let cancelled = false;
    return { id: 'streaming-session', async send() {}, cancel() { cancelled = true; },
      events: (async function* () {
        let step = 0;
        while (!cancelled) {
          await new Promise(resolve => setTimeout(resolve, 30));
          yield { type: 'output' as const, step: ++step, text: '仍在输出' };
        }
      })(),
    };
  } };
  const daemon = await fixture(t, [], [], driver);
  ok(await daemon.call('set-round-watchdog', { totalTimeoutMs: 2000, idleTimeoutMs: 1000 }));
  const work = await daemon.begin();
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  const start = events.find(event => event.action === 'round-started');
  const end = events.find(event => event.action === 'round-ended');
  assert.equal(end.details.reason, 'timed-out');
  assert.ok(Date.parse(end.time) - Date.parse(start.time) >= 1800);
});

test('驱动报告结束后卡在关闭事件流时，看门狗仍保留已报告的 token 用量', async t => {
  let attempts = 0;
  const fallback = new FakeDriver();
  const driver: Driver = { checkAvailability: async () => ({ available: true }), async start(options) {
    if (++attempts > 1) return fallback.start(options);
    return { id: 'hung-close', async send() {}, cancel() {},
      events: (async function* () {
        try { yield { type: 'end' as const, step: 1, reason: 'completed' as const, usage: { inputTokens: 9, outputTokens: 4 } }; }
        finally { await new Promise(() => {}); }
      })(),
    };
  } };
  const daemon = await fixture(t, [], [], driver);
  ok(await daemon.call('set-round-watchdog', { totalTimeoutMs: 1000, idleTimeoutMs: 30_000 }));
  const work = await daemon.begin();
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  const ended = events.find(event => event.action === 'round-ended');
  assert.equal(ended.details.reason, 'timed-out');
  assert.deepEqual(ended.details.usage, { inputTokens: 9, outputTokens: 4 });
  assert.deepEqual((await daemon.call('get-work', { workId: work.id })).result.usage, { inputTokens: 9, outputTokens: 4 });
});

test('运行层停止不计轮次失败，重启后重投未处理事件', async t => {
  const daemon = await fixture(t, [[{ type: 'end', reason: 'error' }], [{ type: 'hang' }]]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-started').length === 2);
  await daemon.restart(new FakeDriver([[{ type: 'end', reason: 'error' }], []]));
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 4);
  assert.deepEqual(events.filter(event => event.action === 'round-ended').map(event => event.details.reason), ['error', 'aborted', 'error', 'completed']);
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'aligning');
});

test('失败重投按两档退避，派单结束等新唤醒事件不会提前重试', async t => {
  for (const reason of ['error', 'timed-out', 'context-overflow'] as const) await t.test(reason, async t => {
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const delays = [500, 700] as const;
    const daemon = await fixture(t, [[draft], [create, dispatch, { type: 'end', reason }],
      [{ type: 'end', reason: 'error' }], [],
    ], [[{ type: 'hang', until: hold }]], undefined, delays);
    const work = await daemon.begin();
    await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
    await daemon.confirm(work.id);
    await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
    release();
    const events = await until(() => daemon.events(work.id), events => {
      const ended = events.find(event => event.action === 'dispatch-ended');
      return events.filter(event => event.action === 'round-ended').length >= 4 && ended
        && events.some(event => event.action === 'round-started' && event.details.eventIds.includes(ended.id));
    });
    const starts = events.filter(event => event.action === 'round-started');
    const ends = events.filter(event => event.action === 'round-ended');
    for (let index = 0; index < delays.length; index++) {
      assert.ok(Date.parse(starts[index + 2].time) - Date.parse(ends[index + 1].time) >= delays[index]! - 5);
    }
    const ended = events.find(event => event.action === 'dispatch-ended');
    // Dispatch cleanup may outlast the first backoff under parallel test load.
    // The first round started after it ends must claim its event.
    assert.ok(starts.find(event => event.id > ended.id).details.eventIds.includes(ended.id));
    // The old user message is still queued after a failed round, but never bypasses backoff.
    assert.equal(ends[1].details.processed, false);
    assert.equal(ends[2].details.processed, false);
    assert.equal(ends[3].details.processed, true);
    assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'executing');
  });
});

test('退避期间用户新消息立即触发轮次，并投递原失败事件和派单结束事件', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  let retryBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [[draft], [create, dispatch, { type: 'end', reason: 'error' }],
    ctx => { retryBrief = JSON.parse(ctx.input); return []; },
  ], [[{ type: 'hang', until: hold }]], undefined, [60_000, 120_000]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  await daemon.confirm(work.id);
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  release();
  const waiting = await until(() => daemon.events(work.id), events => events.some(event => event.action === 'dispatch-ended'));
  assert.equal(waiting.filter(event => event.action === 'round-started').length, 2);
  const sentAt = Date.now();
  ok(await daemon.call('send-message', { workId: work.id, key: 'now', body: '我在，请立即继续' }));
  const retried = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 3);
  assert.ok(Date.parse(retried.filter(event => event.action === 'round-started')[2].time) - sentAt < 5_000);
  assert.ok(retryBrief!.wakeEvents.some(event => event.action === 'dispatch-ended'));
  assert.ok(retryBrief!.wakeEvents.some(event => event.action === 'gate-decided'));
  assert.ok(retryBrief!.wakeEvents.some(event => event.action === 'message-sent' && (event.details as any).body === '我在，请立即继续'));
});

test('轮次运行期间收到的用户新消息也能越过随后失败的退避，下一次失败仍要等待', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await fixture(t, [[{ type: 'hang', until: hold }, { type: 'end', reason: 'error' }],
    [{ type: 'end', reason: 'context-overflow' }], [],
  ], [], undefined, [60_000, 120_000]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-started'));
  ok(await daemon.call('send-message', { workId: work.id, key: 'during-round', body: '继续' }));
  release();
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-started').length, 2);
  ok(await daemon.call('send-message', { workId: work.id, key: 'another', body: '再次继续' }));
  await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 3);
});

test('停止时清理退避定时器，重启可立即处理失败轮次的积压事件', async t => {
  const daemon = await fixture(t, [[{ type: 'end', reason: 'error' }]], [], undefined, [60_000, 120_000]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  await daemon.restart(new FakeDriver([[]]));
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2);
  assert.deepEqual(events.filter(event => event.action === 'round-ended').map(event => event.details.reason), ['error', 'completed']);
});

test('运行层暂停保留运行中派单，允许提交结论、自动提交与卡片收尾，恢复后投递结束事件', async t => {
  for (const cause of ['quota-exhausted', 'consecutive-failures', 'agent-unavailable'] as const) {
    for (const purpose of ['execution', 'verification'] as const) await t.test(`${cause}/${purpose}`, async t => {
      let ready!: () => void;
      const executorReady = new Promise<void>(resolve => { ready = resolve; });
      let release!: () => void;
      const hold = new Promise<void>(resolve => { release = resolve; });
      t.after(() => release());
      let pausedBrief: StartupBrief | undefined;
      let resumedBrief: StartupBrief | undefined;
      const failures: FakeScript[] = cause === 'consecutive-failures'
        ? [[{ type: 'end', reason: 'error' }], [{ type: 'end', reason: 'timed-out' }], [{ type: 'end', reason: 'context-overflow' }]]
        : cause === 'agent-unavailable' ? [[{ type: 'tool', name: 'get-work', arguments: ctx => ({ workId: workIdOf(ctx) }),
          check: () => { throw new RuleError('AGENT_UNAVAILABLE', '测试 Agent 不可用'); } }]]
        : [[{ type: 'end', reason: 'quota-exhausted' }]];
      const daemon = await fixture(t, [
        [draft], [create, { ...dispatch, arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id,
          key: 'dispatch', agentId: 'claude-executor', purpose }) }, { type: 'hang', until: executorReady }, ...failures[0] as FakeStep[]],
        ...failures.slice(1),
        ctx => {
          pausedBrief = JSON.parse(ctx.input);
          return [{ type: 'tool', name: 'complete-card', arguments: { workId: workIdOf(ctx),
            cardId: pausedBrief!.cardGraph.find(node => node.type === 'card')!.id }, check: ok }];
        },
        ctx => { resumedBrief = JSON.parse(ctx.input); return []; },
      ], [() => {
        ready();
        return [{ type: 'hang', until: hold }, { type: 'write', path: 'progress.txt', content: '暂停后完成的进度' },
          { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: purpose === 'verification' ? 'passed' : 'completed', reason: '暂停后正常结束' }, check: ok }];
      }]);
      const work = await daemon.begin();
      await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
      await daemon.confirm(work.id);
      const paused = await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
      assert.match(paused.result.runtimePauseReason, cause === 'quota-exhausted' ? /额度用完/ : cause === 'agent-unavailable' ? /Agent 不可用/ : /连续失败 3 次/);
      const before = (await daemon.events(work.id)).filter(event => event.action === 'round-started').length;
      assert.equal((await daemon.call('list-dispatches', { workId: work.id })).result[0].status, 'running');
      release();
      const events = await until(() => daemon.events(work.id), events => events.some(event => event.action === 'dispatch-ended'));
      const ended = events.find(event => event.action === 'dispatch-ended');
      const result = ended.details;
      assert.equal(result.endReason, 'completed');
      assert.equal(result.abortReason, null);
      assert.equal(result.conclusion, purpose === 'verification' ? 'passed' : 'completed');
      assert.equal(result.conclusionReason, '暂停后正常结束');
      assert.equal(events.some(event => event.action === 'dispatch-revoked'), false);
      if (purpose === 'verification') assert.equal(result.endCommit, result.startCommit);
      else {
        assert.notEqual(result.endCommit, result.startCommit);
        assert.equal(execFileSync('git', ['-C', daemon.repo, 'show', `${result.endCommit}:progress.txt`], { encoding: 'utf8' }), '暂停后完成的进度');
      }
      await new Promise(resolve => setTimeout(resolve, 50));
      assert.equal((await daemon.events(work.id)).filter(event => event.action === 'round-started').length, before);
      // A user can ask the paused coordinator to finish a card, without consuming its queued dispatch-ended event.
      ok(await daemon.call('send-message', { workId: work.id, key: 'finish-card', body: '收尾卡片' }));
      await until(() => daemon.events(work.id), events => events.some(event => event.action === 'card-completed'));
      assert.equal(pausedBrief!.work.status, 'paused');
      assert.deepEqual(pausedBrief!.wakeEvents.map(event => event.action), ['message-sent']);
      assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'paused');
      ok(await daemon.call('resume-work', { workId: work.id }));
      await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-started' && event.details.eventIds.includes(ended.id))
        && events.filter(event => event.action === 'round-ended').length === before + 2);
      assert.ok(resumedBrief!.wakeEvents.some(event => event.id === ended.id));
      assert.equal(resumedBrief!.work.status, 'executing');
    });
  }
});

test('运行层暂停期间排队派单不启动，恢复时即使没有新派单也会启动', async t => {
  let ready!: () => void;
  const executorReady = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  let resumedBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [[draft], [create, dispatch,
    { ...create, arguments: ctx => ({ workId: workIdOf(ctx), key: 'queued-card', content: '排队卡片' }) },
    { ...dispatch, arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'queued', agentId: 'claude-executor' }) },
    { type: 'hang', until: executorReady }, { type: 'end', reason: 'quota-exhausted' }],
    ctx => { resumedBrief = JSON.parse(ctx.input); return []; },
  ], [() => { ready(); return [{ type: 'hang', until: hold }]; }, [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '恢复后执行' }, check: ok }]]);
  ok(await daemon.call('set-concurrency', { limit: 1 }));
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  await daemon.confirm(work.id);
  await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  const dispatches = () => daemon.call('list-dispatches', { workId: work.id });
  assert.deepEqual((await dispatches()).result.map((item: any) => item.status), ['running', 'queued']);
  release();
  await until(dispatches, value => value.result[0].status === 'ended');
  // Force another queue scan while paused, in addition to the first dispatch's completion scan.
  ok(await daemon.call('set-concurrency', { limit: 2 }));
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal((await dispatches()).result[1].status, 'queued');
  ok(await daemon.call('resume-work', { workId: work.id }));
  const done = await until(dispatches, value => value.result.every((item: any) => item.status === 'ended'));
  assert.equal(done.result[1].endReason, 'completed');
  assert.equal(done.result[1].conclusion, 'completed');
  assert.ok(resumedBrief!.wakeEvents.some(event => event.action === 'dispatch-ended'));
});

test('用户手动暂停仍撤销运行中和排队派单，包括已被运行层暂停的工作', async t => {
  for (const runtimePaused of [false, true]) await t.test(String(runtimePaused), async t => {
    let ready!: () => void;
    const executorReady = new Promise<void>(resolve => { ready = resolve; });
    const daemon = await fixture(t, [[draft], [create, dispatch,
      { ...create, arguments: ctx => ({ workId: workIdOf(ctx), key: 'queued-card', content: '排队卡片' }) },
      { ...dispatch, arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'queued', agentId: 'claude-executor' }) },
      { type: 'hang', until: executorReady }, ...(runtimePaused ? [{ type: 'end', reason: 'quota-exhausted' } as FakeStep] : [])],
    ], [() => { ready(); return [{ type: 'write', path: 'partial.txt', content: '保留半成品' }, { type: 'hang' }]; }]);
    ok(await daemon.call('set-concurrency', { limit: 1 }));
    const work = await daemon.begin();
    await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
    await daemon.confirm(work.id);
    await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length === 2
      && events.some(event => event.action === 'dispatch-step'));
    assert.deepEqual((await daemon.call('list-dispatches', { workId: work.id })).result.map((item: any) => item.status), ['running', 'queued']);
    ok(await daemon.call('pause-work', { workId: work.id }));
    const results = (await daemon.call('list-dispatches', { workId: work.id })).result;
    for (const result of results) {
      assert.equal(result.status, 'ended');
      assert.equal(result.endReason, 'aborted');
      assert.equal(result.abortReason, '工作暂停');
      assert.equal(result.conclusion, 'undeclared');
    }
    assert.equal(execFileSync('git', ['-C', daemon.repo, 'show', `${results[0].endCommit}:partial.txt`], { encoding: 'utf8' }), '保留半成品');
    assert.equal((await daemon.call('get-work', { workId: work.id })).result.runtimePauseReason, null);
  });
});

test('轮次结束清理 _work 残留进程及同组的子进程，不触碰项目目录的进程', async t => {
  for (const outcome of ['completed', 'quota-exhausted', 'timed-out', 'ignores-sigterm'] as const) await t.test(outcome, async t => {
    const reason = outcome === 'ignores-sigterm' ? 'completed' : outcome;
    let child: ChildProcess | undefined;
    let outside: ChildProcess | undefined;
    let descendant = 0;
    const daemon = await fixture(t, [[draft], ctx => {
      child = spawn(process.execPath, ['-e', `
        const { spawn } = require('node:child_process');
        ${outcome === 'ignores-sigterm' ? "process.on('SIGTERM', () => {});" : ''}
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: '/', stdio: 'ignore' });
        child.once('spawn', () => console.log(child.pid));
        setInterval(() => {}, 1000);
      `], { cwd: ctx.options.cwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
      const ready = new Promise<void>(resolve => child!.stdout!.once('data', chunk => { descendant = Number(String(chunk).trim()); resolve(); }));
      return [{ type: 'hang', until: ready }, ...(reason === 'timed-out' ? [{ type: 'hang' } as FakeStep] : [{ type: 'end', reason } as FakeStep])];
    }, []]);
    outside = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { cwd: daemon.repo, detached: true, stdio: 'ignore' });
    t.after(() => {
      for (const processId of [child?.pid, outside?.pid]) if (processId) {
        try { process.kill(-processId, 'SIGKILL'); } catch { /* Already cleaned by helmd. */ }
      }
    });
    const work = await daemon.begin();
    await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
    if (reason === 'timed-out') ok(await daemon.call('set-round-watchdog', { totalTimeoutMs: 2000, idleTimeoutMs: 30_000 }));
    await daemon.confirm(work.id);
    const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length >= 2);
    assert.equal(events.filter(event => event.action === 'round-ended')[1].details.reason, reason, JSON.stringify(events.filter(event => event.action === 'round-ended')));
    assert.ok(child?.pid && descendant > 0);
    assert.throws(() => process.kill(child!.pid!, 0), { code: 'ESRCH' });
    assert.throws(() => process.kill(descendant, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(outside!.pid!, 0));
    const cleanup = events.find(event => event.action === 'round-processes-cleaned');
    assert.ok(cleanup.details.pids.includes(child.pid));
    assert.ok(cleanup.details.pgids.includes(child.pid));
  });
});

test('轮次重投依靠 key 不重复建卡和派单，执行者额度用完唤醒调度者', async t => {
  for (const purpose of ['execution', 'verification'] as const) await t.test(purpose, async t => {
    const keyedDispatch: FakeStep = { ...dispatch, arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'dispatch', agentId: 'claude-executor', purpose }) };
    let release!: () => void;
    const hold = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const daemon = await fixture(t, [
      [draft], [create, keyedDispatch, { type: 'crash' }],
      [create, keyedDispatch, { type: 'hang', until: hold }], [],
    ], [[{ type: 'compaction' }, { type: 'end', reason: 'quota-exhausted', usage: { inputTokens: 11, outputTokens: 7 } }]]);
    const work = await daemon.begin();
    await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
    await daemon.confirm(work.id);
    await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-started').length === 3 && events.some(event => event.action === 'dispatch-ended'));
    release();
    const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'round-ended').length >= 3
      && events.some(event => event.action === 'round-started' && event.details.eventIds.includes(events.find(item => item.action === 'dispatch-ended').id)));
    assert.equal(events.filter(event => event.action === 'card-created').length, 1);
    assert.equal(events.filter(event => event.action === 'dispatch-created').length, 1);
    const result = events.find(event => event.action === 'dispatch-ended').details;
    assert.equal(result.endReason, 'quota-exhausted');
    assert.equal(result.purpose, purpose);
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7 });
    if (purpose === 'verification') assert.equal(result.endCommit, result.startCommit);
    assert.equal(events.find(event => event.action === 'context-compacted').object.type, 'dispatch');
    assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'executing');
  });
});

test('卡片汇总全部派单 token，工作另加全部轮次 token，压缩事件挂在对应派单或轮次，重启不重复计数', async t => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await fixture(t, [
    [draft, { type: 'compaction' }, { type: 'end', reason: 'completed', usage: { inputTokens: 10, outputTokens: 5 } }],
    [create, dispatch, { type: 'hang', until: hold },
      { ...dispatch, arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'second', agentId: 'claude-executor' }) },
      { type: 'end', reason: 'completed', usage: { inputTokens: 20, outputTokens: 7 } }],
  ], [
    [{ type: 'compaction' }, { type: 'end', reason: 'quota-exhausted', usage: { inputTokens: 11, outputTokens: 7 } }],
    [{ type: 'end', reason: 'error', usage: { inputTokens: 5, outputTokens: 3 } }],
  ]);
  const work = await daemon.begin();
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'round-ended'));
  await daemon.confirm(work.id);
  await until(() => daemon.events(work.id), events => events.some(event => event.action === 'dispatch-ended'));
  release();
  const events = await until(() => daemon.events(work.id), events => events.filter(event => event.action === 'dispatch-ended').length === 2
    && events.filter(event => event.action === 'round-ended').length >= 2);
  const cardId = events.find(event => event.action === 'card-created').cardId;
  const checkTotals = async () => {
    const params = { workId: work.id, cardId };
    assert.deepEqual((await daemon.call('get-card', params)).result.usage, { inputTokens: 16, outputTokens: 10 });
    assert.deepEqual((await daemon.call('get-card-graph', { workId: work.id })).result.find((item: any) => item.id === cardId).usage, { inputTokens: 16, outputTokens: 10 });
    const settled = await until(() => daemon.call('get-work', { workId: work.id }), value => value.result.usage.inputTokens !== null && !value.result.usage.incomplete);
    assert.deepEqual(settled.result.usage, { inputTokens: 46, outputTokens: 22 });
    assert.deepEqual((await daemon.call('list-works')).result[0].usage, { inputTokens: 46, outputTokens: 22 });
  };
  await checkTotals();
  const compactions = events.filter(event => event.action === 'context-compacted');
  assert.equal(compactions.length, 2);
  assert.equal(compactions[0].object.type, 'coordinator-round');
  assert.equal(compactions[0].object.id, events.find(event => event.action === 'round-started').object.id);
  assert.equal(compactions[0].details.step, 2);
  assert.equal(compactions[1].object.type, 'dispatch');
  assert.equal(compactions[1].dispatchId, events.find(event => event.action === 'dispatch-created').dispatchId);
  await daemon.restart(new FakeDriver());
  await checkTotals();
});
