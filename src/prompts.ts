import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AgentConfig } from './agents.js';

// Role rules live in <dataDir>/prompts/; the repo's prompts/ only seeds missing files and never overwrites them.
export const promptNames = ['coordinator-role', 'coordinator-runtime', 'executor-role', 'executor-runtime'] as const;
export type PromptName = typeof promptNames[number];
export const defaultPromptDir = fileURLToPath(new URL('../../prompts/', import.meta.url));

export function seedPrompts(directory: string) {
  mkdirSync(directory, { recursive: true });
  for (const name of promptNames) if (!existsSync(join(directory, `${name}.md`))) copyFileSync(join(defaultPromptDir, `${name}.md`), join(directory, `${name}.md`));
}

// A directory that was never seeded (tests, fixtures) reads the repo defaults.
export function readPrompt(directory: string, name: PromptName) {
  try { return readFileSync(join(directory, `${name}.md`), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFileSync(join(defaultPromptDir, `${name}.md`), 'utf8');
  }
}

export function writePrompt(directory: string, name: PromptName, text: string) {
  mkdirSync(directory, { recursive: true });
  const temporary = join(directory, `.${name}-${randomUUID()}.tmp`);
  writeFileSync(temporary, text);
  renameSync(temporary, join(directory, `${name}.md`));
}

export function roleRules(role: AgentConfig['role'], directory = defaultPromptDir) {
  return { role: readPrompt(directory, `${role}-role`), runtime: readPrompt(directory, `${role}-runtime`) };
}

export function agentPrompt(agent: AgentConfig) {
  return [agent.rules.role.trim(), agent.prompt.trim(), agent.rules.runtime.trim()].filter(Boolean).join('\n\n');
}
