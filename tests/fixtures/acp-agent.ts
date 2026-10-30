// Independent scripted JSON-RPC peer: no model, credentials, or real browser.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { execFileSync, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { testProcessWatchdog, watchTestProcess } from './test-process.js';

const script = JSON.parse(readFileSync(process.argv[2]!, 'utf8'));
const watchdog = watchTestProcess(script.testProcessPid).unref();
if (script.stubborn) { process.on('SIGTERM', () => {}); watchdog.ref(); }
const emit = (message: object) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
async function writeChunks(chunks: (string | { base64: string })[]) {
  for (const chunk of chunks) {
    const bytes = typeof chunk === 'string' ? chunk : Buffer.from(chunk.base64, 'base64');
    await new Promise<void>(resolve => process.stdout.write(bytes, () => resolve()));
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
}
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
let prompted = false;
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
  if (message.method === 'session/prompt') prompted = true;
  await writeChunks(script.stdoutBefore?.[message.method] ?? []);
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
  if (message.method === 'session/close' && prompted && script.sessionLog) {
    if (script.closeDelayMs) await new Promise(resolve => setTimeout(resolve, script.closeDelayMs));
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
    if (configId === 'model' && script.rejectModels?.includes(value)) {
      emit({ id: message.id, error: { code: -32603, message: 'provider unavailable' } });
      return;
    }
    configOptions = (configId === 'model' ? script.modelConfigOptions?.[value] : undefined)
      ?? script.configuredOptions ?? configOptions.map((option: any) => option.id === configId ? { ...option, currentValue: value } : option);
    result = { configOptions };
  }
  if (message.method === 'session/prompt') {
    promptId = message.id;
    if (script.shellProbe) {
      const shell = { resolve: (request: any) => ({ ...request }) };
      const disposers: (() => void)[] = [];
      for (const patch of patches) for (const plugin of patch.content.flatMap((operation: any) => operation.insert ?? [])) {
        if (plugin.id !== 'helm-project-environment') continue;
        const source = readFileSync(plugin.name, 'utf8');
        appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/environment-plugin', source })}\n`);
        const module = await import(pathToFileURL(plugin.name).href);
        module.apply({ shell, effect: (apply: () => () => void) => { disposers.push(apply()); } });
      }
      // Match dsh's ambient credential scrub; explicit shell spec.env merges later.
      const policy = process.env.GROK_CONFIG ? JSON.parse(process.env.GROK_CONFIG).shell_environment_policy : undefined;
      const scrub = script.scrubShellEnvironment || !policy?.ignore_default_excludes;
      const parent = Object.fromEntries(Object.entries(process.env).filter(([key]) => !scrub || !/KEY|PASSWORD|SECRET|TOKEN|^DSH_/i.test(key)));
      const spec = shell.resolve({ command: 'probe', env: {} });
      const text = execFileSync('/bin/sh', ['-c', 'printf %s "$PROJECT_RUNTIME_KEY"'], { env: { ...parent, ...spec.env }, encoding: 'utf8' });
      appendFileSync(script.record, `${JSON.stringify({ method: 'fixture/shell', text })}\n`);
      for (const dispose of disposers) dispose();
    }
    if (script.spawnChild) {
      const child = spawn(process.execPath, ['-e', testProcessWatchdog(script.testProcessPid)], { detached: true, stdio: 'ignore' });
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
      usage: { inputTokens: 120, outputTokens: 9, cachedReadTokens: 80, cacheCreationTokens: 6 } } };
  }
  emit({ id: message.id, result });
  await writeChunks(script.stdoutAfter?.[message.method] ?? []);
}
