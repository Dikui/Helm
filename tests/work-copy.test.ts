import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';
import { existingWorkCopy } from './helmd-fixture.js';
import type { FakeContext, FakeStep } from '../src/driver.js';

test('创建工作只固定基准分支，对齐只读项目目录且不建副本', async t => {
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
  assert.equal(work.baseCommit, null);
  assert.equal(work.workBranch, null);
  assert.equal(work.workPath, null);
  assert.equal(git('rev-parse', 'HEAD'), head);
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/helm/'), '');
  assert.equal(git('worktree', 'list', '--porcelain').split('worktree ').length, 2);
  await until(async () => cwd, value => Boolean(value));
  assert.equal(cwd, daemon.repo);
  git('checkout', 'main');
  await writeFile(join(daemon.repo, 'README.md'), '用户切分支后改动\n');
  assert.equal(await readFile(join(cwd!, 'README.md'), 'utf8'), '用户切分支后改动\n');
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
  git('checkout', 'main');
  const response = await daemon.call('send-message', { projectId: daemon.project.id, baseRef: 'release/1.0', key: 'selected', body: '选基准' });
  assert.equal(response.ok, true);
  const work = response.result.work;
  assert.equal(work.baseRef, 'release/1.0');
  assert.equal(work.baseCommit, null);
  assert.equal(work.workPath, null);
  assert.equal(work.workBranch, null);
  assert.equal(git('branch', '--show-current'), 'main');
  git('tag', 'release-tag');
  git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  const refs = git('for-each-ref', '--format=%(refname)');
  for (const baseRef of ['missing', '--help', 'HEAD', 'main~1', 'release-tag', 'refs/tags/release-tag', 'origin/main', git('rev-parse', 'HEAD')]) {
    const invalid = await daemon.call('send-message', { projectId: daemon.project.id, baseRef, key: baseRef, body: '无效基准' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.error.code, 'INVALID_BASE_BRANCH');
  }
  assert.equal((await daemon.call('list-works')).result.length, 1);
  assert.equal(git('for-each-ref', '--format=%(refname)'), refs);
});

test('detached HEAD 新建工作必须指定本地基准分支，拒绝后可用原请求重试', async t => {
  const daemon = await uiFixture();
  t.after(() => daemon.close());
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  git('checkout', '--detach');
  const refs = git('for-each-ref', '--format=%(refname)');
  const copies = git('worktree', 'list', '--porcelain');
  const params = { projectId: daemon.project.id, key: 'detached', body: '选择基准后创建' };
  const rejected = await daemon.call('send-message', params);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.error.code, 'INVALID_BASE_BRANCH');
  assert.match(rejected.error.reason, /请指定基准分支/);
  assert.deepEqual((await daemon.call('list-works')).result, []);
  assert.equal(git('for-each-ref', '--format=%(refname)'), refs);
  assert.equal(git('worktree', 'list', '--porcelain'), copies);

  const response = await daemon.call('send-message', { ...params, baseRef: 'main' });
  assert.equal(response.ok, true);
  assert.equal(response.result.work.baseRef, 'main');
  assert.equal(response.result.work.baseCommit, null);
  assert.equal((await daemon.call('list-works')).result.length, 1);
});

test('没有工作副本和分支时，取消、重复取消及删除均可完成', async t => {
  const daemon = await uiFixture([[{ type: 'hang' }]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'cancel', body: '取消对齐' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds.some((round: any) => round.status === 'running'));
  assert.equal((await daemon.call('cancel-work', params)).ok, true);
  assert.equal(work.workPath, null);
  assert.equal(existsSync(join(daemon.directory, 'data', 'worktrees', work.id, '_work')), false);
  assert.equal((await daemon.call('get-conversation', params)).ok, true);
  assert.throws(() => execFileSync('git', ['-C', daemon.repo, 'show-ref', '--verify', `refs/heads/helm/${work.id}`], { stdio: 'pipe' }));
  assert.equal((await daemon.call('cancel-work', params)).ok, true);
  const deleted = await daemon.call('delete-work', { ...params, confirm: true });
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.result.keptBranches, []);
  assert.equal((await daemon.call('list-works')).result.length, 0);
});

