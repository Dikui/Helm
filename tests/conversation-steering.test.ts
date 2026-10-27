import assert from 'node:assert/strict';
import { test } from 'node:test';
import { uiFixture, until } from './ui-fixture.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('针对卡片的消息校验工作归属、幂等保存，并在调度者读取对话时可见', async t => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '实现登录', boundary: '登录页', criteria: '登录可用' }) },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '实现验证码', needsVerification: false }) },
    { type: 'hang', until: ready },
    { type: 'tool', name: 'get-conversation', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id }),
      check: value => {
        const message = (value as any).result.find((item: any) => item.body === '验证码十分钟过期');
        assert.ok(message.cardId);
      } },
  ]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '登录工作', key: 'start' })).result.work;
  const descriptions = await until(() => daemon.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 1);
  await until(() => daemon.call('get-events', { workId: work.id }), value => value.result.some((event: any) => event.action === 'round-ended'));
  const description = descriptions.result[0];
  await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
  const graph = await until(() => daemon.call('get-card-graph', { workId: work.id }), value => value.result.some((node: any) => node.type === 'card'));
  const card = graph.result.find((node: any) => node.type === 'card');
  const params = { workId: work.id, cardId: card.id, body: '验证码十分钟过期', key: 'card-message' };
  const sent = await daemon.call('send-message', params);
  assert.equal(sent.ok, true);
  assert.equal(sent.result.message.cardId, card.id);
  assert.deepEqual((await daemon.call('send-message', params)).result, sent.result);
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  assert.equal(conversation.filter((item: any) => item.body === params.body).length, 1);
  assert.equal(conversation.find((item: any) => item.body === params.body).cardId, card.id);
  assert.equal((await daemon.call('send-message', { ...params, cardId: 'missing', key: 'missing' })).error.code, 'INVALID_CARD');
  const other = (await daemon.call('send-message', { projectId: daemon.project.id, body: '其他工作', key: 'other' })).result.work;
  assert.equal((await daemon.call('send-message', { ...params, workId: other.id, key: 'foreign' })).error.code, 'INVALID_CARD');
  release();
  const ended = await until(() => daemon.call('get-events', { workId: work.id }), value => value.result.filter((event: any) => event.action === 'round-ended').length >= 2);
  assert.equal(ended.result.filter((event: any) => event.action === 'round-ended')[1].details.reason, 'completed');
});

test('轮次读取含 Agent、时间、用量和实时输出；已接收消息不排队，下一轮接收后移出队列', async t => {
  let advance!: () => void;
  let finish!: () => void;
  const firstStep = new Promise<void>(resolve => { advance = resolve; });
  const lastStep = new Promise<void>(resolve => { finish = resolve; });
  const daemon = await uiFixture([[
    { type: 'output', text: '正在读取项目' },
    { type: 'tool', name: 'list-rounds', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id }),
      check: value => {
        assert.equal((value as any).ok, true);
        assert.deepEqual((value as any).result.currentSteps, [], '调度者查询元数据时不嵌入自己的原始输出');
      } },
    { type: 'hang', until: firstStep },
    { type: 'output', text: '正在整理边界' }, { type: 'hang', until: lastStep },
    { type: 'end', reason: 'completed', usage: { inputTokens: 17, outputTokens: 9 } },
  ], [{ type: 'hang' }]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '轮次工作', key: 'start' })).result.work;
  const read = () => daemon.call('list-rounds', { workId: work.id });
  const initial = await read();
  assert.equal(initial.ok, true);
  const running = (await until(read, value => value.result.currentSteps.some((step: any) => step.text === '正在读取项目'))).result;
  assert.equal(running.rounds[0].number, 1);
  assert.equal(running.rounds[0].agentId, 'claude-coordinator');
  assert.equal(running.rounds[0].status, 'running');
  assert.ok(Date.parse(running.rounds[0].startedAt));
  assert.equal(running.rounds[0].endedAt, null);
  assert.deepEqual(running.queuedMessages, []);
  assert.deepEqual(running.currentPlan, []);
  assert.ok(Date.parse(running.currentSteps.at(-1).time));
  const message = (await daemon.call('send-message', { workId: work.id, body: '下一轮先处理边界', key: 'queued' })).result.message;
  const queued = (await read()).result;
  assert.deepEqual(queued.queuedMessages.map((item: any) => item.id), [message.id]);
  advance();
  await until(read, value => value.result.currentSteps.some((step: any) => step.text === '正在整理边界'));
  finish();
  const next = (await until(read, value => value.result.rounds.length === 2 && value.result.rounds[1].status === 'running')).result;
  assert.deepEqual(next.queuedMessages, []);
  assert.equal(next.rounds[0].status, 'ended');
  assert.equal(next.rounds[0].reason, 'completed');
  assert.deepEqual(next.rounds[0].usage, { inputTokens: 17, outputTokens: 9 });
  assert.ok(Date.parse(next.rounds[0].endedAt));
  assert.equal(next.rounds[1].number, 2);
  assert.equal((await daemon.call('interrupt-round', { workId: work.id })).ok, true);
  const interrupted = (await read()).result.rounds[1];
  assert.equal(interrupted.reason, 'aborted');
  assert.equal((await daemon.call('list-rounds', { workId: 'missing' })).status, 404);
  const cli = JSON.parse((await promisify(execFile)(process.execPath, ['dist/src/cli.js', 'list-rounds', '--workId', work.id, '--url', daemon.url], { encoding: 'utf8', timeout: 5_000 })).stdout);
  assert.equal(cli.ok, true);
});

