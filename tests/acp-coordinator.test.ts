import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { acpAgents } from '../src/acp-agents.js';
import { credentialPaths } from '../src/driver.js';
import { roleRules } from '../src/prompts.js';
import { acpFixture, collect } from './acp-fixture.js';
import { acpCoordinatorFixture } from './acp-coordinator-fixture.js';
import { until } from './claude-coordinator-fixture.js';

const configOptions = [
  { id: 'model', name: 'Model', type: 'select', currentValue: '["account","deepseek-flash"]',
    options: [{ value: '["account","deepseek-flash"]', name: 'Flash' }] },
  { id: 'reasoning_effort', name: 'Effort', type: 'select', currentValue: 'low',
    options: [{ value: 'low', name: 'Low' }] },
];

for (const kind of ['grok', 'deepseek'] as const) test(`${kind} 调度者在调度者目录以可写权限启动，保留轮次 MCP 和结束事件`, async t => {
  const ctx = await acpFixture(t, { ...(kind === 'deepseek' ? { configOptions,
    permissions: Array.from({ length: 3 }, () => ['allow_once', 'reject_once'].map(kind => ({ kind, name: kind, optionId: kind }))),
    permissionToolCalls: ['read-only', 'workspace-write', 'danger-full-access'].map(mode => ({
      toolCallId: mode, title: 'bash', rawInput: { sandbox_permissions: mode },
    })),
  } : {}), updates: [
    { sessionUpdate: 'plan', entries: [{ content: '读取工作并派单', priority: 'medium', status: 'completed' }] },
    { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '本轮已完成' } },
  ] }, true, kind);
  const agent = { ...ctx.agent, role: 'coordinator' as const, rules: roleRules('coordinator'), loadGlobalConfig: false };
  const cwd = join(ctx.directory, 'data', 'coordinator', 'work');
  await mkdir(cwd, { recursive: true });
  assert.equal((await ctx.driver.checkAvailability(agent)).available, true);
  for (const resumeSessionId of [undefined, 'previous']) {
    const session = await ctx.driver.start({ ...ctx.options, agent, cwd, resumeSessionId,
      env: { ...ctx.options.env, DSH_PERMISSION_MODE: 'read-only', GROK_SANDBOX: 'helm-read-only' },
      sandbox: { mode: 'workspace-write', writableRoots: [cwd] },
      mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: `Bearer round-${resumeSessionId ?? 'new'}` } } } });
    t.after(() => session.cancel());
    await session.send('处理本轮事件');
    const events = await collect(session.events);
    assert.deepEqual(events.find(event => event.type === 'plan')?.entries, [{ content: '读取工作并派单', status: 'completed' }]);
    const end = events.at(-1)!;
    assert.equal(end.type === 'end' && end.reason, 'completed');
    assert.equal(end.type === 'end' && end.finalAnswer, '本轮已完成');
  }
  const requests = await ctx.requests();
  for (const spawn of requests.filter(request => request.method === 'fixture/spawn')) {
    assert.equal(kind === 'grok' ? spawn.env.GROK_SANDBOX : spawn.env.DSH_PERMISSION_MODE, kind === 'grok' ? 'helm' : 'workspace-write');
  }
  const sessions = requests.filter(request => ['session/new', 'session/resume'].includes(request.method) && request.params.mcpServers.length);
  assert.ok(sessions.every(request => request.params.cwd === cwd));
  assert.ok(requests.filter(request => request.method === 'fixture/spawn' && request.cwd !== ctx.home).every(request => request.cwd === cwd));
  assert.deepEqual(sessions.map(request => request.params.mcpServers), ['new', 'previous'].map(id => [{
    type: 'http', name: 'helm', url: 'http://127.0.0.1:4242/mcp', headers: [{ name: 'Authorization', value: `Bearer round-${id}` }],
  }]));
  for (const request of requests.filter(request => request.method === 'session/prompt')) {
    assert.match(request.params.prompt[0].text, /^你是 Helm 调度者/);
    assert.deepEqual(request.params.prompt[1], { type: 'text', text: '处理本轮事件' });
  }
  for (const request of requests.filter(request => request.method === 'initialize')) {
    assert.deepEqual(request.params.clientCapabilities, { fs: { readTextFile: false, writeTextFile: false }, terminal: false });
  }
  if (kind === 'deepseek') assert.deepEqual(requests.filter(request => String(request.id).startsWith('agent-')).map(request => request.result.outcome.optionId),
    ['allow_once', 'allow_once', 'reject_once', 'allow_once', 'allow_once', 'reject_once'], '调度者可写当前目录，不能提到完全访问');
  if (kind === 'grok') {
    const profiles = await readFile(join(ctx.home, '.grok', 'sandbox.toml'), 'utf8');
    assert.match(profiles, /\[profiles\.helm\]\nextends = "workspace"/);
    assert.ok(profiles.includes(`deny = ${JSON.stringify(credentialPaths(ctx.home))}`));
  }
});

