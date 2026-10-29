import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { FakeScript, FakeStep } from '../src/driver.js';
import { uiFixture, until } from './ui-fixture.js';

test('对齐轮次未报告用量时工作与收件箱保留未知，明确报告零时保留零', async t => {
  const daemon = await uiFixture([
    [{ type: 'end', reason: 'completed' }],
    [{ type: 'end', reason: 'completed', usage: { inputTokens: 0, outputTokens: 0 } }],
  ]);
  t.after(() => daemon.close());
  for (const [key, expected] of [['missing', { inputTokens: null, outputTokens: null }], ['zero', { inputTokens: 0, outputTokens: 0 }]] as const) {
    const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: key, key })).result.work;
    const rounds = (await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended')).result.rounds;
    assert.deepEqual(rounds[0].usage, expected);
    assert.deepEqual((await daemon.call('get-work', { workId: work.id })).result.usage, expected);
    assert.deepEqual((await daemon.call('list-works')).result.find((row: any) => row.id === work.id).usage, expected);
  }
});

test('卡片合计包含执行和失败验收，工作合计另加所有调度轮次', async t => {
  const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
  const releases: (() => void)[] = [];
  const holds = Array.from({ length: 3 }, () => new Promise<void>(resolve => releases.push(resolve)));
  const missing: FakeScript = ctx => {
    const brief = JSON.parse(ctx.input);
    return brief.wakeEvents.some((event: any) => event.action === 'message-sent' && event.details.body === 'missing') ? [
      { type: 'tool', name: 'create-dispatch', arguments: { workId: brief.work.id, cardId: brief.cardGraph.find((node: any) => node.type === 'card').id, key: 'partial', agentId: 'claude-executor', purpose: 'verification' }, check: ok },
    ] : [];
  };
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: 'Token', boundary: '本机', criteria: '用量可查' }), check: ok },
    { type: 'end', reason: 'completed', usage: { inputTokens: 100, outputTokens: 20 } },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '用量卡片' }), saveAs: 'card', check: ok },
    { type: 'hang', until: holds[0] },
    ...['execution', 'verification'].flatMap((purpose, index): FakeStep[] => [
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, cardId: (ctx.results.get('card') as any).result.id, key: `run-${index}`, agentId: 'claude-executor', purpose }), check: ok },
      { type: 'hang', until: holds[index + 1] },
    ]),
    { type: 'end', reason: 'completed', usage: { inputTokens: 50, outputTokens: 10 } },
  ], ...Array<FakeScript>(12).fill(missing)], undefined, { executorScripts: [
    [{ type: 'end', reason: 'completed', usage: { inputTokens: 30, outputTokens: 5 } }],
    [{ type: 'end', reason: 'error', usage: { inputTokens: 10, outputTokens: 2 } }],
    [{ type: 'end', reason: 'completed', usage: { inputTokens: 5, outputTokens: null } }],
  ] });
  t.after(async () => { releases.forEach(release => release()); await daemon.close(); });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: 'Token', key: 'start' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const description = (await daemon.call('get-work-descriptions', params)).result[0];
  ok(await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  const graph = () => daemon.call('get-card-graph', params);
  const card = (await until(graph, value => value.result.some((node: any) => node.type === 'card'))).result.find((node: any) => node.type === 'card');
  assert.deepEqual(card.usage, { inputTokens: null, outputTokens: null });
  for (let index = 0; index < 2; index++) {
    releases[index]!();
    await until(() => daemon.call('list-dispatches', params), value => value.result[index]?.status === 'ended');
    const expected = [{ inputTokens: 30, outputTokens: 5 }, { inputTokens: 40, outputTokens: 7 }][index];
    assert.deepEqual((await daemon.call('get-card', { ...params, cardId: card.id })).result.usage, expected);
    assert.deepEqual((await graph()).result.find((node: any) => node.id === card.id).usage, expected);
  }
  releases[2]!();
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[1]?.status === 'ended' && value.result.rounds.every((round: any) => round.status === 'ended'));
  assert.deepEqual((await daemon.call('get-work', params)).result.usage, { inputTokens: 190, outputTokens: 37 });
  ok(await daemon.call('send-message', { ...params, body: 'missing', key: 'missing' }));
  await until(() => daemon.call('list-dispatches', params), value => value.result.length === 3 && value.result[2].status === 'ended');
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds.every((round: any) => round.status === 'ended'));
  assert.deepEqual((await daemon.call('get-card', { ...params, cardId: card.id })).result.usage, { inputTokens: 45, outputTokens: 7, incomplete: true });
  const settled = await until(() => daemon.call('get-work', params), value => value.result.usage.inputTokens === 195);
  assert.deepEqual(settled.result.usage, { inputTokens: 195, outputTokens: 37, incomplete: true });
  const inbox = await until(() => daemon.call('list-works'), value => value.result.find((row: any) => row.id === work.id).usage.inputTokens === 195);
  assert.deepEqual(inbox.result.find((row: any) => row.id === work.id).usage, { inputTokens: 195, outputTokens: 37, incomplete: true });
});
