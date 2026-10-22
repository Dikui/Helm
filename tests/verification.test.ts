import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
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
const hold = () => {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
};

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待验收流程超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

const card = (key = 'card', needsVerification = true): FakeStep => ({ type: 'tool', name: 'create-card',
  arguments: ctx => ({ workId: workIdOf(ctx), key, content: '按卡片标准验收', needsVerification }), saveAs: key, check: ok });
const dispatch = (key: string, purpose = 'verification', cardKey = 'card'): Extract<FakeStep, { type: 'tool' }> => ({ type: 'tool', name: 'create-dispatch',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, cardKey).id, key, purpose, content: '请检查成果', templateId: 'claude-executor' }), saveAs: `${key}-dispatch`, check: ok });
const complete = (check: (value: any) => void = ok, key = 'card'): FakeStep => ({ type: 'tool', name: 'complete-card',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id }), check });

async function fixture(t: TestContext, steps: FakeStep[], executors: FakeScript[], config: { beforeConfirm?: (call: (name: string, params?: object) => Promise<any>) => Promise<void> } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm verification-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'result.txt'), 'baseline\n');
  await writeFile(join(repo, '.gitignore'), 'node_modules/\n.cache/\n');
  git(repo, 'add', 'result.txt', '.gitignore');
  git(repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), executorDriver: new FakeDriver(executors),
    driver: new FakeDriver([[
      { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '验收派单', boundary: '本机', criteria: '验收改动全部丢弃' }), check: ok },
    ], [...steps, { type: 'end', reason: 'completed', finalAnswer: 'verification-script-finished' }]]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '验收成果' })).result.work;
  const events = async () => (await call('get-events', { workId: work.id })).result as any[];
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  await config.beforeConfirm?.(call);
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const finished = async () => {
    const values = await until(events, values => values.filter(event => event.action === 'round-ended').length >= 2);
    assert.equal(values.filter(event => event.action === 'round-ended')[1].details.finalAnswer, 'verification-script-finished', JSON.stringify(values));
  };
  const cards = async () => (await call('get-card-graph', { workId: work.id })).result.filter((node: any) => node.type === 'card') as any[];
  const dispatches = async () => (await call('list-dispatches', { workId: work.id })).result as any[];
  return { ...daemon, call, work, repo, events, finished, cards, dispatches, description: gate.description };
}

test('验收新开对话并保存派单时快照，结论按用途校验且最后一次生效', async t => {
  const executed = hold();
  const verified = hold();
  t.after(() => { executed.release(); verified.release(); });
  let executionPath = '';
  let executionSession = '';
  const daemon = await fixture(t, [card(), dispatch('execute', 'execution'), { type: 'hang', until: executed.promise },
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'unconfirmed-revision', requirements: '尚未确认的新要求', boundary: '本机', criteria: '尚未生效的新标准' }), check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'resume-verification', purpose: 'verification', templateId: 'claude-executor', resumeSessionId: executionSession }), check: code('INVALID_RESUME') },
    dispatch('verify'),
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '派单后修改的说明' }), check: ok },
    { type: 'hang', until: verified.promise }, complete(),
  ], [ctx => {
    executionPath = ctx.options.cwd;
    return [{ type: 'write', path: 'result.txt', content: 'implementation\n' }];
  }, ctx => {
    assert.equal(ctx.options.cwd, executionPath);
    assert.equal(ctx.options.resumeSessionId, undefined);
    const content = JSON.parse(ctx.input).content;
    assert.ok(content.includes('按卡片标准验收'));
    assert.ok(content.indexOf('按卡片标准验收') < content.indexOf('请检查成果'));
    assert.ok(!content.includes('派单后修改的说明'));
    return [
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '验收不能报完成' }, check: code('INVALID_PARAMS') },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: '第一次不通过' }, check: ok },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '复查通过' }, check: ok },
    ];
  }]);
  await until(daemon.dispatches, values => values.length === 1 && values[0].status === 'ended');
  const execution = (await daemon.dispatches())[0];
  executionSession = execution.sessionId;
  executed.release();
  await until(daemon.dispatches, values => values.length === 2 && values[1].status === 'ended');
  const verification = (await daemon.dispatches())[1];
  assert.equal(verification.endReason, 'completed', JSON.stringify(verification));
  assert.notEqual(verification.sessionId, execution.sessionId);
  assert.equal(verification.resumeSessionId, null);
  assert.equal(verification.purpose, 'verification');
  assert.equal(verification.cardContentSnapshot, '按卡片标准验收');
  assert.equal(verification.workDescriptionId, daemon.description.id);
  assert.equal(verification.workDescriptionVersion, 1);
  assert.equal(verification.startCommit, execution.endCommit);
  assert.equal(verification.endCommit, execution.endCommit);
  assert.equal(verification.conclusion, 'passed');
  assert.equal(verification.conclusionReason, '复查通过');
  assert.equal((await daemon.cards())[0].status, 'verifying');
  verified.release();
  await daemon.finished();
  assert.equal((await daemon.cards())[0].status, 'completed');
  assert.equal(git(daemon.repo, 'show', `helm/${daemon.work.id}:result.txt`), 'implementation');
});

