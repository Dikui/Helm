import { normalizePlan } from './plans.js';
import { realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_VERSION, RequestError, type InitializeResponse, type NewSessionRequest, type SessionConfigOption } from '@agentclientprotocol/sdk';
import { z } from 'zod';
import { acpAgents, configValues } from './acp-agents.js';
import { AcpClient, type AcpCommand } from './acp-client.js';
import type { Driver, DriverEvent, DriverSession, SessionOptions, AgentAvailability, ModelOption, ModelContext } from './driver.js';
import { agentPrompt } from './prompts.js';
import { agentEnvironment, type AgentConfig } from './agents.js';
import { RuleError } from './store.js';

type EventContent<Event = DriverEvent> = Event extends DriverEvent ? Omit<Event, 'step'> : never;
const extensionUpdate = z.object({ sessionId: z.string(), update: z.object({ sessionUpdate: z.string() }) });
const promptResponse = z.object({ stopReason: z.string() });

export class AcpDriver implements Driver {
  private profile;
  constructor(private agent: keyof typeof acpAgents, private config: { command?: AcpCommand; timeoutMs?: number } = {}) {
    this.profile = acpAgents[agent];
    this.install = { executable: this.profile.command, command: this.profile.installCommand, login: this.profile.loginCommand };
  }
  install;

  private environment(base: Record<string, string>, agent: AgentConfig) {
    const env = { ...base, ...this.profile.environment.set };
    for (const key of this.profile.environment.unset) delete env[key];
    if (this.profile.homeVariable && agent.home === 'dedicated') env[this.profile.homeVariable] = join(base.HOME ?? homedir(), '.helm', 'agent-homes', agent.id);
    return env;
  }

  private async launch(agent: AgentConfig, options: Pick<SessionOptions, 'cwd' | 'onProcess'>,
    env: Record<string, string>, handlers: ConstructorParameters<typeof AcpClient>[3]) {
    const command = this.config.command ?? { file: this.profile.command, args: [] };
    const prepared = await this.profile.prepare?.(agent);
    try {
      const acp = new AcpClient({ file: command.file,
        args: [...command.args, ...this.profile.arguments(agent), ...(prepared?.args ?? [])] }, options, env, handlers);
      let closing: Promise<void> | undefined;
      return { acp, close: () => closing ??= acp.close().finally(() => prepared?.cleanup()) };
    } catch (error) { await prepared?.cleanup(); throw error; }
  }

  private async initialize(acp: AcpClient, agent: AgentConfig): Promise<InitializeResponse> {
    const result = await acp.connection.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'helm', version: '0.1.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('ACP agent does not support protocol v1');
    if (this.profile.authentication && !result.authMethods?.some(method => method.id === this.profile.authentication)) {
      throw new Error(`ACP agent does not offer ${this.profile.authentication}`);
    }
    if (!result.agentCapabilities?.mcpCapabilities?.http) throw new Error('ACP agent does not support HTTP MCP');
    const reason = this.profile.initializationUnavailable(agent, result);
    if (reason) throw new Error(reason);
    return result;
  }

  private async configureSession(acp: AcpClient, agent: AgentConfig, sessionId: string,
    configOptions: SessionConfigOption[] | null | undefined, output: (message: unknown) => void) {
    const settings = this.profile.sessionSettings(agent, configOptions);
    const expected = new Map(settings.map(setting => [setting.id, setting.value]));
    for (const setting of settings.filter(setting => setting.apply)) {
      const values = configValues(configOptions, setting.id);
      if (setting.optional && !values.length) { expected.delete(setting.id); continue; }
      const selected = values.find(value => value.value === setting.value);
      if (!selected) throw new Error(`${this.profile.name} 会话配置 ${setting.id} 没有公布取值 ${setting.value}，不能使用 Agent 指定的设置。`);
      expected.set(setting.id, selected.value);
      const response = await acp.connection.agent.request('session/set_config_option', { sessionId, configId: setting.id, value: selected.value });
      output({ method: 'session/set_config_option', configId: setting.id, result: response });
      configOptions = response.configOptions;
    }
    // A model change can reset reasoning effort; verify the final full state.
    for (const setting of settings.filter(setting => expected.has(setting.id))) {
      const current = configOptions?.find(option => option.id === setting.id)?.currentValue;
      if (current !== expected.get(setting.id)) throw new Error(`${this.profile.name} 会话配置 ${setting.id} 与 Agent 不一致：期望 ${expected.get(setting.id)}，实际 ${current ?? '未公布'}。`);
    }
  }

