import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { ensureWorkCopy } from '../src/alignment.js';
import { completeCard } from '../src/completion.js';
import { createDispatch, getDispatch, verificationCommit } from '../src/dispatch.js';
import { ExecutionRunner, finishDispatchCopy } from '../src/execution.js';
import { cardDetails, cardGraph, createCard, updateCard } from '../src/graph.js';
import { reconcileStartup } from '../src/reconcile.js';
import { processStartTime } from '../src/processes.js';
import { RuleError, TaskStore } from '../src/store.js';
import type { Driver, SessionOptions } from '../src/driver.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { testProcessWatchdog } from './fixtures/test-process.js';
import { uiFixture, until } from './ui-fixture.js';

const actor = { type: 'runtime', id: 'test' } as const;
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const code = (expected: string) => (error: unknown) => error instanceof RuleError && error.code === expected;

async function fixture(t: TestContext, copy: boolean, repository = true, execute = (_options: SessionOptions) => {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-read-only-')));
  const project = join(directory, 'project');
  await mkdir(project);
  writeFileSync(join(project, 'README.md'), 'baseline\n');
  if (repository) {
    git(project, 'init', '-b', 'main');
    git(project, 'add', 'README.md');
    git(project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'baseline');
  }
  const agents = new AgentCatalog(fixtureAgentDir, ['claude-sdk', 'codex', 'grok', 'deepseek']);
  const store = new TaskStore(join(directory, 'data'), agents);
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at, base_ref) VALUES ('work', 'project', 'executing', 'work', '2026-10-30', 'main')");
  if (copy) ensureWorkCopy(store, 'work');
  let options: SessionOptions | undefined;
  const driver: Driver = {
    async checkAvailability() { return { available: true }; },
    async start(value) {
      options = value;
      return { id: 'test-session', async send() { execute(value); }, cancel() {}, events: (async function* () {
        yield { type: 'end' as const, step: 1, reason: 'completed' as const, finalAnswer: '调研完成', usage: { inputTokens: 1, outputTokens: 1 } };
      })() };
    },
  };
  const runner = new ExecutionRunner(store, { 'claude-sdk': driver, codex: driver, grok: driver, deepseek: driver }, 'http://unused.invalid/mcp');
  t.after(async () => { await runner.close(); store.close(); await rm(directory, { recursive: true, force: true }); });
  const run = async (cardId: string, purpose: 'execution' | 'verification' = 'execution', agentId = 'claude-executor') => {
    const dispatch = await createDispatch(store, actor, { workId: 'work', cardId, key: `dispatch-${store.events({}).length}`, agentId, purpose });
    await runner.settle('work', cardId);
    const ended = getDispatch(store, 'work', dispatch.id);
    assert.equal(ended.endReason, 'completed', ended.failure ?? '');
    return ended;
  };
  return { store, runner, project, run, options: () => options! };
}

test('只读派单记录新增和修改的路径及违规事件，仍可完成卡片并保留改动', async t => {
  const ctx = await fixture(t, true, true, options => {
    writeFileSync(join(options.cwd, 'README.md'), 'changed\n');
    writeFileSync(join(options.cwd, 'new file.txt'), 'new\n');
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.ok('readOnlyCheck' in dispatch);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: ['README.md', 'new file.txt'], projectDirectory: false });
  const violations = ctx.store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated');
  assert.equal(violations.length, 1);
  assert.equal(violations[0]!.dispatchId, dispatch.id);
  assert.deepEqual(violations[0]!.details, dispatch.readOnlyCheck);
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  assert.equal(await readFile(join(ctx.options().cwd, 'new file.txt'), 'utf8'), 'new\n');
});

for (const agentId of ['claude-executor', 'codex-executor', 'grok-executor', 'deepseek-executor']) test(`${agentId} 的只读派单提交后即使目录干净也记录违规路径`, async t => {
  const ctx = await fixture(t, true, true, options => {
    writeFileSync(join(options.cwd, 'README.md'), 'committed change\n');
    writeFileSync(join(options.cwd, 'committed.txt'), 'new\n');
    git(options.cwd, 'add', 'README.md', 'committed.txt');
    git(options.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'unexpected commit');
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id, 'execution', agentId);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: ['README.md', 'committed.txt'], projectDirectory: false });
  assert.equal(git(ctx.options().cwd, 'status', '--porcelain'), '');
  assert.equal(ctx.store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated').length, 1);
});