test('验收结束丢弃文件改动和验收者自行提交，保留忽略的依赖缓存及检查证据', async t => {
  let workPath = '';
  let startCommit = '';
  let reviewerCommit = '';
  const daemon = await fixture(t, [card(), dispatch('verify')], [ctx => {
    workPath = ctx.options.cwd;
    startCommit = git(workPath, 'rev-parse', 'HEAD');
    execFileSync(process.execPath, ['-e', `require('fs').writeFileSync('result.txt', 'reviewer commit\\n')`], { cwd: workPath });
    git(workPath, 'add', 'result.txt');
    git(workPath, '-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.invalid', 'commit', '-m', 'must be discarded');
    reviewerCommit = git(workPath, 'rev-parse', 'HEAD');
    git(workPath, 'checkout', '--detach');
    return [
      { type: 'write', path: 'result.txt', content: 'uncommitted change\n' },
      { type: 'write', path: 'temporary.txt', content: 'untracked\n' },
      { type: 'write', path: 'node_modules/kept.txt', content: 'dependency\n' },
      { type: 'write', path: '.cache/kept.txt', content: 'cache\n' },
      { type: 'write', path: 'checks.txt', content: 'tests: passed\n' },
      { type: 'artifact', kind: 'test-output', path: 'checks.txt' },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '检查通过' }, check: ok },
    ];
  }]);
  await daemon.finished();
  await until(daemon.dispatches, values => values[0]?.status === 'ended');
  const result = (await daemon.dispatches())[0];
  assert.equal(result.endReason, 'completed', JSON.stringify(result));
  assert.notEqual(reviewerCommit, startCommit);
  assert.equal(result.startCommit, startCommit);
  assert.equal(result.endCommit, startCommit);
  assert.equal(git(workPath, 'rev-parse', 'HEAD'), startCommit);
  assert.equal(git(workPath, 'rev-parse', (await daemon.cards())[0].cardBranch), startCommit);
  assert.equal(git(workPath, 'status', '--porcelain'), '');
  assert.equal(await readFile(join(workPath, 'result.txt'), 'utf8'), 'baseline\n');
  await assert.rejects(readFile(join(workPath, 'temporary.txt')));
  await assert.rejects(readFile(join(workPath, 'checks.txt')));
  assert.equal(await readFile(join(workPath, 'node_modules/kept.txt'), 'utf8'), 'dependency\n');
  assert.equal(await readFile(join(workPath, '.cache/kept.txt'), 'utf8'), 'cache\n');
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: result.id })).result;
  const evidence = artifacts.find((item: any) => item.kind === 'test-output');
  assert.equal((await daemon.call('read-artifact', { workId: daemon.work.id, artifactId: evidence.id })).result.content, 'tests: passed\n');
  assert.equal(artifacts.find((item: any) => item.kind === 'branch').commitSha, startCommit);
  assert.ok(!artifacts.some((item: any) => item.kind === 'file'));
});

