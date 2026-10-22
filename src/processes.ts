import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

function signal(id: number, value: NodeJS.Signals) {
  try { process.kill(id, value); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw new Error(`Cannot send ${value} to ${id}`, { cause: error });
  }
}

function alive(id: number) {
  try { process.kill(id, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    if ((error as NodeJS.ErrnoException).code === 'EPERM') return true;
    throw error;
  }
}

// Scope discovery to cwd inside _work; then include each discovered process group.
export async function cleanupRoundProcesses(workPath: string) {
  const root = await realpath(workPath);
  let output: string;
  try {
    output = (await exec('lsof', ['-nP', '-a', '-d', 'cwd', '-u', String(process.getuid!()), '-Fpng'], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    if ((error as { code?: unknown }).code !== 1) throw error;
    output = String((error as { stdout?: string }).stdout ?? '');
  }
  const pids: number[] = [];
  const groups = new Set<number>();
  const processGroups = new Map<number, number>();
  let pid = 0;
  let pgid = 0;
  let ownGroup = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) { pid = Number(line.slice(1)); pgid = 0; }
    if (line.startsWith('g')) {
      pgid = Number(line.slice(1));
      if (pid === process.pid) ownGroup = pgid;
    }
    if (!line.startsWith('n') || pid === process.pid || !Number.isSafeInteger(pid) || pid <= 0) continue;
    const suffix = relative(root, line.slice(1));
    if (suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix)) {
      pids.push(pid); groups.add(pgid); processGroups.set(pid, pgid);
    }
  }
  if (!pids.length) return { pids, pgids: [] as number[] };
  if (!ownGroup) throw new Error('Cannot identify helmd process group');
  const pgids = [...groups]
    .filter(group => Number.isSafeInteger(group) && group > 0 && group !== ownGroup);
  const targets = [...pgids.map(group => -group), ...pids.filter(id => !pgids.includes(processGroups.get(id)!))];
  for (const target of targets) signal(target, 'SIGTERM');
  const deadline = Date.now() + 5_000;
  while (targets.some(alive) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  for (const target of targets) if (alive(target)) signal(target, 'SIGKILL');
  const killDeadline = Date.now() + 1_000;
  while (targets.some(alive) && Date.now() < killDeadline) await new Promise(resolve => setTimeout(resolve, 25));
  if (targets.some(alive)) throw new Error('Round processes remain after SIGKILL');
  return { pids, pgids };
}