test('只读派单再次修改已有脏文件或未跟踪文件时记录违规，排除未变化的脏路径', async t => {
  const ctx = await fixture(t, false, true, options => {
    writeFileSync(join(options.cwd, 'README.md'), 'second change\n');
    writeFileSync(join(options.cwd, 'untracked.txt'), 'second change\n');
  });
  writeFileSync(join(ctx.project, 'README.md'), 'first change\n');
  writeFileSync(join(ctx.project, 'untracked.txt'), 'first change\n');
  writeFileSync(join(ctx.project, 'untouched.txt'), 'unchanged\n');
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: ['README.md', 'untracked.txt'], projectDirectory: true,
    note: '在项目目录运行，可能包含用户自己的改动' });
});

test('启动检查期间其他卡片建出工作副本，仍按本次实际运行的项目目录给出说明', async t => {
  const ctx = await fixture(t, false, true, options => { writeFileSync(join(options.cwd, 'unexpected.txt'), 'changed\n'); });
  let checks = 0;
  ctx.store.agents.monitor(async () => {
    if (++checks === 2) ensureWorkCopy(ctx.store, 'work');
    return { available: true };
  }, () => {});
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.equal(ctx.options().cwd, ctx.project);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: ['unexpected.txt'], projectDirectory: true,
    note: '在项目目录运行，可能包含用户自己的改动' });
});

test('只读派单仅改变 HEAD 的空提交也记录违规', async t => {
  const ctx = await fixture(t, true, true, options => {
    git(options.cwd, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'unexpected empty commit');
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: [], projectDirectory: false });
});

test('只读派单记录删除和暂存重命名的两端，路径保留空格和换行', async t => {
  const ctx = await fixture(t, true, true, options => {
    renameSync(join(options.cwd, 'old name.txt'), join(options.cwd, 'new\nname.txt'));
    rmSync(join(options.cwd, 'README.md'));
    git(options.cwd, 'add', '--', 'old name.txt', 'new\nname.txt');
  });
  const path = ctx.store.work('work').workPath!;
  writeFileSync(join(path, 'old name.txt'), 'baseline\n');
  git(path, 'add', 'old name.txt');
  git(path, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'rename baseline');
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'violated', paths: ['README.md', 'new\nname.txt', 'old name.txt'], projectDirectory: false });
});

