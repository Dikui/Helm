import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { defaultTemplateDir } from '../src/templates.js';

// Existing scenarios have independent scripts for each role. Register both at
// the same CLI boundary so their queues do not depend on wake-event timing.
export function startTestHelmd(options: Omit<NonNullable<Parameters<typeof startHelmd>[0]>, 'drivers'> & {
  driver?: Driver; executorDriver?: Driver;
} = {}) {
  const { driver = new FakeDriver(), executorDriver = new FakeDriver(), ...runtime } = options;
  return startHelmd({ ...runtime, drivers: { 'claude-sdk': {
    start: session => (session.template?.role === 'coordinator' ? driver : executorDriver).start(session),
  } } });
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