  async listModels(context?: ModelContext): Promise<ModelOption[]> {
    // Start with CLI defaults; DeepSeek publishes full routes only after session/new.
    const probe: AgentConfig = { id: `${this.agent}-models`, role: 'executor', driver: this.agent, model: null, reasoningEffort: null,
      fast: false, home: 'shared', description: '', prompt: '', rules: { role: '', runtime: '' }, directory: homedir(), skillsPath: null, ...context };
    const env = this.environment(agentEnvironment(probe), probe);
    const home = await this.homeAvailability(probe, env);
    if (home) throw new Error(home.reason);
    const { acp, close } = await this.launch(probe, { cwd: homedir() }, env,
      { update() {}, output() {}, permission: () => ({ outcome: { outcome: 'cancelled' } }) });
    const timer = setTimeout(() => { void close(); }, this.config.timeoutMs ?? 30_000);
    try {
      const response = await acp.connection.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION,
        clientInfo: { name: 'helm', version: '0.1.0' }, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
      if (typeof this.profile.models === 'function') return this.profile.models(response);
      const session = await acp.connection.agent.request('session/new', { cwd: homedir(), mcpServers: [] });
      try {
        const models = this.profile.models.session(session.configOptions);
        for (const model of models) {
          try {
            const configured = await acp.connection.agent.request('session/set_config_option', {
              sessionId: session.sessionId, configId: 'model', value: model.id!,
            });
            if (configured.configOptions.find(option => option.id === 'model')?.currentValue !== model.id) {
              model.unavailableReason = `${this.profile.name} 会话未应用模型路由 ${model.id}。`;
              continue;
            }
            model.efforts = configValues(configured.configOptions, 'reasoning_effort').map(option => option.value).filter(Boolean);
          } catch (error) {
            // A provider may list models without valid login. Keep its advertised
            // routes visible without hiding usable providers; preflight retries it.
            if (!(error instanceof RequestError)) throw error;
            model.unavailableReason = error.message;
          }
        }
        return models;
      } finally { await acp.connection.agent.request('session/close', { sessionId: session.sessionId }); }
    } finally { clearTimeout(timer); await close(); }
  }

  private async homeAvailability(agent: AgentConfig, env: Record<string, string>): Promise<AgentAvailability | undefined> {
    if (this.profile.homeVariable && agent.home === 'dedicated') {
      const directory = env[this.profile.homeVariable]!;
      try {
        if (!(await stat(directory)).isDirectory()) throw new Error('not a directory');
        const configured = await Promise.all((this.profile.homeConfigFiles ?? []).map(file => stat(join(directory, file)).then(info => info.isFile(), () => false)));
        if (!configured.some(Boolean)) throw new Error('missing CLI configuration');
      } catch {
        const quoted = `'${directory.replaceAll("'", "'\\''")}'`;
        return { available: false, reason: `Agent 需要专用主目录 ${directory}；请按 dsh 格式配置接口和 key（Helm 不读取凭据）。`,
          command: `mkdir -p ${quoted} && DSH_HOME=${quoted} dsh web` };
      }
    }
  }

  // Preflight and dispatch use the same activation and final-state checks.
  private async activateSession(acp: AcpClient, agent: AgentConfig, request: NewSessionRequest,
    resumeSessionId: string | undefined, output: (message: unknown) => void) {
    if (this.profile.authentication) await acp.connection.agent.request('authenticate', { methodId: this.profile.authentication });
    const method = resumeSessionId === undefined ? 'session/new' : 'session/resume';
    const session = resumeSessionId === undefined
      ? await acp.connection.agent.request('session/new', request)
      : await acp.connection.agent.request('session/resume', { ...request, sessionId: resumeSessionId });
    const id = resumeSessionId ?? ('sessionId' in session ? session.sessionId : undefined);
    if (typeof id !== 'string' || !id) throw new Error('ACP agent did not return a session id');
    output({ method, result: session });
    try {
      await this.configureSession(acp, agent, id, session.configOptions, output);
      return id;
    } catch (error) {
      // Close a session even when validation fails, before terminating its CLI.
      await acp.connection.agent.request('session/close', { sessionId: id }).catch(() => {});
      throw error;
    }
  }

