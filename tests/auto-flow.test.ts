import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { AgentCatalog } from '../src/agents.js';
import { addDependency, createCard, type AutoFlow } from '../src/graph.js';
import { completeCard } from '../src/completion.js';
import { reconcileStartup } from '../src/reconcile.js';
import { TaskStore } from '../src/store.js';
import type { StartupBrief } from '../src/rounds.js';
import { fixtureAgentDir, startTestHelmd as startHelmd } from './helmd-fixture.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const code = (expected: string) => (value: any) => assert.equal(value.error?.code, expected, JSON.stringify(value));
const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const hold = () => {
  let release!: () => void;
  return { promise: new Promise<void>(resolve => { release = resolve; }), release: () => release() };
};
const flow = (count = 2): AutoFlow => ({ verifications: Array.from({ length: count }, (_, index) => ({
  agentId: 'codex-executor', content: `角度 ${index}：重跑 npm test 并检查 result.txt`, needsBrowser: false,
})) });
const card = (key = 'card', autoFlow: AutoFlow | undefined = flow(), needsVerification = true): FakeStep => ({
  type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key, content: key, needsVerification, ...(autoFlow ? { autoFlow } : {}) }), saveAs: key, check: ok,
});
const dispatch = (key = 'card', purpose = 'execution'): FakeStep => ({ type: 'tool', name: 'create-dispatch',
  arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, key).id, key: `run-${key}`, agentId: 'claude-executor', purpose }), check: ok,
});
const conclusion = (value: string): FakeStep => ({ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: value, reason: value }, check: ok });

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 10_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待自动流程超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, steps: FakeStep[], executors: FakeScript[], verifiers: FakeScript[] = [], config: {
  after?: FakeScript; codexDriver?: Driver;
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-auto-flow-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'result.txt'), 'baseline\n');
  git(repo, 'add', 'result.txt');
  git(repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  const driver = new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '自动流程', boundary: '本机', criteria: '机械步骤不唤醒' }), check: ok },
  ], [...steps, { type: 'end', reason: 'completed', finalAnswer: 'auto-flow-planned' }], ...(config.after ? [config.after] : [])]);
  const daemon = await startHelmd({ port: 0, dataDir, driver, executorDriver: new FakeDriver(executors), codexDriver: config.codexDriver ?? new FakeDriver(verifiers) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '自动完成卡片' })).result.work;
  const events = async () => (await call('get-events', { workId: work.id })).result as any[];
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await until(events, values => values.some(event => event.action === 'round-ended' && event.details.finalAnswer === 'auto-flow-planned'));
  const cards = async () => (await call('get-card-graph', { workId: work.id })).result.filter((node: any) => node.type === 'card') as any[];
  const dispatches = async () => (await call('list-dispatches', { workId: work.id })).result as any[];
  return { ...daemon, call, work, events, cards, dispatches, repo, dataDir };
}

