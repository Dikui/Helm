import { RuleError, TaskStore, type Actor } from './store.js';
import { runtimeEnvironment } from './environment.js';

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

// Add only Helm-owned values after selecting the host runtime allowlist.
export function templateEnvironment(template: AgentTemplate, pushUrls: string[] = []): Record<string, string> {
  const env = runtimeEnvironment();
  env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
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
