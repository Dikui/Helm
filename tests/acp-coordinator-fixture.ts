import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { FakeDriver, type Driver } from '../src/driver.js';
import { startHelmd } from '../src/server.js';
import { configureTestAgent, copyAgents } from './helmd-fixture.js';

// CLI metadata and project files stay in a temporary HOME. Real smokes link
// only the CLI-owned login; the coordinator itself uses the supplied driver.
export async function acpCoordinatorFixture(t: TestContext, kind: 'grok' | 'deepseek', driver: Driver,
  config: { stagedAuth?: string; model?: string } = {}) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), `helm-${kind}-coordinator-`)));
  const home = join(directory, 'home');
  const previousHome = process.env.HOME;
  let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
  t.after(async () => {
    await daemon?.close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    await rm(directory, { recursive: true, force: true });
  });
  const cliHome = join(home, kind === 'grok' ? '.grok' : '.dsh');
  await mkdir(cliHome, { recursive: true });
  if (config.stagedAuth) await symlink(config.stagedAuth, join(cliHome, kind === 'grok' ? 'auth.json' : '.credentials.yaml'));
  if (kind === 'grok') await writeFile(join(cliHome, 'config.toml'), '[ui]\npermission_mode = "always-approve"\n');
  process.env.HOME = home;
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  await writeFile(join(repo, 'README.md'), 'coordinator read-only baseline\n');
  git('add', 'README.md');
  git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
  const agentDir = await copyAgents(directory);
  const agentId = `${kind}-coordinator`;
  await cp(join(agentDir, `${kind}-executor`), join(agentDir, agentId), { recursive: true });
  await configureTestAgent(agentDir, agentId, { role: 'coordinator', loadGlobalConfig: false,
    model: config.model ?? (kind === 'grok' ? 'grok-4.7' : 'deepseek-flash'), reasoningEffort: 'low', fast: false });
  const executor = new FakeDriver([[
    { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: 'README.md 基线检查完成' },
      check: value => assert.equal((value as any).ok, true) },
    { type: 'end', reason: 'completed', finalAnswer: 'coordinator read-only baseline', usage: { inputTokens: 1, outputTokens: 1 } },
  ]]);
  const dataDir = join(directory, 'data');
  daemon = await startHelmd({ port: 0, dataDir, agentDir, drivers: { [kind]: driver, 'claude-sdk': executor } });
  const call = async (name: string, params: object = {}): Promise<any> => {
    const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body = await response.json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const work = (await call('send-message', { projectId: project.id, coordinatorAgentId: agentId, key: 'start', body: '完成一张只读 README 检查卡片并交给用户审核' })).work;
  const params = { workId: work.id };
  return { ...daemon, directory, home, repo, git, dataDir, call, work, params,
    events: async (): Promise<any[]> => call('get-events', params) };
}
