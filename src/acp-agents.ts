import type { InitializeResponse, PromptResponse, SessionConfigOption } from '@agentclientprotocol/sdk';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { deepseekUsage } from './deepseek-usage.js';
import type { ModelOption, TokenUsage } from './driver.js';
import type { AgentConfig } from './agents.js';

// Only agent differences belong here; ACP sequencing stays in AcpDriver.
interface AcpAgentProfile {
  name: string;
  command: string;
  arguments(agent: AgentConfig, projectEnvironmentNames?: string[]): string[];
  prepare?(agent: AgentConfig, projectEnvironmentNames?: string[]): Promise<{ args: string[]; cleanup(): Promise<void> } | undefined>;
  authentication?: string;
  environment: { set: Record<string, string>; unset: string[] };
  homeVariable?: string;
  homeConfigFiles?: string[];
  permissionAllowed?(input: unknown): boolean;
  unavailable(agent: AgentConfig): string | undefined;
  initializationUnavailable(agent: AgentConfig, response: InitializeResponse): string | undefined;
  sessionSettings(agent: AgentConfig, options: SessionConfigOption[] | null | undefined): { id: string; value: string; apply: boolean; optional?: boolean }[];
  models: ((response: InitializeResponse) => ModelOption[]) | { session(options: SessionConfigOption[] | null | undefined): ModelOption[] };
  usage(response: PromptResponse): TokenUsage;
  sessionUsage?(env: Record<string, string>, sessionId: string, allowMissing?: boolean): Promise<TokenUsage>;
  quotaErrors: { codes: number[]; pattern: RegExp };
  missingCredentialErrors?: { pattern: RegExp; recovery(agent: AgentConfig, env: Record<string, string>, message: string): { reason: string; command: string } };
  contextOverflowErrors?: RegExp;
  compactionNotification?: { method: string; sessionUpdate: string };
  installCommand: string;
  loginCommand: string;
}

const modelState = z.object({ availableModels: z.array(z.object({ modelId: z.string(), name: z.string().optional(),
  _meta: z.object({ reasoningEfforts: z.array(z.object({ value: z.string() })) }).optional(),
})) });
export function configValues(options: SessionConfigOption[] | null | undefined, id: string) {
  const option = options?.find(option => option.id === id);
  return option?.type === 'select' ? option.options.flatMap(value => 'group' in value ? value.options : [value]) : [];
}

function deepseekRoute(value: string): [string, string] | undefined {
  try {
    const route = z.tuple([z.string().min(1), z.string().min(1)]).safeParse(JSON.parse(value));
    if (route.success) return route.data;
  } catch { /* Legacy model ids do not contain a provider. */ }
}

