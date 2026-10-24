import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { copyAgents, configureTestAgent } from './helmd-fixture.js';
import { until } from './claude-coordinator-fixture.js';

// All Codex metadata and credentials live in a temporary HOME. A real smoke may
// link the real login into this temporary default CLI home without writing to the real home.
export async function coordinatorFixture(t: TestContext, driver: Driver, config: { rounds?: number; stagedAuth?: string } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-codex-coordinator-')));
  const home = join(directory, 'home');
  const previousHome = process.env.HOME;
  let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
  t.after(async () => {
    await daemon?.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(join(home, '.codex'), { recursive: true });
  if (config.stagedAuth) await symlink(config.stagedAuth, join(home, '.codex', 'auth.json'));
  else await writeFile(join(home, '.codex', 'auth.json'), 'fake credential; never open');
  process.env.HOME = home;
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  await writeFile(join(repo, 'README.md'), 'coordinator read-only baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const agentDir = await copyAgents(directory);
  await configureTestAgent(agentDir, 'codex-coordinator', { model: 'gpt-6-luna', reasoningEffort: 'low' });
  const setup = new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'draft', requirements: 'Codex 调度者冒烟', boundary: '临时项目', criteria: 'MCP、只读、重投和额度处理' }),
      check: value => assert.equal((value as any).ok, true) },
  ]]);
  const drain = new FakeDriver();
  let starts = 0;
  const dataDir = join(directory, 'data');
  daemon = await startHelmd({ port: 0, dataDir, agentDir, drivers: {
    'claude-sdk': new FakeDriver([[{ type: 'hang' }]]),
    codex: { checkAvailability: agent => driver.checkAvailability(agent), start(options) {
      const round = starts++;
      return (round === 0 ? setup : round <= (config.rounds ?? 1) ? driver : drain).start(options);
    } },
  } });
  const call = async (name: string, params: object = {}): Promise<any> => {
    const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const work = (await call('send-message', { projectId: project.id, coordinatorAgentId: 'codex-coordinator', key: 'start', body: '调度者冒烟' })).work;
  const params = { workId: work.id };
  const events = async (): Promise<any[]> => call('get-events', params);
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).find((item: any) => item.workId === work.id && item.kind === 'work-confirmation');
  const confirm = () => call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  return { ...daemon, call, events, work, params, directory, home, repo, dataDir, git, confirm };
}
