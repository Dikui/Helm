import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startHelmd } from '../src/server.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const code = (expected: string) => (value: any) => assert.equal(value.error?.code, expected, JSON.stringify(value));
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = ['-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid'];
const hold = () => {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
};

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待审核流程超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const review = (key = 'review', check: (value: any) => void = ok): Extract<FakeStep, { type: 'tool' }> => ({ type: 'tool', name: 'request-review',
  arguments: ctx => ({ workId: workIdOf(ctx), key, body: `汇总报告 ${key}：[成果](helm://artifact/result)` }), saveAs: key, check });

async function fixture(t: TestContext, rounds: FakeScript[], executors: FakeScript[] = []) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm review-')));
  const repo = join(directory, 'project');
  const remote = join(directory, 'remote.git');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  await writeFile(join(repo, 'shared.txt'), 'baseline\n');
  git(repo, 'add', 'shared.txt');
  git(repo, ...identity, 'commit', '-m', 'baseline');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  const baseline = git(repo, 'rev-parse', 'main');
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), executorDriver: new FakeDriver(executors),
    driver: new FakeDriver([[
      { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '审核成果', boundary: '本机', criteria: '接受后合并推送' }), check: ok },
    ], ...rounds]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '请实现并交给我审核' })).result.work;
  const events = async (): Promise<any[]> => (await call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const confirmation = (await call('list-pending')).result[0];
  ok(await call('decide-gate', { workId: work.id, gateId: confirmation.id, descriptionId: confirmation.description.id, decision: 'confirm' }));
  const getWork = async () => (await call('get-work', { workId: work.id })).result;
  const conversation = async (): Promise<any[]> => (await call('get-conversation', { workId: work.id })).result;
  const pendingReview = async () => (await until(conversation, values => values.some(item => item.kind === 'review' && item.status === 'pending')))
    .find(item => item.kind === 'review' && item.status === 'pending');
  const roundsEnded = (count: number) => until(events, values => values.filter(event => event.action === 'round-ended').length >= count);
  return { ...daemon, directory, repo, remote, baseline, work, call, events, getWork, conversation, pendingReview, roundsEnded };
}