test('工作取消后不再把未处理消息显示为下一轮排队', async t => {
  const daemon = await uiFixture([[{ type: 'output', text: '仍在处理' }, { type: 'hang' }]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '待取消的工作', key: 'start' })).result.work;
  const read = () => daemon.call('list-rounds', { workId: work.id });
  await until(read, value => value.result.currentSteps.length > 0);
  await daemon.call('send-message', { workId: work.id, body: '不再执行', key: 'queued' });
  assert.equal((await read()).result.queuedMessages.length, 1);
  await daemon.call('cancel-work', { workId: work.id });
  const ended = (await read()).result;
  assert.deepEqual(ended.queuedMessages, []);
  assert.deepEqual(ended.currentSteps, []);
});

test('撤回只移除未领取用户消息，保留对话、发送幂等与 SSE 事件，后续轮次不再领取', async t => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const seen: number[][] = [];
  const daemon = await uiFixture([[
    { type: 'output', text: '运行中' },
    { type: 'tool', name: 'send-message', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'agent', body: '调度者消息' }) },
    { type: 'hang', until: ready },
  ], ctx => {
    const brief = JSON.parse(ctx.input);
    seen.push(brief.wakeEvents.map((event: any) => event.id));
    assert.ok(!brief.newEvents.some((event: any) => event.action === 'message-sent' && event.details.body === '撤回正文'));
    assert.ok(brief.recentConversation.some((item: any) => item.body === '撤回正文' && item.withdrawnAt));
    return [{ type: 'hang' }];
  }]);
  t.after(() => daemon.close());
  const sent = await daemon.call('send-message', { projectId: daemon.project.id, body: '开始', key: 'start' });
  const workId = sent.result.work.id;
  const read = () => daemon.call('list-rounds', { workId });
  await until(read, value => value.result.currentSteps.length >= 2);
  const withdraw = (messageId: string, extra = {}) => daemon.call('withdraw-message', { workId, messageId, ...extra });
  const claimed = await withdraw(sent.result.message.id);
  assert.equal(claimed.error.code, 'MESSAGE_CLAIMED');
  assert.ok(claimed.error.allowedOperations.includes('withdraw-message'));
  const conversation = (await daemon.call('get-conversation', { workId })).result;
  assert.equal((await withdraw(conversation.find((item: any) => item.body === '调度者消息').id)).error.code, 'MESSAGE_NOT_USER');
  assert.equal((await withdraw('missing')).error.code, 'MESSAGE_NOT_FOUND');
  assert.equal((await withdraw('')).error.code, 'INVALID_PARAMS');
  const params = { workId, body: '撤回正文', key: 'queued' };
  const message = (await daemon.call('send-message', params)).result.message;
  assert.equal((await withdraw(message.id, { workId: 'missing' })).error.code, 'NOT_FOUND');
  const result = await withdraw(message.id);
  assert.equal(result.ok, true);
  assert.ok(result.result.withdrawnAt);
  assert.deepEqual((await read()).result.queuedMessages, []);
  assert.equal((await withdraw(message.id)).error.code, 'MESSAGE_WITHDRAWN');
  const history = (await daemon.call('get-conversation', { workId })).result.find((item: any) => item.id === message.id);
  assert.equal(history.body, '撤回正文');
  assert.equal(history.withdrawnAt, result.result.withdrawnAt);
  assert.equal((await daemon.call('send-message', params)).result.message.withdrawnAt, history.withdrawnAt);
  const events = (await daemon.call('get-events', { workId })).result;
  assert.equal(events.filter((event: any) => event.action === 'message-withdrawn' && event.object.id === message.id).length, 1);
  await daemon.call('send-message', { workId, body: '下一轮', key: 'next' });
  release();
  await until(read, value => value.result.rounds.length === 2 && value.result.currentSteps.length === 0);
  await until(async () => seen.length, value => value === 1);
  assert.ok(seen.every(ids => !ids.includes(message.sequence)));
  const other = (await daemon.call('send-message', { projectId: daemon.project.id, body: '另一项工作', key: 'foreign' })).result.work;
  assert.equal((await withdraw(message.id, { workId: other.id })).error.code, 'MESSAGE_NOT_FOUND');
});

