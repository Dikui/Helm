import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { copyTemplates, configureTestTemplate } from './helmd-fixture.js';
import { until } from './browser-fixture.js';

export const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
export const result = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;

// Both CLI homes, the project and all daemon state live under this temporary root.
export async function codexFixture(t: TestContext, executor: Driver, config: {
  content?: string; needsBrowser?: boolean; after?: FakeScript;
  stagedAuth?: string; skills?: Record<string, string>;
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-codex-executor-')));
  const previousHome = process.env.HOME;
  const home = join(directory, 'home');
  await mkdir(join(home, '.codex'), { recursive: true });
  if (config.stagedAuth) await symlink(config.stagedAuth, join(home, '.codex', 'auth.json'));
  else await writeFile(join(home, '.codex', 'auth.json'), 'fake credential; never open');
  process.env.HOME = home;
  let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
  t.after(async () => {
    await daemon?.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const templateDir = await copyTemplates(directory);
  await configureTestTemplate(templateDir, 'codex-executor', { model: 'gpt-5.4-mini', reasoningEffort: 'low', fast: false });
  for (const [name, text] of Object.entries(config.skills ?? {})) {
    const path = join(templateDir, 'codex-executor', 'skills', name);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, 'SKILL.md'), `---\nname: ${name}\ndescription: Helm smoke skill\n---\n${text}\n`);
  }
  let created = false;
  const actions: FakeScript[] = config.after ? [config.after] : [];
  const coordinator = new FakeDriver(Array(40).fill((ctx: FakeContext): FakeStep[] => {
    const workId = JSON.parse(ctx.input).work.id;
    if (JSON.parse(ctx.input).work.status === 'aligning') return [{ type: 'tool', name: 'draft-work-description', arguments: {
      workId, key: 'draft', requirements: 'Codex 执行派单', boundary: '卡片副本', criteria: '保存结果和改动',
    }, check: ok }];
    if (!created) {
      created = true;
      return [
        { type: 'tool', name: 'create-card', arguments: { workId, key: 'card', content: config.content ?? '实现卡片' }, saveAs: 'card', check: ok },
        { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId, cardId: result(ctx, 'card').id, templateId: 'codex-executor',
          key: 'first', needsBrowser: config.needsBrowser ?? false }), check: ok },
      ];
    }
    const action = actions.shift() ?? [];
    return typeof action === 'function' ? action(ctx) : action;
  }));
  const fallback = new FakeDriver([[{ type: 'write', path: 'replacement.txt', content: '由另一家完成\n' }]]);
  const claude: Driver = { checkAvailability: async () => ({ available: true }),
    start: options => (options.template?.role === 'coordinator' ? coordinator : fallback).start(options) };
  const dataDir = join(directory, 'data');
  daemon = await startHelmd({ port: 0, dataDir, templateDir, drivers: { 'claude-sdk': claude, codex: executor } });
  const call = async (name: string, params: object = {}): Promise<any> => {
    const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) });
    return response.json();
  };
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '执行' })).result.work;
  const events = async (): Promise<any[]> => (await call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(e => e.action === 'round-ended'));
  const gate = (await call('list-pending')).result.find((g: any) => g.workId === work.id);
  const confirm = async () => ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await call('list-dispatches', { workId: work.id })).result;
  const ended = async (count = 1, timeout = 30_000) => {
    try { return await until(dispatches, values => values.length >= count && values[count - 1].status === 'ended', timeout); }
    catch (error) {
      const diagnostic = (await events()).filter(e => ['dispatch-ended', 'round-ended', 'operation-rejected'].includes(e.action))
        .map(e => ({ action: e.action, details: e.details }));
      throw new Error(`${String(error)}\n${JSON.stringify(diagnostic)}`);
    }
  };
  return { ...daemon, directory, home, dataDir, templateDir, repo, git, call, work, events, dispatches, ended, confirm, actions };
}