test('审核是按 key 去重的固定关卡，仅接受或退回，退回保留报告和意见并唤醒新一轮', async t => {
  const daemon = await fixture(t, [[
    review(),
    { ...review(), arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', body: '重复调用不覆盖报告' }),
      check: (value: any) => { ok(value); assert.match(value.result.body, /汇总报告 review/); } },
    review('second-pending', code('REVIEW_PENDING')),
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, reason: '撤回' }), check: code('FIXED_GATE') },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, options: ['绕过审核'] }), check: code('FIXED_GATE') },
    { type: 'tool', name: 'decide-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, decision: 'accept' }), check: code('FORBIDDEN') },
  ], ctx => {
    const brief = JSON.parse(ctx.input) as StartupBrief;
    assert.equal(brief.work.status, 'executing');
    assert.ok(brief.wakeEvents.some(event => event.action === 'gate-decided' && (event.details as any).decision === 'return'));
    assert.ok(brief.recentConversation.some(item => (item as any).comment === 'shared.txt:1 请改进'));
    return [review('revision')];
  }]);
  await daemon.roundsEnded(2);
  const gate = await daemon.pendingReview();
  assert.deepEqual(gate.options, ['accept', 'return']);
  assert.match(gate.body, /汇总报告 review/);
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), daemon.baseline);
  assert.equal(existsSync((await daemon.getWork()).workPath), true);
  const pending = (await daemon.call('list-pending')).result.find((item: any) => item.id === gate.id);
  assert.equal(pending.review.diff, '');
  assert.deepEqual(pending.review.overallVerification, []);
  // The two MCP clients also attempted the unsupported GET transport.
  assert.equal(pending.review.rejectedOperationCount, 6);
  assert.equal(pending.review.undeclaredDispatchCount, 0);
  assert.ok((await daemon.events()).some(event => event.action === 'needs-user-attention' && event.details.kind === 'review'));
  code('INVALID_PARAMS')(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: '自由回答' }));
  const controller = new AbortController();
  t.after(() => controller.abort());
  const stream = await fetch(`${daemon.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workId: daemon.work.id, after: (await daemon.events()).at(-1).id }),
    signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) });
  const attention = (async () => {
    let data = '';
    for await (const chunk of stream.body!) {
      data += new TextDecoder().decode(chunk);
      if (data.includes('event: needs-user-attention') && data.includes('"kind":"review"')) return data;
    }
    assert.fail('未收到审核 SSE 通知');
  })();
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: 'return', comment: 'shared.txt:1 请改进' }));
  await daemon.roundsEnded(3);
  const revision = await daemon.pendingReview();
  assert.match(await attention, /"kind":"review"/);
  assert.notEqual(revision.id, gate.id);
  const old = (await daemon.conversation()).find(item => item.id === gate.id);
  assert.equal(old.decision, 'return');
  assert.equal(old.comment, 'shared.txt:1 请改进');
  assert.equal(old.body, gate.body);
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  code('GATE_DECIDED')(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: 'accept' }));
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: 'return', comment: 'shared.txt:1 请改进' }));
  assert.equal((await daemon.events()).filter(event => event.action === 'gate-created' && event.details.kind === 'review').length, 2);
});

for (const checkedOut of [true, false]) test(`审核接受后合并并推送基准分支（项目目录${checkedOut ? '已' : '未'}检出基准分支）`, async t => {
  const daemon = await fixture(t, [[review()]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  await writeFile(join(work.workPath, 'result.txt'), 'reviewed result\n');
  git(work.workPath, 'add', 'result.txt');
  git(work.workPath, ...identity, 'commit', '-m', 'work result');
  const workTip = git(daemon.repo, 'rev-parse', work.workBranch);
  if (checkedOut) git(daemon.repo, 'config', 'branch.main.mergeOptions', '--no-commit');
  if (!checkedOut) git(daemon.repo, 'checkout', '-b', 'user-branch');
  await writeFile(join(daemon.repo, 'local.txt'), '用户未提交的文件\n');
  const before = git(daemon.repo, 'status', '--porcelain');
  const observed = (await daemon.call('list-pending')).result.find((item: any) => item.id === gate.id);
  assert.match(observed.review.diff, /\+reviewed result/);
  assert.equal(observed.review.workCommit, workTip);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal((await daemon.getWork()).status, 'completed');
  const merge = git(daemon.repo, 'rev-parse', 'main');
  assert.equal(git(daemon.repo, 'rev-parse', `${merge}^1`), daemon.baseline);
  assert.equal(git(daemon.repo, 'rev-parse', `${merge}^2`), workTip);
  assert.equal(git(daemon.repo, 'show', 'main:result.txt'), 'reviewed result');
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), merge);
  assert.equal(git(daemon.repo, 'branch', '--show-current'), checkedOut ? 'main' : 'user-branch');
  assert.equal(git(daemon.repo, 'status', '--porcelain'), before);
  if (!checkedOut) assert.equal(git(daemon.repo, 'rev-parse', 'HEAD'), daemon.baseline);
  assert.equal(existsSync(work.workPath), false);
  assert.ok(!git(daemon.repo, 'worktree', 'list', '--porcelain').includes(work.workPath));
  assert.equal(git(daemon.repo, 'rev-parse', work.workBranch), workTip);
  const events = await daemon.events();
  assert.equal(events.filter(event => event.action === 'base-merge-result').at(-1).details.status, 'merged');
  assert.equal(events.filter(event => event.action === 'base-push-result').at(-1).details.status, 'pushed');
  assert.equal((await daemon.call('list-pending')).result.length, 0);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), merge);
  assert.equal((await daemon.events()).filter(event => event.action === 'base-push-result').length, 1);
  code('TERMINAL_WORK')(await daemon.call('send-message', { workId: work.id, key: 'after', body: '不应再唤醒' }));
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
});

for (const problem of ['conflict', 'dirty-project', 'merge-hook', 'push'] as const) test(`审核接受后 ${problem} 只报告一次，工作仍完成且保留工作分支`, async t => {
  const daemon = await fixture(t, [[review()]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  const file = problem === 'conflict' ? 'conflict file\n中文.txt' : 'shared.txt';
  if (problem === 'conflict') {
    // Add a shared ancestor for an unusual path so merge-tree must return its exact filename.
    await writeFile(join(daemon.repo, file), 'baseline\n');
    git(daemon.repo, 'add', '--', file);
    git(daemon.repo, ...identity, 'commit', '-m', 'common file');
    git(work.workPath, 'merge', '--ff-only', 'main');
  }
  await writeFile(join(work.workPath, file), 'work version\n');
  git(work.workPath, 'add', '--', file);
  git(work.workPath, ...identity, 'commit', '-m', 'work result');
  const workTip = git(daemon.repo, 'rev-parse', work.workBranch);
  if (problem === 'conflict') {
    await writeFile(join(daemon.repo, file), 'user version\n');
    git(daemon.repo, 'add', '--', file);
    git(daemon.repo, ...identity, 'commit', '-m', 'user changes');
  }
  if (problem === 'dirty-project') await writeFile(join(daemon.repo, file), 'uncommitted user changes\n');
  if (problem === 'merge-hook') await writeFile(join(daemon.repo, '.git', 'hooks', 'pre-merge-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  if (problem === 'push') await writeFile(join(daemon.remote, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  const baseBefore = git(daemon.repo, 'rev-parse', 'main');
  const statusBefore = git(daemon.repo, 'status', '--porcelain');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal((await daemon.getWork()).status, 'completed');
  assert.equal(existsSync(work.workPath), false);
  assert.equal(git(daemon.repo, 'rev-parse', work.workBranch), workTip);
  assert.equal(git(daemon.repo, 'status', '--porcelain'), statusBefore);
  assert.throws(() => git(daemon.repo, 'rev-parse', '--verify', 'MERGE_HEAD'));
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
  assert.equal(git(daemon.repo, 'rev-parse', 'main') === baseBefore, problem !== 'push');
  const events = await daemon.events();
  const merge = events.find(event => event.action === 'base-merge-result').details;
  const push = events.find(event => event.action === 'base-push-result').details;
  assert.equal(merge.status, problem === 'conflict' ? 'conflict' : problem === 'push' ? 'merged' : 'failed');
  assert.equal(push.status, problem === 'push' ? 'failed' : 'skipped');
  const message = (await daemon.conversation()).find(item => item.type === 'message' && item.sender === 'runtime');
  assert.ok(message, JSON.stringify(await daemon.conversation()));
  if (problem === 'conflict') {
    assert.deepEqual(merge.conflictFiles, [file]);
    assert.ok(message.body.includes(file));
    assert.ok(message.body.includes(work.workBranch));
  }
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal((await daemon.events()).filter(event => event.action === 'base-merge-result').length, 1);
  assert.equal((await daemon.events()).filter(event => event.action === 'base-push-result').length, 1);
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
});

test('审核附上真实 diff、整体验收结论与未声明派单数，接受时停止当前轮次且不再投递积压事件', async t => {
  const executed = hold();
  const verified = hold();
  t.after(() => { executed.release(); verified.release(); });
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id, key: 'execute', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: executed.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '按工作说明做整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'verify', purpose: 'verification', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: verified.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id }), check: ok },
    review(), { type: 'hang' },
  ]], [
    [{ type: 'write', path: 'result.txt', content: '实际成果\n' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '整体验收标准全部通过' }, check: ok }],
  ]);
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  executed.release();
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 2);
  verified.release();
  const gate = await daemon.pendingReview();
  assert.match(gate.review.diff, /\+实际成果/);
  assert.equal(gate.review.baseRef, 'main');
  assert.equal(gate.review.baseCommit, daemon.baseline);
  assert.equal(gate.review.undeclaredDispatchCount, 1);
  assert.equal(gate.review.overallVerification.length, 1);
  assert.equal(gate.review.overallVerification[0].conclusion, 'passed');
  assert.equal(gate.review.overallVerification[0].reason, '整体验收标准全部通过');
  const dispatches = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result;
  assert.equal(gate.review.overallVerification[0].dispatchId, dispatches[1].id);
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), daemon.baseline);
  const work = await daemon.getWork();
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.getWork()).status, 'completed');
  assert.equal(git(daemon.remote, 'show', 'main:result.txt'), '实际成果');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  const end = (await daemon.events()).filter(event => event.action === 'round-ended').at(-1);
  assert.equal(end.details.abortReason, '审核接受');
  assert.equal((await daemon.conversation()).find(item => item.id === gate.id).review.overallVerification[0].conclusion, 'passed');
});

for (const oldStatus of ['cancelled', 'completed'] as const) test(`旧整体验收卡片 ${oldStatus} 后新卡不依赖旧卡，审核列出有效卡片的最近一次验收结论`, async t => {
  const ended = [hold(), hold(), hold(), hold()];
  t.after(() => ended.forEach(signal => signal.release()));
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id, key: 'execute', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[0]!.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'cancelled-code', content: '取消的实现' }), saveAs: 'cancelled-code', check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'cancelled-code').id, reason: '移除需求' }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'partial', content: '未覆盖全部实现的验收', needsVerification: true }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'old-overall', content: '旧整体验收', needsVerification: true }), saveAs: 'old-overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'old-overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'old-overall').id, key: 'old-verify', purpose: 'verification', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[1]!.promise },
    { type: 'tool', name: oldStatus === 'cancelled' ? 'cancel-card' : 'complete-card',
      arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'old-overall').id, ...(oldStatus === 'cancelled' ? { reason: '由新卡替代' } : {}) }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '新整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'new-verify-failed', purpose: 'verification', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[2]!.promise },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'new-verify-passed', purpose: 'verification', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[3]!.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id }), check: ok },
    review(), { type: 'hang' },
  ]], [
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '实现完成' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '旧卡验收通过' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: '需要再次检查' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '新卡最近一次验收通过' }, check: ok }],
  ]);
  for (const [index, signal] of ended.entries()) {
    await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === index + 1);
    signal.release();
  }
  const gate = await daemon.pendingReview();
  const dispatches = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result;
  const old = dispatches.find((dispatch: any) => dispatch.key === 'old-verify');
  const latest = dispatches.find((dispatch: any) => dispatch.key === 'new-verify-passed');
  const expected = [{ cardId: latest.cardId, dispatchId: latest.id,
    status: 'ended', endReason: 'completed', conclusion: 'passed', reason: '新卡最近一次验收通过' }];
  if (oldStatus === 'completed') expected.push({ cardId: old.cardId, dispatchId: old.id,
    status: 'ended', endReason: 'completed', conclusion: 'passed', reason: '旧卡验收通过' });
  assert.deepEqual(gate.review.overallVerification.toSorted((a: any, b: any) => a.cardId.localeCompare(b.cardId)),
    expected.toSorted((a, b) => a.cardId.localeCompare(b.cardId)));
});

test('审核未关闭时确认新版工作说明仍待审核；暂停恢复保持关卡，退回后恢复执行', async t => {
  const daemon = await fixture(t, [[review(),
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'revision', requirements: '新版需求', boundary: '本机', criteria: '新版标准' }), check: ok },
  ]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const confirmation = (await daemon.call('list-pending')).result.find((item: any) => item.kind === 'work-confirmation');
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: confirmation.id, descriptionId: confirmation.description.id, decision: 'confirm' }));
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  ok(await daemon.call('pause-work', { workId: daemon.work.id }));
  ok(await daemon.call('resume-work', { workId: daemon.work.id }));
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  ok(await daemon.call('pause-work', { workId: daemon.work.id }));
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: 'return' }));
  assert.equal((await daemon.getWork()).status, 'paused');
  ok(await daemon.call('resume-work', { workId: daemon.work.id }));
  assert.equal((await daemon.getWork()).status, 'executing');
});

test('审核不把未结束验收的提前声明当作派单结果，接受后中止派单且不再唤醒', async t => {
  const declared = hold();
  t.after(declared.release);
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'verify', purpose: 'verification', templateId: 'claude-executor' }), check: ok },
    { type: 'hang', until: declared.promise }, review(), { type: 'hang' },
  ]], [[{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '提前声明' }, check: ok }, { type: 'hang' }]]);
  await until(daemon.events, values => values.some(event => event.action === 'conclusion-submitted'));
  declared.release();
  const gate = await daemon.pendingReview();
  assert.equal(gate.review.overallVerification[0].status, 'running');
  assert.equal(gate.review.overallVerification[0].conclusion, 'undeclared');
  assert.equal(gate.review.undeclaredDispatchCount, 0, '只统计已形成派单结果的派单');
  const work = await daemon.getWork();
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  const dispatch = (await daemon.call('list-dispatches', { workId: work.id })).result[0];
  assert.equal(dispatch.status, 'ended');
  assert.equal(dispatch.endReason, 'aborted');
  assert.equal(dispatch.abortReason, '审核接受');
  assert.equal(dispatch.conclusion, 'undeclared');
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.getWork()).status, 'completed');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
});
