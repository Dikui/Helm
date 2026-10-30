import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import type { FakeContext, FakeStep } from '../src/driver.js';
import { uiFixture, until } from './ui-fixture.js';
import { reviewReport } from './fixtures/review-report.js';

const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: {
  key: 'brief', requirements: '分析已有文件', boundary: '只读', criteria: '给出结论',
}, check: value => assert.equal((value as any).ok, true) };
const saved = (ctx: FakeContext, key: string) => (ctx.results.get(key) as any).result;
const ok = (value: unknown) => assert.equal((value as any).ok, true, JSON.stringify(value));

test('非 git 项目从登记、对齐、只读派单到审核可用；写代码和验收的初始化阻塞对调度者可见', async t => {
  let projectPath = '', executorStarted = false, rejected = 0;
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const requiresGit = (value: unknown) => {
    const result = value as any;
    assert.equal(result.ok, false);
    assert.ok(['GIT_INITIALIZATION_PENDING', 'CARD_NOT_DISPATCHABLE'].includes(result.error.code));
    rejected++;
  };
  const dispatch = (card: string, purpose: 'execution' | 'verification', check = ok): FakeStep => ({
    type: 'tool', name: 'create-dispatch', arguments: ctx => ({
      key: `${card}-${purpose}`, cardId: saved(ctx, card).id, agentId: 'claude-executor', purpose,
    }), check,
  });
  const daemon = await uiFixture([
    ctx => {
      assert.equal(ctx.options.cwd, projectPath);
      assert.deepEqual(ctx.options.sandbox, { mode: 'read-only', writableRoots: [] });
      assert.equal(JSON.parse(ctx.input).work.baseRef, null);
      return [draft];
    },
    [
      { type: 'tool', name: 'create-card', saveAs: 'read', arguments: { key: 'read', content: '分析文件' }, check: ok },
      dispatch('read', 'execution', requiresGit), dispatch('read', 'verification', requiresGit),
      { type: 'tool', name: 'update-card', arguments: ctx => ({ cardId: saved(ctx, 'read').id, readOnly: true }), check: ok },
      dispatch('read', 'verification', requiresGit),
      { type: 'tool', name: 'update-card', arguments: ctx => ({ cardId: saved(ctx, 'read').id, readOnly: true }), check: ok },
      dispatch('read', 'execution'),
    ],
    ctx => {
      const brief = JSON.parse(ctx.input);
      const card = brief.cardGraph.find((item: any) => item.key === 'read');
      assert.equal(ctx.options.cwd, projectPath);
      return [
        { type: 'tool', name: 'complete-card', arguments: { cardId: card.id }, check: ok },
        { type: 'tool', name: 'request-review', arguments: { key: 'review', report: reviewReport('只读分析完成') }, check: ok },
      ];
    },
  ], undefined, { registerProject: false, executorScripts: [ctx => {
    assert.equal(ctx.options.cwd, projectPath);
    assert.deepEqual(ctx.options.sandbox, { mode: 'read-only', writableRoots: [] });
    executorStarted = true;
    return [{ type: 'hang', until: ready }, { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '已分析文件' }, check: ok }];
  }] });
  t.after(() => daemon.close());
  projectPath = join(daemon.directory, 'plain');
  await mkdir(projectPath);
  await writeFile(join(projectPath, 'notes.txt'), '原有文件\n');
  const project = (await daemon.call('register-project', { path: projectPath })).result;
  // Even a stale caller-supplied ref must not make a non-git project resolve git metadata.
  const response = await daemon.call('send-message', { projectId: project.id, baseRef: 'stale', key: 'start', body: '只读分析' });
  assert.equal(response.ok, true);
  const work = response.result.work;
  assert.equal(work.baseRef, null);
  assert.equal(work.baseCommit, null);
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const gate = (await daemon.call('list-pending')).result[0];
  assert.equal(gate.baseRef, null);
  assert.equal(gate.baseCommit, null);
  assert.equal(gate.uncommittedChanges, '');
  const confirmed = await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.result.status, 'executing');
  assert.equal(confirmed.result.baseRef, null);
  assert.equal(confirmed.result.baseCommit, null);
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds.filter((round: any) => round.status === 'ended').length === 2);
  await until(async () => executorStarted, Boolean);
  assert.equal(rejected, 3);
  release();
  await until(() => daemon.call('get-work', params), value => value.result.status === 'awaiting-review');
  const descriptions = (await daemon.call('get-work-descriptions', params)).result;
  assert.equal(descriptions[0].status, 'active');
  assert.equal(descriptions[0].baseRef, null);
  assert.equal(descriptions[0].baseCommit, null);
  const dispatches = (await daemon.call('list-dispatches', params)).result;
  assert.equal(dispatches.length, 1);
  assert.equal(dispatches[0].endReason, 'completed');
  assert.equal(dispatches[0].startCommit, null);
  assert.equal(dispatches[0].endCommit, null);
  const review = (await daemon.call('get-conversation', params)).result.find((item: any) => item.kind === 'review');
  assert.ok(review.review);
  assert.equal(review.review.noCodeChanges, true);
  assert.equal(review.review.diff, '');
  assert.equal(review.review.diffUnavailableReason, null);
  assert.equal(review.review.rejectedOperationCount, 3);
  assert.deepEqual((await daemon.call('list-work-files', params)).result, []);
  assert.equal(existsSync(join(projectPath, '.git')), false);
  assert.equal(existsSync(join(daemon.directory, 'data', 'worktrees', work.id)), false);
  assert.equal(await readFile(join(projectPath, 'notes.txt'), 'utf8'), '原有文件\n');
});