for (const hasDraft of [false, true]) test(`旧对齐工作${hasDraft ? '已有草稿' : '尚无草稿'}时，下轮仍只读项目目录，不补建副本`, async t => {
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
  const db = new DatabaseSync(join(daemon.directory, 'data', 'helm.db'));
  try { db.prepare('UPDATE works SET base_ref = NULL, base_commit = NULL, work_branch = NULL, work_path = NULL WHERE id = ?').run(work.id); }
  finally { db.close(); }
  git('checkout', '-b', 'another-branch');
  await writeFile(join(daemon.repo, 'README.md'), '用户未提交的内容');
  assert.equal((await daemon.call('send-message', { ...params, key: 'resume', body: '继续对齐' })).ok, true);
  await until(async () => resumedCwd, Boolean);
  const resumed = (await daemon.call('get-work', params)).result;
  assert.equal(resumed.baseRef, null);
  assert.equal(resumed.workPath, null);
  assert.equal(resumed.workBranch, null);
  assert.equal(resumedCwd, daemon.repo);
  assert.equal(await readFile(join(resumedCwd!, 'README.md'), 'utf8'), '用户未提交的内容');
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
  assert.equal(response.result.work.baseCommit, null);
  const copy = existingWorkCopy(join(daemon.directory, 'data'), response.result.work.id);
  assert.equal(git('rev-parse', copy.workBranch!), expected);
  assert.equal((await daemon.call('list-project-branches', { projectId: daemon.project.id })).result.currentBranch, 'main');
});

test('已有副本的旧工作继续只读原副本，不删除或重建', async t => {
  let cwd = '';
  const daemon = await uiFixture([[], ctx => { cwd = ctx.options.cwd; return []; }]);
  t.after(() => daemon.close());
  const initial = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '旧工作' })).result.work;
  const params = { workId: initial.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const work = existingWorkCopy(join(daemon.directory, 'data'), initial.id);
  await writeFile(join(work.workPath!, 'kept.txt'), '保留旧副本内容\n');
  await daemon.call('send-message', { ...params, key: 'next', body: '继续对齐' });
  await until(async () => cwd, Boolean);
  assert.equal(cwd, work.workPath);
  assert.equal(await readFile(join(cwd, 'kept.txt'), 'utf8'), '保留旧副本内容\n');
  assert.equal((await daemon.call('get-work', params)).result.workBranch, work.workBranch);
  assert.equal((await daemon.call('cancel-work', params)).ok, true);
  assert.equal(existsSync(cwd), false);
  assert.equal(execFileSync('git', ['-C', daemon.repo, 'branch', '--list', work.workBranch!], { encoding: 'utf8' }), '');
});

