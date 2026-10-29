import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { FakeDriver, type Driver, type FakeContext, type FakeScript } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startTestHelmd as startHelmd, copyAgents, configureTestAgent, type FirstMessage } from './helmd-fixture.js';

const ok = (value: any) => assert.equal(value.ok, true, JSON.stringify(value));
const workIdOf = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const saved = (ctx: FakeContext, key: string): any => (ctx.results.get(key) as any).result;

export async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待浏览器派单超时');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

export async function fixture(t: TestContext, executors: FakeScript[], config: {
  needsBrowser?: boolean; purpose?: 'execution' | 'verification'; browserArgs?: string[]; realBrowser?: boolean; after?: FakeScript;
  watchdog?: { wallTimeoutMs: number; idleTimeoutMs: number };
  executorDriver?: Driver; content?: string; model?: string;
  projectSettings?: object;
  projectEnvironment?: Record<string, string>;
  firstMessage?: FirstMessage; dispatchContent?: (brief: StartupBrief) => string;
} = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-browser-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'index.html'), '<h1>Helm browser dispatch</h1>');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
  git('add', 'index.html');
  if (config.projectSettings) {
    await mkdir(join(repo, '.claude'));
    await writeFile(join(repo, '.claude', 'settings.json'), JSON.stringify(config.projectSettings));
    git('add', '.claude/settings.json');
  }
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const agentDir = await copyAgents(directory);
  if (config.model) await configureTestAgent(agentDir, 'claude-executor', { model: config.model, reasoningEffort: 'low' });
  const options = { agentDir,
    port: 0, dataDir: join(directory, 'data'), executorDriver: config.executorDriver ?? new FakeDriver(executors),
    browserCommand: config.realBrowser ? undefined : { file: process.execPath, args: [fileURLToPath(new URL('./fixtures/browser-mcp.js', import.meta.url)), ...(config.browserArgs ?? [])] },
    driver: new FakeDriver([[
      { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workIdOf(ctx), key: 'draft', requirements: '浏览器派单', boundary: '本机', criteria: '截图匹配页面' }), check: ok },
    ], [
      { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workIdOf(ctx), key: 'card', content: config.content ?? '检查页面', needsVerification: config.purpose === 'verification' }), saveAs: 'card', check: ok },
      { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workIdOf(ctx), cardId: saved(ctx, 'card').id, key: 'dispatch', agentId: 'claude-executor', purpose: config.purpose,
        content: config.dispatchContent?.(JSON.parse(ctx.input)), needsBrowser: config.needsBrowser ?? false }), check: ok },
      { type: 'end', reason: 'completed', finalAnswer: 'created', usage: { inputTokens: 0, outputTokens: 0 } },
    ], ...(config.after ? [config.after] : [])]),
  } satisfies Parameters<typeof startHelmd>[0];
  const daemon = await startHelmd(options);
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}, token?: string) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: JSON.stringify(params) });
    return { status: response.status, ...await response.json() as any };
  };
  const project = (await call('register-project', { path: repo })).result;
  for (const [name, value] of Object.entries(config.projectEnvironment ?? {})) ok(await call('set-project-environment', { projectId: project.id, name, value }));
  const work = (await call('send-message', { projectId: project.id, key: 'start',
    ...(config.firstMessage ?? { body: '检查页面' }) })).result.work;
  const events = async (): Promise<any[]> => (await call('get-events', { workId: work.id })).result;
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).result[0];
  if (config.watchdog) ok(await call('set-dispatch-watchdog', config.watchdog));
  ok(await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  await until(events, values => values.some(event => event.action === 'round-ended' && event.details.finalAnswer === 'created'));
  const dispatch = (await call('list-dispatches', { workId: work.id })).result[0];
  assert.ok(dispatch, JSON.stringify(await events()));
  const ended = () => until(async () => (await call('get-dispatch', { workId: work.id, dispatchId: dispatch.id })).result, (value: any) => value.status === 'ended', config.executorDriver ? 180_000 : config.realBrowser ? 120_000 : 10_000);
  return { ...daemon, call, work, dispatch, ended, events, directory };
}

