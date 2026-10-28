import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { gunzipSync } from 'node:zlib';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';
import { reviewReport } from './fixtures/review-report.js';

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
  arguments: ctx => ({ workId: workIdOf(ctx), key, report: reviewReport(`汇总报告 ${key}`) }), saveAs: key, check });

test('发起审核逐字段校验汇总报告，缺结论说明或标准证据时不生成关卡', async t => {
  const report = reviewReport();
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workIdOf(ctx), key: 'structured',
      report: { ...report, summary: '', criteria: [{ criterion: '登录可用', status: 'passed', evidence: [] }] } }),
      check: (value: any) => {
        code('INVALID_PARAMS')(value);
        assert.match(value.error.reason, /report.summary/);
        assert.match(value.error.reason, /report.criteria.0.evidence/);
      } },
    { type: 'hang' },
  ]]);
  const events = await until(daemon.events, events => events.some(event => event.action === 'operation-rejected'));
  const failure = events.find(event => event.action === 'operation-rejected').details;
  assert.match(failure.reason, /report.summary/);
  assert.match(failure.reason, /report.criteria.0.evidence/);
  assert.equal((await daemon.getWork()).status, 'executing');
  assert.ok(!(await daemon.conversation()).some(item => item.kind === 'review'));
});

test('汇总报告按字段保存并在对话和待决定列表中返回；重试保留初稿，退回后可提交新报告', async t => {
  const daemon = await fixture(t, [[review()], [review('revision')]]);
  const gate = await daemon.pendingReview();
  assert.deepEqual(gate.report, reviewReport('汇总报告 review'));
  const pending = (await daemon.call('list-pending')).result.find((item: any) => item.id === gate.id);
  assert.deepEqual(pending.report, gate.report);
  assert.deepEqual((await daemon.events()).find(event => event.action === 'gate-created' && event.object.id === gate.id).details.report, gate.report);
  await daemon.roundsEnded(2);
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: gate.id, decision: 'return', comment: '补充证据' }));
  const revision = await until(daemon.conversation, items => items.filter(item => item.kind === 'review').length === 2);
  assert.deepEqual(revision.find(item => item.id === gate.id).report, gate.report);
  assert.deepEqual(revision.find(item => item.key === 'revision').report, reviewReport('汇总报告 revision'));
});

