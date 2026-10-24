import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import { RuleError, type TaskStore } from './store.js';
import { runtimeEnvironment } from './environment.js';
import type { AgentAvailability, SessionOptions } from './driver.js';
import { acpAgents } from './acp-agents.js';
import { libraryName, McpLibrary, SkillLibrary } from './library.js';

export const agentSettings = z.object({
  role: z.enum(['coordinator', 'executor']), driver: z.enum(['claude-sdk', 'codex', 'grok', 'deepseek']),
  model: z.string().trim().min(1).nullable(),
  // The CLI's own effort value, chosen from what the driver reports (list-agent-models).
  reasoningEffort: z.string().trim().min(1).nullable(),
  fast: z.boolean().default(false), home: z.enum(['shared', 'dedicated']),
  description: z.string().trim().min(1),
  skills: z.array(libraryName).default([]),
  mcp: z.array(libraryName).default([]),
}).strict();

export const saveAgentSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'id 须为 1–64 位小写字母、数字或连字符，以字母或数字开头。'),
  config: agentSettings, prompt: z.string(),
  mode: z.enum(['update', 'create']), baseRevision: z.string().min(1).optional(),
}).strict();

export interface AgentConfig extends Omit<z.infer<typeof agentSettings>, 'skills' | 'mcp'> {
  id: string; prompt: string; directory: string; skillsPath: string | null; skills?: string[]; mcp?: string[];
}

function revision(config: Buffer, prompt: Buffer) {
  return createHash('sha256').update(`${config.length}:`).update(config).update(prompt).digest('hex');
}

// No cache: each use reads settings and strategy together into its own snapshot.
export class AgentCatalog {
  private availability = new Map<string, AgentAvailability>();
  private checks = new Set<Promise<AgentConfig>>();
  private checker?: (agent: AgentConfig) => Promise<AgentAvailability>;
  private report?: (id: string, result: AgentAvailability) => void;

  constructor(readonly directory: string, private drivers: readonly string[] = ['claude-sdk'],
    readonly library = new SkillLibrary(join(directory, '..', 'library', 'skills')),
    readonly mcpLibrary = new McpLibrary(join(library.directory, '..', 'mcp'))) {}

