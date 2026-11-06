import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test, type TestContext } from 'node:test';
import { FakeDriver, type DriverCapabilities, type FakeContext, type FakeScript, type FakeStep } from '../src/driver.js';
import { writePrompt } from '../src/prompts.js';
import type { StartupBrief } from '../src/rounds.js';
import { configureTestAgent, copyAgents, startTestHelmd } from './helmd-fixture.js';

for (const capabilities of [
  { resume: false, contextUsage: true },
  { resume: false, contextUsage: false },
]) test(`调度者驱动声明 ${JSON.stringify(capabilities)} 时，即使收到较小的上下文也每轮新开`, async t => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-no-resume-')));
  const rounds: { resumeSessionId?: string; brief: StartupBrief }[] = [];
  const round = (context: FakeContext): FakeStep[] => {
    rounds.push({ resumeSessionId: context.options.resumeSessionId, brief: JSON.parse(context.input) });
    return [{ type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } }];
  };
  const driver = Object.assign(new FakeDriver([round, round]), { capabilities: {
    cleanStart: { supported: true }, ...capabilities, coordinator: true, autoMemory: { status: 'absent' },
  } as const });
  const daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), driver });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => (await (await fetch(`${daemon.url}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any).result;
  const project = await call('register-project', { path: directory });
  const work = (await call('send-message', { projectId: project.id, body: '开始', key: 'start' })).work;
  const ended = async (count: number) => {
    const deadline = Date.now() + 5_000;
    while ((await call('get-events', { workId: work.id }) as any[]).filter(event => event.action === 'round-ended').length < count) {
      assert.ok(Date.now() < deadline, '等待轮次结束超时');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  await ended(1);
  await call('send-message', { workId: work.id, body: '继续', key: 'next' });
  await ended(2);
  assert.deepEqual(rounds.map(round => round.resumeSessionId), [undefined, undefined]);
  assert.deepEqual(rounds.map(round => round.brief.resumed), [undefined, undefined]);
  assert.deepEqual(rounds.map(round => round.brief.coordinatorNotes), ['', '']);
});

async function resumeScenario(t: TestContext, capabilities: Pick<DriverCapabilities, 'resume' | 'contextUsage'>, scripts: FakeScript[]) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-resume-capability-')));
  const agentDir = await copyAgents(directory);
  const rounds: { sessionId: string; resumeSessionId?: string; brief: StartupBrief }[] = [];
  const fake = new FakeDriver(scripts);
  const daemon = await startTestHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir, driver: {
    capabilities: { ...fake.capabilities, ...capabilities },
    async start(options) {
      const session = await fake.start(options);
      return { ...session, async send(input) {
        rounds.push({ sessionId: session.id, resumeSessionId: options.resumeSessionId, brief: JSON.parse(input) });
        await session.send(input);
      } };
    },
  } });
  t.after(async () => { await daemon.close(); await rm(directory, { recursive: true, force: true }); });
  const call = async (name: string, params: object = {}) => (await (await fetch(`${daemon.url}/api/${name}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) })).json() as any).result;
  const project = await call('register-project', { path: directory });
  const work = (await call('send-message', { projectId: project.id, body: '开始', key: 'start' })).work;
  let count = 0;
  const ended = async () => {
    const deadline = Date.now() + 5_000;
    while ((await call('get-events', { workId: work.id }) as any[]).filter(event => event.action === 'round-ended').length < count + 1) {
      assert.ok(Date.now() < deadline, '等待轮次结束超时');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    count++;
  };
  await ended();
  return { rounds, agentDir, dataDir: join(directory, 'data'), call, work, async confirm() {
    const gate = (await call('list-pending')).find((item: any) => item.kind === 'work-confirmation');
    await call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
    await ended();
  }, async next() {
    await call('send-message', { workId: work.id, body: '继续', key: `next-${count}` });
    await ended();
  } };
}

async function executingScenario(t: TestContext, scripts: FakeStep[][]) {
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const scenario = await resumeScenario(t, { resume: true, contextUsage: true }, [
    [{ type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
      requirements: '网页版游戏', boundary: '只做本地页面', criteria: '可以开始和重开', deliverables: '交付物及查看入口', key: 'draft' }) }, small],
    // Keep execution waiting for a real user decision so stall recovery does not add rounds to rule-version scenarios.
    [{ type: 'tool', name: 'propose-gate', arguments: { key: 'decision', question: '是否继续交付？' } }, small],
    ...scripts,
  ]);
  await scenario.confirm();
  return scenario;
}

