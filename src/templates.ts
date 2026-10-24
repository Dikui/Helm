import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RuleError, type TaskStore } from './store.js';
import { runtimeEnvironment } from './environment.js';
import type { TemplateAvailability } from './driver.js';
import { acpAgents } from './acp-agents.js';

const settings = z.object({
  role: z.enum(['coordinator', 'executor']), driver: z.enum(['claude-sdk', 'codex', 'grok', 'deepseek']),
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
  private availability = new Map<string, TemplateAvailability>();
  private checks = new Set<Promise<AgentTemplate>>();
  private checker?: (template: AgentTemplate) => Promise<TemplateAvailability>;
  private report?: (id: string, result: TemplateAvailability) => void;

  constructor(readonly directory = defaultTemplateDir, private drivers: readonly string[] = ['claude-sdk']) {}

  monitor(checker: (template: AgentTemplate) => Promise<TemplateAvailability>, report: (id: string, result: TemplateAvailability) => void) {
    this.checker = checker;
    this.report = report;
  }

  async check(id: string, role?: AgentTemplate['role']): Promise<AgentTemplate> {
    const check = this.checkTemplate(id, role);
    this.checks.add(check);
    try { return await check; }
    finally { this.checks.delete(check); }
  }

  async settleChecks() { await Promise.allSettled([...this.checks]); }

  private async checkTemplate(id: string, role?: AgentTemplate['role']): Promise<AgentTemplate> {
    let template: AgentTemplate;
    let result: TemplateAvailability;
    try { template = this.get(id); }
    catch (error) {
      if (error instanceof RuleError) this.record(id, { available: false, reason: error.message });
      throw error;
    }
    if (role && template.role !== role) throw new RuleError('TEMPLATE_UNAVAILABLE', `模板角色必须为 ${role}。`, 409, { templateId: id });
    try { result = await this.checker?.(template) ?? { available: true }; }
    catch { result = { available: false, reason: '驱动无法检查模板可用性，请检查 CLI 安装和主目录。' }; }
    this.record(id, result);
    if (!result.available) throw new RuleError('TEMPLATE_UNAVAILABLE', result.reason ?? '模板不可用。', 409,
      { templateId: id, ...(result.command ? { command: result.command } : {}) });
    return template;
  }

  private record(id: string, result: TemplateAvailability) {
    this.availability.set(id, result);
    this.report?.(id, result);
  }

  async refresh() {
    const entries = this.list();
    for (const id of this.availability.keys()) if (!entries.some(entry => entry.id === id)) {
      this.record(id, { available: true });
      this.availability.delete(id);
    }
    await Promise.all(entries.map(entry => this.check(entry.id).catch(error => {
      if (!(error instanceof RuleError)) throw error;
    })));
    return this.list();
  }

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
    return acpAgents[template.driver as keyof typeof acpAgents]?.unavailable(template) ?? null;
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
        const availability = this.availability.get(id);
        return { ...template, billing: template.home === 'shared' ? 'subscription' : 'api',
          available: reason === null && availability?.available !== false, reason: reason ?? availability?.reason ?? null,
          ...(availability?.command ? { command: availability.command } : {}) };
      } catch (error) {
        return { id, role: null, driver: null, model: null, description: null, billing: null, available: false,
          reason: `config.json / prompt.md：${error instanceof Error ? error.message : String(error)}` };
      }
    });
  }
}

export const agentTemplates = (store: TaskStore) => store.templates.refresh();
export const agentTemplate = (store: TaskStore, id: string, role?: AgentTemplate['role']) => store.templates.get(id, role);

// Add only Helm-owned values after selecting the host runtime allowlist.
export function templateEnvironment(template: AgentTemplate, pushUrls: string[] = []): Record<string, string> {
  const env = runtimeEnvironment();
  env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
  env.no_proxy = env.NO_PROXY;
  if (template.role === 'executor') {
    const prefixes = [...new Set(['git@', 'https://', 'ssh://', 'http://', 'git://', 'file://', '/', './', '../', ...pushUrls])];
    const explicitUrls = [...new Set(pushUrls)];
    // Git skips pushInsteadOf for remotes with an explicit pushurl. Cover the
    // project's resolved push destinations too, without blocking unrelated fetches.
    const config = [
      ...prefixes.map(prefix => `url.file:///dev/null/helm-push-disabled/.pushInsteadOf=${prefix}`),
      ...explicitUrls.map(url => `url.file:///dev/null/helm-push-disabled/.insteadOf=${url}`),
    ];
    // dsh scrubs environment names containing KEY, breaking indexed git config.
    // Git also accepts single-quoted key=value entries in one environment value;
    // escape embedded quotes using Git's shell-style quoting (no shell is run).
    env.GIT_CONFIG_PARAMETERS = config.map(entry => `'${entry.replaceAll("'", "'\\''")}'`).join(' ');
    env.GH_TOKEN = 'helm-push-disabled';
  }
  return env;
}
