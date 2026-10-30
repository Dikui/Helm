import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { createDispatch, listDispatches } from '../src/dispatch.js';
import { decideGitInitialization } from '../src/git-initialization.js';
import { cancelCard, cardDetails, cardGraph, createCard, refreshCardReadiness, removeDependency, updateCard, updateGate, withdrawGate } from '../src/graph.js';
import { startupBrief } from '../src/rounds.js';
import { deleteWork } from '../src/outputs.js';
import { RuleError, TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';

const actor = { type: 'runtime', id: 'test' } as const;
const user = { type: 'user', id: 'user' } as const;
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const code = (expected: string) => (error: unknown) => error instanceof RuleError && error.code === expected;

function fixture(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-git-initialization-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'README.md'), 'existing project\n');
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  const work = (id: string) => store.db.prepare("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES (?, 'project', 'executing', ?, '2026-10-30')").run(id, id);
  work('work');
  t.after(() => { store.close(); rmSync(directory, { recursive: true, force: true }); });
  const card = (workId = 'work', readOnly = false) => createCard(store, actor, { workId, key: `card-${store.events({}).length}`, content: '实现功能', readOnly });
  const dispatch = (cardId: string, workId = 'work', purpose: 'execution' | 'verification' = 'execution') => createDispatch(store, actor,
    { workId, cardId, key: `dispatch-${cardId}-${purpose}`, agentId: 'claude-executor', purpose });
  const gate = () => store.gates('work').find(item => item.kind === 'git-initialization')!;
  const decide = (decision = 'initialize', ignoreRules?: string, comment?: string) => decideGitInitialization(store, user, { workId: 'work', gateId: gate().id, decision, ignoreRules, comment });
  return { store, project, directory, work, card, dispatch, gate, decide };
}

test('运行层生成唯一的项目初始化关卡，写代码执行和只读验收均等待它，项目目录保持不变', async t => {
  const ctx = fixture(t);
  const { store, project } = ctx;
  mkdirSync(join(project, 'node_modules'));
  writeFileSync(join(project, 'node_modules', 'package.json'), '{}');
  writeFileSync(join(project, '.env.local'), 'secret-value');
  writeFileSync(join(project, 'server.pem'), 'private-key');
  writeFileSync(join(project, 'large.bin'), '');
  truncateSync(join(project, 'large.bin'), 33 * 1024 * 1024);
  ctx.work('other');
  const first = ctx.card(), second = ctx.card('work', true), third = ctx.card('other');
  await Promise.all([
    assert.rejects(ctx.dispatch(first.id), code('GIT_INITIALIZATION_PENDING')),
    assert.rejects(ctx.dispatch(second.id, 'work', 'verification'), code('GIT_INITIALIZATION_PENDING')),
    assert.rejects(ctx.dispatch(third.id, 'other'), code('GIT_INITIALIZATION_PENDING')),
  ]);
  const gate = ctx.gate();
  assert.equal(store.pending().filter(item => item.kind === 'git-initialization').length, 1);
  assert.deepEqual(gate.creator, { type: 'runtime', id: 'helmd' });
  assert.deepEqual(gate.gitInitialization?.suspiciousPaths.map(item => item.path), ['.env.local', 'large.bin', 'node_modules/', 'server.pem']);
  assert.equal(gate.gitInitialization?.fileCount, 2);
  assert.equal(gate.gitInitialization?.totalBytes, Buffer.byteLength('existing project\n') + Buffer.byteLength(gate.gitInitialization!.ignoreRules));
  for (const card of [first, second, third]) {
    const graph = cardGraph(store, card.workId);
    const node = graph.find(item => item.id === card.id)!;
    assert.equal(node.status, 'waiting');
    assert.deepEqual(node.dependencies, [{ type: 'gate', id: gate.id }]);
    assert.ok(graph.some(item => item.id === gate.id));
    assert.ok(store.conversation(card.workId).some(item => item.id === gate.id));
  }
  assert.equal(startupBrief(store, 'other', []).pendingGates[0]!.id, gate.id);
  assert.equal(listDispatches(store, 'work').length, 0);
  assert.equal(existsSync(join(project, '.git')), false);
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.throws(() => withdrawGate(store, actor, { workId: 'work', gateId: gate.id, reason: '不需要' }), code('FIXED_GATE'));
  assert.throws(() => updateGate(store, actor, { workId: 'work', gateId: gate.id, body: '替换' }), code('FIXED_GATE'));
  assert.throws(() => removeDependency(store, actor, { workId: 'work', upstream: { type: 'gate', id: gate.id }, downstream: { type: 'card', id: first.id } }), code('FIXED_DEPENDENCY'));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('unrelated', '另一项目', ?, '2026-10-30')").run(join(ctx.directory, 'unrelated'));
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('unrelated', 'unrelated', 'executing', 'unrelated', '2026-10-30')");
  assert.throws(() => store.gate('unrelated', gate.id), code('INVALID_GATE'));
});

