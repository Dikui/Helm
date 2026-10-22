import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startHelmd } from '../src/server.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hold = () => {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
};

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待完成流程超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const card = (key: string): FakeStep => ({ type: 'tool', name: 'create-card',
  arguments: ctx => ({ workId: workIdOf(ctx), key, content: key }), saveAs: key, check: ok });
const dispatch = (key: string): FakeStep => ({ type: 'tool', name: 'create-dispatch',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id, key, templateId: 'claude-executor' }), saveAs: `${key}-dispatch`, check: ok });
const complete = (key: string, check: (value: any) => void = ok): FakeStep => ({ type: 'tool', name: 'complete-card',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id }), check });
const cancel = (key: string, check: (value: any) => void = ok): FakeStep => ({ type: 'tool', name: 'cancel-card',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id, reason: '取消卡片' }), check });
const code = (expected: string) => (value: any) => assert.equal(value.error.code, expected);

async function fixture(t: TestContext, steps: FakeStep[], executors: FakeScript[]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm completion-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'shared.txt'), 'baseline\n');
  git(repo, 'add', 'shared.txt');
  git(repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), executorDriver: new FakeDriver(executors),
    driver: new FakeDriver([[
      { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '合并卡片', boundary: '本机', criteria: '成果进入工作分支' }), check: ok },
    ], [...steps, { type: 'end', reason: 'completed', finalAnswer: 'completion-script-finished' }]]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '合并卡片成果' })).result.work;
  const events = async () => (await call('get-events', { workId: work.id })).result as any[];
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const finished = async () => {
    const values = await until(events, values => values.filter(event => event.action === 'round-ended').length >= 2);
    assert.equal(values.filter(event => event.action === 'round-ended')[1].details.finalAnswer, 'completion-script-finished', JSON.stringify(values));
  };
  const cards = async () => (await call('get-card-graph', { workId: work.id })).result.filter((node: any) => node.type === 'card') as any[];
  return { call, work, repo, events, finished, cards };
}

