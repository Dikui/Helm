import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FakeStep } from '../src/driver.js';
import { uiFixture, until } from './ui-fixture.js';

test('调度轮次输出按步骤分页，校验工作归属，HTTP、MCP 和命令行读取一致', async t => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const daemon = await uiFixture([[
    { type: 'output', text: '读取项目' }, { type: 'output', text: '分析边界' },
    { type: 'compaction' }, { type: 'hang', until: hold }, { type: 'output', text: '整理结论' },
  ]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '追溯调度者', key: 'start' })).result.work;
  const rounds = (await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.currentSteps.length === 3)).result;
  const params = { workId: work.id, roundId: rounds.rounds[0].id };
  const page = await daemon.call('get-round-output', { ...params, fromStep: 2, toStep: 3 });
  assert.equal(page.status, 200);
  assert.deepEqual(page.result.map((step: any) => [step.step, step.type, step.text]), [[2, 'output', '分析边界'], [3, 'compaction', undefined]]);
  assert.ok(Date.parse(page.result[0].time));
  assert.deepEqual((await daemon.call('get-round-output', { ...params, fromStep: 20 })).result, []);
  for (const range of [{ fromStep: 0 }, { fromStep: 3, toStep: 2 }, { toStep: 1.5 }]) {
    assert.equal((await daemon.call('get-round-output', { ...params, ...range })).error.code, 'INVALID_PARAMS');
  }
  assert.equal((await daemon.call('get-round-output', { ...params, roundId: 'missing' })).status, 404);
  const other = (await daemon.call('send-message', { projectId: daemon.project.id, body: '另一项工作', key: 'other' })).result.work;
  assert.equal((await daemon.call('get-round-output', { ...params, workId: other.id })).status, 404);
  const client = new Client({ name: 'helm-round-output-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`)));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'get-round-output'));
  const mcp = await client.callTool({ name: 'get-round-output', arguments: { ...params, fromStep: 2, toStep: 3 } });
  assert.deepEqual((mcp.structuredContent as any).result, page.result);
  const cli = JSON.parse((await promisify(execFile)(process.execPath, ['dist/src/cli.js', 'get-round-output', '--workId', work.id,
    '--roundId', params.roundId, '--fromStep', '2', '--toStep', '3', '--url', daemon.url], { encoding: 'utf8', timeout: 5_000 })).stdout);
  assert.deepEqual(cli.result, page.result);
  finish();
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0].status === 'ended');
  const full = (await daemon.call('get-round-output', params)).result;
  assert.deepEqual(full.map((step: any) => step.step), [1, 2, 3, 4, 5]);
  assert.equal(full[3].text, '整理结论');
  await daemon.call('cancel-work', { workId: work.id });
  // Ended work output has been compressed by the runtime; the read contract is unchanged.
  assert.deepEqual((await daemon.call('get-round-output', params)).result, full);
  await daemon.call('delete-outputs', { workId: work.id, confirm: true });
  assert.deepEqual((await daemon.call('get-round-output', params)).result, { status: 'deleted', message: '已删除' });
});

test('调度笔记读取保留当前全文并提供各版本原文和时间', async t => {
  const daemon = await uiFixture([[
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, body: '先做接口' }) },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, body: '接口通过后做表单' }) },
    { type: 'tool', name: 'get-round-output', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, roundId: 'current' }),
      check: value => assert.equal((value as any).error.code, 'FORBIDDEN') },
  ]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '笔记历史', key: 'start' })).result.work;
  await until(() => daemon.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  const notes = (await daemon.call('get-coordinator-notes', { workId: work.id })).result;
  assert.equal(notes.version, 2);
  assert.equal(notes.body, '接口通过后做表单');
  assert.deepEqual(notes.versions.map((version: any) => [version.version, version.body]), [[1, '先做接口'], [2, '接口通过后做表单']]);
  assert.ok(notes.versions.every((version: any) => Date.parse(version.time)));
  assert.equal((await daemon.call('list-rounds', { workId: work.id })).result.rounds[0].reason, 'completed');
});


