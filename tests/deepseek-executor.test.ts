import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { chmod, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as zlib from 'node:zlib';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { AcpDriver } from '../src/acp-driver.js';
import { acpFixture, collect } from './acp-fixture.js';
import { defaultTemplateDir, TemplateCatalog, type AgentTemplate } from '../src/templates.js';
import { startHelmd } from '../src/server.js';
import { acpExecutorFixture, ok } from './acp-executor-fixture.js';
import { until } from './browser-fixture.js';

// dsh 0.2.1-rc.2 model-control uses JSON [provider, model] selector values.
const configOptions = [
  { id: 'model', name: 'Model', type: 'select', currentValue: '["deepseek-account","deepseek-v4-pro"]', options: [
    { group: 'deepseek-account', name: 'Account', options: [
      { value: '["deepseek-account","deepseek-flash"]', name: 'Flash' },
      { value: '["deepseek-account","deepseek-v4-pro"]', name: 'Pro' },
    ] },
    { group: 'deepseek-official', name: 'API', options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: 'Flash API' }] },
  ] },
  { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'high',
    options: ['low', 'high', 'max'].map(value => ({ value, name: value })) },
];

function logSample(rows: object[], id = 'session-scripted') {
  // Separate frames reproduce dsh's append-only concatenated zstd container.
  const header = { type: 'session', version: 4, id, createdAt: 1, cwd: '/test', isSeeded: false, delegationDepth: 0 };
  return Buffer.concat([header, ...rows].map(row => {
    const bytes = Buffer.from(`${JSON.stringify(row)}\n`);
    if (typeof zlib.zstdCompressSync === 'function') return zlib.zstdCompressSync(bytes);
    // Node 22.13 has no compressor: construct one small uncompressed zstd
    // block, with a single-segment frame and explicit content size.
    const frame = Buffer.alloc(bytes.length < 256 ? 6 : 7);
    frame.writeUInt32LE(0xfd2fb528);
    frame[4] = bytes.length < 256 ? 0x20 : 0x60;
    if (bytes.length < 256) frame[5] = bytes.length; else frame.writeUInt16LE(bytes.length - 256, 5);
    const block = Buffer.alloc(3);
    block.writeUIntLE((bytes.length << 3) | 1, 0, 3);
    return Buffer.concat([frame, block, bytes]);
  }));
}

test('DeepSeek 在没有 Node 内置 zstd 的运行时用固定版本解码器读同一份样本', async t => {
  const sample = logSample([{ type: 'assistant/message', data: { usage: { inputTokens: 22, outputTokens: 7 } } }]);
  const builtin = createRequire(import.meta.url)('node:zlib');
  const previous = builtin.zstdDecompress;
  builtin.zstdDecompress = undefined;
  syncBuiltinESMExports();
  t.after(() => { builtin.zstdDecompress = previous; syncBuiltinESMExports(); });
  const ctx = await acpFixture(t, { configOptions, sessionLog: sample.toString('base64') }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('派单');
  const end = (await collect(session.events)).at(-1)!;
  assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 22, outputTokens: 7 });
});

test('DeepSeek 从关闭后刷盘的 v4 zstd 累加每步用量，缓存输入计入且嵌套 stream 不重复计数', async t => {
  const sessionLog = logSample([
    { type: 'assistant/message', data: { usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 70, cacheWriteTokens: 10, reasoningTokens: 4 },
      stream: [{ type: 'chunk', chunk: { type: 'usage', usage: { inputTokens: 30, outputTokens: 5, cacheReadTokens: 70, cacheWriteTokens: 10 } } }] } },
    { type: 'assistant/message', data: { usage: { inputTokens: 20, outputTokens: 4 } } },
  ]).toString('base64');
  const ctx = await acpFixture(t, { configOptions, sessionLog }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('多步派单');
  const end = (await collect(session.events)).at(-1)!;
  assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 130, outputTokens: 9 });
  assert.equal((await ctx.requests()).at(-1).method, 'session/close');
});

