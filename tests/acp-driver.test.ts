import assert from 'node:assert/strict';
import { test } from 'node:test';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { AcpDriver } from '../src/acp-driver.js';
import { TemplateCatalog, type AgentTemplate } from '../src/templates.js';
import { acpFixture, collect } from './acp-fixture.js';
import { until } from './browser-fixture.js';

test('Grok 一轮经 ACP v1 认证、带令牌的 HTTP MCP、模板提示词及卡片沙箱运行，返回最终回答和本轮 token', async t => {
  const ctx = await acpFixture(t);
  const processes: number[] = [];
  const session = await ctx.driver.start({ ...ctx.options, onProcess: process => { processes.push(process.pid); } });
  t.after(() => session.cancel());
  await session.send('实现派单');
  const events = await collect(session.events);
  assert.equal(session.id, 'session-scripted');
  assert.deepEqual(events.at(-1), { type: 'end', step: events.length, reason: 'completed', finalAnswer: '已完成', usage: { inputTokens: 120, outputTokens: 9 } });
  const [spawn, ...requests] = await ctx.requests();
  assert.deepEqual(processes, [spawn.pid]);
  assert.deepEqual(spawn.args, ['agent', '-m', 'grok-4.7', '--effort', 'low', 'stdio']);
  assert.equal(spawn.env.HOME, ctx.home);
  assert.equal(spawn.env.GROK_SANDBOX, 'workspace');
  assert.equal(spawn.env.XAI_API_KEY, undefined);
  assert.equal(spawn.env.GH_TOKEN, 'helm-push-disabled');
  assert.ok(Number(spawn.env.GIT_CONFIG_COUNT) > 0);
  assert.equal(spawn.cwd, ctx.cwd);
  assert.deepEqual(requests.map(r => r.method), ['initialize', 'authenticate', 'session/new', 'session/prompt']);
  assert.equal(requests[0].params.protocolVersion, 1);
  assert.equal(requests[0].params.clientCapabilities.terminal, false);
  assert.equal(requests[0].params.clientCapabilities.fs.writeTextFile, false);
  assert.deepEqual(requests[1].params, { methodId: 'cached_token' });
  assert.deepEqual(requests[2].params, { cwd: ctx.cwd, mcpServers: [{ type: 'http', name: 'helm',
    url: 'http://127.0.0.1:4242/mcp', headers: [{ name: 'Authorization', value: 'Bearer dispatch-token' }] }] });
  const prompt = requests[3].params.prompt;
  assert.equal(prompt[0].type, 'text');
  assert.match(prompt[0].text, /^测试策略/);
  assert.match(prompt[0].text, /submit-conclusion/);
  assert.match(prompt[0].text, /不要自己 git commit、不要改 git 配置/);
  assert.match(prompt[0].text, /不要自己安装或启动浏览器/);
  assert.deepEqual(prompt[1], { type: 'text', text: '实现派单' });
});

test('Grok 权限只选 allow_once；只有永久放行或拒绝项时拒绝并记录，不留下永久授权', async t => {
  const option = (kind: string) => ({ kind, name: kind, optionId: `option-${kind}` });
  const ctx = await acpFixture(t, { permissions: [
    ['allow_always', 'reject_always', 'allow_once', 'reject_once'].map(option),
    ['reject_always', 'reject_once'].map(option), ['allow_always'].map(option), ['reject_always'].map(option), [],
  ] });
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const events = await collect(session.events);
  const responses = (await ctx.requests()).filter(r => String(r.id).startsWith('agent-'));
  assert.deepEqual(responses.map(r => r.result.outcome), [
    { outcome: 'selected', optionId: 'option-allow_once' }, { outcome: 'selected', optionId: 'option-reject_once' },
    { outcome: 'cancelled' }, { outcome: 'cancelled' }, { outcome: 'cancelled' },
  ]);
  const decisions = events.filter(e => e.type === 'output').map(e => JSON.parse(e.text)).filter(e => e.method === 'session/request_permission');
  assert.deepEqual(decisions.map(d => d.allowed), [true, false, false, false, false]);
});

