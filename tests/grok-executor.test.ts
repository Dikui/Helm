import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { chmod, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { startHelmd } from '../src/server.js';
import { AgentCatalog } from '../src/agents.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { acpFixture } from './acp-fixture.js';
import { acpExecutorFixture as grokFixture, ok } from './acp-executor-fixture.js';
import { until } from './browser-fixture.js';

for (const purpose of ['execution', 'verification'] as const) test(`Grok ${purpose} 派单通过假 ACP 调用同一 Helm 端点的结论和浏览器，保存结果、用量与卡片改动`, async t => {
  const site = createServer((_request, response) => response.end('<h1>Grok ACP fixture</h1>'));
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
  const address = site.address();
  assert.ok(address && typeof address !== 'string');
  const acp = await acpFixture(t, { uniqueSession: true, writes: [{ path: 'inside.txt', content: 'inside\n' }], mcpTools: [
    { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } },
    { name: 'browser_snapshot', arguments: {} },
    { name: 'browser_take_screenshot', arguments: { filename: 'grok.png', type: 'png' } },
    { name: 'submit-conclusion', arguments: { conclusion: purpose === 'execution' ? 'completed' : 'passed', reason: '脚本检查通过' } },
  ] }, false);
  const daemon = await grokFixture(t, acp.driver, { purpose, needsBrowser: true });
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'completed', dispatch.failure);
  assert.equal(dispatch.finalAnswer, '已完成');
  assert.equal(dispatch.conclusion, purpose === 'execution' ? 'completed' : 'passed');
  assert.deepEqual(dispatch.usage, { inputTokens: 120, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: 6 });
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
  assert.deepEqual(card.usage, { inputTokens: 120, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: 6 });
  await until(() => daemon.call('list-rounds', { workId: daemon.work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
  assert.deepEqual((await daemon.call('get-work', { workId: daemon.work.id })).result.usage, { inputTokens: 120, outputTokens: 9, cacheReadTokens: 80, cacheWriteTokens: 6 });
  if (purpose === 'execution') {
    assert.equal((await readFile(join(card.workPath, 'inside.txt'), 'utf8')).trim(), 'inside');
    assert.equal(daemon.git('show', `${card.cardBranch}:inside.txt`), 'inside');
    assert.notEqual(dispatch.startCommit, dispatch.endCommit, '执行改动由运行层提交');
  } else {
    assert.equal(card.workPath, null);
    assert.equal(card.cardBranch, null);
    const work = (await daemon.call('get-work', { workId: daemon.work.id })).result;
    await assert.rejects(stat(join(work.workPath ?? daemon.repo, 'inside.txt')), { code: 'ENOENT' });
    assert.equal(dispatch.startCommit, dispatch.endCommit, '验收改动被运行层丢弃');
    assert.equal(dispatch.resumeSessionId, null);
  }
  const requests = await acp.requests();
  const tools = requests.find(r => r.method === 'fixture/tools').result.tools.map((tool: any) => tool.name);
  assert.ok(tools.includes('submit-conclusion') && tools.includes('browser_navigate'));
  assert.ok(!tools.includes('create-card'), '执行者不能拿到调度者工具');
  const spawns = requests.filter(r => r.method === 'fixture/spawn');
  assert.ok(spawns.every(r => r.env.HOME === daemon.home));
  const calls = requests.filter(r => r.method === 'fixture/mcp');
  assert.equal(calls.length, 4);
  assert.ok(calls.every(call => !call.result.isError));
  const artifacts = (await daemon.call('get-dispatch-artifacts', { workId: daemon.work.id, dispatchId: dispatch.id })).result;
  assert.ok(artifacts.some((a: any) => a.name === 'browser/grok.png'));
});

test('startHelmd 默认登记 Grok 驱动和内置 Agent；调度者 Agent 不可用并将原因写入待处理（CLI 替身）', async t => {
  const acp = await acpFixture(t);
  const bin = join(acp.directory, 'bin');
  await mkdir(bin);
  const executable = join(bin, 'grok');
  const fixture = fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url));
  await writeFile(executable, `#!${process.execPath}\nprocess.argv.splice(1, 1, ${JSON.stringify(fixture)}, ${JSON.stringify(join(acp.directory, 'script.json'))});\nimport(${JSON.stringify(pathToFileURL(fixture).href)});\n`);
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const agentDir = join(acp.directory, 'agents');
  await cp(join(fixtureAgentDir, 'grok-executor'), join(agentDir, 'grok-executor'), { recursive: true });
  await cp(join(fixtureAgentDir, 'grok-executor'), join(agentDir, 'grok-coordinator'), { recursive: true });
  const configPath = join(agentDir, 'grok-coordinator', 'config.json');
  await writeFile(configPath, JSON.stringify({ ...JSON.parse(await readFile(configPath, 'utf8')), role: 'coordinator' }));
  const daemon = await startHelmd({ port: 0, dataDir: join(acp.directory, 'data'), agentDir });
  try {
    assert.throws(() => new AgentCatalog(agentDir, ['grok']).get('grok-coordinator', 'coordinator'), /本阶段只支持执行者/,
      '设置调度者 Agent 的同步入口同样拒绝 Grok');
    const call = async (name: string) => (await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json() as any).result;
    const agents = await call('list-agents');
    assert.equal(agents.find((t: any) => t.id === 'grok-executor').available, true);
    const coordinator = agents.find((t: any) => t.id === 'grok-coordinator');
    assert.equal(coordinator.available, false);
    assert.match(coordinator.reason, /本阶段只支持执行者/);
    assert.match((await call('list-pending')).find((p: any) => p.agentId === 'grok-coordinator').reason, /本阶段只支持执行者/);
    assert.ok((await acp.requests()).every(r => ['fixture/spawn', 'initialize'].includes(r.method)), '启动检查不建模型会话');
  } finally { await daemon.close(); }
});