test('验收先结束副本子目录的残留进程，再重置文件和提交', async t => {
  const end = hold();
  let child: ChildProcess | undefined;
  let workPath = '';
  let reviewerCommit = '';
  t.after(() => { end.release(); child?.kill('SIGKILL'); });
  const daemon = await fixture(t, [card(), dispatch('verify')], [ctx => {
    workPath = ctx.options.cwd;
    mkdirSync(join(workPath, '.cache'));
    git(workPath, '-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.invalid', 'commit', '--allow-empty', '-m', 'temporary review commit');
    reviewerCommit = git(workPath, 'rev-parse', 'HEAD');
    child = spawn(process.execPath, ['-e', `
      const fs = require('fs');
      const cp = require('child_process');
      process.on('SIGTERM', () => {
        fs.writeFileSync('stopped.txt', cp.execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }));
        fs.writeFileSync('../result.txt', 'written during termination');
        process.exit(0);
      });
      fs.writeFileSync('ready', 'ready');
      setInterval(() => {}, 1000);
    `], { cwd: join(workPath, '.cache'), detached: true, stdio: 'ignore' });
    return [{ type: 'hang', until: end.promise }];
  }]);
  await daemon.finished();
  await until(async () => workPath && readFile(join(workPath, '.cache/ready'), 'utf8').catch(() => ''), Boolean);
  assert.equal((await daemon.cards())[0].status, 'verifying');
  end.release();
  await until(daemon.dispatches, values => values[0]?.status === 'ended');
  assert.equal((await daemon.dispatches())[0].endReason, 'completed', JSON.stringify(await daemon.dispatches()));
  assert.ok(child && (child.exitCode !== null || child.signalCode !== null), '残留进程必须先退出');
  assert.equal((await readFile(join(workPath, '.cache/stopped.txt'), 'utf8')).trim(), reviewerCommit);
  assert.equal(await readFile(join(workPath, 'result.txt'), 'utf8'), 'baseline\n');
  assert.equal(git(workPath, 'rev-parse', 'HEAD'), (await daemon.dispatches())[0].startCommit);
});

test('最近一次验收未声明、不通过或异常结束都不能沿用上次通过，取消需要验收后可完成并记事件', async t => {
  for (const outcome of ['undeclared', 'failed', 'error', 'quota-exhausted', 'timed-out', 'aborted'] as const) {
    await t.test(outcome, async t => {
      const first = hold();
      const last = hold();
      t.after(() => { first.release(); last.release(); });
      let verificationSession = '';
      const daemon = await fixture(t, [card(), dispatch('first'), { type: 'hang', until: first.promise },
        { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'resume-check-as-execution', templateId: 'claude-executor', resumeSessionId: verificationSession }), check: code('INVALID_RESUME') },
        dispatch('last'), { type: 'hang', until: last.promise }, complete(code('VERIFICATION_REQUIRED')),
        { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, needsVerification: false }), check: ok }, complete(),
      ], [[{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '第一次通过' }, check: ok }], [
        { type: 'write', path: 'result.txt', content: 'temporary verification edit\n' },
        ...(outcome === 'undeclared' ? [] : [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: outcome === 'failed' ? 'failed' : 'passed', reason: '本次自报结论' }, check: ok } as FakeStep]),
        { type: 'end', reason: outcome === 'failed' || outcome === 'undeclared' ? 'completed' : outcome, finalAnswer: '不能当作通过' },
      ]]);
      await until(daemon.dispatches, values => values[0]?.status === 'ended');
      verificationSession = (await daemon.dispatches())[0].sessionId;
      first.release();
      await until(daemon.dispatches, values => values.length === 2 && values[1].status === 'ended');
      const latest = (await daemon.dispatches())[1];
      assert.equal(latest.conclusion, outcome === 'failed' ? 'failed' : 'undeclared');
      const before = (await daemon.cards())[0];
      assert.equal(before.status, 'verifying');
      assert.equal(await readFile(join(before.workPath, 'result.txt'), 'utf8'), 'baseline\n');
      last.release();
      await daemon.finished();
      assert.equal((await daemon.cards())[0].status, 'completed');
      const update = (await daemon.events()).find(event => event.action === 'card-updated' && event.details.before.needsVerification && !event.details.after.needsVerification);
      assert.ok(update, '取消需要验收必须有事件');
      assert.ok((await daemon.events()).some(event => event.action === 'operation-rejected' && event.details.code === 'VERIFICATION_REQUIRED'));
    });
  }
});

