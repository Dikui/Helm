import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { getDispatch, listDispatches } from '../src/dispatch.js';
import { migrations } from '../src/migrations.js';
import { TaskStore } from '../src/store.js';

test('移除只读事后检查后历史派单仍可读，历史违规事件原样保留，重启不重复迁移', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-drop-read-only-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'helm.db'));
  const cleanup = migrations.findIndex(sql => sql.includes('DROP COLUMN read_only_snapshot'));
  const beforeCleanup = cleanup < 0 ? migrations.length : cleanup;
  const check = { status: 'violated', paths: ['report.md'], projectDirectory: true };
  try {
    for (const [index, sql] of migrations.slice(0, beforeCleanup).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
    db.exec(`
      INSERT INTO projects (id, name, path, created_at) VALUES ('project', '旧项目', '/old/project', '2026-01-01');
      INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'work', '2026-01-01');
      INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at)
        VALUES ('card', 'work', 'card', '历史卡片', 0, 'ready', '2026-01-01');
      INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path, final_answer)
        VALUES ('dispatch', 'work', 'card', 'dispatch', 'execution', 'executor', '{}', '{"readOnly":true}', 'ended', '2026-01-01', '/old/steps', '旧报告');
    `);
    db.prepare('UPDATE dispatches SET read_only_snapshot = ?, read_only_check = ?').run('{"head":"old"}', JSON.stringify(check));
    db.prepare(`INSERT INTO events (time, actor_type, actor_id, object_type, object_id, action, details, work_id, card_id, dispatch_id)
      VALUES ('2026-01-01', 'runtime', 'helmd', 'dispatch', 'dispatch', 'dispatch-read-only-violated', ?, 'work', 'card', 'dispatch')`).run(JSON.stringify(check));
  } finally { db.close(); }
  for (let restart = 0; restart < 2; restart++) {
    const store = new TaskStore(directory, new AgentCatalog(join(directory, 'agents')));
    try {
      const dispatch = getDispatch(store, 'work', 'dispatch');
      assert.equal('readOnlyCheck' in dispatch, false);
      assert.equal(dispatch.finalAnswer, '旧报告');
      assert.equal(dispatch.content, '{"readOnly":true}');
      assert.deepEqual(listDispatches(store, 'work', 'card'), [dispatch]);
      const columns = store.db.prepare('PRAGMA table_info(dispatches)').all().map(column => column.name);
      assert.equal(columns.includes('read_only_snapshot'), false);
      assert.equal(columns.includes('read_only_check'), false);
      const events = store.events({ workId: 'work', dispatchId: 'dispatch' });
      assert.equal(events.length, 1);
      assert.equal(events[0]!.action, 'dispatch-read-only-violated');
      assert.deepEqual(events[0]!.details, check);
      assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    } finally { store.close(); }
  }
});