export const acpAgents: Record<'grok' | 'deepseek', AcpAgentProfile> = {
  deepseek: {
    name: 'DeepSeek', command: 'dsh', arguments: () => ['--profile', 'acp'],
    async prepare(agent, environmentNames = []) {
      if (!agent.skillsPath && !environmentNames.length) return;
      const directory = await mkdtemp(join(tmpdir(), 'helm-dsh-skills-'));
      const cleanup = () => rm(directory, { recursive: true, force: true });
      try {
        const path = join(directory, 'skills.json');
        // --patch accepts a JSON patch list. Add a separate provider so user
        // skill-filesystem settings, default roots and bundled skills survive.
        const plugins: { id: string; name: string; config?: object }[] = [];
        if (agent.skillsPath) plugins.push({ id: 'helm-agent-skills',
          name: '@deepseek-ai/dsh-skill-filesystem', config: {
            providerName: 'helm-agent', includeDefaultRoots: false, customSkillDirs: [resolve(agent.skillsPath)],
          } });
        if (environmentNames.length) {
          // dsh scrubs KEY/PASSWORD/SECRET/TOKEN from ambient child env. Its
          // shell's explicit env merges after that scrub. This plugin stores
          // only names and reads values from this executor process at runtime.
          const plugin = join(directory, 'project-environment.mjs');
          await writeFile(plugin, deepseekEnvironmentPlugin(environmentNames), { mode: 0o600 });
          plugins.push({ id: 'helm-project-environment', name: plugin });
        }
        await writeFile(path, JSON.stringify([{ insert: plugins }]), { mode: 0o600 });
        return { args: ['--patch', path], cleanup };
      } catch (error) { await cleanup(); throw error; }
    },
    environment: { set: { DSH_PERMISSION_MODE: 'workspace-write' }, unset: ['DEEPSEEK_API_KEY', 'DSH_HOME'] },
    homeVariable: 'DSH_HOME',
    homeConfigFiles: ['.credentials.yaml', '.env', 'cordis.patch.yml'],
    permissionAllowed(input) {
      // dsh's bash/fs tools can request a per-call sandbox escalation. Never
      // auto-approve a wider boundary than the standing card sandbox.
      if (!input || typeof input !== 'object' || !('sandbox_permissions' in input)) return true;
      return input.sandbox_permissions === 'read-only' || input.sandbox_permissions === 'workspace-write';
    },
    unavailable(agent) {
      if (agent.role !== 'executor') return 'DeepSeek 本阶段只支持执行者，不支持调度者。';
      if (!agent.model) return 'DeepSeek Agent 必须指定模型 id 与路由，请在设置页选择 dsh 公布的模型。';
      if (agent.fast) return 'DeepSeek 不支持 Agent fast 档，请设为 false。';
    },
    initializationUnavailable() { return undefined; },
    models: { session(options) {
      return configValues(options, 'model').flatMap(option => {
        const route = deepseekRoute(option.value);
        return route ? [{ id: option.value, label: `${option.name} · ${route[0]} / ${route[1]}`,
          efforts: [], defaultEffort: null }] : [];
      });
    } },
    sessionSettings(agent, options) {
      const route = deepseekRoute(agent.model!);
      const matches = configValues(options, 'model').filter(option => {
        const offered = deepseekRoute(option.value);
        return offered && (route ? offered[0] === route[0] && offered[1] === route[1] : offered[1] === agent.model);
      });
      if (!matches.length) throw new Error(`DeepSeek 会话配置 model 没有公布取值 ${agent.model}；请在设置页重新选择模型与路由。`);
      if (matches.length > 1) throw new Error(`DeepSeek 旧模型 id ${agent.model} 对应多个路由；请在设置页重新选择完整模型与路由后保存。`);
      return [
        { id: 'model', value: matches[0]!.value, apply: true },
        { id: 'reasoning_effort', value: agent.reasoningEffort ?? '', apply: true, optional: agent.reasoningEffort === null },
      ];
    },
    usage: () => ({ inputTokens: null, outputTokens: null }),
    sessionUsage: deepseekUsage,
    quotaErrors: { codes: [], pattern: /\b(?:ACCOUNT_QUOTA|QUOTA|insufficient[ _-](?:quota|balance|credits?)|(?:quota|usage[ _-]limit)[ _-](?:exceeded|exhausted|reached)|(?:balance|credits?)[ _-](?:exhausted|depleted))\b/i },
    missingCredentialErrors: {
      pattern: /\bMISSING_CREDENTIAL\b|no API key for provider route\b/i,
      recovery(agent, env, message) {
        const route = message.match(/no API key for provider route "([^"]+)"/i)?.[1] ?? deepseekRoute(agent.model ?? '')?.[0] ?? agent.model;
        const home = env.DSH_HOME;
        const command = home ? `DSH_HOME='${home.replaceAll("'", "'\\''")}' dsh web` : 'dsh web';
        return { reason: `路由 ${route} 缺少 API key。请运行 dsh web，在 Models 页配置该路由的 key，或改用已配置凭据的专用主目录，然后对该 Agent 重新检测。`, command };
      },
    },
    contextOverflowErrors: /\bCONTEXT_WINDOW_EXCEEDED\b|context[ _-](?:window|length)[ _-](?:exceeded|overflow)|maximum context length/i,
    installCommand: 'npm install -g @deepseek-ai/dsh', loginCommand: 'dsh web',
  },
  grok: {
    name: 'Grok', command: 'grok', authentication: 'cached_token',
    // Process plugins are ignored by a shared leader, so explicitly use the
    // native process when adding agent skills (grok agent --help).
    arguments: (agent, environmentNames = []) => ['agent', ...(agent.reasoningEffort ? ['--effort', agent.reasoningEffort] : []),
      ...(agent.skillsPath || environmentNames.length ? ['--no-leader'] : []),
      ...(agent.skillsPath ? ['--plugin-dir', resolve(agent.skillsPath, '..')] : []), 'stdio'],
    // Subagents and background workflows run outside Helm's usage, sandbox and process cleanup.
    environment: { set: { GROK_SANDBOX: 'workspace', GROK_SUBAGENTS: '0', GROK_WORKFLOWS: '0',
      // Grok's allowlisted config overlay changes filters, never embeds values.
      GROK_CONFIG: JSON.stringify({ shell_environment_policy: { inherit: 'all', ignore_default_excludes: true, exclude: [], include_only: [] },
        toolset: { bash: { login_shell_capture: false } } }),
    }, unset: ['XAI_API_KEY', 'GROK_HOME', 'GROK_CONFIG_PATH'] },
    unavailable(agent) {
      if (agent.role !== 'executor') return 'Grok 本阶段只支持执行者，不支持调度者。';
      if (!agent.model) return 'Grok Agent 必须指定模型 id，不能使用 CLI 默认模型。';
      if (!agent.reasoningEffort) return 'Grok Agent 必须指定推理强度。';
      if (agent.home !== 'shared') return 'Grok 本阶段只支持本机登录，请将 home 设为 shared 并运行 grok login。';
      if (agent.fast) return 'Grok 不支持 Agent fast 档，请设为 false。';
    },
    initializationUnavailable(agent, response) {
      const state = modelState.safeParse(response._meta?.modelState);
      const model = state.success ? state.data.availableModels.find(model => model.modelId === agent.model) : undefined;
      if (!model) return `Grok initialize 没有公布模型 ${agent.model}，请选当前 CLI 支持的模型 id。`;
      if (!model._meta?.reasoningEfforts.some(option => option.value === agent.reasoningEffort)) return `Grok 模型 ${agent.model} 不支持推理强度 ${agent.reasoningEffort}。`;
    },
    models(response) {
      const state = modelState.safeParse(response._meta?.modelState);
      return state.success ? state.data.availableModels.map(model => ({ id: model.modelId, label: model.name ?? model.modelId,
        efforts: model._meta?.reasoningEfforts.map(option => option.value) ?? [], defaultEffort: null })) : [];
    },
    sessionSettings: agent => [
      { id: 'model', value: agent.model!, apply: true },
      { id: 'reasoning_effort', value: agent.reasoningEffort!, apply: false },
    ],
    usage(response) {
      const usage = response._meta?.usage as Record<string, unknown> | undefined;
      const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
      const cacheReadTokens = tokens(usage?.cachedReadTokens);
      return { inputTokens: tokens(usage?.inputTokens), outputTokens: tokens(usage?.outputTokens), ...(cacheReadTokens !== null ? { cacheReadTokens } : {}) };
    },
    // xai-grok-shell/src/sampling/error.rs: HTTP 429 maps to -32003;
    // subscription exhaustion can also appear in the RPC error's data.
    quotaErrors: { codes: [-32003], pattern: /subscription:free-usage-exhausted|quota[ _-](?:exceeded|exhausted)|(?:usage|credit)[ _-]limit[ _-](?:reached|exceeded)|hit (?:the |your )?rate limit|rate limit (?:for your plan|exceeded)|insufficient_quota/i },
    compactionNotification: { method: '_x.ai/session/update', sessionUpdate: 'auto_compact_started' },
    installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash', loginCommand: 'grok login',
  },
};

export function deepseekEnvironmentPlugin(names: string[]) {
  return `export const name = 'helm-project-environment';
export const inject = ['shell'];
export function apply(ctx) {
  const shell = ctx.shell;
  const original = shell.resolve;
  ctx.effect(() => {
    shell.resolve = function(request) {
      const spec = original.call(this, request);
      const env = Object.fromEntries(${JSON.stringify(names)}.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]));
      return { ...spec, env: { ...spec.env, ...env } };
    };
    return () => { shell.resolve = original; };
  });
}
`;
}
