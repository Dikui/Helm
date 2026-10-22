import { execFile } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { promisify } from 'node:util';
import { dispatchGit } from './dispatch.js';

const exec = promisify(execFile);

async function processes() {
  let output: string;
  try { output = (await exec('lsof', ['-nP', '-a', '-d', 'cwd', '-Fpgn'])).stdout; }
  catch (error) {
    const result = error as { code?: number; stdout?: string };
    // lsof returns 1 when no matching files remain; other failures must block reset.
    if (result.code !== 1 || typeof result.stdout !== 'string') throw error;
    output = result.stdout;
  }
  const result: { pid: number; group: number; cwd: string }[] = [];
  let pid = 0;
  let group = 0;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('g')) group = Number(line.slice(1));
    else if (line.startsWith('n')) result.push({ pid, group, cwd: line.slice(1) });
  }
  return result;
}

async function stopVerificationProcesses(workPath: string) {
  const root = realpathSync(workPath);
  const snapshot = await processes();
  const ownGroup = snapshot.find(item => item.pid === process.pid)?.group;
  if (ownGroup === undefined) throw new Error('Cannot identify helmd process group before verification reset');
  const targets = new Set(snapshot.filter(item => {
    if (item.pid === process.pid) return false;
    const suffix = relative(root, item.cwd);
    return suffix !== '..' && !suffix.startsWith('../') && !isAbsolute(suffix);
  })
    .map(item => item.group > 1 && item.group !== ownGroup ? -item.group : item.pid));
  const signal = (target: number, name: NodeJS.Signals) => {
    try { process.kill(target, name); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
  };
  for (const target of targets) signal(target, 'SIGTERM');
  const deadline = Date.now() + 5_000;
  while (targets.size) {
    const current = await processes();
    for (const target of targets) {
      if (!current.some(item => target < 0 ? item.group === -target : item.pid === target)) targets.delete(target);
    }
    if (!targets.size) break;
    if (Date.now() >= deadline) {
      for (const target of targets) signal(target, 'SIGKILL');
      // Confirm SIGKILL has taken effect before touching git.
      const killedAt = Date.now();
      while ((await processes()).some(item => targets.has(item.pid) || targets.has(-item.group))) {
        if (Date.now() - killedAt > 2_000) throw new Error('Verification processes did not exit; copy was not reset');
        await setTimeout(25);
      }
      break;
    }
    await setTimeout(25);
  }
}

export async function resetVerificationCopy(workPath: string, cardBranch: string, startCommit: string) {
  await stopVerificationProcesses(workPath);
  // Tests may leave HEAD detached; restore the card branch as well as the files.
  dispatchGit(workPath, 'symbolic-ref', 'HEAD', `refs/heads/${cardBranch}`);
  dispatchGit(workPath, 'reset', '--hard', startCommit);
  dispatchGit(workPath, 'clean', '-fd');
}
