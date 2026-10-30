// Outside the sandbox only: npm run test:coordinator-resume
// Real Claude and Codex coordinators: the second round resumes the first round's session (ADR 0017).
// Uses the real Claude login and links the real Codex login into a temporary HOME. No browser is started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCoordinatorDriver } from '../src/claude-driver.js';
import { CodexCoordinatorDriver } from '../src/codex-driver.js';
import type { Driver } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { fixture, until } from './claude-coordinator-fixture.js';
import { coordinatorFixture } from './codex-coordinator-fixture.js';

const enabled = process.env.HELM_COORDINATOR_RESUME_REAL === '1';
interface Round { brief: StartupBrief; sessionId: string; resumeSessionId?: string }

// The test number exists only in the first round's prompt, never in the task store, so only the resumed session can recall it.
function instructions(attempt: number, secret: string) {
  // A neutral word: models sometimes refuse to repeat anything called a password.
  return attempt === 1
    ? `这是 Helm 续跑冒烟。本轮不调用任何工具。本次测试编号是 ${secret}，只回答"收到"。`
    : '这是 Helm 续跑冒烟第二轮。不调用任何工具。只输出上一轮告诉你的测试编号本身，不输出其他内容。';
}

async function assertResumed(daemon: { call(name: string, params?: object): Promise<any>; events(): Promise<any[]>; params: object },
  rounds: Round[], secret: string, ended: number) {
  const first = await until(daemon.events, values => values.filter(e => e.action === 'round-ended').length >= ended + 1, 240_000);
  assert.equal(first.filter(e => e.action === 'round-ended').at(-1).details.reason, 'completed');
  assert.ok(!JSON.stringify(first).includes(secret), '测试编号不能进入任务库');
  await daemon.call('send-message', { ...daemon.params, key: 'resume-probe', body: '续跑第二轮' });
  const events = await until(daemon.events, values => values.filter(e => e.action === 'round-ended').length >= ended + 2, 240_000);
  const end = events.filter(e => e.action === 'round-ended').at(-1);
  assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
  assert.deepEqual(events.filter(e => e.action === 'round-agent-loaded').slice(-2).map(e => e.details.resumed), [false, true]);
  assert.equal(rounds.length, 2);
  const [one, two] = rounds as [Round, Round];
  assert.equal(one.resumeSessionId, undefined);
  assert.equal(two.resumeSessionId, one.sessionId);
  assert.equal(two.sessionId, one.sessionId);
  assert.equal(two.brief.resumed, true);
  assert.equal(two.brief.coordinatorNotes, undefined);
  assert.ok(two.brief.wakeEvents.some(e => (e.details as any).body === '续跑第二轮'));
  assert.match(end.details.finalAnswer, new RegExp(secret), '续跑的会话必须记得上一轮的测试编号');
}

test('真实 Claude 调度者第二轮续跑第一轮的会话，记得只在会话里出现过的测试编号', { skip: !enabled, timeout: 600_000 }, async t => {
  const secret = `helm-${randomUUID().slice(0, 8)}`;
  const rounds: Round[] = [];
  const base = new ClaudeCoordinatorDriver({ query: args => {
    const sdk = args.options!;
    const round: Round = { brief: JSON.parse(args.prompt as string), sessionId: sdk.resume ?? sdk.sessionId!, resumeSessionId: sdk.resume };
    const attempt = rounds.push(round);
    return query({ ...args, prompt: `${instructions(attempt, secret)}\n\n启动简报：\n${args.prompt}` });
  } });
  const daemon = await fixture(t, base, 2);
  await assertResumed(daemon, rounds, secret, 1);
});

test('真实 Codex 调度者第二轮用 thread/resume 续跑第一轮的线程，记得只在会话里出现过的测试编号', { skip: !enabled, timeout: 600_000 }, async t => {
  const stagedAuth = join(homedir(), '.codex', 'auth.json');
  assert.ok((await stat(stagedAuth)).isFile(), '先在本机 codex login（文件存储）');
  const secret = `helm-${randomUUID().slice(0, 8)}`;
  const rounds: Round[] = [];
  const base = new CodexCoordinatorDriver();
  const driver: Driver = {
    checkAvailability: agent => base.checkAvailability(agent),
    async start(options) {
      const session = await base.start(options);
      const round: Round = { brief: undefined!, sessionId: session.id, resumeSessionId: options.resumeSessionId };
      const attempt = rounds.push(round);
      return { ...session, async send(content) {
        round.brief = JSON.parse(content) as StartupBrief;
        await session.send(`${instructions(attempt, secret)}\n\n启动简报：\n${content}`);
      } };
    },
  };
  const daemon = await coordinatorFixture(t, driver, { rounds: 2, stagedAuth });
  await daemon.confirm();
  await assertResumed(daemon, rounds, secret, 1);
});
