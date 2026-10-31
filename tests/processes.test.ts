import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type Socket } from 'node:net';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { cleanupWorktreeProcesses, isAgentPeer } from '../src/processes.js';
import { until } from './ui-fixture.js';
import { testProcessWatchdog } from './fixtures/test-process.js';

// A detached leader in `leaderCwd` whose child runs in `childCwd`; resolves both PIDs.
async function group(leaderCwd: string, childCwd: string) {
  const leader = spawn(process.execPath, ['-e', `
    const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(testProcessWatchdog())}], { cwd: ${JSON.stringify(childCwd)}, stdio: 'ignore' });
    child.once('spawn', () => console.log(child.pid));
    ${testProcessWatchdog()}
  `], { cwd: leaderCwd, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  const child = await new Promise<number>(resolve => leader.stdout!.once('data', chunk => resolve(Number(String(chunk).trim()))));
  return { leader: leader.pid!, child };
}

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('副本清理只杀组长在副本里的整组；组长在副本外（用户编辑器、终端）只杀副本里的那个成员', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-processes-')));
  const copy = join(directory, 'copy');
  const outside = join(directory, 'outside');
  mkdirSync(copy);
  mkdirSync(outside);
  const editor = await group(outside, copy);
  const agent = await group(copy, outside);
  t.after(() => {
    for (const pid of [editor.leader, agent.leader]) try { process.kill(-pid, 'SIGKILL'); } catch { /* Already gone. */ }
    rmSync(directory, { recursive: true, force: true });
  });
  const cleaned = await cleanupWorktreeProcesses(copy);
  assert.ok(cleaned.pids.includes(editor.child));
  assert.deepEqual(cleaned.pgids, [agent.leader]);
  await until(async () => !alive(editor.child) && !alive(agent.leader) && !alive(agent.child), Boolean);
  assert.ok(alive(editor.leader), '副本外的组长不能被牵连');
});

test('危险操作按连接来源识别 Agent：helmd 的后代，或已脱离父进程但当前目录在副本里的进程', async t => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-peer-')));
  const worktrees = join(directory, 'worktrees');
  mkdirSync(join(worktrees, 'card'), { recursive: true });
  const sockets: Socket[] = [];
  const server = createServer(socket => { sockets.push(socket); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  const pids: number[] = [];
  t.after(() => {
    for (const pid of pids) try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone. */ }
    server.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const client = `require('node:net').connect(${port}, '127.0.0.1'); ${testProcessWatchdog()}`;
  // Starts a client and resolves the helmd-side remote port it connected from.
  const connected = async (start: () => Promise<void>) => {
    const count = sockets.length;
    await start();
    return (await until(async () => sockets[count], Boolean))!.remotePort!;
  };
  // This test process stands in for helmd: its detached children are agents, like every driver's;
  // a child left in helmd's own group is helmd's helper (or an embedding test's CLI).
  for (const detached of [true, false]) {
    const port = await connected(async () => { pids.push(spawn(process.execPath, ['-e', client], { cwd: directory, detached, stdio: 'ignore' }).pid!); });
    assert.equal(await isAgentPeer(port, worktrees), detached);
  }
  // An orphan reparented away from helmd counts only when its cwd is in an agent copy.
  for (const [cwd, expected] of [[directory, false], [join(worktrees, 'card'), true]] as const) {
    const port = await connected(async () => {
      const shell = spawn('/bin/sh', ['-c', 'nohup "$1" -e "$2" >/dev/null 2>&1 & echo $!', 'helm-test', process.execPath, client], { cwd });
      let output = '';
      shell.stdout.on('data', chunk => { output += chunk; });
      // Wait for the shell to exit so the client is no longer a descendant.
      await once(shell, 'close');
      pids.push(Number(output.trim()));
    });
    assert.equal(await isAgentPeer(port, worktrees), expected);
  }
});