test('撤回与轮次领取竞争只有成功或已领取两种结果；被中止轮次收到的消息也不可撤回', async t => {
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const daemon = await uiFixture([[{ type: 'output', text: '开始' }, { type: 'hang', until: ready }], [{ type: 'hang' }]]);
  t.after(() => daemon.close());
  const workId = (await daemon.call('send-message', { projectId: daemon.project.id, body: '开始', key: 'start' })).result.work.id;
  const read = () => daemon.call('list-rounds', { workId });
  await until(read, value => value.result.currentSteps.length > 0);
  const message = (await daemon.call('send-message', { workId, body: '竞争', key: 'race' })).result.message;
  const wake = (await daemon.call('send-message', { workId, body: '确保下一轮唤醒', key: 'wake' })).result.message;
  release();
  const result = await daemon.call('withdraw-message', { workId, messageId: message.id });
  assert.ok(result.ok || result.error.code === 'MESSAGE_CLAIMED', JSON.stringify(result));
  await until(read, value => value.result.rounds[1]?.status === 'running');
  const events = (await daemon.call('get-events', { workId })).result;
  const received = events.filter((event: any) => event.action === 'round-started').slice(1).some((event: any) => event.details.eventIds.includes(message.sequence));
  assert.equal(received, !result.ok);
  await daemon.call('pause-work', { workId });
  const initial = events.find((event: any) => event.action === 'message-sent' && event.details.body === '开始');
  const rejected = await daemon.call('withdraw-message', { workId, messageId: initial.object.id });
  assert.equal(rejected.error.code, 'MESSAGE_CLAIMED');
  assert.equal((await daemon.call('withdraw-message', { workId, messageId: wake.id })).error.code, 'MESSAGE_CLAIMED');
});

test('list-rounds 返回最新计划快照，分页保留 plan，轮次结束后清空计划', async t => {
  let advance!: () => void;
  let finish!: () => void;
  const update = new Promise<void>(resolve => { advance = resolve; });
  const done = new Promise<void>(resolve => { finish = resolve; });
  const first = [{ content: '读取', status: 'in_progress' as const }, { content: '检查', status: 'pending' as const }];
  const last = first.map(entry => ({ ...entry, status: 'completed' as const }));
  const daemon = await uiFixture([[
    { type: 'plan', entries: first }, { type: 'output', text: '读取中' }, { type: 'hang', until: update },
    { type: 'plan', entries: last },
    { type: 'tool', name: 'list-rounds', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id }), check: value => {
      assert.deepEqual((value as any).result.currentPlan, last);
      assert.deepEqual((value as any).result.currentSteps, []);
    } }, { type: 'hang', until: done },
  ]]);
  t.after(() => daemon.close());
  const workId = (await daemon.call('send-message', { projectId: daemon.project.id, body: '计划', key: 'start' })).result.work.id;
  const read = () => daemon.call('list-rounds', { workId });
  const initial = (await until(read, value => value.result.currentSteps.length >= 2)).result;
  assert.deepEqual(initial.currentPlan, first);
  advance();
  await until(read, value => value.result.currentSteps.length >= 4);
  assert.deepEqual((await read()).result.currentPlan, last);
  const page = await daemon.call('get-round-output', { workId, roundId: initial.rounds[0].id, fromStep: 3, toStep: 3 });
  assert.equal(page.result.length, 1);
  assert.equal(page.result[0].type, 'plan');
  assert.deepEqual(page.result[0].entries, last);
  finish();
  assert.deepEqual((await until(read, value => value.result.rounds[0].status === 'ended')).result.currentPlan, []);
});
