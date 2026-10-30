import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanupWorktreeProcesses, processTargetExists } from '../src/processes.js';

// Each run gets its own TMPDIR named after the runner PID. Fixture processes
// left by a timed-out or killed run then have their cwd under a directory whose
// owner is gone, so the next run can find and stop them without touching
// concurrent runs from other checkouts.
export async function sweepStaleRuns(base: string) {
  const pids: number[] = [];
  for (const name of readdirSync(base)) {
    const owner = Number(name.split('-')[0]);
    if (!Number.isInteger(owner) || owner <= 1 || await processTargetExists(owner)) continue;
    const directory = join(base, name);
    pids.push(...(await cleanupWorktreeProcesses(directory)).pids);
    rmSync(directory, { recursive: true, force: true });
  }
  return pids;
}

async function main() {
  const base = join(tmpdir(), 'helm-test-runs');
  mkdirSync(base, { recursive: true });
  const stale = await sweepStaleRuns(base);
  if (stale.length) console.error(`已结束上次测试残留的进程：${stale.join(', ')}`);
  const run = await realpath(await mkdtemp(join(base, `${process.pid}-`)));
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const files = readdirSync(directory).filter(name => name.endsWith('.test.js')).map(name => join(directory, name));
  const child = spawn(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit', env: { ...process.env, TMPDIR: run } });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => child.kill(signal));
  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  const left = (await cleanupWorktreeProcesses(run)).pids;
  if (left.length) console.error(`测试结束后仍有残留进程，已结束：${left.join(', ')}`);
  rmSync(run, { recursive: true, force: true });
  process.exitCode = code ?? (signal ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
