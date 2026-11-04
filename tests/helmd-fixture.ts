import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { TestContext } from 'node:test';
import { join, relative } from 'node:path';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { fileURLToPath } from 'node:url';
import { ensureWorkCopy } from '../src/alignment.js';
import { AgentCatalog } from '../src/agents.js';
import { TaskStore } from '../src/store.js';

// Agent configs for tests; the role rules are built into src/prompts.ts.
export const fixtureAgentDir = fileURLToPath(new URL('../../tests/fixtures/agents/', import.meta.url));

// Persist an existing copy for scenarios that exercise legacy work or delivery.
export function existingWorkCopy(dataDir: string, workId: string) {
  const store = new TaskStore(dataDir, new AgentCatalog(fixtureAgentDir));
  try { return store.transaction(() => ensureWorkCopy(store, workId)); }
  finally { store.db.close(); }
}

// A logged-in Codex in a fresh home re-downloads its plugin catalog and curated plugins (~50 MB) on
// every start. Share those caches across test homes; login, config and sessions stay per test.
export async function shareCodexCaches(codexHome: string, realHome: string) {
  const shared = join(realHome, '.cache', 'helm-tests', 'codex');
  for (const name of ['cache', 'plugins', '.tmp']) {
    await mkdir(join(shared, name), { recursive: true });
    await symlink(join(shared, name), join(codexHome, name));
  }
}

export interface FirstMessage {
  body: string;
  attachments?: { name: string; content: string }[];
}

// Call from t.after: a failed real-CLI test keeps its whole run (task database, dispatch output,
// CLI transcripts under the test HOME) so the failure can be diagnosed instead of rerun blindly.
export async function removeUnlessFailed(t: TestContext, directory: string) {
  // Node 26 sets passed before after-hooks run; @types/node does not declare it yet.
  if ((t as TestContext & { passed: boolean }).passed) return rm(directory, { recursive: true, force: true });
  let kept = directory;
  // Some real smokes must live under HOME; keep their evidence in the temporary root, never in the user's home.
  if (relative(await realpath(tmpdir()), directory).startsWith('..')) {
    kept = await mkdtemp(join(tmpdir(), 'helm-failed-'));
    await cp(directory, kept, { recursive: true, verbatimSymlinks: true });
    await rm(directory, { recursive: true, force: true });
  }
  console.error(`测试失败，现场保留在 ${kept}（任务库、派单输出、CLI 会话记录）`);
}

// Existing scenarios have independent scripts for each role. Register both at
// the same CLI boundary so their queues do not depend on wake-event timing.
export function startTestHelmd(options: Omit<NonNullable<Parameters<typeof startHelmd>[0]>, 'drivers'> & {
  driver?: Pick<Driver, 'start'> & Partial<Driver>; executorDriver?: Pick<Driver, 'start'> & Partial<Driver>; codexDriver?: Driver;
} = {}) {
  const { driver = new FakeDriver(), executorDriver = new FakeDriver(), codexDriver = new FakeDriver(), ...runtime } = options;
  return startHelmd({ agentDir: fixtureAgentDir, ...runtime, drivers: { 'claude-sdk': {
    capabilities: driver.capabilities ?? new FakeDriver().capabilities,
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