// Issue 30 item 4 / ADR 0017; small regression. FakeDriver replaces the external coordinator CLI.
test('执行规则更新在同一会话的下一轮取代旧版，之后未变的轮次不再附规则', async t => {
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const scenario = await executingScenario(t, [[small], [small], [small]]);
  await scenario.next();
  assert.equal(scenario.rounds[2]!.brief.phaseRules, undefined);

  const updated = '新版执行规则：先验收再交付。\n';
  writePrompt(join(scenario.dataDir, 'prompts'), 'coordinator-executing', updated);
  await scenario.next();
  const replacement = scenario.rounds[3]!.brief;
  assert.equal(replacement.phaseRules, updated);
  assert.equal(replacement.phaseRulesNotice, '执行规则已更新，此版取代会话中的旧版');
  await scenario.next();
  assert.equal(scenario.rounds[4]!.brief.phaseRules, undefined);
  assert.equal(scenario.rounds[4]!.brief.phaseRulesNotice, undefined);
  assert.equal(scenario.rounds[1]!.brief.phaseRulesNotice, undefined);
  for (const round of scenario.rounds.slice(1)) {
    assert.equal(round.sessionId, scenario.rounds[0]!.sessionId);
    assert.equal(round.resumeSessionId, scenario.rounds[0]!.sessionId);
    assert.equal(round.brief.resumed, true);
  }
  const starts = (await scenario.call('get-events', { workId: scenario.work.id }))
    .filter((event: any) => event.action === 'round-started');
  assert.match(starts[1].details.executingRules, /^[0-9a-f]{64}$/);
  assert.deepEqual(starts.map((event: any) => event.details.executingRules), [
    null, starts[1].details.executingRules, starts[1].details.executingRules,
    '90c745a5b9f7a5ac2b18ce5aa353c5b2da209385a2432f5a317425718b534abf',
    '90c745a5b9f7a5ac2b18ce5aa353c5b2da209385a2432f5a317425718b534abf',
  ]);
});

// Issue 30 item 4 / ADR 0017; small regression. Seed historical event formats; observe briefs via the CLI fixture.
for (const legacyRules of [true, false, undefined]) test(`旧事件 executingRules=${legacyRules} 的会话只补发一次执行规则`, async t => {
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const scenario = await executingScenario(t, [[small], [small]]);
  const start = (await scenario.call('get-events', { workId: scenario.work.id }))
    .filter((event: any) => event.action === 'round-started').at(-1);
  const details = { ...start.details };
  if (legacyRules === undefined) delete details.executingRules;
  else details.executingRules = legacyRules;
  const database = new DatabaseSync(join(scenario.dataDir, 'helm.db'));
  try { database.prepare('UPDATE events SET details = ? WHERE id = ?').run(JSON.stringify(details), start.id); }
  finally { database.close(); }

  await scenario.next();
  assert.equal(scenario.rounds[2]!.brief.phaseRules, scenario.rounds[1]!.brief.phaseRules);
  assert.equal(scenario.rounds[2]!.brief.phaseRulesNotice, legacyRules === true ? '执行规则已更新，此版取代会话中的旧版' : undefined);
  await scenario.next();
  assert.equal(scenario.rounds[3]!.brief.phaseRules, undefined);
  assert.equal(scenario.rounds[3]!.brief.phaseRulesNotice, undefined);
  for (const round of scenario.rounds.slice(2)) assert.equal(round.resumeSessionId, scenario.rounds[0]!.sessionId);
});