for (const existingIgnore of [true, false]) test(`同意初始化按${existingIgnore ? '已有且不改写的' : '用户编辑的'}忽略规则提交现有文件，并以实际分支开副本`, async t => {
  const ctx = fixture(t);
  const { project, store } = ctx;
  const rules = '.env*\nnode_modules/\nprivate.txt\n';
  writeFileSync(join(project, '.env'), 'do-not-commit');
  writeFileSync(join(project, 'private.txt'), 'private');
  mkdirSync(join(project, 'node_modules'));
  writeFileSync(join(project, 'node_modules', 'dep.js'), 'dependency');
  if (existingIgnore) writeFileSync(join(project, '.gitignore'), rules);
  const card = ctx.card();
  await assert.rejects(ctx.dispatch(card.id), code('GIT_INITIALIZATION_PENDING'));
  assert.equal(ctx.gate().gitInitialization?.hasGitignore, existingIgnore);
  if (existingIgnore) assert.equal(ctx.gate().gitInitialization?.fileCount, 2);
  const gate = ctx.decide('initialize', existingIgnore ? 'malicious replacement\n' : rules);
  assert.equal(readFileSync(join(project, '.gitignore'), 'utf8'), rules);
  assert.equal(gate.gitInitialization?.ignoreRules, rules);
  assert.deepEqual(git(project, 'ls-tree', '--name-only', 'HEAD').split('\n'), ['.gitignore', 'README.md']);
  assert.equal(git(project, 'show', 'HEAD:README.md'), 'existing project');
  assert.equal(git(project, 'log', '-1', '--format=%an <%ae>'), 'Helm <helm@localhost>');
  assert.equal(git(project, 'rev-list', '--count', 'HEAD'), '1');
  assert.equal(store.work('work').baseRef, git(project, 'branch', '--show-current'));
  assert.equal(cardDetails(store, 'work', card.id).status, 'ready');
  assert.ok(store.db.prepare('SELECT 1 FROM wake_queue WHERE work_id = ?').get('work'));
  ctx.decide();
  assert.equal(git(project, 'rev-list', '--count', 'HEAD'), '1');
  const dispatch = await ctx.dispatch(card.id);
  assert.equal(dispatch.status, 'queued');
  const work = store.work('work');
  assert.equal(work.baseCommit, git(project, 'rev-parse', 'HEAD'));
  assert.ok(work.workBranch && work.workPath);
  assert.equal(readFileSync(join(work.workPath, 'README.md'), 'utf8'), 'existing project\n');
  const copy = cardDetails(store, 'work', card.id);
  assert.ok(copy.cardBranch && copy.workPath);
  assert.equal(readFileSync(join(copy.workPath, 'README.md'), 'utf8'), 'existing project\n');
  assert.equal(existsSync(join(copy.workPath, '.env')), false);
});

test('拒绝保留阻塞及原因，复用拒绝决定；显式改为只读可执行，或取消卡片', async t => {
  const ctx = fixture(t);
  const { store } = ctx;
  ctx.work('other');
  const first = ctx.card(), second = ctx.card('other');
  await assert.rejects(ctx.dispatch(first.id), code('GIT_INITIALIZATION_PENDING'));
  await assert.rejects(ctx.dispatch(second.id, 'other'), code('GIT_INITIALIZATION_PENDING'));
  assert.throws(() => ctx.decide('refuse'), code('INVALID_PARAMS'));
  const gate = ctx.decide('refuse', undefined, '目录里还有私有文件');
  assert.equal(gate.status, 'decided');
  updateCard(store, actor, { workId: 'work', cardId: first.id, aggregate: true });
  for (const card of [first, second]) {
    refreshCardReadiness(store, card.workId);
    assert.equal(cardDetails(store, card.workId, card.id).status, 'waiting');
    const brief = startupBrief(store, card.workId, []);
    assert.ok(brief.newEvents.some(event => event.action === 'gate-decided' && (event.details as any).comment === '目录里还有私有文件'));
  }
  const third = ctx.card();
  await assert.rejects(ctx.dispatch(third.id), code('GIT_INITIALIZATION_REFUSED'));
  assert.equal(store.gates('work').length, 1);
  assert.equal(store.pending().length, 0);
  updateCard(store, actor, { workId: 'work', cardId: first.id, readOnly: true });
  assert.equal(cardDetails(store, 'work', first.id).status, 'ready');
  assert.equal((await ctx.dispatch(first.id)).purpose, 'execution');
  assert.equal(cancelCard(store, actor, { workId: 'other', cardId: second.id, reason: '用户拒绝初始化' }).status, 'cancelled');
  assert.equal(existsSync(join(ctx.project, '.git')), false);
});