test('整体验收用普通卡片依赖所有成果，只派验收单且完成不产生新合并提交', async t => {
  const upstreams = hold();
  const verified = hold();
  t.after(() => { upstreams.release(); verified.release(); });
  let checkedHead = '';
  let overallPath = '';
  const daemon = await fixture(t, [card('one', false), card('two', false), card('overall'),
    ...['one', 'two'].map(key => ({ type: 'tool', name: 'add-dependency', arguments: (ctx: FakeContext) => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, key).id }, downstream: { type: 'card', id: saved(ctx, 'overall').id } }), check: ok } as FakeStep)),
    { ...dispatch('too-early', 'verification', 'overall'), check: code('CARD_NOT_DISPATCHABLE') },
    dispatch('one', 'execution', 'one'), dispatch('two', 'execution', 'two'), { type: 'hang', until: upstreams.promise },
    complete(ok, 'one'), complete(ok, 'two'), dispatch('overall', 'verification', 'overall'),
    { type: 'hang', until: verified.promise }, complete(ok, 'overall'), complete(ok, 'overall'),
  ], [
    [{ type: 'write', path: 'one.txt', content: 'first result\n' }],
    [{ type: 'write', path: 'two.txt', content: 'second result\n' }],
    ctx => {
      overallPath = ctx.options.cwd;
      checkedHead = git(overallPath, 'rev-parse', 'HEAD');
      assert.equal(git(overallPath, 'show', 'HEAD:one.txt'), 'first result');
      assert.equal(git(overallPath, 'show', 'HEAD:two.txt'), 'second result');
      return [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '整体验收通过' }, check: ok }];
    },
  ]);
  await until(daemon.dispatches, values => values.length === 2 && values.every(value => value.status === 'ended'));
  assert.equal((await daemon.cards()).find(value => value.key === 'overall').status, 'waiting');
  upstreams.release();
  await until(daemon.dispatches, values => values.length === 3 && values[2].status === 'ended');
  assert.ok(checkedHead);
  const workBranch = `helm/${daemon.work.id}`;
  assert.equal(git(daemon.repo, 'rev-parse', workBranch), checkedHead);
  verified.release();
  await daemon.finished();
  assert.equal(git(daemon.repo, 'rev-parse', workBranch), checkedHead);
  const overall = (await daemon.cards()).find(value => value.key === 'overall');
  assert.equal(overall.status, 'completed');
  assert.equal(overall.dependencies.length, 2);
  assert.deepEqual((await daemon.dispatches()).filter(value => value.cardId === overall.id).map(value => value.purpose), ['verification']);
  await assert.rejects(readFile(join(overallPath, 'one.txt')));
  const result = (await daemon.dispatches()).find(value => value.cardId === overall.id);
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: result.id })).result;
  assert.equal(artifacts.find((value: any) => value.kind === 'branch').commitSha, checkedHead);
});

test('验收进程组中的进程拒绝 SIGTERM 时等待五秒再 SIGKILL，之后才重置', async t => {
  const end = hold();
  const revoke = hold();
  let group = 0;
  let workPath = '';
  t.after(() => {
    end.release();
    revoke.release();
    if (group) { try { process.kill(-group, 'SIGKILL'); } catch {} }
  });
  const daemon = await fixture(t, [card(), dispatch('verify'), { type: 'hang', until: revoke.promise },
    { type: 'tool', name: 'revoke-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), dispatchId: saved(ctx, 'verify-dispatch').id, reason: '清理期间撤销' }), check: ok },
  ], [ctx => {
    workPath = ctx.options.cwd;
    mkdirSync(join(workPath, '.cache'));
    const marker = join(workPath, '.cache', 'child-ready');
    const childCode = `
      process.on('SIGTERM', () => {});
      require('fs').writeFileSync(${JSON.stringify(marker)}, String(process.pid));
      setInterval(() => {}, 1000);
    `;
    const parent = spawn(process.execPath, ['-e', `
      require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { cwd: '..', stdio: 'ignore' });
      process.on('SIGTERM', () => process.exit(0));
      setInterval(() => {}, 1000);
    `], { cwd: workPath, detached: true, stdio: 'ignore' });
    group = parent.pid!;
    return [{ type: 'write', path: 'result.txt', content: 'must be reset\n' },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '验收者报通过' }, check: ok }, { type: 'hang', until: end.promise }];
  }]);
  const childPid = Number(await until(async () => workPath && readFile(join(workPath, '.cache/child-ready'), 'utf8').catch(() => ''), Boolean));
  const before = Date.now();
  end.release();
  await until(async () => { try { process.kill(group, 0); return false; } catch { return true; } }, Boolean);
  revoke.release();
  await daemon.finished();
  await until(daemon.dispatches, values => values[0]?.status === 'ended');
  const result = (await daemon.dispatches())[0];
  assert.equal(result.endReason, 'aborted', JSON.stringify(result));
  assert.equal(result.abortReason, '清理期间撤销');
  assert.equal(result.conclusion, 'undeclared');
  assert.ok(Date.now() - before >= 5_000, '拒绝 SIGTERM 的进程必须得到五秒退出时间');
  await until(async () => { try { process.kill(childPid, 0); return false; } catch { return true; } }, Boolean);
  assert.equal(await readFile(join(workPath, 'result.txt'), 'utf8'), 'baseline\n');
  assert.equal(git(workPath, 'rev-parse', 'HEAD'), result.startCommit);
});

