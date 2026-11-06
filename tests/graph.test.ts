import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';
import { reviewReport } from './fixtures/review-report.js';

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

async function fixture(t: TestContext, script: FakeStep[], after: FakeScript[] = [], aligning: FakeStep[] = []) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-graph-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const dataDir = join(directory, 'data');
  const daemon = await startHelmd({ port: 0, dataDir, driver: new FakeDriver([[
    ...aligning,
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '卡片图', boundary: '本机', criteria: '依赖约束成立', deliverables: '交付物及查看入口' }), check: ok },
  ], [...script, { type: 'end', reason: 'completed', finalAnswer: 'graph-script-finished' }], ...after]) });
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
  const gate = (await call('list-pending')).result.find((item: any) => item.kind === 'work-confirmation');
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const finished = async () => {
    const values = await until(events, values => values.filter(event => event.action === 'round-ended').length >= 2);
    const end = values.filter(event => event.action === 'round-ended')[1];
    assert.equal(end.details.finalAnswer, 'graph-script-finished', JSON.stringify(end.details));
    return values;
  };
  return { ...daemon, call, work, gate, events, finished, dataDir, project };
}

// Issue 30 item 3: medium regression. FakeDriver replaces the coordinator CLI.
test('调度者建卡和改卡按 key 去重，内容和验收标记可读；停滞提醒的下一轮简报含卡片图', async t => {
  let nextBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'logic', content: '游戏逻辑', needsVerification: true }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'logic', content: '不能覆盖原卡片' }), check: result => { ok(result); assert.equal((result as any).result.content, '游戏逻辑'); } },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '游戏逻辑和重开', needsVerification: false }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '游戏逻辑和重开', needsVerification: false }), check: ok },
    { type: 'tool', name: 'get-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id }), check: result => { ok(result); assert.equal((result as any).result.needsVerification, false); } },
  ], [ctx => { nextBrief = JSON.parse(ctx.input); return []; }]);
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
  // card-ready does not wake; the runtime nudge carries the next round.
  const stalled = await until(daemon.events, values => values.some(event => event.action === 'work-stalled'));
  assert.ok(stalled.some(event => event.action === 'card-ready' && event.cardId === card.id));
  assert.equal((nextBrief!.cardGraph.find((node: any) => node.type === 'card') as any).id, card.id);
  assert.deepEqual(nextBrief!.wakeEvents.map(event => event.action), ['work-stall-nudged']);
  assert.match((nextBrief!.wakeEvents[0]!.details as any).reason, /没有运行中的派单.*继续推进.*关卡/);
  assert.equal((await daemon.call('create-card', { workId: daemon.work.id, key: 'user', content: '用户不能建卡' })).error.code, 'FORBIDDEN');
});

// Issue 30 item 3: medium regression. A nudge round cannot nudge itself again.
test('写入范围规范化后保存，没有依赖的卡片范围重叠时只提示；提醒后仍停滞才通知用户且不再自动唤醒', async t => {
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
  assert.equal(events.filter(event => event.action === 'work-stall-nudged').length, 1);
  assert.equal(events.filter(event => event.action === 'work-stalled').length, 1);
  assert.equal(events.filter(event => event.action === 'needs-user-attention' && event.details.kind === 'work-stalled').length, 1);
  await new Promise(resolve => setTimeout(resolve, 100));
  const settled = await daemon.events();
  // One alignment round and two executing rounds; there must be no third executing round.
  assert.equal(settled.filter(event => event.action === 'round-started').length, 3);
  assert.equal(settled.filter(event => event.action === 'work-stall-nudged').length, 1);
  const conversation = (await daemon.call('get-conversation', { workId: daemon.work.id })).result;
  const notices = conversation.filter((item: any) => item.sender === 'runtime');
  assert.equal(notices.length, 1);
  assert.ok(notices[0].body.includes('发一条消息即可唤醒调度者'));
  assert.ok(notices[0].body.includes('已提醒过调度者一次'));
  assert.doesNotMatch(notices[0].body, /请继续推进/, '给调度者的指示不能出现在给用户的消息里');
});