for (const existingIgnore of [true, false]) test(`初始化失败不留下半仓库，${existingIgnore ? '保留原 .gitignore' : '清理新 .gitignore'}，可在同一关卡重试`, async t => {
  const ctx = fixture(t);
  if (existingIgnore) writeFileSync(join(ctx.project, '.gitignore'), '*\n');
  await assert.rejects(ctx.dispatch(ctx.card().id), code('GIT_INITIALIZATION_PENDING'));
  const id = ctx.gate().id;
  assert.throws(() => ctx.decide('initialize', '*\n'), code('GIT_INITIALIZATION_FAILED'));
  assert.equal(existsSync(join(ctx.project, '.git')), false);
  assert.equal(existsSync(join(ctx.project, '.gitignore')), existingIgnore);
  if (existingIgnore) assert.equal(readFileSync(join(ctx.project, '.gitignore'), 'utf8'), '*\n');
  assert.equal(ctx.gate().status, 'pending');
  assert.equal(readdirSync(ctx.store.dataDir).some(name => name.startsWith('git-initialization-')), false);
  assert.equal(readdirSync(ctx.project).some(name => name.startsWith('.helm-git-init-')), false);
  if (existingIgnore) writeFileSync(join(ctx.project, '.gitignore'), '');
  assert.equal(ctx.decide('initialize', '').id, id);
  assert.equal(git(ctx.project, 'rev-list', '--count', 'HEAD'), '1');
});

for (const atDecision of [true, false]) test(`用户自行初始化在${atDecision ? '决定时' : '重新派单时'}识别，不覆盖仓库或添加提交`, async t => {
  const ctx = fixture(t);
  const card = ctx.card();
  await assert.rejects(ctx.dispatch(card.id), code('GIT_INITIALIZATION_PENDING'));
  git(ctx.project, 'init', '-b', 'user-base');
  git(ctx.project, 'add', 'README.md');
  git(ctx.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'user baseline');
  const commit = git(ctx.project, 'rev-parse', 'HEAD');
  if (atDecision) ctx.decide('initialize', '*\n');
  else await ctx.dispatch(card.id);
  assert.equal(ctx.gate().gitInitialization?.existingRepository, true);
  assert.equal(ctx.gate().gitInitialization?.commit, commit);
  assert.equal(ctx.store.work('work').baseRef, 'user-base');
  assert.equal(existsSync(join(ctx.project, '.gitignore')), false);
  assert.equal(git(ctx.project, 'rev-parse', 'HEAD'), commit);
  assert.equal(git(ctx.project, 'rev-list', '--count', 'HEAD'), '1');
});

test('共享关卡从另一项工作决定，所有依赖卡片解除阻塞，验收单检查初始化提交且不建工作副本', async t => {
  const ctx = fixture(t);
  ctx.work('other');
  const first = ctx.card(), second = ctx.card('other', true);
  await assert.rejects(ctx.dispatch(first.id), code('GIT_INITIALIZATION_PENDING'));
  await assert.rejects(ctx.dispatch(second.id, 'other', 'verification'), code('GIT_INITIALIZATION_PENDING'));
  ctx.store.db.exec("UPDATE works SET status = 'cancelled' WHERE id = 'work'");
  assert.equal(ctx.store.pending()[0]!.id, ctx.gate().id);
  await assert.rejects(deleteWork(ctx.store, user, 'work', true), code('SHARED_GATE_IN_USE'));
  const gate = decideGitInitialization(ctx.store, user, { workId: 'other', gateId: ctx.gate().id, decision: 'initialize' });
  assert.equal(cardDetails(ctx.store, 'work', first.id).status, 'ready');
  assert.equal(cardDetails(ctx.store, 'other', second.id).status, 'ready');
  const dispatch = await ctx.dispatch(second.id, 'other', 'verification');
  assert.equal(dispatch.startCommit, gate.gitInitialization?.commit);
  assert.equal(ctx.store.work('other').baseRef, gate.gitInitialization?.branch);
  assert.equal(ctx.store.work('other').workBranch, null);
});

