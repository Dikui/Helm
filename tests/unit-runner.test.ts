import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync } from 'node:fs';
import { mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { processTargetExists, signalProcess } from '../src/processes.js';
import { sweepStaleRuns } from './unit-runner.js';

test('测试入口只结束所属运行已退出的残留进程，并删除其临时目录', async t => {
  const base = await realpath(await mkdtemp(join(tmpdir(), 'helm-runs-')));
  const exited = spawn(process.execPath, ['-e', '']);
  await once(exited, 'exit');
  const stale = join(base, `${exited.pid}-a`);
  const live = join(base, `${process.pid}-b`);
  mkdirSync(stale);
  mkdirSync(live);
  const start = (cwd: string) => spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { cwd, detached: true, stdio: 'ignore' });
  const leftover = start(stale);
  const concurrent = start(live);
  t.after(() => signalProcess(-concurrent.pid!, 'SIGKILL'));
  assert.deepEqual(await sweepStaleRuns(base), [leftover.pid]);
  assert.equal(await processTargetExists(leftover.pid!), false);
  assert.equal(existsSync(stale), false);
  assert.equal(await processTargetExists(concurrent.pid!), true);
  assert.equal(existsSync(live), true);
});
