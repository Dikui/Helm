import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { copyAgents } from './helmd-fixture.js';

const exec = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

async function startDaemon(t: TestContext, dataDir: string) {
  const home = join(dataDir, '..', 'home');
  await mkdir(home, { recursive: true });
  const child = spawn(process.execPath, [cliPath, 'serve', '--port', '0', '--data-dir', dataDir], {
    stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, HOME: home, HELM_FAKE_COORDINATOR: '1' },
  });
  let stderr = '';
  child.stderr!.on('data', chunk => { stderr += chunk; });
  t.after(() => stopDaemon(child));
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`helmd did not start: ${stderr}`)); }, 10_000);
    const lines = createInterface({ input: child.stdout! });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`helmd exited ${code}: ${stderr}`)); });
    lines.once('line', line => {
      clearTimeout(timer);
      try { resolve(JSON.parse(line).url); } catch (error) { reject(error); }
    });
  });
  return {
    url,
    child,
    async call(name: string, params: object = {}) {
      const response = await fetch(`${url}/api/${name}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params),
      });
      return { status: response.status, body: await response.json() as any };
    },
  };
}

async function stopDaemon(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 3_000);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function fixture(t: TestContext) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-test-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = join(directory, 'project');
  await exec('git', ['init', '-b', 'main', repo]);
  await exec('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '--allow-empty', '-m', 'baseline']);
  const dataDir = join(directory, 'data');
  await copyAgents(dataDir);
  const daemon = await startDaemon(t, dataDir);
  return { ...daemon, directory, repo, dataDir };
}

test('用户登记项目、设置全局并发上限，重启后仍能读取', async t => {
  const daemon = await fixture(t);
  assert.match(daemon.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal((await daemon.call('get-settings')).body.result.concurrencyLimit, 10);
  const registered = await daemon.call('register-project', { path: daemon.repo });
  assert.equal(registered.status, 200);
  assert.equal(registered.body.result.path, daemon.repo);
  const subdirectory = join(daemon.repo, 'nested directory');
  await mkdir(subdirectory);
  assert.equal((await daemon.call('register-project', { path: subdirectory })).body.result.id, registered.body.result.id);
  assert.equal((await daemon.call('set-concurrency', { limit: 3 })).body.result.concurrencyLimit, 3);
  assert.equal((await daemon.call('set-concurrency', { limit: 3 })).body.result.concurrencyLimit, 3);
  assert.ok((await stat(join(daemon.dataDir, 'helm.db-wal'))).size > 0);
  await stopDaemon(daemon.child);
  const restarted = await startDaemon(t, daemon.dataDir);
  assert.equal((await restarted.call('get-settings')).body.result.concurrencyLimit, 3);
  assert.equal((await restarted.call('list-projects')).body.result[0].id, registered.body.result.id);
  const events = (await restarted.call('get-events')).body.result;
  assert.deepEqual(events.map((event: any) => event.action), ['project-registered', 'concurrency-set']);
  assert.equal(events[0].actor.type, 'user');
  assert.equal(events[0].object.type, 'project');
  assert.ok(!Number.isNaN(Date.parse(events[0].time)));
  assert.equal(events[1].details.limit, 3);
});

test('第一条消息新建对齐中的工作和固定确认关卡，对话按时间穿插且 key 去重', async t => {
  const daemon = await fixture(t);
  const project = (await daemon.call('register-project', { path: daemon.repo })).body.result;
  const first = { projectId: project.id, body: '做一个软件项目', key: 'first' };
  const started = await daemon.call('send-message', first);
  assert.equal(started.status, 200);
  const { work, message } = started.body.result;
  assert.equal(work.status, 'aligning');
  assert.equal(work.projectId, project.id);
  const replayed = (await daemon.call('send-message', first)).body.result;
  assert.deepEqual(replayed.message, message);
  assert.equal(replayed.work.id, work.id);
  let conversation = (await daemon.call('get-conversation', { workId: work.id })).body.result;
  assert.deepEqual(conversation.map((item: any) => item.type), ['message', 'gate']);
  assert.equal(conversation[0].id, message.id);
  const gate = conversation[1];
  assert.equal(gate.kind, 'work-confirmation');
  assert.equal(gate.question, '确认工作说明');
  assert.equal(gate.status, 'pending');
  const pending = (await daemon.call('list-pending')).body.result;
  assert.equal(pending.length, 1);
  assert.equal(pending[0].id, gate.id);
  assert.equal(pending[0].workId, work.id);
  const followup = { workId: work.id, gateId: gate.id, body: '请补充边界', key: 'followup' };
  const sent = await daemon.call('send-message', followup);
  assert.equal(sent.status, 200);
  assert.deepEqual((await daemon.call('send-message', followup)).body.result, sent.body.result);
  conversation = (await daemon.call('get-conversation', { workId: work.id })).body.result;
  assert.deepEqual(conversation.map((item: any) => item.type), ['message', 'gate', 'message']);
  assert.equal(conversation[2].gateId, gate.id);
  const other = (await daemon.call('send-message', { ...first, key: 'second-work' })).body.result.work;
  assert.notEqual(other.id, work.id);
  assert.equal((await daemon.call('list-works', { projectId: project.id })).body.result.length, 2);
  assert.equal((await daemon.call('get-work', { workId: work.id })).body.result.id, work.id);
  const crossWorkGate = await daemon.call('send-message', { workId: other.id, gateId: gate.id, key: 'cross-work', body: '不能引用其他工作的关卡' });
  assert.equal(crossWorkGate.body.error.code, 'INVALID_GATE');
  await stopDaemon(daemon.child);
  const restarted = await startDaemon(t, daemon.dataDir);
  assert.equal((await restarted.call('get-conversation', { workId: work.id })).body.result.length, 3);
  assert.equal((await restarted.call('list-pending')).body.result.length, 2);
});

async function stream(t: TestContext, url: string, filter: object = {}, lastEventId?: number) {
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${url}/events`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(lastEventId === undefined ? {} : { 'last-event-id': String(lastEventId) }) },
    body: JSON.stringify(filter), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  return {
    close: () => controller.abort(),
    async next(): Promise<any> {
      for (;;) {
        const boundary = buffer.indexOf('\n\n');
        if (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          if (data) {
            const event = JSON.parse(data.slice(6));
            assert.ok(frame.includes(`id: ${event.id}\n`));
            assert.ok(frame.includes(`event: ${event.action}\n`));
            return event;
          }
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) throw new Error('SSE ended before the expected event');
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    },
  };
}

test('SSE 实时推送已提交的变化和需要用户处理的事件，支持筛选和断线续读', async t => {
  const daemon = await fixture(t);
  const project = (await daemon.call('register-project', { path: daemon.repo })).body.result;
  const events = await stream(t, daemon.url, {}, 1);
  const started = (await daemon.call('send-message', { projectId: project.id, body: '写软件', key: 'start' })).body.result;
  const received = [];
  for (let i = 0; i < 4; i++) received.push(await events.next());
  assert.deepEqual(received.map(event => event.action), ['work-created', 'message-sent', 'gate-created', 'needs-user-attention']);
  assert.ok(received.every(event => event.workId === started.work.id));
  const replay = await stream(t, daemon.url, { workId: started.work.id, actorType: 'runtime' }, received[1].id);
  assert.equal((await replay.next()).action, 'gate-created');
  assert.equal((await replay.next()).action, 'needs-user-attention');
  const timeline = (await daemon.call('get-events', { workId: started.work.id, actorType: 'user', actorId: 'user' })).body.result;
  assert.deepEqual(timeline.map((event: any) => event.action), ['work-created', 'message-sent']);
  assert.deepEqual((await daemon.call('get-events', { cardId: 'absent' })).body.result, []);
  assert.deepEqual((await daemon.call('get-events', { dispatchId: 'absent' })).body.result, []);
  assert.deepEqual((await daemon.call('get-events', { actorId: 'absent' })).body.result, []);
  events.close();
  replay.close();
});

test('SSE 积压超过写缓冲时等待读取而不断开；不带游标只推送新事件', async t => {
  const daemon = await fixture(t);
  const project = (await daemon.call('register-project', { path: daemon.repo })).body.result;
  for (let i = 0; i < 8; i++) await daemon.call('send-message', { projectId: project.id, body: 'x'.repeat(500_000), key: `backlog-${i}` });
  const history = (await daemon.call('get-events')).body.result;
  const replay = await stream(t, daemon.url, { after: 0 });
  for (const event of history) assert.equal((await replay.next()).id, event.id);
  replay.close();
  const live = await stream(t, daemon.url);
  await daemon.call('set-concurrency', { limit: 3 });
  assert.equal((await live.next()).action, 'concurrency-set');
  live.close();
});

test('约束失败返回结构化错误并记录拒绝事件，事务回滚且固定关卡不能撤回', async t => {
  const daemon = await fixture(t);
  const invalidProject = await daemon.call('register-project', { path: join(daemon.directory, 'missing') });
  assert.equal(invalidProject.status, 400);
  assert.equal(invalidProject.body.error.code, 'INVALID_PROJECT');
  assert.ok(invalidProject.body.error.reason);
  assert.ok(invalidProject.body.error.allowedOperations.includes('register-project'));
  assert.deepEqual((await daemon.call('list-projects')).body.result, []);
  const invalidLimit = await daemon.call('set-concurrency', { limit: 0 });
  assert.equal(invalidLimit.body.error.code, 'INVALID_PARAMS');
  assert.equal((await daemon.call('get-settings')).body.result.concurrencyLimit, 10);
  const project = (await daemon.call('register-project', { path: daemon.repo })).body.result;
  const invalidMessage = await daemon.call('send-message', { projectId: project.id, body: 'test', key: 'rollback', gateId: 'missing' });
  assert.equal(invalidMessage.body.error.code, 'INVALID_GATE');
  assert.deepEqual((await daemon.call('list-works')).body.result, []);
  const timeline = (await daemon.call('get-events')).body.result;
  assert.deepEqual(timeline.map((event: any) => event.action), ['operation-rejected', 'operation-rejected', 'project-registered', 'operation-rejected']);
  const started = (await daemon.call('send-message', { projectId: project.id, body: 'test', key: 'rollback' })).body.result;
  const gate = (await daemon.call('list-pending')).body.result[0];
  const withdraw = await daemon.call('withdraw-gate', { workId: started.work.id, gateId: gate.id, reason: '不能撤回固定关卡' });
  assert.equal(withdraw.status, 403);
  assert.equal(withdraw.body.error.code, 'FORBIDDEN');
  assert.equal((await daemon.call('list-pending')).body.result[0].status, 'pending');
  assert.equal((await daemon.call('send-message', { projectId: project.id, body: 'test' })).body.error.code, 'INVALID_PARAMS');
});

test('HTTP 输入错误同样返回结构化拒绝，服务继续处理请求', async t => {
  const daemon = await fixture(t);
  const malformed = await fetch(`${daemon.url}/api/set-concurrency`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json() as any).error.code, 'INVALID_JSON');
  const large = await fetch(`${daemon.url}/api/set-concurrency`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: ' '.repeat(1024 * 1024 + 1) });
  assert.equal(large.status, 413);
  assert.equal((await large.json() as any).error.code, 'BODY_TOO_LARGE');
  const invalidCursor = await fetch(`${daemon.url}/events`, { method: 'POST', headers: { 'content-type': 'application/json', 'last-event-id': '5' }, body: '{"after":-1}' });
  assert.equal(invalidCursor.status, 400);
  assert.equal((await invalidCursor.json() as any).error.code, 'INVALID_PARAMS');
  assert.equal((await daemon.call('get-events')).body.result.filter((event: any) => event.action === 'operation-rejected').length, 3);
  assert.equal((await daemon.call('get-settings')).body.result.concurrencyLimit, 10);
});

