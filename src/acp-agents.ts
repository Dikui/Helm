import type { InitializeResponse, PromptResponse } from '@agentclientprotocol/sdk';
import { z } from 'zod';
import type { TokenUsage } from './driver.js';
import type { AgentTemplate } from './templates.js';

// Only agent differences belong here; ACP sequencing stays in AcpDriver.
interface AcpAgentProfile {
  name: string;
  command: string;
  arguments(template: AgentTemplate): string[];
  authentication?: string;
  environment: { set: Record<string, string>; unset: string[] };
  unavailable(template: AgentTemplate): string | undefined;
  initializationUnavailable(template: AgentTemplate, response: InitializeResponse): string | undefined;
  sessionSettings(template: AgentTemplate): { id: string; value: string; apply: boolean }[];
  usage(response: PromptResponse): TokenUsage;
  quotaErrors: { codes: number[]; pattern: RegExp };
  compactionNotification?: { method: string; sessionUpdate: string };
  installCommand: string;
  loginCommand: string;
}

const efforts: Record<string, string> = { low: 'low', medium: 'medium', high: 'high', max: 'xhigh' };
const modelState = z.object({ availableModels: z.array(z.object({ modelId: z.string(),
  _meta: z.object({ reasoningEfforts: z.array(z.object({ value: z.string() })) }).optional(),
})) });

export const acpAgents: Record<'grok', AcpAgentProfile> = {
  grok: {
    name: 'Grok', command: 'grok', authentication: 'cached_token',
    arguments: template => ['agent', '--effort', efforts[template.reasoningEffort!]!, 'stdio'],
    environment: { set: { GROK_SANDBOX: 'workspace' }, unset: ['XAI_API_KEY', 'GROK_HOME'] },
    unavailable(template) {
      if (template.role !== 'executor') return 'Grok 本阶段只支持执行者，不支持调度者。';
      if (!template.model) return 'Grok 模板必须指定模型 id，不能使用 CLI 默认模型。';
      if (!template.reasoningEffort || !Object.hasOwn(efforts, template.reasoningEffort)) return `Grok 不支持推理强度 ${template.reasoningEffort ?? '未指定'}；请选 low、medium、high 或 max（xhigh）。`;
      if (template.home !== 'shared') return 'Grok 本阶段只支持本机登录，请将 home 设为 shared 并运行 grok login。';
      if (template.fast) return 'Grok 不支持模板 fast 档，请设为 false。';
      if (template.skillsPath) return 'Grok 模板 skills 尚未接入，请移除 skills 目录后重试（任务单 04）。';
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