test('发起审核拒绝新提交的纯文本、缺失字段和无效枚举，错误逐项指向报告字段且同 key 可重试', async t => {
  const report = reviewReport();
  const invalid: { input: object; path: string }[] = [
    { input: { body: '旧式新提交' }, path: 'report' },
    ...['verdict', 'summary', 'exceptions', 'criteria', 'cards', 'suggestions'].map(field => {
      const missing: Record<string, unknown> = { ...report };
      delete missing[field];
      return { input: { report: missing }, path: `report.${field}` };
    }),
    { input: { report: { ...report, verdict: 'approved' } }, path: 'report.verdict' },
    { input: { report: { ...report, exceptions: [{ kind: 'unverified', what: '外网收信', why: ' ', evidence: [] }] } }, path: 'report.exceptions.0.why' },
    { input: { report: { ...report, criteria: [{ criterion: '登录可用', status: 'passed', evidence: [{ label: '证据', kind: 'command', ref: '' }] }] } }, path: 'report.criteria.0.evidence.0.kind' },
    { input: { report: { ...report, cards: [{ cardId: 'card', title: '登录', result: '完成', dispatches: [], evidence: report.criteria[0]!.evidence }] } }, path: 'report.cards.0.verification' },
  ];
  const daemon = await fixture(t, [[...invalid.map(({ input }): FakeStep => ({ type: 'tool', name: 'request-review',
    arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', ...input }) })), review()]]);
  const gate = await daemon.pendingReview();
  assert.deepEqual(gate.report, reviewReport('汇总报告 review'));
  const failures = (await daemon.events()).filter(event => event.action === 'operation-rejected' && event.object.id === 'request-review');
  assert.equal(failures.length, invalid.length);
  for (const [index, failure] of failures.entries()) {
    assert.equal(failure.details.code, 'INVALID_PARAMS');
    assert.ok(failure.details.reason.includes(invalid[index]!.path), failure.details.reason);
  }
});

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

for (const baseMoved of [false, true]) test(`合入冲突交给调度者：卡片副本解决并验收，保留接受并展示改动，${baseMoved ? '基准再次更新时重新选择处理' : '再次合入'}`, async t => {
  const executed = hold();
  const verified = hold();
  t.after(() => { executed.release(); verified.release(); });
  const daemon = await fixture(t, [[review()], [
    { type: 'tool', name: 'finish-conflict-resolution', arguments: ctx => ({ workId: workIdOf(ctx) }), check: code('RESOLUTION_UNVERIFIED') },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'skip-verification', content: '跳过验收' }), check: code('VERIFICATION_REQUIRED') },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'resolve', content: '合入 main 并解决 shared.txt 冲突', needsVerification: true }), saveAs: 'resolve', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'resolve').id, key: 'execute', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: executed.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'resolve').id }), check: code('VERIFICATION_REQUIRED') },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'resolve').id, key: 'verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: verified.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'resolve').id }), check: ok },
    review('no-new-review', code('CONFLICT_RESOLUTION_ACTIVE')),
    { type: 'tool', name: 'finish-conflict-resolution', arguments: ctx => ({ workId: workIdOf(ctx) }), check: ok },
    { type: 'tool', name: 'finish-conflict-resolution', arguments: ctx => ({ workId: workIdOf(ctx) }), check: ok },
  ]], [ctx => {
    const path = ctx.options.cwd;
    assert.match(path, /helm-card|worktrees/);
    assert.deepEqual(JSON.parse(ctx.input).conflictResolution.conflictFiles, ['shared.txt']);
    assert.match(git(path, 'status', '--porcelain'), /UU shared.txt/);
    writeFileSync(join(path, 'shared.txt'), 'work and base resolved\n');
    return [];
  }, [ { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '新副本确认同时保留两边结果，检查通过' }, check: ok } ]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  for (const [path, content] of [[work.workPath, 'work version\n'], [daemon.repo, 'base version\n']]) {
    await writeFile(join(path, 'shared.txt'), content);
    git(path, 'add', 'shared.txt'); git(path, ...identity, 'commit', '-m', content.trim());
  }
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  ok(await daemon.call('merge-work', { workId: work.id }));
  ok(await daemon.call('resolve-merge-conflict', { workId: work.id, resolution: 'coordinator' }));
  await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  assert.equal((await daemon.getWork()).delivery.resolution.status, 'solving');
  code('REVIEW_NOT_ACCEPTED')(await daemon.call('merge-work', { workId: work.id }));
  code('ACCEPTANCE_LOCKED')(await daemon.call('withdraw-acceptance', { workId: work.id }));
  executed.release();
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 2);
  verified.release();
  await until(daemon.getWork, value => value.status === 'accepted');
  const resolution = (await daemon.getWork()).delivery.resolution;
  assert.equal(resolution.status, 'resolved');
  const changes = await daemon.call('get-conflict-resolution', { workId: work.id });
  ok(changes); assert.match(changes.result.diff, /\+work and base resolved/);
  assert.equal(resolution.cards.length, 1);
  assert.ok(resolution.cards[0].verificationId);
  assert.equal((await daemon.conversation()).filter(item => item.kind === 'review').length, 1);
  if (baseMoved) {
    await writeFile(join(daemon.repo, 'shared.txt'), 'base changed again\n');
    git(daemon.repo, 'add', 'shared.txt'); git(daemon.repo, ...identity, 'commit', '-m', 'base changed again');
  }
  ok(await daemon.call('merge-work', { workId: work.id }));
  if (baseMoved) {
    assert.equal((await daemon.getWork()).status, 'accepted');
    assert.equal((await daemon.getWork()).delivery.merge.status, 'conflict');
    assert.equal((await daemon.getWork()).delivery.resolution, undefined);
    ok(await daemon.call('resolve-merge-conflict', { workId: work.id, resolution: 'manual' }));
    return;
  }
  assert.equal((await daemon.getWork()).status, 'merged');
  assert.equal(git(daemon.repo, 'show', 'main:shared.txt'), 'work and base resolved');
  assert.equal((await daemon.getWork()).delivery.resolution.status, 'resolved');
});