  save(input: z.infer<typeof saveAgentSchema>) {
    const { id, config, prompt, mode, baseRevision } = saveAgentSchema.parse(input);
    const directory = join(this.directory, id);
    const assertRevision = () => {
      let current: string | undefined;
      try { current = revision(readFileSync(join(directory, 'config.json')), readFileSync(join(directory, 'prompt.md'))); }
      catch { /* Missing or unreadable files also conflict with the loaded revision. */ }
      if (current !== baseRevision) throw new RuleError('AGENT_CONFLICT', 'Agent 文件已被修改，请重新载入后再保存。');
    };
    if (mode === 'create') {
      mkdirSync(this.directory, { recursive: true });
      try { mkdirSync(directory); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RuleError('AGENT_EXISTS', `Agent ${id} 的目录已存在。`);
        throw error;
      }
    } else {
      if (!baseRevision) throw new RuleError('INVALID_PARAMS', 'baseRevision: 更新 Agent 须带回列表中的 revision。', 400);
      if (!existsSync(directory)) throw new RuleError('AGENT_NOT_FOUND', `Agent ${id} 的目录不存在。`, 404);
      if (!lstatSync(directory).isDirectory()) throw new RuleError('INVALID_AGENT_PATH', 'Agent 目录必须是实际目录，不能是符号链接。', 400);
      for (const file of ['config.json', 'prompt.md']) {
        if (existsSync(join(directory, file)) && !lstatSync(join(directory, file)).isFile()) {
          throw new RuleError('INVALID_AGENT_PATH', `${file} 必须是普通文件，不能是符号链接。`, 400);
        }
      }
      assertRevision();
      if (this.read(id).role !== config.role) throw new RuleError('AGENT_ROLE_IMMUTABLE', '更新不能修改 role；要换角色请新建 Agent。', 400);
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
    if (id === '.' || id === '..' || /[/\\\0]/.test(id)) throw new RuleError('INVALID_PARAMS', 'id: Agent id 必须是目录名。', 400);
    const directory = join(this.directory, id);
    if (!existsSync(directory)) throw new RuleError('AGENT_NOT_FOUND', `Agent ${id} 的目录不存在。`, 404);
    if (!lstatSync(directory).isDirectory()) throw new RuleError('INVALID_AGENT_PATH', 'Agent 目录必须是实际目录，不能是符号链接。', 400);
    rmSync(directory, { recursive: true });
  }

  monitor(checker: (agent: AgentConfig) => Promise<AgentAvailability>, report: (id: string, result: AgentAvailability) => void) {
    this.checker = checker;
    this.report = report;
  }

  async check(id: string, role?: AgentConfig['role']): Promise<AgentConfig> {
    const check = this.checkAgent(id, role);
    this.checks.add(check);
    try { return await check; }
    finally { this.checks.delete(check); }
  }

  async settleChecks() { await Promise.allSettled([...this.checks]); }

  private async checkAgent(id: string, role?: AgentConfig['role']): Promise<AgentConfig> {
    let agent: AgentConfig;
    let result: AgentAvailability;
    try { agent = this.get(id); }
    catch (error) {
      if (error instanceof RuleError) this.record(id, { available: false, reason: error.message });
      throw error;
    }
    if (role && agent.role !== role) throw new RuleError('AGENT_UNAVAILABLE', `Agent 角色必须为 ${role}。`, 409, { agentId: id });
    try { result = await this.checker?.(agent) ?? { available: true }; }
    catch { result = { available: false, reason: '驱动无法检查 Agent 可用性，请检查 CLI 安装和主目录。' }; }
    this.record(id, result);
    if (!result.available) throw new RuleError('AGENT_UNAVAILABLE', result.reason ?? 'Agent 不可用。', 409,
      { agentId: id, ...(result.command ? { command: result.command } : {}) });
    return agent;
  }

  private record(id: string, result: AgentAvailability) {
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

  private read(id: string): AgentConfig & { revision: string; config: z.infer<typeof agentSettings> } {
    if (!id || id === '.' || id === '..' || /[/\\\0]/.test(id)) throw new Error('Agent id 必须是目录名。');
    const directory = join(this.directory, id);
    const configFile = readFileSync(join(directory, 'config.json'));
    const promptFile = readFileSync(join(directory, 'prompt.md'));
    const config = agentSettings.parse(JSON.parse(configFile.toString('utf8')));
    const prompt = promptFile.toString('utf8');
    const skillsPath = join(directory, 'skills');
    return { id, ...config, config, prompt, revision: revision(configFile, promptFile), directory,
      skillsPath: existsSync(skillsPath) && statSync(skillsPath).isDirectory() ? skillsPath : null };
  }

  private unavailable(agent: AgentConfig) {
    if (agent.driver === 'claude-sdk' && agent.fast) return 'Claude fast 在订阅下要开 extra usage 并计入 extra usage';
    if (!this.drivers.includes(agent.driver)) return `驱动 ${agent.driver} 未登记。`;
    for (const name of agent.skills ?? []) {
      try { this.library.read(name); }
      catch (error) { return `库 skill ${name} 不可用：${error instanceof Error ? error.message : String(error)}`; }
      if (agent.skillsPath && readdirSync(agent.skillsPath).includes(name)) return `Agent 自带 skill 与库 skill 同名：${name}`;
    }
    try { this.mcpServers(agent); }
    catch (error) { return error instanceof Error ? error.message : '库 MCP 不可用。'; }
    return acpAgents[agent.driver as keyof typeof acpAgents]?.unavailable(agent) ?? null;
  }

  private warnings(agent: AgentConfig): string[] {
    if (agent.home !== 'shared' || !agent.skills?.length) return [];
    // Only the CLI's default user roots: runtimeEnvironment drops home overrides.
    // Do not inspect skill contents, plugin registries or project settings.
    const roots = {
      'claude-sdk': ['.claude/skills'],
      codex: ['.codex/skills', '.agents/skills'],
      grok: ['.grok/skills', '.claude/skills', '.agents/skills'],
      deepseek: ['.dsh/skills', '.agents/skills'],
    }[agent.driver];
    const warnings: string[] = [];
    for (const root of roots) {
      const directory = join(process.env.HOME ?? homedir(), root);
      try {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if (!agent.skills.includes(entry.name)) continue;
          const path = join(directory, entry.name);
          // CLIs also discover skill directories reached through symlinks.
          let isDirectory = entry.isDirectory();
          if (entry.isSymbolicLink()) {
            try { isDirectory = statSync(path).isDirectory(); } catch { continue; }
          }
          if (isDirectory) warnings.push(`库 skill ${entry.name} 与全局 skill 目录 ${path} 同名，可能存在冲突；此警告不影响 Agent 可用性。`);
        }
      } catch { /* Missing or unreadable global roots must not make an Agent unavailable. */ }
    }
    return warnings.sort();
  }

  // Keep references even when another setting makes the Agent unavailable.
  libraryReferences(type: 'skill' | 'mcp', name: string) {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().filter(id => {
      try {
        const config = JSON.parse(readFileSync(join(this.directory, id, 'config.json'), 'utf8'));
        const references = config[type === 'skill' ? 'skills' : 'mcp'];
        return Array.isArray(references) && references.includes(name);
      } catch { return false; }
    });
  }

  get(id: string, role?: AgentConfig['role']): AgentConfig {
    let agent: AgentConfig;
    try { agent = this.read(id); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !existsSync(join(this.directory, id))) {
        throw new RuleError('AGENT_UNAVAILABLE', `Agent ${id} 不存在，请先在「Agent 集群」新建。`, 409, { agentId: id });
      }
      throw new RuleError('AGENT_UNAVAILABLE', `Agent ${id} 不可用（config.json / prompt.md）：${error instanceof Error ? error.message : String(error)}`, 409, { agentId: id });
    }
    const reason = this.unavailable(agent) ?? (role && agent.role !== role ? `Agent 角色必须为 ${role}。` : null);
    if (reason) throw new RuleError('AGENT_UNAVAILABLE', reason, 409, { agentId: id });
    return agent;
  }