test('完成卡片先合并、删除副本和分支，重复完成保持成果和事件不变', async t => {
  const ended = hold();
  t.after(ended.release);
  const daemon = await fixture(t, [card('upstream'), dispatch('upstream'), { type: 'hang', until: ended.promise }, complete('upstream'), complete('upstream')], [[
    { type: 'write', path: 'upstream.txt', content: '上游成果\n' },
  ]]);
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  const before = (await daemon.cards())[0];
  const tip = git(daemon.repo, 'rev-parse', before.cardBranch);
  assert.equal((await daemon.call('complete-card', { workId: daemon.work.id, cardId: before.id })).error.code, 'FORBIDDEN');
  ended.release();
  await daemon.finished();
  const completed = (await daemon.cards())[0];
  assert.equal(completed.status, 'completed');
  const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
  const mergeCommit = git(daemon.repo, 'rev-parse', work.workBranch);
  assert.equal(git(daemon.repo, 'show', `${work.workBranch}:upstream.txt`), '上游成果');
  assert.equal(git(daemon.repo, 'rev-parse', `${mergeCommit}^2`), tip);
  assert.equal(git(daemon.repo, 'rev-parse', `${mergeCommit}^1`), git(daemon.repo, 'rev-parse', 'main'));
  assert.equal(git(work.workPath, 'status', '--porcelain'), '');
  await assert.rejects(access(before.workPath));
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${before.cardBranch}`), '');
  assert.ok(!git(daemon.repo, 'worktree', 'list', '--porcelain').includes(before.workPath));
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: before.latestDispatchId })).result;
  const branch = artifacts.find((artifact: any) => artifact.kind === 'branch');
  assert.equal(branch.ref, work.workBranch);
  assert.equal(branch.commitSha, mergeCommit);
  const read = (await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: branch.id })).result;
  assert.equal(read.ref, work.workBranch);
  assert.equal(read.commitSha, mergeCommit);
  assert.equal((await daemon.events()).filter(event => event.action === 'card-completed').length, 1);
});

test('两张卡片冲突时保持原状态，修复卡片合入原分支后可完成原卡片，下游含全部成果', async t => {
  const bothEnded = hold();
  const inspected = hold();
  const repairEnded = hold();
  t.after(() => { bothEnded.release(); inspected.release(); repairEnded.release(); });
  let originalBranch = '';
  let workTip = '';
  const daemon = await fixture(t, [
    card('first'), card('original'), card('downstream'),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'original').id }, downstream: { type: 'card', id: saved(ctx, 'downstream').id } }), check: ok },
    dispatch('first'), dispatch('original'), { type: 'hang', until: bothEnded.promise },
    complete('first'), complete('original', value => {
      assert.equal(value.error.code, 'WORK_BRANCH_CONFLICT');
      assert.equal(value.error.reason, '与工作分支冲突');
    }), { type: 'hang', until: inspected.promise },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'repair', content: '解决 shared.txt 的冲突', repairOfCardId: saved(ctx, 'original').id }), saveAs: 'repair', check: ok },
    dispatch('repair'), { type: 'hang', until: repairEnded.promise }, complete('repair'), complete('original'), complete('original'), dispatch('downstream'),
  ], [
    [{ type: 'write', path: 'shared.txt', content: 'first\n' }, { type: 'write', path: 'first.txt', content: '第一张成果\n' }],
    [{ type: 'write', path: 'shared.txt', content: 'original\n' }, { type: 'write', path: 'original.txt', content: '原卡片成果\n' }],
    ctx => {
      assert.equal(git(ctx.options.cwd, 'rev-parse', 'HEAD'), workTip);
      assert.match(JSON.parse(ctx.input).content, new RegExp(originalBranch));
      assert.throws(() => git(ctx.options.cwd, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'merge', '--no-ff', '--no-edit', originalBranch));
      return [{ type: 'write', path: 'shared.txt', content: 'resolved: first + original\n' }];
    },
    ctx => {
      assert.equal(git(ctx.options.cwd, 'show', 'HEAD:shared.txt'), 'resolved: first + original');
      assert.equal(git(ctx.options.cwd, 'show', 'HEAD:first.txt'), '第一张成果');
      assert.equal(git(ctx.options.cwd, 'show', 'HEAD:original.txt'), '原卡片成果');
      return [];
    },
  ]);
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 2);
  const before = (await daemon.cards()).find(item => item.key === 'original');
  originalBranch = before.cardBranch;
  bothEnded.release();
  await until(daemon.events, values => values.some(event => event.action === 'operation-rejected' && event.details.code === 'WORK_BRANCH_CONFLICT'));
  const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
  workTip = git(daemon.repo, 'rev-parse', work.workBranch);
  assert.equal(git(work.workPath, 'status', '--porcelain'), '');
  assert.throws(() => git(work.workPath, 'rev-parse', '--verify', 'MERGE_HEAD'));
  assert.deepEqual((await daemon.cards()).find(item => item.id === before.id), before);
  assert.equal((await daemon.cards()).find(item => item.key === 'downstream').status, 'waiting');
  inspected.release();
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 3);
  repairEnded.release();
  await daemon.finished();
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 4);
  const cards = await daemon.cards();
  const repair = cards.find(item => item.key === 'repair');
  assert.equal(repair.repairOfCardId, before.id);
  assert.equal(repair.status, 'completed');
  assert.equal(cards.find(item => item.id === before.id).status, 'completed');
  const merge = git(daemon.repo, 'rev-parse', work.workBranch);
  assert.equal(git(daemon.repo, 'rev-list', '--count', '--first-parent', `${workTip}..${merge}`), '1');
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: before.latestDispatchId })).result;
  assert.equal(artifacts.find((item: any) => item.kind === 'branch').commitSha, merge);
  for (const item of cards.filter(item => item.status === 'completed')) {
    await assert.rejects(access(item.workPath));
    assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${item.cardBranch}`), '');
  }
  assert.equal(git(daemon.repo, 'show', 'main:shared.txt'), 'baseline');
  assert.equal((await daemon.events()).filter(event => event.action === 'card-completed' && event.cardId === before.id).length, 1);
});