// Issue 30 item 3: medium regression; the public event stream models idle -> nudged -> review.
test('全部卡片完成但漏发审核时自动唤醒，简报给出原因，补发审核后不通知用户停滞', async t => {
  let nudgeBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: { key: 'done', content: '完成工作', workspace: 'scratch' }, saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ cardId: saved(ctx, 'card').id, key: 'execute', agentId: 'claude-executor' }), check: ok },
  ], [ctx => [
    { type: 'tool', name: 'complete-card', arguments: { cardId: (JSON.parse(ctx.input) as StartupBrief).cardGraph.find(node => node.type === 'card')!.id }, check: ok },
  ], ctx => {
    nudgeBrief = JSON.parse(ctx.input);
    return [{ type: 'tool', name: 'request-review', arguments: { key: 'review', report: reviewReport() }, check: ok }];
  }]);
  const events = await until(daemon.events, values => values.filter(event => event.action === 'round-ended').length === 4);
  assert.equal(events.filter(event => event.action === 'card-completed').length, 1);
  const nudge = events.find(event => event.action === 'work-stall-nudged')!;
  assert.equal(events.filter(event => event.action === 'work-stall-nudged').length, 1);
  assert.ok(events.find(event => event.action === 'round-ended' && event.object.id === nudge.details.roundId)!.id < nudge.id);
  assert.deepEqual(nudgeBrief!.wakeEvents.map(event => event.action), ['work-stall-nudged']);
  assert.deepEqual(nudgeBrief!.wakeEvents[0]!.details, {
    reason: '全部卡片已结束，但工作没有进入审核：目标满足就发起审核；正在处理合入冲突就完成冲突处理；还有差距就继续派单', roundId: nudge.details.roundId,
  });
  assert.equal((await daemon.call('get-work', { workId: daemon.work.id })).result.status, 'awaiting-review');
  assert.equal(events.filter(event => event.action === 'work-stalled').length, 0);
  assert.equal(events.filter(event => event.action === 'needs-user-attention' && event.details.kind === 'work-stalled').length, 0);
  assert.ok(!(await daemon.call('get-conversation', { workId: daemon.work.id })).result.some((item: any) => item.sender === 'runtime'));
});

// Issue 30 item 3: medium regression; external wakes reset the opportunity to nudge.
test('用户发消息唤醒后再次停滞时可以再提醒调度者一次', async t => {
  let messageBrief: StartupBrief | undefined;
  let secondNudgeBrief: StartupBrief | undefined;
  const daemon = await fixture(t, [], [[], ctx => { messageBrief = JSON.parse(ctx.input); return []; },
    ctx => { secondNudgeBrief = JSON.parse(ctx.input); return []; }]);
  const read = () => daemon.events();
  const stalled = await until(read, values => values.some(event => event.action === 'work-stalled'));
  assert.equal(stalled.filter(event => event.action === 'work-stall-nudged').length, 1);
  ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'wake-again', body: '继续推进' }));
  const events = await until(read, values => values.filter(event => event.action === 'work-stalled').length === 2);
  assert.deepEqual(messageBrief!.wakeEvents.map(event => event.action), ['message-sent']);
  assert.deepEqual(secondNudgeBrief!.wakeEvents.map(event => event.action), ['work-stall-nudged']);
  assert.equal(events.filter(event => event.action === 'work-stall-nudged').length, 2);
  assert.equal(events.filter(event => event.action === 'needs-user-attention' && event.details.kind === 'work-stalled').length, 2);
  assert.equal(events.filter(event => event.action === 'round-started').length, 5);
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
  assert.ok(!events.some(event => event.action === 'work-stall-nudged'));
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

test('对齐中也能提一般关卡，多选标记可读可改，用户多选的回答原样保存', async t => {
  let gateId = '';
  const daemon = await fixture(t, [], undefined, [
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workIdOf(ctx), key: 'platforms', question: '要支持哪些平台？', options: ['macOS', 'Linux', 'Windows'], multiSelect: true }), check: value => { ok(value); gateId = (value as any).result.id; assert.equal((value as any).result.multiSelect, true); } },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId, multiSelect: false }), check: value => { ok(value); assert.equal((value as any).result.multiSelect, false); } },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId, multiSelect: true }), check: ok },
  ]);
  const gate = (await daemon.call('get-conversation', { workId: daemon.work.id })).result.find((item: any) => item.id === gateId);
  assert.equal(gate.multiSelect, true);
  assert.equal(gate.status, 'pending');
  const decided = await daemon.call('decide-gate', { workId: daemon.work.id, gateId, decision: 'macOS\nLinux' });
  ok(decided);
  assert.equal(decided.result.decision, 'macOS\nLinux');
  await daemon.finished();
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

