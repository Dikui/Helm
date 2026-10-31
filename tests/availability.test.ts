import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type FakeContext, type FakeStep, type AgentAvailability } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { smokeVersions } from '../src/availability.js';
import { copyAgents } from './helmd-fixture.js';
import { until } from './claude-coordinator-fixture.js';

const unavailable = { available: false, reason: '默认主目录未登录', command: 'claude auth login' };
const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

async function fixture(t: TestContext, initial: Record<string, AgentAvailability> = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-availability-')));
  const agentDir = await copyAgents(directory);
  const states = new Map(Object.entries(initial));
  const probes = new Map<string, () => Promise<AgentAvailability>>();
  const actions: ((ctx: FakeContext) => FakeStep[])[] = [];
  const executors: FakeStep[][] = [];
  const started: string[] = [];
  const driver = new FakeDriver(Array(40).fill((ctx: FakeContext): FakeStep[] => {
    started.push(ctx.options.agent!.id);
    if (ctx.options.agent!.role === 'executor') return executors.shift() ?? [];
    const work = JSON.parse(ctx.input).work;
    if (work.status === 'aligning') return [{ type: 'tool', name: 'draft-work-description', arguments: {
      workId: work.id, key: 'draft', requirements: '可用性检查', boundary: '假驱动', criteria: '拒绝不可用 Agent 并恢复',
    }, check: ok }];
    return actions.shift()?.(ctx) ?? [];
  }), agent => probes.get(agent.id)?.() ?? states.get(agent.id) ?? { available: true });
  const options = { port: 0, dataDir: join(directory, 'data'), agentDir, drivers: { 'claude-sdk': driver, codex: new FakeDriver() } };
  let daemon = await startHelmd(options);
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}): Promise<any> => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    return response.json();
  };
  const events = async (): Promise<any[]> => (await call('get-events')).result;
  const idle = () => until(events, items => items.some(e => e.action === 'round-ended')
    && items.filter(e => e.action === 'round-started').length === items.filter(e => e.action === 'round-ended').length);
  const startWork = async () => {
    const repo = join(directory, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    await writeFile(join(repo, 'README.md'), 'baseline\n');
    execFileSync('git', ['-C', repo, 'add', 'README.md']);
    execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=test@helm.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
    const project = (await call('register-project', { path: repo })).result;
    const work = (await call('send-message', { projectId: project.id, key: 'start', body: '开始' })).result.work;
    await idle();
    return work;
  };
  return { ...daemon, directory, states, probes, actions, executors, started, call, events, idle, startWork,
    async restart() { await daemon.close(); daemon = await startHelmd(options); } };
}

function dispatchSteps(expected: boolean): (ctx: FakeContext) => FakeStep[] {
  return ctx => {
    const workId = JSON.parse(ctx.input).work.id;
    return [
      { type: 'tool', name: 'list-agents', arguments: { workId }, check: (value: any) => {
        ok(value);
        assert.equal(value.result.find((t: any) => t.id === 'claude-executor').available, expected);
      } },
      { type: 'tool', name: 'create-card', arguments: { workId, key: 'card', content: '执行' }, saveAs: 'card', check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId, key: 'dispatch', agentId: 'claude-executor', cardId: (ctx.results.get('card') as any).result.id }),
        check: (value: any) => {
          assert.equal(value.ok, expected, JSON.stringify(value));
          if (!expected) {
            assert.equal(value.error.code, 'AGENT_UNAVAILABLE');
            assert.equal(value.error.details.command, unavailable.command);
          }
        } },
    ];
  };
}

test('启动检查 Agent，原因进入待处理和事件并去重；MCP 拒绝派单，修复后无须重启', async t => {
  const daemon = await fixture(t, { 'claude-executor': unavailable });
  const notices = async () => (await daemon.events()).filter(e => e.action === 'needs-user-attention' && e.details.agentId === 'claude-executor');
  assert.equal((await notices()).length, 1, '启动时已检查');
  for (let i = 0; i < 2; i++) {
    const agents = (await daemon.call('list-agents')).result;
    const item = agents.find((t: any) => t.id === 'claude-executor');
    assert.equal(item.available, false);
    assert.equal(item.reason, unavailable.reason);
    assert.equal(item.command, unavailable.command);
    const pending = (await daemon.call('list-pending')).result.find((p: any) => p.agentId === item.id);
    assert.equal(pending.reason, unavailable.reason);
    assert.equal(pending.command, unavailable.command);
  }
  assert.equal((await notices()).length, 1);
  await daemon.restart();
  assert.equal((await notices()).length, 1, '重启不重复通知同一原因');
  const work = await daemon.startWork();
  daemon.actions.push(dispatchSteps(false));
  const gate = (await daemon.call('list-pending')).result.find((g: any) => g.workId === work.id);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await daemon.idle();
  assert.deepEqual((await daemon.call('list-dispatches', { workId: work.id })).result, []);
  assert.ok((await daemon.events()).some(e => e.action === 'operation-rejected' && e.details.code === 'AGENT_UNAVAILABLE'));
  assert.equal((await notices()).length, 1);
  daemon.states.set('claude-executor', { available: true });
  daemon.actions.push(dispatchSteps(true));
  ok(await daemon.call('send-message', { workId: work.id, key: 'retry', body: '已登录' }));
  await until(async () => (await daemon.call('list-dispatches', { workId: work.id })).result as any[], items => items.length === 1 && items[0].status === 'ended');
  assert.ok(daemon.started.includes('claude-executor'));
  assert.equal((await daemon.call('list-pending')).result.some((p: any) => p.agentId === 'claude-executor'), false);
  daemon.states.set('claude-executor', { ...unavailable, reason: 'settings.json 缺失' });
  await daemon.call('recheck-agent', { id: 'claude-executor' });
  await daemon.call('recheck-agent', { id: 'claude-executor' });
  assert.equal((await notices()).length, 2, '新原因只通知一次');
  daemon.states.set('claude-executor', { available: false, reason: 'settings.json 缺失', command: '更新后的配置命令' });
  await daemon.call('recheck-agent', { id: 'claude-executor' });
  assert.equal((await notices()).length, 2, '仅命令变化不重复通知同一原因');
});

