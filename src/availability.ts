import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { DriverRegistry, AgentAvailability } from './driver.js';
import { findExecutable, runtimeEnvironment } from './environment.js';
import { playwrightCommand } from './browser.js';
import { RuleError, type Actor, type TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

export function monitorAgentAvailability(store: TaskStore, drivers: DriverRegistry) {
  store.agents.monitor(agent => drivers[agent.driver]!.checkAvailability(agent), (id, result) => {
    // Persist transitions in the event log so restart does not repeat an unchanged notice.
    const previous = store.db.prepare(`SELECT details FROM events WHERE object_type = 'agent' AND object_id = ?
      AND action = 'agent-availability-changed' ORDER BY id DESC LIMIT 1`).get(id);
    const last = previous ? JSON.parse(String(previous.details)) as AgentAvailability : { available: true };
    if (last.available === result.available && last.reason === result.reason && last.command === result.command) return;
    store.transaction(() => {
      const details = { agentId: id, ...result };
      store.appendEvent(runtime, { type: 'agent', id }, 'agent-availability-changed', details);
      if (!result.available && (last.available || last.reason !== result.reason)) store.appendEvent(runtime, { type: 'agent', id }, 'needs-user-attention',
        { kind: 'agent-unavailable', ...details });
    });
  });
}

export async function pendingAgents(store: TaskStore) {
  return (await store.agents.refresh()).filter(agent => !agent.available)
    .map(agent => ({ type: 'agent', kind: 'agent-unavailable', agentId: agent.id,
      reason: agent.reason, command: 'command' in agent ? agent.command : undefined }));
}

// Checked only when the user picks a driver, so Helm never prompts for agents nobody chose.
export async function checkAgent(drivers: DriverRegistry, name: string) {
  const install = Object.hasOwn(drivers, name) ? drivers[name]!.install : undefined;
  if (!install) return { installed: true, install: null };
  const installed = Boolean(await findExecutable(install.executable, runtimeEnvironment()));
  return { installed, install: installed ? null : install.command };
}

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const browserArgs = [...playwrightCommand.args, 'install-browser', 'chromium'];
const browserInstall = [playwrightCommand.file, ...browserArgs, '--no-shell'].map(quote).join(' ');
const run = promisify(execFile);

async function version(path: string) {
  try {
    const { stdout, stderr } = await run(path, ['--version'], { env: runtimeEnvironment(), timeout: 10_000, killSignal: 'SIGKILL' });
    return (stdout || stderr).trim().split('\n')[0] || null;
  } catch { return null; }
}

// Playwright prints where it would install Chrome for Testing; the browser is ready when that directory exists.
async function browserInstalled() {
  try {
    const { stdout } = await run(playwrightCommand.file, [...browserArgs, '--dry-run'], { env: runtimeEnvironment(), timeout: 20_000, killSignal: 'SIGKILL' });
    const location = stdout.match(/Install location:\s+(.+)/)?.[1]?.trim();
    return Boolean(location && existsSync(location));
  } catch { return false; }
}

// Everything outside npm that Helm runs: each driver's CLI plus the browser used for page checks.
export async function checkEnvironment(drivers: DriverRegistry) {
  const tools = await Promise.all(Object.entries(drivers).flatMap(([name, driver]) => driver.install ? [{ name, ...driver.install }] : [])
    .map(async ({ name, executable, command, login }) => {
      const path = await findExecutable(executable, runtimeEnvironment());
      return { name, executable, installed: Boolean(path), version: path ? await version(path) : null, install: command, login };
    }));
  return [...tools, { name: 'browser', executable: 'chromium', installed: await browserInstalled(), version: null, install: browserInstall, login: null }];
}

const installing = new Map<string, Promise<{ output: string }>>();

// Runs only a fixed install command; the request names the tool, never the command.
export function installTool(store: TaskStore, drivers: DriverRegistry, actor: Actor, name: string) {
  const command = name === 'browser' ? browserInstall : Object.hasOwn(drivers, name) ? drivers[name]!.install?.command : undefined;
  if (!command) throw new RuleError('NOT_FOUND', `${name} 没有可用的安装命令。`, 404);
  let running = installing.get(name);
  if (!running) {
    running = run('/bin/sh', ['-c', command], {
      cwd: homedir(), env: runtimeEnvironment(), timeout: 15 * 60_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
    }).then(({ stdout, stderr }) => {
      store.appendEvent(actor, { type: 'tool', id: name }, 'tool-installed', { command });
      return { output: (stdout + stderr).slice(-8000) };
    }, (error: { stdout?: string; stderr?: string; message: string }) => {
      store.appendEvent(actor, { type: 'tool', id: name }, 'tool-install-failed', { command });
      throw new RuleError('INSTALL_FAILED', `安装命令失败：${command}\n${((error.stdout ?? '') + (error.stderr ?? '') || error.message).slice(-8000)}`, 500);
    }).finally(() => installing.delete(name));
    installing.set(name, running);
  }
  return running;
}