for (const stopReason of ['end_turn', 'max_tokens', 'max_turn_requests', 'refusal', 'cancelled']) test(`Grok 只按 stopReason ${stopReason} 判定结束，普通回答里的额度词不改变结果`, async t => {
  const ctx = await acpFixture(t, { updates: [
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '我已完成，但此段是工具前说明' } },
    { sessionUpdate: 'tool_call', toolCallId: 'tool-1', title: 'Read', status: 'completed' },
    { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '私有思考' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'quota exceeded ' } },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '只是回答文字' } },
  ], response: { stopReason } });
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  await assert.rejects(session.send('第二轮'), /already received/);
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type, 'end');
  if (end.type === 'end') {
    assert.equal(end.reason, stopReason === 'end_turn' ? 'completed' : stopReason === 'cancelled' ? 'aborted' : 'error');
    assert.equal(end.finalAnswer, stopReason === 'end_turn' ? 'quota exceeded 只是回答文字' : undefined);
    assert.deepEqual(end.usage, { inputTokens: 0, outputTokens: 0 });
  }
});

test('Grok max 同义下发 xhigh；每次派单新开进程，默认主目录没有重定向或复制登录', async t => {
  const ctx = await acpFixture(t);
  ctx.options.template = { ...ctx.template, reasoningEffort: 'max' };
  ctx.options.env.GROK_HOME = '/must-not-use';
  for (let round = 0; round < 2; round++) {
    const session = await ctx.driver.start(ctx.options);
    await session.send('派单');
    assert.equal((await collect(session.events)).at(-1)?.type, 'end');
  }
  const spawns = (await ctx.requests()).filter(r => r.method === 'fixture/spawn');
  assert.equal(new Set(spawns.map(r => r.pid)).size, 2);
  for (const spawn of spawns) {
    assert.deepEqual(spawn.args, ['agent', '-m', 'grok-4.7', '--effort', 'xhigh', 'stdio']);
    assert.equal(spawn.env.GROK_HOME, undefined);
    assert.equal(spawn.env.HOME, ctx.home);
  }
  await assert.rejects(stat(join(ctx.home, '.helm')), { code: 'ENOENT' });
  await assert.rejects(stat(join(ctx.home, '.grok')), { code: 'ENOENT' });
});

test('Grok 模板拒绝调度者、未指定模型、不支持的推理档位、fast、API 主目录和未接入的 skills', async t => {
  const ctx = await acpFixture(t);
  const cases: [Partial<AgentTemplate>, RegExp][] = [
    [{ role: 'coordinator' }, /本阶段只支持执行者/], [{ model: null }, /模型 id/],
    [{ reasoningEffort: null }, /推理强度/], [{ reasoningEffort: 'minimal' as AgentTemplate['reasoningEffort'] }, /不支持推理强度/],
    [{ fast: true }, /fast/], [{ home: 'template' }, /本机登录/], [{ skillsPath: join(ctx.directory, 'skills') }, /skills/],
  ];
  for (const [settings, reason] of cases) {
    const template = { ...ctx.template, ...settings };
    const availability = await ctx.driver.checkAvailability(template);
    assert.equal(availability.available, false);
    assert.match(availability.reason!, reason);
    await assert.rejects(ctx.driver.start({ ...ctx.options, template }), reason);
  }
  assert.deepEqual(await ctx.requests(), [], '无效模板不启动进程');
  const builtin = new TemplateCatalog(undefined, ['grok']).get('grok-executor', 'executor');
  assert.equal(builtin.model, 'grok-4.7');
  assert.equal(builtin.reasoningEffort, 'low');
  assert.equal(builtin.home, 'shared');
});

test('Grok 可用性只完成 initialize 并检查 cached_token / HTTP MCP，不认证、不建会话、不读取凭据', async t => {
  const ctx = await acpFixture(t);
  assert.deepEqual(await ctx.driver.checkAvailability(ctx.template), { available: true });
  const [spawn, ...requests] = await ctx.requests();
  assert.equal(spawn.env.HOME, ctx.home);
  assert.deepEqual(requests.map(r => r.method), ['initialize']);
  await assert.rejects(stat(join(ctx.home, '.grok')), { code: 'ENOENT' });
});

