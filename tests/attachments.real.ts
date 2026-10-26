// Outside the sandbox only: npm run test:attachments. No browser is started.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';
import { test, type TestContext } from 'node:test';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AcpDriver } from '../src/acp-driver.js';
import { AgentCatalog } from '../src/agents.js';
import { ClaudeCoordinatorDriver, ClaudeExecutorDriver } from '../src/claude-driver.js';
import { CodexCoordinatorDriver, CodexExecutorDriver } from '../src/codex-driver.js';
import type { Driver, SessionOptions } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { acpExecutorFixture } from './acp-executor-fixture.js';
import { fixture as claudeExecutorFixture } from './browser-fixture.js';
import { fixture as claudeCoordinatorFixture } from './claude-coordinator-fixture.js';
import { coordinatorFixture as codexCoordinatorFixture } from './codex-coordinator-fixture.js';
import { codexFixture } from './codex-executor-fixture.js';
import { fixtureAgentDir, type FirstMessage } from './helmd-fixture.js';

const enabled = process.env.HELM_ATTACHMENTS_REAL === '1';
const restrictions = '低消耗：不派生子代理、不安装、不开浏览器、不提交、不推送。不重试、不提权；读取失败就报告受阻并退出。';
const coordinatorBody = `读取本消息 spec.md 附件（recentConversation.attachments 中的绝对路径），
用自己的读文件工具读取，随后只调用 helm MCP 的 draft-work-description：key=attachment-description，
requirements 原样填写文件中的口令，boundary=附件读取，criteria=口令一致。工作由令牌确定，不传 workId。
不创建卡片、不派单。完成后立即退出。${restrictions}`;

function attachment(body: string) {
  const secret = randomUUID();
  const text = `# 附件读取冒烟\n口令：${secret}\n`;
  const firstMessage: FirstMessage = { body, attachments: [{ name: 'spec.md', content: Buffer.from(text).toString('base64') }] };
  return { secret, text, firstMessage };
}

function outsideCwd(path: string, cwd: string, label: string) {
  const suffix = relative(cwd, path);
  assert.ok(suffix === '..' || suffix.startsWith(`..${sep}`) || isAbsolute(suffix),
    `${label}：附件必须在 cwd 外：${JSON.stringify({ path, cwd })}`);
}

// Inspect the exact startup JSON delivered to the driver; never inject the secret.
function attachmentPath(brief: StartupBrief, fixture: ReturnType<typeof attachment>, label: string) {
  assert.equal(JSON.stringify(brief).includes(fixture.secret), false, `${label}：启动简报泄漏了附件口令`);
  assert.equal(JSON.stringify(brief).includes(Buffer.from(fixture.text).toString('base64')), false,
    `${label}：启动简报不能内嵌 base64 附件内容`);
  const message = brief.recentConversation.find(item => 'type' in item && item.type === 'message' && item.sender === 'user');
  assert.ok(message, `${label}：启动简报缺少首条用户消息`);
  assert.ok('attachments' in message, `${label}：消息缺少 attachments`);
  const files = message.attachments as { name: string; path: string; size: number }[];
  assert.equal(files?.length, 1, `${label}：recentConversation 必须包含附件元数据`);
  const file = files[0]!;
  assert.equal(isAbsolute(file.path), true, `${label}：附件路径必须是绝对路径`);
  assert.deepEqual(file, { name: 'spec.md', path: file.path, size: Buffer.byteLength(fixture.text) },
    `${label}：附件只应提供 name/path/size`);
  assert.ok(file.path.endsWith(join('attachments', brief.work.id, String(message.id), 'spec.md')),
    `${label}：附件应位于数据目录，而非项目副本：${file.path}`);
  return file.path;
}