for (const [operation, abortReason] of [
  ['pause-card', '卡片暂停'], ['cancel-card', '卡片取消'], ['pause-work', '工作暂停'], ['cancel-work', '工作取消'],
] as const) test(`Grok ${operation} 发送协议取消，保存被中止结果并按 cwd 清理独立子进程`, async t => {
  const acp = await acpFixture(t, { uniqueSession: true, holdPrompt: true, spawnChild: true,
    writes: [{ path: 'progress.txt', content: '中止前进度' }] }, false);
  const daemon = await grokFixture(t, acp.driver);
  await daemon.confirm();
  const requests = await until(acp.requests, requests => requests.some(r => r.method === 'fixture/child'));
  const child = requests.find(r => r.method === 'fixture/child').pid;
  t.after(() => { try { process.kill(child, 'SIGKILL'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; } });
  const [running] = await daemon.dispatches();
  ok(await daemon.call(operation, { workId: daemon.work.id,
    ...(operation.endsWith('-card') ? { cardId: running.cardId } : {}),
    ...(operation === 'cancel-card' ? { reason: '测试中止' } : {}),
  }));
  const [ended] = await daemon.ended();
  assert.equal(ended.endReason, 'aborted', ended.failure);
  assert.equal(ended.abortReason, abortReason);
  assert.equal(ended.finalAnswer, null);
  const cancels = (await acp.requests()).filter(r => r.method === 'session/cancel');
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].params.sessionId, ended.sessionId);
  assert.throws(() => process.kill(child, 0), { code: 'ESRCH' });
  assert.ok((await daemon.events()).some(e => e.action === 'dispatch-processes-cleaned' && e.details.pids.includes(child)), '取消不负责清子进程，运行层必须清理');
});