test('冲突标记未解决时不能自动保存为成功派单，也不能回到待合入', async t => {
  const ended = hold();
  t.after(ended.release);
  const daemon = await fixture(t, [[review()], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'resolve', content: '解决冲突', needsVerification: true }), saveAs: 'resolve', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'resolve').id, key: 'execute', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended.promise },
    { type: 'tool', name: 'finish-conflict-resolution', arguments: ctx => ({ workId: workIdOf(ctx) }), check: code('RESOLUTION_UNVERIFIED') },
  ]], [[]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  for (const [path, content] of [[work.workPath, 'work\n'], [daemon.repo, 'base\n']]) {
    await writeFile(join(path, 'shared.txt'), content);
    git(path, 'add', 'shared.txt'); git(path, ...identity, 'commit', '-m', content.trim());
  }
  const workTip = git(daemon.repo, 'rev-parse', work.workBranch);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  ok(await daemon.call('merge-work', { workId: work.id }));
  ok(await daemon.call('resolve-merge-conflict', { workId: work.id, resolution: 'coordinator' }));
  const events = await until(daemon.events, values => values.some(event => event.action === 'dispatch-ended'));
  assert.equal(events.find(event => event.action === 'dispatch-ended').details.endReason, 'error');
  ended.release();
  await daemon.roundsEnded(3);
  assert.equal((await daemon.getWork()).status, 'executing');
  assert.equal((await daemon.getWork()).delivery.resolution.status, 'solving');
  assert.equal(git(daemon.repo, 'rev-parse', work.workBranch), workTip);
});

test('自己处理冲突：重新检测只检查包含关系，本地合并后标记已包含并清理副本', async t => {
  const daemon = await fixture(t, [[review()]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  code('NO_MERGE_CONFLICT')(await daemon.call('resolve-merge-conflict', { workId: work.id, resolution: 'manual' }));
  for (const [path, content] of [[work.workPath, 'work\n'], [daemon.repo, 'base\n']]) {
    await writeFile(join(path, 'shared.txt'), content);
    git(path, 'add', 'shared.txt'); git(path, ...identity, 'commit', '-m', content.trim());
  }
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  ok(await daemon.call('merge-work', { workId: work.id }));
  ok(await daemon.call('resolve-merge-conflict', { workId: work.id, resolution: 'manual' }));
  assert.equal((await daemon.getWork()).delivery.resolution.status, 'manual');
  const before = git(daemon.repo, 'rev-parse', 'main');
  ok(await daemon.call('recheck-work-merge', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'accepted');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), before);
  assert.ok(existsSync(work.workPath));
  assert.throws(() => git(daemon.repo, ...identity, 'merge', '--no-edit', work.workBranch));
  const merging = git(daemon.repo, 'rev-parse', 'MERGE_HEAD');
  ok(await daemon.call('recheck-work-merge', { workId: work.id }));
  assert.equal(git(daemon.repo, 'rev-parse', 'MERGE_HEAD'), merging);
  assert.equal((await daemon.getWork()).status, 'accepted');
  await writeFile(join(daemon.repo, 'shared.txt'), 'manual resolution\n');
  git(daemon.repo, 'add', 'shared.txt'); git(daemon.repo, ...identity, 'commit', '-m', 'manual merge');
  const merged = git(daemon.repo, 'rev-parse', 'main');
  ok(await daemon.call('recheck-work-merge', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'merged');
  assert.equal((await daemon.getWork()).delivery.merge.status, 'already-contained');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), merged);
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
});