// Keep the actual CLI, sandbox and tools; only record the driver's input boundary.
function observedDriver(base: Driver) {
  const inputs: { options: SessionOptions; content: string }[] = [];
  const driver: Driver = {
    checkAvailability: agent => base.checkAvailability(agent),
    async start(options) {
      const session = await base.start(options);
      return { ...session, async send(content) {
        inputs.push({ options, content });
        await session.send(content);
      } };
    },
  };
  return { driver, inputs };
}

// Match existing Claude smoke's real SDK boundary, with fewer turns for this tiny task.
const claudeQuery: typeof query = args => query({ ...args, options: { ...args.options, maxTurns: 6 } });

async function stagedAuth(agent: 'codex' | 'grok' | 'deepseek') {
  const path = join(homedir(), ...({ codex: ['.codex', 'auth.json'], grok: ['.grok', 'auth.json'],
    deepseek: ['.dsh', '.credentials.yaml'] }[agent]));
  assert.ok((await stat(path)).isFile(), `${agent}：请先按现有真实冒烟要求登录 CLI`);
  return path;
}

function assertCoordinator(observed: ReturnType<typeof observedDriver>, fixture: ReturnType<typeof attachment>, label: string) {
  assert.equal(observed.inputs.length, 1, `${label}：只应运行第一轮真实调度者`);
  const { options, content } = observed.inputs[0]!;
  const brief = JSON.parse(content) as StartupBrief;
  assert.equal(brief.work.status, 'aligning', `${label}：必须从新工作的第一轮读取附件`);
  assert.equal(brief.workDescription, null, `${label}：第一轮不应已有说明`);
  outsideCwd(attachmentPath(brief, fixture, label), options.cwd, label);
  assert.equal(options.agent.reasoningEffort, 'low', `${label}：必须使用低推理强度`);
}

async function coordinatorResult(daemon: {
  call(name: string, params?: object): Promise<any>; events(): Promise<any[]>; params: { workId: string };
}, secret: string, label: string) {
  const events = await daemon.events();
  const end = events.find(event => event.action === 'round-ended');
  assert.equal(end?.details.reason, 'completed', `${label}：首轮未完成：${JSON.stringify(events)}`);
  const descriptions = await daemon.call('get-work-descriptions', daemon.params);
  assert.ok(descriptions.some((description: any) => description.requirements.includes(secret)),
    `${label}：draft-work-description 的 requirements 未包含附件口令：${JSON.stringify(descriptions)}`);
}

test('Claude 调度者读取 cwd 外的首条消息附件，将口令写入 requirements', { skip: !enabled, timeout: 240_000 }, async t => {
  let daemon: Awaited<ReturnType<typeof claudeCoordinatorFixture>> | undefined;
  try {
    const base = new ClaudeCoordinatorDriver({ query: claudeQuery });
    const available = await base.checkAvailability(new AgentCatalog(fixtureAgentDir).get('claude-coordinator'));
    assert.equal(available.available, true, `Claude 调度者：${available.reason}`);
    const file = attachment(coordinatorBody);
    const observed = observedDriver(base);
    daemon = await claudeCoordinatorFixture(t, observed.driver, 1, {
      realFirstRound: true, firstMessage: file.firstMessage, roundTimeout: 180_000,
    });
    assertCoordinator(observed, file, 'Claude 调度者');
    await coordinatorResult(daemon, file.secret, 'Claude 调度者');
  } finally { await daemon?.close(); }
});

test('Codex 调度者读取 cwd 外的首条消息附件，将口令写入 requirements', { skip: !enabled, timeout: 240_000 }, async t => {
  const file = attachment(coordinatorBody);
  const observed = observedDriver(new CodexCoordinatorDriver());
  const daemon = await codexCoordinatorFixture(t, observed.driver, {
    stagedAuth: await stagedAuth('codex'), realFirstRound: true, firstMessage: file.firstMessage, roundTimeout: 180_000,
  });
  assertCoordinator(observed, file, 'Codex 调度者');
  await coordinatorResult(daemon, file.secret, 'Codex 调度者');
});