for (const kind of ['grok', 'deepseek'] as const) test(`${kind} 调度者拒绝错误可写根与未开放的调度者能力，不启动 CLI`, async t => {
  const ctx = await acpFixture(t, {}, true, kind);
  const agent = { ...ctx.agent, role: 'coordinator' as const };
  for (const sandbox of [{ mode: 'read-only' as const, writableRoots: [] },
    { mode: 'workspace-write' as const, writableRoots: [] }, { mode: 'workspace-write' as const, writableRoots: [join(ctx.cwd, '..')] },
    { mode: 'workspace-write' as const, writableRoots: [ctx.cwd, join(ctx.cwd, '..')] }, { mode: 'read-only' as const, writableRoots: [ctx.cwd] }]) {
    await assert.rejects(ctx.driver.start({ ...ctx.options, agent, sandbox }).then(session => {
      t.after(() => session.cancel()); return session;
    }), /coordinator/);
  }
  const capabilities = acpAgents[kind].capabilities;
  const previous = capabilities.coordinator;
  const reason = `${kind} 调度者真实冒烟未通过。`;
  Object.assign(capabilities, { coordinator: false, coordinatorUnavailableReason: reason });
  try {
    const availability = await ctx.driver.checkAvailability(agent);
    assert.equal(availability.available, false);
    assert.equal(availability.reason, reason);
    await assert.rejects(ctx.driver.start({ ...ctx.options, agent }), { message: reason });
  } finally { capabilities.coordinator = previous; Reflect.deleteProperty(capabilities, 'coordinatorUnavailableReason'); }
  assert.deepEqual(await ctx.requests(), []);
});

for (const kind of ['grok', 'deepseek'] as const) test(`${kind} ACP 调度者仅获得调度工具，不能经客户端写代码，续跑更换且结束后撤销轮次令牌`, async t => {
  const acp = await acpFixture(t, { ...(kind === 'deepseek' ? { configOptions } : {}), mcpTools: [
    { name: 'draft-work-description', arguments: { key: 'draft', requirements: '只读检查 README', boundary: '临时项目', criteria: '基线内容保持原样' } },
  ], clientRequests: [{ method: 'fs/write_text_file', params: { path: 'coordinator-write.txt', content: 'forbidden' } }],
  }, false, kind);
  const daemon = await acpCoordinatorFixture(t, kind, acp.driver);
  await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length === 1);
  await daemon.call('send-message', { ...daemon.params, key: 'again', body: '再读一次工作说明' });
  const events = await until(daemon.events, events => events.filter(event => event.action === 'round-ended').length === 2);
  assert.ok(events.filter(event => event.action === 'round-ended').every(event => event.details.reason === 'completed'));
  const requests = await acp.requests();
  const sessions = requests.filter(request => ['session/new', 'session/resume'].includes(request.method) && request.params.mcpServers.length);
  assert.deepEqual(sessions.map(request => request.method), ['session/new', 'session/resume']);
  assert.notEqual(sessions[0].params.mcpServers[0].headers[0].value, sessions[1].params.mcpServers[0].headers[0].value);
  for (const request of requests.filter(request => request.method === 'fixture/tools')) {
    const names = request.result.tools.map((tool: any) => tool.name);
    assert.ok(names.includes('draft-work-description') && names.includes('create-dispatch') && names.includes('request-review'));
    assert.ok(!names.includes('submit-conclusion') && !names.includes('save-agent') && !names.some((name: string) => name.startsWith('browser_')));
  }
  const clientResponses = requests.filter(request => String(request.id).startsWith('agent-'));
  assert.equal(clientResponses.length, 2);
  assert.ok(clientResponses.every(request => request.error?.code === -32601), '客户端没有文件写入处理器');
  for (const session of sessions) {
    const response = await fetch(`${daemon.url}/api/get-work`, { method: 'POST', headers: { 'content-type': 'application/json',
      Authorization: session.params.mcpServers[0].headers[0].value }, body: JSON.stringify(daemon.params) });
    assert.equal(response.status, 401);
  }
  await assert.rejects(readFile(join(daemon.repo, 'coordinator-write.txt')), { code: 'ENOENT' });
  assert.equal(daemon.git('status', '--porcelain'), '');
});

test('Grok 声明支持调度者且没有不可用原因，通过 CLI 预检', async t => {
  const ctx = await acpFixture(t);
  const agent = { ...ctx.agent, role: 'coordinator' as const };
  assert.equal(ctx.driver.capabilities.coordinator, true);
  assert.equal(Object.hasOwn(ctx.driver.capabilities, 'coordinatorUnavailableReason'), false);
  assert.deepEqual(await ctx.driver.checkAvailability(agent), { available: true });
  assert.ok((await ctx.requests()).some(request => request.method === 'initialize'));
});
