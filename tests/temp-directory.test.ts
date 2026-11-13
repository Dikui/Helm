import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { createDispatch, getDispatch, submitConclusion } from '../src/dispatch.js';
import { FakeDriver, type Driver, type SessionOptions } from '../src/driver.js';
import { ExecutionRunner } from '../src/execution.js';
import { createCard, updateCard } from '../src/graph.js';
import { cancelCard, completeCard } from '../src/completion.js';
import { reconcileStartup } from '../src/reconcile.js';
import { removeCoordinatorDirectory } from '../src/coordinator-directory.js';
import { TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';

// 任务单 12 / ADR 0030：临时数据目录的分配、复用和清理。
const actor = { type: 'runtime', id: 'test' } as const;

function fixture(t: TestContext, execute: (options: SessionOptions, input: any) => void = () => {}) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-temp-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir, ['claude-sdk', 'codex', 'grok', 'deepseek']));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-11-13')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'work', '2026-11-13')");
  const starts: SessionOptions[] = [];
  // Fake driver replaces the CLI; it records the environment the runtime assembled.
  const driver: Driver = {
    capabilities: new FakeDriver().capabilities,
    async checkAvailability() { return { available: true }; },
    async start(options) {
      assert.ok(existsSync(options.env.TMPDIR!), '驱动启动前临时数据目录已存在');
      starts.push(options);
      return { id: `session-${starts.length}`, async send(input) { execute(options, JSON.parse(input)); }, cancel() {},
        events: (async function* () { yield { type: 'end' as const, step: 1, reason: 'completed' as const, finalAnswer: '完成', usage: { inputTokens: 1, outputTokens: 1 } }; })() };
    },
  };
  const runner = new ExecutionRunner(store, { 'claude-sdk': driver, codex: driver, grok: driver, deepseek: driver }, 'http://unused.invalid/mcp');
  t.after(async () => { await runner.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const run = async (cardId: string, purpose: 'execution' | 'verification' = 'execution') => {
    const created = await createDispatch(store, actor, { workId: 'work', cardId, key: `dispatch-${starts.length}-${purpose}`, agentId: 'claude-executor', purpose });
    await runner.settle('work', cardId);
    return getDispatch(store, 'work', created.id);
  };
  return { store, runner, directory, starts, run };
}

test('同一卡片的执行和验收派单共用临时数据目录，上次写入的文件仍在，卡片完成后删除', async t => {
  const ctx = fixture(t, (options, input) => {
    if (input.purpose === 'execution') writeFileSync(join(options.env.TMPDIR!, 'download.bin'), 'cached');
    else {
      assert.equal(readFileSync(join(options.env.TMPDIR!, 'download.bin'), 'utf8'), 'cached');
      submitConclusion(ctx.store, ctx.runner.authenticate(options.mcpServers.helm!.headers!.Authorization!)!, { conclusion: 'passed', reason: '已核查' });
    }
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'card', content: '调研', workspace: 'scratch' });
  updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, needsVerification: true });
  assert.equal((await ctx.run(card.id)).endReason, 'completed');
  assert.equal((await ctx.run(card.id, 'verification')).conclusion, 'passed');
  const path = join(ctx.store.dataDir, 'tmp', card.id);
  assert.deepEqual(ctx.starts.map(options => [options.env.TMPDIR, options.env.TMP, options.env.TEMP]), [[path, path, path], [path, path, path]]);
  assert.equal(readFileSync(join(path, 'download.bin'), 'utf8'), 'cached');
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  assert.equal(existsSync(path), false);
});

for (const workspace of ['scratch', 'copy'] as const) test(`取消${workspace}卡片删除它的临时数据目录`, async t => {
  const ctx = fixture(t);
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'card', content: '调研', workspace });
  const path = join(ctx.store.dataDir, 'tmp', card.id);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'partial'), 'x');
  assert.equal(cancelCard(ctx.store, actor, { workId: 'work', cardId: card.id, reason: '不需要' }).status, 'cancelled');
  assert.equal(existsSync(path), false);
});

test('工作结束时一并删除仍未完成的卡片的临时数据目录', async t => {
  const ctx = fixture(t);
  const skipped = createCard(ctx.store, actor, { workId: 'work', key: 'skipped', content: '被跳过', workspace: 'copy' });
  const paths = [skipped.id, 'work'].map(id => join(ctx.store.dataDir, 'tmp', id));
  for (const path of paths) { mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'data'), 'x'); }
  removeCoordinatorDirectory(ctx.store, 'work');
  for (const path of paths) assert.equal(existsSync(path), false, path);
});

test('启动对账保留活动卡片和活动工作的临时数据目录，删除其余目录且不跟随符号链接', async t => {
  const ctx = fixture(t);
  await ctx.runner.close();
  ctx.store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('ended', 'project', 'cancelled', 'ended', '2026-11-13')");
  const active = createCard(ctx.store, actor, { workId: 'work', key: 'active', content: '活动', workspace: 'scratch' });
  const completed = createCard(ctx.store, actor, { workId: 'work', key: 'completed', content: '完成', workspace: 'scratch' });
  ctx.store.db.prepare("UPDATE cards SET status = 'completed' WHERE id = ?").run(completed.id);
  const endedWorkCard = createCard(ctx.store, actor, { workId: 'work', key: 'ended-card', content: '工作已结束', workspace: 'scratch' });
  ctx.store.db.prepare("UPDATE cards SET work_id = 'ended' WHERE id = ?").run(endedWorkCard.id);
  const root = join(ctx.store.dataDir, 'tmp');
  for (const id of [active.id, 'work', completed.id, 'ended', endedWorkCard.id, 'orphan']) {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(join(root, id, 'data'), id);
  }
  const outside = join(ctx.directory, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep'), 'outside');
  symlinkSync(outside, join(root, 'linked'));
  writeFileSync(join(root, 'stray-file'), 'x');
  for (let run = 0; run < 2; run++) {
    await reconcileStartup(ctx.store);
    for (const id of [active.id, 'work']) assert.equal(readFileSync(join(root, id, 'data'), 'utf8'), id);
    for (const id of [completed.id, 'ended', endedWorkCard.id, 'orphan', 'linked', 'stray-file']) assert.equal(existsSync(join(root, id)), false, id);
    assert.equal(readFileSync(join(outside, 'keep'), 'utf8'), 'outside');
  }
});
