import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { addDependency, cancelCard, cardDetails, cardGraph, createCard, proposeGate, refreshCardReadiness, removeDependency, updateCard, withdrawGate, type NodeRef } from '../src/graph.js';
import { completeCard } from '../src/completion.js';
import { migrations } from '../src/migrations.js';
import { requestReview, reviewDetails } from '../src/review.js';
import { TaskStore } from '../src/store.js';
import { noticeStall } from '../src/work-control.js';
import { reviewReport } from './fixtures/review-report.js';

const actor = { type: 'coordinator-round', id: 'round' } as const;
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'helm-skipped-'));
  const store = new TaskStore(directory, new AgentCatalog(join(directory, 'agents')));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.db.exec(`INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', '/unused/skipped', '2026-01-01');
    INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('w', 'p', 'executing', 'start', '2026-01-01');`);
  const card = (key: string, aggregate = false, needsVerification = false) => createCard(store, actor, { workId: 'w', key, content: key, aggregate, needsVerification });
  const ref = (node: { id: string }, type: NodeRef['type'] = 'card'): NodeRef => ({ type, id: node.id });
  const edge = (upstream: { id: string }, downstream: { id: string }, type: NodeRef['type'] = 'card') => ({ workId: 'w', upstream: ref(upstream, type), downstream: ref(downstream) });
  const link = (upstream: { id: string }, downstream: { id: string }, type: NodeRef['type'] = 'card') => addDependency(store, actor, edge(upstream, downstream, type));
  const status = (node: { id: string }) => cardDetails(store, 'w', node.id).status;
  const cancel = (node: { id: string }) => cancelCard(store, actor, { workId: 'w', cardId: node.id, reason: '取消方向' });
  const dispatch = (node: { id: string }, purpose: string, state: string) => {
    const id = `dispatch-${node.id}`;
    store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path)
      VALUES (?, 'w', ?, ?, ?, 'executor', '{}', '执行', ?, '2026-01-01', '/unused')`).run(id, node.id, id, purpose, state);
    store.db.prepare('UPDATE cards SET latest_dispatch_id = ? WHERE id = ?').run(id, node.id);
    return id;
  };
  return { directory, store, card, edge, link, status, cancel, dispatch };
}

test('删除致因依赖恢复等待 / 可派单；按拓扑而非建卡顺序传播并恢复', t => {
  const { store, card, link, edge, status, cancel } = fixture(t);
  const leaf = card('leaf'), middle = card('middle'), upstream = card('upstream'), other = card('other');
  link(upstream, middle); link(middle, leaf); link(other, middle);
  cancel(upstream);
  assert.equal(status(middle), 'skipped'); assert.equal(status(leaf), 'skipped');
  removeDependency(store, actor, edge(upstream, middle));
  assert.equal(status(middle), 'waiting'); assert.equal(status(leaf), 'waiting');
  removeDependency(store, actor, edge(other, middle));
  assert.equal(status(middle), 'ready'); assert.equal(status(leaf), 'waiting');
  removeDependency(store, actor, edge(middle, leaf));
  assert.equal(status(leaf), 'ready');
  const events = store.events({ workId: 'w' });
  assert.ok(events.some(event => event.cardId === middle.id && event.action === 'card-waiting' && (event.details as any).previousStatus === 'skipped'));
  assert.ok(events.some(event => event.cardId === leaf.id && event.action === 'card-ready'));
  const before = events.length;
  refreshCardReadiness(store, 'w');
  assert.equal(store.events({ workId: 'w' }).length, before);
});

test('撤回关卡跨卡片和关卡链传播，删除关卡依赖后恢复', t => {
  const { store, card, link, edge, status } = fixture(t);
  const gate = proposeGate(store, actor, { workId: 'w', key: 'gate', question: '发布？' });
  const second = proposeGate(store, actor, { workId: 'w', key: 'second', question: '确认？' });
  const child = card('child'), leaf = card('leaf');
  addDependency(store, actor, { workId: 'w', upstream: { type: 'gate', id: gate.id }, downstream: { type: 'gate', id: second.id } });
  link(second, child, 'gate'); link(child, leaf);
  withdrawGate(store, actor, { workId: 'w', gateId: gate.id, reason: '撤回' });
  assert.equal(status(child), 'skipped'); assert.equal(status(leaf), 'skipped');
  const node = cardGraph(store, 'w').find(node => node.id === leaf.id);
  assert.ok(node?.type === 'card');
  assert.deepEqual(node.skippedBy, [{ type: 'gate', id: gate.id, title: '发布？', status: 'withdrawn' }]);
  removeDependency(store, actor, edge(second, child, 'gate'));
  assert.equal(status(child), 'ready'); assert.equal(status(leaf), 'waiting');
});

test('汇总卡片吸收取消 / 撤回 / 跳过分支，只等其余上游；全部无效才跳过，空依赖可派单', t => {
  const { store, card, link, status, cancel } = fixture(t);
  const source = card('source'), skipped = card('skipped'), remaining = card('remaining');
  const aggregate = card('aggregate', true), downstream = card('downstream');
  const gate = proposeGate(store, actor, { workId: 'w', key: 'gate', question: '选择？' });
  link(source, skipped); link(skipped, aggregate); link(remaining, aggregate); link(gate, aggregate, 'gate'); link(aggregate, downstream);
  cancel(source); withdrawGate(store, actor, { workId: 'w', gateId: gate.id, reason: '撤回' });
  assert.equal(status(skipped), 'skipped'); assert.equal(status(aggregate), 'waiting'); assert.equal(status(downstream), 'waiting');
  store.db.prepare("UPDATE cards SET status = 'completed' WHERE id = ?").run(remaining.id);
  refreshCardReadiness(store, 'w');
  assert.equal(status(aggregate), 'ready'); assert.equal(status(downstream), 'waiting');
  updateCard(store, actor, { workId: 'w', cardId: aggregate.id, aggregate: false });
  assert.equal(status(aggregate), 'skipped'); assert.equal(status(downstream), 'skipped');
  const updated = updateCard(store, actor, { workId: 'w', cardId: aggregate.id, aggregate: true });
  assert.equal(updated.aggregate, true); assert.equal(updated.status, 'ready'); assert.equal(status(downstream), 'waiting');
  assert.equal(status(card('empty-aggregate', true)), 'ready');
  const a = card('a'), b = card('b'), all = card('all', true);
  link(a, all); link(b, all); cancel(a);
  assert.equal(status(all), 'waiting'); cancel(b); assert.equal(status(all), 'skipped');
});

test('暂停、完成、取消、排队及运行派单保持原状态，活动派单结束后才跳过；恢复历史执行 / 验收状态', t => {
  const { store, card, link, edge, status, cancel, dispatch } = fixture(t);
  const source = card('source');
  const protectedStates = ['paused', 'completed', 'cancelled', 'queued', 'running'];
  const children = protectedStates.map(state => {
    const child = card(state); link(source, child);
    if (state === 'queued' || state === 'running') dispatch(child, 'execution', state);
    store.db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(state === 'queued' || state === 'running' ? 'executing' : state, child.id);
    return child;
  });
  cancel(source);
  assert.deepEqual(children.map(status), ['paused', 'completed', 'cancelled', 'executing', 'executing']);
  for (const purpose of ['execution', 'verification']) {
    const child = card(purpose); dispatch(child, purpose, 'ended');
    // Existing dependencies are retained when an upstream becomes inactive.
    store.db.prepare("INSERT INTO dependencies VALUES ('w', 'card', ?, 'card', ?)").run(source.id, child.id);
    refreshCardReadiness(store, 'w'); assert.equal(status(child), 'skipped');
    assert.throws(() => completeCard(store, actor, { workId: 'w', cardId: child.id }), { code: 'CARD_NOT_COMPLETABLE' });
    removeDependency(store, actor, edge(source, child));
    assert.equal(status(child), purpose === 'execution' ? 'executing' : 'verifying');
  }
  const behindActive = card('behind-active'); link(children[4]!, behindActive);
  assert.equal(status(behindActive), 'skipped', '活动派单保持状态，其下游仍能看见普通卡片链里的取消原因');
  store.db.exec("UPDATE dispatches SET status = 'ended'");
  refreshCardReadiness(store, 'w');
  assert.deepEqual(children.map(status), ['paused', 'completed', 'cancelled', 'skipped', 'skipped']);
});

test('跳过卡片不阻止审核、不算整体验收必需卡片，结束后不误报工作停住；仍有待办时会报告', t => {
  const { store, card, link, cancel } = fixture(t);
  const source = card('source'), child = card('child'), overall = card('overall', true, true);
  link(source, child); cancel(source);
  // overall has no dependencies on the inactive cards; neither is required coverage.
  const details = (reviewDetails(store, { kind: 'review', workId: 'w' }) as { review?: { overallVerification: { cardId: string }[] } }).review!;
  assert.deepEqual(details.overallVerification.map(item => item.cardId), [overall.id]);
  noticeStall(store, 'w', 'unfinished');
  // Cancellation wakes are cleared as they would be after a round claims them.
  store.db.exec('DELETE FROM wake_queue');
  noticeStall(store, 'w', 'unfinished');
  assert.equal(store.events({ workId: 'w' }).filter(event => event.action === 'work-stalled').length, 1);
  store.db.prepare("UPDATE cards SET status = 'completed' WHERE id = ?").run(overall.id);
  noticeStall(store, 'w', 'finished');
  assert.equal(store.events({ workId: 'w' }).filter(event => event.action === 'work-stalled').length, 1);
  assert.equal(requestReview(store, actor, { workId: 'w', key: 'review', report: reviewReport() }).status, 'pending');
});

test('汇总字段迁移保留旧卡片和依赖，默认 false，支持 skipped 并在重开后保持', t => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-aggregate-migration-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'helm.db'));
  const version = migrations.findIndex(sql => sql.includes('ADD COLUMN aggregate'));
  assert.ok(version > 0);
  for (const [index, sql] of migrations.slice(0, version).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
  db.exec(`INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'p', '/unused', '2026-01-01');
    INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('w', 'p', 'executing', 'start', '2026-01-01');
    INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at) VALUES ('c', 'w', 'old', '旧卡片', 0, 'waiting', '2026-01-01'), ('up', 'w', 'up', '上游', 0, 'cancelled', '2026-01-01');
    INSERT INTO dependencies VALUES ('w', 'card', 'up', 'card', 'c');`);
  db.close();
  const agents = new AgentCatalog(join(directory, 'agents'));
  let store = new TaskStore(directory, agents);
  assert.equal(cardDetails(store, 'w', 'c').aggregate, false);
  assert.equal(cardDetails(store, 'w', 'c').content, '旧卡片');
  assert.throws(() => store.db.exec("UPDATE cards SET aggregate = 2 WHERE id = 'c'"), /CHECK/);
  updateCard(store, actor, { workId: 'w', cardId: 'c', aggregate: true });
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM dependencies').get()!.n, 1);
  store.close(); store = new TaskStore(directory, agents);
  try { assert.equal(cardDetails(store, 'w', 'c').aggregate, true); assert.equal(cardDetails(store, 'w', 'c').status, 'skipped'); }
  finally { store.close(); }
});
