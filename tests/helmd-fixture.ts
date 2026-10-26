import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { fileURLToPath } from 'node:url';

// Agent configs for tests; the role rules are built into src/prompts.ts.
export const fixtureAgentDir = fileURLToPath(new URL('../../tests/fixtures/agents/', import.meta.url));

// Existing scenarios have independent scripts for each role. Register both at
// the same CLI boundary so their queues do not depend on wake-event timing.
export function startTestHelmd(options: Omit<NonNullable<Parameters<typeof startHelmd>[0]>, 'drivers'> & {
  driver?: Pick<Driver, 'start'> & Partial<Driver>; executorDriver?: Pick<Driver, 'start'> & Partial<Driver>; codexDriver?: Driver;
} = {}) {
  const { driver = new FakeDriver(), executorDriver = new FakeDriver(), codexDriver = new FakeDriver(), ...runtime } = options;
  return startHelmd({ agentDir: fixtureAgentDir, ...runtime, drivers: { 'claude-sdk': {
    // These fixtures exercise sessions; availability scenarios register their own driver.
    checkAvailability: async () => ({ available: true }),
    start: session => (session.agent?.role === 'coordinator' ? driver : executorDriver).start(session),
  }, codex: codexDriver, grok: new FakeDriver(), deepseek: new FakeDriver() } });
}

export async function copyAgents(directory: string) {
  const agentDir = join(directory, 'agents');
  await cp(fixtureAgentDir, agentDir, { recursive: true });
  return agentDir;
}

export async function configureTestAgent(agentDir: string, id: string, settings: object) {
  const path = join(agentDir, id, 'config.json');
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...settings }));
}
