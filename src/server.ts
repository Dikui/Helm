import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { invoke, rejectOperation } from './operations.js';
import { RuleError, TaskStore, type Actor, type EventFilter } from './store.js';
import { handleMcp } from './mcp.js';
import { FakeDriver, type Driver } from './driver.js';
import { ClaudeExecutorDriver } from './claude-driver.js';
import { RoundScheduler } from './rounds.js';
import { ExecutionRunner } from './execution.js';
import type { BrowserCommand } from './browser.js';
import { UserOperations } from './user-operations.js';

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      request.resume();
      throw new RuleError('BODY_TOO_LARGE', '请求体不能超过 1 MiB。', 413);
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}

export async function startHelmd(options: { port?: number; dataDir?: string; driver?: Driver; executorDriver?: Driver; browserCommand?: BrowserCommand } = {}) {
  const store = new TaskStore(options.dataDir ?? join(homedir(), '.helm'));
  let scheduler: RoundScheduler;
  let executions: ExecutionRunner;
  let userOperations: UserOperations;
  const server = createServer(async (request, response) => {
    let name = request.url ?? '/';
    let actor: Actor = { type: 'user', id: 'user' };
    try {
      let path: string;
      try { path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname; }
      catch { throw new RuleError('INVALID_PATH', '请求路径无效。', 400); }
      name = path.startsWith('/api/') ? path.slice('/api/'.length) : path;
      if (request.headers.authorization !== undefined) actor = executions.authenticate(request.headers.authorization) ?? scheduler.authenticate(request.headers.authorization);
      if (request.method !== 'POST') throw new RuleError('METHOD_NOT_ALLOWED', '请使用 HTTP POST。', 405);
      const input = await readBody(request);
      if (path === '/mcp') return await handleMcp(request, response, input, store, actor, userOperations, () => executions.browserFor(actor));
      if (path === '/events') {
        let filter = input;
        const lastId = request.headers['last-event-id'];
        if (lastId !== undefined) {
          if (typeof lastId !== 'string' || !/^\d+$/.test(lastId) || !Number.isSafeInteger(Number(lastId))) {
            throw new RuleError('INVALID_PARAMS', 'Last-Event-ID 必须是非负整数。', 400);
          }
          if (input && typeof input === 'object' && !Array.isArray(input)) {
            const after = 'after' in input ? input.after : 0;
            if (typeof after === 'number' && Number.isSafeInteger(after) && after >= 0) filter = { ...input, after: Math.max(after, Number(lastId)) };
          }
        }
        const result = await invoke(store, actor, 'get-events', filter, userOperations);
        if (!result.body.ok) return json(response, result.status, result.body);
        return streamEvents(store, response, filter as EventFilter);
      }
      const result = await invoke(store, actor, name, input, userOperations);
      json(response, result.status, result.body);
    } catch (error) {
      if (error instanceof SyntaxError) error = new RuleError('INVALID_JSON', '请求必须是 JSON。', 400);
      if (error instanceof RuleError) {
        const result = rejectOperation(store, actor, name, error);
        return json(response, result.status, result.body);
      }
      console.error(error);
      if (!response.headersSent) json(response, 500, { error: { code: 'INTERNAL_ERROR', reason: '运行层内部错误。', allowedOperations: [] } });
      else response.destroy();
    }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(options.port ?? 4242, '127.0.0.1', resolve);
    });
  } catch (error) { store.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('helmd has no TCP address');
  const url = `http://127.0.0.1:${address.port}`;
  scheduler = new RoundScheduler(store, options.driver ?? new FakeDriver(), `${url}/mcp`);
  executions = new ExecutionRunner(store, options.executorDriver ?? new ClaudeExecutorDriver(), `${url}/mcp`, options.browserCommand);
  userOperations = new UserOperations(store, executions, scheduler);
  let closing: Promise<void> | undefined;
  return {
    url,
    close() {
      closing ??= Promise.all([scheduler.close(), executions.close()]).then(() => new Promise<void>((resolve, reject) => {
        server.close(error => { store.close(); error ? reject(error) : resolve(); });
        server.closeAllConnections();
      }));
      return closing;
    },
  };
}

function streamEvents(store: TaskStore, response: ServerResponse, filter: EventFilter) {
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
  response.write(': connected\n\n');
  let after = filter.after ?? 0;
  const publish = () => {
    try {
      for (const event of store.events({ ...filter, after })) {
        after = event.id;
        if (!response.write(`id: ${event.id}\nevent: ${event.action}\ndata: ${JSON.stringify(event)}\n\n`)) {
          // Slow consumers reconnect with Last-Event-ID; never buffer an unbounded timeline.
          response.destroy();
          break;
        }
      }
    } catch { response.destroy(); }
  };
  const unsubscribe = store.subscribe(publish);
  const heartbeat = setInterval(() => { response.write(': heartbeat\n\n'); }, 15_000);
  heartbeat.unref();
  response.once('close', () => { clearInterval(heartbeat); unsubscribe(); });
  publish();
}
