import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { PROTOCOL_VERSION, type InitializeResponse, type NewSessionRequest } from '@agentclientprotocol/sdk';
import { acpAgents } from './acp-agents.js';
import { AcpClient, type AcpCommand } from './acp-client.js';
import type { Driver, DriverEvent, DriverSession, SessionOptions, TemplateAvailability } from './driver.js';
import { templatePrompt } from './prompts.js';
import { TemplateCatalog, templateEnvironment, type AgentTemplate } from './templates.js';

type EventContent<Event = DriverEvent> = Event extends DriverEvent ? Omit<Event, 'step'> : never;

export class AcpDriver implements Driver {
  private profile;
  constructor(private agent: keyof typeof acpAgents, private config: { command?: AcpCommand; timeoutMs?: number } = {}) {
    this.profile = acpAgents[agent];
  }

  private environment(base: Record<string, string>) {
    const env = { ...base, ...this.profile.environment.set };
    for (const key of this.profile.environment.unset) delete env[key];
    return env;
  }

  private command(template: AgentTemplate) {
    const command = this.config.command ?? { file: this.profile.command, args: [] };
    return { file: command.file, args: [...command.args, ...this.profile.arguments(template)] };
  }

  private async initialize(acp: AcpClient, template: AgentTemplate): Promise<InitializeResponse> {
    const result = await acp.connection.agent.request('initialize', { protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'helm', version: '0.1.0' },
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } });
    if (result.protocolVersion !== PROTOCOL_VERSION) throw new Error('ACP agent does not support protocol v1');
    if (this.profile.authentication && !result.authMethods?.some(method => method.id === this.profile.authentication)) {
      throw new Error(`ACP agent does not offer ${this.profile.authentication}`);
    }
    if (!result.agentCapabilities?.mcpCapabilities?.http) throw new Error('ACP agent does not support HTTP MCP');
    const reason = this.profile.initializationUnavailable(template, result);
    if (reason) throw new Error(reason);
    return result;
  }

  async checkAvailability(template: AgentTemplate): Promise<TemplateAvailability> {
    const reason = this.profile.unavailable(template);
    if (reason) return { available: false, reason };
    const command = this.command(template);
    const acp = new AcpClient(command, { cwd: homedir() }, this.environment(templateEnvironment(template)),
      { update() {}, output() {}, permission: () => ({ outcome: { outcome: 'cancelled' } }) });
    const timer = setTimeout(() => { void acp.close(); }, this.config.timeoutMs ?? 10_000);
    try {
      await this.initialize(acp, template);
      return { available: true };
    } catch (error) {
      return { available: false, reason: `${this.profile.name} 无法完成 ACP initialize 或缺少 ${this.profile.authentication} / HTTP MCP；请检查 CLI 安装和模型参数，运行 ${this.profile.loginCommand} 登录。${String(error)}`,
        command: `${this.profile.installCommand} && ${this.profile.loginCommand}` };
    } finally { clearTimeout(timer); await acp.close(); }
  }

  async start(options: SessionOptions): Promise<DriverSession> {
    options.signal?.throwIfAborted();
    const template = options.template ?? new TemplateCatalog(undefined, [this.agent]).get(`${this.agent}-executor`);
    const profile = this.profile;
    const reason = this.profile.unavailable(template);
    if (reason) throw new Error(reason);
    if (template.driver !== this.agent || options.sandbox.mode !== 'workspace-write' || options.sandbox.writableRoots.length !== 1) {
      throw new Error('ACP executor requires an executor card copy');
    }
    const cwd = await realpath(options.cwd);
    if (await realpath(options.sandbox.writableRoots[0]!) !== cwd) throw new Error('ACP executor writable roots must contain only its card copy');
    if (options.resumeSessionId !== undefined) throw new Error('ACP 续跑尚未接入（任务单 02）。');
    options.signal?.throwIfAborted();
    const queue: DriverEvent[] = [];
    let wake: (() => void) | undefined;
    let step = 0;
    let id: string | undefined;
    let finalAnswer = '';
    let sent = false;
    let finished = false;
    let cancelled = false;
    const push = (event: EventContent) => { if (!finished) { queue.push({ ...event, step: ++step }); wake?.(); } };
    const output = (message: unknown) => push({ type: 'output', text: JSON.stringify(message) });
    const acp = new AcpClient(this.command(template), { ...options, cwd }, this.environment(options.env), {
      output,
      update(notification) {
        output({ method: 'session/update', params: notification });
        if (notification.sessionId !== id) return;
        const update = notification.update;
        if (update.sessionUpdate === 'tool_call') finalAnswer = '';
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') finalAnswer += update.content.text;
      },
      permission(request) {
        const option = request.sessionId === id ? request.options.find(option => option.kind === 'allow_once') : undefined;
        // Selecting a persistent rejection can also mutate the user's settings.
        const reject = request.options.find(option => option.kind === 'reject_once');
        const selected = option ?? reject;
        const response = { outcome: selected ? { outcome: 'selected' as const, optionId: selected.optionId } : { outcome: 'cancelled' as const } };
        output({ method: 'session/request_permission', sessionId: request.sessionId, toolCall: request.toolCall, allowed: !!option, response });
        return response;
      },
    });
    const close = () => {
      options.signal?.removeEventListener('abort', cancel);
      return acp.close();
    };
    const cancel = () => { cancelled = true; wake?.(); void close(); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(cancel, this.config.timeoutMs ?? 10_000);
    try {
      if (options.signal?.aborted) cancel();
      await this.initialize(acp, template);
      if (this.profile.authentication) await acp.connection.agent.request('authenticate', { methodId: this.profile.authentication });
      const request: NewSessionRequest = { cwd,
        mcpServers: Object.entries(options.mcpServers).map(([name, server]) => ({ type: 'http' as const, name, url: server.url,
          headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })) })) };
      const session = await acp.connection.agent.request<'session/new'>('session/new', request);
      if (!session.sessionId) throw new Error('ACP agent did not return a session id');
      id = session.sessionId;
      output({ method: 'session/new', result: session });
      clearTimeout(timer);
      return {
        id, cancel,
        async send(content) {
          if (sent || cancelled) throw new Error('ACP session already received input or was closed');
          sent = true;
          // session/prompt resolves only at the end of the turn. Keep send()
          // nonblocking so helmd can consume updates and reset its idle timer.
          void acp.connection.agent.request('session/prompt', { sessionId: id!, prompt: [
            { type: 'text', text: templatePrompt(template) }, { type: 'text', text: content },
          ] }).then(response => {
            output({ method: 'session/prompt', result: response });
            const completed = response.stopReason === 'end_turn';
            push({ type: 'end', reason: completed ? 'completed' : response.stopReason === 'cancelled' ? 'aborted' : 'error',
              ...(completed ? { finalAnswer } : {}), usage: profile.usage(response) });
          }, error => {
            output({ method: 'session/prompt', error: String(error) });
            push({ type: 'end', reason: 'error', usage: { inputTokens: 0, outputTokens: 0 } });
          }).finally(() => { finished = true; wake?.(); void close(); });
        },
        events: (async function* () {
          try {
            for (;;) {
              if (cancelled) return;
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
