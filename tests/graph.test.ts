import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';

const workIdOf = (ctx: FakeContext) => (JSON.parse(ctx.input) as StartupBrief).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待外部状态超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

async function fixture(t: TestContext, script: FakeStep[], after?: FakeScript) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-graph-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  const daemon = await startHelmd({ port: 0, dataDir, driver: new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '卡片图', boundary: '本机', criteria: '依赖约束成立' }), check: ok },
  ], [...script, { type: 'end', reason: 'completed', finalAnswer: 'graph-script-finished' }], ...(after ? [after] : [])]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '创建卡片图' })).result.work;
  const events = async () => (await call('get-events', { workId: work.id })).result as any[];
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const finished = async () => {
    const values = await until(events, values => values.filter(event => event.action === 'round-ended').length >= 2);
    const end = values.filter(event => event.action === 'round-ended')[1];
    assert.equal(end.details.finalAnswer, 'graph-script-finished', JSON.stringify(end.details));
    return values;
  };
  return { ...daemon, call, work, gate, events, finished, dataDir, project };
}

test('调度者建卡和改卡按 key 去重，内容和验收标记可读；自己建的卡片不唤醒下一轮，下一轮简报含卡片图', async t => {
  let nextBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'logic', content: '游戏逻辑', needsVerification: true }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'logic', content: '不能覆盖原卡片' }), check: result => { ok(result); assert.equal((result as any).result.content, '游戏逻辑'); } },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '游戏逻辑和重开', needsVerification: false }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '游戏逻辑和重开', needsVerification: false }), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id }), check: result => { ok(result); assert.equal((result as any).result.needsVerification, false); } },
  ], ctx => { nextBrief = JSON.parse(ctx.input); return []; });
  const events = await daemon.finished();
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  assert.equal(graph.filter((node: any) => node.type === 'card').length, 1);
  const card = graph.find((node: any) => node.type === 'card');
  assert.equal(card.content, '游戏逻辑和重开');
  assert.equal(card.status, 'ready');
  assert.equal(card.needsVerification, false);
  assert.deepEqual(card.dependencies, []);
  assert.equal(graph.find((node: any) => node.type === 'gate').id, daemon.gate.id);
  assert.equal(events.filter(event => event.action === 'card-created').length, 1);
  assert.equal(events.filter(event => event.action === 'card-updated').length, 1);
  // card-ready is recorded but does not wake; with nothing dispatched the work stalls until the user writes.
  const stalled = await until(daemon.events, values => values.some(event => event.action === 'work-stalled'));
  assert.ok(stalled.some(event => event.action === 'card-ready' && event.cardId === card.id));
  assert.equal(nextBrief, undefined);
  ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'wake', body: '继续' }));
  await until(async () => nextBrief, brief => brief !== undefined);
  assert.equal((nextBrief!.cardGraph.find((node: any) => node.type === 'card') as any).id, card.id);
  assert.deepEqual(nextBrief!.wakeEvents.map(event => event.action), ['message-sent']);
  assert.equal((await daemon.call('create-card', { workId: daemon.work.id, key: 'user', content: '用户不能建卡' })).error.code, 'FORBIDDEN');
});