test('DeepSeek 续跑保持 id，仅计本次新增用量，使用新进程和新 MCP 令牌', async t => {
  const previous = { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 8 } } };
  const sessionLog = logSample([previous, { type: 'assistant/message', data: { usage: { inputTokens: 15, outputTokens: 3 } } }]).toString('base64');
  const ctx = await acpFixture(t, { configOptions, sessionLog }, true, 'deepseek');
  const path = join(ctx.home, '.dsh', 'sessions', '--fixture-project--', 'session-scripted');
  await mkdir(path, { recursive: true });
  await writeFile(join(path, 'session.v4.jsonl.zstd'), logSample([previous]));
  const session = await ctx.driver.start({ ...ctx.options, resumeSessionId: 'session-scripted',
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer resumed-token' } } } });
  await session.send('补充信息');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(session.id, 'session-scripted');
  assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 15, outputTokens: 3 });
  const requests = await ctx.requests();
  assert.equal(requests.some(r => r.method === 'session/new' || r.method === 'session/load'), false);
  assert.equal(requests.find(r => r.method === 'session/resume').params.mcpServers[0].headers[0].value, 'Bearer resumed-token');
  assert.equal(requests.filter(r => r.method === 'session/set_config_option').length, 2);
});

test('DeepSeek 账号执行者经 ACP 设置并核对模型路线和强度，强制卡片沙箱及禁止推送', async t => {
  const ctx = await acpFixture(t, { configOptions }, true, 'deepseek');
  ctx.options.env.DSH_HOME = '/must-not-inherit';
  ctx.options.env.DSH_PERMISSION_MODE = 'danger-full-access';
  ctx.options.env.DEEPSEEK_API_KEY = 'must-not-inherit';
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行派单');
  const events = await collect(session.events);
  const end = events.at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'completed');
  const [spawn, ...requests] = await ctx.requests();
  assert.deepEqual(spawn.args, ['--profile', 'acp']);
  assert.equal(spawn.env.HOME, ctx.home);
  assert.equal(spawn.env.DSH_HOME, undefined);
  assert.equal(spawn.env.DEEPSEEK_API_KEY, undefined);
  assert.equal(spawn.env.DSH_PERMISSION_MODE, 'workspace-write');
  assert.equal(spawn.env.GH_TOKEN, 'helm-push-disabled');
  assert.ok(Number(spawn.env.GIT_CONFIG_COUNT) > 0);
  assert.equal(requests.some(r => r.method === 'authenticate'), false);
  assert.deepEqual(requests.filter(r => r.method === 'session/set_config_option').map(r => r.params), [
    { sessionId: session.id, configId: 'model', value: '["deepseek-account","deepseek-flash"]' },
    { sessionId: session.id, configId: 'reasoning_effort', value: 'low' },
  ]);
  assert.deepEqual(requests.find(r => r.method === 'session/new').params.mcpServers, [
    { type: 'http', name: 'helm', url: 'http://127.0.0.1:4242/mcp', headers: [{ name: 'Authorization', value: 'Bearer dispatch-token' }] },
  ]);
  const builtin = new TemplateCatalog(undefined, ['deepseek']).get('deepseek-executor');
  assert.equal(builtin.model, 'deepseek-flash');
  assert.equal(builtin.reasoningEffort, 'low');
  assert.equal(builtin.home, 'shared');
});