for (const initialize of [
  { protocolVersion: 1, authMethods: [] },
  { protocolVersion: 1, authMethods: [{ id: 'cached_token', name: 'Login' }], agentCapabilities: {} },
  { protocolVersion: 2 },
]) test(`Grok 缺少协议能力时不可用并提供安装/登录命令：${JSON.stringify(initialize)}`, async t => {
  const ctx = await acpFixture(t, { initialize });
  const result = await ctx.driver.checkAvailability(ctx.template);
  assert.equal(result.available, false);
  assert.match(result.reason!, /initialize/);
  assert.match(result.command!, /install.*grok login/);
  assert.equal((await ctx.requests()).some(r => r.method === 'authenticate'), false);
});

test('Grok CLI 不存在、initialize 拒绝或超时均不可用并收尾；第一轮认证失败不宣称已登录', async t => {
  const ctx = await acpFixture(t);
  const absent = new AcpDriver('grok', { command: { file: join(ctx.directory, 'absent'), args: [] } });
  assert.equal((await absent.checkAvailability(ctx.template)).available, false);
  for (const script of [{ rejectOn: 'initialize' }, { hangOn: 'initialize' }, { exitOn: 'initialize' }]) {
    await t.test(JSON.stringify(script), async t => {
      const scenario = await acpFixture(t, script);
      const driver = new AcpDriver('grok', { command: scenario.command, timeoutMs: 500 });
      assert.equal((await driver.checkAvailability(scenario.template)).available, false);
    });
  }
  await t.test('未登录', async t => {
    const auth = await acpFixture(t, { rejectOn: 'authenticate' });
    assert.equal((await auth.driver.checkAvailability(auth.template)).available, true);
    await assert.rejects(auth.driver.start(auth.options), /scripted ACP failure/);
  });
});

test('Grok 沙箱根必须恰为卡片副本，拒绝只读或额外根', async t => {
  const ctx = await acpFixture(t);
  for (const sandbox of [
    { mode: 'read-only' as const, writableRoots: [] },
    { mode: 'workspace-write' as const, writableRoots: [ctx.cwd, ctx.home] },
    { mode: 'workspace-write' as const, writableRoots: [ctx.home] },
  ]) await assert.rejects(ctx.driver.start({ ...ctx.options, sandbox }), /card copy/);
  assert.deepEqual(await ctx.requests(), []);
});

test('Grok 续跑在新进程用 session/resume，保持会话 id 并更新本次派单的 HTTP MCP 令牌', async t => {
  const ctx = await acpFixture(t, { uniqueSession: true });
  const first = await ctx.driver.start(ctx.options);
  await first.send('第一轮');
  await collect(first.events);
  const headers = { Authorization: 'Bearer resumed-dispatch-token' };
  const resumed = await ctx.driver.start({ ...ctx.options, resumeSessionId: first.id,
    mcpServers: { helm: { ...ctx.options.mcpServers.helm!, headers } } });
  assert.equal(resumed.id, first.id);
  await resumed.send('打回修改');
  assert.equal((await collect(resumed.events)).at(-1)?.type, 'end');
  const requests = await ctx.requests();
  const spawns = requests.filter(r => r.method === 'fixture/spawn');
  assert.notEqual(spawns[0].pid, spawns[1].pid);
  assert.equal(requests.filter(r => r.method === 'session/new').length, 1);
  assert.equal(requests.some(r => r.method === 'session/load'), false);
  assert.deepEqual(requests.find(r => r.method === 'session/resume').params, {
    sessionId: first.id, cwd: ctx.cwd, mcpServers: [{ type: 'http', name: 'helm',
      url: 'http://127.0.0.1:4242/mcp', headers: [{ name: 'Authorization', value: headers.Authorization }] }],
  });
});

