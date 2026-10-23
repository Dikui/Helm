import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import type { DriverEvent, SessionOptions } from '../src/driver.js';
import { templateEnvironment, type AgentTemplate } from '../src/templates.js';

export async function acpFixture(t: TestContext, script: object = {}, manageHome = true, agent: 'grok' | 'deepseek' = 'grok') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-acp-')));
  const home = join(directory, 'home');
  const cwd = join(directory, 'card');
  await mkdir(home);
  await mkdir(cwd);
  const previousHome = process.env.HOME;
  if (manageHome) process.env.HOME = home;
  t.after(async () => {
    if (manageHome) { if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome; }
    await rm(directory, { recursive: true, force: true });
  });
  const record = join(directory, 'requests.jsonl');
  const path = join(directory, 'script.json');
  await writeFile(record, '');
  await writeFile(path, JSON.stringify({ record, ...script }));
  const command = { file: process.execPath, args: [fileURLToPath(new URL('./fixtures/acp-agent.js', import.meta.url)), path] };
  const driver = new AcpDriver(agent, { command, timeoutMs: 2000 });
  const template: AgentTemplate = { id: `${agent}-executor`, role: 'executor', driver: agent, model: agent === 'grok' ? 'grok-4.7' : 'deepseek-flash',
    reasoningEffort: 'low', fast: false, home: 'shared', description: '测试执行者', prompt: '测试策略', directory, skillsPath: null };
  const options: SessionOptions = { template, cwd, env: { ...templateEnvironment(template), HOME: home, XAI_API_KEY: 'must-not-inherit' },
    sandbox: { mode: 'workspace-write', writableRoots: [cwd] },
    mcpServers: { helm: { url: 'http://127.0.0.1:4242/mcp', headers: { Authorization: 'Bearer dispatch-token' } } } };
  const requests = async (): Promise<any[]> => (await readFile(record, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  return { driver, command, template, options, directory, home, cwd, requests };
}

export async function collect(events: AsyncIterable<DriverEvent>) {
  const result: DriverEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