test('用户只执行 git init 尚无初始提交时明确提示，仍能拒绝并改派只读', async t => {
  const ctx = fixture(t);
  const card = ctx.card();
  await assert.rejects(ctx.dispatch(card.id), code('GIT_INITIALIZATION_PENDING'));
  git(ctx.project, 'init', '-b', 'unborn');
  assert.throws(() => ctx.decide(), code('GIT_INITIAL_COMMIT_REQUIRED'));
  assert.equal(ctx.gate().status, 'pending');
  ctx.decide('refuse', undefined, '稍后再建立基准');
  updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, readOnly: true });
  assert.equal((await ctx.dispatch(card.id)).purpose, 'execution');
});

for (const state of ['unborn', 'detached'] as const) for (const existingGate of [false, true]) for (const purpose of ['execution', 'verification'] as const) {
  test(`${state} 项目的 ${purpose} 派单${existingGate ? '复用' : '创建'}初始化关卡，不绕过用户决定`, async t => {
    const ctx = fixture(t);
    const first = ctx.card('work', purpose === 'verification');
    if (existingGate) await assert.rejects(ctx.dispatch(first.id, 'work', purpose), code('GIT_INITIALIZATION_PENDING'));
    const gateId = existingGate ? ctx.gate().id : undefined;
    git(ctx.project, 'init', '-b', 'user-base');
    if (state === 'detached') {
      git(ctx.project, 'add', 'README.md');
      git(ctx.project, '-c', 'user.name=Test', '-c', 'user.email=test@localhost', 'commit', '-m', 'baseline');
      git(ctx.project, 'checkout', '--detach');
    }
    // Use a new card to reach the readiness check even when the first card already waits on a gate.
    const second = ctx.card('work', purpose === 'verification');
    await assert.rejects(ctx.dispatch(second.id, 'work', purpose), code('GIT_INITIALIZATION_PENDING'));
    if (gateId) assert.equal(ctx.gate().id, gateId);
    assert.equal(ctx.store.gates('work').length, 1);
    assert.equal(ctx.gate().status, 'pending');
    assert.throws(() => ctx.decide(), code('GIT_INITIAL_COMMIT_REQUIRED'));
    assert.equal(ctx.store.work('work').workBranch, null);
    assert.deepEqual(listDispatches(ctx.store, 'work'), []);
    assert.equal(cardDetails(ctx.store, 'work', second.id).status, 'waiting');
  });
}

test('SSH 私钥和常见私钥容器进入可疑路径与预填规则，确认后不进入初始提交', async t => {
  const ctx = fixture(t);
  const names = ['id_rsa', 'id_ed25519', 'id_ecdsa', 'id_dsa', 'id_custom', 'id_ed25519.pub',
    'client.p12', 'client.pfx', 'wallet.keystore', 'server.jks', 'UPPER.PFX'];
  mkdirSync(join(ctx.project, 'keys'));
  for (const name of names) writeFileSync(join(ctx.project, 'keys', name), 'private-key-fixture');
  await assert.rejects(ctx.dispatch(ctx.card().id), code('GIT_INITIALIZATION_PENDING'));
  const details = ctx.gate().gitInitialization!;
  assert.deepEqual(details.suspiciousPaths.map(item => item.path).sort(), names.map(name => `keys/${name}`).sort());
  assert.ok(details.suspiciousPaths.every(item => item.reason === 'secret'));
  assert.deepEqual(details.ignoreRules.trim().split('\n').sort(), names.map(name => `/keys/${name}`).sort());
  ctx.decide('initialize', details.ignoreRules);
  assert.deepEqual(git(ctx.project, 'ls-tree', '-r', '--name-only', 'HEAD').split('\n'), ['.gitignore', 'README.md']);
  for (const name of names) assert.equal(readFileSync(join(ctx.project, 'keys', name), 'utf8'), 'private-key-fixture');
});

test('上次进程中断留下的临时路径会明确报告，不把残留元数据提交进项目，处理后可重试', async t => {
  const ctx = fixture(t);
  await assert.rejects(ctx.dispatch(ctx.card().id), code('GIT_INITIALIZATION_PENDING'));
  const temporary = join(ctx.project, `.helm-git-init-${ctx.gate().id}-interrupted`);
  mkdirSync(temporary);
  writeFileSync(join(temporary, 'unfinished'), 'temporary metadata');
  assert.throws(() => ctx.decide(), code('GIT_INITIALIZATION_INTERRUPTED'));
  assert.equal(ctx.gate().status, 'pending');
  assert.equal(existsSync(join(ctx.project, '.gitignore')), false);
  assert.equal(existsSync(join(ctx.project, '.git')), false);
  assert.equal(readFileSync(join(temporary, 'unfinished'), 'utf8'), 'temporary metadata');
  rmSync(temporary, { recursive: true });
  ctx.decide();
  assert.deepEqual(git(ctx.project, 'ls-tree', '--name-only', 'HEAD').split('\n'), ['.gitignore', 'README.md']);
});
