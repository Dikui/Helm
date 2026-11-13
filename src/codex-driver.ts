import { normalizePlan } from './plans.js';
import { execFile } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { type Driver, type DriverCapabilities, type DriverEvent, type DriverSession, type SessionOptions, type AgentAvailability, type ModelOption, type TokenUsage, type ContextSize, usageSince } from './driver.js';

interface CodexModel { model: string; displayName: string; hidden: boolean; isDefault: boolean;
  supportedReasoningEfforts: { reasoningEffort: string }[]; defaultReasoningEffort: string }
import { CodexRpc, type CodexCommand } from './codex-rpc.js';
import { driverEnvironment, runtimeEnvironment } from './environment.js';
import { agentPrompt } from './prompts.js';
import type { AgentConfig } from './agents.js';
import { helmVersion } from './version.js';

// Upstream defect workaround: https://github.com/openai/codex/issues/47483
// Disable only remote plugins to avoid connector reinstalls; Codex loads local plugins natively.
// ChatGPT connectors (codex_apps) add enough tools that Codex defers them behind search and agents miss helm's tools.
const appServer = { file: 'codex', args: ['app-server', '-c', 'features.remote_plugin=false', '-c', 'features.apps=false'] };
// A thread's config.features replaces the whole table from -c, so each thread repeats these flags.
const threadFeatures = { memories: false, apps: false, remote_plugin: false };
// Codex exposes MCP tools as mcp__<server>__<name> with hyphens turned into underscores; searching for the
// name the role prompts use ("submit-conclusion") finds nothing, and the model may then give up.
const toolNames = (example: string) => `Helm 的 MCP 工具在 Codex 里名为 mcp__helm__<工具名>，工具名中的连字符换成下划线，例如 ${example} 是 mcp__helm__${example.replaceAll('-', '_')}。按这个名字查找和调用；按名字查不到时，先列出全部可用工具再判断。`;

function codexHome(agent: AgentConfig, home = homedir()) {
  return join(home, '.helm', 'agent-homes', agent.id);
}

