import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { TaskStore } from '../src/store.js';
import { listWorks } from '../src/work-reads.js';

test('工作摘要按卡片图顺序读取状态，区分已结束派单的失败与受阻，不改变任务库状态', t => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-work-summary-'));
  const store = new TaskStore(directory, new AgentCatalog(join(directory, 'agents')));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.db.exec(`INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', '/unused', '2026-01-01');
    INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES
      ('work', 'p', 'executing', 'start', '2026-01-01'), ('empty', 'p', 'aligning', 'empty', '2026-01-02');`);
  const card = store.db.prepare(`INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at) VALUES (?, 'work', ?, ?, 0, ?, ?)`);
  // Insert in a different order; creation time and then id must match the card graph.
  for (const [id, status, time] of [
    ['z', 'ready', '2026-01-02'], ['g', 'skipped', '2026-01-01'], ['f', 'waiting', '2026-01-01'],
    ['e', 'executing', '2026-01-01'], ['d', 'verifying', '2026-01-01'], ['c', 'verifying', '2026-01-01'],
    ['b', 'executing', '2026-01-01'], ['a', 'completed', '2026-01-01'], ['h', 'cancelled', '2026-01-01'], ['i', 'paused', '2026-01-01'],
  ]) card.run(id!, id!, id!, status!, time!);
  const dispatch = store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, conclusion, created_at, output_path)
    VALUES (?, 'work', ?, ?, ?, 'executor', '{}', '执行', ?, ?, '2026-01-01', '/unused')`);
  for (const [id, purpose, state, conclusion] of [
    ['a', 'verification', 'ended', 'failed'], // Terminal state wins over historical failure.
    ['b', 'execution', 'running', 'blocked'], // A conclusion is not final until the dispatch ends.
    ['c', 'verification', 'ended', 'failed'], ['d', 'verification', 'running', 'undeclared'],
    ['e', 'execution', 'ended', 'blocked'], ['f', 'execution', 'ended', 'blocked'], // Dependency waiting stays waiting.
    ['g', 'verification', 'ended', 'failed'],
  ]) {
    dispatch.run(`dispatch-${id}`, id!, `dispatch-${id}`, purpose!, state!, conclusion!);
    store.db.prepare('UPDATE cards SET latest_dispatch_id = ? WHERE id = ?').run(`dispatch-${id}`, id!);
  }
  const [work, empty] = listWorks(store);
  assert.deepEqual(work!.cardStatuses, ['completed', 'executing', 'verification-failed', 'verifying', 'blocked', 'waiting', 'skipped', 'cancelled', 'paused', 'ready']);
  assert.equal(work!.totalCards, 10);
  assert.equal(work!.completedCards, 1);
  assert.deepEqual(empty!.cardStatuses, []);
  assert.equal(store.db.prepare('SELECT status FROM cards WHERE id = ?').get('c')!.status, 'verifying');
  // Retrying uses the latest dispatch, so the previous failure must disappear.
  dispatch.run('retry', 'c', 'retry', 'execution', 'running', 'undeclared');
  store.db.prepare("UPDATE cards SET latest_dispatch_id = 'retry', status = 'executing' WHERE id = 'c'").run();
  assert.equal(listWorks(store)[0]!.cardStatuses[2], 'executing');
});

test('调度者轮次还在跑时，工作说明确认关卡不算等你处理', t => {
  const directory = mkdtempSync(join(tmpdir(), 'helm-work-summary-'));
  const store = new TaskStore(directory, new AgentCatalog(join(directory, 'agents')));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.db.exec(`INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', '/unused', '2026-01-01');
    INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'p', 'aligning', 'start', '2026-01-01');
    INSERT INTO coordinator_rounds (id, work_id, status, started_at, event_ids, output_path) VALUES ('round', 'work', 'running', '2026-01-01', '[]', '/unused');`);
  const event = store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'gate', id: 'gate' }, 'gate-created', { kind: 'work-confirmation' }, { workId: 'work' });
  store.db.prepare(`INSERT INTO gates (id, work_id, kind, status, question, created_at, sequence) VALUES ('gate', 'work', 'work-confirmation', 'pending', '确认工作说明', ?, ?)`).run(event.time, event.id);
  assert.equal(listWorks(store)[0]!.hasPendingGate, false);
  store.db.prepare(`UPDATE coordinator_rounds SET status = 'ended' WHERE id = 'round'`).run();
  assert.equal(listWorks(store)[0]!.pendingGates[0]!.kind, 'work-confirmation');
});