test('ACP 未声明 resume 能力时明确拒绝续跑，不悄悄新开或回退到 session/load', async t => {
  const ctx = await acpFixture(t, { resume: false });
  await assert.rejects(ctx.driver.start({ ...ctx.options, resumeSessionId: 'previous' }), /session\/resume/);
  assert.equal((await ctx.requests()).some(r => r.method.startsWith('session/')), false);
});

for (const mode of ['cancel', 'signal', 'ignores-cancel', 'racing-completion'] as const) test(`Grok 进行中中止 ${mode} 只发一次 session/cancel，返回被中止并收尾进程`, { timeout: 10_000 }, async t => {
  const ctx = await acpFixture(t, { holdPrompt: true, ignoreCancel: mode === 'ignores-cancel',
    ...(mode === 'racing-completion' ? { cancelResponse: { stopReason: 'end_turn' } } : {}) });
  const controller = new AbortController();
  const session = await ctx.driver.start({ ...ctx.options, signal: controller.signal });
  t.after(() => session.cancel());
  await session.send('执行中等待取消');
  const collecting = collect(session.events);
  await until(ctx.requests, requests => requests.some(r => r.method === 'session/prompt'));
  if (mode === 'signal') controller.abort(); else session.cancel();
  session.cancel();
  const events = await collecting;
  const end = events.at(-1)!;
  assert.equal(events.filter(e => e.type === 'end').length, 1);
  assert.equal(end.type === 'end' && end.reason, 'aborted');
  assert.equal(end.type === 'end' && end.finalAnswer, undefined);
  if (mode === 'cancel' || mode === 'signal') assert.deepEqual(end.type === 'end' && end.usage, { inputTokens: 12, outputTokens: 3 });
  const requests = await ctx.requests();
  const cancels = requests.filter(r => r.method === 'session/cancel');
  assert.equal(cancels.length, 1);
  assert.equal(cancels[0].id, undefined, '取消是通知，不等待 RPC 响应');
  assert.deepEqual(cancels[0].params, { sessionId: session.id });
  assert.throws(() => process.kill(requests[0].pid, 0), { code: 'ESRCH' });
});

for (const method of ['initialize', 'authenticate', 'session/new', 'session/resume']) test(`ACP 在 ${method} 启动中被中止也关闭已登记进程，不发送 prompt`, async t => {
  const ctx = await acpFixture(t, { hangOn: method });
  const controller = new AbortController();
  const starting = ctx.driver.start({ ...ctx.options, signal: controller.signal,
    ...(method === 'session/resume' ? { resumeSessionId: 'old-session' } : {}) });
  const rejected = assert.rejects(starting);
  await until(ctx.requests, requests => requests.some(r => r.method === method));
  controller.abort();
  await rejected;
  const requests = await ctx.requests();
  assert.equal(requests.some(r => r.method === 'session/prompt'), false);
  assert.throws(() => process.kill(requests[0].pid, 0), { code: 'ESRCH' });
});

for (const script of [{ rejectOn: 'session/prompt' }, { exitOn: 'session/prompt' }]) test(`Grok 缺少成功的 prompt 响应不会误报完成：${JSON.stringify(script)}`, async t => {
  const ctx = await acpFixture(t, script);
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'error');
  assert.equal(end.type === 'end' && end.finalAnswer, undefined);
});

for (const error of [
  { code: -32003, message: 'Rate limited' },
  { code: -32603, message: 'Internal error', data: 'subscription:free-usage-exhausted' },
  { code: -32603, message: 'Internal error', data: { message: 'You’ve hit the rate limit for your plan.' } },
  { code: -32603, message: 'quota exceeded' },
  { code: -32603, message: 'Internal error', data: 'connection reset' },
  { code: -32000, message: 'Authentication required', data: 'run grok login' },
]) test(`Grok 只从 ACP 错误匹配额度，保留报错原因：${JSON.stringify(error)}`, async t => {
  const ctx = await acpFixture(t, { rejectOn: 'session/prompt', error });
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, error.message === 'Authentication required' || error.data === 'connection reset' ? 'error' : 'quota-exhausted');
  assert.equal(end.type === 'end' && end.finalAnswer, undefined);
  assert.match(end.type === 'end' && 'failure' in end ? String(end.failure) : '', new RegExp(error.message));
  if (error.data) assert.ok(JSON.stringify(end).includes(typeof error.data === 'string' ? error.data : error.data.message));
});