test('没有正常完成派单的卡片只能取消，需要验收的卡片不能直接完成，终态不能改写', async t => {
  const ended = hold();
  t.after(ended.release);
  const daemon = await fixture(t, [
    card('unrun'), complete('unrun', code('NO_COMPLETED_DISPATCH')), cancel('unrun'), cancel('unrun'), complete('unrun', code('TERMINAL_CARD')),
    card('errored'), dispatch('errored'), card('verification'),
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'verification').id, needsVerification: true }), check: ok },
    dispatch('verification'), { type: 'hang', until: ended.promise },
    complete('errored', code('NO_COMPLETED_DISPATCH')), complete('verification', code('VERIFICATION_REQUIRED')),
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'verification').id, needsVerification: false }), check: ok },
    complete('verification'), cancel('verification', code('TERMINAL_CARD')), cancel('errored'), cancel('errored'),
  ], [
    [{ type: 'write', path: 'discarded.txt', content: '取消时丢弃\n' }, { type: 'crash' }],
    [],
  ]);
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 2);
  const before = (await daemon.cards()).find(item => item.key === 'errored');
  ended.release();
  await daemon.finished();
  const cards = await daemon.cards();
  assert.equal(cards.find(item => item.key === 'unrun').status, 'cancelled');
  assert.equal(cards.find(item => item.key === 'errored').status, 'cancelled');
  assert.equal(cards.find(item => item.key === 'verification').status, 'completed');
  await assert.rejects(access(before.workPath));
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${before.cardBranch}`), '');
  assert.throws(() => git(daemon.repo, 'show', `helm/${daemon.work.id}:discarded.txt`));
  const params = { workId: daemon.work.id, dispatchId: before.latestDispatchId };
  assert.ok((await daemon.call('get-dispatch-output', params)).result.some((step: any) => step.text === 'Wrote discarded.txt'));
  assert.equal((await daemon.call('get-dispatch', params)).result.endReason, 'error');
  assert.equal((await daemon.events()).filter(event => event.action === 'card-cancelled').length, 2);
});

test('派单进行中不能完成，取消后停止派单、保留输出和成果并删除副本', async t => {
  const written = hold();
  t.after(written.release);
  const daemon = await fixture(t, [card('active'), dispatch('active'), { type: 'hang', until: written.promise },
    complete('active', code('DISPATCH_ACTIVE')), cancel('active'), cancel('active'), complete('active', code('TERMINAL_CARD')),
  ], [[{ type: 'write', path: 'progress.txt', content: '已保存的进度\n' }, { type: 'output', text: '取消前的输出' }, { type: 'hang' }]]);
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-step' && event.details.summary === '取消前的输出'));
  const before = (await daemon.cards())[0];
  written.release();
  await daemon.finished();
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  assert.equal((await daemon.cards())[0].status, 'cancelled');
  await assert.rejects(access(before.workPath));
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${before.cardBranch}`), '');
  const params = { workId: daemon.work.id, dispatchId: before.latestDispatchId };
  const result = (await daemon.call('get-dispatch', params)).result;
  assert.equal(result.endReason, 'aborted');
  assert.equal(result.abortReason, '卡片取消');
  assert.equal(result.finalAnswer, null);
  const artifacts = (await daemon.call('get-dispatch-artifacts', params)).result;
  const file = artifacts.find((item: any) => item.kind === 'file' && item.name === 'progress.txt');
  assert.equal((await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: file.id })).result.content, '已保存的进度\n');
  assert.ok((await daemon.call('get-dispatch-output', params)).result.some((step: any) => step.text === '取消前的输出'));
  assert.throws(() => git(daemon.repo, 'show', `helm/${daemon.work.id}:progress.txt`));
});

test('合并成功但清理失败时不写完成，清理后重试复用已有合并提交', async t => {
  const ended = hold();
  const retry = hold();
  t.after(() => { ended.release(); retry.release(); });
  const daemon = await fixture(t, [card('retry'), dispatch('retry'), { type: 'hang', until: ended.promise },
    complete('retry', code('GIT_ERROR')), { type: 'hang', until: retry.promise }, complete('retry'),
  ], [[{ type: 'write', path: 'retry.txt', content: '成果只合并一次\n' }]]);
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  const before = (await daemon.cards())[0];
  const extra = join(daemon.repo, '..', 'extra');
  git(daemon.repo, 'worktree', 'add', '--force', extra, before.cardBranch);
  ended.release();
  await until(daemon.events, values => values.some(event => event.action === 'operation-rejected' && event.details.code === 'GIT_ERROR'));
  assert.equal((await daemon.cards())[0].status, 'executing');
  assert.ok(!(await daemon.events()).some(event => event.action === 'card-completed'));
  const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
  const merge = git(daemon.repo, 'rev-parse', work.workBranch);
  assert.equal(git(daemon.repo, 'show', `${merge}:retry.txt`), '成果只合并一次');
  git(daemon.repo, 'worktree', 'remove', extra);
  git(daemon.repo, 'branch', '-D', before.cardBranch);
  retry.release();
  await daemon.finished();
  assert.equal((await daemon.cards())[0].status, 'completed');
  assert.equal(git(daemon.repo, 'rev-parse', work.workBranch), merge);
});

test('取消时即使补提交失败也删除副本并保留派单输出', async t => {
  const written = hold();
  t.after(written.release);
  const daemon = await fixture(t, [card('commit-fails'), dispatch('commit-fails'), { type: 'hang', until: written.promise }, cancel('commit-fails')], [[
    { type: 'write', path: 'discarded.txt', content: '取消的进度\n' }, { type: 'hang' },
  ]]);
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-step'));
  const before = (await daemon.cards())[0];
  await writeFile(join(daemon.repo, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  written.release();
  await daemon.finished();
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  await assert.rejects(access(before.workPath));
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${before.cardBranch}`), '');
  const params = { workId: daemon.work.id, dispatchId: before.latestDispatchId };
  const result = (await daemon.call('get-dispatch', params)).result;
  assert.equal(result.endReason, 'aborted');
  assert.ok(result.failure);
  assert.ok((await daemon.call('get-dispatch-output', params)).result.some((step: any) => step.text === 'Wrote discarded.txt'));
});