// env_key providers read the key from the process environment, which Helm filters;
// Codex also loads <CODEX_HOME>/.env itself, so the key stays in the CLI's home.
function missingVariable(failure: string | undefined, env: Record<string, string>) {
  const name = failure?.match(/Missing environment variable: `([^`]+)`/)?.[1];
  if (!name) return {};
  const dotenv = join(env.CODEX_HOME ?? join(env.HOME ?? homedir(), '.codex'), '.env');
  return { unavailable: { reason: `Codex 缺少环境变量 ${name}。Helm 不转发 shell 环境变量，请把 ${name}=<值> 写入 ${dotenv}，由 Codex 启动时自己读取，然后对该 Agent 重新检测。`,
    command: `\${EDITOR:-vi} '${dotenv.replaceAll("'", "'\\''")}'` } };
}

function quotaExhausted(error: any) {
  if (['usageLimitExceeded', 'unauthorized'].includes(error?.codexErrorInfo)) return true;
  const text = JSON.stringify(error);
  return /usage_limit_reached|insufficient_quota|invalid_api_key|quota exceeded|(?:usage|credit) limit (?:reached|exceeded)|you['’]ve hit your usage limit|you exceeded your current quota|(?:insufficient|exhausted) (?:credits|balance)|(?:credit|account) balance (?:is )?(?:too low|insufficient)|incorrect api key provided|invalid (?:api key|authentication token)|api key (?:is )?(?:invalid|expired|revoked)/i.test(text);
}

export class CodexDriver implements Driver {
  capabilities: DriverCapabilities = {
    // --ignore-user-config is exec-only; app-server starts with default LoaderOverrides.
    // https://github.com/openai/codex/blob/rust-v0.165.0/codex-rs/cli/src/main.rs
    cleanStart: { supported: false, reason: 'Codex 0.165.0 的 app-server 无法跳过用户与项目配置，仍会加载全局规则、MCP、skills 和 hooks。' },
    resume: true, contextUsage: true, coordinator: true,
    autoMemory: { status: 'disabled', mechanism: '会话配置 features.memories=false、memories.generate_memories=false、memories.use_memories=false，关闭后台整理、生成与加载。' },
  };
  install = { executable: 'codex', command: 'npm install -g @openai/codex', login: 'codex login' };
  constructor(private config: { command?: CodexCommand } = {}, private role?: 'coordinator' | 'executor') {}

  async checkAvailability(agent: AgentConfig): Promise<AgentAvailability> {
    const directory = codexHome(agent);
    const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
    if (agent.home === 'dedicated') {
      try {
        if ((await stat(directory)).isDirectory() && (await stat(join(directory, 'config.toml'))).isFile()) return { available: true };
      } catch { /* Only metadata: the CLI owns and validates this configuration. */ }
      return { available: false, reason: `API Agent 需要主目录 ${directory} 和 config.toml；请按 Codex 格式配置接口和 key。Helm 不转发 shell 环境变量，env_key 引用的变量请写入该目录的 .env。`,
        command: `mkdir -p ${quoted} && \${EDITOR:-vi} ${quoted}/config.toml` };
    }
    try {
      const command = this.config.command ?? { file: 'codex', args: [] };
      // The CLI owns file/Keychain credentials. Only its exit code matters.
      await promisify(execFile)(command.file, [...command.args, 'login', 'status'], {
        cwd: homedir(), env: runtimeEnvironment(), timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024,
      });
      return { available: true };
    } catch { /* Never store CLI output, which can contain account details. */ }
    return { available: false, reason: 'Codex 默认主目录未登录或无法检查登录状态；请确认已安装 Codex CLI 并登录。', command: 'codex login' };
  }

  async listModels(): Promise<ModelOption[]> {
    const rpc = new CodexRpc(this.config.command ?? appServer, { cwd: homedir() }, runtimeEnvironment());
    const timer = setTimeout(() => rpc.close(), 30_000);
    try {
      await rpc.request('initialize', { clientInfo: { name: 'helm', title: 'Helm', version: helmVersion }, capabilities: { experimentalApi: true } });
      rpc.notify('initialized', {});
      const models: CodexModel[] = [];
      let cursor: string | null = null;
      do {
        const page: { data: CodexModel[]; nextCursor?: string | null } = await rpc.request('model/list', cursor ? { cursor } : {});
        models.push(...page.data);
        cursor = page.nextCursor ?? null;
      } while (cursor);
      const option = (model: CodexModel, id: string | null): ModelOption => ({ id, label: model.displayName,
        efforts: model.supportedReasoningEfforts.map(effort => effort.reasoningEffort), defaultEffort: model.defaultReasoningEffort });
      const fallback = models.find(model => model.isDefault);
      return [...fallback ? [option(fallback, null)] : [], ...models.filter(model => !model.hidden).map(model => option(model, model.model))];
    } finally { clearTimeout(timer); rpc.close(); }
  }

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const coordinator = (this.role ?? options.agent?.role) === 'coordinator';
    const agent = options.agent;
    if (agent.role !== (coordinator ? 'coordinator' : 'executor')) throw new Error(coordinator
      ? 'CodexCoordinatorDriver requires a coordinator Agent' : 'CodexExecutorDriver requires an executor Agent');
    const cwd = await realpath(options.cwd);
    if (!options.dataDir) throw new Error('Codex requires a dispatch or round data directory');
    const sqlitePath = join(resolve(options.dataDir), 'codex-sqlite');
    await mkdir(sqlitePath, { recursive: true, mode: 0o700 });
    const env = driverEnvironment(options.env, { unset: ['CODEX_HOME'], set: {
      CODEX_SQLITE_HOME: sqlitePath,
      ...(agent.home === 'dedicated' ? { CODEX_HOME: codexHome(agent, options.env.HOME) } : {}),
    } });
    if (env.CODEX_HOME) await mkdir(env.CODEX_HOME, { recursive: true, mode: 0o700 });
    env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
    env.no_proxy = env.NO_PROXY;
    options.signal?.throwIfAborted();
    const rpc = new CodexRpc(this.config.command ?? appServer, { ...options, cwd }, env);
    let cancelled = false;
    const cancel = () => {
      cancelled = true;
      options.signal?.removeEventListener('abort', cancel);
      rpc.close();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (options.signal?.aborted) cancel();
      const before = performance.now();
      await rpc.request('initialize', { clientInfo: { name: 'helm', title: 'Helm', version: helmVersion }, capabilities: { experimentalApi: true } });
      const initializeDurationMs = Math.round(performance.now() - before);
      rpc.notify('initialized', {});
      await rpc.request('skills/extraRoots/set', { extraRoots: agent.skillsPath ? [agent.skillsPath] : [] });
      const thread = await rpc.request(options.resumeSessionId ? 'thread/resume' : 'thread/start', {
        ...(options.resumeSessionId ? { threadId: options.resumeSessionId } : {}), cwd, sandbox: 'danger-full-access', approvalPolicy: 'never',
        ...(agent.model ? { model: agent.model } : {}), developerInstructions: `${agentPrompt(agent)}\n\n${toolNames(coordinator ? 'create-card' : 'submit-conclusion')}`,
        serviceTier: agent.fast ? 'fast' : 'default',
        config: {
          // Opt out of future extraction and disable startup consolidation as well as injection.
          // https://github.com/openai/codex/blob/main/codex-rs/memories/write/src/start.rs
          features: threadFeatures,
          memories: { generate_memories: false, use_memories: false },
          // The app-server environment is already filtered by Helm. Forward it
          // to shell commands, including project KEY/SECRET/TOKEN variables.
          ...(!coordinator ? { shell_environment_policy: { inherit: 'all', ignore_default_excludes: true,
            exclude: [], include_only: [], set: {}, experimental_use_profile: false } } : {}),
          ...(agent.fast ? { service_tier: 'fast' } : {}),
          mcp_servers: Object.fromEntries(Object.entries(options.mcpServers).map(([name, server]) => [name, {
            ...(server.type === 'stdio' ? { command: server.command, args: server.args, env: server.env }
              : { url: server.url, http_headers: server.headers }),
            default_tools_approval_mode: 'approve',
          }])),
        },
      });
      const id = thread?.thread?.id;
      if (typeof id !== 'string' || !id || (options.resumeSessionId && id !== options.resumeSessionId)) throw new Error('Codex did not return the requested thread');
      let sent = false;
      let turnId: string | undefined;
      return {
        id, sqlitePath, cancel,
        async send(content) {
          if (sent || cancelled) throw new Error('Codex session already received input or was cancelled');
          sent = true;
          const response = await rpc.request('turn/start', { threadId: id, input: [{ type: 'text', text: content }],
            approvalPolicy: 'never',
            ...(agent.reasoningEffort ? { effort: agent.reasoningEffort } : {}) });
          turnId = response?.turn?.id;
        },
        events: (async function* (): AsyncGenerator<DriverEvent> {
          let step = 0;
          // tokenUsage.total counts the whole thread, earlier runs included. Seen with Codex CLI 0.167.2 over two
          // app-server processes (2026-11-12): the thread/resume response carries no usage; right after it the server
          // replays one thread/tokenUsage/updated with the previous turn's turnId and the restored total
          // (input 16008 / output 5), and the resumed turn then reports 32040 / 10 under its own turnId. So the
          // baseline of a resumed run is the total notified under any other turn, and the run spent the difference
          // (16032 / 5). No replay means the thread restored no total and counts from zero.
          let restored: TokenUsage | undefined;
          let total: TokenUsage | undefined;
          const usage = (): TokenUsage => !total ? { inputTokens: null, outputTokens: null } : restored ? usageSince(total, restored) : total;
          let context: ContextSize | undefined;
          let finalAnswer = '';
          let terminalError: unknown;
          try {
            yield { type: 'output', step: ++step, text: JSON.stringify({ initializeDurationMs }) };
            for await (const message of rpc.notifications()) {
              if (cancelled) return;
              yield { type: 'output', step: ++step, text: JSON.stringify(message) };
              const params = message.params;
              const reported = message.method === 'thread/tokenUsage/updated' && params?.threadId === id ? params.tokenUsage?.total : undefined;
              const threadTotal: TokenUsage | undefined = reported && { inputTokens: reported.inputTokens ?? null, outputTokens: reported.outputTokens ?? null,
                ...(reported.cachedInputTokens != null ? { cacheReadTokens: reported.cachedInputTokens } : {}),
                ...(reported.cacheWriteInputTokens != null ? { cacheWriteTokens: reported.cacheWriteInputTokens } : {}) };
              // Before turn/start answers, a resumed thread can only be reporting an earlier turn.
              if (threadTotal && options.resumeSessionId && params.turnId && params.turnId !== turnId) { restored = threadTotal; continue; }
              if (params?.threadId !== id || (params?.turnId && turnId && params.turnId !== turnId)) continue;
              if (message.method === 'turn/plan/updated') {
                const entries = normalizePlan(params.plan, 'step');
                if (entries) yield { type: 'plan', step: ++step, entries };
              }
              if (threadTotal) {
                total = threadTotal;
                // The latest request's input grows with the thread; Codex documents no other occupancy figure.
                const last = params.tokenUsage.last;
                if (typeof last?.inputTokens === 'number') context = { tokens: last.inputTokens + (last.outputTokens ?? 0),
                  ...(typeof params.tokenUsage.modelContextWindow === 'number' ? { window: params.tokenUsage.modelContextWindow } : {}) };
              }
              if (message.method === 'error' && !params.willRetry) terminalError = params.error;
              if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') finalAnswer = params.item.text;
              if (message.method === 'thread/compacted' || (message.method === 'item/completed' && params.item?.type === 'contextCompaction')) yield { type: 'compaction', step: ++step };
              if (message.method === 'turn/completed' && (!turnId || params.turn.id === turnId)) {
                const turn = params.turn;
                const completed = turn.status === 'completed';
                const answer = turn.items?.filter((item: any) => item.type === 'agentMessage' && item.phase !== 'commentary').at(-1)?.text ?? finalAnswer;
                const error = turn.error ?? terminalError;
                const failure = completed ? undefined : [error?.message, error?.additionalDetails].filter(item => typeof item === 'string' && item).join(': ') || undefined;
                yield { type: 'end', step: ++step, reason: completed ? 'completed' : turn.status === 'interrupted' ? 'aborted'
                  : quotaExhausted(error) ? 'quota-exhausted' : 'error',
                  ...(completed ? { finalAnswer: answer } : {}), ...(failure ? { failure } : {}), ...missingVariable(failure, env),
                  usage: usage(), ...(context ? { context } : {}) };
                return;
              }
            }
          } catch (error) {
            if (!cancelled) {
              yield { type: 'output', step: ++step, text: String(error) };
              yield { type: 'end', step: ++step, reason: 'error', usage: usage() };
            }
          } finally { cancel(); }
        })(),
      };
    } catch (error) { cancel(); throw error; }
  }
}

export class CodexExecutorDriver extends CodexDriver {
  constructor(config: { command?: CodexCommand } = {}) { super(config, 'executor'); }
}

export class CodexCoordinatorDriver extends CodexDriver {
  constructor(config: { command?: CodexCommand } = {}) { super(config, 'coordinator'); }
}