  async checkAvailability(agent: AgentConfig): Promise<AgentAvailability> {
    const reason = this.profile.unavailable(agent);
    if (reason) return { available: false, reason };
    const env = this.environment(agentEnvironment(agent), agent);
    const home = await this.homeAvailability(agent, env);
    if (home) return home;
    let close: (() => Promise<void>) | undefined;
    let timer: NodeJS.Timeout | undefined;
    try {
      const launched = await this.launch(agent, { cwd: homedir() }, env,
        { update() {}, output() {}, permission: () => ({ outcome: { outcome: 'cancelled' } }) });
      close = launched.close;
      const { acp } = launched;
      timer = setTimeout(() => { void close!(); }, this.config.timeoutMs ?? 10_000);
      await this.initialize(acp, agent);
      if (this.agent === 'deepseek') {
        const id = await this.activateSession(acp, agent, { cwd: homedir(), mcpServers: [] }, undefined, () => {});
        await acp.connection.agent.request('session/close', { sessionId: id });
      }
      return { available: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = this.agent === 'deepseek' ? message
        : `${this.profile.name} 无法完成 ACP initialize 或缺少 ${this.profile.authentication} / HTTP MCP；请检查 CLI 安装和模型参数，运行 ${this.profile.loginCommand} 登录。${String(error)}`;
      return { available: false, reason, command: `${this.profile.installCommand} && ${this.profile.loginCommand}` };
    } finally { clearTimeout(timer); await close?.(); }
  }

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const mcpServers = Object.entries(options.mcpServers).map(([name, server]) => {
      if (server.type === 'stdio') throw new RuleError('UNSUPPORTED_MCP_TRANSPORT',
        `ACP 驱动 ${this.agent} 不支持 stdio MCP：${name}。`, 400, { driver: this.agent, mcpName: name, transport: 'stdio' });
      return { type: 'http' as const, name, url: server.url,
        headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })) };
    });
    const agent = options.agent;
    const profile = this.profile;
    const reason = this.profile.unavailable(agent);
    if (reason) throw new Error(reason);
    if (agent.driver !== this.agent || options.sandbox.mode !== 'workspace-write' || options.sandbox.writableRoots.length !== 1) {
      throw new Error('ACP executor requires an executor card copy');
    }
    const cwd = await realpath(options.cwd);
    if (await realpath(options.sandbox.writableRoots[0]!) !== cwd) throw new Error('ACP executor writable roots must contain only its card copy');
    options.signal?.throwIfAborted();
    const queue: DriverEvent[] = [];
    let wake: (() => void) | undefined;
    let step = 0;
    let id: string | undefined;
    let finalAnswer = '';
    const toolInputs = new Map<string, unknown>();
    let sent = false;
    let finished = false;
    let settling = false;
    let previousUsage = { inputTokens: 0, outputTokens: 0 };
    let cancelled = false;
    let cancellation: Promise<void> | undefined;
    let cancelTimer: NodeJS.Timeout | undefined;
    let resolveEnded!: () => void;
    const ended = new Promise<void>(resolve => { resolveEnded = resolve; });
    const push = (event: EventContent) => { if (!finished) { queue.push({ ...event, step: ++step }); wake?.(); } };
    const output = (message: unknown) => push({ type: 'output', text: JSON.stringify(message) });
    const finish = (event: Extract<EventContent, { type: 'end' }>) => {
      if (finished) return;
      push(event);
      finished = true;
      clearTimeout(cancelTimer);
      resolveEnded();
      wake?.();
      void close();
    };
    const env = this.environment(options.env, agent);
    const home = await this.homeAvailability(agent, env);
    if (home) throw new Error(home.reason);
    const { acp, close: closeAgent } = await this.launch(agent, { ...options, cwd }, env, {
      notifications: profile.compactionNotification ? [profile.compactionNotification.method] : [],
      output(message) {
        output(message);
        if (message.method !== profile.compactionNotification?.method) return;
        const notification = extensionUpdate.safeParse(message.params);
        if (notification.success && notification.data.sessionId === id
          && notification.data.update.sessionUpdate === profile.compactionNotification.sessionUpdate) push({ type: 'compaction' });
      },
      update(notification) {
        output({ method: 'session/update', params: notification });
        if (notification.sessionId !== id) return;
        const update = notification.update;
        if (update.sessionUpdate === 'plan') {
          const entries = normalizePlan(update.entries);
          if (entries) push({ type: 'plan', entries });
        }
        if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && update.rawInput !== undefined) toolInputs.set(update.toolCallId, update.rawInput);
        if (update.sessionUpdate === 'tool_call') finalAnswer = '';
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') finalAnswer += update.content.text;
      },
      permission(request) {
        const input = request.toolCall.rawInput ?? toolInputs.get(request.toolCall.toolCallId);
        const allowed = request.sessionId === id && (profile.permissionAllowed?.(input) ?? true);
        const option = allowed ? request.options.find(option => option.kind === 'allow_once') : undefined;
        // Selecting a persistent rejection can also mutate the user's settings.
        const reject = request.options.find(option => option.kind === 'reject_once');
        const selected = option ?? reject;
        const response = { outcome: selected ? { outcome: 'selected' as const, optionId: selected.optionId } : { outcome: 'cancelled' as const } };
        output({ method: 'session/request_permission', sessionId: request.sessionId, toolCall: request.toolCall, allowed: !!option, response });
        return response;
      },
    });
    const settle = async (event: Extract<EventContent, { type: 'end' }>) => {
      if (finished || settling) return;
      settling = true;
      clearTimeout(cancelTimer);
      if (id && profile.sessionUsage) {
        let flushTimer: NodeJS.Timeout | undefined;
        try {
          // dsh buffers durable events. session/close drains and flushes before
          // we read usage; killing the process first can discard this turn.
          await Promise.race([
            acp.connection.agent.request('session/close', { sessionId: id }),
            new Promise((_, reject) => { flushTimer = setTimeout(() => reject(new Error('ACP session/close timed out')), 1000); }),
          ]);
        } catch (error) { output({ method: 'session/close', error: String(error) }); }
        finally { clearTimeout(flushTimer); }
        try {
          const total = await profile.sessionUsage(env, id);
          event.usage = { inputTokens: Math.max(0, total.inputTokens - previousUsage.inputTokens),
            outputTokens: Math.max(0, total.outputTokens - previousUsage.outputTokens) };
        } catch (error) { output({ method: 'helm/usage', error: `${profile.name} 用量读取失败：${String(error)}` }); }
      }
      finish(event);
    };
    const close = () => {
      options.signal?.removeEventListener('abort', cancel);
      return cancellation ?? closeAgent();
    };
    const cancel = () => {
      if (finished || settling || cancelled) return;
      cancelled = true;
      cancellation = ended.then(() => closeAgent());
      const aborted = () => { void settle({ type: 'end', reason: 'aborted', usage: { inputTokens: 0, outputTokens: 0 } }); };
      // Give a cooperative agent a bounded chance to persist the turn and its
      // usage. Process/cwd cleanup is still performed by the execution layer.
      cancelTimer = setTimeout(aborted, 1000);
      if (id) {
        void acp.connection.agent.notify('session/cancel', { sessionId: id }).then(() => { if (!sent) aborted(); }, aborted);
      } else aborted();
    };
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.config.timeoutMs ?? 10_000);
    try {
      if (options.signal?.aborted) cancel();
      const initialized = await this.initialize(acp, agent);
      if (options.resumeSessionId !== undefined && !initialized.agentCapabilities?.sessionCapabilities?.resume) {
        throw new Error('ACP agent does not support session/resume');
      }
      if (cancelled) throw new Error('ACP session cancelled during startup');
      id = await this.activateSession(acp, agent, { cwd, mcpServers }, options.resumeSessionId, output);
      if (cancelled) throw new Error('ACP session cancelled during startup');
      if (profile.sessionUsage) previousUsage = await profile.sessionUsage(env, id, true);
      if (cancelled) throw new Error('ACP session cancelled during startup');
      clearTimeout(timer);
      return {
        id, cancel,
        async send(content) {
          if (sent || cancelled) throw new Error('ACP session already received input or was closed');
          sent = true;
          // session/prompt resolves only at the end of the turn. Keep send()
          // nonblocking so helmd can consume updates and reset its idle timer.
          void acp.connection.agent.request('session/prompt', { sessionId: id!, prompt: [
            { type: 'text', text: agentPrompt(agent) }, { type: 'text', text: content },
          ] }).then(async response => {
            promptResponse.parse(response);
            output({ method: 'session/prompt', result: response });
            const completed = !cancelled && response.stopReason === 'end_turn';
            await settle({ type: 'end', reason: cancelled ? 'aborted' : completed ? 'completed' : response.stopReason === 'cancelled' ? 'aborted' : 'error',
              ...(completed ? { finalAnswer } : !cancelled && response.stopReason !== 'cancelled' ? { failure: `ACP session/prompt stopped: ${response.stopReason}` } : {}),
              usage: profile.usage(response) });
          }).catch(async error => {
            const failure = error instanceof RequestError ? JSON.stringify({ code: error.code, message: error.message, data: error.data }) : String(error);
            output({ method: 'session/prompt', error: failure });
            const quota = (error instanceof RequestError && profile.quotaErrors.codes.includes(error.code)) || profile.quotaErrors.pattern.test(failure);
            await settle({ type: 'end', reason: cancelled ? 'aborted' : profile.contextOverflowErrors?.test(failure) ? 'context-overflow' : quota ? 'quota-exhausted' : 'error',
              ...(!cancelled ? { failure } : {}), usage: { inputTokens: 0, outputTokens: 0 } });
          });
        },
        events: (async function* () {
          try {
            for (;;) {
              const event = queue.shift();
              if (event) { yield event; if (event.type === 'end') return; continue; }
              if (finished) return;
              await new Promise<void>(resolve => { wake = resolve; });
              wake = undefined;
            }
          } finally { await close(); }
        })(),
      };
    } catch (error) { await close(); throw error; }
    finally { clearTimeout(timer); }
  }
}