test('验收和执行共享并发及端口段，暂停排队验收不启动执行者且恢复后仍在验收中', async t => {
  const first = hold();
  const queueReady = hold();
  t.after(() => { first.release(); queueReady.release(); });
  const ranges: { start: number; end: number }[] = [];
  const daemon = await fixture(t, [card(), card('other', false), dispatch('verify'), dispatch('execute', 'execution', 'other'),
    { type: 'hang', until: queueReady.promise }, dispatch('queued-verify'),
  ], [ctx => {
    ranges.push({ start: Number(ctx.options.env.HELM_PORT_START), end: Number(ctx.options.env.HELM_PORT_END) });
    return [{ type: 'write', path: 'result.txt', content: 'discard on pause' }, { type: 'hang', until: first.promise }];
  }, ctx => {
    ranges.push({ start: Number(ctx.options.env.HELM_PORT_START), end: Number(ctx.options.env.HELM_PORT_END) });
    return [{ type: 'hang' }];
  }], { beforeConfirm: async call => { ok(await call('set-concurrency', { limit: 1 })); } });
  await until(daemon.dispatches, values => values.length === 2 && values[0].sessionId);
  let records = await daemon.dispatches();
  assert.deepEqual(records.map(value => value.status), ['running', 'queued']);
  const cardId = records[0].cardId;
  const paused = await daemon.call('pause-card', { workId: daemon.work.id, cardId });
  ok(paused);
  assert.equal(paused.result.status, 'paused');
  assert.equal(await readFile(join(paused.result.workPath, 'result.txt'), 'utf8'), 'baseline\n');
  records = await until(daemon.dispatches, values => values[1].sessionId);
  assert.equal(records[0].abortReason, '卡片暂停');
  assert.equal(records[0].endCommit, records[0].startCommit);
  assert.deepEqual(ranges[1], ranges[0]);
  assert.deepEqual({ start: records[1].portStart, end: records[1].portEnd }, ranges[1]);
  assert.ok(ranges[0]!.start >= 1024 && ranges[0]!.end > ranges[0]!.start);
  assert.equal((await daemon.call('resume-card', { workId: daemon.work.id, cardId })).result.status, 'verifying');
  queueReady.release();
  await daemon.finished();
  await until(daemon.dispatches, values => values.length === 3);
  const queued = (await daemon.dispatches())[2];
  assert.equal(queued.status, 'queued');
  ok(await daemon.call('pause-card', { workId: daemon.work.id, cardId }));
  records = await daemon.dispatches();
  assert.equal(records[2].endReason, 'aborted');
  assert.equal(records[2].sessionId, null);
  assert.equal(ranges.length, 2, '已撤销的排队验收不能启动执行者');
  assert.equal((await daemon.cards()).find(value => value.id === cardId).status, 'paused');
});