for (const structured of [false, true]) test(`只读派单修改后${structured ? '结构化错误' : '异常退出'}仍记录违规，检查结果重读时保留`, async t => {
  const ctx = await fixture(t, true, true, options => {
    writeFileSync(join(options.cwd, 'unexpected.txt'), 'changed\n');
    throw structured ? new RuleError('EXECUTOR_FAILED', 'executor failed') : new Error('executor failed');
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await createDispatch(ctx.store, actor, { workId: 'work', cardId: card.id, key: 'execute', agentId: 'claude-executor' });
  await ctx.runner.settle('work', card.id);
  const ended = getDispatch(ctx.store, 'work', dispatch.id);
  assert.equal(ended.endReason, 'error');
  assert.deepEqual(ended.readOnlyCheck, { status: 'violated', paths: ['unexpected.txt'], projectDirectory: false });
  finishDispatchCopy(ctx.store, ended, 'error');
  assert.deepEqual(getDispatch(ctx.store, 'work', dispatch.id).readOnlyCheck, ended.readOnlyCheck);
  assert.equal(ctx.store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated').length, 1);
});

test('调度者读取派单列表和详情都收到只读违规结果', async t => {
  const checks: unknown[] = [];
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: 'Research', boundary: 'Read only', criteria: 'Report' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'research', content: 'Research', readOnly: true }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'execute', agentId: 'claude-executor' }) },
  ], [
    { type: 'tool', name: 'list-dispatches', arguments: {}, saveAs: 'dispatches', check: (value: any) => checks.push(value.result[0].readOnlyCheck) },
    { type: 'tool', name: 'get-dispatch', arguments: ctx => ({ dispatchId: (ctx.results.get('dispatches') as any).result[0].id }), check: (value: any) => checks.push(value.result.readOnlyCheck) },
  ]], undefined, { executorScripts: [ctx => { writeFileSync(join(ctx.options.cwd, 'unexpected.txt'), 'changed\n'); return []; }] });
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: 'Research' })).result.work;
  const description = (await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result[0];
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  assert.equal((await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  await until(async () => checks, value => value.length === 2);
  const expected = { status: 'violated', paths: ['unexpected.txt'], projectDirectory: true, note: '在项目目录运行，可能包含用户自己的改动' };
  assert.deepEqual(checks, [expected, expected]);
});

for (const copy of [true, false]) test(`只读卡片${copy ? '有工作副本' : '无工作副本'}时不建卡片副本，只读派单结束和完成不改 git`, async t => {
  const ctx = await fixture(t, copy);
  const { store, project } = ctx;
  const path = store.work('work').workPath ?? project;
  const head = git(path, 'rev-parse', 'HEAD');
  const branches = git(project, 'branch', '--list');
  const copies = git(project, 'worktree', 'list', '--porcelain');
  // Shared directories can contain other people's changes; never reset or commit them.
  writeFileSync(join(path, 'uncommitted.txt'), '保留未提交的改动\n');
  const card = createCard(store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.equal(ctx.options().cwd, path);
  assert.deepEqual(ctx.options().sandbox, { mode: 'read-only', writableRoots: [] });
  assert.equal(dispatch.startCommit, null);
  assert.equal(dispatch.endCommit, null);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'unchanged', paths: [], projectDirectory: !copy,
    ...(!copy ? { note: '在项目目录运行，可能包含用户自己的改动' } : {}) });
  assert.equal(store.events({ workId: 'work' }).filter(event => event.action === 'dispatch-read-only-violated').length, 0);
  assert.equal(finishDispatchCopy(store, dispatch, 'aborted', '运行层重启'), null);
  assert.equal(completeCard(store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  const persisted = cardDetails(store, 'work', card.id);
  assert.equal(persisted.workPath, null);
  assert.equal(persisted.cardBranch, null);
  assert.equal(existsSync(join(store.dataDir, 'worktrees', 'work', card.id)), false);
  assert.equal(git(path, 'rev-parse', 'HEAD'), head);
  assert.equal(git(project, 'branch', '--list'), branches);
  assert.equal(git(project, 'worktree', 'list', '--porcelain'), copies);
  assert.equal(await readFile(join(path, 'uncommitted.txt'), 'utf8'), '保留未提交的改动\n');
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM artifacts').get()!.count, 0);
});

test('非 git 项目的只读卡片可以执行和完成', async t => {
  const ctx = await fixture(t, false, false);
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '分析目录', readOnly: true });
  const dispatch = await ctx.run(card.id);
  assert.deepEqual(dispatch.readOnlyCheck, { status: 'unchecked', paths: [], projectDirectory: true, reason: 'not-git', note: '非 git 目录，未检查' });
  assert.equal(ctx.options().cwd, ctx.project);
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  await reconcileStartup(ctx.store);
  assert.equal(existsSync(join(ctx.project, '.git')), false);
});

