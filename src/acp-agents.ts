import type { InitializeResponse, PromptResponse } from '@agentclientprotocol/sdk';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { deepseekUsage } from './deepseek-usage.js';
import type { TokenUsage } from './driver.js';
import type { AgentTemplate } from './templates.js';

// Only agent differences belong here; ACP sequencing stays in AcpDriver.
interface AcpAgentProfile {
  name: string;
  command: string;
  arguments(template: AgentTemplate): string[];
  prepare?(template: AgentTemplate): Promise<{ args: string[]; cleanup(): Promise<void> } | undefined>;
  authentication?: string;
  environment: { set: Record<string, string>; unset: string[] };
  homeVariable?: string;
  homeConfigFiles?: string[];
  permissionAllowed?(input: unknown): boolean;
  unavailable(template: AgentTemplate): string | undefined;
  initializationUnavailable(template: AgentTemplate, response: InitializeResponse): string | undefined;
  sessionSettings(template: AgentTemplate): { id: string; value: string; apply: boolean; matches?: (value: string) => boolean }[];
  usage(response: PromptResponse): TokenUsage;
  sessionUsage?(env: Record<string, string>, sessionId: string, allowMissing?: boolean): Promise<TokenUsage>;
  quotaErrors: { codes: number[]; pattern: RegExp };
  contextOverflowErrors?: RegExp;
  compactionNotification?: { method: string; sessionUpdate: string };
  installCommand: string;
  loginCommand: string;
}

const efforts: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };
const modelState = z.object({ availableModels: z.array(z.object({ modelId: z.string(),
  _meta: z.object({ reasoningEfforts: z.array(z.object({ value: z.string() })) }).optional(),
})) });
const deepseekRoutes: Record<string, string> = {
  'deepseek-flash': 'deepseek-account', 'deepseek-v4-pro': 'deepseek-account', 'deepseek-v4-flash': 'deepseek-official',
};

