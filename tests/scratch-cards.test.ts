import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { get } from 'node:http';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import { createDispatch, dispatchArtifacts, getDispatch, listDispatches, markOutdated, readArtifact, saveArtifact, submitConclusion } from '../src/dispatch.js';
import { FakeDriver, type Driver, type EndReason, type SessionOptions } from '../src/driver.js';
import { ExecutionRunner } from '../src/execution.js';
import { cardDetails, cardGraph, createCard, updateCard } from '../src/graph.js';
import { cancelCard, completeCard } from '../src/completion.js';
import { reconcileStartup } from '../src/reconcile.js';
import { RuleError, TaskStore } from '../src/store.js';
import { startTestHelmd, fixtureAgentDir } from './helmd-fixture.js';

const actor = { type: 'runtime', id: 'test' } as const;
const code = (expected: string) => (error: unknown) => error instanceof RuleError && error.code === expected;

// issue 30: medium regression — completing a scratch card must not discard large originals.
test('超过 20 MiB 的临时目录成果完成后仍完整保存，读取只拒绝预览', async t => {
  const content = Buffer.alloc(21 * 1024 * 1024, 0xa5);
  const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'data.js'), content));
  const card = ctx.card();
  const dispatch = await ctx.run(card.id);
  assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? '');
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[]).find(file => file.name === 'data.js');
  assert.ok(file, '大文件必须保存为成果');
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  assert.equal(existsSync(ctx.starts[0]!.cwd), false);
  assert.equal(hash(readFileSync(file.path)), hash(content));
  assert.throws(() => readArtifact(ctx.store, 'work', file.id), code('FILE_TOO_LARGE'));
  const daemon = await startTestHelmd({ port: 0, dataDir: ctx.store.dataDir });
  try {
    const read = await fetch(`${daemon.url}/api/read-artifact`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ workId: 'work', artifactId: file.id }) });
    assert.equal(read.status, 413);
    assert.equal((await read.json() as any).error.code, 'FILE_TOO_LARGE');
    const response = await fetch(`${daemon.url}/api/artifact-download?workId=work&artifactId=${file.id}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/octet-stream');
    assert.equal(response.headers.get('content-length'), String(content.length));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('content-disposition'), "attachment; filename*=UTF-8''data.js");
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), hash(content));
  } finally { await daemon.close(); }
});

function fixture(t: TestContext, execute = (_options: SessionOptions, _input: any) => {}, reason: EndReason | (() => EndReason) = 'completed') {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-scratch-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  writeFileSync(join(project, 'notes.txt'), 'project original\n');
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir, ['claude-sdk', 'codex', 'grok', 'deepseek']));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-11-01')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'executing', 'work', '2026-11-01')");
  const starts: SessionOptions[] = [];
  const driver: Driver = {
    capabilities: new FakeDriver().capabilities,
    async checkAvailability() { return { available: true }; },
    async start(options) {
      starts.push(options);
      return { id: `session-${starts.length}`, async send(input) { await execute(options, JSON.parse(input)); }, cancel() {},
        events: (async function* () {
          yield { type: 'end' as const, step: 1, reason: typeof reason === 'function' ? reason() : reason, finalAnswer: '报告：report.txt', usage: { inputTokens: 1, outputTokens: 1 } };
        })() };
    },
  };
  const runner = new ExecutionRunner(store, { 'claude-sdk': driver, codex: driver, grok: driver, deepseek: driver }, 'http://unused.invalid/mcp');
  t.after(async () => { await runner.close(); store.close(); rmSync(directory, { recursive: true, force: true }); });
  const card = () => createCard(store, actor, { workId: 'work', key: `card-${store.events({}).length}`, content: '联网调研', workspace: 'scratch' });
  const dispatch = (cardId: string, agentId = 'claude-executor', purpose: 'execution' | 'verification' = 'execution') => createDispatch(store, actor,
    { workId: 'work', cardId, key: `dispatch-${store.events({}).length}`, agentId, purpose });
  const run = async (cardId: string, agentId = 'claude-executor') => {
    const created = await dispatch(cardId, agentId);
    await runner.settle('work', cardId);
    return getDispatch(store, 'work', created.id);
  };
  return { store, runner, project, starts, card, run, dispatch };
}

for (const agent of ['claude-executor', 'codex-executor', 'grok-executor', 'deepseek-executor']) {
  test(`${agent} 临时目录执行可写、复用目录并保存相对路径文件，不初始化 git`, async t => {
    let expected = '', attempts = 0;
    const ctx = fixture(t, (options, input) => {
      assert.equal(options.cwd, expected);
      assert.equal(input.workspace, 'scratch');
      assert.equal('readOnly' in input, false);
      assert.equal(existsSync(join(options.cwd, 'notes.txt')), false);
      if (attempts++) assert.equal(readFileSync(join(options.cwd, 'report.txt'), 'utf8'), 'draft\n');
      writeFileSync(join(options.cwd, 'report.txt'), attempts === 1 ? 'draft\n' : 'revised\n');
    });
    const card = ctx.card();
    expected = join(ctx.store.dataDir, 'scratch', 'work', card.id);
    assert.equal(existsSync(expected), false);
    const first = await ctx.run(card.id, agent);
    assert.equal(first.endReason, 'completed', first.failure ?? '');
    const second = await ctx.run(card.id, agent);
    assert.equal(second.endReason, 'completed', second.failure ?? '');
    for (const [dispatch, content] of [[first, 'draft\n'], [second, 'revised\n']] as const) {
      assert.equal(dispatch.startCommit, null);
      assert.equal(dispatch.endCommit, null);
      assert.equal('readOnlyCheck' in dispatch, false);
      const files = dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[];
      assert.deepEqual(files.map(file => [file.kind, file.name]), [['file', 'report.txt']]);
      assert.equal(readArtifact(ctx.store, 'work', String(files[0]!.id)).content, content);
    }
    assert.equal(ctx.store.work('work').workBranch, null);
    assert.equal(ctx.store.work('work').workPath, null);
    assert.equal(cardDetails(ctx.store, 'work', card.id).cardBranch, null);
    assert.equal(ctx.store.gates('work').length, 0);
    assert.equal(existsSync(join(ctx.project, '.git')), false);
    assert.equal(readFileSync(join(ctx.project, 'notes.txt'), 'utf8'), 'project original\n');
  });
}

test('运行位置派单后锁定，临时目录卡片不生成初始化关卡', async t => {
  const ctx = fixture(t);
  const card = ctx.card();
  assert.equal(createCard(ctx.store, actor, { workId: 'work', key: 'default', content: '代码' }).workspace, 'copy');
  assert.equal(ctx.store.gates('work').length, 0);
  const queued = await ctx.dispatch(card.id);
  assert.throws(() => updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, workspace: 'copy' }), code('CARD_ALREADY_DISPATCHED'));
  await ctx.runner.settle('work', card.id);
  assert.equal(getDispatch(ctx.store, 'work', queued.id).endReason, 'completed');
  assert.throws(() => updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, workspace: 'copy' }), error =>
    error instanceof RuleError && ['CARD_COPY_EXISTS', 'CARD_ALREADY_DISPATCHED'].includes(error.code));
  assert.equal(cardGraph(ctx.store, 'work').find(node => node.id === card.id)?.type, 'card');
});

for (const ending of ['completed', 'error', 'quota-exhausted', 'timed-out', 'aborted', 'context-overflow'] as const) {
  test(`验收后同卡片执行以 ${ending} 结束，即使文件未变旧票也过期，重新验收才能完成`, async t => {
    let reason: EndReason = 'completed';
    const ctx = fixture(t, (options, input) => {
      if (input.purpose === 'execution') writeFileSync(join(options.cwd, 'report.txt'), 'unchanged research\n');
      else submitConclusion(ctx.store, ctx.runner.authenticate(options.mcpServers.helm!.headers!.Authorization!)!, { conclusion: 'passed', reason: '报告通过' });
    }, () => reason);
    const card = ctx.card();
    updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, needsVerification: true });
    await ctx.run(card.id);
    const vote = await ctx.dispatch(card.id, 'claude-executor', 'verification');
    await ctx.runner.settle('work', card.id);
    const readVote = () => markOutdated(ctx.store, [getDispatch(ctx.store, 'work', vote.id)])[0]!;
    assert.equal(readVote().outdated, false);
    await ctx.run(ctx.card().id);
    assert.equal(readVote().outdated, false, '别的卡片执行结束不会让这张票过期');
    reason = ending;
    assert.equal((await ctx.run(card.id)).endReason, ending);
    assert.equal(readVote().outdated, true);
    assert.throws(() => completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }), code('VERIFICATION_OUTDATED'));
    assert.ok(existsSync(cardDetails(ctx.store, 'work', card.id).workPath!));
    reason = 'completed';
    const fresh = await ctx.dispatch(card.id, 'claude-executor', 'verification');
    await ctx.runner.settle('work', card.id);
    assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
    const votes = markOutdated(ctx.store, listDispatches(ctx.store, 'work', card.id)).filter(item => item.purpose === 'verification');
    assert.deepEqual(votes.map(item => [item.id, item.outdated]), [[vote.id, true], [fresh.id, false]]);
  });
}

test('临时目录验收在一次性复制中可写，结束删除复制且保留原目录，无 git 也可凭当前通过票完成', async t => {
  let original = '', verification = '';
  const ctx = fixture(t, (options, input) => {
    if (input.purpose === 'execution') {
      original = options.cwd;
      mkdirSync(join(original, 'reports'));
      writeFileSync(join(original, 'reports', 'report.txt'), 'original research\n');
      symlinkSync(join(original, 'reports'), join(original, 'linked-reports'));
      return;
    }
    verification = options.cwd;
    assert.notEqual(verification, original);
    assert.equal(readFileSync(join(verification, 'reports', 'report.txt'), 'utf8'), 'original research\n');
    assert.equal(existsSync(join(verification, 'linked-reports')), false);
    writeFileSync(join(verification, 'reports', 'report.txt'), 'reviewer edit\n');
    assert.equal(readFileSync(join(original, 'reports', 'report.txt'), 'utf8'), 'original research\n');
    submitConclusion(ctx.store, ctx.runner.authenticate(options.mcpServers.helm!.headers!.Authorization!)!, { conclusion: 'passed', reason: '已核查报告' });
  });
  const card = ctx.card();
  updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, needsVerification: true });
  assert.equal((await ctx.run(card.id)).endReason, 'completed');
  const vote = await ctx.dispatch(card.id, 'claude-executor', 'verification');
  await ctx.runner.settle('work', card.id);
  const ended = getDispatch(ctx.store, 'work', vote.id);
  assert.equal(ended.endReason, 'completed', ended.failure ?? '');
  assert.equal(ended.conclusion, 'passed');
  assert.equal(ended.startCommit, null);
  assert.equal(ended.endCommit, null);
  assert.ok(verification);
  assert.equal(existsSync(verification), false);
  assert.equal(cardDetails(ctx.store, 'work', card.id).workPath, original);
  assert.equal(readFileSync(join(original, 'reports', 'report.txt'), 'utf8'), 'original research\n');
  assert.equal(ctx.store.gates('work').length, 0);
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
  assert.equal(existsSync(original), false);
  assert.equal(ctx.store.work('work').workBranch, null);
});

test('临时目录自动流程派齐预写验收票，通过后自动完成，无分支且执行成果仍可读', async t => {
  const ctx = fixture(t, (options, input) => {
    if (input.purpose === 'execution') writeFileSync(join(options.cwd, 'report.txt'), 'research fact\n');
    else {
      assert.equal(readFileSync(join(options.cwd, 'report.txt'), 'utf8'), 'research fact\n');
      writeFileSync(join(options.cwd, 'report.txt'), 'verifier edit\n');
    }
    submitConclusion(ctx.store, ctx.runner.authenticate(options.mcpServers.helm!.headers!.Authorization!)!, {
      conclusion: input.purpose === 'execution' ? 'completed' : 'passed', reason: '已检查报告',
    });
  });
  const card = ctx.card();
  updateCard(ctx.store, actor, { workId: 'work', cardId: card.id, needsVerification: true,
    autoFlow: { verifications: ['检查事实', '检查证据'].map(content => ({ agentId: 'claude-executor', content, needsBrowser: false })) } });
  const execution = await ctx.run(card.id);
  await ctx.runner.settle('work', card.id);
  assert.equal(cardDetails(ctx.store, 'work', card.id).status, 'completed');
  const votes = markOutdated(ctx.store, listDispatches(ctx.store, 'work', card.id)).filter(item => item.purpose === 'verification');
  assert.deepEqual(votes.map(item => [item.key, item.endReason, item.conclusion, item.outdated]), [
    [`auto-verify-${execution.id}-0`, 'completed', 'passed', false], [`auto-verify-${execution.id}-1`, 'completed', 'passed', false],
  ]);
  assert.equal(new Set(ctx.starts.map(start => start.cwd)).size, 3);
  for (const start of ctx.starts) assert.equal(existsSync(start.cwd), false);
  assert.equal(ctx.store.work('work').workBranch, null);
  const file = (dispatchArtifacts(ctx.store, 'work', execution.id) as any[]).find(item => item.name === 'report.txt');
  assert.equal(readArtifact(ctx.store, 'work', file.id).content, 'research fact\n');
  const events = ctx.store.events({ workId: 'work' });
  assert.equal(events.some(event => event.action === 'auto-flow-stopped'), false);
  assert.equal(events.find(event => event.action === 'card-completed')?.actor.type, 'runtime');
});

test('临时目录的多票验收各用独立副本且与执行互斥', async t => {
  const { until } = await import('./ui-fixture.js');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  const ctx = fixture(t, async (options, input) => {
    if (input.purpose === 'execution') writeFileSync(join(options.cwd, 'report.txt'), 'research fact\n');
    else {
      assert.equal(readFileSync(join(options.cwd, 'report.txt'), 'utf8'), 'research fact\n');
      writeFileSync(join(options.cwd, 'report.txt'), input.dispatchId);
      await hold;
    }
  });
  const card = ctx.card();
  await ctx.dispatch(card.id);
  await assert.rejects(ctx.dispatch(card.id, 'claude-executor', 'verification'), code('DISPATCH_ACTIVE'));
  await ctx.runner.settle('work', card.id);
  const votes = [await ctx.dispatch(card.id, 'claude-executor', 'verification'), await ctx.dispatch(card.id, 'claude-executor', 'verification')];
  const settling = ctx.runner.settle('work', card.id);
  await until(async () => ctx.starts.length === 3 && votes.every((vote, index) =>
    readFileSync(join(ctx.starts[index + 1]!.cwd, 'report.txt'), 'utf8') === vote.id), Boolean);
  await assert.rejects(ctx.dispatch(card.id), code('DISPATCH_ACTIVE'));
  assert.equal(new Set(ctx.starts.map(start => start.cwd)).size, 3);
  const original = ctx.starts[0]!.cwd;
  assert.equal(cardDetails(ctx.store, 'work', card.id).workPath, original);
  assert.equal(readFileSync(join(original, 'report.txt'), 'utf8'), 'research fact\n');
  release();
  await settling;
  for (const start of ctx.starts.slice(1)) assert.equal(existsSync(start.cwd), false);
  assert.equal(existsSync(original), true);
});

for (const reason of ['completed', 'error', 'quota-exhausted', 'timed-out', 'aborted', 'context-overflow'] as const) {
  test(`临时目录派单 ${reason} 后保存文件，脱敏项目变量，跳过符号链接并注明`, async t => {
    const ctx = fixture(t, options => {
      mkdirSync(join(options.cwd, 'reports'));
      writeFileSync(join(options.cwd, 'reports', 'report.txt'), 'fact secret-value\n');
      writeFileSync(join(options.cwd, 'binary.bin'), Buffer.from([0, 1, 2, 255]));
      symlinkSync(join(ctx.project, 'notes.txt'), join(options.cwd, 'external.txt'));
      symlinkSync(ctx.project, join(options.cwd, 'external-dir'));
      symlinkSync('missing', join(options.cwd, 'broken'));
    }, reason);
    ctx.store.db.exec("INSERT INTO project_environment VALUES ('project', 'RESEARCH_TOKEN', 'secret-value')");
    const dispatch = await ctx.run(ctx.card().id);
    assert.equal(dispatch.endReason, reason, dispatch.failure ?? '');
    const files = dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[];
    assert.deepEqual(files.filter(file => file.kind === 'file').map(file => file.name).sort(), ['binary.bin', 'reports/report.txt']);
    const report = files.find(file => file.name === 'reports/report.txt')!;
    const text = readArtifact(ctx.store, 'work', report.id).content;
    assert.match(String(text), /fact/);
    assert.doesNotMatch(String(text), /secret-value/);
    assert.equal(readArtifact(ctx.store, 'work', files.find(file => file.name === 'binary.bin')!.id, 'base64').content, 'AAEC/w==');
    const note = readArtifact(ctx.store, 'work', files.find(file => file.kind === 'test-output')!.id).content;
    for (const name of ['external.txt', 'external-dir', 'broken']) assert.ok(String(note).includes(name));
    assert.match(String(note), /符号链接/);
  });
}

for (const action of ['complete', 'cancel'] as const) test(`卡片 ${action} 删除临时目录，成果仍可读且不执行 git`, async t => {
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'report.txt'), 'report\n'));
  const card = ctx.card();
  const dispatch = await ctx.run(card.id);
  const path = ctx.starts[0]!.cwd;
  assert.ok(existsSync(path));
  const params = { workId: 'work', cardId: card.id };
  const result = action === 'complete' ? completeCard(ctx.store, actor, params) : cancelCard(ctx.store, actor, { ...params, reason: '取消' });
  assert.equal(result.status, action === 'complete' ? 'completed' : 'cancelled');
  assert.equal(existsSync(path), false);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  assert.equal(readArtifact(ctx.store, 'work', file.id).content, 'report\n');
  assert.equal(existsSync(join(ctx.project, '.git')), false);
});

test('启动对账保存被中断派单的成果，保留活动卡片临时目录并清理终态、孤儿和错误位置目录', async t => {
  const ctx = fixture(t);
  await ctx.runner.close();
  const active = ctx.card(), completed = ctx.card(), cancelled = ctx.card();
  ctx.store.db.exec("INSERT INTO project_environment VALUES ('project', 'RESEARCH_TOKEN', 'restart-secret')");
  const dispatch = await ctx.dispatch(active.id);
  ctx.store.db.prepare("UPDATE dispatches SET status = 'running' WHERE id = ?").run(dispatch.id);
  ctx.store.db.prepare("UPDATE cards SET status = 'completed' WHERE id = ?").run(completed.id);
  ctx.store.db.prepare("UPDATE cards SET status = 'cancelled' WHERE id = ?").run(cancelled.id);
  const root = join(ctx.store.dataDir, 'scratch');
  for (const id of [active.id, completed.id, cancelled.id, 'orphan']) {
    mkdirSync(join(root, 'work', id), { recursive: true });
    writeFileSync(join(root, 'work', id, 'report.txt'), 'recovered restart-secret\n');
  }
  mkdirSync(join(root, 'missing-work', 'missing-card'), { recursive: true });
  const copy = createCard(ctx.store, actor, { workId: 'work', key: 'copy', content: '代码' });
  mkdirSync(join(root, 'work', copy.id));
  await reconcileStartup(ctx.store);
  assert.equal(getDispatch(ctx.store, 'work', dispatch.id).endReason, 'aborted');
  assert.ok(existsSync(join(root, 'work', active.id)));
  for (const id of [completed.id, cancelled.id, 'orphan', copy.id]) assert.equal(existsSync(join(root, 'work', id)), false);
  assert.equal(existsSync(join(root, 'missing-work')), false);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  assert.equal(readArtifact(ctx.store, 'work', file.id).content, 'recovered [REDACTED]\n');
  await reconcileStartup(ctx.store);
  assert.ok(existsSync(join(root, 'work', active.id)));
});

test('非 git 项目启动对账删除中断的临时目录验收及孤儿副本，保留原件且重复对账不重复结束', async t => {
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'report.txt'), 'original research\n'));
  const card = ctx.card();
  await ctx.run(card.id);
  const original = cardDetails(ctx.store, 'work', card.id).workPath!;
  await ctx.runner.close();
  const vote = await ctx.dispatch(card.id, 'claude-executor', 'verification');
  ctx.store.db.prepare("UPDATE dispatches SET status = 'running', started_at = '2026-11-01' WHERE id = ?").run(vote.id);
  const copies = join(ctx.store.dataDir, 'worktrees', 'work', 'verifications');
  for (const id of [vote.id, 'orphan']) {
    mkdirSync(join(copies, id), { recursive: true });
    writeFileSync(join(copies, id, 'report.txt'), 'reviewer changes\n');
  }
  await reconcileStartup(ctx.store);
  const ended = getDispatch(ctx.store, 'work', vote.id);
  assert.equal(ended.endReason, 'aborted');
  assert.equal(ended.abortReason, '运行层重启');
  assert.equal(ended.endCommit, null);
  assert.equal(existsSync(copies), false);
  assert.equal(readFileSync(join(original, 'report.txt'), 'utf8'), 'original research\n');
  assert.deepEqual(dispatchArtifacts(ctx.store, 'work', vote.id), []);
  await reconcileStartup(ctx.store);
  assert.equal(existsSync(copies), false);
  assert.equal(ctx.store.events({ dispatchId: vote.id }).filter(event => event.action === 'dispatch-ended').length, 1);
});

test('启动恢复被取消的排队返工派单，保存并脱敏已有文件后清理目录', async t => {
  const ctx = fixture(t);
  await ctx.runner.close();
  ctx.store.db.exec("INSERT INTO project_environment VALUES ('project', 'RESEARCH_TOKEN', 'queued-secret')");
  const card = ctx.card();
  const dispatch = await ctx.dispatch(card.id);
  const path = join(ctx.store.dataDir, 'scratch', 'work', card.id);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'report.txt'), 'recovered queued-secret\n');
  ctx.store.db.prepare("UPDATE dispatches SET abort_reason = '取消返工' WHERE id = ?").run(dispatch.id);
  ctx.store.db.prepare("UPDATE cards SET status = 'cancelled' WHERE id = ?").run(card.id);
  await reconcileStartup(ctx.store);
  assert.equal(getDispatch(ctx.store, 'work', dispatch.id).endReason, 'aborted');
  assert.equal(existsSync(path), false);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[]).find(file => file.name === 'report.txt');
  assert.ok(file);
  assert.equal(readArtifact(ctx.store, 'work', file.id).content, 'recovered [REDACTED]\n');
});

for (const target of ['card', 'work'] as const) test(`运行中取消${target}先保存临时目录成果再删除目录；删除工作清理残留`, async t => {
  const { uiFixture, until } = await import('./ui-fixture.js');
  let path = '';
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'brief', requirements: '调研', boundary: '临时目录', criteria: '文件', deliverables: '交付物及查看入口' } },
  ], [
    { type: 'tool', name: 'create-card', arguments: { key: 'research', content: '调研', workspace: 'scratch' }, saveAs: 'card' },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: (ctx.results.get('card') as any).result.id, key: 'run', agentId: 'claude-executor' }) },
  ]], undefined, { executorScripts: [ctx => { path = ctx.options.cwd; return [{ type: 'write', path: 'report.txt', content: 'partial report\n' }, { type: 'hang' }]; }] });
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '调研' })).result.work;
  const params = { workId: work.id };
  const description = (await until(() => daemon.call('get-work-descriptions', params), value => value.result.length > 0)).result[0];
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  assert.equal((await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' })).ok, true);
  const dispatch = (await until(() => daemon.call('list-dispatches', params), value => value.result[0]?.status === 'running' && existsSync(join(path, 'report.txt')))).result[0];
  assert.equal((await daemon.call(target === 'card' ? 'cancel-card' : 'cancel-work', { ...params, ...(target === 'card' ? { cardId: dispatch.cardId, reason: '停止调研' } : {}) })).ok, true);
  assert.equal(existsSync(path), false);
  if (target === 'work') assert.equal(existsSync(join(daemon.directory, 'data', 'scratch', work.id)), false);
  const ended = (await daemon.call('get-dispatch', { ...params, dispatchId: dispatch.id })).result;
  assert.equal(ended.endReason, 'aborted');
  const file = (await daemon.call('get-dispatch-artifacts', { ...params, dispatchId: dispatch.id })).result[0];
  assert.equal((await daemon.call('read-artifact', { ...params, artifactId: file.id })).result.content, 'partial report\n');
  if (target === 'card') assert.equal((await daemon.call('cancel-work', params)).ok, true);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'stale.txt'), 'stale');
  assert.equal((await daemon.call('delete-work', { ...params, confirm: true })).ok, true);
  assert.equal(existsSync(join(daemon.directory, 'data', 'scratch', work.id)), false);
});

test('返工派单在启动前取消时也保存并脱敏已有文件', async t => {
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'report.txt'), 'private research-key\n'));
  ctx.store.db.exec("INSERT INTO project_environment VALUES ('project', 'RESEARCH_TOKEN', 'research-key')");
  const card = ctx.card();
  assert.equal((await ctx.run(card.id)).endReason, 'completed');
  const queued = await ctx.dispatch(card.id);
  cancelCard(ctx.store, actor, { workId: 'work', cardId: card.id, reason: '取消返工' });
  await ctx.runner.settle('work', card.id);
  const dispatch = getDispatch(ctx.store, 'work', queued.id);
  assert.equal(dispatch.endReason, 'aborted');
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[]).find(file => file.name === 'report.txt');
  assert.ok(file);
  assert.equal(readArtifact(ctx.store, 'work', file.id).content, 'private [REDACTED]\n');
});

// issue 30: medium regression — a failed save must retain originals until a successful redispatch.
for (const ending of ['completed', 'timed-out', 'aborted'] as const) test(`派单 ${ending} 后保存失败以 error 结束且不发布部分成果，禁止完成，修好后重新派单可完成`, async t => {
  let attempts = 0, blocked = '';
  const ctx = fixture(t, options => {
    writeFileSync(join(options.cwd, 'a.txt'), 'first file');
    blocked = join(options.cwd, 'secret-value.txt');
    writeFileSync(blocked, 'second file');
    chmodSync(blocked, attempts++ ? 0o600 : 0);
  }, () => attempts === 1 ? ending : 'completed');
  ctx.store.db.exec("INSERT INTO project_environment VALUES ('project', 'TOKEN', 'secret-value')");
  const card = ctx.card();
  t.after(() => { if (existsSync(blocked)) chmodSync(blocked, 0o600); });
  const failed = await ctx.run(card.id);
  assert.equal(failed.endReason, 'error');
  assert.match(failed.failure!, /\[REDACTED\]\.txt.*EACCES/);
  assert.doesNotMatch(failed.failure!, /secret-value/);
  assert.deepEqual(dispatchArtifacts(ctx.store, 'work', failed.id), []);
  const events = ctx.store.events({ dispatchId: failed.id });
  assert.equal(events.filter(event => event.action === 'artifact-saved').length, 0);
  assert.equal(events.filter(event => event.action === 'scratch-artifacts-unsaved').length, 1);
  assert.equal(existsSync(join(ctx.store.dataDir, 'dispatches', failed.id, 'artifacts')), true);
  assert.deepEqual(readdirSync(join(ctx.store.dataDir, 'dispatches', failed.id, 'artifacts')), []);
  assert.ok(existsSync(ctx.starts[0]!.cwd));
  assert.throws(() => completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }), error => {
    assert.ok(code('SCRATCH_ARTIFACTS_UNSAVED')(error));
    assert.match((error as Error).message, /释放空间.*重新派单.*取消卡片/);
    return true;
  });
  chmodSync(blocked, 0o600);
  const saved = await ctx.run(card.id);
  assert.equal(saved.endReason, 'completed', saved.failure ?? '');
  assert.equal((dispatchArtifacts(ctx.store, 'work', saved.id) as any[]).length, 2);
  assert.equal(completeCard(ctx.store, actor, { workId: 'work', cardId: card.id }).status, 'completed');
});

// issue 30: medium regression — one unreadable scratch file cannot prevent startup.
test('启动对账遇到成果保存失败仍结束派单并保留 failure 和临时目录', async t => {
  const ctx = fixture(t);
  await ctx.runner.close();
  const card = ctx.card();
  const dispatch = await ctx.dispatch(card.id);
  ctx.store.db.prepare("UPDATE dispatches SET status = 'running' WHERE id = ?").run(dispatch.id);
  const root = join(ctx.store.dataDir, 'scratch', 'work', card.id);
  mkdirSync(root, { recursive: true });
  const path = join(root, 'blocked.txt');
  writeFileSync(path, 'retained');
  chmodSync(path, 0);
  t.after(() => { if (existsSync(path)) chmodSync(path, 0o600); });
  await assert.doesNotReject(() => reconcileStartup(ctx.store));
  const ended = getDispatch(ctx.store, 'work', dispatch.id);
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endReason, 'error');
  assert.match(ended.failure!, /blocked\.txt.*EACCES/);
  assert.ok(existsSync(path));
});

// issue 30: medium spec — raw and JSON spellings spanning stream chunks remain secret.
test('流式保存跨块秘密值并保持其他二进制字节', async t => {
  const secret = '秘密"value\nend';
  const spelling = JSON.stringify(secret).slice(1, -1);
  const prefix = Buffer.alloc(64 * 1024 - 5, 0xff);
  const padding = Buffer.alloc(64 * 1024 - Buffer.byteLength(secret) - 2, 0xfd);
  const content = Buffer.concat([prefix, Buffer.from(secret), Buffer.from([0, 0xfe]), padding, Buffer.from(spelling)]);
  const expected = Buffer.concat([prefix, Buffer.from('[REDACTED]'), Buffer.from([0, 0xfe]), padding, Buffer.from('[REDACTED]')]);
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'data.bin'), content));
  ctx.store.db.prepare('INSERT INTO project_environment VALUES (?, ?, ?)').run('project', 'TOKEN', secret);
  const dispatch = await ctx.run(ctx.card().id);
  assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? '');
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  assert.deepEqual(readFileSync(file.path), expected);
});

// issue 30 / ADR 0016: medium spec — download is the sole GET API, scoped to one work.
test('成果下载校验来源和工作归属，拒绝分支和缺失文件，安全编码文件名，其他 GET API 不变', async t => {
  const name = '目录/中文"line\n(1)\'.txt';
  const ctx = fixture(t, options => {
    mkdirSync(join(options.cwd, '目录'));
    writeFileSync(join(options.cwd, name), 'downloaded');
  });
  const dispatch = await ctx.run(ctx.card().id);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  ctx.store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('other', 'project', 'executing', 'other', '2026-11-01')");
  ctx.store.transaction(() => saveArtifact(ctx.store, dispatch, 'branch', 'branch', 'ref', 'commit'));
  // A legacy metadata-only file has no creation operation in the current API.
  ctx.store.db.prepare("INSERT INTO artifacts VALUES ('no-file', ?, 'file', 'empty', NULL, NULL, NULL)").run(dispatch.id);
  const branch = (ctx.store.db.prepare("SELECT id FROM artifacts WHERE kind = 'branch'").get()!).id;
  const daemon = await startTestHelmd({ port: 0, dataDir: ctx.store.dataDir });
  try {
    const url = `${daemon.url}/api/artifact-download?workId=work&artifactId=${file.id}`;
    for (const site of ['cross-site', 'same-site']) {
      const response = await fetch(url, { headers: { 'sec-fetch-site': site } });
      assert.equal(response.status, 403);
    }
    assert.equal((await fetch(url, { headers: { origin: 'https://external.invalid' } })).status, 403);
    const invalidHost = await new Promise<number | undefined>((resolve, reject) => {
      get(url, { headers: { host: 'external.invalid' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
    });
    assert.equal(invalidHost, 403);
    for (const site of [undefined, 'same-origin', 'none']) {
      const response = await fetch(url, { headers: site ? { 'sec-fetch-site': site } : {} });
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'downloaded');
      assert.equal(response.headers.get('content-disposition'), "attachment; filename*=UTF-8''%E4%B8%AD%E6%96%87%22line%0A%281%29%27.txt");
    }
    const wrongWork = await fetch(url.replace('workId=work', 'workId=other'));
    assert.equal(wrongWork.status, 400);
    assert.equal((await wrongWork.json() as any).error.code, 'INVALID_ARTIFACT');
    for (const id of [String(branch), 'no-file']) {
      const noFile = await fetch(url.replace(file.id, id));
      assert.equal(noFile.status, 400);
      assert.equal((await noFile.json() as any).error.code, 'INVALID_ARTIFACT');
    }
    for (const route of ['/api/get-work?workId=work', '/api/missing', '/api/artifact-download/']) {
      const response = await fetch(daemon.url + route);
      assert.equal(response.status, 405);
      assert.equal((await response.json() as any).error.code, 'METHOD_NOT_ALLOWED');
    }
    rmSync(file.path);
    const missing = await fetch(url);
    assert.equal(missing.status, 404);
    assert.equal((await missing.json() as any).error.code, 'FILE_NOT_FOUND');
  } finally { await daemon.close(); }
});

// issue 30: medium spec — substitute a failing disk stream at the filesystem boundary.
test('成果下载中途读取失败会中断响应，不返回截断的成功内容', async t => {
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'file.txt'), 'complete content'));
  const dispatch = await ctx.run(ctx.card().id);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  const daemon = await startTestHelmd({ port: 0, dataDir: ctx.store.dataDir });
  const original = fs.createReadStream;
  const stream = t.mock.method(fs, 'createReadStream', (path: any, options: any) => {
    if (String(path) !== file.path) return original(path, options);
    return Readable.from((async function* () {
      yield Buffer.from('partial');
      await new Promise(resolve => setImmediate(resolve));
      throw new Error('simulated disk read failure');
    })());
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(async () => {
      const response = await fetch(`${daemon.url}/api/artifact-download?workId=work&artifactId=${file.id}`);
      await response.arrayBuffer();
    });
  } finally {
    stream.mock.restore(); syncBuiltinESMExports();
    await daemon.close();
  }
});

// issue 30: medium spec — binary data is copied without a text round trip when no secrets exist.
test('没有秘密值的临时目录成果逐字节保留非 UTF-8 二进制', async t => {
  const bytes = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, byte) => byte)), Buffer.alloc(64 * 1024, 0xfe)]);
  const ctx = fixture(t, options => writeFileSync(join(options.cwd, 'bytes.bin'), bytes));
  const dispatch = await ctx.run(ctx.card().id);
  const file = (dispatchArtifacts(ctx.store, 'work', dispatch.id) as any[])[0]!;
  assert.deepEqual(readFileSync(file.path), bytes);
});