test('写入范围规范化后保存，没有依赖的卡片范围重叠时只提示；执行中无事可做的轮次结束后提示用户工作停住', async t => {
  const card = (ctx: FakeContext, key: string, writeScopes: string[]) => ({ workId: workIdOf(ctx), key, content: key, writeScopes });
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => card(ctx, 'api', ['./src/api/', 'src/api']), saveAs: 'api', check: value => { ok(value); assert.deepEqual((value as any).result.writeScopes, ['src/api']); } },
    { type: 'tool', name: 'create-card', arguments: ctx => card(ctx, 'user', ['src/api/user.ts']), saveAs: 'user', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => card(ctx, 'docs', ['docs']), saveAs: 'docs', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => card(ctx, 'after-api', ['src/api']), saveAs: 'after', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'api').id }, downstream: { type: 'card', id: saved(ctx, 'after').id } }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'docs').id, writeScopes: ['docs', 'src/api/routes'] }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => card(ctx, 'escape', ['../outside']), check: value => assert.equal((value as any).error.code, 'INVALID_WRITE_SCOPE') },
  ]);
  await daemon.finished();
  const cards = new Map((await daemon.call('get-card-graph', { workId: daemon.work.id })).result
    .filter((node: any) => node.type === 'card').map((node: any) => [node.key, node]));
  const warned = (key: string) => (cards.get(key) as any).writeScopeWarnings.map((text: string) => text.match(/卡片 (\S+)（/)![1]).sort();
  assert.deepEqual(warned('api'), ['docs', 'user']);
  assert.deepEqual(warned('user'), ['after-api', 'api']);
  assert.deepEqual(warned('after-api'), ['docs', 'user']);
  assert.deepEqual((cards.get('docs') as any).writeScopes, ['docs', 'src/api/routes']);
  const events = await until(daemon.events, values => values.some(event => event.action === 'work-stalled'));
  assert.equal(events.filter(event => event.action === 'work-stalled').length, 1);
  assert.ok(events.some(event => event.action === 'needs-user-attention' && event.details.kind === 'work-stalled'));
  const conversation = (await daemon.call('get-conversation', { workId: daemon.work.id })).result;
  assert.ok(conversation.some((item: any) => item.sender === 'runtime' && item.body.includes('发一条消息即可唤醒调度者')));
});

test('一般关卡支持 key 去重、修改历史和用户选项或自由回答，调度者不能代答或撤回固定关卡', async t => {
  let chosenGateId = '';
  let freeGateId = '';
  const daemon = await fixture(t, [
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'choice', question: '选哪种存档？', body: '请作决定', options: ['本地', '云端'] }), saveAs: 'gate', check: value => { ok(value); chosenGateId = (value as any).result.id; } },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'choice', question: '重试不覆盖' }), check: value => { ok(value); assert.equal((value as any).result.question, '选哪种存档？'); } },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, question: '第一版选哪种存档？', body: '只支持一种', options: ['本地', '云端', '不存档'] }), check: ok },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, question: '第一版选哪种存档？', body: '只支持一种', options: ['本地', '云端', '不存档'] }), check: ok },
    { type: 'tool', name: 'decide-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, decision: '本地' }), check: value => assert.equal((value as any).error.code, 'FORBIDDEN') },
    { type: 'tool', name: 'get-gate-history', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id }), check: value => { ok(value); assert.deepEqual((value as any).result.map((event: any) => event.action), ['gate-created', 'gate-updated']); } },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: ((JSON.parse(ctx.input) as StartupBrief).cardGraph.find((node: any) => node.kind === 'work-confirmation') as any).id, reason: '不能撤回' }), check: value => assert.equal((value as any).error.code, 'FIXED_GATE') },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'free', question: '需要怎样的行为？' }), check: value => { ok(value); freeGateId = (value as any).result.id; } },
  ]);
  const events = await daemon.finished();
  const pending = (await daemon.call('list-pending')).result;
  assert.equal(pending.length, 2);
  const choice = pending.find((gate: any) => gate.id === chosenGateId);
  assert.equal(choice.body, '只支持一种');
  assert.deepEqual(choice.options, ['本地', '云端', '不存档']);
  assert.equal(choice.creator.type, 'coordinator-round');
  assert.equal(choice.status, 'pending');
  assert.equal(events.filter(event => event.action === 'needs-user-attention' && event.details.kind === 'general').length, 2);
  assert.ok(!events.some(event => event.action === 'work-stalled'), '有待决定的关卡时不算停住');
  const decide = { workId: daemon.work.id, gateId: chosenGateId, decision: '本地' };
  const chosen = await daemon.call('decide-gate', decide);
  ok(chosen);
  assert.equal(chosen.result.status, 'decided');
  assert.equal(chosen.result.decision, '本地');
  assert.deepEqual((await daemon.call('decide-gate', decide)).result, chosen.result);
  assert.equal((await daemon.call('decide-gate', { ...decide, decision: '云端' })).error.code, 'GATE_DECIDED');
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: freeGateId, decision: '先只做本地存储，暂时不做账户' }));
  assert.equal((await daemon.call('list-pending')).result.length, 0);
  const history = (await daemon.call('get-gate-history', { workId: daemon.work.id, gateId: chosenGateId })).result;
  assert.deepEqual(history.map((event: any) => event.action), ['gate-created', 'gate-updated', 'gate-decided']);
  assert.equal(history[1].details.before.question, '选哪种存档？');
  assert.equal(history[1].details.after.question, '第一版选哪种存档？');
  assert.equal(history[1].details.before.body, '请作决定');
  assert.equal(history[1].details.after.body, '只支持一种');
  const conversation = (await daemon.call('get-conversation', { workId: daemon.work.id })).result;
  const node = conversation.find((item: any) => item.id === chosenGateId);
  assert.equal(node.body, '只支持一种');
  assert.equal(node.decision, '本地');
});