test('MCP 非 POST 请求返回协议级 405，不追加事件', async t => {
  const daemon = await fixture(t);
  for (const method of ['GET', 'DELETE', 'PUT', 'PATCH', 'OPTIONS', 'HEAD']) {
    const response = await fetch(`${daemon.url}/mcp?probe=1`, {
      method, headers: { accept: 'text/event-stream', authorization: 'Bearer expired-token' },
    });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'POST');
    assert.match(response.headers.get('content-type')!, /application\/json/);
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else {
      const body = await response.json() as any;
      assert.equal(body.jsonrpc, '2.0');
      assert.equal(body.id, null);
      assert.equal(body.error.code, -32000);
      assert.ok(body.error.message);
    }
  }
  assert.deepEqual((await daemon.call('get-events')).body.result, []);
});

test('其他路径的非 POST 请求仍返回结构化拒绝并记录事件', async t => {
  const daemon = await fixture(t);
  for (const [method, path] of [
    ['GET', '/api/get-settings'], ['DELETE', '/api/set-concurrency'], ['GET', '/events'], ['OPTIONS', '/mcp/'],
  ]) {
    const response = await fetch(`${daemon.url}${path}`, { method });
    assert.equal(response.status, 405);
    const body = await response.json() as any;
    assert.equal(body.ok, false);
    assert.equal(body.error.code, 'METHOD_NOT_ALLOWED');
    assert.ok(body.error.reason);
    assert.ok(body.error.allowedOperations.includes('get-settings'));
  }
  const events = (await daemon.call('get-events')).body.result;
  assert.deepEqual(events.map((event: any) => event.object.id), ['get-settings', 'set-concurrency', '/events', '/mcp/']);
  assert.ok(events.every((event: any) => event.action === 'operation-rejected' && event.details.code === 'METHOD_NOT_ALLOWED'));
});