test('非终态卡片阻止审核，错误和拒绝事件列出卡片，全部取消后可用原 key 重试', async t => {
  const paused = hold();
  const rejected = hold();
  let returnedError: unknown;
  t.after(() => { paused.release(); rejected.release(); });
  const daemon = await fixture(t, [[
    ...['ready', 'waiting', 'paused'].map(key => ({ type: 'tool' as const, name: 'create-card',
      arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), key, content: `${key} 卡片` }), saveAs: key, check: ok })),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx),
      upstream: { type: 'card', id: saved(ctx, 'ready').id }, downstream: { type: 'card', id: saved(ctx, 'waiting').id } }), check: ok },
    { type: 'hang', until: paused.promise },
    review('review', value => { returnedError = value.error; code('NON_TERMINAL_CARDS')(value); }),
    { type: 'hang', until: rejected.promise },
    ...['ready', 'waiting', 'paused'].map(key => ({ type: 'tool' as const, name: 'cancel-card',
      arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id, reason: '移除需求' }), check: ok })),
    review(), { type: 'hang' },
  ]]);
  const graph = (await until(async () => (await daemon.call('get-card-graph', { workId: daemon.work.id })).result as any[],
    nodes => nodes.filter(node => node.type === 'card').length === 3 && nodes.some(node => node.status === 'waiting')))
    .filter(node => node.type === 'card');
  const pausedCard = graph.find(card => card.key === 'paused');
  ok(await daemon.call('pause-card', { workId: daemon.work.id, cardId: pausedCard.id }));
  paused.release();
  const events = await until(daemon.events, values => values.some(event => event.action === 'operation-rejected'
    || event.action === 'gate-created' && event.details.kind === 'review'));
  const failure = events.find(event => event.action === 'operation-rejected');
  assert.ok(failure, '非终态卡片存在时应拒绝审核，而非创建审核关卡');
  assert.deepEqual(await until(async () => returnedError, value => value !== undefined), failure.details);
  assert.equal(failure.object.id, 'request-review');
  assert.equal(failure.actor.type, 'coordinator-round');
  assert.equal(failure.details.code, 'NON_TERMINAL_CARDS');
  assert.match(failure.details.reason, /完成.*取消/);
  assert.deepEqual(failure.details.details.nonTerminalCards, graph.map(card => ({ id: card.id,
    content: card.content, status: card.key === 'paused' ? 'paused' : card.status })));
  assert.ok(failure.details.allowedOperations.includes('complete-card'));
  assert.ok(failure.details.allowedOperations.includes('cancel-card'));
  assert.equal((await daemon.getWork()).status, 'executing');
  assert.ok(!(await daemon.conversation()).some(item => item.kind === 'review'));
  assert.ok(!events.some(event => event.action === 'needs-user-attention' && event.details.kind === 'review'));
  rejected.release();
  const gate = await daemon.pendingReview();
  assert.equal(gate.key, 'review');
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  assert.equal(gate.review.rejectedOperationCount, 1);
});

test('审核是按 key 去重的固定关卡，仅接受或退回，退回保留报告和意见并唤醒新一轮', async t => {
  const daemon = await fixture(t, [[
    review(),
    { ...review(), arguments: ctx => ({ workId: workIdOf(ctx), key: 'review', report: reviewReport('重复调用不覆盖报告') }),
      check: (value: any) => { ok(value); assert.match(value.result.body, /汇总报告 review/); assert.deepEqual(value.result.report, reviewReport('汇总报告 review')); } },
    review('second-pending', code('REVIEW_PENDING')),
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, reason: '撤回' }), check: code('FIXED_GATE') },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, options: ['绕过审核'] }), check: code('FIXED_GATE') },
    { type: 'tool', name: 'decide-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'review').id, decision: 'accept' }), check: code('FORBIDDEN') },
  ], ctx => {
    const brief = JSON.parse(ctx.input) as StartupBrief;
    assert.equal(brief.work.status, 'executing');
    assert.ok(brief.wakeEvents.some(event => event.action === 'gate-decided' && (event.details as any).decision === 'return'));
    assert.ok(brief.recentConversation.some(item => (item as any).comment === 'shared.txt:1 请改进'));
    const original = brief.recentConversation.find(item => (item as any).key === 'review') as any;
    return [
      { type: 'tool', name: 'create-card', arguments: { workId: brief.work.id, key: 'repair', content: '处理审核意见' }, saveAs: 'repair', check: ok },
      review('review', value => { ok(value); assert.equal(value.result.id, original.id); assert.equal(value.result.body, original.body); }),
      review('revision', value => {
        code('NON_TERMINAL_CARDS')(value);
        assert.equal(value.error.details.nonTerminalCards.length, 1);
        assert.equal(value.error.details.nonTerminalCards[0].content, '处理审核意见');
        assert.equal(value.error.details.nonTerminalCards[0].status, 'ready');
      }),
      { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'repair').id, reason: '意见已通过消息澄清' }), check: ok },
      review('revision'),
    ];
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
  // Only the four business rejections count; MCP transport probes do not.
  assert.equal(pending.review.rejectedOperationCount, 4);
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

