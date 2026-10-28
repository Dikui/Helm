import assert from 'node:assert/strict';
import { execFileSync, fork, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test, type TestContext } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startTestHelmd as startHelmd } from './helmd-fixture.js';

const git = (path: string, ...args: string[]) => execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const identity = ['-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid'];

async function until<T>(read: () => Promise<T>, ready: (value: T) => boolean, timeout = 15_000): Promise<T> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (ready(value)) return value;
    assert.ok(Date.now() < deadline, '等待启动对账超时');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

async function fixture(t: TestContext, purpose = 'running') {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-reconcile-')));
  const repo = join(directory, 'project');
  const dataDir = join(directory, 'data');
  const remote = join(directory, 'remote.git');
  // ps is denied by the development sandbox. Substitute only its timestamp
  // query; process discovery, signals and git operations still use the real OS.
  const processTools = join(directory, 'process-tools');
  await mkdir(processTools);
  await writeFile(join(processTools, 'ps'), `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const path = join(${JSON.stringify(processTools)}, process.argv[3]);
if (!existsSync(path)) writeFileSync(path, new Date().toISOString());
console.log(readFileSync(path, 'utf8'));
`, { mode: 0o755 });
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  await writeFile(join(repo, 'baseline.txt'), 'baseline\n');
  git(repo, 'add', 'baseline.txt');
  git(repo, ...identity, 'commit', '-m', 'baseline');
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-u', 'origin', 'main');
  let child: ChildProcess;
  const daemonGroups: number[] = [];
  let url = '';
  let token = '';
  let output = '';
  const start = async () => {
    url = ''; token = ''; output = '';
    child = fork(new URL('./fixtures/reconcile-daemon.js', import.meta.url), [dataDir, purpose], {
      detached: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, PATH: `${processTools}:${process.env.PATH}` },
    });
    daemonGroups.push(child.pid!);
    child.stdout!.on('data', chunk => { output += chunk; });
    child.stderr!.on('data', chunk => { output += chunk; });
    child.on('message', (message: any) => {
      if (message.type === 'ready') url = message.url;
      if (message.type === 'round') token = message.token;
    });
    await until(async () => {
      assert.equal(child.exitCode, null, output);
      return url;
    }, Boolean);
  };
  const stop = async (graceful = false) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const ended = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (graceful) child.send('close');
    else child.kill('SIGKILL');
    await ended;
  };
  t.after(async () => {
    await stop(true);
    for (const pgid of daemonGroups) { try { process.kill(-pgid, 'SIGKILL'); } catch {} }
    await rm(directory, { recursive: true, force: true });
  });
  await start();
  const call = async (name: string, params: object = {}) => {
    const response = await fetch(`${url}/api/${name}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
    const body: any = await response.json();
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const tool = async (name: string, args: Record<string, unknown>) => {
    const client = new Client({ name: 'reconcile-fake-coordinator', version: '1' });
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers: { Authorization: token } } }));
      const result: any = (await client.callTool({ name, arguments: args })).structuredContent;
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.result;
    } finally { await client.close(); }
  };
  const project = await call('register-project', { path: repo });
  const { work } = await call('send-message', { projectId: project.id, key: 'start', body: '实现恢复' });
  const scope = { workId: work.id };
  const events = (): Promise<any[]> => call('get-events', scope);
  await until(events, values => values.some(event => event.action === 'round-ended'));
  const gate = (await call('list-pending'))[0];
  token = '';
  await call('decide-gate', { ...scope, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  await until(async () => token, Boolean);
  const currentWork = await call('get-work', scope);
  const create = async (key = 'card', needsBrowser = false) => {
    const card = await tool('create-card', { ...scope, key, content: key, needsVerification: purpose === 'verification' });
    const dispatch = await tool('create-dispatch', { ...scope, cardId: card.id, key: `dispatch-${key}`, agentId: 'claude-executor', needsBrowser,
      purpose: purpose === 'verification' ? 'verification' : 'execution' });
    return { card, dispatch, read: () => call('get-dispatch', { ...scope, dispatchId: dispatch.id }) };
  };
  const restart = async () => { await stop(); await start(); };
  return { directory, repo, dataDir, remote, processTools, work: currentWork, scope, call, tool, events, create, start, stop, restart, get url() { return url; },
    waitRound: () => until(async () => token, Boolean) };
}

test('崩溃后先清进程，再补交执行派单；轮次重投且不自动重派', async t => {
  const daemon = await fixture(t);
  const { dispatch, read } = await daemon.create('card', true);
  const running = await until(read, value => value.conclusion === 'completed');
  t.after(() => { try { process.kill(-running.browserPgid, 'SIGKILL'); } catch {} });
  const browserChild = Number(await readFile(join(daemon.dataDir, 'dispatches', dispatch.id, 'browser', 'descendant.pid'), 'utf8'));
  const before = await daemon.events();
  const oldRound = before.filter(event => event.action === 'round-started').at(-1);
  const path = join(daemon.dataDir, 'worktrees', daemon.work.id, dispatch.cardId);
  const writer = spawn(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.on('SIGTERM', () => { fs.writeFileSync('terminated.txt', 'saved before commit'); process.exit(0); });
    console.log('ready'); setInterval(() => {}, 1000);
  `], { cwd: path, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  t.after(() => { try { process.kill(-writer.pid!, 'SIGKILL'); } catch {} });
  await new Promise<void>(resolve => writer.stdout!.once('data', () => resolve()));
  await writeFile(git(path, 'rev-parse', '--git-path', 'index.lock'), 'stale');
  await daemon.restart();
  const ended = await read();
  assert.equal(ended.status, 'ended');
  assert.equal(ended.endReason, 'aborted');
  assert.equal(ended.abortReason, '运行层重启');
  assert.equal(ended.finalAnswer, null);
  assert.equal(ended.conclusion, 'undeclared');
  assert.equal(git(path, 'status', '--porcelain'), '');
  assert.match(git(path, 'log', '-1', '--format=%B'), /aborted.*运行层重启/);
  assert.equal(await readFile(join(path, 'progress.txt'), 'utf8'), 'saved progress\n');
  assert.equal(git(path, 'show', 'HEAD:terminated.txt'), 'saved before commit');
  assert.notEqual(ended.endCommit, ended.startCommit);
  assert.throws(() => process.kill(browserChild, 0), { code: 'ESRCH' });
  const events = await until(daemon.events, values => values.filter(event => event.action === 'round-started').length === 3);
  const interrupted = events.find(event => event.action === 'round-ended' && event.object.id === oldRound.object.id);
  assert.equal(interrupted.details.abortReason, '运行层重启');
  const replay = events.filter(event => event.action === 'round-started').at(-1);
  assert.ok(oldRound.details.eventIds.every((id: number) => replay.details.eventIds.includes(id)));
  assert.equal((await daemon.call('list-dispatches', daemon.scope)).length, 1);
  assert.equal((await daemon.call('get-settings')).runningDispatches, 0);
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'executing');
  assert.equal(running.portStart, 20000);
  await daemon.waitRound();
  const next = await daemon.create('next');
  assert.equal((await until(next.read, value => value.status === 'running')).portStart, 20000);
});

