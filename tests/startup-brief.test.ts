import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { startupBrief } from '../src/rounds.js';
import { TaskStore, type Actor, type HelmEvent } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';

// 任务单 02（启动简报按需读取事件）：简报内容的契约，以及读事件表的行数不随步骤事件增长。
const user: Actor = { type: 'user', id: 'user' };
const runtime: Actor = { type: 'runtime', id: 'helmd' };
const round = (id: string): Actor => ({ type: 'coordinator-round', id });
const stepActions = ['dispatch-step', 'round-step', 'artifact-saved', 'round-agent-loaded'];

function fixture(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-startup-brief-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  for (const id of ['work', 'other']) {
    store.db.prepare("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES (?, 'project', 'executing', ?, '2026-10-30')").run(id, id);
  }
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const append = (actor: Actor, action: string, details: unknown = {}, object = { type: 'work', id: 'work' }, workId = 'work') =>
    store.transaction(() => store.appendEvent(actor, object, action, details, { workId }));
  const message = (id: string, body: string, withdrawn = false) => {
    const event = append(user, 'message-sent', { body }, { type: 'message', id });
    store.db.prepare(`INSERT INTO messages (id, work_id, sender, body, key, created_at, sequence, withdrawn_at)
      VALUES (?, 'work', 'user', ?, ?, ?, ?, ?)`).run(id, body, id, event.time, event.id, withdrawn ? event.time : null);
    return event;
  };
  const steps = (count: number) => store.transaction(() => {
    for (let index = 0; index < count; index++) {
      store.appendEvent({ type: 'dispatch', id: 'd1' }, { type: 'dispatch', id: 'd1' }, stepActions[index % stepActions.length]!, { index }, { workId: 'work' });
    }
  });
  return { store, append, message, steps };
}

// Rows fetched by statements that read the events table, counted where they leave SQLite.
function countEventRows(store: TaskStore, run: () => void) {
  const prepare = store.db.prepare;
  let rows = 0;
  store.db.prepare = function (sql: string) {
    const statement = prepare.call(store.db, sql);
    if (!/\bFROM events\b/.test(sql)) return statement;
    const all = statement.all.bind(statement), get = statement.get.bind(statement);
    statement.all = (...values: any[]) => { const result = all(...values); rows += result.length; return result; };
    statement.get = (...values: any[]) => { const result = get(...values); rows += result ? 1 : 0; return result; };
    return statement;
  } as typeof prepare;
  try { run(); } finally { store.db.prepare = prepare; }
  return rows;
}

// A scenario with a withdrawn message, a round to resume, step events on both sides of the round start, and wakes that predate it.
function scenario(ctx: ReturnType<typeof fixture>) {
  const { append, message, steps } = ctx;
  const earlyWake = message('m-early', '轮次开始前的唤醒');
  steps(8);
  const started = append(runtime, 'round-started', {}, { type: 'coordinator-round', id: 'r1' });
  const ownAction = append(round('r1'), 'card-created', { content: '本轮自己建的卡' }, { type: 'card', id: 'c1' });
  const dispatched = append(round('r0'), 'dispatch-created', { agent: { prompt: '整份提示词' }, agentId: 'claude-executor' }, { type: 'dispatch', id: 'd1' });
  steps(8);
  const withdrawn = message('m-withdrawn', '撤回正文', true);
  const kept = message('m-kept', '保留正文');
  const wake = append({ type: 'dispatch', id: 'd1' }, 'dispatch-ended', { agent: { prompt: '整份提示词' }, reason: 'completed' }, { type: 'dispatch', id: 'd1' });
  append(runtime, 'gate-created', {}, { type: 'gate', id: 'g-other' }, 'other');
  return { earlyWake, started, ownAction, dispatched, withdrawn, kept, wake };
}

