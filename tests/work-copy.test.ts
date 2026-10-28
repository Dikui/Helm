import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';

test('创建工作即固定当前分支并建副本，对齐只读副本且不受项目目录变动影响', async t => {
  let cwd: string | undefined;
  const daemon = await uiFixture([ctx => {
    cwd = ctx.options.cwd;
    assert.equal(ctx.options.sandbox.mode, 'read-only');
    assert.deepEqual(ctx.options.sandbox.writableRoots, []);
    return [];
  }]);
  t.after(() => daemon.close());
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('checkout', '-b', 'release/1.0');
  const head = git('rev-parse', 'HEAD');
  await writeFile(join(daemon.repo, 'README.md'), '用户未提交的内容\n');
  const params = { projectId: daemon.project.id, key: 'start', body: '创建工作副本' };
  const response = await daemon.call('send-message', params);
  assert.equal(response.ok, true);
  const work = response.result.work;
  assert.equal(work.baseRef, 'release/1.0');
  assert.equal(work.baseCommit, head);
  assert.equal(work.workBranch, `helm/${work.id}`);
  assert.equal(git('rev-parse', work.workBranch), head);
  assert.equal(await readFile(join(work.workPath, 'README.md'), 'utf8'), 'baseline\n');
  await until(async () => cwd, value => Boolean(value));
  assert.equal(cwd, work.workPath);
  git('checkout', 'main');
  await writeFile(join(daemon.repo, 'README.md'), '用户切分支后改动\n');
  assert.equal(await readFile(join(cwd!, 'README.md'), 'utf8'), 'baseline\n');
  assert.equal((await daemon.call('send-message', params)).result.work.workPath, work.workPath);
  assert.equal((await daemon.call('list-works')).result.length, 1);
});

test('创建工作可选择其他本地基准分支，拒绝无效基准且不留下工作或分支', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('checkout', '-b', 'release/1.0');
  await writeFile(join(daemon.repo, 'README.md'), 'release baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'release');
  const release = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  const response = await daemon.call('send-message', { projectId: daemon.project.id, baseRef: 'release/1.0', key: 'selected', body: '选基准' });
  assert.equal(response.ok, true);
  const work = response.result.work;
  assert.equal(work.baseRef, 'release/1.0');
  assert.equal(work.baseCommit, release);
  assert.equal(await readFile(join(work.workPath, 'README.md'), 'utf8'), 'release baseline\n');
  assert.equal(git('branch', '--show-current'), 'main');
  const refs = git('for-each-ref', '--format=%(refname)');
  for (const baseRef of ['missing', '--help', 'HEAD', 'main~1']) {
    const invalid = await daemon.call('send-message', { projectId: daemon.project.id, baseRef, key: baseRef, body: '无效基准' });
    assert.equal(invalid.error.code, 'INVALID_BASE_BRANCH');
  }
  assert.equal((await daemon.call('list-works')).result.length, 1);
  assert.equal(git('for-each-ref', '--format=%(refname)'), refs);
});

test('取消对齐中的工作清理副本和分支，重复取消及删除均可完成', async t => {
  const daemon = await uiFixture([[{ type: 'hang' }]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'cancel', body: '取消对齐' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds.some((round: any) => round.status === 'running'));
  assert.equal((await daemon.call('cancel-work', params)).ok, true);
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.call('get-conversation', params)).ok, true);
  assert.throws(() => execFileSync('git', ['-C', daemon.repo, 'show-ref', '--verify', `refs/heads/${work.workBranch}`], { stdio: 'pipe' }));
  assert.equal((await daemon.call('cancel-work', params)).ok, true);
  const deleted = await daemon.call('delete-work', { ...params, confirm: true });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.result.keptBranch, null);
  assert.equal((await daemon.call('list-works')).result.length, 0);
});

for (const hasDraft of [false, true]) test(`旧对齐工作${hasDraft ? '已有草稿' : '尚无草稿'}时，下轮启动前补建只读副本`, async t => {
  let resumedCwd: string | undefined;
  const daemon = await uiFixture([
    hasDraft ? [{ type: 'tool', name: 'draft-work-description', arguments: ctx => ({
      workId: JSON.parse(ctx.input).work.id, key: 'legacy-draft', requirements: '旧工作', boundary: '本机', criteria: '可接续',
    }) }] : [],
    ctx => { resumedCwd = ctx.options.cwd; return []; },
  ]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'legacy', body: '旧工作' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  // Fixture setup: reproduce pre-feature persisted works without a copy or base fields.
  git('worktree', 'remove', work.workPath);
  git('branch', '-D', work.workBranch);
  const db = new DatabaseSync(join(daemon.directory, 'data', 'helm.db'));
  try { db.prepare('UPDATE works SET base_ref = NULL, base_commit = NULL, work_branch = NULL, work_path = NULL WHERE id = ?').run(work.id); }
  finally { db.close(); }
  git('checkout', '-b', 'another-branch');
  await writeFile(join(daemon.repo, 'README.md'), '用户未提交的内容');
  assert.equal((await daemon.call('send-message', { ...params, key: 'resume', body: '继续对齐' })).ok, true);
  await until(async () => resumedCwd, Boolean);
  const resumed = (await daemon.call('get-work', params)).result;
  assert.equal(resumed.baseRef, hasDraft ? 'main' : 'another-branch');
  assert.equal(resumed.workPath, resumedCwd);
  assert.equal(await readFile(join(resumedCwd!, 'README.md'), 'utf8'), 'baseline\n');
});

test('创建副本的 git hook 失败后清理部分创建的副本和分支，原请求可以重试', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const hook = join(daemon.repo, '.git', 'hooks', 'post-checkout');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  const params = { projectId: daemon.project.id, key: 'retry-copy', body: '创建失败后重试' };
  assert.equal((await daemon.call('send-message', params)).ok, false);
  assert.deepEqual((await daemon.call('list-works')).result, []);
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/helm/'), '');
  assert.equal(git('worktree', 'list', '--porcelain').split('\n').filter(line => line.startsWith('worktree ')).length, 1);
  await rm(hook);
  assert.equal((await daemon.call('send-message', params)).ok, true);
  assert.equal((await daemon.call('list-works')).result.length, 1);
});

test('默认基准取当前本地分支，同名 tag 不改变工作起点', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const expected = git('rev-parse', 'refs/heads/main');
  const other = git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit-tree', `${expected}^{tree}`, '-p', expected, '-m', 'tag-only');
  git('tag', 'main', other);
  const response = await daemon.call('send-message', { projectId: daemon.project.id, key: 'same-name', body: '同名标签' });
  assert.equal(response.ok, true);
  assert.equal(response.result.work.baseRef, 'main');
  assert.equal(response.result.work.baseCommit, expected);
  assert.equal((await daemon.call('list-project-branches', { projectId: daemon.project.id })).result.currentBranch, 'main');
});
