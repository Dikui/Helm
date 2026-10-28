import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { AgentConfig } from './agents.js';
import type { McpConfig } from './library.js';
import type { ManagedProcess } from './processes.js';

export type EndReason = 'completed' | 'error' | 'quota-exhausted' | 'timed-out' | 'aborted' | 'context-overflow';
// null means the driver has not reported that count; a reported zero stays zero.
export interface TokenUsage { inputTokens: number | null; outputTokens: number | null }
interface HttpMcpServer { type?: 'http'; url: string; headers: Record<string, string> }
export type McpServerConfig = HttpMcpServer | Extract<McpConfig, { type: 'stdio' }>;
export interface SessionOptions {
  agent: AgentConfig;
  cwd: string;
  env: Record<string, string>;
  // Per-dispatch storage outside the writable card copy (CLI state, not code).
  dataDir?: string;
  sandbox: { mode: 'read-only' | 'workspace-write'; writableRoots: string[] };
  // The reserved Helm endpoint always uses authenticated HTTP.
  mcpServers: Record<string, McpServerConfig> & { helm?: HttpMcpServer };
  resumeSessionId?: string;
  signal?: AbortSignal;
  // Report each detached group at spawn time, including if start() has not resolved.
  onProcess?: (process: ManagedProcess) => void;
}
export interface PlanEntry { content: string; status: 'pending' | 'in_progress' | 'completed' }
export type DriverEvent =
  | { type: 'plan'; step: number; entries: PlanEntry[] }
  | { type: 'output'; step: number; text: string }
  | { type: 'artifact'; step: number; kind: 'file' | 'test-output'; path: string }
  | { type: 'compaction'; step: number }
  | { type: 'end'; step: number; reason: EndReason; finalAnswer?: string; usage: TokenUsage; failure?: string };
export interface DriverSession {
  id: string;
  sqlitePath?: string;
  send(content: string): Promise<void>;
  cancel(): void;
  events: AsyncIterable<DriverEvent>;
}
export interface AgentAvailability { available: boolean; reason?: string; command?: string }
// A model the CLI offers and its native effort values; id null is the CLI's default model.
export interface ModelOption { id: string | null; label: string; efforts: string[]; defaultEffort: string | null }
export interface Driver {
  // The official install and login commands for the CLI; the user runs install from the UI and login in a terminal.
  install?: { executable: string; command: string; login: string };
  checkAvailability(agent: AgentConfig): Promise<AgentAvailability>;
  listModels?(): Promise<ModelOption[]>;
  start(options: SessionOptions): Promise<DriverSession>;
}
export type DriverRegistry = Record<string, Driver>;

export interface FakeContext {
  input: string;
  options: SessionOptions;
  results: Map<string, unknown>;
}
export type FakeStep =
  | { type: 'tool'; name: string; arguments: Record<string, unknown> | ((context: FakeContext) => Record<string, unknown>); saveAs?: string; check?: (result: unknown) => void }
  | { type: 'write'; path: string; content: string }
  | { type: 'output'; text: string }
  | { type: 'plan'; entries: PlanEntry[] }
  | { type: 'artifact'; kind: 'file' | 'test-output'; path: string }
  | { type: 'compaction' }
  | { type: 'end'; reason: EndReason; finalAnswer?: string; usage?: TokenUsage }
  | { type: 'hang'; until?: Promise<void> }
  | { type: 'crash'; message?: string };
export type FakeScript = FakeStep[] | ((context: FakeContext) => FakeStep[]);

// Uses the same HTTP MCP transport as a real agent; scripts never access the task store.
export class FakeDriver implements Driver {
  constructor(private scripts: FakeScript[] = [],
    private availability: (agent: AgentConfig) => AgentAvailability | Promise<AgentAvailability> = () => ({ available: true })) {}

  async checkAvailability(agent: AgentConfig) { return this.availability(agent); }