test('接受只记录决定；撤回后同一审核回到待决定，基准和远端不变', async t => {
  const daemon = await fixture(t, [[review()]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  await writeFile(join(work.workPath, 'accepted.txt'), 'accepted result\n');
  git(work.workPath, 'add', 'accepted.txt');
  git(work.workPath, ...identity, 'commit', '-m', 'accepted result');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal((await daemon.getWork()).status, 'accepted');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), daemon.baseline);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
  assert.equal(existsSync(work.workPath), true);
  ok(await daemon.call('withdraw-acceptance', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'awaiting-review');
  assert.equal((await daemon.pendingReview()).id, gate.id);
  assert.equal((await daemon.pendingReview()).decision, null);
  assert.ok(!(await daemon.events()).some(event => event.action === 'base-merge-result'));
});

for (const checkedOut of [true, false]) test(`审核接受后分别合入和推送基准分支（项目目录${checkedOut ? '已' : '未'}检出基准分支）`, async t => {
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
  ok(await daemon.call('merge-work', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'merged');
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
  const merge = git(daemon.repo, 'rev-parse', 'main');
  assert.equal(git(daemon.repo, 'rev-parse', `${merge}^1`), daemon.baseline);
  assert.equal(git(daemon.repo, 'rev-parse', `${merge}^2`), workTip);
  assert.equal(git(daemon.repo, 'show', 'main:result.txt'), 'reviewed result');
  code('ACCEPTANCE_LOCKED')(await daemon.call('withdraw-acceptance', { workId: work.id }));
  ok(await daemon.call('merge-work', { workId: work.id }));
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), merge);
  ok(await daemon.call('push-work', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'completed');
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

test('基准已包含工作分支时记录已包含并等待单独推送', async t => {
  const daemon = await fixture(t, [[review()]]);
  const gate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const work = await daemon.getWork();
  await writeFile(join(work.workPath, 'contained.txt'), 'already included\n');
  git(work.workPath, 'add', 'contained.txt');
  git(work.workPath, ...identity, 'commit', '-m', 'contained result');
  git(daemon.repo, ...identity, 'merge', '--no-ff', '--no-edit', work.workBranch);
  const base = git(daemon.repo, 'rev-parse', 'main');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  ok(await daemon.call('merge-work', { workId: work.id }));
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), base);
  assert.equal((await daemon.getWork()).status, 'merged');
  assert.equal((await daemon.getWork()).delivery.merge.status, 'already-contained');
  assert.equal(existsSync(work.workPath), false);
  assert.ok(!(await daemon.events()).some(event => event.action === 'base-push-result'));
  ok(await daemon.call('push-work', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'completed');
});

for (const conflict of [false, true]) test(`同项目合入串行，第二项基于第一项的新基准${conflict ? '报告冲突' : '合入'}`, async t => {
  const daemon = await fixture(t, [[review()], [
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '第二项工作', boundary: '本机', criteria: '独立合入' }), check: ok },
  ], [review()]]);
  const firstGate = await daemon.pendingReview();
  await daemon.roundsEnded(2);
  const projectId = (await daemon.getWork()).projectId;
  const second = (await daemon.call('send-message', { projectId, key: 'second', body: '第二项工作' })).result.work;
  const confirmation = await until(async () => (await daemon.call('list-pending')).result as any[], values => values.some(gate => gate.workId === second.id && gate.kind === 'work-confirmation' && gate.description));
  const gate = confirmation.find(gate => gate.workId === second.id);
  ok(await daemon.call('decide-gate', { workId: second.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const secondGate = await until(async () => (await daemon.call('get-conversation', { workId: second.id })).result as any[], values => values.some(gate => gate.kind === 'review'));
  const works = [await daemon.getWork(), (await daemon.call('get-work', { workId: second.id })).result];
  for (const [index, work] of works.entries()) {
    const file = conflict ? 'shared.txt' : `result-${index}.txt`;
    await writeFile(join(work.workPath, file), `result ${index}\n`);
    git(work.workPath, 'add', file);
    git(work.workPath, ...identity, 'commit', '-m', `result ${index}`);
    ok(await daemon.call('decide-gate', { workId: work.id, gateId: index === 0 ? firstGate.id : secondGate.find(gate => gate.kind === 'review').id, decision: 'accept' }));
  }
  const block = join(daemon.directory, 'block');
  const marker = join(daemon.directory, 'hook-entered');
  await writeFile(block, 'block');
  await writeFile(join(daemon.repo, '.git', 'hooks', 'pre-merge-commit'), `#!/bin/sh\necho reached > '${marker}'\nwhile [ -f '${block}' ]; do sleep 0.05; done\n`, { mode: 0o755 });
  const firstMerge = daemon.call('merge-work', { workId: works[0].id });
  await until(async () => existsSync(marker), Boolean);
  const secondMerge = daemon.call('merge-work', { workId: works[1].id });
  await until(async () => (await daemon.call('get-work', { workId: works[1].id })).result.status, status => status === 'merge-queued');
  code('ACCEPTANCE_LOCKED')(await daemon.call('withdraw-acceptance', { workId: works[1].id }));
  const duplicate = daemon.call('merge-work', { workId: works[1].id });
  await rm(block);
  for (const result of await Promise.all([firstMerge, secondMerge, duplicate])) ok(result);
  const firstTip = (await daemon.getWork()).delivery.merge.commit;
  const after = (await daemon.call('get-work', { workId: works[1].id })).result;
  assert.equal(after.status, conflict ? 'accepted' : 'merged');
  assert.equal(after.delivery.merge.status, conflict ? 'conflict' : 'merged');
  assert.equal((await daemon.call('get-events', { workId: works[1].id })).result.filter((event: any) => event.action === 'base-merge-result').length, 1);
  if (conflict) assert.deepEqual(after.delivery.merge.conflictFiles, ['shared.txt']);
  else assert.equal(git(daemon.repo, 'rev-parse', 'main^1'), firstTip);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
});

for (const problem of ['conflict', 'dirty-project', 'merge-hook', 'push'] as const) test(`审核接受后 ${problem} 保留阶段与工作分支，失败可重试`, async t => {
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
  ok(await daemon.call('merge-work', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, problem === 'push' ? 'merged' : 'accepted');
  assert.equal(existsSync(work.workPath), problem !== 'push');
  assert.equal(git(daemon.repo, 'rev-parse', work.workBranch), workTip);
  assert.equal(git(daemon.repo, 'status', '--porcelain'), statusBefore);
  assert.throws(() => git(daemon.repo, 'rev-parse', '--verify', 'MERGE_HEAD'));
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), daemon.baseline);
  assert.equal(git(daemon.repo, 'rev-parse', 'main') === baseBefore, problem !== 'push');
  const merge = (await daemon.getWork()).delivery.merge;
  assert.equal(merge.status, problem === 'conflict' ? 'conflict' : problem === 'push' ? 'merged' : 'failed');
  if (problem === 'conflict') {
    assert.deepEqual(merge.conflictFiles, [file]);
    ok(await daemon.call('withdraw-acceptance', { workId: work.id }));
    assert.equal((await daemon.getWork()).status, 'awaiting-review');
    return;
  }
  if (problem === 'push') {
    ok(await daemon.call('push-work', { workId: work.id }));
    assert.equal((await daemon.getWork()).status, 'merged');
    assert.equal((await daemon.getWork()).delivery.push.status, 'failed');
    assert.match((await daemon.getWork()).delivery.push.reason, /declined/);
    await rm(join(daemon.remote, 'hooks', 'pre-receive'));
  } else {
    assert.match(merge.reason, problem === 'dirty-project' ? /overwritten/ : /Not committing merge/);
    if (problem === 'dirty-project') git(daemon.repo, 'restore', file);
    else await rm(join(daemon.repo, '.git', 'hooks', 'pre-merge-commit'));
    ok(await daemon.call('merge-work', { workId: work.id }));
    assert.equal((await daemon.getWork()).status, 'merged');
  }
  ok(await daemon.call('push-work', { workId: work.id }));
  assert.equal((await daemon.getWork()).status, 'completed');
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), git(daemon.repo, 'rev-parse', 'main'));
});

