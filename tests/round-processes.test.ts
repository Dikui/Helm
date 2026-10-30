import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { AgentCatalog } from '../src/agents.js';
import type { Driver, EndReason } from '../src/driver.js';
import { processStartTime } from '../src/processes.js';
import { reconcileStartup } from '../src/reconcile.js';
import { RoundScheduler } from '../src/rounds.js';
import { TaskStore } from '../src/store.js';
import { fixtureAgentDir } from './helmd-fixture.js';
import { until } from './ui-fixture.js';
import { testProcessWatchdog } from './fixtures/test-process.js';

function fixture(t: TestContext) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'helm-round-processes-')));
  const project = join(directory, 'project');
  mkdirSync(project);
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-10-30')").run(project);
  store.db.exec("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES ('work', 'project', 'aligning', 'work', '2026-10-30')");
  // Only the ps timestamp query is substituted; discovery and signals use the OS.
  const processTools = join(directory, 'process-tools');
  mkdirSync(processTools);
  writeFileSync(join(processTools, 'ps'), `#!${process.execPath}\nconsole.log('test-start-' + process.argv[3]);\n`, { mode: 0o755 });
  const previousPath = process.env.PATH;
  process.env.PATH = `${processTools}:${previousPath ?? ''}`;
  const children: ChildProcess[] = [];
  let scheduler: RoundScheduler | undefined;
  t.after(async () => {
    await scheduler?.close();
    for (const child of children) if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      process.kill(-child.pid!, 'SIGKILL');
      await exited;
    }
    store.close();
    if (previousPath === undefined) delete process.env.PATH; else process.env.PATH = previousPath;
    rmSync(directory, { recursive: true, force: true });
  });
  const child = async () => {
    const value = spawn(process.execPath, ['-e', testProcessWatchdog()], { cwd: project, detached: true, stdio: 'ignore' });
    children.push(value);
    await once(value, 'spawn');
    return value;
  };
  return { store, project, child, startRounds(driver: Driver) {
    scheduler = new RoundScheduler(store, { 'claude-sdk': driver }, 'http://unused.invalid/mcp', [60_000, 120_000]);
    return scheduler;
  } };
}

for (const outcome of ['completed', 'quota-exhausted', 'error', 'timed-out', 'aborted'] as const) {
  test(`项目目录调度轮次 ${outcome} 时按本轮进程组清理，记录 OS 启动时间且保留用户进程`, async t => {
    const ctx = fixture(t);
    const outside = await ctx.child();
    let managed: ChildProcess | undefined;
    const driver: Driver = {
      async checkAvailability() { return { available: true }; },
      async start(options) {
        assert.equal(options.cwd, ctx.project);
        managed = await ctx.child();
        // Drivers report the OS start time themselves; the round layer records it unchanged.
        options.onProcess?.({ pid: managed.pid!, pgid: managed.pid!, startedAt: processStartTime(managed.pid!)! });
        return { id: 'test-session', async send() {}, cancel() {}, events: (async function* () {
          if (outcome === 'timed-out' || outcome === 'aborted') await new Promise<void>(resolve => options.signal!.addEventListener('abort', () => resolve(), { once: true }));
          else yield { type: 'end' as const, step: 1, reason: outcome as EndReason, usage: { inputTokens: 1, outputTokens: 1 } };
        })() };
      },
    };
    ctx.store.db.exec('UPDATE settings SET round_total_timeout_ms = 1000, round_idle_timeout_ms = 1000 WHERE id = 1');
    const wake = ctx.store.transaction(() => ctx.store.appendEvent({ type: 'user', id: 'user' }, { type: 'work', id: 'work' }, 'message-sent', {}, { workId: 'work' }));
    ctx.store.db.prepare("INSERT INTO wake_queue (event_id, work_id) VALUES (?, 'work')").run(wake.id);
    const rounds = ctx.startRounds(driver);
    await until(async () => ctx.store.events({ workId: 'work' }), events => events.some(event => event.action === 'process-started'));
    if (outcome === 'aborted') await rounds.close();
    const events = await until(async () => ctx.store.events({ workId: 'work' }), events => events.some(event => event.action === 'round-ended'));
    assert.equal((events.find(event => event.action === 'round-ended')!.details as { reason: string }).reason, outcome);
    const started = events.find(event => event.action === 'process-started')!;
    const timestamp = processStartTime(managed!.pid!);
    assert.equal((started.details as { startedAt: string }).startedAt, timestamp);
    assert.equal(ctx.store.db.prepare('SELECT process_started_at FROM coordinator_rounds WHERE id = ?').get(started.object.id)!.process_started_at, timestamp);
    assert.throws(() => process.kill(managed!.pid!, 0), { code: 'ESRCH' });
    assert.doesNotThrow(() => process.kill(outside.pid!, 0));
    assert.ok((events.find(event => event.action === 'round-processes-cleaned')!.details as { pids: number[] }).pids.includes(managed!.pid!));
  });
}

for (const matchesTimestamp of [true, false]) test(`启动对账${matchesTimestamp ? '清理遗留调度者' : '拒绝清理启动时间不匹配的 PID'}，保留项目内其他进程`, async t => {
  const ctx = fixture(t);
  const managed = await ctx.child(), outside = await ctx.child();
  const timestamp = matchesTimestamp ? processStartTime(managed.pid!)! : 'different-process';
  ctx.store.db.prepare(`INSERT INTO coordinator_rounds (id, work_id, status, started_at, event_ids, output_path, pgid, process_started_at)
    VALUES ('old-round', 'work', 'running', '2026-10-30', '[]', '', ?, ?)`).run(managed.pid!, timestamp);
  await reconcileStartup(ctx.store);
  assert.equal(ctx.store.db.prepare("SELECT status, reason FROM coordinator_rounds WHERE id = 'old-round'").get()!.reason, 'aborted');
  if (matchesTimestamp) {
    assert.throws(() => process.kill(managed.pid!, 0), { code: 'ESRCH' });
    assert.ok(ctx.store.events({ workId: 'work' }).some(event => event.action === 'round-processes-cleaned' && (event.details as { pgid: number }).pgid === managed.pid));
  } else assert.doesNotThrow(() => process.kill(managed.pid!, 0));
  assert.doesNotThrow(() => process.kill(outside.pid!, 0));
});