async function blockingHook(daemon: Awaited<ReturnType<typeof fixture>>, name: string) {
  const hooks = join(daemon.directory, 'hooks');
  const block = join(daemon.directory, 'block');
  const marker = join(daemon.directory, 'hook-entered');
  await mkdir(hooks, { recursive: true });
  await writeFile(block, 'block');
  // Keep the blocked subprocess in _work, where startup process cleanup finds it.
  await writeFile(join(hooks, name), `#!/bin/sh
cd '${name === 'pre-push' ? join(daemon.work.workPath, '..') : daemon.work.workPath}' || exit 1
echo reached > '${marker}'
while [ -f '${block}' ]; do sleep 0.1; done
`, { mode: 0o755 });
  git(daemon.repo, 'config', 'core.hooksPath', hooks);
  return { block, wait: () => until(async () => existsSync(marker), Boolean) };
}

test('标记完成在 _work 合并中崩溃，重启 abort 后可重试标记完成', async t => {
  const daemon = await fixture(t, 'settled');
  const { card, dispatch, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  const hook = await blockingHook(daemon, 'pre-merge-commit');
  const completion = daemon.tool('complete-card', { ...daemon.scope, cardId: card.id }).catch(error => error);
  await hook.wait();
  await daemon.restart();
  await completion;
  await daemon.waitRound();
  assert.equal(git(daemon.work.workPath, 'status', '--porcelain'), '');
  assert.equal(existsSync(git(daemon.work.workPath, 'rev-parse', '--git-path', 'MERGE_HEAD')), false);
  assert.notEqual((await daemon.call('get-card', { ...daemon.scope, cardId: card.id })).status, 'completed');
  assert.ok((await daemon.events()).some(event => event.action === 'work-merge-aborted'));
  await rm(hook.block);
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  assert.equal((await daemon.call('get-card', { ...daemon.scope, cardId: card.id })).status, 'completed');
  assert.equal(existsSync(join(daemon.dataDir, 'worktrees', daemon.work.id, dispatch.cardId)), false);
});

test('合入中崩溃，重启只恢复合入并停在待推送', async t => {
  const daemon = await fixture(t, 'settled');
  const { card, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  const gate = await daemon.tool('request-review', { ...daemon.scope, key: 'review', body: '检查成果' });
  const hook = await blockingHook(daemon, 'pre-merge-commit');
  await writeFile(join(daemon.repo, 'baseline.txt'), 'unrelated user edit\n');
  await daemon.call('decide-gate', { ...daemon.scope, gateId: gate.id, decision: 'accept' });
  const accepting = daemon.call('merge-work', daemon.scope).catch(error => error);
  await hook.wait();
  await daemon.stop();
  await accepting;
  // The old git subprocess is still blocked; recovery must stop it before abort.
  // Disable this hook for the retry while leaving the running hook blocked.
  await rm(join(daemon.directory, 'hooks', 'pre-merge-commit'));
  await daemon.start();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'merged');
  await daemon.call('push-work', daemon.scope);
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'completed');
  assert.equal(git(daemon.repo, 'status', '--porcelain'), 'M baseline.txt');
  assert.equal(await readFile(join(daemon.repo, 'baseline.txt'), 'utf8'), 'unrelated user edit\n');
  assert.equal(existsSync(resolve(daemon.repo, git(daemon.repo, 'rev-parse', '--git-path', 'MERGE_HEAD'))), false);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), git(daemon.repo, 'rev-parse', 'main'));
  const events = await daemon.events();
  assert.ok(events.some(event => event.action === 'base-merge-aborted'));
  assert.equal(events.filter(event => event.action === 'base-merge-result').length, 1);
  assert.equal(events.filter(event => event.action === 'base-push-result').length, 1);
  assert.equal(existsSync(daemon.work.workPath), false);
});

