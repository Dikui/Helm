import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { createDispatch, getDispatch } from '../src/dispatch.js';
import { createCard } from '../src/graph.js';
import { finishReadOnlyCheck, readOnlySnapshot } from '../src/read-only-check.js';
import { TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';

const actor = { type: 'runtime', id: 'test' } as const;
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();

// Historical checks remain readable until the separate read-only cleanup.
async function fixture(t: TestContext, repository = true) {
  const directory = mkdtempSync(join(tmpdir(), 'helm-legacy-read-only-'));
  const project = join(directory, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'README.md'), 'baseline\n');
  if (repository) {
    git(project, 'init', '-b', 'main');
    git(project, 'add', 'README.md');
    git(project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'baseline');
  }
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'work', '2026-10-30')");
  const card = createCard(store, actor, { workId: 'work', key: 'legacy', content: '历史派单', workspace: 'scratch' });
  const dispatch = await createDispatch(store, actor, { workId: 'work', cardId: card.id, key: 'legacy', agentId: 'claude-executor' });
  const snapshot = () => store.db.prepare('UPDATE dispatches SET read_only_snapshot = ? WHERE id = ?').run(JSON.stringify(readOnlySnapshot(project, true)), dispatch.id);
  const finish = () => { finishReadOnlyCheck(store, dispatch); return getDispatch(store, 'work', dispatch.id).readOnlyCheck!; };
  return { project, store, snapshot, finish };
}

for (const scenario of ['files', 'commit', 'empty-commit', 'rename'] as const) test(`历史只读检查仍记录 ${scenario} 的变化，保留文件且重复检查不新增事件`, async t => {
  const ctx = await fixture(t);
  ctx.snapshot();
  let paths: string[];
  if (scenario === 'files') {
    writeFileSync(join(ctx.project, 'README.md'), 'changed\n');
    writeFileSync(join(ctx.project, 'new file.txt'), 'new\n');
    paths = ['README.md', 'new file.txt'];
  } else if (scenario === 'rename') {
    renameSync(join(ctx.project, 'README.md'), join(ctx.project, 'new\nname.txt'));
    git(ctx.project, 'add', '--', 'README.md', 'new\nname.txt');
    paths = ['README.md', 'new\nname.txt'];
  } else {
    if (scenario === 'commit') {
      writeFileSync(join(ctx.project, 'committed.txt'), 'new\n');
      git(ctx.project, 'add', 'committed.txt');
    }
    git(ctx.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'changed');
    paths = scenario === 'commit' ? ['committed.txt'] : [];
  }
  const check = ctx.finish();
  assert.equal(check.status, 'violated');
  assert.equal(check.projectDirectory, true);
  assert.deepEqual(check.paths, paths);
  const events = ctx.store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated');
  assert.equal(events.length, 1);
  assert.deepEqual(events[0]!.details, check);
  assert.deepEqual(ctx.finish(), check);
  assert.equal(ctx.store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated').length, 1);
});

test('历史只读检查忽略派单前已有未提交内容', async t => {
  const ctx = await fixture(t);
  writeFileSync(join(ctx.project, 'README.md'), 'user changes\n');
  ctx.snapshot();
  assert.equal(ctx.finish().status, 'unchanged');
});

test('历史非 git 目录检查和缺失快照明确记为未检查', async t => {
  const ctx = await fixture(t, false);
  ctx.snapshot();
  assert.equal(ctx.finish().reason, 'not-git');
  ctx.store.db.exec('UPDATE dispatches SET read_only_check = NULL, read_only_snapshot = NULL');
  assert.equal(ctx.finish().reason, 'baseline-missing');
});