for (const [differentBranch, dirty] of [[false, false], [true, false], [false, true], [true, true]]) {
  test(`首个执行派单按最新基准开副本，后续复用；项目分支不同=${differentBranch}，有未提交改动=${dirty}`, async t => {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    t.after(() => release());
    const rounds: FakeContext[] = [];
    const small: FakeStep = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 200_000 } };
    const card = (key: string): FakeStep => ({ type: 'tool', name: 'create-card', saveAs: key,
      arguments: { key, content: '写代码' }, check: value => assert.equal((value as any).ok, true) });
    const dispatch = (key: string): FakeStep => ({ type: 'tool', name: 'create-dispatch',
      arguments: ctx => ({ key, cardId: (ctx.results.get(key) as any).result.id, agentId: 'claude-executor' }),
      check: value => assert.equal((value as any).ok, true) });
    const record = (steps: FakeStep[]) => (ctx: FakeContext) => { rounds.push(ctx); return [...steps, small]; };
    const daemon = await uiFixture([
      record([{ type: 'tool', name: 'draft-work-description', arguments: { key: 'draft', requirements: '按需建副本', boundary: '本机', criteria: '最新基准' } }]),
      record([{ type: 'hang', until: ready }, card('first'), dispatch('first')]),
      record([card('second'), dispatch('second')]),
      record([]),
    ], undefined, { executorScripts: [[{ type: 'hang' }], [{ type: 'hang' }]] });
    t.after(() => daemon.close());
    const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '开始' })).result.work;
    const params = { workId: work.id };
    const ended = (count: number) => until(() => daemon.call('list-rounds', params), value => value.result.rounds.filter((round: any) => round.status === 'ended').length === count);
    await ended(1);
    const gate = (await daemon.call('list-pending')).result[0];
    const confirmed = await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
    assert.equal(confirmed.ok, true);
    assert.equal(confirmed.result.workPath, null);
    assert.equal(confirmed.result.workBranch, null);
    // Advance the base after confirmation: only dispatch chooses the starting commit.
    await writeFile(join(daemon.repo, 'README.md'), 'latest base\n');
    git('add', 'README.md');
    git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'new base');
    const latest = git('rev-parse', 'HEAD');
    if (differentBranch) {
      git('checkout', '-b', 'user-branch');
      await writeFile(join(daemon.repo, 'other.txt'), 'other branch\n');
      git('add', 'other.txt');
      git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'user branch');
    }
    if (dirty) await writeFile(join(daemon.repo, 'README.md'), 'uncommitted\n');
    const projectStatus = git('status', '--porcelain');
    release();
    await ended(2);
    const prepared = (await daemon.call('get-work', params)).result;
    assert.equal(prepared.workBranch, `helm/${work.id}`);
    assert.equal(prepared.workPath, join(daemon.directory, 'data', 'worktrees', work.id, '_work'));
    assert.equal(prepared.baseCommit, latest);
    assert.equal(git('rev-parse', prepared.workBranch), latest);
    assert.equal(await readFile(join(prepared.workPath, 'README.md'), 'utf8'), 'latest base\n');
    assert.equal(existsSync(join(prepared.workPath, 'other.txt')), false);
    const cards = (await daemon.call('get-card-graph', params)).result.filter((node: any) => node.type === 'card');
    assert.equal(git('rev-parse', cards[0].cardBranch), latest);
    const conversation = () => daemon.call('get-conversation', params);
    const notices = (await conversation()).result.filter((item: any) => item.sender === 'runtime' && item.body.includes('工作副本不包含'));
    assert.equal(notices.length, differentBranch || dirty ? 1 : 0);
    if (notices.length) {
      const events = (await daemon.call('get-events', params)).result;
      assert.equal(events.find((event: any) => event.object.id === notices[0].id).actor.type, 'runtime');
    }
    assert.equal(git('branch', '--show-current'), differentBranch ? 'user-branch' : 'main');
    assert.equal(git('status', '--porcelain'), projectStatus);
    assert.equal(rounds[0]!.options.cwd, daemon.repo);
    assert.equal(rounds[1]!.options.cwd, daemon.repo);
    assert.equal(typeof rounds[1]!.options.resumeSessionId, 'string');

    // A later card starts from the current work tip, without recreating _work.
    const workGit = (...args: string[]) => execFileSync('git', ['-C', prepared.workPath, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    await writeFile(join(prepared.workPath, 'from-work.txt'), 'work result\n');
    workGit('add', 'from-work.txt');
    workGit('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'work result');
    const tip = workGit('rev-parse', 'HEAD');
    await daemon.call('send-message', { ...params, key: 'next', body: '继续' });
    await ended(3);
    assert.equal(rounds[2]!.options.cwd, prepared.workPath);
    assert.equal(rounds[2]!.options.resumeSessionId, undefined);
    assert.equal(JSON.parse(rounds[2]!.input).resumed, undefined);
    assert.ok(JSON.parse(rounds[2]!.input).workDescription);
    const second = (await daemon.call('get-card-graph', params)).result.find((node: any) => node.key === 'second');
    assert.equal(git('rev-parse', second.cardBranch), tip);
    await daemon.call('send-message', { ...params, key: 'same-cwd', body: '继续查看' });
    await ended(4);
    assert.equal(rounds[3]!.options.cwd, prepared.workPath);
    assert.equal(typeof rounds[3]!.options.resumeSessionId, 'string');
    assert.equal(JSON.parse(rounds[3]!.input).resumed, true);
    const loaded = (await daemon.call('get-events', params)).result.filter((event: any) => event.action === 'round-agent-loaded');
    assert.deepEqual(loaded.map((event: any) => event.details.resumed), [false, true, false, true]);
    assert.equal((await conversation()).result.filter((item: any) => item.sender === 'runtime' && item.body.includes('工作副本不包含')).length, notices.length);
  });
}