test('依赖阻塞卡片、拒绝成环，删边后解除阻塞；关卡的决定解除后续卡片阻塞', async t => {
  let gateId = '';
  let downstreamId = '';
  const node = (ctx: FakeContext, key: string, type: 'card' | 'gate' = 'card') => ({ type, id: saved(ctx, key).id });
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'upstream', content: '存储' }), saveAs: 'upstream', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'downstream', content: '渲染' }), saveAs: 'downstream', check: value => { ok(value); downstreamId = (value as any).result.id; } },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'downstream').id }), check: value => assert.equal((value as any).result.status, 'waiting') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'downstream'), downstream: node(ctx, 'upstream') }), check: value => assert.equal((value as any).error.code, 'DEPENDENCY_CYCLE') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'upstream') }), check: value => assert.equal((value as any).error.code, 'DEPENDENCY_CYCLE') },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'storage', question: '选择存储', options: ['本地', '云端'] }), saveAs: 'gate', check: value => { ok(value); gateId = (value as any).result.id; } },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'remove-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'downstream').id }), check: value => assert.equal((value as any).result.status, 'waiting') },
    { type: 'tool', name: 'remove-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'remove-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'downstream').id }), check: value => assert.equal((value as any).result.status, 'ready') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'downstream'), downstream: node(ctx, 'gate', 'gate') }), check: value => assert.equal((value as any).error.code, 'DEPENDENCY_CYCLE') },
  ]);
  const events = await daemon.finished();
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  assert.deepEqual(graph.find((item: any) => item.id === downstreamId).dependencies, [{ type: 'gate', id: gateId }]);
  assert.equal(events.filter(event => event.action === 'dependency-removed').length, 2);
  assert.equal(events.filter(event => event.action === 'dependency-added').length, 3);
  assert.ok(events.filter(event => event.action === 'operation-rejected').every(event => event.details.allowedOperations.includes('remove-dependency')));
  const decide = await daemon.call('decide-gate', { workId: daemon.work.id, gateId, decision: '本地' });
  ok(decide);
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: downstreamId })).result;
  assert.equal(card.status, 'ready');
  const after = await daemon.events();
  assert.ok(after.some(event => event.action === 'card-ready' && event.cardId === downstreamId && event.id > events.at(-1).id));
});