test('事件查询按 ID 列表过滤、按动作排除，结果按 id 升序', t => {
  const ctx = fixture(t);
  const events = scenario(ctx);
  const ids = (list: HelmEvent[]) => list.map(event => event.id);
  assert.deepEqual(ids(ctx.store.events({ workId: 'work', ids: [events.wake.id, events.earlyWake.id, events.kept.id] })),
    [events.earlyWake.id, events.kept.id, events.wake.id]);
  assert.deepEqual(ctx.store.events({ workId: 'work', ids: [] }), []);
  assert.deepEqual(ids(ctx.store.events({ workId: 'other', ids: [events.wake.id] })), []);
  assert.deepEqual(ids(ctx.store.events({ workId: 'work', after: events.started.id, excludeActions: stepActions })),
    [events.ownAction.id, events.dispatched.id, events.withdrawn.id, events.kept.id, events.wake.id]);
  assert.deepEqual(ids(ctx.store.events({ workId: 'work', excludeActions: [] })), ids(ctx.store.events({ workId: 'work' })));
});

test('唤醒事件列表为空时不查询事件表', t => {
  const ctx = fixture(t);
  scenario(ctx);
  assert.equal(countEventRows(ctx.store, () => assert.deepEqual(ctx.store.events({ workId: 'work', ids: [] }), [])), 0);
});

test('简报的新事件略去步骤、撤回消息和唤醒事件，唤醒事件按 id 升序且可早于本轮开始', t => {
  const ctx = fixture(t);
  const events = scenario(ctx);
  const brief = startupBrief(ctx.store, 'work', [events.wake.id, events.earlyWake.id]);
  assert.deepEqual(brief.newEvents.map(event => event.id), [events.ownAction.id, events.dispatched.id, events.kept.id]);
  assert.deepEqual(brief.wakeEvents.map(event => event.id), [events.earlyWake.id, events.wake.id]);
  // Agent snapshots are dropped from dispatch events in both lists.
  assert.deepEqual(brief.newEvents[1]!.details, { agent: undefined, agentId: 'claude-executor' });
  assert.deepEqual(brief.wakeEvents[1]!.details, { agent: undefined, reason: 'completed' });
  assert.deepEqual(startupBrief(ctx.store, 'work', []).wakeEvents, []);
});

test('续跑轮次的简报略去本轮次自己产生的事件', t => {
  const ctx = fixture(t);
  const events = scenario(ctx);
  const brief = startupBrief(ctx.store, 'work', [events.wake.id], 'r1');
  assert.equal(brief.resumed, true);
  assert.deepEqual(brief.newEvents.map(event => event.id), [events.dispatched.id, events.kept.id]);
  assert.deepEqual(brief.wakeEvents.map(event => event.id), [events.wake.id]);
});

test('暂停工作的简报只带用户消息', t => {
  const ctx = fixture(t);
  const events = scenario(ctx);
  ctx.store.db.prepare("UPDATE works SET status = 'paused' WHERE id = 'work'").run();
  const brief = startupBrief(ctx.store, 'work', [events.wake.id]);
  assert.deepEqual(brief.newEvents.map(event => event.id), [events.kept.id]);
  assert.deepEqual(brief.wakeEvents.map(event => event.id), [events.wake.id]);
});

test('生成简报读出的事件行数与步骤事件数量无关，简报内容也不变', t => {
  const ctx = fixture(t);
  const events = scenario(ctx);
  const wakeIds = [events.earlyWake.id, events.wake.id];
  let before: unknown, after: unknown;
  const baseline = countEventRows(ctx.store, () => { before = startupBrief(ctx.store, 'work', wakeIds); });
  ctx.steps(2000);
  const withSteps = countEventRows(ctx.store, () => { after = startupBrief(ctx.store, 'work', wakeIds); });
  assert.deepEqual(after, before);
  assert.equal(withSteps, baseline);
  // 2 wakes + 3 new events after the round start + its MAX(id) row; the other reads here match no rows.
  assert.equal(baseline, 2 + 5 + 1);
});
