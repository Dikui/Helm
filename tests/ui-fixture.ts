import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeDriver, type Driver, type FakeScript } from '../src/driver.js';
import { copyTemplates, startTestHelmd } from './helmd-fixture.js';

// Shared HTTP / whole-app boundary. Every driver is fake, and HOME is disposable.
export async function uiFixture(scripts: FakeScript[] = [], staticDir?: string, options: { registerProject?: boolean; templateDir?: string; executorScripts?: FakeScript[]; codexDriver?: Driver } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-ui-')));
  const previousHome = process.env.HOME;
  const home = join(directory, 'home');
  await mkdir(home);
  process.env.HOME = home;
  let daemon: Awaited<ReturnType<typeof startTestHelmd>> | undefined;
  try {
    const repo = join(directory, 'project');
    execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
    await writeFile(join(repo, 'README.md'), 'baseline\n');
    const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'ignore' });
    git('add', 'README.md');
    git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
    const templateDir = options.templateDir ?? await copyTemplates(directory);
    daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), templateDir,
      driver: new FakeDriver(scripts), executorDriver: new FakeDriver(options.executorScripts ?? []),
      ...(options.codexDriver ? { codexDriver: options.codexDriver } : {}), ...(staticDir ? { staticDir } : {}) });
    const url = daemon.url;
    const call = async (name: string, params: object = {}) => {
      const response = await fetch(`${url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
      return { status: response.status, ...await response.json() as any };
    };
    const project = options.registerProject === false ? null : (await call('register-project', { path: repo })).result;
    return { url, call, project, directory, repo, async close() {
      await daemon!.close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) {
    await daemon?.close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 5_000;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    if (Date.now() > deadline) throw new Error('等待界面测试数据超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