for (const interruptedAt of ['post-merge', 'pre-push']) test(`独立合入或推送在 ${interruptedAt} 中断，重启跳过已有合并，重复启动不重复记结果`, async t => {
  const daemon = await fixture(t, 'settled');
  const { card, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  const gate = await daemon.tool('request-review', { ...daemon.scope, key: 'review', body: '检查成果' });
  const baseline = git(daemon.remote, 'rev-parse', 'main');
  const hook = await blockingHook(daemon, interruptedAt);
  await daemon.call('decide-gate', { ...daemon.scope, gateId: gate.id, decision: 'accept' });
  if (interruptedAt === 'pre-push') await daemon.call('merge-work', daemon.scope);
  const accepting = daemon.call(interruptedAt === 'post-merge' ? 'merge-work' : 'push-work', daemon.scope).catch(error => error);
  await hook.wait();
  const merged = git(daemon.repo, 'rev-parse', 'main');
  assert.notEqual(merged, baseline);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), baseline);
  await daemon.stop();
  await accepting;
  await rm(join(daemon.directory, 'hooks', interruptedAt));
  await daemon.start();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, interruptedAt === 'post-merge' ? 'merged' : 'completed');
  if (interruptedAt === 'post-merge') {
    assert.equal(git(daemon.remote, 'rev-parse', 'main'), baseline);
    await daemon.call('push-work', daemon.scope);
  }
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), merged);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), merged);
  const events = await daemon.events();
  assert.equal(events.filter(event => event.action === 'base-merge-result').length, 1);
  assert.equal(events.find(event => event.action === 'base-merge-result').details.status, interruptedAt === 'post-merge' ? 'already-contained' : 'merged');
  assert.equal(events.filter(event => event.action === 'base-push-result').length, 1);
  await daemon.restart();
  assert.equal((await daemon.events()).filter(event => event.action === 'work-completed').length, 1);
});

