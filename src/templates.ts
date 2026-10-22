import { RuleError, TaskStore, type Actor } from './store.js';

export interface AgentTemplate {
  id: string; role: 'coordinator' | 'executor'; model: string | null;
  reasoningEffort: 'low' | 'medium' | 'high' | 'max' | null;
}

export function agentTemplates(store: TaskStore): AgentTemplate[] {
  return store.db.prepare('SELECT id, role, model, reasoning_effort AS reasoningEffort FROM agent_templates ORDER BY id').all() as unknown as AgentTemplate[];
}

export function agentTemplate(store: TaskStore, id: string, role?: AgentTemplate['role']) {
  const template = agentTemplates(store).find(item => item.id === id);
  if (!template || (role && template.role !== role)) throw new RuleError('INVALID_TEMPLATE', '只能选择已登记且角色匹配的 Agent 模板。');
  return template;
}

export function configureTemplate(store: TaskStore, actor: Actor, params: {
  templateId: string; model?: string; reasoningEffort?: NonNullable<AgentTemplate['reasoningEffort']>;
}) {
  const current = agentTemplate(store, params.templateId);
  const model = params.model ?? current.model;
  const effort = params.reasoningEffort ?? current.reasoningEffort;
  if (model !== current.model || effort !== current.reasoningEffort) {
    store.db.prepare('UPDATE agent_templates SET model = ?, reasoning_effort = ? WHERE id = ?').run(model, effort, current.id);
    store.appendEvent(actor, { type: 'agent-template', id: current.id }, 'agent-template-configured', { model, reasoningEffort: effort });
  }
  return agentTemplate(store, current.id);
}

// Templates use the locally logged-in subscription. Filter names before reading values;
// OAuth credentials are never forwarded to either role.
export function templateEnvironment(template: AgentTemplate, pushUrls: string[] = []): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of Object.keys(process.env)) {
    if (/OAUTH|^ANTHROPIC_(API_KEY|AUTH_TOKEN|BASE_URL|CUSTOM_HEADERS)|^CLAUDE_CODE_(API_KEY|USE_|EXPERIMENTAL_AGENT_TEAMS)|^AWS_BEARER_TOKEN_BEDROCK$|^GIT_CONFIG_|^GH_TOKEN$|^GITHUB_TOKEN$/i.test(key)) continue;
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? env.no_proxy ?? '').split(',').filter(Boolean), '127.0.0.1', 'localhost'])].join(',');
  env.no_proxy = env.NO_PROXY;
  if (template.role === 'executor') {
    const prefixes = [...new Set(['git@', 'https://', 'ssh://', 'http://', 'git://', 'file://', '/', './', '../', ...pushUrls])];
    const explicitUrls = [...new Set(pushUrls)];
    env.GIT_CONFIG_COUNT = String(prefixes.length + explicitUrls.length);
    prefixes.forEach((prefix, index) => {
      env[`GIT_CONFIG_KEY_${index}`] = 'url.file:///dev/null/helm-push-disabled/.pushInsteadOf';
      env[`GIT_CONFIG_VALUE_${index}`] = prefix;
    });
    // Git skips pushInsteadOf for remotes with an explicit pushurl. Cover the
    // project's resolved push destinations too, without blocking unrelated fetches.
    explicitUrls.forEach((url, index) => {
      env[`GIT_CONFIG_KEY_${prefixes.length + index}`] = 'url.file:///dev/null/helm-push-disabled/.insteadOf';
      env[`GIT_CONFIG_VALUE_${prefixes.length + index}`] = url;
    });
    env.GH_TOKEN = 'helm-push-disabled';
  }
  return env;
}
