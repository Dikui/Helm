import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { FakeDriver } from '../src/driver.js';
import { migrations } from '../src/migrations.js';
import { startHelmd as startRealHelmd } from '../src/server.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';
import { TaskStore } from '../src/store.js';
import { AgentCatalog } from '../src/agents.js';
import { reviewReport } from './fixtures/review-report.js';

// Kept outside dist: this is a frozen historical fixture, not production SQL.
const legacySql = (await readFile(new URL('../../tests/fixtures/legacy-migrations.sql', import.meta.url), 'utf8'))
  .split('\n-- migration\n').slice(1);

test('工作说明允许空基准的迁移保留旧基准和派单引用，升级后可保存非 git 工作说明', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-description-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'helm.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const nullableBase = migrations.findIndex(sql => sql.includes('RENAME COLUMN base_ref TO legacy_base_ref'));
    assert.ok(nullableBase > 0);
    for (const [index, sql] of migrations.slice(0, nullableBase).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
    db.exec(`
      INSERT INTO projects (id, name, path, created_at) VALUES ('project', '旧项目', '/old/project', '2026-01-01');
      INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'start', '2026-01-01');
      INSERT INTO events (id, time, actor_type, actor_id, object_type, object_id, action, details, work_id)
        VALUES (1, '2026-01-01', 'runtime', 'test', 'gate', 'gate', 'gate-created', '{}', 'work');
      INSERT INTO gates (id, work_id, kind, status, question, created_at, sequence)
        VALUES ('gate', 'work', 'work-confirmation', 'decided', '确认', '2026-01-01', 1);
      INSERT INTO work_descriptions VALUES ('description', 'work', 1, 'active', 'brief', '需求', '边界', '标准', 'gate', 'main', 'old-commit');
      INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at)
        VALUES ('card', 'work', 'card', '旧卡片', 0, 'completed', '2026-01-01');
      INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path, work_description_id)
        VALUES ('dispatch', 'work', 'card', 'dispatch', 'execution', 'executor', '{}', '旧派单', 'ended', '2026-01-01', '/old/steps', 'description');
    `);
  } finally { db.close(); }
  const agents = new AgentCatalog(join(directory, 'agents'));
  let store = new TaskStore(directory, agents);
  try {
    assert.equal(store.descriptions('work')[0]!.baseRef, 'main');
    assert.equal(store.descriptions('work')[0]!.baseCommit, 'old-commit');
    assert.equal(store.db.prepare('SELECT work_description_id AS id FROM dispatches').get()!.id, 'description');
    assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(), []);
    store.db.exec("INSERT INTO work_descriptions VALUES ('plain', 'work', 2, 'draft', 'plain', '只读', '本机', '结论', 'gate', NULL, NULL)");
  } finally { store.close(); }
  store = new TaskStore(directory, agents);
  try {
    assert.equal(store.descriptions('work')[1]!.baseRef, null);
    assert.equal(store.descriptions('work')[1]!.baseCommit, null);
  } finally { store.close(); }
});

test('结构化报告迁移保留旧版审核正文，新版报告在重启后可读取', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-report-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'helm.db'));
  try {
    // Seed the last schema before structured reports, including a historical review.
    const beforeReport = migrations.findIndex(sql => sql.includes('ADD COLUMN report TEXT'));
    assert.ok(beforeReport > 0);
    for (const [index, sql] of migrations.slice(0, beforeReport).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
    db.exec(`
      INSERT INTO projects (id, name, path, created_at) VALUES ('project', '旧项目', '/old/project', '2026-01-01');
      INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'cancelled', 'start', '2026-01-01');
      INSERT INTO events (id, time, actor_type, actor_id, object_type, object_id, action, details, work_id)
        VALUES (1, '2026-01-01', 'coordinator-round', 'old-round', 'gate', 'legacy', 'gate-created', '{}', 'work');
      INSERT INTO gates (id, work_id, kind, status, question, body, options, created_at, sequence)
        VALUES ('legacy', 'work', 'review', 'pending', '审核', '## 旧版报告\n\n**保留原文**', '["accept","return"]', '2026-01-01', 1);
    `);
  } finally { db.close(); }
  const agents = new AgentCatalog(join(directory, 'agents'));
  let store = new TaskStore(directory, agents);
  const legacy = store.gate('work', 'legacy');
  assert.equal(legacy.report, null);
  assert.equal(legacy.body, '## 旧版报告\n\n**保留原文**');
  // Seed a persisted new-format row, then verify only through the store's read interface.
  const report = reviewReport();
  store.db.prepare('UPDATE gates SET report = ? WHERE id = ?').run(JSON.stringify(report), 'legacy');
  store.close();
  store = new TaskStore(directory, agents);
  try { assert.deepEqual(store.gate('work', 'legacy').report, report); }
  finally { store.close(); }
});

