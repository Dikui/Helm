import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { RuleError, type Actor, type TaskStore } from './store.js';

export const libraryName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, '名字须为 1–64 位小写字母、数字或连字符，以字母或数字开头。');
const httpMcpSchema = z.object({
  type: z.literal('http'), url: z.url({ protocol: /^https?$/ }),
  headers: z.record(z.string(), z.string()).optional(),
}).strict();
const stdioMcpSchema = z.object({
  type: z.literal('stdio'), command: z.string().min(1).refine(command => command.trim().length > 0, '命令不能为空。'),
  args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(),
}).strict();
export const mcpSchema = z.discriminatedUnion('type', [httpMcpSchema, stdioMcpSchema]);
export type McpConfig = z.infer<typeof mcpSchema>;

function mcpSummary(name: string, config: McpConfig) {
  return config.type === 'http'
    ? { type: 'mcp' as const, name, transport: config.type, url: config.url, headerKeys: Object.keys(config.headers ?? {}).sort() }
    : { type: 'mcp' as const, name, transport: config.type, command: config.command, envKeys: Object.keys(config.env ?? {}).sort() };
}

export class McpLibrary {
  constructor(readonly directory: string) {}

  read(name: string): McpConfig {
    libraryName.parse(name);
    try {
      const path = join(this.directory, `${name}.json`);
      if (!lstatSync(path).isFile()) throw new Error('MCP 须为普通文件');
      return mcpSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      // JSON/schema errors can include file contents and credentials.
      throw new RuleError('INVALID_MCP', `库 MCP ${name} 不存在或格式无效，须为 HTTP 或 stdio MCP 普通 JSON 文件。`, 400);
    }
  }

