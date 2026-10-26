import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { CodexExecutorDriver } from '../src/codex-driver.js';
import { FakeDriver, type FakeContext, type FakeStep } from '../src/driver.js';
import { codexFixture, ok } from './codex-executor-fixture.js';
import { until } from './browser-fixture.js';

test('Codex 额度用完的派单经主边界唤醒调度者，改派 Claude 并保存改动；临时 HOME 不建订阅主目录或登录软链接', async t => {
  let quotaWake = false;
  const real = new CodexExecutorDriver({ command: { file: process.execPath,
    args: ['-e', 'process.exit(process.argv.slice(1).join(" ") === "login status" ? 0 : 1)'] } });
  const fake = new FakeDriver([[{ type: 'end', reason: 'quota-exhausted', usage: { inputTokens: 18, outputTokens: 2 } }]], agent => real.checkAvailability(agent));
  const reassign = (ctx: FakeContext): FakeStep[] => {
    const brief = JSON.parse(ctx.input);
    const ended = brief.wakeEvents.find((e: any) => e.action === 'dispatch-ended' && e.details.endReason === 'quota-exhausted');
    // Card readiness can wake an earlier round before the dispatch has ended.
    if (!ended) { daemon.actions.push(reassign); return []; }
    quotaWake = true;
    return [{ type: 'tool', name: 'create-dispatch', arguments: { workId: brief.work.id, cardId: ended.cardId,
      agentId: 'claude-executor', key: 'replacement' }, check: ok }];
  };
  const daemon = await codexFixture(t, fake, { after: reassign });
  const source = join(daemon.home, '.codex', 'auth.json');
  const link = join(daemon.home, '.helm', 'agent-homes', 'codex', 'auth.json');
  await assert.rejects(stat(link), { code: 'ENOENT' });
  await daemon.confirm();
  const dispatches = await daemon.ended(2);
  assert.ok(quotaWake);
  assert.equal(dispatches[0].endReason, 'quota-exhausted');
  assert.deepEqual(dispatches[0].usage, { inputTokens: 18, outputTokens: 2 });
  assert.equal(dispatches[1].agentId, 'claude-executor');
  assert.equal(dispatches[1].endReason, 'completed');
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: dispatches[1].cardId })).result;
  assert.equal(daemon.git('show', `${card.cardBranch}:replacement.txt`), '由另一家完成');
  assert.equal(await readFile(source, 'utf8'), 'fake credential; never open');
});

test('Codex 派单保存 thread 与 sqlite 目录，续跑同 thread 另开进程目录，运行层提交执行改动', async t => {
  const conclude: FakeStep = { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '本次派单完成' }, check: ok };
  const fake = new FakeDriver([[{ type: 'write', path: 'first.txt', content: '第一轮' }, conclude], [{ type: 'write', path: 'second.txt', content: '续跑' }, conclude]]);
  const starts: { id: string; sqlitePath: string; resume?: string }[] = [];
  const daemon = await codexFixture(t, { checkAvailability: async () => ({ available: true }), async start(options) {
    const session = await fake.start(options);
    const sqlitePath = join(options.dataDir!, 'codex-sqlite');
    starts.push({ id: session.id, sqlitePath, resume: options.resumeSessionId });
    return { ...session, sqlitePath };
  } });
  await daemon.confirm();
  const first = (await daemon.ended())[0];
  await until(daemon.events, events => events.filter(e => e.action === 'round-started').length === events.filter(e => e.action === 'round-ended').length);
  const steps: FakeStep[] = [{ type: 'tool', name: 'create-dispatch', arguments: { workId: daemon.work.id, cardId: first.cardId,
    agentId: 'codex-executor', resumeSessionId: first.sessionId, key: 'resume' }, check: ok }];
  daemon.actions.push(steps);
  ok(await daemon.call('send-message', { workId: daemon.work.id, key: 'resume', body: '继续执行' }));
  const dispatches = await daemon.ended(2);
  assert.equal(dispatches[1].sessionId, first.sessionId);
  assert.equal(starts[1]!.resume, first.sessionId);
  assert.equal(first.sqlitePath, join(daemon.dataDir, 'dispatches', first.id, 'codex-sqlite'));
  assert.equal(dispatches[1].sqlitePath, starts[1]!.sqlitePath);
  assert.notEqual(first.sqlitePath, dispatches[1].sqlitePath);
  const card = (await daemon.call('get-card', { workId: daemon.work.id, cardId: first.cardId })).result;
  assert.equal(daemon.git('show', `${card.cardBranch}:second.txt`), '续跑');
});
