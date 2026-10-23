// Independent scripted JSON-RPC peer: no model, credentials, or real browser.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const script = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
if (script.stubborn) { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
const emit = (message: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const modelState = { currentModelId: 'grok-4.7', availableModels: [
  { modelId: 'grok-4.7', _meta: { reasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(value => ({ value })) } },
  { modelId: 'grok-4.5', _meta: { reasoningEfforts: ['low', 'medium', 'high'].map(value => ({ value })) } },
] };
const effortIndex = process.argv.indexOf('--effort');
let configOptions = script.configOptions ?? [
  { id: 'model', name: 'Model', type: 'select', currentValue: 'grok-4.7',
    options: [{ value: 'grok-4.7', name: 'Grok 4.7' }, { value: 'grok-4.5', name: 'Grok 4.5' }] },
  { id: 'reasoning_effort', name: 'Reasoning Effort', type: 'select', currentValue: process.argv[effortIndex + 1],
    options: ['low', 'medium', 'high', 'xhigh'].map(value => ({ value, name: value })) },
];
const pending = new Map<string, (result: unknown) => void>();
let sequence = 0;
let servers: any[] = [];
let promptId: number | string | undefined;
let sessionId = script.uniqueSession ? `session-${process.pid}` : 'session-scripted';
const request = (method: string, params: object) => new Promise(resolve => {
  const id = `agent-${++sequence}`;
  pending.set(id, resolve);
  emit({ id, method, params });
});
const patches = process.argv.flatMap((arg, index) => arg === '--patch'
  ? [{ path: process.argv[index + 1], content: JSON.parse(readFileSync(process.argv[index + 1]!, 'utf8')) }] : []);
appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/spawn', args: process.argv.slice(3), patches, env: process.env, cwd: process.cwd(), pid: process.pid })}\n`);
createInterface({ input: process.stdin }).on('line', line => { void handle(line).catch(error => { console.error(error); process.exit(2); }); });
async function handle(line: string) {
  const message = JSON.parse(line);
  appendFileSync(script.record, `${line}\n`);
  if (!message.method) { pending.get(message.id)?.(message.result ?? message.error); pending.delete(message.id); return; }
  if (message.method === script.exitOn) process.exit(2);
  if (message.method === script.hangOn) return;
  if (message.method === 'session/cancel' && promptId !== undefined && !script.ignoreCancel) {
    emit({ id: promptId, result: script.cancelResponse ?? { stopReason: 'cancelled', _meta: { usage: { inputTokens: 12, outputTokens: 3 } } } });
  }
  if (message.id === undefined) return;
  if (message.method === script.malformedOn) { process.stdout.write('{invalid-json\n'); return; }
  if (message.method === script.rejectOn) {
    emit({ id: message.id, error: script.error ?? { code: -32000, message: 'scripted ACP failure' } });
    return;
  }
  // Persist only at close, as dsh's session/close drains and flushes the log.
  if (message.method === 'session/close' && script.sessionLog) {
    const root = join(process.env.DSH_HOME ?? join(process.env.HOME!, '.dsh'), 'sessions', '--fixture-project--', sessionId);
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'session.v4.jsonl.zstd'), Buffer.from(script.sessionLog, 'base64'));
  }
  let result: object = {};
  if (message.method === 'initialize') result = script.initialize ?? { protocolVersion: 1,
    authMethods: [{ id: 'cached_token', name: 'Local login' }], agentCapabilities: { mcpCapabilities: { http: true },
      sessionCapabilities: script.resume === false ? {} : { resume: {} } }, _meta: { modelState: script.modelState ?? modelState } };
  if (message.method === 'session/new') { servers = message.params.mcpServers; result = { sessionId, configOptions }; }
  if (message.method === 'session/resume') {
    sessionId = message.params.sessionId; servers = message.params.mcpServers; result = { configOptions };
  }
  if (message.method === 'session/set_config_option') {
    const { configId, value } = message.params;
    configOptions = script.configuredOptions ?? configOptions.map((option: any) => option.id === configId ? { ...option, currentValue: value } : option);
    result = { configOptions };
  }
  if (message.method === 'session/prompt') {
    promptId = message.id;
    if (script.spawnChild) {
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
      child.unref();
      appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/child', pid: child.pid })}\n`);
    }
    for (const write of script.writes ?? []) writeFileSync(write.path, write.content);
    if (script.mcpTools) {
      const server = servers.find(server => server.name === 'helm');
      const client = new Client({ name: 'fake-acp-agent', version: '1' });
      try {
        await client.connect(new StreamableHTTPClientTransport(new URL(server.url), {
          requestInit: { headers: Object.fromEntries(server.headers.map((h: any) => [h.name, h.value])) },
        }));
        appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/tools', result: await client.listTools() })}\n`);
        for (const tool of script.mcpTools) {
          const result = await client.callTool(tool);
          appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/mcp', name: tool.name, result })}\n`);
          if (result.isError) throw new Error(JSON.stringify(result));
          emit({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call',
            toolCallId: tool.name, title: tool.name, status: 'completed', rawInput: tool.arguments, rawOutput: result } } });
        }
      } finally { await client.close(); }
    }
    for (const [index, options] of (script.permissions ?? []).entries()) {
      const toolCall = script.permissionToolCalls?.[index] ?? { toolCallId: 'permission-tool', title: 'Scripted tool' };
      if (script.permissionToolCalls) emit({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', ...toolCall } } });
      await request('session/request_permission', {
        // dsh sends only the id here; rawInput was in the preceding update.
        sessionId, toolCall: { toolCallId: toolCall.toolCallId }, options,
      });
    }
    for (const update of script.updates ?? [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已完成' } }]) {
      emit({ method: 'session/update', params: { sessionId, update } });
    }
    for (const notification of script.notifications ?? []) emit({ method: notification.method,
      params: { sessionId, ...notification.params } });
    if (script.holdPrompt) return;
    result = Object.hasOwn(script, 'response') ? script.response : { stopReason: 'end_turn', _meta: { inputTokens: 999, outputTokens: 999,
      usage: { inputTokens: 120, outputTokens: 9, cachedReadTokens: 80 } } };
  }
  emit({ id: message.id, result });
}