test('版本 1–10 的任务库保留已有记录并升级，重启后仍能读写', async t => {
  for (let version = 1; version <= 10; version++) await t.test(`version ${version}`, async t => {
    const dataDir = await mkdtemp(join(tmpdir(), 'helm-migrations-'));
    t.after(() => rm(dataDir, { recursive: true, force: true }));
    const repo = join(dataDir, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '--allow-empty', '-m', 'baseline'], { stdio: 'ignore' });
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
      db.prepare("UPDATE projects SET path = ? WHERE id = 'project'").run(repo);
    } finally { db.close(); }
    let daemon = await startHelmd({ dataDir, port: 0, driver: new FakeDriver(), executorDriver: new FakeDriver() });
    t.after(() => daemon.close());
    const call = async (name: string, params: object = {}) => {
      const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      const body = await response.json() as any;
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.ok, true, JSON.stringify(body));
      return body.result;
    };
    assert.equal((await call('list-projects'))[0].name, '旧项目');
    assert.equal((await call('list-projects'))[0].defaultCoordinatorAgentId, 'claude-coordinator');
    assert.equal((await call('get-work', { workId: 'work' })).status, 'aligning');
    assert.equal((await call('get-work', { workId: 'work' })).coordinatorAgentId, 'claude-coordinator');
    assert.equal((await call('get-conversation', { workId: 'work' }))[0].body, '升级前的消息');
    assert.equal((await call('get-conversation', { workId: 'work' }))[0].withdrawnAt, null);
    const settings = await call('get-settings');
    assert.equal(settings.concurrencyLimit, 3);
    assert.equal(settings.dispatchWallTimeoutMs, 1_800_000);
    assert.equal(settings.roundIdleTimeoutMs, 600_000);
    assert.equal(settings.outputThresholdBytes, 10_000_000_000);
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

test('去掉 Agent 表的迁移保留已有派单快照、卡片 Agent id 和成果关联', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'helm-agent-migration-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const outputPath = join(dataDir, 'steps');
  await mkdir(outputPath);
  const artifactPath = join(dataDir, 'artifact.txt');
  await writeFile(artifactPath, '旧成果');
  const snapshot = { id: 'legacy-executor', role: 'executor', model: 'legacy-model', reasoningEffort: 'high' };
  const db = new DatabaseSync(join(dataDir, 'helm.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    for (const sql of legacySql) db.exec(sql);
    db.exec(`
      INSERT INTO projects VALUES ('project', '旧项目', '/legacy/project', '2026-01-01');
      INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'paused', 'start', '2026-01-01');
      INSERT INTO agent_templates VALUES ('legacy-executor', 'executor', 'different-current-model', 'low');
      INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at, template_id, latest_dispatch_id)
        VALUES ('card', 'work', 'card-key', '旧卡片', 0, 'executing', '2026-01-01', 'legacy-executor', 'dispatch');
    `);
    db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, template_id, template_snapshot, content, status, created_at, output_path, end_reason, final_answer)
      VALUES ('dispatch', 'work', 'card', 'dispatch-key', 'execution', 'legacy-executor', ?, '旧派单', 'ended', '2026-01-01', ?, 'completed', '旧回答')`)
      .run(JSON.stringify(snapshot), outputPath);
    db.prepare(`INSERT INTO artifacts VALUES ('artifact', 'dispatch', 'file', 'result.txt', ?, NULL, NULL)`).run(artifactPath);
  } finally { db.close(); }
  const daemon = await startHelmd({ port: 0, dataDir });
  t.after(() => daemon.close());
  const call = async (name: string, params: object) => {
    const body = await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  assert.deepEqual((await call('get-dispatch', { workId: 'work', dispatchId: 'dispatch' })).agent, snapshot);
  const card = await call('get-card', { workId: 'work', cardId: 'card' });
  assert.equal(card.agentId, 'legacy-executor');
  assert.equal(card.readOnly, false, '已有卡片迁移后按写代码处理');
  assert.equal((await call('get-dispatch-artifacts', { workId: 'work', dispatchId: 'dispatch' }))[0].id, 'artifact');
  assert.equal((await call('read-artifact', { workId: 'work', artifactId: 'artifact' })).content, '旧成果');
});

test('模板改名为 Agent 的迁移改写列名和事件，已有工作时一次性生成原内置 Agent', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'helm-agent-rename-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const db = new DatabaseSync(join(dataDir, 'helm.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const rename = migrations.findIndex(sql => sql.includes('RENAME COLUMN template_id TO agent_id'));
    for (const [index, sql] of migrations.slice(0, rename).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
    db.exec(`
      INSERT INTO projects (id, name, path, created_at) VALUES ('project', '旧项目', '/legacy/project', '2026-01-01');
      INSERT INTO works (id, project_id, status, creation_key, created_at, coordinator_template_id)
        VALUES ('work', 'project', 'paused', 'start', '2026-01-01', 'codex-coordinator');
      INSERT INTO events (time, actor_type, actor_id, object_type, object_id, action, details, work_id) VALUES
        ('2026-01-01', 'user', 'user', 'work', 'work', 'coordinator-template-changed', '{"previousTemplateId":"claude-coordinator","templateId":"codex-coordinator"}', 'work'),
        ('2026-01-01', 'runtime', 'helmd', 'agent-template', 'grok-executor', 'needs-user-attention', '{"kind":"template-unavailable","templateId":"grok-executor"}', NULL);
    `);
  } finally { db.close(); }
  const daemon = await startRealHelmd({ port: 0, dataDir, drivers: { 'claude-sdk': new FakeDriver(), codex: new FakeDriver(), grok: new FakeDriver(), deepseek: new FakeDriver() } });
  t.after(() => daemon.close());
  const call = async (name: string, params: object = {}) => {
    const body = await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  assert.equal((await call('get-work', { workId: 'work' })).coordinatorAgentId, 'codex-coordinator');
  const changed = (await call('get-events', { workId: 'work' })).find((event: any) => event.action === 'coordinator-agent-changed');
  assert.deepEqual(changed.details, { previousAgentId: 'claude-coordinator', agentId: 'codex-coordinator' });
  assert.deepEqual((await call('list-agents')).map((agent: any) => agent.id),
    ['claude-coordinator', 'claude-executor', 'codex-coordinator', 'codex-executor', 'deepseek-executor', 'grok-executor']);
  assert.equal(await readFile(join(dataDir, 'agents', 'codex-coordinator', 'prompt.md'), 'utf8'), '');
});

test('全新安装不生成任何 Agent', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'helm-fresh-agents-'));
  t.after(() => rm(dataDir, { recursive: true, force: true }));
  const daemon = await startRealHelmd({ port: 0, dataDir, drivers: { 'claude-sdk': new FakeDriver(), codex: new FakeDriver(), grok: new FakeDriver(), deepseek: new FakeDriver() } });
  t.after(() => daemon.close());
  const body = await (await fetch(`${daemon.url}/api/list-agents`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as any;
  assert.deepEqual(body.result, []);
});

test('合入即完成迁移转换 merged / pushing、清空暂停字段并把中断推送记为可重试失败', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'helm-delivery-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new DatabaseSync(join(directory, 'helm.db'));
  try {
    db.exec('PRAGMA foreign_keys = ON');
    const migration = migrations.findIndex(sql => sql.includes('Merge is terminal'));
    assert.ok(migration > 0);
    for (const [index, sql] of migrations.slice(0, migration).entries()) db.exec(`${sql}\nPRAGMA user_version = ${index + 1};`);
    db.exec(`INSERT INTO projects (id, name, path, created_at) VALUES ('project', '旧交付', '/missing/project', '2026-01-01');`);
    for (const status of ['merged', 'pushing']) {
      db.prepare(`INSERT INTO works (id, project_id, status, creation_key, created_at, base_ref, paused_from_status, runtime_pause_reason)
        VALUES (?, 'project', ?, ?, '2026-01-01', 'main', 'executing', 'old pause')`).run(status, status, status);
      db.prepare(`INSERT INTO events (time, actor_type, actor_id, object_type, object_id, action, details, work_id)
        VALUES ('2026-01-01', 'runtime', 'helmd', 'work', ?, 'base-merge-result', ?, ?)`)
        .run(status, JSON.stringify({ status: 'merged', baseBranch: 'refs/heads/main', workBranch: `helm/${status}` }), status);
    }
    db.exec(`INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('finished', 'project', 'completed', 'finished', '2026-01-01');`);
  } finally { db.close(); }
  const agents = new AgentCatalog(join(directory, 'agents'));
  let store = new TaskStore(directory, agents);
  for (const id of ['merged', 'pushing']) {
    assert.equal(store.work(id).status, 'completed');
    assert.equal(store.work(id).runtimePauseReason, null);
    assert.equal(store.db.prepare('SELECT paused_from_status FROM works WHERE id = ?').get(id)!.paused_from_status, null);
    const events = store.events({ workId: id });
    const completion = events.filter(event => event.action === 'work-completed');
    assert.equal(completion.length, 1);
    assert.equal((completion[0]!.details as any).merge.status, 'merged');
    const pushes = events.filter(event => event.action === 'base-push-result');
    assert.equal(pushes.length, id === 'pushing' ? 1 : 0);
    if (id === 'pushing') {
      assert.equal((pushes[0]!.details as any).status, 'failed');
      assert.equal((pushes[0]!.details as any).baseBranch, 'refs/heads/main');
      assert.match((pushes[0]!.details as any).reason, /中断.*可重试/);
    }
  }
  const count = store.events({}).length;
  store.close();
  store = new TaskStore(directory, agents);
  try {
    assert.equal(store.events({}).length, count);
    assert.equal(store.work('finished').status, 'completed');
  } finally { store.close(); }
});