test('异步可用性检查期间的重复派单仍按 key 去重，关闭时等待检查且不启动迟到会话', async t => {
  const daemon = await fixture(t);
  const work = await daemon.startWork();
  let endRound!: () => void;
  const roundHold = new Promise<void>(resolve => { endRound = resolve; });
  t.after(() => endRound());
  let authorization = '';
  daemon.actions.push(ctx => {
    authorization = ctx.options.mcpServers.helm!.headers.Authorization!;
    return [
      { type: 'tool', name: 'create-card', arguments: { workId: work.id, key: 'card', content: '并发派单' }, check: ok },
      { type: 'hang', until: roundHold },
    ];
  });
  const gate = (await daemon.call('list-pending')).result.find((g: any) => g.workId === work.id);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const cards = await until(async () => (await daemon.call('get-card-graph', { workId: work.id })).result as any[], items => items.some(item => item.type === 'card'));
  const card = cards.find(item => item.type === 'card');
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  let checked = 0;
  daemon.probes.set('claude-executor', async () => { checked++; await hold; return { available: true }; });
  const dispatch = () => fetch(`${daemon.url}/api/create-dispatch`, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: authorization },
    body: JSON.stringify({ workId: work.id, cardId: card.id, key: 'dispatch', agentId: 'claude-executor' }) }).then(response => response.json() as Promise<any>);
  const first = dispatch();
  const duplicate = dispatch();
  await until(async () => checked, count => count === 2);
  release();
  const results = await Promise.all([first, duplicate]);
  results.forEach(ok);
  assert.equal(results[0].result.id, results[1].result.id);
  await until(async () => (await daemon.call('list-dispatches', { workId: work.id })).result as any[], items => items.length === 1 && items[0].status === 'ended');
  // Hold a fresh inspection across shutdown; no CLI/session may outlive the store.
  let finishProbe!: () => void;
  const finalProbe = new Promise<void>(resolve => { finishProbe = resolve; });
  t.after(() => finishProbe());
  daemon.probes.set('claude-executor', async () => { checked++; await finalProbe; return unavailable; });
  const before = checked;
  const listing = daemon.call('recheck-agent', { id: 'claude-executor' }).catch(() => undefined);
  await until(async () => checked, count => count > before);
  let closed = false;
  const closing = daemon.close().then(() => { closed = true; });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(closed, false, '数据库关闭前须等待可用性检查');
  finishProbe();
  await Promise.all([closing, listing]);
});

test('排队期间 Agent 变为不可用，实际启动前再次检查，不拉起执行者', async t => {
  const daemon = await fixture(t);
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  t.after(() => release());
  daemon.executors.push([{ type: 'hang', until: hold }]);
  ok(await daemon.call('set-concurrency', { limit: 1 }));
  const work = await daemon.startWork();
  daemon.actions.push(ctx => ['first', 'second'].flatMap(key => [
    { type: 'tool' as const, name: 'create-card', arguments: { workId: work.id, key, content: key }, saveAs: key, check: ok },
    { type: 'tool' as const, name: 'create-dispatch', arguments: (ctx: FakeContext) => ({ workId: work.id, key, agentId: 'claude-executor', cardId: (ctx.results.get(key) as any).result.id }), check: ok },
  ]));
  const gate = (await daemon.call('list-pending')).result.find((g: any) => g.workId === work.id);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await daemon.call('list-dispatches', { workId: work.id })).result;
  await until(dispatches, items => items.length === 2 && items[0].status === 'running' && items[1].status === 'queued');
  daemon.states.set('claude-executor', unavailable);
  release();
  const ended = await until(dispatches, items => items.length === 2 && items.every(item => item.status === 'ended'));
  assert.equal(ended[1].endReason, 'error');
  assert.equal(ended[1].startCommit, null);
  assert.equal(ended[1].endCommit, null);
  assert.equal(daemon.started.filter(id => id === 'claude-executor').length, 1);
  const event = (await daemon.events()).find(e => e.action === 'dispatch-ended' && e.dispatchId === ended[1].id);
  assert.equal(event.details.error.code, 'AGENT_UNAVAILABLE');
});