test('DeepSeek API 模板使用各自专用 DSH_HOME，凭据只由 CLI 读取，按公布值选择 official 路线', async t => {
  const ctx = await acpFixture(t, { configOptions }, true, 'deepseek');
  for (const id of ['deepseek-api-one', 'deepseek-api-two']) {
    const template = { ...ctx.template, id, home: 'template' as const, model: 'deepseek-v4-flash', reasoningEffort: 'max' as const };
    const home = join(ctx.home, '.helm', 'agent-homes', id);
    const unavailable = await ctx.driver.checkAvailability(template);
    assert.equal(unavailable.available, false);
    assert.match(unavailable.reason!, /专用主目录/);
    assert.ok(unavailable.command!.includes(home) && unavailable.command!.includes('dsh web'));
    await mkdir(home, { recursive: true });
    assert.equal((await ctx.driver.checkAvailability(template)).available, false, '空 API 主目录缺少 CLI 配置或凭据文件');
    await writeFile(join(home, '.credentials.yaml'), 'fixture: CLI-owned-key\n', { mode: 0o600 });
    assert.equal((await ctx.driver.checkAvailability(template)).available, true);
    const session = await ctx.driver.start({ ...ctx.options, template });
    await session.send('API 派单');
    await collect(session.events);
  }
  const requests = await ctx.requests();
  const spawns = requests.filter(r => r.method === 'fixture/spawn');
  assert.deepEqual([...new Set(spawns.map(r => r.env.DSH_HOME))], ['deepseek-api-one', 'deepseek-api-two'].map(id => join(ctx.home, '.helm', 'agent-homes', id)));
  assert.ok(spawns.every(r => r.env.HOME === ctx.home && r.env.DEEPSEEK_API_KEY === undefined && r.env.DSH_PERMISSION_MODE === 'workspace-write'));
  const settings = requests.filter(r => r.method === 'session/set_config_option').map(r => r.params.value);
  assert.deepEqual(settings, ['["deepseek-official","deepseek-v4-flash"]', 'max', '["deepseek-official","deepseek-v4-flash"]', 'max']);
});

test('DeepSeek 拒绝调度者、未知模型、medium、fast 和计费路线与 home 不一致', async t => {
  const ctx = await acpFixture(t, { configOptions }, true, 'deepseek');
  const cases: [Partial<AgentTemplate>, RegExp][] = [
    [{ role: 'coordinator' }, /只支持执行者/], [{ model: null }, /模型 id/], [{ model: 'unknown' }, /unknown/],
    [{ reasoningEffort: 'medium' }, /不支持推理强度 medium/], [{ reasoningEffort: null }, /推理强度/],
    [{ fast: true }, /fast/],
    [{ home: 'template' }, /账号模型/], [{ model: 'deepseek-v4-flash' }, /专用主目录/],
  ];
  for (const [settings, reason] of cases) {
    const template = { ...ctx.template, ...settings };
    const result = await ctx.driver.checkAvailability(template);
    assert.equal(result.available, false);
    assert.match(result.reason!, reason);
    await assert.rejects(ctx.driver.start({ ...ctx.options, template }), reason);
  }
  assert.deepEqual(await ctx.requests(), []);
});

test('DeepSeek 不按显示名猜模型，拒绝未公布的模型/强度与配置核对失败，不发 prompt', async t => {
  for (const options of [[], [
    { ...configOptions[0], options: [{ value: 'wrong', name: 'deepseek-flash' }] }, configOptions[1],
  ], [configOptions[0], { ...configOptions[1], options: [{ value: 'high', name: 'low' }] }]]) {
    await t.test(JSON.stringify(options), async t => {
      const ctx = await acpFixture(t, { configOptions: options }, true, 'deepseek');
      await assert.rejects(ctx.driver.start(ctx.options), /没有公布取值/);
      assert.equal((await ctx.requests()).some(r => r.method === 'session/prompt'), false);
    });
  }
  const ctx = await acpFixture(t, { configOptions, configuredOptions: configOptions }, true, 'deepseek');
  await assert.rejects(ctx.driver.start(ctx.options), /与模板不一致/);
  assert.equal((await ctx.requests()).some(r => r.method === 'session/prompt'), false);
});

