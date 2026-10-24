import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import { FakeDriver, type Driver } from '../src/driver.js';
import type { HelmEvent } from '../src/store.js';
import { startTestHelmd as startHelmd, copyAgents, configureTestAgent } from './helmd-fixture.js';

type TestEvent = Omit<HelmEvent, 'details'> & { details: Record<string, any> };

export async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 10_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待调度轮次超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

// Only the requested rounds use the supplied driver. Alignment and draining
// unrelated wake events use fake sessions; executor dispatches use hanging fakes.
export async function fixture(t: TestContext, driver: Driver, rounds = 1) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-coordinator-')));
  const repo = join(directory, 'project');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'coordinator read-only baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const setup = new FakeDriver([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      key: 'draft', requirements: '调度者驱动冒烟', boundary: '本机临时项目', criteria: 'MCP 操作成功、重投去重、代码只读' }),
      check: value => assert.equal((value as any).ok, true) },
  ]]);
  const drain = new FakeDriver();
  let started = 0;
  const agentDir = await copyAgents(directory);
  await configureTestAgent(agentDir, 'claude-coordinator', { model: 'haiku', reasoningEffort: 'low' });
  const daemon = await startHelmd({ agentDir, port: 0, dataDir: join(directory, 'data'),
    driver: { start(options) {
      const round = started++;
      return (round === 0 ? setup : round <= rounds ? driver : drain).start(options);
    } },
    executorDriver: new FakeDriver([[{ type: 'hang' }]]),
    browserCommand: { file: process.execPath, args: [fileURLToPath(new URL('./fixtures/browser-mcp.js', import.meta.url))] },
  });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${daemon.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const initial = (await call('send-message', { projectId: project.id, key: 'start', body: '调度者驱动冒烟' })).work;
  const params = { workId: initial.id };
  const events = async (): Promise<TestEvent[]> => call('get-events', params);
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending')).find((item: any) => item.workId === initial.id);
  await call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  const work = await call('get-work', params);
  return { ...daemon, call, events, work, params, directory, repo, git };
}
