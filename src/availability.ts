import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { promisify } from 'node:util';
import type { DriverRegistry, TemplateAvailability } from './driver.js';
import { findExecutable, runtimeEnvironment } from './environment.js';
import { RuleError, type Actor, type TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

export function monitorTemplateAvailability(store: TaskStore, drivers: DriverRegistry) {
  store.templates.monitor(template => drivers[template.driver]!.checkAvailability(template), (id, result) => {
    // Persist transitions in the event log so restart does not repeat an unchanged notice.
    const previous = store.db.prepare(`SELECT details FROM events WHERE object_type = 'agent-template' AND object_id = ?
      AND action = 'template-availability-changed' ORDER BY id DESC LIMIT 1`).get(id);
    const last = previous ? JSON.parse(String(previous.details)) as TemplateAvailability : { available: true };
    if (last.available === result.available && last.reason === result.reason && last.command === result.command) return;
    store.transaction(() => {
      const details = { templateId: id, ...result };
      store.appendEvent(runtime, { type: 'agent-template', id }, 'template-availability-changed', details);
      if (!result.available && (last.available || last.reason !== result.reason)) store.appendEvent(runtime, { type: 'agent-template', id }, 'needs-user-attention',
        { kind: 'template-unavailable', ...details });
    });
  });
}

export async function pendingTemplates(store: TaskStore) {
  return (await store.templates.refresh()).filter(template => !template.available)
    .map(template => ({ type: 'agent-template', kind: 'template-unavailable', templateId: template.id,
      reason: template.reason, command: 'command' in template ? template.command : undefined }));
}

// Checked only when the user picks a driver, so Helm never prompts for agents nobody chose.
export async function checkAgent(drivers: DriverRegistry, name: string) {
  const install = Object.hasOwn(drivers, name) ? drivers[name]!.install : undefined;
  if (!install) return { installed: true, install: null };
  const installed = Boolean(await findExecutable(install.executable, runtimeEnvironment()));
  return { installed, install: installed ? null : install.command };
}

const installing = new Map<string, Promise<{ output: string }>>();

// Runs only the driver's fixed install command; the request names the driver, never the command.
export function installAgent(store: TaskStore, drivers: DriverRegistry, actor: Actor, name: string) {
  const command = Object.hasOwn(drivers, name) ? drivers[name]!.install?.command : undefined;
  if (!command) throw new RuleError('NOT_FOUND', `驱动 ${name} 没有可用的安装命令。`, 404);
  let running = installing.get(name);
  if (!running) {
    running = promisify(execFile)('/bin/sh', ['-c', command], {
      cwd: homedir(), env: runtimeEnvironment(), timeout: 15 * 60_000, killSignal: 'SIGKILL', maxBuffer: 16 * 1024 * 1024,
    }).then(({ stdout, stderr }) => {
      store.appendEvent(actor, { type: 'agent-driver', id: name }, 'agent-installed', { command });
      return { output: (stdout + stderr).slice(-8000) };
    }, (error: { stdout?: string; stderr?: string; message: string }) => {
      store.appendEvent(actor, { type: 'agent-driver', id: name }, 'agent-install-failed', { command });
      throw new RuleError('INSTALL_FAILED', `安装命令失败：${command}\n${((error.stdout ?? '') + (error.stderr ?? '') || error.message).slice(-8000)}`, 500);
    }).finally(() => installing.delete(name));
    installing.set(name, running);
  }
  return running;
}
