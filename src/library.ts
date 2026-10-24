import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { z } from 'zod';
import { RuleError, type Actor, type TaskStore } from './store.js';

export const libraryName = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, '名字须为 1–64 位小写字母、数字或连字符，以字母或数字开头。');

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

  install(source: string, givenName?: string) {
    const path = resolve(source);
    const parsed = libraryName.safeParse(givenName ?? basename(path));
    if (!parsed.success) throw new RuleError('INVALID_PARAMS', parsed.error.issues[0]!.message, 400);
    const name = parsed.data;
    const destination = join(this.directory, name);
    try { lstatSync(destination); throw new RuleError('LIBRARY_ENTRY_EXISTS', `库 skill ${name} 已存在。`); }
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
    let reserved = false;
    try {
      cpSync(path, temporary, { recursive: true });
      mkdirSync(destination);
      reserved = true;
      renameSync(temporary, destination);
    } catch (error) {
      if (reserved) rmSync(destination, { recursive: true, force: true });
      throw error;
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    return { type: 'skill' as const, name };
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

export function listLibrary(store: TaskStore) {
  return skillLibrary(store).names().map(name => ({ type: 'skill' as const, name, agents: store.agents.skillReferences(name) }));
}

export function installSkill(store: TaskStore, actor: Actor, path: string, name?: string) {
  const entry = skillLibrary(store).install(path, name);
  store.transaction(() => store.appendEvent(actor, { type: 'library-skill', id: entry.name }, 'library-skill-installed', entry));
  return entry;
}

export function deleteLibraryEntry(store: TaskStore, actor: Actor, name: string) {
  const agents = store.agents.skillReferences(name);
  if (agents.length) throw new RuleError('LIBRARY_ENTRY_IN_USE', `库 skill ${name} 仍被 Agent 引用：${agents.join('、')}`, 409, { agents });
  skillLibrary(store).remove(name);
  store.transaction(() => store.appendEvent(actor, { type: 'library-skill', id: name }, 'library-entry-deleted', { type: 'skill', name }));
  return { type: 'skill', name, deleted: true };
}
