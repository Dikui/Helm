import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { FakeDriver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';

// Kept outside dist: this is a frozen historical fixture, not production SQL.
const legacySql = (await readFile(new URL('../../tests/fixtures/legacy-migrations.sql', import.meta.url), 'utf8'))
  .split('\n-- migration\n').slice(1);

test('版本 1–10 的任务库保留已有记录并升级，重启后仍能读写', async t => {
  for (let version = 1; version <= 10; version++) await t.test(`version ${version}`, async t => {
    const dataDir = await mkdtemp(join(tmpdir(), 'helm-migrations-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const db = new DatabaseSync(join(dataDir, 'helm.db'));
    try {
      db.exec('PRAGMA foreign_keys = ON');
      for (const sql of legacySql.slice(0, version)) db.exec(sql);
      db.exec(`
        UPDATE settings SET concurrency_limit = 3;
        INSERT INTO projects VALUES ('project', '旧项目', '/legacy/project', '2026-01-01T00:00:00.000Z');
        INSERT INTO works (id, project_id, status, creation_key, created_at)
          VALUES ('work', 'project', 'aligning', 'start', '2026-01-01T00:00:00.000Z');
        INSERT INTO events (id, time, actor_type, actor_id, object_type, object_id, action, details, work_id)
          VALUES (1, '2026-01-01T00:00:00.000Z', 'user', 'user', 'work', 'work', 'message-sent', '{}', 'work');
        INSERT INTO messages (id, work_id, sender, body, key, created_at, sequence)
          VALUES ('message', 'work', 'user', '升级前的消息', 'old', '2026-01-01T00:00:00.000Z', 1);
      `);
    } finally { db.close(); }
    let daemon = await startHelmd({ dataDir, port: 0, driver: new FakeDriver(), executorDriver: new FakeDriver() });
    t.after(() => daemon.close());
    const call = async (name: string, params: object = {}) => {
      const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) });
      const body = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.ok, true, JSON.stringify(body));
      return body.result;
    };
    assert.equal((await call('list-projects'))[0].name, '旧项目');
    assert.equal((await call('get-work', { workId: 'work' })).status, 'aligning');
    assert.equal((await call('get-conversation', { workId: 'work' }))[0].body, '升级前的消息');
    const settings = await call('get-settings');
    assert.equal(settings.concurrencyLimit, 3);
    assert.equal(settings.dispatchWallTimeoutMs, 1_800_000);
    assert.equal(settings.roundIdleTimeoutMs, 600_000);
    await call('send-message', { workId: 'work', body: '升级后的消息', key: 'new' });
    await daemon.close();
    daemon = await startHelmd({ dataDir, port: 0, driver: new FakeDriver(), executorDriver: new FakeDriver() });
    assert.deepEqual((await call('get-conversation', { workId: 'work' })).map((item: any) => item.body),
      ['升级前的消息', '升级后的消息']);
  });
});

test('任务库版本高于程序支持的迁移时拒绝启动', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'helm-future-migration-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dataDir, 'helm.db'));
  db.exec('PRAGMA user_version = 2147483647');
  db.close();
  await assert.rejects(startHelmd({ dataDir, port: 0 }), /Unsupported task store version: 2147483647/);
});
