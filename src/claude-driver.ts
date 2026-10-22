import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { query, type CanUseTool, type Options, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Driver, DriverEvent, DriverSession, SessionOptions, TokenUsage } from './driver.js';

// The external SDK boundary can be replaced without starting a CLI in npm test.
export type ClaudeQuery = (args: Parameters<typeof query>[0]) => AsyncIterable<SDKMessage> & { close(): void };

async function localClaude(env: Record<string, string>) {
  for (const directory of (env.PATH ?? '').split(':').filter(Boolean)) {
    const path = resolve(directory, 'claude');
    try { await access(path, constants.X_OK); return await realpath(path); }
    catch (error) {
      if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
    }
  }
  throw new Error('Local claude executable not found on PATH; install Claude Code and log in locally.');
}

function tokenUsage(message: SDKResultMessage): TokenUsage {
  return Object.values(message.modelUsage).reduce((total, model) => ({
    inputTokens: total.inputTokens + model.inputTokens + model.cacheReadInputTokens + model.cacheCreationInputTokens,
    outputTokens: total.outputTokens + model.outputTokens,
  }), { inputTokens: 0, outputTokens: 0 });
}

function subscriptionLimit(message: SDKResultMessage) {
  // Older local CLIs only put subscription-limit diagnostics in error results.
  // Never examine a successful result or ordinary assistant text for this.
  const errors = message.subtype === 'success' ? [message.result] : message.errors;
  return errors.some(text => /you['’]ve hit your (?:usage )?limit|weekly (?:usage )?limit (?:reached|exceeded)|usage limit (?:reached|exceeded)/i.test(text));
}

function inside(root: string, path: string) {
  const suffix = relative(root, path);
  return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
}

async function writablePath(cwd: string, path: unknown): Promise<boolean> {
  if (typeof path !== 'string' || !path || path.includes('\0')) return false;
  let ancestor = resolve(cwd, path);
  if (!inside(cwd, ancestor)) return false;
  for (;;) {
    try { return inside(cwd, await realpath(ancestor)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      // A dangling symlink is not a new file: writing it would follow its target.
      try { if ((await lstat(ancestor)).isSymbolicLink()) return false; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false; }
      const parent = dirname(ancestor);
      if (parent === ancestor) return false;
      ancestor = parent;
    }
  }
}

function executorPermission(cwd: string): CanUseTool {
  return async (tool, input, context) => {
    const deny = { behavior: 'deny' as const, message: 'Helm executor may write only inside its card copy and must keep Bash sandboxed.' };
    if (context.signal.aborted) return deny;
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
      if (!await writablePath(cwd, tool === 'NotebookEdit' ? input.notebook_path : input.file_path)) return deny;
    }
    if (tool === 'Bash' && (input.dangerouslyDisableSandbox || (context.blockedPath && !await writablePath(cwd, context.blockedPath)))) return deny;
    if (tool === 'AskUserQuestion' || tool === 'ExitPlanMode') return { behavior: 'deny', message: 'Report blockers through the Helm submit-conclusion tool.' };
    // SDK allow is allow_once. Never echo suggestions as updatedPermissions:
    // they can persist allow_always rules in the user's or project's settings.
    return { behavior: 'allow', updatedInput: input };
  };
}

export class ClaudeExecutorDriver implements Driver {
  constructor(private config: { pathToClaudeCodeExecutable?: string; query?: ClaudeQuery } = {}) {}

  async start(options: SessionOptions): Promise<DriverSession> {
    if (options.sandbox.mode !== 'workspace-write' || options.template?.role === 'coordinator') {
      throw new Error('ClaudeExecutorDriver requires an executor card copy');
    }
    const cwd = await realpath(options.cwd);
    if (options.sandbox.writableRoots.length !== 1 || await realpath(options.sandbox.writableRoots[0]!) !== cwd) {
      throw new Error('Claude executor writable roots must contain only its card copy');
    }
    const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(options.env);
    const id = options.resumeSessionId ?? randomUUID();
    const controller = new AbortController();
    const env = { ...options.env };
    env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
    env.no_proxy = env.NO_PROXY;
    const sdkOptions: Options = {
      cwd, env, pathToClaudeCodeExecutable: executable, settingSources: [], strictMcpConfig: true,
      permissionMode: 'default', abortController: controller, canUseTool: executorPermission(cwd),
      sandbox: {
        enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
        filesystem: { allowWrite: [cwd] }, network: { allowLocalBinding: true },
      },
      mcpServers: Object.fromEntries(Object.entries(options.mcpServers).map(([name, server]) => [name, { type: 'http', ...server }])),
      ...(options.template?.model ? { model: options.template.model } : {}),
      ...(options.template?.reasoningEffort ? { effort: options.template.reasoningEffort } : {}),
      ...(options.resumeSessionId ? { resume: id } : { sessionId: id }),
    };
    let deliver!: (content: string) => void;
    const input = new Promise<string>(resolve => { deliver = resolve; });
    let sent = false;
    let stream: ReturnType<ClaudeQuery> | undefined;
    const runQuery = this.config.query ?? query;
    return {
      id,
      async send(content) {
        if (sent) throw new Error('Claude session already received its input');
        if (controller.signal.aborted) throw new Error('Claude session cancelled');
        sent = true;
        deliver(content);
      },
      cancel() { controller.abort(); deliver(''); stream?.close(); },
      events: (async function* (): AsyncGenerator<DriverEvent> {
        const prompt = await input;
        if (controller.signal.aborted) return;
        let step = 0;
        let quotaRejected = false;
        try {
          stream = runQuery({ prompt, options: sdkOptions });
          for await (const message of stream) {
            if (controller.signal.aborted) return;
            yield { type: 'output', step: ++step, text: JSON.stringify(message) };
            if (message.type === 'system' && message.subtype === 'compact_boundary') {
              yield { type: 'compaction', step: ++step };
            }
            if (message.type === 'rate_limit_event' && message.rate_limit_info.status === 'rejected') quotaRejected = true;
            if (message.type === 'assistant' && message.error === 'rate_limit') quotaRejected = true;
            if (message.type === 'result') {
              const completed = message.subtype === 'success' && !message.is_error;
              yield { type: 'end', step: ++step, reason: completed ? 'completed' : quotaRejected || subscriptionLimit(message) ? 'quota-exhausted' : 'error',
                ...(completed ? { finalAnswer: message.result } : {}), usage: tokenUsage(message) };
              return;
            }
          }
          if (!controller.signal.aborted) throw new Error('Claude stream ended without a result message');
        } catch (error) { if (!controller.signal.aborted) throw error; }
        finally { controller.abort(); stream?.close(); }
      })(),
    };
  }
}
