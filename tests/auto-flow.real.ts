// Outside the sandbox only: npm run build && HELM_AUTO_FLOW_REAL=1 node --test dist/tests/auto-flow.real.js
// Requires a logged-in Claude CLI; uses Codex for verification when logged in, otherwise a second Claude Agent.
// Alignment is fixture setup; both subsequent coordinator rounds and both dispatches use real CLIs. No browser is started.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { AgentCatalog } from '../src/agents.js';
import { ClaudeCoordinatorDriver, ClaudeExecutorDriver } from '../src/claude-driver.js';
import { CodexExecutorDriver } from '../src/codex-driver.js';
import type { Dispatch } from '../src/dispatch.js';
import { FakeDriver, type Driver } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { startHelmd } from '../src/server.js';
import type { HelmEvent } from '../src/store.js';
import { until } from './claude-coordinator-fixture.js';
import { configureTestAgent, copyAgents } from './helmd-fixture.js';

const enabled = process.env.HELM_AUTO_FLOW_REAL === '1';
type TestEvent = Omit<HelmEvent, 'details'> & { details: Record<string, any> };
const restrictions = '不启动浏览器、不安装、不派生子代理、不推送、不部署。工具失败就停止并报告，不寻找绕过方法。';
const verification = `这是 Helm 自动验收冒烟。在当前验收副本中读取 auto-flow-result.txt，确认内容恰为 auto-flow-ok 加一个换行。
不得修改文件。确认后必须调用 helm MCP 的 submit-conclusion，conclusion=passed，reason 写实际读到的内容；不符则提交 failed。${restrictions}`;
const execution = `这是 Helm 自动流程执行冒烟。在当前卡片副本的根目录写入 auto-flow-result.txt，内容恰为 auto-flow-ok 加一个换行。
读取文件确认内容，然后必须调用 helm MCP 的 submit-conclusion，conclusion=completed，reason 写文件名和实际内容。
不自行执行 git add 或 git commit，运行层会保存提交。${restrictions}`;