test('审核附上真实 diff、整体验收结论与未声明派单数，接受时停止当前轮次且不再投递积压事件', async t => {
  const executed = hold();
  const verified = hold();
  t.after(() => { executed.release(); verified.release(); });
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id, key: 'execute', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: executed.promise },
    review('before-execution-completed', code('NON_TERMINAL_CARDS')),
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '按工作说明做整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: verified.promise },
    review('before-verification-completed', value => {
      code('NON_TERMINAL_CARDS')(value);
      assert.deepEqual(value.error.details.nonTerminalCards.map((card: any) => ({ content: card.content, status: card.status })),
        [{ content: '按工作说明做整体验收', status: 'verifying' }]);
    }),
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
  assert.equal(gate.review.rejectedOperationCount, 2);
  assert.equal(gate.review.overallVerification.length, 1);
  assert.equal(gate.review.overallVerification[0].conclusion, 'passed');
  assert.equal(gate.review.overallVerification[0].reason, '整体验收标准全部通过');
  const dispatches = (await daemon.call('list-dispatches', { workId: daemon.work.id })).result;
  assert.equal(gate.review.overallVerification[0].dispatchId, dispatches[1].id);
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), daemon.baseline);
  const work = await daemon.getWork();
  const outputParams = dispatches.map((dispatch: any) => ({ workId: work.id, dispatchId: dispatch.id }));
  const originalOutputs = await Promise.all(outputParams.map((params: any) => daemon.call('get-dispatch-output', params)));
  const roundPaths = (await daemon.events()).filter(event => event.action === 'round-started').map(event => event.details.outputPath as string);
  const originalRounds = await Promise.all(roundPaths.map(path => readFile(path)));
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  assert.equal(existsSync(work.workPath), true);
  assert.equal((await daemon.getWork()).status, 'accepted');
  ok(await daemon.call('merge-work', { workId: work.id }));
  ok(await daemon.call('push-work', { workId: work.id }));
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.getWork()).status, 'completed');
  for (const [index, dispatch] of dispatches.entries()) {
    assert.deepEqual(await daemon.call('get-dispatch-output', outputParams[index]), originalOutputs[index]);
    for (const step of originalOutputs[index].result) {
      const path = join(dispatch.outputPath, `${step.step}.json`);
      assert.equal(existsSync(path), false);
      assert.deepEqual(JSON.parse(gunzipSync(await readFile(`${path}.gz`)).toString()), step);
    }
  }
  for (const [index, path] of roundPaths.entries()) {
    assert.equal(existsSync(path), false);
    assert.deepEqual(gunzipSync(await readFile(`${path}.gz`)), originalRounds[index]);
  }
  assert.equal(git(daemon.remote, 'show', 'main:result.txt'), '实际成果');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  const end = (await daemon.events()).filter(event => event.action === 'round-ended').at(-1);
  assert.equal(end.details.abortReason, '审核接受');
  assert.equal((await daemon.conversation()).find(item => item.id === gate.id).review.overallVerification[0].conclusion, 'passed');
});