for (const initializeBeforeConfirm of [true, false]) for (const purpose of ['execution', 'verification'] as const) test(`非 git 目录自行初始化后实时识别，${initializeBeforeConfirm ? '确认草稿' : '派单'}时取当前分支，${purpose}`, async t => {
  const daemon = await uiFixture([[draft], [], [
    { type: 'tool', name: 'create-card', saveAs: 'write', arguments: { key: 'write', content: '现在可以派单' }, check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ key: 'write', cardId: saved(ctx, 'write').id, agentId: 'claude-executor', purpose }), check: ok },
  ]], undefined, { registerProject: false, executorScripts: [[{ type: 'hang' }]] });
  t.after(() => daemon.close());
  const directory = join(daemon.directory, 'plain');
  await mkdir(directory);
  await writeFile(join(directory, 'notes.txt'), '已有内容\n');
  const project = (await daemon.call('register-project', { path: directory })).result;
  const work = (await daemon.call('send-message', { projectId: project.id, key: 'start', body: '先只读' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const gate = (await daemon.call('list-pending')).result[0];
  assert.equal(gate.description.baseCommit, null);
  const initialize = () => {
    const git = (...args: string[]) => execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '-b', 'user-base');
    git('add', 'notes.txt');
    git('-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'existing files');
    return git('rev-parse', 'HEAD');
  };
  let head = initializeBeforeConfirm ? initialize() : '';
  ok(await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds.filter((round: any) => round.status === 'ended').length === 2);
  if (!initializeBeforeConfirm) head = initialize();
  const liveProject = (await daemon.call('list-projects')).result.find((item: any) => item.id === project.id);
  assert.equal(liveProject.isGit, true);
  assert.equal(liveProject.currentBranch, 'user-base');
  assert.equal(liveProject.headCommit, head);
  ok(await daemon.call('send-message', { ...params, key: 'after-init', body: '现在可以派单' }));
  await until(() => daemon.call('list-dispatches', params), value => value.result.length === 1);
  const prepared = (await daemon.call('get-work', params)).result;
  assert.equal(prepared.baseRef, 'user-base');
  if (purpose === 'execution') {
    assert.equal(prepared.baseCommit, head);
    assert.ok(prepared.workBranch);
    assert.ok(prepared.workPath);
    assert.equal(await readFile(join(prepared.workPath, 'notes.txt'), 'utf8'), '已有内容\n');
  } else {
    assert.equal(prepared.workBranch, null);
    assert.equal(prepared.workPath, null);
    assert.equal((await daemon.call('list-dispatches', params)).result[0].startCommit, head);
  }
  const newWork = await daemon.call('send-message', { projectId: project.id, key: 'after-init', body: '新工作' });
  ok(newWork);
  assert.equal(newWork.result.work.baseRef, 'user-base');
});