// Issue 30 item 4 / ADR 0017; small regression. FakeDriver replaces the external coordinator CLI.
for (const changed of [false, true]) test(`续跑因 Agent 改动改为新会话时记录完整简报的规则版本（规则更新=${changed}）`, async t => {
  const small = { type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } } as const;
  const scenario = await executingScenario(t, [[small], [small]]);
  const previousStart = (await scenario.call('get-events', { workId: scenario.work.id }))
    .filter((event: any) => event.action === 'round-started').at(-1);
  if (changed) writePrompt(join(scenario.dataDir, 'prompts'), 'coordinator-executing', '新版执行规则：先验收再交付。\n');
  await configureTestAgent(scenario.agentDir, 'claude-coordinator', { model: 'opus' });
  await scenario.next();
  const fresh = scenario.rounds[2]!;
  assert.equal(fresh.resumeSessionId, undefined);
  assert.notEqual(fresh.sessionId, scenario.rounds[0]!.sessionId);
  assert.equal(fresh.brief.phaseRules, changed ? '新版执行规则：先验收再交付。\n' : scenario.rounds[1]!.brief.phaseRules);
  assert.equal(fresh.brief.phaseRulesNotice, undefined);
  const start = (await scenario.call('get-events', { workId: scenario.work.id }))
    .filter((event: any) => event.action === 'round-started').at(-1);
  assert.equal(start.details.executingRules, changed ? '90c745a5b9f7a5ac2b18ce5aa353c5b2da209385a2432f5a317425718b534abf' : previousStart.details.executingRules);
  await scenario.next();
  assert.equal(scenario.rounds[3]!.resumeSessionId, fresh.sessionId);
  assert.equal(scenario.rounds[3]!.brief.phaseRules, undefined);
  assert.equal(scenario.rounds[3]!.brief.phaseRulesNotice, undefined);
});

test('不报告占用的调度者连续续跑十轮后新开，新会话重新计数', async t => {
  const scenario = await resumeScenario(t, { resume: true, contextUsage: false },
    Array.from({ length: 24 }, (): FakeStep[] => [{ type: 'end', reason: 'completed' }]));
  for (let index = 1; index < 24; index++) await scenario.next();
  const { rounds } = scenario;
  assert.deepEqual(rounds.map(round => round.brief.resumed ?? false), [
    false, true, true, true, true, true, true, true, true, true, true,
    false, true, true, true, true, true, true, true, true, true, true,
    false, true,
  ]);
  for (const [start, end] of [[0, 11], [11, 22], [22, 24]] as const) {
    assert.equal(rounds[start]!.resumeSessionId, undefined);
    assert.equal(rounds[start]!.brief.coordinatorNotes, '');
    for (const round of rounds.slice(start + 1, end)) {
      assert.equal(round.resumeSessionId, rounds[start]!.sessionId);
      assert.equal(round.brief.coordinatorNotes, undefined);
    }
  }
  assert.notEqual(rounds[0]!.sessionId, rounds[11]!.sessionId);
  assert.notEqual(rounds[11]!.sessionId, rounds[22]!.sessionId);
});

test('不声明报告占用的调度者即使收到较大占用也按轮数续跑', async t => {
  const scenario = await resumeScenario(t, { resume: true, contextUsage: false }, [
    [{ type: 'end', reason: 'completed', context: { tokens: 900_000, window: 1_000_000 } }],
    [{ type: 'end', reason: 'completed' }],
  ]);
  await scenario.next();
  assert.equal(scenario.rounds[1]!.resumeSessionId, scenario.rounds[0]!.sessionId);
  assert.equal(scenario.rounds[1]!.brief.resumed, true);
});

test('报告占用的调度者按十五万与窗口一半的较小值换新，缺少占用时新开', async t => {
  for (const [context, resumed] of [
    [{ tokens: 149_999, window: 1_000_000 }, true],
    [{ tokens: 150_000, window: 1_000_000 }, false],
    [{ tokens: 150_001, window: 1_000_000 }, false],
    [{ tokens: 49_999, window: 100_000 }, true],
    [{ tokens: 50_000, window: 100_000 }, false],
    [{ tokens: 50_001, window: 100_000 }, false],
    [{ tokens: 149_999 }, true],
    [{ tokens: 150_000 }, false],
    [undefined, false],
  ] as const) await t.test(JSON.stringify(context) ?? '缺少占用', async t => {
    const scenario = await resumeScenario(t, { resume: true, contextUsage: true }, [
      [{ type: 'end', reason: 'completed', context }],
      [{ type: 'end', reason: 'completed' }],
    ]);
    await scenario.next();
    const [first, second] = scenario.rounds;
    assert.equal(second!.resumeSessionId, resumed ? first!.sessionId : undefined);
    assert.equal(second!.brief.resumed ?? false, resumed);
    if (!resumed) assert.ok(second!.brief.newEvents.some(event => event.action === 'round-ended'));
  });
});

