import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { confirmDescription, draftDescription, ensureWorkCopy } from '../src/alignment.js';
import { createDispatch } from '../src/dispatch.js';
import { createCard } from '../src/graph.js';
import { RuleError, TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';

const actor = { type: 'runtime', id: 'test' } as const;
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = ['-c', 'user.name=Test', '-c', 'user.email=test@localhost'];

function fixture(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-copy-recovery-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  git(project, 'init', '-b', 'main');
  writeFileSync(join(project, 'README.md'), 'baseline\n');
  git(project, 'add', 'README.md');
  git(project, ...identity, 'commit', '-m', 'baseline');
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at, base_ref) VALUES ('work', 'project', 'executing', 'work', '2026-10-30', 'main')");
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const path = join(store.dataDir, 'worktrees', 'work', '_work');
  const branch = 'helm/work';
  const advance = () => {
    writeFileSync(join(project, 'README.md'), 'latest base\n');
    git(project, 'add', 'README.md');
    git(project, ...identity, 'commit', '-m', 'advance base');
    return git(project, 'rev-parse', 'HEAD');
  };
  const dispatch = () => {
    const card = createCard(store, actor, { workId: 'work', key: 'write', content: '实现' });
    return createDispatch(store, actor, { workId: 'work', cardId: card.id, key: 'dispatch', agentId: 'claude-executor' });
  };
  return { directory, store, project, path, branch, advance, dispatch };
}

for (const advanceBase of [true, false]) test(`副本事务回滚后${advanceBase ? '基准前进，' : ''}下次派单复用无独有提交的工作分支和副本`, async t => {
  const ctx = fixture(t);
  assert.throws(() => ctx.store.transaction(() => { ensureWorkCopy(ctx.store, 'work'); throw new Error('crash'); }), /crash/);
  assert.equal(ctx.store.work('work').workBranch, null);
  assert.ok(existsSync(ctx.path));
  const latest = advanceBase ? ctx.advance() : git(ctx.project, 'rev-parse', 'HEAD');
  const dispatch = await ctx.dispatch();
  assert.equal(dispatch.status, 'queued');
  const work = ctx.store.work('work');
  assert.equal(work.baseCommit, latest);
  assert.equal(work.workBranch, ctx.branch);
  assert.equal(work.workPath, ctx.path);
  assert.equal(git(ctx.path, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(ctx.path, 'symbolic-ref', '--short', 'HEAD'), ctx.branch);
  assert.equal(git(ctx.path, 'status', '--porcelain'), '');
});

for (const residue of ['directory', 'missing', 'wrong-branch'] as const) test(`中断留下 ${residue} 时修复 Helm 自有路径和 worktree 登记后重建`, async t => {
  const ctx = fixture(t);
  git(ctx.project, 'branch', ctx.branch);
  if (residue === 'directory') {
    mkdirSync(ctx.path, { recursive: true });
    writeFileSync(join(ctx.path, 'partial'), 'unfinished checkout');
  } else {
    git(ctx.project, 'worktree', 'add', ctx.path, ctx.branch);
    if (residue === 'missing') rmSync(ctx.path, { recursive: true });
    else git(ctx.path, 'checkout', '-b', 'other-branch');
  }
  const latest = ctx.advance();
  await ctx.dispatch();
  assert.equal(git(ctx.path, 'rev-parse', 'HEAD'), latest);
  assert.equal(git(ctx.path, 'symbolic-ref', '--short', 'HEAD'), ctx.branch);
  assert.equal(existsSync(join(ctx.path, 'partial')), false);
  assert.equal(git(ctx.project, 'worktree', 'list', '--porcelain').split(`worktree ${ctx.path}\n`).length, 2);
});

test('残留分支有独有提交时保留分支和路径，不重置或清理用户数据', async t => {
  const ctx = fixture(t);
  git(ctx.project, 'worktree', 'add', '-b', ctx.branch, ctx.path, 'main');
  writeFileSync(join(ctx.path, 'valuable.txt'), 'work commit');
  git(ctx.path, 'add', 'valuable.txt');
  git(ctx.path, ...identity, 'commit', '-m', 'own work');
  const ownCommit = git(ctx.path, 'rev-parse', 'HEAD');
  writeFileSync(join(ctx.path, 'uncommitted.txt'), 'keep me');
  ctx.advance();
  await assert.rejects(ctx.dispatch(), (error: unknown) => error instanceof RuleError && error.code === 'WORK_BRANCH_CONFLICT');
  assert.equal(git(ctx.path, 'rev-parse', 'HEAD'), ownCommit);
  assert.equal(readFileSync(join(ctx.path, 'uncommitted.txt'), 'utf8'), 'keep me');
  assert.equal(ctx.store.work('work').workBranch, null);
});

test('修复路径不得跟随 Helm 数据目录中的父目录链接删除外部文件', async t => {
  const ctx = fixture(t);
  const outside = join(ctx.directory, 'outside');
  mkdirSync(join(outside, '_work'), { recursive: true });
  writeFileSync(join(outside, '_work', 'valuable.txt'), 'keep me');
  mkdirSync(join(ctx.store.dataDir, 'worktrees'), { recursive: true });
  symlinkSync(outside, join(ctx.store.dataDir, 'worktrees', 'work'));
  await assert.rejects(ctx.dispatch(), (error: unknown) => error instanceof RuleError && error.code === 'WORK_PATH_CONFLICT');
  assert.equal(readFileSync(join(outside, '_work', 'valuable.txt'), 'utf8'), 'keep me');
});

test('项目切到游离 HEAD 后起草和确认工作说明，保留之前已固定的基准分支', t => {
  const ctx = fixture(t);
  git(ctx.project, 'checkout', '--detach');
  const draft = draftDescription(ctx.store, actor, { workId: 'work', key: 'draft', requirements: '分析', boundary: '只读', criteria: '报告' });
  assert.equal(draft.baseRef, 'main');
  const confirmed = confirmDescription(ctx.store, { type: 'user', id: 'user' },
    { workId: 'work', gateId: draft.gateId, descriptionId: draft.id, decision: 'confirm' });
  assert.equal(confirmed.baseRef, 'main');
  assert.equal(confirmed.workBranch, null);
});
