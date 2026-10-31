import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FakeDriver, type FakeContext, type FakeStep } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { configureTestAgent, copyAgents, startTestHelmd } from './helmd-fixture.js';

test('调度者上下文小时续跑上一轮会话并只收变化；压缩、Agent 改动或占用过大时新开', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-resume-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
  const agentDir = await copyAgents(directory);
  const rounds: { resumeSessionId?: string; brief: StartupBrief }[] = [];
  const round = (...tail: FakeStep[]) => (context: FakeContext): FakeStep[] => {
    const brief = JSON.parse(context.input) as StartupBrief;
    rounds.push({ resumeSessionId: context.options.resumeSessionId, brief });
    return [{ type: 'tool', name: 'write-coordinator-notes', arguments: { workId: brief.work.id, body: `第 ${rounds.length} 轮笔记` } }, ...tail];
  };
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir, driver: new FakeDriver([
    round(small),
    round({ type: 'compaction' }, small),
    round(small),
    round({ type: 'end', reason: 'completed', context: { tokens: 160_000, window: 1_000_000 } }),
    round(small),
  ]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => (await (await fetch(`${daemon.url}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any).result;
  const ended = async (count: number) => {
    const deadline = Date.now() + 5_000;
    while ((await call('get-events', { workId: work.id }) as any[]).filter(event => event.action === 'round-ended').length < count) {
      assert.ok(Date.now() < deadline, '等待轮次结束超时');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const project = await call('register-project', { path: repo });
  const work = (await call('send-message', { projectId: project.id, body: '开始', key: 'start' })).work;
  await ended(1);
  await call('send-message', { workId: work.id, body: '补充一', key: 'm1' });
  await ended(2);
  await call('send-message', { workId: work.id, body: '补充二', key: 'm2' });
  await ended(3);
  await configureTestAgent(agentDir, 'claude-coordinator', { model: 'opus' });
  await call('send-message', { workId: work.id, body: '补充三', key: 'm3' });
  await ended(4);
  await call('send-message', { workId: work.id, body: '补充四', key: 'm4' });
  await ended(5);

  const [first, resumed, afterCompaction, afterAgentChange, afterLarge] = rounds;
  assert.equal(first!.resumeSessionId, undefined);
  assert.equal(first!.brief.coordinatorNotes, '');
  assert.equal(typeof resumed!.resumeSessionId, 'string');
  const loaded = (await call('get-events', { workId: work.id }) as any[]).filter(event => event.action === 'round-agent-loaded');
  assert.deepEqual(loaded.map(event => event.details.resumed), [false, true, false, false, false]);
  assert.equal(resumed!.brief.resumed, true);
  assert.equal(resumed!.brief.coordinatorNotes, undefined);
  assert.equal(resumed!.brief.workDescription, undefined);
  // The previous round's own writes are already in the resumed session.
  assert.ok(!resumed!.brief.newEvents.some(event => event.action === 'coordinator-notes-written'));
  assert.ok(resumed!.brief.wakeEvents.some(event => event.action === 'message-sent'));
  for (const fresh of [afterCompaction, afterAgentChange, afterLarge]) {
    assert.equal(fresh!.resumeSessionId, undefined);
    assert.equal(fresh!.brief.resumed, undefined);
    assert.match(fresh!.brief.coordinatorNotes!, /^第 \d 轮笔记$/);
  }
});

test('执行阶段规则在确认后的那一轮附上一次，续跑会话不再重复，新会话重新附上', async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-phase-rules-')));
  const repo = join(directory, 'project');
  execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
  await writeFile(join(repo, 'README.md'), 'baseline\n');
  execFileSync('git', ['-C', repo, 'add', 'README.md']);
  execFileSync('git', ['-C', repo, '-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline'], { stdio: 'ignore' });
  const briefs: StartupBrief[] = [];
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const round = (...steps: FakeStep[]) => (context: FakeContext): FakeStep[] => { briefs.push(JSON.parse(context.input)); return steps; };
  const daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir: await copyAgents(directory), driver: new FakeDriver([
    round({ type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      requirements: '网页版游戏', boundary: '只做本地页面', criteria: '可以开始和重开', key: 'draft' }) }, small),
    round(small),
    round(small),
    round({ type: 'compaction' }, small),
    round(small),
  ]) });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => (await (await fetch(`${daemon.url}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any).result;
  const ended = async (count: number) => {
    const deadline = Date.now() + 5_000;
    while ((await call('get-events', { workId: work.id }) as any[]).filter(event => event.action === 'round-ended').length < count) {
      assert.ok(Date.now() < deadline, '等待轮次结束超时');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  const project = await call('register-project', { path: repo });
  const work = (await call('send-message', { projectId: project.id, body: '开始', key: 'start' })).work;
  await ended(1);
  const gate = (await call('list-pending')).find((item: any) => item.kind === 'work-confirmation');
  await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
  await ended(2);
  for (const [index, key] of ['m1', 'm2', 'm3'].entries()) {
    await call('send-message', { workId: work.id, body: '补充', key });
    await ended(3 + index);
  }

  const executing = await readFile(join(directory, 'data', 'prompts', 'coordinator-executing.md'), 'utf8');
  assert.deepEqual(briefs.map(brief => brief.resumed ?? false), [false, true, true, true, false]);
  // Aligning gets none; the resumed round after confirmation gets them once; a fresh session after compaction gets them again.
  assert.deepEqual(briefs.map(brief => brief.phaseRules), [undefined, executing, undefined, undefined, executing]);
});