test('重启先恢复正在合入的工作，再按请求顺序恢复队列，不按工作创建顺序合入', async t => {
  const daemon = await fixture(t, 'delivery');
  const second = (await daemon.call('send-message', { projectId: daemon.work.projectId, key: 'second', body: '第二项工作' })).work;
  const descriptions = await until(async () => await daemon.call('get-work-descriptions', { workId: second.id }) as any[], values => values.length > 0);
  const description = descriptions[0];
  await daemon.call('decide-gate', { workId: second.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
  const pending = await until(async () => await daemon.call('list-pending') as any[], values => values.filter(gate => gate.kind === 'review').length === 2);
  const works = [daemon.work, await daemon.call('get-work', { workId: second.id })];
  for (const [index, work] of works.entries()) {
    await writeFile(join(work.workPath, `result-${index}.txt`), `work ${index}\n`);
    git(work.workPath, 'add', `result-${index}.txt`);
    git(work.workPath, ...identity, 'commit', '-m', `work ${index}`);
    await daemon.call('decide-gate', { workId: work.id, gateId: pending.find(gate => gate.workId === work.id).id, decision: 'accept' });
  }
  const hook = await blockingHook(daemon, 'pre-merge-commit');
  const active = daemon.call('merge-work', { workId: second.id }).catch(error => error);
  await hook.wait();
  const queued = daemon.call('merge-work', daemon.scope).catch(error => error);
  await until(async () => (await daemon.call('get-work', daemon.scope)).status, status => status === 'merge-queued');
  await daemon.stop();
  await Promise.all([active, queued]);
  await rm(join(daemon.directory, 'hooks', 'pre-merge-commit'));
  await daemon.start();
  const firstAfter = await daemon.call('get-work', daemon.scope);
  const secondAfter = await daemon.call('get-work', { workId: second.id });
  assert.equal(firstAfter.status, 'merged');
  assert.equal(secondAfter.status, 'merged');
  assert.equal(git(daemon.repo, 'rev-parse', 'main^1'), secondAfter.delivery.merge.commit);
  assert.equal(git(daemon.repo, 'show', 'main:result-0.txt'), 'work 0');
  assert.equal(git(daemon.repo, 'show', 'main:result-1.txt'), 'work 1');
});

test('重启保留已接受、已合入和推送失败的阶段，只有显式操作才继续', async t => {
  const daemon = await fixture(t, 'settled');
  const { card, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  const gate = await daemon.tool('request-review', { ...daemon.scope, key: 'review', body: '检查成果' });
  const baseline = git(daemon.repo, 'rev-parse', 'main');
  await daemon.call('decide-gate', { ...daemon.scope, gateId: gate.id, decision: 'accept' });
  await daemon.restart();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'accepted');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), baseline);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), baseline);
  assert.equal(existsSync(daemon.work.workPath), true);
  await daemon.call('merge-work', daemon.scope);
  const merged = git(daemon.repo, 'rev-parse', 'main');
  await daemon.restart();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'merged');
  assert.equal(git(daemon.repo, 'rev-parse', 'main'), merged);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), baseline);
  const hook = join(daemon.remote, 'hooks', 'pre-receive');
  await writeFile(hook, '#!/bin/sh\necho retry-me >&2\nexit 1\n', { mode: 0o755 });
  await daemon.call('push-work', daemon.scope);
  await rm(hook);
  await daemon.restart();
  const failed = await daemon.call('get-work', daemon.scope);
  assert.equal(failed.status, 'merged');
  assert.match(failed.delivery.push.reason, /retry-me/);
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), baseline);
  await daemon.call('push-work', daemon.scope);
  await daemon.restart();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'completed');
  assert.equal(git(daemon.remote, 'rev-parse', 'main'), merged);
  assert.equal((await daemon.events()).filter(event => event.action === 'base-merge-result').length, 1);
  assert.equal((await daemon.events()).filter(event => event.action === 'base-push-result').length, 2);
  assert.equal((await daemon.events()).filter(event => event.action === 'work-completed').length, 1);
});

test('监听端口被占用时启动失败，不对正在运行的 helmd 做对账', async t => {
  const daemon = await fixture(t);
  const active = await daemon.create();
  await until(active.read, value => value.conclusion === 'completed');
  await assert.rejects(startHelmd({ port: Number(new URL(daemon.url).port), dataDir: daemon.dataDir }), { code: 'EADDRINUSE' });
  assert.equal((await active.read()).status, 'running');
  assert.equal((await daemon.events()).filter(event => event.action === 'dispatch-ended').length, 0);
});

