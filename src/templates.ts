import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RuleError, type TaskStore } from './store.js';
import { runtimeEnvironment } from './environment.js';

const settings = z.object({
  role: z.enum(['coordinator', 'executor']), driver: z.enum(['claude-sdk', 'codex']),
  model: z.string().trim().min(1).nullable(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'max']).nullable(),
  fast: z.boolean().default(false), home: z.enum(['shared', 'template']),
  description: z.string().trim().min(1),
}).strict();

export interface AgentTemplate extends z.infer<typeof settings> {
  id: string; prompt: string; directory: string; skillsPath: string | null;
}

export const defaultTemplateDir = fileURLToPath(new URL('../../templates/', import.meta.url));

// No cache: each use reads settings and strategy together into its own snapshot.
export class TemplateCatalog {
  constructor(readonly directory = defaultTemplateDir, private drivers: readonly string[] = ['claude-sdk']) {}

  private read(id: string): AgentTemplate {
    if (!id || id === '.' || id === '..' || /[/\\\0]/.test(id)) throw new Error('模板 id 必须是目录名。');
    const directory = join(this.directory, id);
    const config = settings.parse(JSON.parse(readFileSync(join(directory, 'config.json'), 'utf8')));
    const prompt = readFileSync(join(directory, 'prompt.md'), 'utf8');
    if (!prompt.trim()) throw new Error('prompt.md 不能为空。');
    const skillsPath = join(directory, 'skills');
    return { id, ...config, prompt, directory, skillsPath: existsSync(skillsPath) && statSync(skillsPath).isDirectory() ? skillsPath : null };
  }

  private unavailable(template: AgentTemplate) {
    if (template.driver === 'claude-sdk' && template.fast) return 'Claude fast 在订阅下要开 extra usage 并计入 extra usage';
    if (!this.drivers.includes(template.driver)) return `驱动 ${template.driver} 未登记。`;
    return null;
  }

  get(id: string, role?: AgentTemplate['role']): AgentTemplate {
    let template: AgentTemplate;
    try { template = this.read(id); }
    catch (error) {
      throw new RuleError('TEMPLATE_UNAVAILABLE', `模板 ${id} 不可用（config.json / prompt.md）：${error instanceof Error ? error.message : String(error)}`, 409, { templateId: id });
    }
    const reason = this.unavailable(template) ?? (role && template.role !== role ? `模板角色必须为 ${role}。` : null);
    if (reason) throw new RuleError('TEMPLATE_UNAVAILABLE', reason, 409, { templateId: id });
    return template;
  }

  list() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(id => {
      try {
        const template = this.read(id);
        const reason = this.unavailable(template);
        return { ...template, billing: template.home === 'shared' ? 'subscription' : 'api', available: reason === null, reason };
      } catch (error) {
        return { id, role: null, driver: null, model: null, description: null, billing: null, available: false,
          reason: `config.json / prompt.md：${error instanceof Error ? error.message : String(error)}` };
      }
    });
  }
}

export const agentTemplates = (store: TaskStore) => store.templates.list();
export const agentTemplate = (store: TaskStore, id: string, role?: AgentTemplate['role']) => store.templates.get(id, role);

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