test('首次执行派单建工作副本失败时回滚，重试原派单可成功', async t => {
  let release!: () => void;
  const retry = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const dispatch: FakeStep = { type: 'tool', name: 'create-dispatch', arguments: ctx => ({
    key: 'execute', cardId: (ctx.results.get('card') as any).result.id, agentId: 'claude-executor',
  }), check: value => assert.equal((value as any).ok, true) };
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'draft', requirements: '重试', boundary: '本机', criteria: '无残留' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'card', content: '实现' }, saveAs: 'card' },
    { ...dispatch, check: value => assert.equal((value as any).error.code, 'GIT_ERROR') },
    { type: 'hang', until: retry }, dispatch,
  ]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '开始' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const gate = (await daemon.call('list-pending')).result[0];
  const hook = join(daemon.repo, '.git', 'hooks', 'post-checkout');
  await writeFile(hook, '#!/bin/sh\nexit 1\n');
  await chmod(hook, 0o755);
  await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  await until(() => daemon.call('get-events', params), value => value.result.some((event: any) => event.action === 'operation-rejected' && event.object.id === 'create-dispatch'));
  assert.equal((await daemon.call('get-work', params)).result.workPath, null);
  assert.deepEqual((await daemon.call('list-dispatches', params)).result, []);
  const refs = execFileSync('git', ['-C', daemon.repo, 'for-each-ref', '--format=%(refname)', 'refs/heads/helm/'], { encoding: 'utf8' });
  assert.equal(refs, '');
  assert.equal(existsSync(join(daemon.directory, 'data', 'worktrees', work.id, '_work')), false);
  await rm(hook);
  release();
  await until(() => daemon.call('list-dispatches', params), value => value.result.length === 1);
  assert.ok((await daemon.call('get-work', params)).result.workPath);
});

test('尚无工作分支的验收派单固定基准分支最新提交，不建工作或卡片副本', async t => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'draft', requirements: '验收', boundary: '本机', criteria: '最新基准' } },
  ], [
    { type: 'hang', until: ready },
    { type: 'tool', name: 'create-card', arguments: { key: 'card', content: '验收', needsVerification: true }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ key: 'verify', purpose: 'verification',
      cardId: (ctx.results.get('card') as any).result.id, agentId: 'claude-executor' }), check: value => assert.equal((value as any).ok, true) },
  ]], undefined, { executorScripts: [[{ type: 'hang' }]] });
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '验收' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const gate = (await daemon.call('list-pending')).result[0];
  await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  const git = (...args: string[]) => execFileSync('git', ['-C', daemon.repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  await writeFile(join(daemon.repo, 'README.md'), 'latest verification base\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'new base');
  const latest = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'user-branch', 'HEAD~1');
  release();
  const result = await until(() => daemon.call('list-dispatches', params), value => value.result[0]?.status === 'running');
  assert.equal(result.result[0].startCommit, latest);
  const current = (await daemon.call('get-work', params)).result;
  assert.equal(current.workBranch, null);
  assert.equal(current.workPath, null);
  const card = (await daemon.call('get-card-graph', params)).result.find((node: any) => node.type === 'card');
  assert.equal(card.cardBranch, null);
  assert.equal(card.workPath, null);
  assert.equal(git('for-each-ref', '--format=%(refname)', 'refs/heads/helm/'), '');
  assert.equal(existsSync(join(daemon.directory, 'data', 'worktrees', work.id, '_work')), false);
});
