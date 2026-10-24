import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { RuleError, type TaskStore } from './store.js';
import { runtimeEnvironment } from './environment.js';
import type { TemplateAvailability } from './driver.js';
import { acpAgents } from './acp-agents.js';

export const templateSettings = z.object({
  role: z.enum(['coordinator', 'executor']), driver: z.enum(['claude-sdk', 'codex', 'grok', 'deepseek']),
  model: z.string().trim().min(1).nullable(),
  reasoningEffort: z.enum(['low', 'medium', 'high', 'max']).nullable(),
  fast: z.boolean().default(false), home: z.enum(['shared', 'template']),
  description: z.string().trim().min(1),
}).strict();

export const saveTemplateSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'id 须为 1–64 位小写字母、数字或连字符，以字母或数字开头。'),
  config: templateSettings, prompt: z.string().refine(value => Boolean(value.trim()), 'prompt.md 不能为空。'),
  mode: z.enum(['update', 'create']), baseRevision: z.string().min(1).optional(),
}).strict();

export interface AgentTemplate extends z.infer<typeof templateSettings> {
  id: string; prompt: string; directory: string; skillsPath: string | null;
}

export const defaultTemplateDir = fileURLToPath(new URL('../../templates/', import.meta.url));

function revision(config: Buffer, prompt: Buffer) {
  return createHash('sha256').update(`${config.length}:`).update(config).update(prompt).digest('hex');
}

// No cache: each use reads settings and strategy together into its own snapshot.
export class TemplateCatalog {
  private availability = new Map<string, TemplateAvailability>();
  private checks = new Set<Promise<AgentTemplate>>();
  private checker?: (template: AgentTemplate) => Promise<TemplateAvailability>;
  private report?: (id: string, result: TemplateAvailability) => void;

  constructor(readonly directory = defaultTemplateDir, private drivers: readonly string[] = ['claude-sdk']) {}

  save(input: z.infer<typeof saveTemplateSchema>) {
    const { id, config, prompt, mode, baseRevision } = saveTemplateSchema.parse(input);
    const directory = join(this.directory, id);
    const assertRevision = () => {
      let current: string | undefined;
      try { current = revision(readFileSync(join(directory, 'config.json')), readFileSync(join(directory, 'prompt.md'))); }
      catch { /* Missing or unreadable files also conflict with the loaded revision. */ }
      if (current !== baseRevision) throw new RuleError('TEMPLATE_CONFLICT', '模板文件已被修改，请重新载入后再保存。');
    };
    if (mode === 'create') {
      mkdirSync(this.directory, { recursive: true });
      try { mkdirSync(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RuleError('TEMPLATE_EXISTS', `模板 ${id} 的目录已存在。`);
        throw error;
      }
    } else {
      if (!baseRevision) throw new RuleError('INVALID_PARAMS', 'baseRevision: 更新模板须带回列表中的 revision。', 400);
      if (!existsSync(directory)) throw new RuleError('TEMPLATE_NOT_FOUND', `模板 ${id} 的目录不存在。`, 404);
      if (!lstatSync(directory).isDirectory()) throw new RuleError('INVALID_TEMPLATE_PATH', '模板目录必须是实际目录，不能是符号链接。', 400);
      for (const file of ['config.json', 'prompt.md']) {
        if (existsSync(join(directory, file)) && !lstatSync(join(directory, file)).isFile()) {
          throw new RuleError('INVALID_TEMPLATE_PATH', `${file} 必须是普通文件，不能是符号链接。`, 400);
        }
      }
      assertRevision();
      if (this.read(id).role !== config.role) throw new RuleError('TEMPLATE_ROLE_IMMUTABLE', '更新不能修改 role；要换角色请新建模板。', 400);
    }
    const temporaryConfig = join(directory, `.config-${randomUUID()}.tmp`);
    const temporaryPrompt = join(directory, `.prompt-${randomUUID()}.tmp`);
    try {
      writeFileSync(temporaryConfig, JSON.stringify(config, null, 2) + '\n', { flag: 'wx' });
      writeFileSync(temporaryPrompt, prompt, { flag: 'wx' });
      if (mode === 'update') assertRevision();
      renameSync(temporaryConfig, join(directory, 'config.json'));
      renameSync(temporaryPrompt, join(directory, 'prompt.md'));
      return this.read(id);
    } catch (error) {
      if (mode === 'create') rmSync(directory, { recursive: true, force: true });
      throw error;
    } finally {
      rmSync(temporaryConfig, { force: true });
      rmSync(temporaryPrompt, { force: true });
    }
  }

  // The agent home under ~/.helm/agent-homes/ is kept: it holds the user's credentials.
  remove(id: string) {
    if (id === '.' || id === '..' || /[/\\\0]/.test(id)) throw new RuleError('INVALID_PARAMS', 'id: 模板 id 必须是目录名。', 400);
    const directory = join(this.directory, id);
    if (!existsSync(directory)) throw new RuleError('TEMPLATE_NOT_FOUND', `模板 ${id} 的目录不存在。`, 404);
    if (!lstatSync(directory).isDirectory()) throw new RuleError('INVALID_TEMPLATE_PATH', '模板目录必须是实际目录，不能是符号链接。', 400);
    rmSync(directory, { recursive: true });
  }

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

  private read(id: string): AgentTemplate & { revision: string } {
    if (!id || id === '.' || id === '..' || /[/\\\0]/.test(id)) throw new Error('模板 id 必须是目录名。');
    const directory = join(this.directory, id);
    const configFile = readFileSync(join(directory, 'config.json'));
    const promptFile = readFileSync(join(directory, 'prompt.md'));
    const config = templateSettings.parse(JSON.parse(configFile.toString('utf8')));
    const prompt = promptFile.toString('utf8');
    if (!prompt.trim()) throw new Error('prompt.md 不能为空。');
    const skillsPath = join(directory, 'skills');
    return { id, ...config, prompt, revision: revision(configFile, promptFile), directory,
      skillsPath: existsSync(skillsPath) && statSync(skillsPath).isDirectory() ? skillsPath : null };
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
          skills: template.skillsPath ? readdirSync(template.skillsPath, { withFileTypes: true })
            .map(entry => entry.name + (entry.isDirectory() ? '/' : '')).sort() : [],
          available: reason === null && availability?.available !== false, reason: reason ?? availability?.reason ?? null,
          ...(availability?.command ? { command: availability.command } : {}) };
      } catch (error) {
        let fileRevision: string | null = null;
        try { fileRevision = revision(readFileSync(join(this.directory, id, 'config.json')), readFileSync(join(this.directory, id, 'prompt.md'))); }
        catch { /* Incomplete templates have no revision until both files exist. */ }
        return { id, revision: fileRevision, role: null, driver: null, model: null, description: null, billing: null, available: false,
          reason: `config.json / prompt.md：${error instanceof Error ? error.message : String(error)}` };
      }
    });
  }
}

export async function agentTemplates(store: TaskStore) {
  const templates = await store.templates.refresh();
  const dispatches = new Map(store.db.prepare(`SELECT template_id AS id, count(*) AS count FROM dispatches
    WHERE status = 'running' GROUP BY template_id`).all().map(row => [String(row.id), Number(row.count)]));
  const works = new Map(store.db.prepare(`SELECT coordinator_template_id AS id, count(*) AS count FROM works
    WHERE status NOT IN ('completed', 'cancelled') GROUP BY coordinator_template_id`).all().map(row => [String(row.id), Number(row.count)]));
  return templates.map(template => ({ ...template, runningDispatches: dispatches.get(template.id) ?? 0,
    activeWorks: works.get(template.id) ?? 0 }));
}
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