  async start(options: SessionOptions): Promise<DriverSession> {
    const script = this.scripts.shift() ?? [];
    const controller = new AbortController();
    let deliver!: (content: string) => void;
    let sent = false;
    const input = new Promise<string>(resolve => { deliver = resolve; });
    return {
      id: options.resumeSessionId ?? randomUUID(),
      async send(content) {
        if (sent) throw new Error('Fake session already received its input');
        sent = true;
        deliver(content);
      },
      cancel() { controller.abort(); deliver('{}'); },
      events: (async function* () {
        const content = await input;
        if (controller.signal.aborted) return;
        const context: FakeContext = { input: content, options, results: new Map() };
        const steps = typeof script === 'function' ? script(context) : script;
        let client: Client | undefined;
        let step = 0;
        try {
          for (const instruction of steps) {
            if (controller.signal.aborted) return;
            if (instruction.type === 'tool') {
              if (!client) {
                const endpoint = options.mcpServers.helm;
                if (!endpoint) throw new Error('Missing Helm MCP endpoint');
                client = new Client({ name: 'helm-fake-driver', version: '1.0.0' });
                await client.connect(new StreamableHTTPClientTransport(new URL(endpoint.url), { requestInit: { headers: endpoint.headers, signal: controller.signal } }));
              }
              const args = typeof instruction.arguments === 'function' ? instruction.arguments(context) : instruction.arguments;
              const result = await client.callTool({ name: instruction.name, arguments: args });
              if (instruction.saveAs) context.results.set(instruction.saveAs, result.structuredContent);
              instruction.check?.(result.structuredContent);
              yield { type: 'output', step: ++step, text: JSON.stringify({ tool: instruction.name, result: result.structuredContent }) };
            } else if (instruction.type === 'write') {
              const path = resolve(options.cwd, instruction.path);
              if (options.sandbox.mode === 'read-only') throw new Error('Sandbox rejects writes for coordinator rounds');
              // Resolve parents and existing targets to reject symlink escapes as well as ../ paths.
              const inside = (root: string, target: string) => {
                const suffix = relative(root, target);
                return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
              };
              const roots = await Promise.all(options.sandbox.writableRoots.map(root => realpath(root)));
              let ancestor = dirname(path);
              for (;;) {
                const existing = await existingPath(ancestor);
                if (existing) { ancestor = existing; break; }
                ancestor = dirname(ancestor);
              }
              const target = await existingPath(path) ?? path;
              if (!roots.some(root => inside(root, path) && inside(root, ancestor) && inside(root, target))) throw new Error('Sandbox rejects write outside writable roots');
              await mkdir(dirname(path), { recursive: true });
              await writeFile(path, instruction.content);
              yield { type: 'output', step: ++step, text: `Wrote ${instruction.path}` };
            } else if (instruction.type === 'hang') {
              await new Promise<void>(resolve => {
                if (controller.signal.aborted) resolve();
                else {
                  const done = () => { controller.signal.removeEventListener('abort', done); resolve(); };
                  controller.signal.addEventListener('abort', done, { once: true });
                  instruction.until?.then(done);
                }
              });
              if (controller.signal.aborted) return;
            } else if (instruction.type === 'crash') {
              throw new Error(instruction.message ?? 'Fake agent crashed');
            } else if (instruction.type === 'end') {
              yield { type: 'end', step: ++step, reason: instruction.reason,
                ...(instruction.reason === 'completed' ? { finalAnswer: instruction.finalAnswer ?? '' } : {}),
                usage: instruction.usage ?? { inputTokens: null, outputTokens: null } };
              return;
            } else yield { ...instruction, step: ++step };
          }
          if (!controller.signal.aborted) yield { type: 'end', step: ++step, reason: 'completed', finalAnswer: '', usage: { inputTokens: 0, outputTokens: 0 } };
        } finally { await client?.close(); }
      })(),
    };
  }
}

async function existingPath(path: string): Promise<string | undefined> {
  try { return await realpath(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const entry = await lstat(path).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  });
  if (entry?.isSymbolicLink()) throw new Error('Sandbox rejects unresolved symbolic link');
  return undefined;
}