test('DeepSeek 按模型 id 和 provider 匹配选项原值，Pro/high 不会误选同名 API 项', async t => {
  const ctx = await acpFixture(t, { configOptions: [
    { ...configOptions[0], options: [
      { value: '["deepseek-official","deepseek-v4-pro"]', name: 'deepseek-v4-pro' },
      { value: '[ "deepseek-account", "deepseek-v4-pro" ]', name: '任意显示名' },
    ] }, configOptions[1],
  ] }, true, 'deepseek');
  const session = await ctx.driver.start({ ...ctx.options, template: { ...ctx.template, model: 'deepseek-v4-pro', reasoningEffort: 'high' } });
  await session.send('Pro');
  await collect(session.events);
  assert.deepEqual((await ctx.requests()).filter(r => r.method === 'session/set_config_option').map(r => r.params.value), ['[ "deepseek-account", "deepseek-v4-pro" ]', 'high']);
});

test('DeepSeek 可用性只做 initialize，无需认证；不可执行、拒绝或超时给安装和 dsh web 修复命令', async t => {
  const ctx = await acpFixture(t, { configOptions, initialize: { protocolVersion: 1, authMethods: [], agentCapabilities: { mcpCapabilities: { http: true } } } }, true, 'deepseek');
  assert.deepEqual(await ctx.driver.checkAvailability(ctx.template), { available: true });
  assert.deepEqual((await ctx.requests()).map(r => r.method), ['fixture/spawn', 'initialize']);
  await assert.rejects(stat(join(ctx.home, '.dsh')), { code: 'ENOENT' });
  const absent = new AcpDriver('deepseek', { command: { file: join(ctx.directory, 'absent'), args: [] } });
  const result = await absent.checkAvailability(ctx.template);
  assert.equal(result.available, false);
  assert.match(result.command!, /npm install -g @deepseek-ai\/dsh.*dsh web/);
  for (const script of [{ hangOn: 'initialize' }, { rejectOn: 'initialize' }, { initialize: { protocolVersion: 1, agentCapabilities: {} } }]) {
    await t.test(JSON.stringify(script), async t => {
      const ctx = await acpFixture(t, script, true, 'deepseek');
      const result = await new AcpDriver('deepseek', { command: ctx.command, timeoutMs: 500 }).checkAvailability(ctx.template);
      assert.equal(result.available, false);
      assert.match(result.reason!, /initialize.*dsh web/);
    });
  }
});

for (const [error, reason] of [
  [{ code: -32603, message: 'CONTEXT_WINDOW_EXCEEDED' }, 'context-overflow'],
  [{ code: -32603, message: 'turn failed', data: { code: 'CONTEXT_WINDOW_EXCEEDED' } }, 'context-overflow'],
  [{ code: -32603, message: 'ACCOUNT_QUOTA' }, 'quota-exhausted'],
  [{ code: -32603, message: 'Insufficient Balance' }, 'quota-exhausted'],
  [{ code: -32603, message: 'quota exceeded' }, 'quota-exhausted'],
  [{ code: -32603, message: 'connection reset' }, 'error'],
  [{ code: -32603, message: 'Sign in to DeepSeek: dsh web' }, 'error'],
] as const) test(`DeepSeek ACP 报错 ${error.message} 映射 ${reason} 并保留原因和已产生用量`, async t => {
  const sessionLog = logSample([{ type: 'assistant/message', data: { usage: { inputTokens: 8, outputTokens: 2 } } }]).toString('base64');
  const ctx = await acpFixture(t, { configOptions, sessionLog, rejectOn: 'session/prompt', error }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('派单');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type, 'end');
  if (end.type !== 'end') return;
  assert.equal(end.reason, reason);
  assert.ok(end.failure?.includes(error.message));
  assert.equal(end.finalAnswer, undefined);
  assert.deepEqual(end.usage, { inputTokens: 8, outputTokens: 2 });
});

