import { normalizePlan } from './plans.js';
import { randomUUID } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { query, type ModelInfo, type Options, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { type Driver, type DriverCapabilities, type DriverEvent, type DriverSession, type SessionOptions, type AgentAvailability, type ModelOption, type TokenUsage } from './driver.js';
import { driverEnvironment, findExecutable, runtimeEnvironment } from './environment.js';
import { agentPrompt } from './prompts.js';
import { managedProcess } from './processes.js';
import type { AgentConfig } from './agents.js';

function claudeHome(agent: AgentConfig, home = homedir()) {
  return join(home, '.helm', 'agent-homes', agent.id);
}

// The external SDK boundary can be replaced without starting a CLI in npm test.
export type ClaudeQuery = (args: Parameters<typeof query>[0]) => AsyncIterable<SDKMessage> & { close(): void; supportedModels?(): Promise<ModelInfo[]> };

async function localClaude(env: Record<string, string>) {
  const path = await findExecutable('claude', env);
  if (!path) throw new Error('Local claude executable not found on PATH; install Claude Code and log in locally.');
  return path;
}

function tokenUsage(message: SDKResultMessage): TokenUsage {
  if (!message.modelUsage || !Object.keys(message.modelUsage).length) return { inputTokens: null, outputTokens: null };
  return Object.values(message.modelUsage).reduce((total, model) => ({
    inputTokens: total.inputTokens + model.inputTokens + model.cacheReadInputTokens + model.cacheCreationInputTokens,
    outputTokens: total.outputTokens + model.outputTokens,
    cacheReadTokens: total.cacheReadTokens + model.cacheReadInputTokens,
    cacheWriteTokens: total.cacheWriteTokens + model.cacheCreationInputTokens,
  }), { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
}

function quotaExhausted(text: string) {
  // Match CLI diagnostics only; callers exclude normal assistant text and give
  // successful results precedence. A bare rate_limit tag/HTTP 429 is ambiguous.
  return /you['’]ve hit your (?:(?:usage|session) )?limit|you['’]re out of extra usage|weekly (?:usage )?limit (?:reached|exceeded)|usage limit (?:reached|exceeded)/i.test(text)
    || /credit balance (?:is )?too low/i.test(text)
    || /invalid (?:api key|x-api-key|bearer token)/i.test(text);
}

type AuthStatus = (executable: string, options: { cwd: string; env: Record<string, string> }) => Promise<boolean>;
const authStatus: AuthStatus = async (executable, options) => {
  // Ask the CLI, which owns Keychain/file credentials. Never read its files.
  const { stdout } = await promisify(execFile)(executable, ['auth', 'status', '--json'],
    { ...options, timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
  const status = JSON.parse(stdout);
  return status.loggedIn === true && status.authMethod === 'claude.ai';
};

interface ClaudeDriverConfig { pathToClaudeCodeExecutable?: string; query?: ClaudeQuery; authStatus?: AuthStatus }

export class ClaudeDriver implements Driver {
  capabilities: DriverCapabilities = {
    cleanStart: { supported: true }, resume: true, contextUsage: true, coordinator: true,
    autoMemory: { status: 'disabled', mechanism: 'CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 与 SDK settings.autoMemoryEnabled=false，按会话关闭。' },
  };
  install = { executable: 'claude', command: 'npm install -g @anthropic-ai/claude-code', login: 'claude auth login' };
  constructor(private config: ClaudeDriverConfig = {}, private role?: 'coordinator' | 'executor') {}

  async checkAvailability(agent: AgentConfig): Promise<AgentAvailability> {
    const directory = claudeHome(agent);
    const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
    if (agent.home === 'dedicated') {
      const command = `mkdir -p ${quoted} && \${EDITOR:-vi} ${quoted}/settings.json`;
      try {
        if ((await stat(directory)).isDirectory() && (await stat(join(directory, 'settings.json'))).isFile()) return { available: true };
      } catch { /* Only file metadata is needed; the CLI validates contents. */ }
      return { available: false, reason: `API Agent 需要主目录 ${directory} 和 settings.json；请按 Claude 格式配置接口和 key。`, command };
    }
    const command = 'claude auth login';
    try {
      const env = runtimeEnvironment();
      const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(env);
      if (await (this.config.authStatus ?? authStatus)(executable, { cwd: homedir(), env })) return { available: true };
    } catch { /* Do not store CLI diagnostics, which may contain account details. */ }
    return { available: false, reason: `Claude 默认主目录未登录或无法检查登录状态；请确认已安装 Claude CLI 并登录。`, command };
  }

  async listModels(): Promise<ModelOption[]> {
    const env = runtimeEnvironment();
    const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(env);
    // An input stream that never yields: the CLI starts and answers control requests without a turn.
    async function* idle(): AsyncGenerator<never> { await new Promise(() => {}); }
    const session = (this.config.query ?? query)({ prompt: idle(), options: { pathToClaudeCodeExecutable: executable, cwd: homedir(), env } });
    const timer = setTimeout(() => session.close(), 30_000);
    try {
      const models = await session.supportedModels!();
      return models.map(model => ({ id: model.value === 'default' ? null : model.value, label: model.displayName,
        efforts: model.supportedEffortLevels ?? [], defaultEffort: null }));
    } finally { clearTimeout(timer); session.close(); }
  }

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const coordinator = (this.role ?? options.agent?.role) === 'coordinator';
    if (options.agent?.role === (coordinator ? 'executor' : 'coordinator')) {
      throw new Error(coordinator ? 'ClaudeCoordinatorDriver requires a coordinator Agent' : 'ClaudeExecutorDriver requires an executor Agent');
    }
    const cwd = await realpath(options.cwd);
    const executable = this.config.pathToClaudeCodeExecutable ?? await localClaude(options.env);
    const agent = options.agent;
    const loadGlobalConfig = agent.loadGlobalConfig;
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
    const env = driverEnvironment(options.env, { unset: ['CLAUDE_CONFIG_DIR'], set: {
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      ...(agent.home === 'dedicated' ? { CLAUDE_CONFIG_DIR: claudeHome(agent, options.env.HOME) } : {}),
    } });
    env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
    env.no_proxy = env.NO_PROXY;
    const sdkOptions: Options = {
      // A dedicated home holds the API settings and always loads its user layer.
      cwd, env, pathToClaudeCodeExecutable: executable,
      settingSources: agent.home === 'dedicated' ? ['user'] : loadGlobalConfig ? ['user', 'project', 'local'] : [],
      ...(!loadGlobalConfig ? { strictMcpConfig: true } : {}),
      settings: { autoMemoryEnabled: false, fastMode: false, ...(!loadGlobalConfig ? { disableClaudeAiConnectors: true } : {}) },
      // Claude discovers skills/ under this dispatch or coordinator round's copy.
      ...(agent.skillsPath ? { plugins: [{ type: 'local', path: resolve(agent.skillsPath, '..'), skipMcpDiscovery: true }] } : {}),
      skills: 'all',
      systemPrompt: agentPrompt(agent),
      permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true, abortController: controller,
      // Fix built-ins rather than inheriting the CLI's evolving defaults.
      // An explicit tools list hides Skill unless it is listed, even with `skills` set.
      tools: ['Bash', 'Read', 'Grep', 'Glob', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'TodoWrite', 'Skill'],
      spawnClaudeCodeProcess: processOptions => {
        controller.signal.throwIfAborted();
        const child = spawn(processOptions.command, processOptions.args, {
          cwd: processOptions.cwd ?? cwd, env: processOptions.env, signal: processOptions.signal,
          detached: true, stdio: ['pipe', 'pipe', 'pipe'],
        });
        child.stderr.on('data', chunk => sdkOptions.stderr?.(String(chunk)));
        if (child.pid) options.onProcess?.(managedProcess(child.pid));
        return child;
      },
      mcpServers: Object.fromEntries(Object.entries(options.mcpServers).map(([name, server]) =>
        [name, server.type === 'stdio' ? server : { ...server, type: 'http' }])),
      ...(options.agent?.model ? { model: options.agent.model } : {}),
      ...(options.agent?.reasoningEffort ? { effort: options.agent.reasoningEffort as Options['effort'] } : {}),
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
        let lastRequest: { model: string; tokens: number } | undefined;
        try {
          stream = runQuery({ prompt, options: sdkOptions });
          for await (const message of stream) {
            if (controller.signal.aborted) return;
            yield { type: 'output', step: ++step, text: JSON.stringify(message) };
            if (message.type === 'assistant' && !message.parent_tool_use_id) {
              // The last main-session request's prompt plus its reply is what a resume carries forward.
              const used = message.message.usage;
              if (used) lastRequest = { model: message.message.model, tokens: used.input_tokens + (used.cache_read_input_tokens ?? 0)
                + (used.cache_creation_input_tokens ?? 0) + used.output_tokens };
              for (const block of message.message.content) {
                if (block.type !== 'tool_use' || block.name !== 'TodoWrite') continue;
                const entries = normalizePlan((block.input as { todos?: unknown })?.todos);
                if (entries) yield { type: 'plan', step: ++step, entries };
              }
            }
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
              const window = lastRequest && message.modelUsage?.[lastRequest.model]?.contextWindow;
              yield { type: 'end', step: ++step, reason: completed ? 'completed' : quotaRejected || diagnostics.some(quotaExhausted) ? 'quota-exhausted' : 'error',
                ...(completed ? { finalAnswer: message.result } : {}), usage: tokenUsage(message),
                ...(lastRequest ? { context: { tokens: lastRequest.tokens, ...(window ? { window } : {}) } } : {}) };
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
