import { execFile } from 'node:child_process';
import { mkdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Driver, DriverEvent, DriverSession, SessionOptions, AgentAvailability, TokenUsage } from './driver.js';
import { CodexRpc, type CodexCommand } from './codex-rpc.js';
import { runtimeEnvironment } from './environment.js';
import { agentPrompt } from './prompts.js';
import type { AgentConfig } from './agents.js';

function codexHome(agent: AgentConfig, home = homedir()) {
  return join(home, '.helm', 'agent-homes', agent.id);
}

function quotaExhausted(error: any) {
  if (['usageLimitExceeded', 'unauthorized'].includes(error?.codexErrorInfo)) return true;
  const text = JSON.stringify(error);
  return /usage_limit_reached|insufficient_quota|invalid_api_key|quota exceeded|(?:usage|credit) limit (?:reached|exceeded)|you['’]ve hit your usage limit|you exceeded your current quota|(?:insufficient|exhausted) (?:credits|balance)|(?:credit|account) balance (?:is )?(?:too low|insufficient)|incorrect api key provided|invalid (?:api key|authentication token)|api key (?:is )?(?:invalid|expired|revoked)/i.test(text);
}

export class CodexDriver implements Driver {
  install = { executable: 'codex', command: 'npm install -g @openai/codex', login: 'codex login' };
  constructor(private config: { command?: CodexCommand } = {}, private role?: 'coordinator' | 'executor') {}

  async checkAvailability(agent: AgentConfig): Promise<AgentAvailability> {
    const directory = codexHome(agent);
    const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
    if (agent.home === 'dedicated') {
      try {
        if ((await stat(directory)).isDirectory() && (await stat(join(directory, 'config.toml'))).isFile()) return { available: true };
      } catch { /* Only metadata: the CLI owns and validates this configuration. */ }
      return { available: false, reason: `API Agent 需要主目录 ${directory} 和 config.toml；请按 Codex 格式配置接口和 key。`,
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

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const coordinator = (this.role ?? options.agent?.role) === 'coordinator';
    const agent = options.agent;
    if (coordinator && (agent.role !== 'coordinator' || options.sandbox.mode !== 'read-only'
      || options.sandbox.writableRoots.length || options.resumeSessionId !== undefined)) {
      throw new Error('CodexCoordinatorDriver requires a fresh read-only coordinator round');
    }
    if (!coordinator && (agent.role !== 'executor' || options.sandbox.mode !== 'workspace-write' || options.sandbox.writableRoots.length !== 1)) {
      throw new Error('CodexExecutorDriver requires an executor card copy');
    }
    const cwd = await realpath(options.cwd);
    if (!coordinator && await realpath(options.sandbox.writableRoots[0]!) !== cwd) throw new Error('Codex executor writable roots must contain only its card copy');
    if (!options.dataDir) throw new Error('Codex requires a dispatch or round data directory');
    const sqlitePath = join(resolve(options.dataDir), 'codex-sqlite');
    await mkdir(sqlitePath, { recursive: true, mode: 0o700 });
    const env: Record<string, string> = { ...options.env, CODEX_SQLITE_HOME: sqlitePath };
    delete env.CODEX_HOME;
    if (agent.home === 'dedicated') {
      env.CODEX_HOME = codexHome(agent, options.env.HOME);
      await mkdir(env.CODEX_HOME, { recursive: true, mode: 0o700 });
    }
    env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
    env.no_proxy = env.NO_PROXY;
    options.signal?.throwIfAborted();
    const rpc = new CodexRpc(this.config.command ?? { file: 'codex', args: ['app-server'] }, { ...options, cwd }, env);
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
      await rpc.request('initialize', { clientInfo: { name: 'helm', title: 'Helm', version: '0.1.0' }, capabilities: { experimentalApi: true } });
      const initializeDurationMs = Math.round(performance.now() - before);
      rpc.notify('initialized', {});
      await rpc.request('skills/extraRoots/set', { extraRoots: agent.skillsPath ? [agent.skillsPath] : [] });
      const thread = await rpc.request(options.resumeSessionId ? 'thread/resume' : 'thread/start', {
        ...(options.resumeSessionId ? { threadId: options.resumeSessionId } : {}), cwd, sandbox: coordinator ? 'read-only' : 'workspace-write', approvalPolicy: 'never',
        ...(agent.model ? { model: agent.model } : {}), developerInstructions: agentPrompt(agent),
        serviceTier: agent.fast ? 'fast' : 'default',
        config: {
          ...(agent.fast ? { service_tier: 'fast' } : {}),
          ...(!coordinator ? { sandbox_workspace_write: { writable_roots: [cwd], network_access: true, exclude_slash_tmp: true, exclude_tmpdir_env_var: true } } : {}),
          mcp_servers: Object.fromEntries(Object.entries(options.mcpServers).map(([name, server]) => [name, {
            url: server.url, http_headers: server.headers, default_tools_approval_mode: 'approve',
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
            approvalPolicy: 'never', sandboxPolicy: coordinator ? { type: 'readOnly' } : { type: 'workspaceWrite', writableRoots: [cwd], networkAccess: true, excludeSlashTmp: true, excludeTmpdirEnvVar: true },
            ...(agent.reasoningEffort ? { effort: agent.reasoningEffort === 'max' ? 'xhigh' : agent.reasoningEffort } : {}) });
          turnId = response?.turn?.id;
        },
        events: (async function* (): AsyncGenerator<DriverEvent> {
          let step = 0;
          let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
          let finalAnswer = '';
          let terminalError: unknown;
          try {
            yield { type: 'output', step: ++step, text: JSON.stringify({ initializeDurationMs }) };
            for await (const message of rpc.notifications()) {
              if (cancelled) return;
              yield { type: 'output', step: ++step, text: JSON.stringify(message) };
              const params = message.params;
              if (params?.threadId !== id || (params?.turnId && turnId && params.turnId !== turnId)) continue;
              if (message.method === 'thread/tokenUsage/updated' && params.tokenUsage?.total) {
                const total = params.tokenUsage.total;
                usage = { inputTokens: total.inputTokens, outputTokens: total.outputTokens };
              }
              if (message.method === 'error' && !params.willRetry) terminalError = params.error;
              if (message.method === 'item/completed' && params.item?.type === 'agentMessage' && params.item.phase !== 'commentary') finalAnswer = params.item.text;
              if (message.method === 'thread/compacted' || (message.method === 'item/completed' && params.item?.type === 'contextCompaction')) yield { type: 'compaction', step: ++step };
              if (message.method === 'turn/completed' && (!turnId || params.turn.id === turnId)) {
                const turn = params.turn;
                const completed = turn.status === 'completed';
                const answer = turn.items?.filter((item: any) => item.type === 'agentMessage' && item.phase !== 'commentary').at(-1)?.text ?? finalAnswer;
                yield { type: 'end', step: ++step, reason: completed ? 'completed' : turn.status === 'interrupted' ? 'aborted'
                  : quotaExhausted(turn.error ?? terminalError) ? 'quota-exhausted' : 'error',
                  ...(completed ? { finalAnswer: answer } : {}), usage };
                return;
              }
            }
          } catch (error) {
            if (!cancelled) {
              yield { type: 'output', step: ++step, text: String(error) };
              yield { type: 'end', step: ++step, reason: 'error', usage };
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