for (const oldStatus of ['cancelled', 'completed'] as const) test(`旧整体验收卡片 ${oldStatus} 后新卡不依赖旧卡，审核列出有效卡片的最近一次验收结论`, async t => {
  const ended = [hold(), hold(), hold(), hold(), hold()];
  t.after(() => ended.forEach(signal => signal.release()));
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'code', content: '实现成果' }), saveAs: 'code', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id, key: 'execute', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[0]!.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'code').id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'cancelled-code', content: '取消的实现' }), saveAs: 'cancelled-code', check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'cancelled-code').id, reason: '移除需求' }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'partial', content: '未覆盖全部实现的验收', needsVerification: true }), saveAs: 'partial', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'partial').id, key: 'partial-verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[1]!.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'partial').id }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'old-overall', content: '旧整体验收', needsVerification: true }), saveAs: 'old-overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'old-overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'old-overall').id, key: 'old-verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[2]!.promise },
    { type: 'tool', name: oldStatus === 'cancelled' ? 'cancel-card' : 'complete-card',
      arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'old-overall').id, ...(oldStatus === 'cancelled' ? { reason: '由新卡替代' } : {}) }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '新整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'code').id }, downstream: { type: 'card', id: saved(ctx, 'overall').id } }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'new-verify-failed', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[3]!.promise },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'new-verify-passed', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: ended[4]!.promise },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id }), check: ok },
    review(), { type: 'hang' },
  ]], [
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '实现完成' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '部分验收通过' }, check: ok }],
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