test('取消上游和撤回关卡使下游级联跳过、保留依赖并在同轮简报列出致因，终态卡片不可修改或添加依赖', async t => {
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
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'leaf').id, key: 'skip-rejected', agentId: 'claude-executor' }), check: value => assert.equal((value as any).error.code, 'CARD_NOT_DISPATCHABLE') },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, reason: '问题改了，稍后重新提出' }), check: ok },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, reason: '问题改了，稍后重新提出' }), check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: node(ctx, 'gate', 'gate'), downstream: node(ctx, 'downstream') }), check: value => assert.equal((value as any).error.code, 'INACTIVE_UPSTREAM') },
    { type: 'tool', name: 'update-gate', arguments: ctx => ({ workId: workIdOf(ctx), gateId: saved(ctx, 'gate').id, body: '不能再改' }), check: value => assert.equal((value as any).error.code, 'GATE_CLOSED') },
  ], [ctx => { nextBrief = JSON.parse(ctx.input); return []; }]);
  const events = await daemon.finished();
  const graph = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result;
  assert.equal(graph.find((node: any) => node.key === 'downstream').status, 'skipped');
  assert.equal(graph.find((node: any) => node.key === 'leaf').status, 'skipped');
  assert.equal(graph.find((node: any) => node.key === 'gate-child').status, 'skipped');
  assert.equal(graph.find((node: any) => node.key === 'upstream').status, 'cancelled');
  assert.equal(graph.find((node: any) => node.key === 'decision').status, 'withdrawn');
  assert.deepEqual(graph.find((node: any) => node.key === 'downstream').dependencies, [{ type: 'card', id: cancelledId }]);
  assert.ok(graph.find((node: any) => node.key === 'leaf').dependencies.some((node: any) => node.type === 'gate' && node.id === withdrawnId));
  assert.equal(events.filter(event => event.action === 'card-cancelled').length, 1);
  assert.equal(events.filter(event => event.action === 'gate-withdrawn').length, 1);
  await until(async () => nextBrief, brief => brief !== undefined);
  assert.ok(nextBrief!.wakeEvents.some(event => event.action === 'card-cancelled'));
  assert.ok(nextBrief!.wakeEvents.some(event => event.action === 'gate-withdrawn'));
  assert.equal(nextBrief!.newEvents.filter(event => event.action === 'card-skipped').length, 3);
  const skipped = events.find(event => event.action === 'card-skipped' && event.cardId === graph.find((node: any) => node.key === 'downstream').id);
  assert.deepEqual(skipped.details.upstream, [{ type: 'card', id: cancelledId, status: 'cancelled' }]);
  assert.deepEqual(skipped.details.skippedBy, [{ type: 'card', id: cancelledId, status: 'cancelled', title: '上游' }]);
  assert.ok(!events.some(event => event.action === 'work-stalled'));
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
  ], [ctx => [
    { type: 'hang', until: barrier },
    { type: 'tool', name: 'draft-work-description', arguments: { workId: workIdOf(ctx), key: 'revision', requirements: '修订后的卡片图', boundary: '本机', criteria: '链上的前置都满足', deliverables: '交付物及查看入口' }, saveAs: 'revision', check: ok },
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workIdOf(ctx), upstream: { type: 'gate', id: saved(ctx, 'revision').gateId }, downstream: { type: 'card', id: cardId } }), check: ok },
    { type: 'tool', name: 'update-gate', arguments: { workId: workIdOf(ctx), gateId: firstGateId, body: '后续轮次继续修改同一调度者的关卡' }, check: ok },
    { type: 'end', reason: 'completed', finalAnswer: 'revision-ready' },
  ]]);
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


test('create-card 和 update-card 选择运行位置，默认 copy 且省略时保留', async t => {
  const daemon = await fixture(t, [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'research', content: '调研', workspace: 'scratch' }), saveAs: 'card', check: value => { ok(value); assert.equal((value as any).result.workspace, 'scratch'); } },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, workspace: 'copy' }), check: value => { ok(value); assert.equal((value as any).result.workspace, 'copy'); } },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, workspace: 'scratch' }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, content: '分析结果' }), check: value => { ok(value); assert.equal((value as any).result.workspace, 'scratch'); } },
    { type: 'tool', name: 'create-card', arguments: { key: 'default', content: '默认位置' }, check: value => { ok(value); assert.equal((value as any).result.workspace, 'copy'); } },
    { type: 'tool', name: 'create-card', arguments: { key: 'old', content: '旧参数', readOnly: true }, check: value => assert.equal((value as any).error.code, 'INVALID_PARAMS') },
  ]);
  await daemon.finished();
  const card = (await daemon.call('get-card-graph', { workId: daemon.work.id })).result.find((node: any) => node.type === 'card');
  assert.equal(card.workspace, 'scratch');
  assert.equal(card.content, '分析结果');
  assert.equal('readOnly' in card, false);
});
