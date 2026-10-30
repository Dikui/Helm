import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { testProcessWatchdog } from './fixtures/test-process.js';

test('独立进程组替身在启动它的测试进程被 SIGKILL 后自行退出', { timeout: 10_000 }, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-orphan-double-')));
  let doublePid = 0;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `
    import { spawn } from 'node:child_process';
    import { testProcessWatchdog } from ${JSON.stringify(new URL('./fixtures/test-process.js', import.meta.url).href)};
    ${testProcessWatchdog()}
    spawn(process.execPath, ['-e', testProcessWatchdog() +
      "process.on('SIGTERM', () => {}); console.log(process.pid);"], {
      detached: true, stdio: ['ignore', 'inherit', 'inherit'],
    });
  `], { cwd: directory, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(async () => {
    // Fallback only; successful assertions happen before teardown can kill it.
    for (const pid of [owner.pid, doublePid]) if (pid) {
      try { process.kill(-pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    await rm(directory, { recursive: true, force: true });
  });
  const [output] = await once(owner.stdout!, 'data');
  doublePid = Number(String(output).trim());
  assert.ok(Number.isInteger(doublePid) && doublePid > 1);
  // Survive a watchdog tick while the owner is alive.
  await delay(1200);
  assert.doesNotThrow(() => process.kill(doublePid, 0));
  const exited = once(owner, 'exit');
  owner.kill('SIGKILL');
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  const deadline = Date.now() + 4000;
  for (;;) {
    try { process.kill(doublePid, 0); }
    catch (error) {
      assert.equal((error as NodeJS.ErrnoException).code, 'ESRCH');
      break;
    }
    assert.ok(Date.now() < deadline, `替身 ${doublePid} 未在四秒内自行退出`);
    await delay(50);
  }
});