  names() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json') && libraryName.safeParse(entry.name.slice(0, -5)).success)
      .map(entry => entry.name.slice(0, -5)).sort();
  }

  register(name: string, config: McpConfig) {
    libraryName.parse(name);
    const parsed = mcpSchema.parse(config);
    mkdirSync(this.directory, { recursive: true });
    try { writeFileSync(join(this.directory, `${name}.json`), JSON.stringify(parsed, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new RuleError('LIBRARY_ENTRY_EXISTS', `库 MCP ${name} 已存在。`);
      throw error;
    }
    return mcpSummary(name, parsed);
  }

  remove(name: string) {
    libraryName.parse(name);
    const path = join(this.directory, `${name}.json`);
    try {
      if (!lstatSync(path).isFile()) throw new RuleError('INVALID_MCP', 'MCP 须为普通文件，不能是符号链接。', 400);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RuleError('LIBRARY_ENTRY_NOT_FOUND', `库 MCP ${name} 不存在。`, 404);
      throw error;
    }
    rmSync(path);
  }
}

// Validate before copying: cp must never preserve or follow links from a skill.
function validateTree(path: string) {
  const entry = lstatSync(path);
  if (entry.isDirectory()) for (const name of readdirSync(path)) validateTree(join(path, name));
  else if (!entry.isFile()) throw new RuleError('INVALID_SKILL_PATH', `skill 只能包含实际目录和普通文件，不能包含符号链接：${path}`, 400);
}

export class SkillLibrary {
  constructor(readonly directory: string) {}

  read(name: string) {
    libraryName.parse(name);
    const path = join(this.directory, name);
    try {
      if (!lstatSync(path).isDirectory()) throw new Error('须为实际目录，不能是符号链接');
      validateTree(path);
      if (!lstatSync(join(path, 'SKILL.md')).isFile()) throw new Error('缺少普通文件 SKILL.md');
    } catch (error) {
      throw new RuleError('INVALID_SKILL', `库 skill ${name} 不可用：${error instanceof Error ? error.message : String(error)}`, 400);
    }
    return path;
  }

  names() {
    if (!existsSync(this.directory)) return [];
    return readdirSync(this.directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && libraryName.safeParse(entry.name).success).map(entry => entry.name).sort();
  }

  install(source: string, givenName?: string, replace = false) {
    const path = resolve(source);
    const parsed = libraryName.safeParse(givenName ?? basename(path));
    if (!parsed.success) throw new RuleError('INVALID_PARAMS', parsed.error.issues[0]!.message, 400);
    const name = parsed.data;
    const destination = join(this.directory, name);
    let replaced = false;
    try {
      lstatSync(destination);
      if (!replace) throw new RuleError('LIBRARY_ENTRY_EXISTS', `库 skill ${name} 已存在。`);
      replaced = true;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    try {
      if (!lstatSync(path).isDirectory()) throw new Error('skill 须为实际目录，不能是符号链接');
      validateTree(path);
      if (!lstatSync(join(path, 'SKILL.md')).isFile()) throw new Error('缺少普通文件 SKILL.md');
    } catch (error) {
      throw new RuleError('INVALID_SKILL_PATH', `不能安装 skill：${error instanceof Error ? error.message : String(error)}`, 400);
    }
    mkdirSync(this.directory, { recursive: true });
    const temporary = join(this.directory, `.${name}-${randomUUID()}.tmp`);
    const backup = join(this.directory, `.${name}-${randomUUID()}.old`);
    let reserved = false;
    let backedUp = false;
    try {
      cpSync(path, temporary, { recursive: true });
      if (replaced) { renameSync(destination, backup); backedUp = true; }
      else mkdirSync(destination);
      reserved = true;
      renameSync(temporary, destination);
    } catch (error) {
      if (reserved) rmSync(destination, { recursive: true, force: true });
      if (backedUp) renameSync(backup, destination);
      throw error;
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    if (backedUp) {
      // The new version is committed; failed cleanup must not restore a partially deleted backup.
      try { rmSync(backup, { recursive: true, force: true }); } catch {}
    }
    return { type: 'skill' as const, name, replaced };
  }

  remove(name: string) {
    libraryName.parse(name);
    const path = join(this.directory, name);
    if (!existsSync(path)) throw new RuleError('LIBRARY_ENTRY_NOT_FOUND', `库 skill ${name} 不存在。`, 404);
    if (!lstatSync(path).isDirectory()) throw new RuleError('INVALID_SKILL_PATH', 'skill 须为实际目录，不能是符号链接。', 400);
    rmSync(path, { recursive: true });
  }
}

export function skillLibrary(store: TaskStore) { return new SkillLibrary(join(store.dataDir, 'library', 'skills')); }
export function mcpLibrary(store: TaskStore) { return new McpLibrary(join(store.dataDir, 'library', 'mcp')); }

export function listLibrary(store: TaskStore) {
  const mcp = mcpLibrary(store);
  return [
    ...skillLibrary(store).names().map(name => ({ type: 'skill' as const, name, agents: store.agents.libraryReferences('skill', name) })),
    ...mcp.names().map(name => ({ ...mcpSummary(name, mcp.read(name)), agents: store.agents.libraryReferences('mcp', name) })),
  ];
}

export function registerMcp(store: TaskStore, actor: Actor, name: string, config: McpConfig) {
  const entry = mcpLibrary(store).register(name, config);
  store.transaction(() => store.appendEvent(actor, { type: 'library-mcp', id: name }, 'library-mcp-registered', entry));
  return entry;
}

export function installSkill(store: TaskStore, actor: Actor, path: string, name?: string, replace = false) {
  const { replaced, ...entry } = skillLibrary(store).install(path, name, replace);
  store.transaction(() => store.appendEvent(actor, { type: 'library-skill', id: entry.name }, 'library-skill-installed', { ...entry, replaced }));
  return entry;
}

export function deleteLibraryEntry(store: TaskStore, actor: Actor, type: 'skill' | 'mcp', name: string) {
  const agents = store.agents.libraryReferences(type, name);
  if (agents.length) throw new RuleError('LIBRARY_ENTRY_IN_USE', `库 ${type === 'mcp' ? 'MCP' : 'skill'} ${name} 仍被 Agent 引用：${agents.join('、')}`, 409, { agents });
  (type === 'mcp' ? mcpLibrary(store) : skillLibrary(store)).remove(name);
  store.transaction(() => store.appendEvent(actor, { type: `library-${type}`, id: name }, 'library-entry-deleted', { type, name }));
  return { type, name, deleted: true };
}