test('未结束验收的提前声明不能绕过终态检查，取消卡片后才可审核', async t => {
  const declared = hold();
  const rejected = hold();
  t.after(() => { declared.release(); rejected.release(); });
  const daemon = await fixture(t, [[
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'overall', content: '整体验收', needsVerification: true }), saveAs: 'overall', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, key: 'verify', purpose: 'verification', agentId: 'claude-executor' }), check: ok },
    { type: 'hang', until: declared.promise }, review('review', code('NON_TERMINAL_CARDS')),
    { type: 'hang', until: rejected.promise },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'overall').id, reason: '取消仍在运行的验收' }), check: ok },
    review(), { type: 'hang' },
  ]], [[{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '提前声明' }, check: ok }, { type: 'hang' }]]);
  await until(daemon.events, values => values.some(event => event.action === 'conclusion-submitted'));
  declared.release();
  const events = await until(daemon.events, values => values.some(event => event.action === 'operation-rejected'));
  const failure = events.find(event => event.action === 'operation-rejected').details;
  assert.equal(failure.code, 'NON_TERMINAL_CARDS');
  assert.equal(failure.details.nonTerminalCards[0].status, 'verifying');
  assert.equal((await daemon.getWork()).status, 'executing');
  assert.ok(!(await daemon.conversation()).some(item => item.kind === 'review'));
  rejected.release();
  const gate = await daemon.pendingReview();
  assert.deepEqual(gate.review.overallVerification, []);
  assert.equal(gate.review.undeclaredDispatchCount, 1, '取消后的派单结果不采信提前声明');
  const work = await daemon.getWork();
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  const dispatch = (await daemon.call('list-dispatches', { workId: work.id })).result[0];
  assert.equal(dispatch.status, 'ended');
  assert.equal(dispatch.endReason, 'aborted');
  assert.equal(dispatch.abortReason, '卡片取消');
  assert.equal(dispatch.conclusion, 'undeclared');
  assert.equal(existsSync(work.workPath), true);
  assert.equal((await daemon.getWork()).status, 'accepted');
  ok(await daemon.call('merge-work', { workId: work.id }));
  ok(await daemon.call('push-work', { workId: work.id }));
  assert.equal(existsSync(work.workPath), false);
  assert.equal((await daemon.getWork()).status, 'completed');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
});