test('报告占用的调度者上下文小时可连续续跑超过十轮', async t => {
  const scenario = await resumeScenario(t, { resume: true, contextUsage: true },
    Array.from({ length: 13 }, (): FakeStep[] => [{ type: 'end', reason: 'completed', context: { tokens: 20_000, window: 1_000_000 } }]));
  for (let index = 1; index < 13; index++) await scenario.next();
  for (const round of scenario.rounds.slice(1)) {
    assert.equal(round.resumeSessionId, scenario.rounds[0]!.sessionId);
    assert.equal(round.brief.resumed, true);
  }
});

for (const contextUsage of [true, false]) test(`报告占用 ${contextUsage} 的调度者在续跑失败、压缩或 Agent 快照改变后新开，再恢复续跑`, async t => {
  const completed: FakeStep = { type: 'end', reason: 'completed', ...(contextUsage ? { context: { tokens: 20_000, window: 1_000_000 } } : {}) };
  const scenario = await resumeScenario(t, { resume: true, contextUsage }, [
    [completed],
    [{ type: 'crash', message: '续跑会话不可用' }],
    [completed],
    [completed],
    [{ type: 'compaction' }, completed],
    [completed],
    [completed],
    [completed],
    [completed],
  ]);
  for (let index = 1; index < 9; index++) {
    if (index === 7) await configureTestAgent(scenario.agentDir, 'claude-coordinator', { model: 'opus' });
    await scenario.next();
  }
  assert.deepEqual(scenario.rounds.map(round => round.brief.resumed ?? false), [false, true, false, true, true, false, true, false, true]);
  for (const index of [0, 2, 5, 7]) {
    assert.equal(scenario.rounds[index]!.resumeSessionId, undefined);
    if (index > 0) assert.notEqual(scenario.rounds[index]!.sessionId, scenario.rounds[index - 1]!.sessionId);
    assert.equal(scenario.rounds[index + 1]!.resumeSessionId, scenario.rounds[index]!.sessionId);
  }
});

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
      requirements: '网页版游戏', boundary: '只做本地页面', criteria: '可以开始和重开', deliverables: '交付物及查看入口', key: 'draft' }) }, small),
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

// issue 30: medium regression for degraded snapshots and recovery across rounds.
for (const failure of ['missing', 'copy'] as const) test(`跳过 skill (${failure}) 后保持配置和续跑，修好后新开会话收到工具`, async t => {
  const small = { type: 'end', reason: 'completed', context: { tokens: 100, window: 1_000_000 } } as const;
  const scenario = await resumeScenario(t, { resume: true, contextUsage: true }, Array(4).fill([small]));
  await configureTestAgent(scenario.agentDir, 'claude-coordinator', { skills: ['recoverable'] });
  const source = join(scenario.dataDir, 'library', 'skills', 'recoverable');
  const repair = async () => { await mkdir(source, { recursive: true }); await writeFile(join(source, 'SKILL.md'), 'repaired tool'); };
  if (failure === 'copy') {
    await repair();
    const { cpSync } = fs;
    t.mock.method(fs, 'cpSync', (...args: Parameters<typeof fs.cpSync>) => {
      cpSync(...args);
      if (args[0] === source) throw new Error(`Cannot copy skill to ${args[1]}`);
    });
    syncBuiltinESMExports();
    t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  }
  await scenario.next();
  assert.ok(scenario.rounds[1]!.brief.toolProblems?.some(problem => problem.name === 'recoverable'));
  await scenario.next();
  assert.equal(scenario.rounds[2]!.resumeSessionId, scenario.rounds[1]!.sessionId);
  t.mock.restoreAll(); syncBuiltinESMExports();
  await repair();
  await scenario.next();
  assert.equal(scenario.rounds[3]!.resumeSessionId, undefined);
  assert.equal(scenario.rounds[3]!.brief.toolProblems, undefined);
  const events = await scenario.call('get-events', { workId: scenario.work.id }) as any[];
  const rounds = events.filter(event => event.action === 'round-agent-loaded').map(event => event.details);
  assert.ok(rounds.slice(1).every(round => round.agent.skills.includes('recoverable')));
  assert.equal(await readFile(join(rounds.at(-1).agent.skillsPath, 'recoverable', 'SKILL.md'), 'utf8'), 'repaired tool');
});
