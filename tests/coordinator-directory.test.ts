import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FakeDriver, type SessionOptions } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { existingWorkCopy, fixtureAgentDir, startTestHelmd } from './helmd-fixture.js';
import { until } from './claude-coordinator-fixture.js';
import { uiFixture } from './ui-fixture.js';
import { reviewReport } from './fixtures/review-report.js';
import { AgentCatalog } from '../src/agents.js';
import { TaskStore } from '../src/store.js';
import { reconcileStartup } from '../src/reconcile.js';

test('调度轮次在首轮前创建自己的可写目录，各轮复用并在项目副本出现后继续续跑', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-coordinator-directory-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'AGENTS.md'), '项目规则\n');
  execFileSync('git', ['-C', repo, 'add', 'AGENTS.md']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
  const rounds: { options: SessionOptions; brief: StartupBrief }[] = [];
  const fake = new FakeDriver();
  const daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), driver: {
    capabilities: fake.capabilities,
    async start(options) {
      assert.ok(existsSync(options.cwd), '驱动启动前目录已创建');
      const session = await fake.start(options);
      return { ...session, async send(input) {
        rounds.push({ options, brief: JSON.parse(input) });
        await session.send(input);
      }, events: (async function* () {
        for await (const event of session.events) yield event.type === 'end'
          ? { ...event, context: { tokens: 20_000, window: 1_000_000 } } : event;
      })() };
    },
  } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => {
    const body = await (await fetch(`${daemon.url}/api/${name}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any;
    assert.equal(body.ok, true, JSON.stringify(body));
    return body.result;
  };
  const project = await call('register-project', { path: repo });
  const work = (await call('send-message', { projectId: project.id, key: 'start', body: '开始' })).work;
  const ended = (count: number) => until(() => call('get-events', { workId: work.id }),
    events => events.filter((event: any) => event.action === 'round-ended').length >= count);
  await ended(1);
  const cwd = join(directory, 'data', 'coordinator', work.id);
  assert.equal(rounds[0]!.options.cwd, cwd);
  assert.deepEqual(rounds[0]!.options.sandbox, { mode: 'workspace-write', writableRoots: [cwd] });
  assert.equal(rounds[0]!.brief.projectPath, repo);
  assert.deepEqual(rounds[0]!.brief.projectInstructionPaths, [join(repo, 'AGENTS.md')]);
  await writeFile(join(cwd, 'notes.txt'), '跨轮文件\n');
  const copy = existingWorkCopy(join(directory, 'data'), work.id);
  await writeFile(join(copy.workPath!, 'CLAUDE.md'), '副本规则\n');
  await call('send-message', { workId: work.id, key: 'next', body: '继续' });
  await ended(2);
  assert.equal(rounds[1]!.options.cwd, cwd);
  assert.equal(rounds[1]!.brief.resumed, true);
  assert.equal(typeof rounds[1]!.options.resumeSessionId, 'string');
  assert.equal(rounds[1]!.brief.projectPath, copy.workPath);
  assert.deepEqual(rounds[1]!.brief.projectInstructionPaths, [join(copy.workPath!, 'AGENTS.md'), join(copy.workPath!, 'CLAUDE.md')]);
  assert.equal(await readFile(join(cwd, 'notes.txt'), 'utf8'), '跨轮文件\n');
});

for (const outcome of ['completed', 'cancelled'] as const) test(`工作 ${outcome} 后删除调度者目录，删除工作时再次清理残留`, async t => {
  const daemon = await uiFixture([[
    { type: 'write', path: 'notes.txt', content: '调度文件' },
    { type: 'tool', name: 'draft-work-description', arguments: { key: 'draft', requirements: '调研', boundary: '不改代码', criteria: '报告' } },
  ], [
    { type: 'tool', name: 'request-review', arguments: { key: 'review', report: reviewReport('调研完成') },
      check: value => assert.equal((value as any).ok, true) },
  ]]);
  t.after(() => daemon.close());
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '开始' })).result.work;
  const params = { workId: work.id };
  const ended = (count: number) => until(() => daemon.call('list-rounds', params),
    value => value.result.rounds.filter((round: any) => round.status === 'ended').length >= count);
  await ended(1);
  const cwd = join(daemon.directory, 'data', 'coordinator', work.id);
  assert.equal(await readFile(join(cwd, 'notes.txt'), 'utf8'), '调度文件');
  if (outcome === 'completed') {
    const gate = (await daemon.call('list-pending')).result[0];
    assert.equal((await daemon.call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' })).ok, true);
    await ended(2);
    const review = (await daemon.call('list-pending')).result.find((item: any) => item.kind === 'review');
    assert.equal((await daemon.call('decide-gate', { ...params, gateId: review.id, decision: 'accept' })).ok, true);
  } else assert.equal((await daemon.call('cancel-work', params)).ok, true);
  assert.equal((await daemon.call('get-work', params)).result.status, outcome);
  assert.equal(existsSync(cwd), false);
  assert.deepEqual((await daemon.call('list-work-files', params)).result, []);
  await mkdir(cwd, { recursive: true });
  await writeFile(join(cwd, 'leftover.txt'), '清理中断的残留');
  assert.equal((await daemon.call('delete-work', { ...params, confirm: true })).ok, true);
  assert.equal(existsSync(cwd), false);
});

test('启动对账保留活动工作的调度者目录，清理终态、孤儿与错误位置，重复对账不丢文件', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-coordinator-reconcile-')));
  const store = new TaskStore(join(directory, 'data'), new AgentCatalog(fixtureAgentDir));
  t.after(async () => { store.close(); await rm(directory, { recursive: true, force: true }); });
  const project = join(directory, 'project');
  await mkdir(project);
  store.db.prepare("INSERT INTO projects (id, name, path, created_at) VALUES ('project', '项目', ?, '2026-11-02')").run(project);
  const active = ['aligning', 'executing', 'awaiting-review', 'paused', 'accepted', 'merge-queued', 'merging'];
  const root = join(store.dataDir, 'coordinator');
  for (const status of [...active, 'completed', 'cancelled', 'orphan']) {
    if (status !== 'orphan') store.db.prepare("INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES (?, 'project', ?, ?, '2026-11-02')").run(status, status, status);
    await mkdir(join(root, status), { recursive: true });
    await writeFile(join(root, status, 'notes.txt'), status);
  }
  await writeFile(join(root, 'invalid-file'), '残留');
  for (let run = 0; run < 2; run++) {
    await reconcileStartup(store);
    for (const status of active) assert.equal(await readFile(join(root, status, 'notes.txt'), 'utf8'), status);
    for (const status of ['completed', 'cancelled', 'orphan', 'invalid-file']) assert.equal(existsSync(join(root, status)), false);
  }
});