test('调度者不可用立即暂停且不重试；修复后手动恢复工作，无须重启 helmd', async t => {
  const daemon = await fixture(t, { 'claude-coordinator': unavailable });
  const work = await daemon.startWork();
  const paused = (await daemon.call('get-work', { workId: work.id })).result;
  assert.equal(paused.status, 'paused');
  assert.match(paused.runtimePauseReason, /默认主目录未登录/);
  assert.equal(daemon.started.includes('claude-coordinator'), false);
  assert.equal((await daemon.events()).filter(e => e.action === 'round-started').length, 1);
  assert.ok((await daemon.call('list-pending')).result.some((p: any) => p.kind === 'runtime-pause' && p.workId === work.id));
  daemon.states.set('claude-coordinator', { available: true });
  ok(await daemon.call('resume-work', { workId: work.id }));
  await until(daemon.events, items => items.some(e => e.action === 'work-description-drafted'));
  assert.ok(daemon.started.includes('claude-coordinator'));
  assert.equal((await daemon.call('get-work', { workId: work.id })).result.status, 'aligning');
});

test('check-agent 和 check-environment 只在调用时检查 CLI，install-tool 只运行登记的命令', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-install-')));
  const bin = join(directory, 'bin');
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  const command = `mkdir -p '${bin}' && printf '#!/bin/sh\\n' > '${bin}/helm-fake-cli' && chmod +x '${bin}/helm-fake-cli' && echo installed`;
  const codex = Object.assign(new FakeDriver(), { install: { executable: 'helm-fake-cli', command, login: 'helm-fake-cli login' } });
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir: await copyAgents(directory),
    drivers: { 'claude-sdk': new FakeDriver(), codex } });
  t.after(async () => { process.env.PATH = path; await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}): Promise<any> =>
    (await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json();
  assert.deepEqual((await call('check-agent', { driver: 'codex' })).result, { installed: false, install: command });
  assert.deepEqual((await call('check-agent', { driver: 'claude-sdk' })).result, { installed: true, install: null });
  const environment = (await call('check-environment')).result;
  assert.deepEqual(environment.find((tool: any) => tool.name === 'codex'),
    { name: 'codex', executable: 'helm-fake-cli', installed: false, version: null, smokeVersion: smokeVersions().codex ?? null, install: command, login: 'helm-fake-cli login' });
  assert.equal(environment.at(-1).name, 'browser');
  assert.match(environment.at(-1).install, /install-browser' 'chromium' '--no-shell'$/);
  assert.equal((await call('install-tool', { name: 'claude-sdk' })).error.code, 'NOT_FOUND');
  assert.equal((await call('install-tool', { name: 'rm -rf' })).error.code, 'NOT_FOUND');
  const installed = await call('install-tool', { name: 'codex' });
  ok(installed);
  assert.match(installed.result.output, /installed/);
  assert.deepEqual((await call('check-agent', { driver: 'codex' })).result, { installed: true, install: null });
  assert.equal((await call('check-environment')).result.find((tool: any) => tool.name === 'codex').installed, true);
  assert.ok((await call('get-events')).result.some((event: any) => event.action === 'tool-installed' && event.object.id === 'codex'));
});

test('list-agent-models 将草稿 Agent 的主目录上下文交给驱动，不要求 Agent 已保存', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-model-context-')));
  const requested: unknown[] = [];
  const deepseek = Object.assign(new FakeDriver(), { listModels: async (agent?: unknown) => { requested.push(agent); return []; } });
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir: await copyAgents(directory),
    drivers: { 'claude-sdk': new FakeDriver(), deepseek } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const response = await fetch(`${daemon.url}/api/list-agent-models`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    driver: 'deepseek', agent: { id: 'draft-forwarder', home: 'dedicated' },
  }) });
  assert.equal(response.status, 200);
  assert.deepEqual(requested, [{ id: 'draft-forwarder', home: 'dedicated' }]);
});

test('list-agent-models 向驱动询问模型，驱动失败时返回结构化错误并提示去环境检查', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-models-')));
  const models = [{ id: null, label: 'Default', efforts: ['low', 'max'], defaultEffort: null }];
  const codex = Object.assign(new FakeDriver(), { listModels: async () => models });
  const grok = Object.assign(new FakeDriver(), { listModels: async () => { throw new Error('grok: command not found'); } });
  const daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir: await copyAgents(directory),
    drivers: { 'claude-sdk': new FakeDriver(), codex, grok } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (params: object): Promise<any> =>
    (await fetch(`${daemon.url}/api/list-agent-models`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json();
  assert.deepEqual((await call({ driver: 'codex' })).result, models);
  const failed = await call({ driver: 'grok' });
  assert.equal(failed.error.code, 'MODELS_UNAVAILABLE');
  assert.match(failed.error.reason, /「环境」.*command not found/);
  assert.equal((await call({ driver: 'claude-sdk' })).error.code, 'NOT_FOUND');
});