export const acpAgents: Record<'grok' | 'deepseek', AcpAgentProfile> = {
  deepseek: {
    name: 'DeepSeek', command: 'dsh', arguments: () => ['--profile', 'acp'],
    async prepare(template) {
      if (!template.skillsPath) return;
      const directory = await mkdtemp(join(tmpdir(), 'helm-dsh-skills-'));
      const cleanup = () => rm(directory, { recursive: true, force: true });
      try {
        const path = join(directory, 'skills.json');
        // --patch accepts a JSON patch list. Add a separate provider so user
        // skill-filesystem settings, default roots and bundled skills survive.
        await writeFile(path, JSON.stringify([{ insert: [{ id: 'helm-template-skills',
          name: '@deepseek-ai/dsh-skill-filesystem', config: {
            providerName: 'helm-template', includeDefaultRoots: false, customSkillDirs: [resolve(template.skillsPath)],
          } }] }]), { mode: 0o600 });
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
    unavailable(template) {
      if (template.role !== 'executor') return 'DeepSeek 本阶段只支持执行者，不支持调度者。';
      if (!template.model || !Object.hasOwn(deepseekRoutes, template.model)) return `DeepSeek 不支持模型 id ${template.model ?? '未指定'}；请指定 deepseek-flash、deepseek-v4-pro 或 deepseek-v4-flash。`;
      if (!template.reasoningEffort || !['low', 'high', 'max'].includes(template.reasoningEffort)) return `DeepSeek 不支持推理强度 ${template.reasoningEffort ?? '未指定'}；请选 low、high 或 max。`;
      if ((template.home === 'template') !== (deepseekRoutes[template.model] === 'deepseek-official')) return 'DeepSeek 账号模型须用 home: shared；API 模型 deepseek-v4-flash 须用 home: template 专用主目录。';
      if (template.fast) return 'DeepSeek 不支持模板 fast 档，请设为 false。';
    },
    initializationUnavailable() { return undefined; },
    sessionSettings: template => [
      { id: 'model', value: template.model!, apply: true, matches(value) {
        try {
          const route: unknown = JSON.parse(value);
          return Array.isArray(route) && route.length === 2 && route[0] === deepseekRoutes[template.model!] && route[1] === template.model;
        } catch { return false; }
      } },
      { id: 'reasoning_effort', value: template.reasoningEffort!, apply: true },
    ],
    usage: () => ({ inputTokens: 0, outputTokens: 0 }),
    sessionUsage: deepseekUsage,
    quotaErrors: { codes: [], pattern: /\b(?:ACCOUNT_QUOTA|QUOTA|insufficient[ _-](?:quota|balance|credits?)|(?:quota|usage[ _-]limit)[ _-](?:exceeded|exhausted|reached)|(?:balance|credits?)[ _-](?:exhausted|depleted))\b/i },
    contextOverflowErrors: /\bCONTEXT_WINDOW_EXCEEDED\b|context[ _-](?:window|length)[ _-](?:exceeded|overflow)|maximum context length/i,
    installCommand: 'npm install -g @deepseek-ai/dsh', loginCommand: 'dsh web',
  },
  grok: {
    name: 'Grok', command: 'grok', authentication: 'cached_token',
    // Process plugins are ignored by a shared leader, so explicitly use the
    // native process when adding template skills (grok agent --help).
    arguments: template => ['agent', '--effort', efforts[template.reasoningEffort!]!,
      ...(template.skillsPath ? ['--no-leader', '--plugin-dir', resolve(template.skillsPath, '..')] : []), 'stdio'],
    environment: { set: { GROK_SANDBOX: 'workspace' }, unset: ['XAI_API_KEY', 'GROK_HOME'] },
    unavailable(template) {
      if (template.role !== 'executor') return 'Grok 本阶段只支持执行者，不支持调度者。';
      if (!template.model) return 'Grok 模板必须指定模型 id，不能使用 CLI 默认模型。';
      if (!template.reasoningEffort || !Object.hasOwn(efforts, template.reasoningEffort)) return `Grok 不支持推理强度 ${template.reasoningEffort ?? '未指定'}；请选 low、medium、high 或 max（xhigh）。`;
      if (template.home !== 'shared') return 'Grok 本阶段只支持本机登录，请将 home 设为 shared 并运行 grok login。';
      if (template.fast) return 'Grok 不支持模板 fast 档，请设为 false。';
    },
    initializationUnavailable(template, response) {
      const state = modelState.safeParse(response._meta?.modelState);
      const model = state.success ? state.data.availableModels.find(model => model.modelId === template.model) : undefined;
      if (!model) return `Grok initialize 没有公布模型 ${template.model}，请选当前 CLI 支持的模型 id。`;
      const effort = efforts[template.reasoningEffort!];
      if (!model._meta?.reasoningEfforts.some(option => option.value === effort)) return `Grok 模型 ${template.model} 不支持推理强度 ${effort}。`;
    },
    sessionSettings: template => [
      { id: 'model', value: template.model!, apply: true },
      { id: 'reasoning_effort', value: efforts[template.reasoningEffort!]!, apply: false },
    ],
    usage(response) {
      const usage = response._meta?.usage as Record<string, unknown> | undefined;
      const tokens = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
      return { inputTokens: tokens(usage?.inputTokens), outputTokens: tokens(usage?.outputTokens) };
    },
    // xai-grok-shell/src/sampling/error.rs: HTTP 429 maps to -32003;
    // subscription exhaustion can also appear in the RPC error's data.
    quotaErrors: { codes: [-32003], pattern: /subscription:free-usage-exhausted|quota[ _-](?:exceeded|exhausted)|(?:usage|credit)[ _-]limit[ _-](?:reached|exceeded)|hit (?:the |your )?rate limit|rate limit (?:for your plan|exceeded)|insufficient_quota/i },
    compactionNotification: { method: '_x.ai/session/update', sessionUpdate: 'auto_compact_started' },
    installCommand: 'curl -fsSL https://x.ai/cli/install.sh | bash', loginCommand: 'grok login',
  },
};
