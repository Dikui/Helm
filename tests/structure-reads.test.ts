import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
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