test('真实 MCP 客户端完成会话，GET 探测不产生操作被拒绝事件', { timeout: 10_000 }, async t => {
  const daemon = await fixture(t);
  const client = new Client({ name: 'helm-test', version: '1.0.0' });
  t.after(() => client.close());
  let receivedProbe!: (response: Response) => void;
  const probe = new Promise<Response>(resolve => { receivedProbe = resolve; });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`), {
    fetch: async (input, init) => {
      const response = await fetch(input, init);
      if (init?.method === 'GET') receivedProbe(response);
      return response;
    },
  }));
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'get-settings'));
  const settings = await client.callTool({ name: 'get-settings' });
  assert.equal(settings.isError, false);
  assert.equal((settings.structuredContent as any).result.concurrencyLimit, 10);
  const response = await probe;
  assert.equal(response.status, 405);
  await client.close();
  assert.deepEqual((await daemon.call('get-events')).body.result, []);
});

test('真实 MCP 端点由操作定义生成工具，复用 HTTP 的校验和去重', async t => {
  const daemon = await fixture(t);
  const client = new Client({ name: 'helm-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`${daemon.url}/mcp`)));
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'register-project'));
  assert.ok(tools.find(tool => tool.name === 'send-message')!.inputSchema.required!.includes('key'));
  const workSchema = tools.find(tool => tool.name === 'get-work')!.inputSchema;
  assert.ok(Object.hasOwn(workSchema.properties!, 'workId'));
  assert.ok(workSchema.required!.includes('workId'));
  const rejected = await client.callTool({ name: 'set-concurrency', arguments: { limit: -1 } });
  assert.equal(rejected.isError, true);
  assert.equal((rejected.structuredContent as any).error.code, 'INVALID_PARAMS');
  const registered = await client.callTool({ name: 'register-project', arguments: { path: daemon.repo } });
  const project = (registered.structuredContent as any).result;
  const params = { projectId: project.id, body: 'MCP 发消息', key: 'mcp' };
  const message = await client.callTool({ name: 'send-message', arguments: params });
  const replayed = (await daemon.call('send-message', params)).body;
  const original = message.structuredContent as any;
  assert.deepEqual(replayed.result.message, original.result.message);
  assert.equal(replayed.result.work.id, original.result.work.id);
  const events = (await daemon.call('get-events')).body.result;
  assert.deepEqual(events.filter((event: any) => event.action === 'operation-rejected').map((event: any) => event.details.code), ['INVALID_PARAMS']);
});

test('helm 命令行冒烟：生成帮助、登记项目、发消息并读回对话', async t => {
  const daemon = await fixture(t);
  const run = (...args: string[]) => exec(process.execPath, [cliPath, ...args]);
  const help = await run('--help');
  assert.match(help.stdout, /helm send-message/);
  const registered = JSON.parse((await run('register-project', '--path', daemon.repo, '--url', daemon.url)).stdout);
  const sent = JSON.parse((await run('send-message', '--projectId', registered.result.id, '--body', 'CLI 开始工作', '--key', 'cli', '--url', daemon.url)).stdout);
  const conversation = JSON.parse((await run('get-conversation', '--workId', sent.result.work.id, '--url', daemon.url)).stdout);
  assert.equal(conversation.result[0].body, 'CLI 开始工作');
  assert.equal(conversation.result[1].kind, 'work-confirmation');
  await assert.rejects(run('set-concurrency', '--limit', '0', '--url', daemon.url), (error: any) => {
    assert.equal(error.code, 1);
    assert.equal(JSON.parse(error.stdout).error.code, 'INVALID_PARAMS');
    return true;
  });
});
