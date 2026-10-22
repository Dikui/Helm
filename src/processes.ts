import { execFile } from 'node:child_process';
import { readdir, readFile, readlink, realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';

// Drivers report this immediately after spawning a detached process group.
export interface ManagedProcess { pid: number; pgid: number; startedAt: string }
interface ProcessDirectory { pid: number; pgid: number; cwd: string }
const exec = promisify(execFile);

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

function signal(target: number, value: NodeJS.Signals) {
  try { process.kill(target, value); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

export async function cleanupWorktreeProcesses(path: string, managed: ManagedProcess[] = []) {
  const root = await realpath(path);
  let snapshot = await processDirectories();
  const ownGroup = snapshot.find(entry => entry.pid === process.pid)?.pgid;
  if (!ownGroup) throw new Error('Cannot identify helmd process group; refusing unsafe cleanup');
  const inside = (cwd: string) => {
    const suffix = relative(root, cwd);
    return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  };
  const matches = snapshot.filter(entry => entry.pid !== process.pid && (inside(entry.cwd)
    || managed.some(item => item.pgid === entry.pgid)));
  const groups = new Set(matches.filter(entry => entry.pgid !== ownGroup).map(entry => entry.pgid));
  const individual = new Set(matches.filter(entry => entry.pgid === ownGroup).map(entry => entry.pid));
  const targets = (entries: ProcessDirectory[]) => entries.filter(entry => groups.has(entry.pgid) || individual.has(entry.pid));
  const pids = targets(snapshot).map(entry => entry.pid);
  const result = { pids, pgids: [...groups], escalated: false };
  if (!pids.length) return result;
  for (const group of groups) signal(-group, 'SIGTERM');
  for (const pid of individual) signal(pid, 'SIGTERM');
  const deadline = Date.now() + 5000;
  do {
    await delay(50);
    snapshot = await processDirectories();
    if (!targets(snapshot).length) return result;
  } while (Date.now() < deadline);
  result.escalated = true;
  for (const group of groups) if (snapshot.some(entry => entry.pgid === group)) signal(-group, 'SIGKILL');
  for (const pid of individual) if (snapshot.some(entry => entry.pid === pid)) signal(pid, 'SIGKILL');
  // Do not let git race a process that has received SIGKILL but has not exited yet.
  for (let poll = 0; poll < 40; poll++) {
    await delay(50);
    if (!targets(await processDirectories()).length) return result;
  }
  throw new Error('Processes survived cleanup; refusing git changes');
}