test('验收看门狗限制无输出和总时长，超时先清进程再重置且清除提前通过', async t => {
  for (const threshold of ['idle', 'wall'] as const) await t.test(threshold, async t => {
    let workPath = '';
    let child: ChildProcess | undefined;
    t.after(() => child?.kill('SIGKILL'));
    const daemon = await fixture(t, [card(), dispatch('verify')], [ctx => {
      workPath = ctx.options.cwd;
      mkdirSync(join(workPath, '.cache'));
      child = spawn(process.execPath, ['-e', `
        const fs = require('fs');
        process.on('SIGTERM', () => { fs.writeFileSync('../result.txt', 'termination write'); process.exit(0); });
        fs.writeFileSync('ready', 'ready');
        setInterval(() => {}, 1000);
      `], { cwd: join(workPath, '.cache'), detached: true, stdio: 'ignore' });
      return [
        { type: 'hang', until: until(async () => readFile(join(workPath, '.cache/ready'), 'utf8').catch(() => ''), Boolean).then(() => {}) },
        { type: 'write', path: 'result.txt', content: 'discard on timeout' },
        { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '提前通过' }, check: ok },
        { type: 'hang' },
      ];
    }], { beforeConfirm: async call => { ok(await call('set-dispatch-watchdog', {
      wallTimeoutMs: threshold === 'wall' ? 1500 : 10000, idleTimeoutMs: threshold === 'idle' ? 1500 : 10000,
    })); } });
    const result = (await until(daemon.dispatches, values => values[0]?.status === 'ended'))[0];
    assert.equal(result.endReason, 'timed-out', result.failure);
    assert.equal(result.conclusion, 'undeclared');
    assert.equal(result.finalAnswer, null);
    assert.equal(result.endCommit, result.startCommit);
    assert.equal(await readFile(join(workPath, 'result.txt'), 'utf8'), 'baseline\n');
    assert.throws(() => process.kill(child!.pid!, 0), { code: 'ESRCH' });
    assert.equal((await daemon.events()).find(event => event.action === 'dispatch-timed-out').details.threshold, threshold);
  });
});

test('工作暂停及卡片或工作取消均中止验收，重置后再清理副本', async t => {
  for (const operation of ['pause-work', 'cancel-card', 'cancel-work'] as const) await t.test(operation, async t => {
    let workPath = '';
    const daemon = await fixture(t, [card(), dispatch('verify')], [ctx => {
      workPath = ctx.options.cwd;
      return [{ type: 'write', path: 'result.txt', content: 'temporary review' },
        { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'passed', reason: '提前通过' }, check: ok }, { type: 'hang' }];
    }]);
    const running = (await until(daemon.dispatches, values => values[0]?.conclusion === 'passed'))[0];
    const params = { workId: daemon.work.id, cardId: running.cardId, reason: '停止检查' };
    ok(await daemon.call(operation, operation === 'cancel-card' ? params : { workId: params.workId }));
    const result = (await daemon.dispatches())[0];
    assert.equal(result.endReason, 'aborted', result.failure);
    assert.equal(result.conclusion, 'undeclared');
    assert.equal(result.endCommit, result.startCommit);
    assert.equal(result.abortReason, operation === 'pause-work' ? '工作暂停' : operation === 'cancel-card' ? '卡片取消' : '工作取消');
    if (operation === 'pause-work') {
      assert.equal(await readFile(join(workPath, 'result.txt'), 'utf8'), 'baseline\n');
      assert.equal((await daemon.cards())[0].status, 'verifying');
    } else await assert.rejects(readFile(join(workPath, 'result.txt')), { code: 'ENOENT' });
  });
});

test('验收留下 index.lock 和未完成合并时复用 git 清理并恢复起点', async t => {
  let workPath = '';
  const daemon = await fixture(t, [card(), dispatch('verify')], [ctx => {
    workPath = ctx.options.cwd;
    const start = git(workPath, 'rev-parse', 'HEAD');
    const branch = git(workPath, 'branch', '--show-current');
    writeFileSync(join(workPath, 'result.txt'), 'local side\n');
    git(workPath, 'add', 'result.txt');
    git(workPath, '-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.invalid', 'commit', '-m', 'review side');
    const other = 'verification-other';
    git(workPath, 'checkout', '-b', other, start);
    writeFileSync(join(workPath, 'result.txt'), 'conflicting side\n');
    git(workPath, 'add', 'result.txt');
    git(workPath, '-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.invalid', 'commit', '-m', 'other side');
    git(workPath, 'checkout', branch);
    assert.throws(() => git(workPath, 'merge', other));
    writeFileSync(git(workPath, 'rev-parse', '--git-path', 'index.lock'), 'stale lock');
    return [];
  }]);
  const result = (await until(daemon.dispatches, values => values[0]?.status === 'ended'))[0];
  assert.equal(result.endReason, 'completed', result.failure);
  assert.equal(result.endCommit, result.startCommit);
  assert.equal(git(workPath, 'status', '--porcelain'), '');
  const events = await daemon.events();
  assert.ok(events.some(event => event.action === 'dispatch-index-lock-removed'));
  assert.ok(events.some(event => event.action === 'dispatch-git-aborted' && event.details.operation === 'merge'));
});