test('用户自己发起、同样指向工作分支的合并在重启时保留', async t => {
  const daemon = await fixture(t, 'settled');
  const { card, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  const gate = await daemon.tool('request-review', { ...daemon.scope, key: 'review', body: '检查成果' });
  git(daemon.repo, ...identity, 'merge', '--no-ff', '--no-commit', daemon.work.workBranch);
  const mergeHead = resolve(daemon.repo, git(daemon.repo, 'rev-parse', '--git-path', 'MERGE_HEAD'));
  const target = await readFile(mergeHead, 'utf8');
  await daemon.call('decide-gate', { ...daemon.scope, gateId: gate.id, decision: 'accept' });
  await daemon.restart();
  assert.equal(await readFile(mergeHead, 'utf8'), target);
  assert.equal((await daemon.events()).some(event => event.action === 'base-merge-aborted'), false);
});

test('终态卡片和已结束工作的残留副本与卡片分支在重启时补删，工作分支保留', async t => {
  const daemon = await fixture(t, 'settled');
  const { card, dispatch, read } = await daemon.create();
  const ended = await until(read, value => value.status === 'ended');
  const cardPath = join(daemon.dataDir, 'worktrees', daemon.work.id, dispatch.cardId);
  const cardBranch = git(cardPath, 'symbolic-ref', '--short', 'HEAD');
  await daemon.tool('complete-card', { ...daemon.scope, cardId: card.id });
  const gate = await daemon.tool('request-review', { ...daemon.scope, key: 'review', body: '检查成果' });
  await daemon.call('decide-gate', { ...daemon.scope, gateId: gate.id, decision: 'accept' });
  await daemon.call('merge-work', daemon.scope);
  await daemon.call('push-work', daemon.scope);
  // Recreate the external resources left by a crash before worktree removal.
  git(daemon.repo, 'branch', cardBranch, ended.endCommit);
  git(daemon.repo, 'worktree', 'add', cardPath, cardBranch);
  git(daemon.repo, 'worktree', 'add', daemon.work.workPath, daemon.work.workBranch);
  await daemon.restart();
  assert.equal(existsSync(cardPath), false);
  assert.equal(existsSync(daemon.work.workPath), false);
  assert.equal(git(daemon.repo, 'for-each-ref', '--format=%(refname)', `refs/heads/${cardBranch}`), '');
  assert.ok(git(daemon.repo, 'rev-parse', daemon.work.workBranch));
  assert.equal((await daemon.call('get-card', { ...daemon.scope, cardId: card.id })).status, 'completed');
});

test('崩溃中的验收派单和残留的验收副本在重启时删除，卡片副本和分支不变', async t => {
  const daemon = await fixture(t, 'verification');
  const { dispatch, read } = await daemon.create();
  const running = await until(read, value => value.conclusion === 'passed');
  const copies = join(daemon.dataDir, 'worktrees', daemon.work.id, 'verifications');
  const path = join(copies, dispatch.id);
  assert.equal(await readFile(join(path, 'progress.txt'), 'utf8'), 'saved progress\n');
  await writeFile(join(path, 'baseline.txt'), 'verifier changed this');
  const orphan = join(copies, 'orphan');
  git(daemon.repo, 'worktree', 'add', '--detach', orphan, running.startCommit);
  await daemon.restart();
  const ended = await read();
  assert.equal(ended.endReason, 'aborted');
  assert.equal(ended.abortReason, '运行层重启');
  assert.equal(ended.conclusion, 'undeclared');
  assert.equal(ended.endCommit, running.startCommit);
  assert.equal(existsSync(copies), false);
  assert.ok(!git(daemon.repo, 'worktree', 'list', '--porcelain').includes(copies));
  const cardPath = join(daemon.dataDir, 'worktrees', daemon.work.id, dispatch.cardId);
  assert.match(git(cardPath, 'symbolic-ref', '--short', 'HEAD'), /^helm-card\//);
  assert.equal(git(cardPath, 'rev-parse', 'HEAD'), running.startCommit);
  assert.equal(git(cardPath, 'status', '--porcelain'), '');
});

test('重启保留排队派单的身份，在回收的并发与端口段上启动它', async t => {
  const daemon = await fixture(t);
  await daemon.call('set-concurrency', { limit: 1 });
  const first = await daemon.create('first');
  await until(first.read, value => value.conclusion === 'completed');
  const second = await daemon.create('second');
  assert.equal((await second.read()).status, 'queued');
  await daemon.restart();
  const running = await until(second.read, value => value.status === 'running');
  assert.equal(running.id, second.dispatch.id);
  assert.equal(running.portStart, 20000);
  const events = await daemon.events();
  assert.equal(events.filter(event => event.action === 'dispatch-started' && event.dispatchId === second.dispatch.id).length, 1);
  assert.equal(events.filter(event => event.action === 'dispatch-ended' && event.dispatchId === second.dispatch.id).length, 0);
  assert.equal((await first.read()).abortReason, '运行层重启');
});

test('已暂停的工作重启后仍暂停，自动唤醒留到用户恢复时投递', async t => {
  const daemon = await fixture(t);
  await daemon.call('pause-work', daemon.scope);
  const before = await daemon.events();
  await daemon.restart();
  assert.equal((await daemon.call('get-work', daemon.scope)).status, 'paused');
  assert.equal((await daemon.events()).filter(event => event.action === 'round-started').length,
    before.filter(event => event.action === 'round-started').length);
  await daemon.call('resume-work', daemon.scope);
  await daemon.waitRound();
  const events = await daemon.events();
  const latest = events.filter(event => event.action === 'round-started').at(-1);
  assert.ok(latest.details.eventIds.includes(before.find(event => event.action === 'work-paused').id));
});

test('浏览器进程启动时间不匹配时不杀该进程组', async t => {
  const daemon = await fixture(t);
  const active = await daemon.create('card', true);
  const running = await until(active.read, value => value.conclusion === 'completed');
  t.after(() => { try { process.kill(-running.browserPgid, 'SIGKILL'); } catch {} });
  await writeFile(join(daemon.processTools, String(running.browserPgid)), 'a different process start time');
  await daemon.restart();
  assert.doesNotThrow(() => process.kill(running.browserPgid, 0));
  assert.equal((await active.read()).endReason, 'aborted');
});

test('崩溃中断轮次不增加也不清零连续失败次数', async t => {
  const daemon = await fixture(t, 'failures');
  const before = await until(daemon.events, values => values.filter(event => event.action === 'round-started').length === 4);
  assert.equal(before.filter(event => event.action === 'round-ended' && event.details.reason === 'error').length, 2);
  await writeFile(join(daemon.dataDir, 'fail-round'), 'error on next round');
  await daemon.restart();
  const events = await until(daemon.events, values => values.some(event => event.action === 'work-paused'));
  assert.deepEqual(events.filter(event => event.action === 'round-ended').map(event => event.details.reason),
    ['completed', 'error', 'error', 'aborted', 'error']);
  assert.match((await daemon.call('get-work', daemon.scope)).runtimePauseReason, /连续失败 3 次/);
});

test('正常停止的执行派单同样记录运行层重启，重启不重复提交或记结束事件', async t => {
  const daemon = await fixture(t);
  const active = await daemon.create();
  await until(active.read, value => value.conclusion === 'completed');
  await daemon.stop(true);
  await daemon.start();
  const ended = await active.read();
  assert.equal(ended.endReason, 'aborted');
  assert.equal(ended.abortReason, '运行层重启');
  const path = join(daemon.dataDir, 'worktrees', daemon.work.id, active.card.id);
  assert.match(git(path, 'log', '-1', '--format=%B'), /aborted.*运行层重启/);
  assert.equal(git(path, 'rev-parse', 'HEAD'), ended.endCommit);
  assert.equal((await daemon.events()).filter(event => event.action === 'dispatch-ended').length, 1);
});

test('_work 已写下 MERGE_HEAD 的半截合并在重启时 abort', async t => {
  const daemon = await fixture(t, 'settled');
  const { dispatch, read } = await daemon.create();
  await until(read, value => value.status === 'ended');
  const cardPath = join(daemon.dataDir, 'worktrees', daemon.work.id, dispatch.cardId);
  git(daemon.work.workPath, ...identity, 'merge', '--no-ff', '--no-commit', git(cardPath, 'symbolic-ref', '--short', 'HEAD'));
  const marker = git(daemon.work.workPath, 'rev-parse', '--git-path', 'MERGE_HEAD');
  assert.equal(existsSync(marker), true);
  await daemon.restart();
  assert.equal(existsSync(marker), false);
  assert.equal(git(daemon.work.workPath, 'status', '--porcelain'), '');
  assert.equal(git(daemon.work.workPath, 'rev-parse', 'HEAD'), daemon.work.baseCommit);
});