test('真实自动流程：执行完成后运行层派验收并合并卡片，期间不唤醒调度者，空闲后只唤醒一轮',
  { skip: !enabled, timeout: 600_000 }, async t => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'helm-auto-flow-real-')));
    let daemon: Awaited<ReturnType<typeof startHelmd>> | undefined;
    let events: (() => Promise<TestEvent[]>) | undefined;
    t.after(async () => {
      try { await daemon?.close(); }
      finally { await rm(directory, { recursive: true, force: true }); }
    });
    try {
      const repo = join(directory, 'project');
      const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
      execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' });
      await writeFile(join(repo, 'README.md'), 'autoFlow real smoke baseline\n');
      git('add', 'README.md');
      git('-c', 'user.name=Helm Test', '-c', 'user.email=helm@example.invalid', 'commit', '-m', 'baseline');
      const agentDir = await copyAgents(directory);
      await configureTestAgent(agentDir, 'claude-coordinator', { model: 'haiku', reasoningEffort: 'low' });
      const codex = new CodexExecutorDriver();
      const catalog = new AgentCatalog(agentDir, ['claude-sdk', 'codex']);
      const codexAvailable = await codex.checkAvailability(catalog.get('codex-executor'));
      const verifierId = codexAvailable.available ? 'codex-executor' : 'claude-verifier';
      if (!codexAvailable.available) {
        await cp(join(agentDir, 'claude-executor'), join(agentDir, verifierId), { recursive: true });
      }
      console.log(`自动验收 Agent：${verifierId}${codexAvailable.available ? '' : `（${codexAvailable.reason}）`}`);
      const briefs: StartupBrief[] = [];
      const coordinator = new ClaudeCoordinatorDriver({ query: args => {
        assert.equal(args.options?.model, 'haiku');
        assert.equal(args.options.effort, 'low');
        const brief = JSON.parse(args.prompt as string) as StartupBrief;
        const attempt = briefs.push(brief);
        const instructions = attempt === 1
          ? `这是 Helm 自动流程冒烟。工作由轮次令牌确定，MCP 调用不传 workId。${restrictions}
只用当前 helm MCP 端点，必须依次实际成功调用以下两个工具：
1. create-card，key=auto-flow-card，content=写入 auto-flow-result.txt，内容为 auto-flow-ok 加一个换行，readOnly=false，needsVerification=true，autoFlow 必须为 ${JSON.stringify({ verifications: [{ agentId: verifierId, content: verification, needsBrowser: false }] })}。
2. create-dispatch，key=auto-flow-execution，cardId 用上一步返回的卡片 id，agentId=claude-executor，purpose=execution，needsBrowser=false，content 必须为 ${JSON.stringify(execution)}。
禁止手动派验收、修改卡片或完成卡片；这些步骤由运行层自动推进。两个调用成功后立即简短回答并退出，不等待派单。`
          : `这是 Helm 自动流程完成后的唤醒轮次。${restrictions} 不调用任何工具，不改变工作状态，只回答“自动流程唤醒已收到”后退出。`;
        return query({ ...args, prompt: `${instructions}\n\n启动简报：\n${args.prompt}`,
          options: { ...args.options, maxTurns: 16 } });
      } });
      const executor = new ClaudeExecutorDriver({ query: args => query({ ...args, options: { ...args.options, maxTurns: 12 } }) });
      const setup = new FakeDriver([[
        { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id,
          key: 'draft', requirements: '自动流程真实冒烟', boundary: '临时项目，无浏览器', criteria: '写文件、自动验收和完成后唤醒' }),
          check: value => assert.equal((value as any).ok, true) },
      ]]);
      let started = 0;
      const claude: Driver = {
        checkAvailability: agent => (agent.role === 'coordinator' ? coordinator : executor).checkAvailability(agent),
        start: options => (options.agent.role === 'executor' ? executor : started++ === 0 ? setup : coordinator).start(options),
      };
      daemon = await startHelmd({ port: 0, dataDir: join(directory, 'data'), agentDir,
        drivers: { 'claude-sdk': claude, codex } });
      const call = async (name: string, params: object = {}): Promise<any> => {
        const response = await fetch(`${daemon!.url}/api/${name}`, { method: 'POST',
          headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
        const body = await response.json() as any;
        assert.equal(body.ok, true, JSON.stringify(body));
        return body.result;
      };
      const project = await call('register-project', { path: repo });
      const initial = (await call('send-message', { projectId: project.id, key: 'start', body: '自动完成一张写文件卡片' })).work;
      const params = { workId: initial.id };
      events = () => call('get-events', params);
      await until(events, values => values.some(event => event.action === 'round-ended'));
      const gate = (await call('list-pending')).find((item: any) => item.workId === initial.id);
      await call('decide-gate', { ...params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
      const sequence = await until(events, values => values.filter(event => event.action === 'round-ended').length >= 3, 480_000);
      const cards = (await call('get-card-graph', params)).filter((node: any) => node.type === 'card');
      assert.equal(cards.length, 1);
      const card = cards[0];
      assert.equal(card.key, 'auto-flow-card');
      assert.equal(card.readOnly, false);
      assert.equal(card.needsVerification, true);
      assert.deepEqual(card.autoFlow, { verifications: [{ agentId: verifierId, content: verification, needsBrowser: false }] });
      const dispatches = await call('list-dispatches', params) as Dispatch[];
      assert.equal(dispatches.length, 2);
      const run = dispatches.find(item => item.key === 'auto-flow-execution');
      assert.ok(run);
      assert.equal(run.purpose, 'execution');
      assert.equal(run.agentId, 'claude-executor');
      const vote = dispatches.find(item => item.key === `auto-verify-${run.id}-0`);
      assert.ok(vote, '运行层必须用执行派单 id 和票序号自动派验收');
      assert.equal(vote.purpose, 'verification');
      assert.equal(vote.agentId, verifierId);
      for (const [dispatch, conclusion] of [[run, 'completed'], [vote, 'passed']] as const) {
        assert.equal(dispatch.cardId, card.id);
        assert.equal(dispatch.needsBrowser, false);
        assert.equal(dispatch.status, 'ended');
        assert.equal(dispatch.endReason, 'completed', dispatch.failure ?? JSON.stringify(dispatch));
        assert.equal(dispatch.conclusion, conclusion);
        assert.ok(dispatch.usage.inputTokens! > 0 && dispatch.usage.outputTokens! > 0, '必须有真实执行者 token 用量');
      }
      assert.equal(vote.startCommit, run.endCommit, '验收必须检查执行者刚写入的提交');
      const executionEnd = sequence.find(event => event.action === 'dispatch-ended' && event.dispatchId === run.id);
      const voteCreated = sequence.find(event => event.action === 'dispatch-created' && event.dispatchId === vote.id);
      const votePassed = sequence.find(event => event.action === 'conclusion-submitted' && event.dispatchId === vote.id);
      const voteEnd = sequence.find(event => event.action === 'dispatch-ended' && event.dispatchId === vote.id);
      const completed = sequence.find(event => event.action === 'card-completed' && event.cardId === card.id);
      assert.ok(executionEnd && voteCreated && votePassed && voteEnd && completed, '缺少自动流程关键事件');
      assert.equal(voteCreated.actor.type, 'runtime');
      assert.equal(votePassed.details.conclusion, 'passed');
      assert.equal(completed.actor.type, 'runtime');
      assert.ok(executionEnd.id < voteCreated.id && voteCreated.id < votePassed.id && votePassed.id < voteEnd.id && voteEnd.id < completed.id);
      const starts = sequence.filter(event => event.action === 'round-started');
      const before = starts.filter(event => event.id <= executionEnd.id).length;
      assert.equal(before, 2, '执行结束时只有夹具对齐轮次和第一轮真实调度者');
      assert.equal(starts.filter(event => event.id <= completed.id).length, before, '执行结束至卡片完成之间不得开始调度轮次');
      assert.equal(starts.length, before + 1, '工作空闲后必须恰好唤醒一轮');
      assert.ok(starts.at(-1)!.id > completed.id);
      assert.equal(briefs.length, 2);
      assert.deepEqual(briefs[1]!.wakeEvents.map(event => event.id), [completed.id]);
      for (const end of sequence.filter(event => event.action === 'round-ended')) {
        assert.equal(end.details.reason, 'completed', JSON.stringify(end.details));
        assert.equal(end.details.processed, true);
      }
      assert.equal(sequence.some(event => event.action === 'auto-flow-stopped'), false);
      assert.equal(sequence.some(event => event.action === 'browser-started'), false);
      assert.equal(card.status, 'completed');
      const work = await call('get-work', params);
      assert.ok(work.workBranch);
      assert.equal(execFileSync('git', ['-C', repo, 'show', `${work.workBranch}:auto-flow-result.txt`], { encoding: 'utf8' }), 'auto-flow-ok\n');
    } catch (error) {
      const sequence = await events?.().catch(() => []);
      console.error('autoFlow 真实冒烟事件序列：\n' + (sequence ?? []).map(event => {
        const { step, summary, key, purpose, agentId, eventIds, endReason, conclusion, reason, code, failure, error, processed, finalAnswer } = event.details;
        return JSON.stringify({ id: event.id, action: event.action, actor: event.actor, object: event.object,
          cardId: event.cardId, dispatchId: event.dispatchId,
          details: { step, summary, key, purpose, agentId, eventIds, endReason, conclusion, reason, code, failure, error, processed, finalAnswer } });
      }).join('\n'));
      throw error;
    }
  });