for (const [script, reason, failure] of [
  [{ configuredOptions: [] }, 'error', /model.*grok-4\.7.*未公布/],
  [{ configuredOptions: [
    { id: 'model', name: 'Model', type: 'select', currentValue: 'grok-4.7', options: [] },
    { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'high', options: [] },
  ] }, 'error', /reasoning_effort.*low.*high/],
  [{ rejectOn: 'session/prompt', error: { code: -32003, message: 'Rate limited', data: 'subscription:free-usage-exhausted' } }, 'quota-exhausted', /free-usage-exhausted/],
  [{ rejectOn: 'session/prompt', error: { code: -32603, message: 'Internal error', data: 'connection reset' } }, 'error', /connection reset/],
  [{ exitOn: 'session/prompt' }, 'error', /ACP/],
  [{ response: { stopReason: 42 } }, 'error', /stopReason/],
] as const) test(`Grok ACP ${JSON.stringify(script)} 将结束方式和错误原因保存到派单结果`, async t => {
  const acp = await acpFixture(t, script, false);
  const daemon = await grokFixture(t, acp.driver);
  await daemon.confirm();
  const [ended] = await daemon.ended();
  assert.equal(ended.endReason, reason);
  assert.match(ended.failure, failure);
  assert.equal(ended.finalAnswer, null);
  assert.equal(ended.conclusion, 'undeclared');
});

test('Grok 执行后验收始终新开；不通过后打回续跑原执行会话，压缩事件落库', async t => {
  const acp = await acpFixture(t, { uniqueSession: true, notifications: [
    { method: '_x.ai/session/update', params: { update: { sessionUpdate: 'auto_compact_started', tokens_used: 850, context_window: 1000, percentage: 85, reason: 'threshold' } } },
  ] }, false);
  const daemon = await grokFixture(t, acp.driver);
  const idle = () => until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
  await daemon.confirm();
  const [first] = await daemon.ended();
  await idle();
  await writeFile(join(acp.directory, 'script.json'), JSON.stringify({ record: join(acp.directory, 'requests.jsonl'), testProcessPid: process.pid, uniqueSession: true,
    mcpTools: [{ name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: '需要修改' } }] }));
  daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: {
    workId: daemon.work.id, cardId: first.cardId, agentId: 'grok-executor', key: 'verification', purpose: 'verification',
  }, check: ok }]);
  ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'verification', body: '验收' }));
  const verification = (await daemon.ended(2))[1];
  assert.equal(verification.conclusion, 'failed');
  assert.notEqual(verification.sessionId, first.sessionId);
  assert.equal(verification.resumeSessionId, null);
  await idle();
  await writeFile(join(acp.directory, 'script.json'), JSON.stringify({ record: join(acp.directory, 'requests.jsonl'), testProcessPid: process.pid, uniqueSession: true }));
  daemon.actions.push([
    { type: 'tool', name: 'create-dispatch', arguments: { workId: daemon.work.id, cardId: first.cardId,
      agentId: 'grok-executor', key: 'invalid-verification', purpose: 'verification', resumeSessionId: first.sessionId },
      check: value => assert.equal((value as any).error.code, 'INVALID_RESUME') },
    { type: 'tool', name: 'create-dispatch', arguments: { workId: daemon.work.id, cardId: first.cardId,
      agentId: 'grok-executor', key: 'resume', resumeSessionId: first.sessionId, content: '按验收意见修改' }, check: ok },
  ]);
  ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'resume', body: '打回续跑' }));
  const resumed = (await daemon.ended(3))[2];
  assert.equal(resumed.endReason, 'completed', resumed.failure);
  assert.equal(resumed.sessionId, first.sessionId);
  const requests = await acp.requests();
  assert.equal(requests.filter(r => r.method === 'session/new').length, 2);
  assert.equal(requests.filter(r => r.method === 'session/resume').length, 1);
  const compacted = (await daemon.events()).filter(e => e.action === 'context-compacted');
  assert.equal(compacted.length, 1, JSON.stringify(await daemon.output(first.id)));
  assert.equal(compacted[0].dispatchId, first.id);
});