test('派单可读摘要覆盖 Claude、Codex 和 ACP，噪声保留上一摘要，原始输出仍可读取', async t => {
  const samples: [unknown, string | undefined][] = [
    [{ type: 'assistant', message: { content: [{ type: 'text', text: '检查登录边界\n后续说明' }] } }, '检查登录边界'],
    [{ type: 'system', subtype: 'init', text: '系统元数据' }, undefined],
    [{ type: 'system', subtype: 'hook_response', message: { content: [{ type: 'text', text: 'hook 噪声' }] } }, undefined],
    [{ type: 'hook_response', text: 'hook 噪声' }, undefined],
    [{ type: 'rate_limit_event', text: '限额状态' }, undefined],
    [{ type: 'user', message: { content: [{ type: 'tool_result', content: '原始工具结果' }] } }, undefined],
    [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm run check' } }] } }, 'Bash · npm run check'],
    [{ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '正在核对 Claude 输出' } } }, '正在核对 Claude 输出'],
    [{ method: 'item/completed', params: { item: { type: 'agentMessage', text: '正在核对 Codex 输出' } } }, '正在核对 Codex 输出'],
    [{ method: 'item/agentMessage/delta', params: { delta: '读取卡片说明' } }, '读取卡片说明'],
    [{ method: 'item/started', params: { item: { type: 'commandExecution', command: 'npm test' } } }, 'npm test'],
    [{ method: 'item/started', params: { item: { type: 'mcpToolCall', server: 'helm', tool: 'get-card' } } }, 'get-card'],
    [{ method: 'thread/tokenUsage/updated', params: { tokenUsage: { total: { inputTokens: 3 } } } }, undefined],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在核对 Grok 输出' } } } }, '正在核对 Grok 输出'],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', title: 'Read', rawInput: { path: 'README.md' } } } }, 'Read'],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在核对 DeepSeek 输出' } } } }, '正在核对 DeepSeek 输出'],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', rawInput: { command: 'git status' } } } }, 'git status'],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: '用户输入' } } } }, undefined],
    [{ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', content: [{ type: 'content', content: { type: 'text', text: '工具返回结果' } }] } } }, undefined],
    [{ unknown: 'metadata' }, undefined],
    ['', undefined],
    ['  可读文本\n第二行', '可读文本'],
    ['长'.repeat(220), '长'.repeat(200)],
  ];
  const releases: (() => void)[] = [];
  const raw = samples.map(([message]) => typeof message === 'string' ? message : JSON.stringify(message));
  let begin!: () => void;
  const ready = new Promise<void>(resolve => { begin = resolve; });
  const script: FakeStep[] = [{ type: 'hang', until: ready }, ...raw.flatMap<FakeStep>(text => [
    { type: 'output', text },
    { type: 'hang', until: new Promise<void>(resolve => releases.push(resolve)) },
  ])];
  // Empty final answers also keep the last useful summary.
  script.push({ type: 'end', reason: 'completed', finalAnswer: '' });
  const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
  const daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'brief', requirements: '可读摘要', boundary: '本机', criteria: '不显示 JSON' }), check: ok },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '摘要卡片' }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'dispatch', cardId: (ctx.results.get('card') as any).result.id, templateId: 'claude-executor' }), check: ok },
    { type: 'hang' },
  ]], undefined, { executorScripts: [script] });
  t.after(async () => { releases.forEach(release => release()); await daemon.close(); });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '摘要工作' })).result.work;
  const params = { workId: work.id };
  await until(() => daemon.call('list-rounds', params), value => value.result.rounds[0]?.status === 'ended');
  const description = (await daemon.call('get-work-descriptions', params)).result[0];
  ok(await daemon.call('decide-gate', { ...params, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  await until(() => daemon.call('list-rounds', params), value => value.result.currentSteps.some((step: any) => step.text?.includes('create-dispatch')));
  begin();
  const graph = () => daemon.call('get-card-graph', params);
  let expected = '';
  for (let index = 0; index < samples.length; index++) {
    const card = (await until(graph, value => value.result.some((node: any) => node.type === 'card' && node.currentStep === index + 1))).result.find((node: any) => node.type === 'card');
    expected = samples[index]![1] ?? expected;
    assert.equal(card.latestStepSummary, expected, `步骤 ${index + 1}: ${raw[index]}`);
    const event = (await daemon.call('get-events', params)).result.findLast((event: any) => event.action === 'dispatch-step');
    assert.equal(event.details.summary, expected);
    assert.equal((await daemon.call('list-works')).result[0].summary, expected.slice(0, 160));
    releases[index]!();
  }
  const dispatch = (await until(() => daemon.call('list-dispatches', params), value => value.result[0]?.status === 'ended')).result[0];
  assert.equal((await graph()).result.find((node: any) => node.type === 'card').latestStepSummary, expected);
  const output = (await daemon.call('get-dispatch-output', { ...params, dispatchId: dispatch.id })).result;
  assert.deepEqual(output.filter((step: any) => step.type === 'output').map((step: any) => step.text), raw);
});
