import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { query, type CanUseTool, type Options, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Driver, DriverEvent, DriverSession, SessionOptions, TemplateAvailability, TokenUsage } from './driver.js';
import { runtimeEnvironment } from './environment.js';
import { templatePrompt } from './prompts.js';
import { TemplateCatalog, type AgentTemplate } from './templates.js';

function claudeHome(template: AgentTemplate, home = homedir()) {
  return join(home, '.helm', 'agent-homes', template.home === 'shared' ? 'claude' : template.id);
}

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

function quotaExhausted(text: string) {
  // Match CLI diagnostics only; callers exclude normal assistant text and give
  // successful results precedence. A bare rate_limit tag/HTTP 429 is ambiguous.
  return /you['’]ve hit your (?:(?:usage|session) )?limit|you['’]re out of extra usage|weekly (?:usage )?limit (?:reached|exceeded)|usage limit (?:reached|exceeded)/i.test(text)
    || /credit balance (?:is )?too low/i.test(text)
    || /invalid (?:api key|x-api-key|bearer token)/i.test(text);
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

function coordinatorPermission(servers: string[]): CanUseTool {
  return async (tool, input, context) => {
    const allowed = ['Bash', 'Read', 'Grep', 'Glob'].includes(tool)
      || servers.some(name => tool.startsWith(`mcp__${name}__`));
    if (context.signal.aborted || !allowed || (tool === 'Bash' && (input.dangerouslyDisableSandbox || context.blockedPath))) {
      return { behavior: 'deny', message: 'Helm coordinator may only read project code and use the injected Helm tools; Bash must stay sandboxed.' };
    }
    return { behavior: 'allow', updatedInput: input };
  };
}

type AuthStatus = (executable: string, options: { cwd: string; env: Record<string, string> }) => Promise<boolean>;
const authStatus: AuthStatus = async (executable, options) => {
  // Ask the CLI, which owns Keychain/file credentials. Never read its files.
  const { stdout } = await promisify(execFile)(executable, ['auth', 'status', '--json', '--setting-sources', ''],
    { ...options, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
  const status = JSON.parse(stdout);
  return status.loggedIn === true && status.authMethod === 'claude.ai';
};

interface ClaudeDriverConfig { pathToClaudeCodeExecutable?: string; query?: ClaudeQuery; authStatus?: AuthStatus }

export class ClaudeDriver implements Driver {
  constructor(private config: ClaudeDriverConfig = {}, private role?: 'coordinator' | 'executor') {}

  async checkAvailability(template: AgentTemplate): Promise<TemplateAvailability> {
    const directory = claudeHome(template);
    const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
    if (template.home === 'template') {
      const command = `mkdir -p ${quoted} && \${EDITOR:-vi} ${quoted}/settings.json`;
      try {
        if ((await stat(directory)).isDirectory() && (await stat(join(directory, 'settings.json'))).isFile()) return { available: true };
      } catch { /* Only file metadata is needed; the CLI validates contents. */ }
      return { available: false, reason: `API 模板需要主目录 ${directory} 和 settings.json；请按 Claude 格式配置接口和 key。`, command };
    }
    const command = `CLAUDE_CONFIG_DIR=${quoted} claude auth login`;
    try {
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const env = { ...runtimeEnvironment(), CLAUDE_CONFIG_DIR: directory };
      const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(env);
      if (await (this.config.authStatus ?? authStatus)(executable, { cwd: directory, env })) return { available: true };
    } catch { /* Do not store CLI diagnostics, which may contain account details. */ }
    return { available: false, reason: `Claude 专用主目录 ${directory} 未登录或无法检查登录状态；请确认已安装 Claude CLI 并登录。`, command };
  }

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const coordinator = (this.role ?? options.template?.role) === 'coordinator';
    if (coordinator && (options.sandbox.mode !== 'read-only' || options.sandbox.writableRoots.length
      || options.template?.role === 'executor' || options.resumeSessionId !== undefined)) {
      throw new Error('ClaudeCoordinatorDriver requires a fresh read-only coordinator round');
    }
    if (!coordinator && (options.sandbox.mode !== 'workspace-write' || options.template?.role === 'coordinator')) {
      throw new Error('ClaudeExecutorDriver requires an executor card copy');
    }
    const cwd = await realpath(options.cwd);
    if (!coordinator && (options.sandbox.writableRoots.length !== 1 || await realpath(options.sandbox.writableRoots[0]!) !== cwd)) {
      throw new Error('Claude executor writable roots must contain only its card copy');
    }
    const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(options.env);
    options.signal?.throwIfAborted();
    const id = options.resumeSessionId ?? randomUUID();
    const controller = new AbortController();
    let deliver!: (content: string) => void;
    const input = new Promise<string>(resolve => { deliver = resolve; });
    let sent = false;
    let stream: ReturnType<ClaudeQuery> | undefined;
    const cancel = () => {
      options.signal?.removeEventListener('abort', cancel);
      controller.abort();
      deliver('');
      stream?.close();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    // Per-session override: never let a caller's force-enable reach Claude.
    // https://code.claude.com/docs/en/memory#enable-or-disable-auto-memory
    const template = options.template ?? new TemplateCatalog().get(coordinator ? 'claude-coordinator' : 'claude-executor');
    const env: Record<string, string> = { ...options.env, CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      CLAUDE_CONFIG_DIR: claudeHome(template, options.env.HOME) };
    env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
    env.no_proxy = env.NO_PROXY;
    const sdkOptions: Options = {
      cwd, env, pathToClaudeCodeExecutable: executable, settingSources: template.home === 'template' ? ['user'] : [], strictMcpConfig: true,
      settings: { autoMemoryEnabled: false },
      systemPrompt: templatePrompt(template),
      permissionMode: 'default', abortController: controller,
      canUseTool: coordinator ? coordinatorPermission(Object.keys(options.mcpServers)) : executorPermission(cwd),
      // Fix each role's built-ins rather than inheriting the CLI's evolving defaults.
      tools: coordinator ? ['Bash', 'Read', 'Grep', 'Glob']
        : ['Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite'],
      spawnClaudeCodeProcess: processOptions => {
        controller.signal.throwIfAborted();
        const child = spawn(processOptions.command, processOptions.args, {
          cwd: processOptions.cwd ?? cwd, env: processOptions.env, signal: processOptions.signal,
          detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stderr.on('data', chunk => sdkOptions.stderr?.(String(chunk)));
        if (child.pid) options.onProcess?.({ pid: child.pid, pgid: child.pid, startedAt: new Date().toISOString() });
        return child;
      },
      sandbox: {
        enabled: true, failIfUnavailable: true, autoAllowBashIfSandboxed: true, allowUnsandboxedCommands: false,
        // Claude grants cwd writes by default; an empty allowWrite alone does
        // not make it read-only. Explicitly deny cwd, including temp worktrees.
        filesystem: coordinator ? { allowWrite: [], denyWrite: [cwd] } : { allowWrite: [cwd] },
        network: { allowLocalBinding: true },
      },
      mcpServers: Object.fromEntries(Object.entries(options.mcpServers).map(([name, server]) => [name, { type: 'http', ...server }])),
      ...(options.template?.model ? { model: options.template.model } : {}),
      ...(options.template?.reasoningEffort ? { effort: options.template.reasoningEffort } : {}),
      ...(options.resumeSessionId ? { resume: id } : { sessionId: id }),
    };
    const runQuery = this.config.query ?? query;
    return {
      id,
      async send(content) {
        if (sent) throw new Error('Claude session already received its input');
        if (controller.signal.aborted) throw new Error('Claude session cancelled');
        sent = true;
        deliver(content);
      },
      cancel,
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
            // Let the CLI retry transient errors and wait for its result.
            if (message.type === 'assistant' && message.error && message.message.content.some(
              block => block.type === 'text' && quotaExhausted(block.text),
            )) quotaRejected = true;
            if (message.type === 'result') {
              const completed = message.subtype === 'success' && !message.is_error;
              // Older CLIs can put the diagnostic only in the error result.
              const diagnostics = message.subtype === 'success' ? [message.result] : message.errors;
              yield { type: 'end', step: ++step, reason: completed ? 'completed' : quotaRejected || diagnostics.some(quotaExhausted) ? 'quota-exhausted' : 'error',
                ...(completed ? { finalAnswer: message.result } : {}), usage: tokenUsage(message) };
              return;
            }
          }
          if (!controller.signal.aborted) throw new Error('Claude stream ended without a result message');
        } catch (error) { if (!controller.signal.aborted) throw error; }
        finally { cancel(); }
      })(),
    };
  }
}

export class ClaudeExecutorDriver extends ClaudeDriver {
  constructor(config: ClaudeDriverConfig = {}) { super(config, 'executor'); }
}

export class ClaudeCoordinatorDriver extends ClaudeDriver {
  constructor(config: ClaudeDriverConfig = {}) { super(config, 'coordinator'); }
}