for (const script of [{ exitOn: 'session/prompt' }, { malformedOn: 'session/prompt' }, { response: { stopReason: 'max_tokens' } }])
  test(`DeepSeek 崩溃或异常结束返回出错退出：${JSON.stringify(script)}`, async t => {
    const ctx = await acpFixture(t, { configOptions, ...script }, true, 'deepseek');
    const session = await ctx.driver.start(ctx.options);
    await session.send('派单');
    const end = (await collect(session.events)).at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'error');
    assert.ok(end.type === 'end' && end.failure);
  });

test('DeepSeek 取消发送一次 session/cancel，关闭会话后保留用量并收尾进程', async t => {
  const sessionLog = logSample([{ type: 'assistant/message', data: { interrupted: true, usage: { inputTokens: 9, outputTokens: 1 } } }]).toString('base64');
  const ctx = await acpFixture(t, { configOptions, sessionLog, holdPrompt: true }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('等待中止');
  const collecting = collect(session.events);
  await until(ctx.requests, requests => requests.some(r => r.method === 'session/prompt'));
  session.cancel(); session.cancel();
  const end = (await collecting).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'aborted');
  assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 9, outputTokens: 1 });
  const requests = await ctx.requests();
  assert.equal(requests.filter(r => r.method === 'session/cancel').length, 1);
  assert.throws(() => process.kill(requests[0].pid, 0), { code: 'ESRCH' });
});

for (const mode of ['first', 'resume', 'ignores-cancel', 'timeout'] as const)
test(`DeepSeek 中止派单等待会话刷盘，保存本轮非零用量和 stdout 日志：${mode}`, async t => {
  const previous = { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 8 } } };
  const turn = { type: 'assistant/message', data: { interrupted: true, usage: { inputTokens: 6778, outputTokens: 204 } } };
  const script = { configOptions, sessionLog: logSample([...(mode === 'resume' ? [previous] : []), turn]).toString('base64'),
    holdPrompt: true, ignoreCancel: mode === 'ignores-cancel', closeDelayMs: 50,
    stdoutBefore: { 'session/new': ['[llm-deepseek-account] model listing from fixture loaded 2 model(s)\n'],
      'session/resume': ['续跑日志\n'] } };
  const acp = await acpFixture(t, mode === 'resume'
    ? { configOptions, sessionLog: logSample([previous]).toString('base64') } : script, false, 'deepseek');
  const daemon = await acpExecutorFixture(t, acp.driver, { agent: 'deepseek' });
  if (mode === 'timeout') ok(await daemon.call('set-dispatch-watchdog', { wallTimeoutMs: 30_000, idleTimeoutMs: 3000 }));
  await daemon.confirm();
  if (mode === 'resume') {
    const [first] = await daemon.ended();
    assert.deepEqual(first.usage, { inputTokens: 100, outputTokens: 8 });
    await until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
    await writeFile(join(acp.directory, 'script.json'), JSON.stringify({ record: join(acp.directory, 'requests.jsonl'), ...script }));
    daemon.actions.push([{ type: 'tool', name: 'create-dispatch', arguments: { workId: daemon.work.id, cardId: first.cardId,
      templateId: 'deepseek-executor', key: 'resume', resumeSessionId: first.sessionId, content: '续跑后中止' }, check: ok }]);
    ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'resume', body: '续跑' }));
  }
  const count = mode === 'resume' ? 2 : 1;
  await until(acp.requests, requests => requests.filter(r => r.method === 'session/prompt').length === count);
  const running = (await daemon.dispatches())[count - 1];
  if (mode !== 'timeout') ok(await daemon.call('pause-card', { workId: daemon.work.id, cardId: running.cardId }));
  const ended = (await daemon.ended(count))[count - 1];
  assert.equal(ended.endReason, mode === 'timeout' ? 'timed-out' : 'aborted');
  assert.equal(ended.abortReason, mode === 'timeout' ? null : '卡片暂停');
  assert.equal(ended.finalAnswer, null);
  assert.deepEqual(ended.usage, { inputTokens: 6778, outputTokens: 204 });
  const output = await daemon.output(ended.id);
  assert.ok(output.some(e => e.type === 'output' && JSON.parse(e.text).method === 'agent/stdout-log'));
  assert.deepEqual(output.find(e => e.type === 'end').usage, ended.usage);
  const event = (await daemon.events()).find(e => e.action === 'dispatch-ended' && e.dispatchId === ended.id);
  assert.deepEqual(event.details.usage, ended.usage);
  const requests = await acp.requests();
  assert.equal(requests.filter(r => r.method === 'session/close').length, count);
  assert.equal(requests.filter(r => r.method === 'session/cancel').length, 1);
  assert.throws(() => process.kill(running.pgid, 0), { code: 'ESRCH' });
});