test('只读标记默认关闭，可修改并出现在卡片图；有卡片副本后拒绝改成只读，写代码派单保持可写', async t => {
  const ctx = await fixture(t, true);
  const { store } = ctx;
  const card = createCard(store, actor, { workId: 'work', key: 'code', content: '实现' });
  assert.equal(card.readOnly, false);
  assert.equal(updateCard(store, actor, { workId: 'work', cardId: card.id, readOnly: true }).readOnly, true);
  const node = cardGraph(store, 'work').find(node => node.id === card.id);
  assert.ok(node?.type === 'card' && node.readOnly);
  updateCard(store, actor, { workId: 'work', cardId: card.id, readOnly: false });
  const dispatch = await ctx.run(card.id);
  assert.equal(dispatch.readOnlyCheck, null);
  const written = cardDetails(store, 'work', card.id);
  assert.ok(written.cardBranch);
  assert.ok(written.workPath);
  assert.deepEqual(ctx.options().sandbox, { mode: 'workspace-write', writableRoots: [written.workPath] });
  assert.throws(() => updateCard(store, actor, { workId: 'work', cardId: card.id, readOnly: true }), code('CARD_COPY_EXISTS'));
  assert.equal(completeCard(store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
});

test('有活动派单时不能切换只读标记', async t => {
  const { store } = await fixture(t, true);
  const card = createCard(store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true });
  await createDispatch(store, actor, { workId: 'work', cardId: card.id, key: 'queued', agentId: 'claude-executor' });
  assert.throws(() => updateCard(store, actor, { workId: 'work', cardId: card.id, readOnly: false }), code('DISPATCH_ACTIVE'));
});

test('只读卡片执行后仍可验收工作分支末端，验收过期时拒绝完成，通过后完成不合并', async t => {
  const ctx = await fixture(t, true);
  const { store } = ctx;
  const path = store.work('work').workPath!;
  const head = git(path, 'rev-parse', 'HEAD');
  const card = createCard(store, actor, { workId: 'work', key: 'research', content: '分析', readOnly: true, needsVerification: true });
  await ctx.run(card.id);
  assert.throws(() => completeCard(store, actor, { workId: 'work', cardId: card.id }), code('VERIFICATION_REQUIRED'));
  assert.equal(verificationCommit(store, card), head);
  const verification = await ctx.run(card.id, 'verification');
  assert.equal(verification.readOnlyCheck, null);
  assert.equal(verification.startCommit, head);
  assert.notEqual(ctx.options().cwd, path);
  assert.equal(ctx.options().sandbox.mode, 'workspace-write');
  assert.equal(existsSync(ctx.options().cwd), false);
  store.db.prepare("UPDATE dispatches SET conclusion = 'passed' WHERE id = ?").run(verification.id);
  git(path, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '--allow-empty', '-m', 'new work commit');
  assert.throws(() => completeCard(store, actor, { workId: 'work', cardId: card.id }), code('VERIFICATION_OUTDATED'));
  const current = git(path, 'rev-parse', 'HEAD');
  const next = await ctx.run(card.id, 'verification');
  store.db.prepare("UPDATE dispatches SET conclusion = 'passed' WHERE id = ?").run(next.id);
  assert.equal(completeCard(store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  assert.equal(git(path, 'rev-parse', 'HEAD'), current);
});


test('只读派单收尾保留共享目录中不属于本次派单的进程', async t => {
  const ctx = await fixture(t, false);
  const other = spawn(process.execPath, ['-e', testProcessWatchdog()], { cwd: ctx.project, detached: true, stdio: 'ignore' });
  await once(other, 'spawn');
  t.after(async () => {
    if (other.exitCode === null && other.signalCode === null) {
      const exited = once(other, 'exit');
      other.kill('SIGKILL');
      await exited;
    }
  });
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '调研', readOnly: true });
  await ctx.run(card.id);
  assert.doesNotThrow(() => process.kill(other.pid!, 0));
});


test('重启对账只清理记录的只读执行者进程组，保留项目目录的其他进程', async t => {
  const ctx = await fixture(t, false);
  const card = createCard(ctx.store, actor, { workId: 'work', key: 'research', content: '调研', readOnly: true });
  const dispatch = await ctx.run(card.id);
  const children = [0, 1].map(() => spawn(process.execPath, ['-e', testProcessWatchdog()], { cwd: ctx.project, detached: true, stdio: 'ignore' }));
  await Promise.all(children.map(child => once(child, 'spawn')));
  t.after(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  // ps is denied by the development sandbox; only substitute its timestamp query.
  const processTools = join(ctx.store.dataDir, 'process-tools');
  await mkdir(processTools);
  writeFileSync(join(processTools, 'ps'), `#!${process.execPath}\nconsole.log('test-start-' + process.argv[3]);\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${processTools}:${previousPath ?? ''}`;
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const managed = children[0]!;
  const timestamp = processStartTime(managed.pid!);
  assert.ok(timestamp);
  ctx.store.db.prepare("UPDATE dispatches SET status = 'running', pgid = ?, process_started_at = ? WHERE id = ?").run(managed.pid!, timestamp, dispatch.id);
  await reconcileStartup(ctx.store);
  assert.equal(getDispatch(ctx.store, 'work', dispatch.id).endReason, 'aborted');
  if (managed.exitCode === null && managed.signalCode === null) await once(managed, 'exit');
  assert.throws(() => process.kill(managed.pid!, 0));
  assert.doesNotThrow(() => process.kill(children[1]!.pid!, 0));
  // Completed read-only cards never had a copy; startup must not synthesize one.
  ctx.store.db.prepare("UPDATE cards SET status = 'completed' WHERE id = ?").run(card.id);
  await reconcileStartup(ctx.store);
  assert.equal(cardDetails(ctx.store, 'work', card.id).workPath, null);
});