function executorScenario(label: string) {
  const file = attachment('请执行附件读取冒烟。');
  let path: string | undefined;
  return {
    firstMessage: file.firstMessage,
    dispatchContent(brief: StartupBrief) {
      path = attachmentPath(brief, file, label);
      return `用自己的读文件工具按绝对路径读取附件 ${JSON.stringify(path)}，
然后调用 helm MCP 的 submit-conclusion，conclusion=completed，reason 原样填写文件中的口令。完成后立即退出。
只需读文件和提交结论。${restrictions}`;
    },
    assertResult(observed: ReturnType<typeof observedDriver>, dispatch: any) {
      assert.ok(path, `${label}：假调度者未从 recentConversation.attachments 取得路径`);
      assert.equal(observed.inputs.length, 1, `${label}：只应运行一次真实派单`);
      const { options, content } = observed.inputs[0]!;
      outsideCwd(path, options.cwd, label);
      assert.ok(content.includes(path), `${label}：派单 content 缺少附件绝对路径`);
      assert.equal(content.includes(file.secret), false, `${label}：执行者输入不能提前包含口令`);
      assert.equal(options.agent.reasoningEffort, 'low', `${label}：必须使用低推理强度`);
      assert.equal(dispatch.endReason, 'completed', `${label}：派单未正常完成：${JSON.stringify(dispatch)}`);
      assert.equal(dispatch.conclusion, 'completed', `${label}：读取失败或未提交结论：${JSON.stringify(dispatch)}`);
      assert.ok(dispatch.conclusionReason?.includes(file.secret),
        `${label}：submit-conclusion.reason 未包含附件口令：${JSON.stringify(dispatch)}`);
    },
  };
}

test('Claude 执行者读取 cwd 外的消息附件，将口令写入结论', { skip: !enabled, timeout: 240_000 }, async t => {
  let daemon: Awaited<ReturnType<typeof claudeExecutorFixture>> | undefined;
  try {
    const base = new ClaudeExecutorDriver({ query: claudeQuery });
    const available = await base.checkAvailability(new AgentCatalog(fixtureAgentDir).get('claude-executor'));
    assert.equal(available.available, true, `Claude 执行者：${available.reason}`);
    const scenario = executorScenario('Claude 执行者');
    const observed = observedDriver(base);
    daemon = await claudeExecutorFixture(t, [], { ...scenario, executorDriver: observed.driver, model: 'haiku' });
    scenario.assertResult(observed, await daemon.ended());
  } finally { await daemon?.close(); }
});

test('Codex 执行者读取 cwd 外的消息附件，将口令写入结论', { skip: !enabled, timeout: 240_000 }, async t => {
  const scenario = executorScenario('Codex 执行者');
  const observed = observedDriver(new CodexExecutorDriver());
  const daemon = await codexFixture(t, observed.driver, { ...scenario, stagedAuth: await stagedAuth('codex') });
  await daemon.confirm();
  scenario.assertResult(observed, (await daemon.ended(1, 180_000))[0]);
});

async function acpAttachment(t: TestContext, agent: 'grok' | 'deepseek', label: string) {
  const scenario = executorScenario(label);
  const observed = observedDriver(new AcpDriver(agent));
  const daemon = await acpExecutorFixture(t, observed.driver, { ...scenario, agent, stagedAuth: await stagedAuth(agent),
    model: agent === 'grok' ? 'grok-4.5' : 'deepseek-flash',
  });
  await daemon.confirm();
  scenario.assertResult(observed, (await daemon.ended(1, 180_000))[0]);
}

test('Grok 执行者读取 cwd 外的消息附件，将口令写入结论', { skip: !enabled, timeout: 240_000 }, async t => {
  await acpAttachment(t, 'grok', 'Grok 执行者');
});

test('DeepSeek 执行者读取 cwd 外的消息附件，将口令写入结论', { skip: !enabled, timeout: 240_000 }, async t => {
  await acpAttachment(t, 'deepseek', 'DeepSeek 执行者');
});