test('取消上游和撤回关卡使下游持续阻塞、保留依赖并唤醒调度者，终态卡片不可修改或添加依赖', async t => {
  let nextBrief: StartupBrief | undefined;
  let cancelledId = '';
  let withdrawnId = '';
  const node = (ctx: FakeContext, key: string, type: 'card' | 'gate' = 'card') => ({ type, id: saved(ctx, key).id });
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'upstream', content: '上游' }), saveAs: 'upstream', check: value => { ok(value); cancelledId = (value as any).result.id; } },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'downstream', content: '下游' }), saveAs: 'downstream', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'leaf', content: '再下游' }), saveAs: 'leaf', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'gate-child', content: '只依赖关卡' }), saveAs: 'gate-child', check: ok },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'decision', question: '需要确认' }), saveAs: 'gate', check: value => { ok(value); withdrawnId = (value as any).result.id; } },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'downstream') }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'downstream'), downstream: node(ctx, 'leaf') }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'leaf') }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'gate-child') }), check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'upstream').id, reason: '方向改变' }), check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'upstream').id, reason: '方向改变' }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'upstream').id, content: '终态不能改', needsVerification: true }), check: value => assert.equal((value as any).error.code, 'TERMINAL_CARD') },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'upstream', content: '终态重试仍是原卡片' }), check: value => assert.equal((value as any).result.status, 'cancelled') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'leaf'), downstream: node(ctx, 'upstream') }), check: value => assert.equal((value as any).error.code, 'TERMINAL_CARD') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'upstream'), downstream: node(ctx, 'leaf') }), check: value => assert.equal((value as any).error.code, 'INACTIVE_UPSTREAM') },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, reason: '问题改了，稍后重新提出' }), check: ok },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, reason: '问题改了，稍后重新提出' }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: value => assert.equal((value as any).error.code, 'INACTIVE_UPSTREAM') },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, body: '不能再改' }), check: value => assert.equal((value as any).error.code, 'GATE_CLOSED') },
  ], ctx => { nextBrief = JSON.parse(ctx.input); return []; });
  const events = await daemon.finished();
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  assert.equal(graph.find((node: any) => node.key === 'downstream').status, 'waiting');
  assert.equal(graph.find((node: any) => node.key === 'leaf').status, 'waiting');
  assert.equal(graph.find((node: any) => node.key === 'gate-child').status, 'waiting');
  assert.equal(graph.find((node: any) => node.key === 'upstream').status, 'cancelled');
  assert.equal(graph.find((node: any) => node.key === 'decision').status, 'withdrawn');
  assert.deepEqual(graph.find((node: any) => node.key === 'downstream').dependencies, [{ type: 'card', id: cancelledId }]);
  assert.ok(graph.find((node: any) => node.key === 'leaf').dependencies.some((node: any) => node.type === 'gate' && node.id === withdrawnId));
  assert.equal(events.filter(event => event.action === 'card-cancelled').length, 1);
  assert.equal(events.filter(event => event.action === 'gate-withdrawn').length, 1);
  await until(async () => nextBrief, brief => brief !== undefined);
  assert.ok(nextBrief!.wakeEvents.some(event => event.action === 'card-cancelled'));
  assert.ok(nextBrief!.wakeEvents.some(event => event.action === 'gate-withdrawn'));
  assert.equal((await daemon.call('decide-gate', { workId: daemon.work.id, gateId: withdrawnId, decision: '继续' })).error.code, 'GATE_WITHDRAWN');
});

test('依赖的两端都不能引用其他工作的节点，拒绝后原图不变', async t => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let otherGateId = '';
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '自己的卡片' }), saveAs: 'card', check: ok },
    { type: 'hang', until: barrier },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: otherGateId }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: value => assert.equal((value as any).error.code, 'CROSS_WORK_DEPENDENCY') },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'card', id: saved(ctx, 'card').id }, downstream: { type: 'gate', id: otherGateId } }), check: value => assert.equal((value as any).error.code, 'CROSS_WORK_DEPENDENCY') },
    { type: 'tool', name: 'remove-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: otherGateId }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: value => assert.equal((value as any).error.code, 'CROSS_WORK_DEPENDENCY') },
    { type: 'tool', name: 'get-gate-history', arguments: ctx => ({ workId: workIdOf(ctx), gateId: otherGateId }), check: value => assert.equal((value as any).error.code, 'INVALID_GATE') },
  ]);
  const otherWork = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'other-work', body: '另一项工作' })).result.work;
  otherGateId = (await daemon.call('get-conversation', { workId: otherWork.id })).result.find((item: any) => item.type === 'gate').id;
  release();
  const events = await daemon.finished();
  assert.equal(events.filter(event => event.action === 'dependency-added').length, 0);
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  assert.ok(graph.every((node: any) => node.workId === daemon.work.id && node.dependencies.length === 0));
});

