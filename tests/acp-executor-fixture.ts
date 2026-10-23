import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { copyTemplates, configureTestTemplate } from './helmd-fixture.js';
import { until } from './browser-fixture.js';

export const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));

// All daemon state, CLI state and card copies use a temporary HOME. The real
// smoke may link the CLI-owned login; Helm never opens or copies its contents.
export async function acpExecutorFixture(t: TestContext, executor: Driver, config: {
  agent?: 'grok' | 'deepseek';
  content?: string; secondContent?: string; needsBrowser?: boolean; realBrowser?: boolean;
  stagedAuth?: string; model?: string; purpose?: 'execution' | 'verification';
  skills?: Record<string, string>;
} = {}) {
  const agent = config.agent ?? 'grok';
  const templateId = `${agent}-executor`;
  const directory = await realpath(await mkdtemp(join(tmpdir(), `helm-${agent}-executor-`)));
  const previousHome = process.env.HOME;
  const home = join(directory, 'home');
  const cliHome = join(home, agent === 'grok' ? '.grok' : '.dsh');
  await mkdir(cliHome, { recursive: true });
  if (config.stagedAuth) {
    await symlink(config.stagedAuth, join(cliHome, agent === 'grok' ? 'auth.json' : '.credentials.yaml'));
    if (agent === 'grok') await writeFile(join(cliHome, 'config.toml'), '[ui]\npermission_mode = "always-approve"\n');
  }
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
  await configureTestTemplate(templateDir, templateId, { model: config.model ?? (agent === 'grok' ? 'grok-4.7' : 'deepseek-flash'), reasoningEffort: 'low', fast: false });
  for (const [name, content] of Object.entries(config.skills ?? {})) {
    const skill = join(templateDir, templateId, 'skills', name);
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, 'SKILL.md'), `---\nname: ${name}\ndescription: Helm smoke skill; use when asked to verify template skills.\n---\n${content}\n`);
  }
  let created = false;
  const actions: FakeScript[] = [];
  const coordinator = new FakeDriver(Array(40).fill((ctx: FakeContext): FakeStep[] => {
    const work = JSON.parse(ctx.input).work;
    if (work.status === 'aligning') return [{ type: 'tool', name: 'draft-work-description', arguments: {
      workId: work.id, key: 'draft', requirements: `${agent} 执行与验收派单`, boundary: '卡片副本', criteria: '保存结果和证据',
    }, check: ok }];
    if (created) { const action = actions.shift() ?? []; return typeof action === 'function' ? action(ctx) : action; }
    created = true;
    return [config.content ?? '实现卡片', ...(config.secondContent ? [config.secondContent] : [])].flatMap((content, index): FakeStep[] => [
      { type: 'tool', name: 'create-card', arguments: { workId: work.id, key: `card-${index}`, content: `${agent} 冒烟卡片`, needsVerification: config.purpose === 'verification' }, saveAs: `card-${index}`, check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: work.id,
        cardId: (ctx.results.get(`card-${index}`) as any).result.id, templateId, key: `dispatch-${index}`,
        content, purpose: config.purpose ?? 'execution', needsBrowser: index === 0 && (config.needsBrowser ?? false) }), check: ok },
    ]);
  }));
  const dataDir = join(directory, 'data');
  daemon = await startHelmd({ port: 0, dataDir, templateDir, drivers: { 'claude-sdk': coordinator, [agent]: executor },
    ...(!config.realBrowser ? { browserCommand: { file: process.execPath, args: [fileURLToPath(new URL('./fixtures/browser-mcp.js', import.meta.url))] } } : {}) });
  const call = async (name: string, params: object = {}): Promise<any> =>
    (await fetch(`${daemon!.url}/api/${name}`, { method: 'POST', body: JSON.stringify(params) })).json();
  const project = (await call('register-project', { path: repo })).result;
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '执行' })).result.work;
  const events = async (): Promise<any[]> => (await call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(e => e.action === 'round-ended'));
  const gate = (await call('list-pending')).result.find((g: any) => g.workId === work.id);
  const confirm = async () => ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  const dispatches = async (): Promise<any[]> => (await call('list-dispatches', { workId: work.id })).result;
  const ended = async (count = 1, timeout = 30_000) => {
    try { return await until(dispatches, values => values.length >= count && values.slice(0, count).every(d => d.status === 'ended'), timeout); }
    catch (error) { throw new Error(`${String(error)}\n${JSON.stringify(await events())}`); }
  };
  return { ...daemon, directory, home, repo, git, templateDir, dataDir, call, work, events, dispatches, ended, confirm, actions,
    output: async (id: string): Promise<any[]> => (await call('get-dispatch-output', { workId: work.id, dispatchId: id })).result };
}
