import { execFile, execFileSync } from 'node:child_process';
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Drivers report this immediately after spawning a detached process group.
export interface ManagedProcess { pid: number; pgid: number; startedAt: string }
interface ProcessDirectory { pid: number; pgid: number; cwd: string }
const exec = promisify(execFile);

// Drivers call this right after spawning a detached group leader. The OS start
// time lets restart cleanup tell the recorded group from a reused PID.
export function managedProcess(pid: number): ManagedProcess {
  let startedAt: string | null = null;
  // shortcut: an unreadable start time falls back to now, so restart cleanup skips that group; fine while helmd may run ps.
  try { startedAt = processStartTime(pid); } catch { /* keep the fallback */ }
  return { pid, pgid: pid, startedAt: startedAt ?? new Date().toISOString() };
}

// Use the OS timestamp rather than the time helmd happened to observe a PID.
export function processStartTime(pid: number): string | null {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, LC_ALL: 'C' },
    }).trim() || null;
  } catch (error) {
    if ((error as { status?: number }).status === 1 || (error as NodeJS.ErrnoException).code === 'EPERM') return null;
    throw error;
  }
}

export async function cleanupRecordedProcessGroup(pgid: number, startedAt: string) {
  if (pgid <= 1 || processStartTime(pgid) !== startedAt) return false;
  const entries = await processDirectories();
  const ownGroup = entries.find(entry => entry.pid === process.pid)?.pgid;
  if (!ownGroup || ownGroup === pgid) throw new Error('Refusing unsafe process group cleanup');
  if (!entries.some(entry => entry.pid === pgid && entry.pgid === pgid)) return false;
  await signalProcess(-pgid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  while (await processTargetExists(-pgid) && Date.now() < deadline) await delay(50);
  if (await processTargetExists(-pgid)) {
    await signalProcess(-pgid, 'SIGKILL');
    for (let poll = 0; poll < 40; poll++) {
      if (!await processTargetExists(-pgid)) return true;
      await delay(50);
    }
    throw new Error(`Process group ${pgid} survived cleanup; refusing git changes`);
  }
  return true;
}

async function processDirectories(): Promise<ProcessDirectory[]> {
  if (process.platform === 'linux') {
    const entries = await readdir('/proc');
    const processes = await Promise.all(entries.filter(name => /^\d+$/.test(name)).map(async name => {
      try {
        const [cwd, stat] = await Promise.all([readlink(`/proc/${name}/cwd`), readFile(`/proc/${name}/stat`, 'utf8')]);
        const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
        return { pid: Number(name), pgid: Number(fields[2]), cwd };
      } catch (error) {
        if (!['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
    }));
    return processes.filter((entry): entry is ProcessDirectory => entry !== undefined);
  }
  if (process.platform !== 'darwin') throw new Error('Process cleanup requires macOS or Linux');
  let output: string;
  try { output = (await exec('lsof', ['-nP', '-a', '-d', 'cwd', '-Fpgn'], { maxBuffer: 16 * 1024 * 1024 })).stdout; }
  catch (error) {
    const result = error as { code?: number; stdout?: string };
    if (result.code !== 1) throw error;
    output = result.stdout ?? '';
  }
  const processes: ProcessDirectory[] = [];
  let pid = 0;
  let pgid = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1)); pgid = 0; }
    else if (line.startsWith('g')) pgid = Number(line.slice(1));
    else if (line.startsWith('n') && pid > 1 && pgid > 1) processes.push({ pid, pgid, cwd: line.slice(1) });
  }
  return processes;
}

export async function processTargetExists(target: number) {
  try { process.kill(target, 0); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code !== 'EPERM') throw error;
  }
  // Darwin can return EPERM for a group containing only zombies. A reaped
  // group leader also says nothing about surviving children. Inspect the whole
  // group independently of cwd; exited processes cannot write or hold ports.
  // The existing process directory scan uses lsof on macOS and /proc on Linux.
  // Zombies have no cwd, so neither scan includes them.
  return (await processDirectories()).some(entry => target < 0 ? entry.pgid === -target : entry.pid === target);
}

export async function signalProcess(target: number, value: NodeJS.Signals) {
  try { process.kill(target, value); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ESRCH' || (code === 'EPERM' && !await processTargetExists(target))) return;
    const identity = target < 0 ? `process group ${-target}` : `process ${target}`;
    throw new Error(`Cannot send ${value} to ${identity}: ${String(error)}`, { cause: error });
  }
}

export async function cleanupWorktreeProcesses(path: string, managed: ManagedProcess[] = [], includeDirectory = true) {
  const root = await realpath(path);
  let snapshot = await processDirectories();
  const ownGroup = snapshot.find(entry => entry.pid === process.pid)?.pgid;
  if (!ownGroup) throw new Error('Cannot identify helmd process group; refusing unsafe cleanup');
  const inside = (cwd: string) => {
    const suffix = relative(root, cwd);
    return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  };
  const matches = snapshot.filter(entry => entry.pid !== process.pid && ((includeDirectory && inside(entry.cwd))
    || managed.some(item => item.pgid === entry.pgid)));
  const groups = new Set(matches.filter(entry => entry.pgid !== ownGroup).map(entry => entry.pgid));
  const individual = new Set(matches.filter(entry => entry.pgid === ownGroup).map(entry => entry.pid));
  const targets = (entries: ProcessDirectory[]) => entries.filter(entry => groups.has(entry.pgid) || individual.has(entry.pid));
  const pids = targets(snapshot).map(entry => entry.pid);
  const result = { pids, pgids: [...groups], escalated: false };
  if (!pids.length) return result;
  for (const group of groups) await signalProcess(-group, 'SIGTERM');
  for (const pid of individual) await signalProcess(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  do {
    await delay(50);
    snapshot = await processDirectories();
    if (!targets(snapshot).length) return result;
  } while (Date.now() < deadline);
  result.escalated = true;
  for (const group of groups) if (snapshot.some(entry => entry.pgid === group)) await signalProcess(-group, 'SIGKILL');
  for (const pid of individual) if (snapshot.some(entry => entry.pid === pid)) await signalProcess(pid, 'SIGKILL');
  // Do not let git race a process that has received SIGKILL but has not exited yet.
  for (let poll = 0; poll < 40; poll++) {
    await delay(50);
    if (!targets(await processDirectories()).length) return result;
  }
  throw new Error('Processes survived cleanup; refusing git changes');
}
