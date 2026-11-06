import { z } from 'zod';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { acpAgents } from './acp-agents.js';
import { runtimeEnvironmentNames } from './environment.js';
import { RuleError, type Actor, type TaskStore } from './store.js';
import type { DriverEvent } from './driver.js';

const dispatchRedactors = new WeakMap<TaskStore, Map<string, { text: (text: string) => string; bytes: (text: string) => string; byteSpellings: string[] }>>();

// Keep the startup values protected even if the user replaces/deletes them
// while this dispatch is running. Nothing here is serialized.
export function protectDispatchEnvironment(store: TaskStore, id: string, environment: Record<string, string>) {
  let active = dispatchRedactors.get(store);
  if (!active) { active = new Map(); dispatchRedactors.set(store, active); }
  const redact = environmentRedactor(environment);
  const bytes = environmentRedactor(Object.fromEntries(Object.entries(environment).map(([name, value]) => [name, Buffer.from(value).toString('latin1')])));
  const byteSpellings = environmentSpellings(environment).map(value => Buffer.from(value).toString('latin1'));
  active.set(id, { text: redact, bytes, byteSpellings });
  return { redact, release: () => active.delete(id) };
}

export function redactDispatchText(store: TaskStore, id: string, text: string) {
  return dispatchRedactors.get(store)?.get(id)?.text(text) ?? text;
}

export function redactDispatchContent(store: TaskStore, id: string, content: string | Buffer): string | Buffer {
  if (typeof content === 'string') return redactDispatchText(store, id, content);
  const redact = dispatchRedactors.get(store)?.get(id)?.bytes;
  return redact ? Buffer.from(redact(content.toString('latin1')), 'latin1') : content;
}

export async function copyDispatchFile(store: TaskStore, id: string, source: string | Readable, destination: string) {
  const spellings = dispatchRedactors.get(store)?.get(id)?.byteSpellings ?? [];
  if (!spellings.length) {
    if (typeof source === 'string') return copyFile(source, destination, constants.COPYFILE_FICLONE);
    return pipeline(source, createWriteStream(destination, { flags: 'wx' }));
  }
  const pattern = new RegExp(spellings.map(escapePattern).join('|'), 'g');
  const tailLength = Math.max(...spellings.map(value => value.length)) - 1;
  await pipeline(typeof source === 'string' ? createReadStream(source) : source, async function* (chunks) {
    let pending = '';
    for await (const chunk of chunks) {
      pending += (chunk as Buffer).toString('latin1');
      const limit = Math.max(0, pending.length - tailLength);
      let cursor = 0, output = '';
      pattern.lastIndex = 0;
      for (let match; (match = pattern.exec(pending)) && match.index < limit;) {
        output += pending.slice(cursor, match.index) + '[REDACTED]';
        cursor = pattern.lastIndex;
      }
      // Consume complete matches even when they end inside the retained tail.
      const end = Math.max(cursor, limit);
      yield Buffer.from(output + pending.slice(cursor, end), 'latin1');
      pending = pending.slice(end);
    }
    yield Buffer.from(pending.replace(pattern, '[REDACTED]'), 'latin1');
  }, createWriteStream(destination, { flags: 'wx' }));
}

const managedNames = new Set([
  ...runtimeEnvironmentNames,
  'CLAUDE_CONFIG_DIR', 'CLAUDE_CODE_DISABLE_AUTO_MEMORY', 'CODEX_HOME', 'CODEX_SQLITE_HOME',
  'GH_TOKEN', 'GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT',
  // CLI authentication remains owned by the CLI, per ADR 0004.
  'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'OPENAI_API_KEY', 'CODEX_API_KEY',
  ...Object.values(acpAgents).flatMap(profile => [
    ...Object.keys(profile.environment.set), ...profile.environment.unset, ...(profile.homeVariable ? [profile.homeVariable] : []),
  ]),
].map(name => name.toUpperCase()));

export const projectEnvironmentName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, '变量名须以字母或下划线开头，且只能包含字母、数字和下划线。')
  .refine(name => !managedNames.has(name.toUpperCase()) && !/^(HELM_|DSH_|GIT_CONFIG_)/i.test(name),
    '这个变量由 Helm 运行层或 Agent CLI 管理，不能由项目覆盖；CLI 登录和 API key 请在 CLI 自己的主目录配置。');

export function projectEnvironmentNames(store: TaskStore, projectId: string): string[] {
  return store.db.prepare('SELECT name FROM project_environment WHERE project_id = ? ORDER BY name').all(projectId).map(row => String(row.name));
}

// Private startup path only. Never attach this result to an Agent, dispatch or brief.
export function projectEnvironment(store: TaskStore, projectId: string): Record<string, string> {
  return Object.fromEntries(store.db.prepare('SELECT name, value FROM project_environment WHERE project_id = ? ORDER BY name').all(projectId)
    .map(row => [String(row.name), String(row.value)]));
}

export function changeProjectEnvironment(store: TaskStore, actor: Actor, projectId: string, name: string, value?: string) {
  if (!store.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId)) throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
  if (value === undefined) store.db.prepare('DELETE FROM project_environment WHERE project_id = ? AND name = ?').run(projectId, name);
  else store.db.prepare(`INSERT INTO project_environment (project_id, name, value) VALUES (?, ?, ?)
    ON CONFLICT(project_id, name) DO UPDATE SET value = excluded.value`).run(projectId, name, value);
  store.appendEvent(actor, { type: 'project', id: projectId }, value === undefined ? 'project-environment-deleted' : 'project-environment-set', { name });
  return { projectId, environmentNames: projectEnvironmentNames(store, projectId) };
}

// Defense against accidental shell/CLI echoes in Helm's output and summaries.
// Include JSON-escaped spellings because drivers wrap CLI output in JSON text.
export function environmentRedactor(environment: Record<string, string>) {
  const spellings = environmentSpellings(environment);
  const pattern = spellings.length ? new RegExp(spellings.map(escapePattern).join('|'), 'g') : undefined;
  return (text: string) => pattern ? text.replace(pattern, '[REDACTED]') : text;
}

function environmentSpellings(environment: Record<string, string>) {
  return [...new Set(Object.values(environment).filter(Boolean).flatMap(value => [value, JSON.stringify(value).slice(1, -1)]))]
    .sort((a, b) => b.length - a.length);
}

function escapePattern(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

export function redactEnvironmentEvent(event: DriverEvent, redact: (text: string) => string): DriverEvent {
  if (event.type === 'output') return { ...event, text: redact(event.text) };
  if (event.type === 'plan') return { ...event, entries: event.entries.map(entry => ({ ...entry, content: redact(entry.content) })) };
  if (event.type === 'artifact') return { ...event, path: redact(event.path) };
  if (event.type === 'end') return { ...event,
    ...(event.finalAnswer !== undefined ? { finalAnswer: redact(event.finalAnswer) } : {}),
    ...(event.failure !== undefined ? { failure: redact(event.failure) } : {}),
    ...(event.unavailable ? { unavailable: { reason: redact(event.unavailable.reason), ...(event.unavailable.command ? { command: redact(event.unavailable.command) } : {}) } } : {}),
  };
  return event;
}