test('自动流程派齐验收期间不开调度轮次，全部通过后合并卡片，下游新就绪时唤醒一轮', async t => {
  const execute = hold(); const verify = hold(); const busy = hold();
  t.after(() => { execute.release(); verify.release(); busy.release(); });
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [card(), card('downstream', flow(0), false),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'card').id }, downstream: { type: 'card', id: saved(ctx, 'downstream').id } }), check: ok },
    card('busy', flow(0), false), dispatch(), dispatch('busy'),
  ], [[{ type: 'hang', until: execute.promise }, { type: 'write', path: 'result.txt', content: 'implemented\n' }, conclusion('completed')],
    [{ type: 'hang', until: busy.promise }]], [[conclusion('passed')], [{ type: 'hang', until: verify.promise }, conclusion('passed')]], {
    after: ctx => { brief = JSON.parse(ctx.input); return []; },
  });
  const original = (await daemon.cards()).find(card => card.key === 'card');
  execute.release();
  const votes = await until(daemon.dispatches, values => values.filter(item => item.purpose === 'verification').length === 2 && values.some(item => item.conclusion === 'passed'));
  const execution = votes.find(item => item.key === 'run-card');
  const verifications = votes.filter(item => item.purpose === 'verification');
  assert.deepEqual(verifications.map(item => item.key), [0, 1].map(index => `auto-verify-${execution.id}-${index}`));
  assert.deepEqual(verifications.map(item => item.agentId), ['codex-executor', 'codex-executor']);
  assert.deepEqual(verifications.map(item => item.needsBrowser), [false, false]);
  for (const [index, vote] of verifications.entries()) assert.match((await daemon.call('get-dispatch', { workId: daemon.work.id, dispatchId: vote.id })).result.content, new RegExp(`角度 ${index}：重跑 npm test`));
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  assert.equal(brief, undefined);
  verify.release();
  await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  const cards = await daemon.cards();
  assert.equal(cards.find(card => card.key === 'card').status, 'completed');
  assert.equal(cards.find(card => card.key === 'downstream').status, 'ready');
  assert.equal((await daemon.dispatches()).find(item => item.key === 'run-busy').status, 'running');
  const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
  assert.equal(git(daemon.repo, 'show', `${work.workBranch}:result.txt`), 'implemented');
  assert.equal(existsSync(original.workPath), false);
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${original.cardBranch}`), '');
  assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['card-completed']);
  assert.equal(brief!.newEvents.filter(event => event.action === 'dispatch-created' && event.actor.type === 'runtime').length, 2);
  assert.equal(brief!.wakeEvents[0]!.actor.type, 'runtime');
  assert.equal((await daemon.events()).some(event => event.action === 'auto-flow-stopped'), false);
});

for (const result of ['failed', 'undeclared', 'error']) test(`自动流程验收 ${result} 时不完成，只在整批结束后唤醒`, async t => {
  const execute = hold(); const verify = hold();
  t.after(() => { execute.release(); verify.release(); });
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [card(), dispatch()], [[{ type: 'hang', until: execute.promise }, conclusion('completed')]], [
    result === 'undeclared' ? [] : [conclusion(result === 'error' ? 'passed' : result), ...(result === 'error' ? [{ type: 'end', reason: 'error' } as FakeStep] : [])],
    [{ type: 'hang', until: verify.promise }, conclusion('passed')],
  ], { after: ctx => { brief = JSON.parse(ctx.input); return []; } });
  execute.release();
  await until(daemon.dispatches, values => values.some(item => item.purpose === 'verification' && item.status === 'ended'));
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  verify.release();
  await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  assert.notEqual((await daemon.cards())[0].status, 'completed');
  assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['dispatch-ended']);
  assert.equal((await daemon.events()).some(event => event.action === 'auto-flow-stopped'), false);
});

test('自动流程的 Agent 不可用时记录 verify 停止原因并唤醒，建卡时不检查 Agent', async t => {
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [card('card', flow(1)), dispatch()], [[conclusion('completed')]], [], {
    codexDriver: new FakeDriver([], () => ({ available: false, reason: '请登录 Codex' })),
    after: ctx => { brief = JSON.parse(ctx.input); return []; },
  });
  const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  const stopped = events.find(event => event.action === 'auto-flow-stopped');
  assert.deepEqual(stopped.actor, { type: 'runtime', id: 'helmd' });
  assert.deepEqual(stopped.object, { type: 'card', id: (await daemon.cards())[0].id });
  assert.equal(stopped.details.step, 'verify');
  assert.equal(stopped.details.code, 'AGENT_UNAVAILABLE');
  assert.match(stopped.details.reason, /请登录 Codex/);
  assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['auto-flow-stopped']);
  assert.equal((await daemon.dispatches()).length, 1);
});

for (const downstream of [false, true]) test(`不需验收的自动流程完成后${downstream ? '有其他活动派单不唤醒' : '无活动派单则唤醒'}`, async t => {
  const execute = hold(); const busy = hold();
  t.after(() => { execute.release(); busy.release(); });
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [card('card', flow(0), false), dispatch(), ...(downstream ? [card('busy', flow(0), false), dispatch('busy')] : [])], [
    [{ type: 'hang', until: execute.promise }, conclusion('completed')], [{ type: 'hang', until: busy.promise }],
  ], [], { after: ctx => { brief = JSON.parse(ctx.input); return []; } });
  execute.release();
  await until(daemon.cards, cards => cards.find(card => card.key === 'card').status === 'completed');
  if (downstream) {
    assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
    assert.equal(brief, undefined);
  } else {
    await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
    assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['card-completed']);
  }
  assert.equal((await daemon.dispatches()).some(item => item.purpose === 'verification'), false);
});

for (const mode of ['no-flow', 'manual-verification', 'blocked', 'undeclared', 'error']) test(`自动流程保留调度者判断路径：${mode}`, async t => {
  const automatic = mode === 'no-flow' ? undefined : flow(0);
  const create: FakeStep = mode === 'no-flow'
    ? { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '手动卡片' }), saveAs: 'card', check: ok }
    : card('card', automatic, mode === 'manual-verification');
  let brief: StartupBrief | undefined;
  const daemon = await fixture(t, [create, dispatch()], [mode === 'undeclared' ? [] : [conclusion(mode === 'blocked' ? 'blocked' : 'completed'),
    ...(mode === 'error' ? [{ type: 'end', reason: 'error' } as FakeStep] : [])]], [], {
    after: ctx => { brief = JSON.parse(ctx.input); return []; },
  });
  await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  assert.notEqual((await daemon.cards())[0].status, 'completed');
  assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['dispatch-ended']);
  assert.equal((await daemon.dispatches()).length, 1);
});

test('autoFlow 设置、保留、清除、幂等及终态保护，非法验收配置返回 AUTO_FLOW_INVALID', async t => {
  const update = (params: object, check: (value: any) => void = ok): FakeStep => ({ type: 'tool', name: 'update-card',
    arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, ...params }), check });
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'invalid', content: '非法', autoFlow: flow(1) }), check: code('AUTO_FLOW_INVALID') },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'empty', content: '非法', needsVerification: true,
      autoFlow: { verifications: [{ agentId: 'missing', content: '  ' }] } }), check: code('AUTO_FLOW_INVALID') },
    card(), update({ autoFlow: flow(1) }, value => { ok(value); assert.deepEqual(value.result.autoFlow, flow(1)); }),
    update({ autoFlow: flow(1) }), update({ content: '保留自动流程' }, value => { ok(value); assert.deepEqual(value.result.autoFlow, flow(1)); }),
    update({ needsVerification: false }, code('AUTO_FLOW_INVALID')),
    update({ autoFlow: null, needsVerification: false }, value => { ok(value); assert.equal(value.result.autoFlow, null); }),
    update({ autoFlow: flow(1) }, code('AUTO_FLOW_INVALID')),
    update({ autoFlow: flow(0) }, value => { ok(value); assert.deepEqual(value.result.autoFlow, flow(0)); }),
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, reason: '停止' }), check: ok },
    update({ autoFlow: null }, code('TERMINAL_CARD')),
  ], []);
  const events = await daemon.events();
  assert.equal(events.filter(event => event.action === 'card-updated').length, 4);
  assert.deepEqual((await daemon.cards())[0].autoFlow, flow(0));
});

test('自动完成失败记录 complete 步骤和错误码并唤醒；完成卡片禁止修改 autoFlow', async t => {
  for (const dirty of [true, false]) await t.test(dirty ? 'WORK_COPY_DIRTY' : 'TERMINAL_CARD', async t => {
    const execute = hold();
    t.after(() => execute.release());
    let brief: StartupBrief | undefined;
    const daemon = await fixture(t, [card('card', flow(0), false), dispatch()], [[{ type: 'hang', until: execute.promise }, conclusion('completed')]], [], {
      after: ctx => {
        brief = JSON.parse(ctx.input);
        return dirty ? [] : [{ type: 'tool', name: 'update-card', arguments: { workId: brief!.work.id,
          cardId: brief!.cardGraph.find(node => node.type === 'card')!.id, autoFlow: null }, check: code('TERMINAL_CARD') }];
      },
    });
    if (dirty) {
      const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
      await writeFile(join(work.workPath, 'dirty.txt'), 'uncommitted\n');
    }
    execute.release();
    const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
    if (dirty) {
      const stopped = events.find(event => event.action === 'auto-flow-stopped');
      assert.equal(stopped.details.step, 'complete');
      assert.equal(stopped.details.code, 'WORK_COPY_DIRTY');
      assert.deepEqual(brief!.wakeEvents.map(event => event.action), ['auto-flow-stopped']);
      assert.notEqual((await daemon.cards())[0].status, 'completed');
    } else assert.equal((await daemon.cards())[0].status, 'completed');
  });
});

test('自动验收异步检查 Agent 时先创建整批，避免首票提前完成卡片', async t => {
  const execute = hold(); const probe = hold();
  t.after(() => { execute.release(); probe.release(); });
  let probes = 0;
  let delaying = false;
  const verifier = new FakeDriver([[conclusion('passed')], [conclusion('failed')]], async () => {
    if (delaying && ++probes === 2) await probe.promise;
    return { available: true };
  });
  const daemon = await fixture(t, [card(), dispatch()], [[{ type: 'hang', until: execute.promise }, conclusion('completed')]], [], { codexDriver: verifier });
  delaying = true;
  execute.release();
  await until(async () => probes, count => count === 2);
  const partial = await daemon.dispatches();
  assert.equal(partial.filter(item => item.purpose === 'verification').length, 1);
  assert.equal(partial.find(item => item.purpose === 'verification').status, 'queued');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length, 2);
  probe.release();
  await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  assert.notEqual((await daemon.cards())[0].status, 'completed');
  assert.equal((await daemon.dispatches()).filter(item => item.purpose === 'verification' && item.status === 'ended').length, 2);
});

test('重启对账为跳过唤醒但自动步骤未完成的卡片补唤醒，已处理或活动卡片不重复唤醒', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-auto-reconcile-')));
  const dataDir = join(directory, 'data');
  let store = new TaskStore(dataDir, new AgentCatalog(fixtureAgentDir));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', ?, '2026-10-31')").run(directory);
  const expected: number[] = [];
  for (const scenario of ['interrupted', 'paused-card', 'already-woken', 'no-flow', 'active', 'completed', 'cancelled', 'paused-work', 'awaiting-review', 'new-dispatch', 'stopped']) {
    const status = scenario === 'paused-work' ? 'paused' : scenario === 'awaiting-review' ? 'awaiting-review' : 'executing';
    store.db.prepare("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES (?, 'p', ?, ?, '2026-10-31')").run(scenario, status, scenario);
    // Create while executing, then restore the work state being recovered.
    store.db.prepare("UPDATE works SET status = 'executing' WHERE id = ?").run(scenario);
    const card = store.transaction(() => createCard(store, { type: 'runtime', id: 'test' }, { workId: scenario, key: 'card', content: scenario,
      readOnly: true, ...(scenario !== 'no-flow' ? { autoFlow: flow(0) } : {}) }));
    store.db.prepare('UPDATE works SET status = ? WHERE id = ?').run(status, scenario);
    store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path, end_reason, conclusion)
      VALUES (?, ?, ?, 'run', 'execution', 'claude-executor', '{}', '执行', 'ended', '2026-10-31', ?, 'completed', 'completed')`)
      .run(scenario, scenario, card.id, join(directory, scenario));
    store.db.prepare('UPDATE cards SET latest_dispatch_id = ?, status = ? WHERE id = ?')
      .run(scenario, ['completed', 'cancelled'].includes(scenario) ? scenario : scenario === 'paused-card' ? 'paused' : 'executing', card.id);
    const event = store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: scenario }, 'dispatch-ended', {},
      { workId: scenario, cardId: card.id, dispatchId: scenario }));
    if (['interrupted', 'paused-card', 'already-woken'].includes(scenario)) expected.push(event.id);
    if (scenario === 'already-woken') store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, scenario);
    if (scenario === 'active') store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path)
      VALUES ('queued', ?, ?, 'next', 'verification', 'claude-executor', '{}', '验收', 'queued', '2026-10-31', ?)`)
      .run(scenario, card.id, join(directory, 'queued'));
    if (['completed', 'new-dispatch', 'stopped'].includes(scenario)) store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'card', id: card.id },
      scenario === 'completed' ? 'card-completed' : scenario === 'new-dispatch' ? 'dispatch-created' : 'auto-flow-stopped', {}, { workId: scenario, cardId: card.id }));
  }
  assert.equal(store.db.prepare('SELECT COUNT(*) AS count FROM wake_queue').get()!.count, 1);
  store.close();
  store = new TaskStore(dataDir, new AgentCatalog(fixtureAgentDir));
  await reconcileStartup(store);
  assert.deepEqual(store.db.prepare('SELECT event_id FROM wake_queue ORDER BY event_id').all().map(row => row.event_id), expected);
  await reconcileStartup(store);
  assert.deepEqual(store.db.prepare('SELECT event_id FROM wake_queue ORDER BY event_id').all().map(row => row.event_id), expected);
  assert.equal(store.events({}).some(event => event.action === 'auto-flow-stopped' && !['stopped'].includes(event.workId!)), false);
});

for (const changed of [false, true]) test(`自动完成只统计当前提交的全部验收票：旧 failed ${changed ? '已过期' : '仍有效'}`, async t => {
  const daemon = await fixture(t, [card('card', flow(1)), dispatch()], [
    [{ type: 'write', path: 'result.txt', content: 'first\n' }, conclusion('completed')],
    [...(changed ? [{ type: 'write', path: 'result.txt', content: 'second\n' } as FakeStep] : []), conclusion('completed')],
  ], [[conclusion('failed')], [conclusion('passed')]], {
    after: ctx => {
      const brief = JSON.parse(ctx.input) as StartupBrief;
      return [{ type: 'tool', name: 'create-dispatch', arguments: { workId: brief.work.id,
        cardId: brief.cardGraph.find(node => node.type === 'card')!.id, key: 'retry', agentId: 'claude-executor' }, check: ok }];
    },
  });
  await until(daemon.events, values => values.filter(event => event.action === 'dispatch-ended').length === 4
    && values.filter(event => event.action === 'round-ended').length === 4);
  const votes = (await daemon.dispatches()).filter(item => item.purpose === 'verification');
  assert.equal(votes[0].outdated, changed);
  assert.equal(votes[1].outdated, false);
  assert.equal((await daemon.cards())[0].status === 'completed', changed);
});

test('空自动验收列表由调度者派票，手动派出的验收通过后仍自动完成', async t => {
  const daemon = await fixture(t, [card('card', flow(0)), dispatch()], [[conclusion('completed')]], [[conclusion('passed')]], {
    after: ctx => {
      const brief = JSON.parse(ctx.input) as StartupBrief;
      assert.deepEqual(brief.wakeEvents.map(event => event.action), ['dispatch-ended']);
      return [{ type: 'tool', name: 'create-dispatch', arguments: { workId: brief.work.id,
        cardId: brief.cardGraph.find(node => node.type === 'card')!.id, key: 'manual-vote', agentId: 'codex-executor', purpose: 'verification' }, check: ok }];
    },
  });
  await until(daemon.cards, cards => cards[0].status === 'completed');
  const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 4);
  assert.equal(events.some(event => event.action === 'dispatch-created' && event.actor.type === 'runtime'), false);
});

for (const operation of ['pause-card', 'cancel-card', 'pause-work']) test(`自动流程不会推进 ${operation} 后的卡片`, async t => {
  const execute = hold();
  t.after(() => execute.release());
  const daemon = await fixture(t, [card('card', flow(1)), dispatch()], [[{ type: 'hang', until: execute.promise }, conclusion('completed')]]);
  await until(daemon.dispatches, values => values[0]?.status === 'running');
  const target = (await daemon.cards())[0];
  ok(await daemon.call(operation, { workId: daemon.work.id, ...(operation !== 'pause-work' ? { cardId: target.id } : {}),
    ...(operation === 'cancel-card' ? { reason: '取消自动流程' } : {}) }));
  execute.release();
  await until(daemon.dispatches, values => values[0].status === 'ended');
  assert.equal((await daemon.dispatches()).length, 1);
  assert.notEqual((await daemon.cards())[0].status, 'completed');
  assert.equal((await daemon.events()).some(event => event.action === 'auto-flow-stopped'), false);
});

test('自动验收部分创建失败后，已有票通过仍交回调度者，不提前完成', async t => {
  const verify = hold();
  t.after(() => verify.release());
  const autoFlow = flow();
  autoFlow.verifications[1]!.agentId = 'missing-agent';
  const daemon = await fixture(t, [card('card', autoFlow), dispatch()], [[conclusion('completed')]], [
    [{ type: 'hang', until: verify.promise }, conclusion('passed')],
  ]);
  const stopped = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 3);
  assert.equal(stopped.find(event => event.action === 'auto-flow-stopped').details.step, 'verify');
  assert.equal((await daemon.dispatches()).filter(item => item.purpose === 'verification').length, 1);
  verify.release();
  await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 4);
  assert.notEqual((await daemon.cards())[0].status, 'completed');
});

test('自动完成状态、事件和必要唤醒在同一事务提交，完成后退出不会漏唤醒', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-auto-complete-')));
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('p', 'project', ?, '2026-10-31')").run(directory);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('w', 'p', 'executing', 'work', '2026-10-31')");
  const runtime = { type: 'runtime', id: 'helmd' } as const;
  const card = store.transaction(() => createCard(store, runtime, { workId: 'w', key: 'card', content: '只读成果', readOnly: true, autoFlow: flow(0) }));
  const next = store.transaction(() => createCard(store, runtime, { workId: 'w', key: 'next', content: '下游' }));
  store.transaction(() => addDependency(store, runtime, { workId: 'w', upstream: { type: 'card', id: card.id }, downstream: { type: 'card', id: next.id } }));
  store.db.prepare(`INSERT INTO dispatches (id, work_id, card_id, key, purpose, agent_id, agent_snapshot, content, status, created_at, output_path, end_reason, conclusion)
    VALUES ('ended', 'w', ?, 'run', 'execution', 'claude-executor', '{}', '执行', 'ended', '2026-10-31', ?, 'completed', 'completed')`)
    .run(card.id, join(directory, 'output'));
  let observed = false;
  store.subscribe(events => {
    const event = events.find(event => event.action === 'card-completed');
    if (!event) return;
    observed = true;
    assert.equal(store.db.prepare('SELECT event_id FROM wake_queue WHERE event_id = ?').get(event.id)!.event_id, event.id);
    assert.equal(store.db.prepare('SELECT status FROM cards WHERE id = ?').get(next.id)!.status, 'ready');
  });
  assert.equal(completeCard(store, runtime, { workId: 'w', cardId: card.id }).status, 'completed');
  assert.equal(observed, true);
});