  // Credentials live only in driver startup options, never in the Agent snapshot.
  mcpServers(agent: AgentConfig): SessionOptions['mcpServers'] {
    try {
      return Object.fromEntries((agent.mcp ?? []).map(name => {
        // Keep Helm's authenticated endpoint and the browser MCP names reserved.
        if (['helm', 'browser', 'playwright'].includes(name)) throw new Error(`库 MCP ${name} 与 Helm 内置 MCP 或浏览器工具名字冲突。`);
        const { url, headers = {} } = this.mcpLibrary.read(name);
        return [name, { url, headers }];
      }));
    } catch (error) {
      throw new RuleError('AGENT_UNAVAILABLE', `Agent ${agent.id} 的 MCP 不可用：${error instanceof Error ? error.message : '无法读取库 MCP'}`, 409, { agentId: agent.id });
    }
  }

  // Each dispatch or coordinator round owns a fixed copy, assembled only at startup.
  snapshot(agent: AgentConfig, dataDir: string): AgentConfig {
    const skillsPath = join(dataDir, 'skills');
    try {
      const ownEntries = agent.skillsPath ? readdirSync(agent.skillsPath) : [];
      const selected = [...new Set(agent.skills ?? [])].map(name => ({ name, path: this.library.read(name) }));
      if (!ownEntries.length && !selected.length) return { ...agent, skillsPath: null };
      for (const { name } of selected) if (ownEntries.includes(name)) {
        throw new Error(`Agent 自带 skill 与库 skill 同名：${name}`);
      }
      mkdirSync(dataDir, { recursive: true });
      if (ownEntries.length) cpSync(agent.skillsPath!, skillsPath, { recursive: true, dereference: true });
      else mkdirSync(skillsPath);
      for (const { name, path } of selected) cpSync(path, join(skillsPath, name), { recursive: true, dereference: true });
      return { ...agent, skillsPath };
    } catch (error) {
      rmSync(skillsPath, { recursive: true, force: true });
      throw new RuleError('AGENT_UNAVAILABLE', `Agent ${agent.id} 的 skill 无法组装：${error instanceof Error ? error.message : String(error)}`, 409, { agentId: agent.id });
    }
  }

