import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { defaultTemplateDir } from '../src/templates.js';

// Existing scenarios have independent scripts for each role. Register both at
// the same CLI boundary so their queues do not depend on wake-event timing.
export function startTestHelmd(options: Omit<NonNullable<Parameters<typeof startHelmd>[0]>, 'drivers'> & {
  driver?: Pick<Driver, 'start'> & Partial<Driver>; executorDriver?: Pick<Driver, 'start'> & Partial<Driver>;
} = {}) {
  const { driver = new FakeDriver(), executorDriver = new FakeDriver(), ...runtime } = options;
  return startHelmd({ ...runtime, drivers: { 'claude-sdk': {
    // These fixtures exercise sessions; availability scenarios register their own driver.
    checkAvailability: async () => ({ available: true }),
    start: session => (session.template?.role === 'coordinator' ? driver : executorDriver).start(session),
  }, codex: new FakeDriver(), grok: new FakeDriver(), deepseek: new FakeDriver() } });
}

export async function copyTemplates(directory: string) {
  const templateDir = join(directory, 'templates');
  await cp(defaultTemplateDir, templateDir, { recursive: true });
  return templateDir;
}

export async function configureTestTemplate(templateDir: string, id: string, settings: object) {
  const path = join(templateDir, id, 'config.json');
  await writeFile(path, JSON.stringify({ ...JSON.parse(await readFile(path, 'utf8')), ...settings }));
}