for (const script of [{ exitOn: 'session/prompt' }, { response: { stopReason: 42 } }, { response: { stopReason: 'refusal' } }]) test(`ACP 崩溃、协议或异常结束均给出原因：${JSON.stringify(script)}`, async t => {
  const ctx = await acpFixture(t, script);
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'error');
  assert.ok(end.type === 'end' && 'failure' in end && end.failure);
});

test('Grok 私有 auto_compact_started 为当前会话记一条压缩事件，不把完成或别的会话通知重复计入', async t => {
  const ctx = await acpFixture(t, { notifications: [
    { method: '_x.ai/session/update', params: { update: { sessionUpdate: 'auto_compact_started', tokens_used: 850, context_window: 1000, percentage: 85, reason: 'threshold' } } },
    { method: '_x.ai/session/update', params: { update: { sessionUpdate: 'auto_compact_completed', tokens_before: 850 } } },
    { method: '_x.ai/session/update', params: { sessionId: 'other', update: { sessionUpdate: 'auto_compact_started' } } },
  ] });
  const session = await ctx.driver.start(ctx.options);
  await session.send('执行');
  const events = await collect(session.events);
  assert.equal(events.filter(e => e.type === 'compaction').length, 1);
  assert.equal(events.at(-1)?.type === 'end' && (events.at(-1) as any).reason, 'completed');
});

for (const script of [{ response: null }, { malformedOn: 'session/prompt' }]) test(`ACP 协议畸形也结束为出错退出，不挂到看门狗超时：${JSON.stringify(script)}`, async t => {
  const ctx = await acpFixture(t, script);
  const controller = new AbortController();
  const session = await ctx.driver.start({ ...ctx.options, signal: controller.signal });
  const timer = setTimeout(() => controller.abort(), 1500);
  t.after(() => { clearTimeout(timer); session.cancel(); });
  await session.send('执行');
  const end = (await collect(session.events)).at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'error');
  assert.ok(end.type === 'end' && end.failure);
  assert.equal(controller.signal.aborted, false, '驱动必须自行识别协议错误');
});

test('Grok 按 initialize 公布的模型与各模型推理档位检查可用性，不把无效组合悄悄换档', async t => {
  const ctx = await acpFixture(t);
  for (const settings of [{ model: 'unknown-model' }, { model: 'grok-4.5', reasoningEffort: 'max' as const }]) {
    const template = { ...ctx.template, ...settings };
    const result = await ctx.driver.checkAvailability(template);
    assert.equal(result.available, false);
    assert.match(result.reason!, settings.model === 'unknown-model' ? /unknown-model/ : /xhigh/);
    await assert.rejects(ctx.driver.start({ ...ctx.options, template }));
  }
  assert.equal((await ctx.driver.checkAvailability({ ...ctx.template, model: 'grok-4.5', reasoningEffort: 'medium' })).available, true);
  assert.equal((await ctx.requests()).some(r => r.method === 'authenticate'), false);
});

test('Grok 正常结束先关管道，忽略 TERM 的 ACP 进程在收尾期限后被强杀', async t => {
  const ctx = await acpFixture(t, { stubborn: true });
  const session = await ctx.driver.start(ctx.options);
  t.after(() => session.cancel());
  await session.send('执行');
  const events = await collect(session.events);
  const end = events.at(-1)!;
  assert.equal(end.type === 'end' && end.reason, 'completed');
  const spawn = (await ctx.requests())[0];
  assert.throws(() => process.kill(spawn.pid, 0), { code: 'ESRCH' }, '迭代器结束时进程必须已退出');
});