  list() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort().map(id => {
      try {
        const agent = this.read(id);
        const reason = this.unavailable(agent);
        const availability = this.availability.get(id);
        return { ...agent, billing: agent.home === 'shared' ? 'subscription' : 'api',
          warnings: this.warnings(agent),
          skills: agent.skillsPath ? readdirSync(agent.skillsPath, { withFileTypes: true })
            .map(entry => entry.name + (entry.isDirectory() ? '/' : '')).sort() : [],
          available: reason === null && availability?.available !== false, reason: reason ?? availability?.reason ?? null,
          ...(availability?.command ? { command: availability.command } : {}) };
      } catch (error) {
        let fileRevision: string | null = null;
        try { fileRevision = revision(readFileSync(join(this.directory, id, 'config.json')), readFileSync(join(this.directory, id, 'prompt.md'))); }
        catch { /* Incomplete agents have no revision until both files exist. */ }
        return { id, revision: fileRevision, role: null, driver: null, model: null, description: null, billing: null, available: false, warnings: [],
          reason: `config.json / prompt.md：${error instanceof Error ? error.message : String(error)}` };
      }
    });
  }
}

// The built-in templates that shipped before agents moved to the data directory.
const legacyAgents: Record<string, z.input<typeof agentSettings>> = {
  'claude-coordinator': { role: 'coordinator', driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '对齐工作说明，拆卡、派单、安排验收并发起审核' },
  'claude-executor': { role: 'executor', driver: 'claude-sdk', model: 'haiku', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '在卡片副本中执行或验收派单，报告检查过程和证据' },
  'codex-coordinator': { role: 'coordinator', driver: 'codex', model: 'gpt-6-luna', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '对齐工作说明，拆卡、派单、安排验收并发起审核' },
  'codex-executor': { role: 'executor', driver: 'codex', model: 'gpt-6-luna', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '在卡片副本中使用 Codex 执行或验收派单，报告检查过程和证据' },
  'deepseek-executor': { role: 'executor', driver: 'deepseek', model: 'deepseek-flash', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '在卡片副本中沿用 dsh web 登录的 DeepSeek 账号执行或验收派单，报告检查过程和证据' },
  'grok-executor': { role: 'executor', driver: 'grok', model: 'grok-4.7', reasoningEffort: 'low', fast: false, home: 'shared',
    description: '在卡片副本中使用 Grok 本机登录执行或验收派单，报告检查过程和证据' },
};

// One-time: a task store that has works but no agent directory recreates the old templates as agents,
// so existing works and dispatches keep resolving their ids. Fresh installs start empty.
export function migrateLegacyAgents(store: TaskStore) {
  const directory = store.agents.directory;
  if (existsSync(directory)) return;
  const hasWorks = store.db.prepare('SELECT 1 FROM works LIMIT 1').get() !== undefined;
  mkdirSync(directory, { recursive: true });
  if (hasWorks) for (const [id, config] of Object.entries(legacyAgents)) {
    mkdirSync(join(directory, id));
    writeFileSync(join(directory, id, 'config.json'), JSON.stringify(config, null, 2) + '\n');
    writeFileSync(join(directory, id, 'prompt.md'), '');
  }
}

export async function listAgents(store: TaskStore) {
  const agents = await store.agents.refresh();
  const dispatches = new Map(store.db.prepare(`SELECT agent_id AS id, count(*) AS count FROM dispatches
    WHERE status = 'running' GROUP BY agent_id`).all().map(row => [String(row.id), Number(row.count)]));
  const works = new Map(store.db.prepare(`SELECT coordinator_agent_id AS id, count(*) AS count FROM works
    WHERE status NOT IN ('completed', 'cancelled') GROUP BY coordinator_agent_id`).all().map(row => [String(row.id), Number(row.count)]));
  return agents.map(agent => ({ ...agent, runningDispatches: dispatches.get(agent.id) ?? 0,
    activeWorks: works.get(agent.id) ?? 0 }));
}
export const findAgent = (store: TaskStore, id: string, role?: AgentConfig['role']) => store.agents.get(id, role);

// Add only Helm-owned values after selecting the host runtime allowlist.
export function agentEnvironment(agent: AgentConfig, pushUrls: string[] = []): Record<string, string> {
  const env = runtimeEnvironment();
  env.NO_PROXY = [...new Set([...(env.NO_PROXY ?? '').split(','), ...(env.no_proxy ?? '').split(','), '127.0.0.1', 'localhost'].filter(Boolean))].join(',');
  env.no_proxy = env.NO_PROXY;
  if (agent.role === 'executor') {
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
