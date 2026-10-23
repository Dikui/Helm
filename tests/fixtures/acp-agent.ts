// Independent scripted JSON-RPC peer: no model, credentials, or real browser.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const script = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
if (script.stubborn) { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
const emit = (message: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const modelState = { currentModelId: 'grok-4.7', availableModels: [
  { modelId: 'grok-4.7', _meta: { reasoningEfforts: ['low', 'medium', 'high', 'xhigh'].map(value => ({ value })) } },
  { modelId: 'grok-4.5', _meta: { reasoningEfforts: ['low', 'medium', 'high'].map(value => ({ value })) } },
] };
const pending = new Map<string, (result: unknown) => void>();
let sequence = 0;
let servers: any[] = [];
const sessionId = script.uniqueSession ? `session-${process.pid}` : 'session-scripted';
const request = (method: string, params: object) => new Promise(resolve => {
  const id = `agent-${++sequence}`;
  pending.set(id, resolve);
  emit({ id, method, params });
});
appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/spawn', args: process.argv.slice(3), env: process.env, cwd: process.cwd(), pid: process.pid })}\n`);
createInterface({ input: process.stdin }).on('line', line => { void handle(line).catch(error => { console.error(error); process.exit(2); }); });
async function handle(line: string) {
  const message = JSON.parse(line);
  appendFileSync(script.record, `${line}\n`);
  if (!message.method) { pending.get(message.id)?.(message.result ?? message.error); pending.delete(message.id); return; }
  if (message.method === script.exitOn) process.exit(2);
  if (message.method === script.hangOn) return;
  if (message.id === undefined) return;
  if (message.method === script.rejectOn) {
    emit({ id: message.id, error: { code: -32000, message: 'scripted ACP failure' } });
    return;
  }
  let result: object = {};
  if (message.method === 'initialize') result = script.initialize ?? { protocolVersion: 1,
    authMethods: [{ id: 'cached_token', name: 'Local login' }], agentCapabilities: { mcpCapabilities: { http: true } }, _meta: { modelState: script.modelState ?? modelState } };
  if (message.method === 'session/new') { servers = message.params.mcpServers; result = { sessionId }; }
  if (message.method === 'session/prompt') {
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
    for (const options of script.permissions ?? []) await request('session/request_permission', {
      sessionId, toolCall: { toolCallId: 'permission-tool', title: 'Scripted tool' }, options,
    });
    for (const update of script.updates ?? [{ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已完成' } }]) {
      emit({ method: 'session/update', params: { sessionId, update } });
    }
    result = script.response ?? { stopReason: 'end_turn', _meta: { inputTokens: 999, outputTokens: 999,
      usage: { inputTokens: 120, outputTokens: 9, cachedReadTokens: 80 } } };
  }
  emit({ id: message.id, result });
}
