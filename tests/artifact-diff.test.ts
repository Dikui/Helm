import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { artifactDiffLimits, type ArtifactDiff } from '../src/artifact-diff.js';
import { dispatchArtifacts, getDispatch, readArtifact, saveArtifact } from '../src/dispatch.js';
import { RuleError, TaskStore } from '../src/store.js';

function fixture(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-artifact-diff-')));
  const project = join(directory, 'project'); mkdirSync(project);
  const git = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
  git('init', '-b', 'main');
  const write = (name: string, content: string | Buffer) => writeFileSync(join(project, name), content);
  const commit = () => {
    const paths = git('ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    if (paths.length) git('add', '--', ...paths);
    git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture');
    return git('rev-parse', 'HEAD');
  };
  write('base.txt', 'baseline\n'); const base = commit();
  git('checkout', '-b', 'card');
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(join(directory, 'agents')));
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', ?, '2026-01-01')").run(project);
  store.db.exec(`INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'p', 'executing', 'start', '2026-01-01'), ('other', 'p', 'executing', 'other', '2026-01-01');
    INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at, card_branch, work_path) VALUES ('card', 'work', 'card', 'Card', 0, 'executing', '2026-01-01', 'card', '${project.replace(/'/g, "''")}');`);
  const dispatch = (id: string, start: string | null, end: string | null, purpose = 'execution') => {
    store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path, start_commit, end_commit)
      VALUES (?, 'work', 'card', ?, ?, 'executor', '{}', 'Card', 'ended', '2026-01-01', '/unused', ?, ?)`).run(id, id, purpose, start, end);
    saveArtifact(store, getDispatch(store, 'work', id), 'branch', 'card', 'card', end ?? start ?? undefined);
    return String(store.db.prepare('SELECT id FROM artifacts WHERE dispatch_id = ?').get(id)!.id);
  };
  return { directory, project, git, write, commit, base, store, dispatch };
}
function available(diff: ArtifactDiff | unknown): Extract<ArtifactDiff, { status: 'available' }> {
  assert.equal((diff as ArtifactDiff).status, 'available', JSON.stringify(diff));
  return diff as Extract<ArtifactDiff, { status: 'available' }>;
}
const invalidPath = (error: unknown) => error instanceof RuleError && error.code === 'INVALID_ARTIFACT_PATH';

test('现有成果操作按卡片起始提交计算累计 numstat 和按文件 patch，历史快照不随分支和合入记录变化', t => {
  const f = fixture(t);
  f.write('first.txt', 'first\n'); const first = f.commit(); const old = f.dispatch('first', f.base, first);
  f.write('repair.txt', 'repair\n'); const repaired = f.commit(); const current = f.dispatch('repair', first, repaired);
  const vote = f.dispatch('vote', repaired, repaired, 'verification');
  f.write('another-card.txt', 'unrelated\n'); const workMerge = f.commit();
  // Completion rewrites all branch artifacts to the work merge; the dispatch columns retain the card commits.
  f.store.db.prepare("UPDATE artifacts SET ref = 'main', commit_sha = ? WHERE kind = 'branch'").run(workMerge);
  f.store.db.exec("UPDATE cards SET status = 'completed' WHERE id = 'card'");
  assert.deepEqual(available(readArtifact(f.store, 'work', old).diff).files.map(file => file.path), ['first.txt']);
  for (const id of [current, vote]) {
    const diff = available(readArtifact(f.store, 'work', id).diff);
    assert.equal(diff.baseCommit, f.base); assert.equal(diff.headCommit, repaired); assert.equal(diff.patch, undefined);
    assert.deepEqual(diff.files.map(file => [file.path, file.additions, file.deletions]), [['first.txt', 1, 0], ['repair.txt', 1, 0]]);
    const patch = available(readArtifact(f.store, 'work', id, 'utf8', 'first.txt').diff).patch!;
    assert.match(patch.text, /\+first/); assert.doesNotMatch(patch.text, /repair|unrelated/);
  }
  assert.equal(available(dispatchArtifacts(f.store, 'work', 'vote')[0]!.diff).headCommit, repaired);
  assert.throws(() => readArtifact(f.store, 'other', current), error => error instanceof RuleError && error.code === 'INVALID_ARTIFACT');
});

test('新增、删除、修改、重命名、二进制和特殊路径正确展示，git 读取不改 HEAD、引用、索引或工作目录', t => {
  const f = fixture(t);
  f.write('remove.txt', 'remove\n'); f.write('rename old.txt', 'same file\n'.repeat(8)); const base = f.commit();
  f.git('mv', 'rename old.txt', '重命名 new.txt');
  rmSync(join(f.project, 'remove.txt'));
  f.write('base.txt', 'changed\nextra\n'); f.write('[card]*?.txt', 'literal\n'); f.write('line\nbreak\tname.txt', 'special\n');
  f.write('image.bin', Buffer.from([0, 1, 2, 3])); const head = f.commit(); const artifact = f.dispatch('changes', base, head);
  f.write('dirty.txt', 'uncommitted\n'); f.write('staged.txt', 'staged\n'); f.git('add', 'staged.txt');
  const state = () => ({ head: f.git('rev-parse', 'HEAD'), refs: f.git('show-ref'), status: f.git('status', '--porcelain=v2'), index: readFileSync(join(f.project, '.git/index')) });
  const before = state();
  const diff = available(readArtifact(f.store, 'work', artifact).diff);
  assert.deepEqual(diff.files.find(file => file.path === 'base.txt'), { path: 'base.txt', additions: 2, deletions: 1, binary: false });
  assert.deepEqual(diff.files.find(file => file.path === 'remove.txt'), { path: 'remove.txt', additions: 0, deletions: 1, binary: false });
  assert.deepEqual(diff.files.find(file => file.path === '重命名 new.txt'), { path: '重命名 new.txt', previousPath: 'rename old.txt', additions: 0, deletions: 0, binary: false });
  assert.deepEqual(diff.files.find(file => file.path === 'image.bin'), { path: 'image.bin', additions: null, deletions: null, binary: true });
  for (const path of ['[card]*?.txt', 'line\nbreak\tname.txt', '重命名 new.txt', 'remove.txt', 'image.bin']) {
    const patch = available(readArtifact(f.store, 'work', artifact, 'utf8', path).diff).patch!;
    assert.ok(patch.text.length); assert.equal(patch.truncated, false);
  }
  const literal = available(readArtifact(f.store, 'work', artifact, 'utf8', '[card]*?.txt').diff).patch!;
  assert.match(literal.text, /\+literal/); assert.doesNotMatch(literal.text, /changed|special/);
  assert.deepEqual(state(), before);
  for (const path of ['../base.txt', '/base.txt', 'a\0b', ':*.txt', 'base.txt/../remove.txt', 'x'.repeat(4097), '界'.repeat(1400)]) {
    assert.throws(() => readArtifact(f.store, 'work', artifact, 'utf8', path), invalidPath);
  }
});

test('文件列表和大 patch 均有硬上限，截断明确且 UTF-8 边界完整', t => {
  const f = fixture(t);
  for (let index = 0; index < 650; index++) f.write(`${String(index).padStart(3, '0')}-${'n'.repeat(210)}.txt`, 'file\n');
  f.write('000-large.txt', '一行足够长。'.repeat(60_000) + '\n');
  const head = f.commit(); const artifact = f.dispatch('large', f.base, head);
  const diff = available(readArtifact(f.store, 'work', artifact).diff);
  assert.equal(diff.files.length, artifactDiffLimits.files); assert.equal(diff.truncated, true);
  const patch = available(readArtifact(f.store, 'work', artifact, 'utf8', '000-large.txt').diff).patch!;
  assert.equal(patch.truncated, true); assert.ok(Buffer.byteLength(patch.text) <= artifactDiffLimits.patchBytes);
  assert.ok(!patch.text.includes('\uFFFD')); assert.match(patch.text, /一行足够长/);
});

test('副本和分支清理后仍可按固定提交读取；缺提交、缺起点和缺项目均给出明确不可用原因', t => {
  const f = fixture(t);
  f.write('card.txt', 'card\n'); const head = f.commit(); const artifact = f.dispatch('saved', f.base, head);
  f.git('checkout', 'main'); f.git('branch', '-D', 'card');
  f.store.db.prepare("UPDATE cards SET work_path = ? WHERE id = 'card'").run(join(f.directory, 'removed-copy'));
  const diff = available(readArtifact(f.store, 'work', artifact).diff);
  assert.equal(diff.branchAvailable, false); assert.equal(diff.copyAvailable, false); assert.equal(diff.files[0]!.path, 'card.txt');
  f.store.db.prepare("UPDATE dispatches SET start_commit = NULL WHERE id = 'saved'").run();
  assert.equal(readArtifact(f.store, 'work', artifact).diff?.status, 'unavailable');
  assert.equal((readArtifact(f.store, 'work', artifact).diff as any).reason, 'base-missing');
  f.store.db.prepare("UPDATE dispatches SET start_commit = ?, end_commit = ? WHERE id = 'saved'").run(f.base, head);
  rmSync(join(f.project, '.git', 'objects', head.slice(0, 2), head.slice(2)));
  assert.equal((readArtifact(f.store, 'work', artifact).diff as any).reason, 'commit-unavailable');
  rmSync(f.project, { recursive: true });
  assert.equal((readArtifact(f.store, 'work', artifact).diff as any).reason, 'repository-unavailable');
});

test('只验收的卡片和没有代码改动的执行显示空变更，普通文件成果兼容旧读取', t => {
  const f = fixture(t);
  const vote = f.dispatch('vote-only', f.base, f.base, 'verification');
  assert.deepEqual(available(readArtifact(f.store, 'work', vote).diff).files, []);
  const execution = f.dispatch('no-change', f.base, f.base);
  assert.deepEqual(available(readArtifact(f.store, 'work', execution).diff).files, []);
  saveArtifact(f.store, getDispatch(f.store, 'work', 'no-change'), 'file', 'output.txt', 'saved text');
  const file = String(f.store.db.prepare("SELECT id FROM artifacts WHERE kind = 'file'").get()!.id);
  assert.equal(readArtifact(f.store, 'work', file).content, 'saved text');
  assert.equal(readArtifact(f.store, 'work', file, 'base64').content, Buffer.from('saved text').toString('base64'));
  assert.throws(() => readArtifact(f.store, 'work', file, 'utf8', 'output.txt'), invalidPath);
});