test('卡片图、依赖和关卡修改历史在 helmd 重启后仍可读', async t => {
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '保留卡片', needsVerification: true }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'gate', question: '保留关卡' }), saveAs: 'gate', check: ok },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, body: '保留修改历史' }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'gate').id }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: ok },
  ]);
  await daemon.finished();
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  const gateId = graph.find((node: any) => node.kind === 'general').id;
  const history = (await daemon.call('get-gate-history', { workId: daemon.work.id, gateId })).result;
  await daemon.close();
  const restarted = await startHelmd({ port: 0, dataDir: daemon.dataDir });
  try {
    const call = async (name: string, params: object) => (await (await fetch(`${restarted.url}/api/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
    })).json() as any).result;
    assert.deepEqual(await call('get-card-graph', { workId: daemon.work.id }), graph);
    assert.deepEqual(await call('get-gate-history', { workId: daemon.work.id, gateId }), history);
  } finally { await restarted.close(); }
});

test('关卡链的前置都满足后才放行卡片，修订工作说明的固定关卡也会重新推导状态', async t => {
  let releaseRevision!: () => void;
  const barrier = new Promise<void>(resolve => { releaseRevision = resolve; });
  let cardId = '';
  let firstGateId = '';
  let secondGateId = '';
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: '受关卡链阻塞的卡片' }), saveAs: 'card', check: value => { ok(value); cardId = (value as any).result.id; } },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'first', question: '第一项决定？' }), saveAs: 'first', check: value => { ok(value); firstGateId = (value as any).result.id; } },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'second', question: '第二项决定？' }), saveAs: 'second', check: value => { ok(value); secondGateId = (value as any).result.id; } },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'first').id }, downstream: { type: 'gate', id: saved(ctx, 'second').id } }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'second').id }, downstream: { type: 'card', id: saved(ctx, 'card').id } }), check: ok },
  ], ctx => [
    { type: 'hang', until: barrier },
    { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), key: 'revision', requirements: '修订后的卡片图', boundary: '本机', criteria: '链上的前置都满足' }, saveAs: 'revision', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'revision').gateId }, downstream: { type: 'card', id: cardId } }), check: ok },
    { type: 'tool', name: 'update-gate', arguments: { workId: workIdOf(ctx), gateId: firstGateId, body: '后续轮次继续修改同一调度者的关卡' }, check: ok },
    { type: 'end', reason: 'completed', finalAnswer: 'revision-ready' },
  ]);
  await daemon.finished();
  const card = async () => (await daemon.call('get-card', { workId: daemon.work.id, cardId })).result;
  // Deciding the later gate alone cannot bypass an undecided ancestor.
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: secondGateId, decision: '同意' }));
  assert.equal((await card()).status, 'waiting');
  releaseRevision();
  const revisionRound = await until(daemon.events, events => events.some(event => event.action === 'round-ended' && event.details.finalAnswer === 'revision-ready'));
  assert.ok(revisionRound.some(event => event.action === 'gate-updated'));
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: firstGateId, decision: '同意' }));
  assert.equal((await card()).status, 'waiting');
  const revision = (await daemon.call('list-pending')).result.find((gate: any) => gate.kind === 'work-confirmation');
  assert.equal(revision.description.version, 2);
  ok(await daemon.call('decide-gate', { workId: daemon.work.id, gateId: revision.id, descriptionId: revision.description.id, decision: 'confirm' }));
  assert.equal((await card()).status, 'ready');
});