test('DeepSeek 普通权限只放行一次，拒绝工具通过 sandbox_permissions 扩大卡片沙箱', async t => {
  const kinds = ['allow_always', 'allow_once', 'reject_once'];
  const permissions = Array.from({ length: 3 }, () => kinds.map(kind => ({ kind, name: kind, optionId: kind })));
  const ctx = await acpFixture(t, { configOptions, permissions, permissionToolCalls: [
    { toolCallId: 'ordinary', title: 'bash', rawInput: { command: 'echo inside' } },
    { toolCallId: 'escalation', title: 'bash', rawInput: { command: 'echo outside', sandbox_permissions: 'danger-full-access', justification: 'need outside access' } },
    { toolCallId: 'bounded', title: 'fs', rawInput: { sandbox_permissions: 'workspace-write' } },
  ] }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  await collect(session.events);
  const responses = (await ctx.requests()).filter(r => String(r.id).startsWith('agent-'));
  assert.deepEqual(responses.map(r => r.result.outcome), [
    { outcome: 'selected', optionId: 'allow_once' }, { outcome: 'selected', optionId: 'reject_once' }, { outcome: 'selected', optionId: 'allow_once' },
  ]);
});

for (const sample of [Buffer.from('invalid-zstd'), logSample([], 'wrong-session'), logSample([
  { type: 'assistant/message', data: { usage: { inputTokens: -1, outputTokens: 2 } } },
])]) test(`DeepSeek 用量文件异常可诊断且结束不挂起：${sample.toString('base64').slice(0, 20)}`, async t => {
  const ctx = await acpFixture(t, { configOptions, sessionLog: sample.toString('base64') }, true, 'deepseek');
  const session = await ctx.driver.start(ctx.options);
  await session.send('派单');
  const events = await collect(session.events);
  assert.equal(events.at(-1)?.type, 'end');
  assert.ok(events.some(e => e.type === 'output' && /用量读取失败/.test(e.text)));
});

test('DeepSeek 反问后 end_turn 正常完成、结论未声明，token 汇总到卡片和工作', async t => {
  const sessionLog = logSample([{ type: 'assistant/message', data: { usage: { inputTokens: 45, outputTokens: 6 } } }]).toString('base64');
  const acp = await acpFixture(t, { configOptions, sessionLog,
    updates: [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '请补充需求范围？CONTEXT_WINDOW_EXCEEDED 只是回答文字。' } }],
  }, false, 'deepseek');
  const daemon = await acpExecutorFixture(t, acp.driver, { agent: 'deepseek' });
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'completed', dispatch.failure);
  assert.equal(dispatch.conclusion, 'undeclared');
  assert.match(dispatch.finalAnswer, /^请补充需求范围/);
  assert.deepEqual(dispatch.usage, { inputTokens: 45, outputTokens: 6 });
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
  assert.deepEqual(card.usage, { inputTokens: 45, outputTokens: 6 });
  assert.deepEqual((await daemon.call('get-work', { workId: daemon.work.id })).result.usage, { inputTokens: 45, outputTokens: 6 });
});

test('DeepSeek 上下文溢出的结束方式保存到派单结果，供调度者拆小卡片', async t => {
  const acp = await acpFixture(t, { configOptions, rejectOn: 'session/prompt', error: { code: -32603, message: 'CONTEXT_WINDOW_EXCEEDED' } }, false, 'deepseek');
  const daemon = await acpExecutorFixture(t, acp.driver, { agent: 'deepseek' });
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'context-overflow', dispatch.failure);
  assert.equal(dispatch.finalAnswer, null);
  assert.equal(dispatch.conclusion, 'undeclared');
});

test('DeepSeek 经假 ACP 调用同端点结论和浏览器，令牌生效且运行层提交卡片改动', async t => {
  const site = createServer((_request, response) => response.end('<h1>DeepSeek ACP fixture</h1>'));
  await new Promise<void>(resolve => site.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => site.close(() => resolve())));
  const address = site.address();
  assert.ok(address && typeof address !== 'string');
  const acp = await acpFixture(t, { configOptions, writes: [{ path: 'inside.txt', content: 'DeepSeek\n' }], mcpTools: [
    { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${address.port}` } },
    { name: 'browser_take_screenshot', arguments: { filename: 'deepseek.png', type: 'png' } },
    { name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '假 ACP 工具检查通过' } },
  ] }, false, 'deepseek');
  const daemon = await acpExecutorFixture(t, acp.driver, { agent: 'deepseek', needsBrowser: true });
  await daemon.confirm();
  const [dispatch] = await daemon.ended();
  assert.equal(dispatch.endReason, 'completed', dispatch.failure);
  assert.equal(dispatch.conclusion, 'completed');
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatch.cardId })).result;
  assert.equal(daemon.git('show', `${card.cardBranch}:inside.txt`), 'DeepSeek');
  assert.ok((await acp.requests()).filter(r => r.method === 'fixture/spawn').every(r => r.env.HOME === daemon.home));
  assert.equal((await acp.requests()).filter(r => r.method === 'fixture/mcp').length, 3);
});

test('startHelmd 默认登记 DeepSeek，调度者模板列为不可用并显示原因（CLI 替身）', async t => {
  const acp = await acpFixture(t, { configOptions }, true, 'deepseek');
  const bin = join(acp.directory, 'bin');
  await mkdir(bin);
  const fixture = fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url));
  const executable = join(bin, 'dsh');
  await writeFile(executable, `#!${process.execPath}\nprocess.argv.splice(1, 1, ${JSON.stringify(fixture)}, ${JSON.stringify(join(acp.directory, 'script.json'))});\nimport(${JSON.stringify(pathToFileURL(fixture).href)});\n`);
  await chmod(executable, 0o755);
  const previousPath = process.env.PATH;
  process.env.PATH = `${bin}:${previousPath}`;
  t.after(() => { if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath; });
  const templateDir = join(acp.directory, 'templates');
  await cp(join(defaultTemplateDir, 'deepseek-executor'), join(templateDir, 'deepseek-executor'), { recursive: true });
  await cp(join(defaultTemplateDir, 'deepseek-executor'), join(templateDir, 'deepseek-coordinator'), { recursive: true });
  const path = join(templateDir, 'deepseek-coordinator', 'config.json');
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), role: 'coordinator' }));
  const daemon = await startHelmd({ port: 0, dataDir: join(acp.directory, 'data'), templateDir });
  try {
    const call = async (name: string) => (await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', body: '{}' })).json() as any).result;
    const templates = await call('list-agent-templates');
    assert.equal(templates.find((t: any) => t.id === 'deepseek-executor').available, true);
    assert.equal(templates.find((t: any) => t.id === 'deepseek-coordinator').available, false);
    assert.match((await call('list-pending')).find((p: any) => p.templateId === 'deepseek-coordinator').reason, /只支持执行者/);
    assert.throws(() => new TemplateCatalog(templateDir, ['deepseek']).get('deepseek-coordinator'), /只支持执行者/);
    assert.ok((await acp.requests()).every(r => ['fixture/spawn', 'initialize'].includes(r.method)));
  } finally { await daemon.close(); }
});
