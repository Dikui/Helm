import assert from 'node:assert/strict';
import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { AcpDriver } from '../src/acp-driver.js';
import type { Driver, SessionOptions } from '../src/driver.js';
import type { StartupBrief } from '../src/rounds.js';
import { acpCoordinatorFixture } from './acp-coordinator-fixture.js';
import { until } from './claude-coordinator-fixture.js';

interface Observation { options: SessionOptions; sessionId: string; messages: any[]; brief?: StartupBrief; command: string }
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

// The real coordinator performs alignment, dispatch and review. A fake
// executor completes the card so this smoke needs only one login.
export async function acpCoordinatorSmoke(t: TestContext, kind: 'grok' | 'deepseek') {
  const stagedAuth = join(homedir(), kind === 'grok' ? '.grok/auth.json' : '.dsh/.credentials.yaml');
  assert.ok((await stat(stagedAuth)).isFile(), `先运行 ${kind === 'grok' ? 'grok login' : 'dsh web'} 登录；测试只链接 CLI 的凭据，不读取内容`);
  const evidence = await realpath(await mkdtemp(join(tmpdir(), `helm-${kind}-coordinator-evidence-`)));
  console.log(`${kind} 调度者冒烟证据目录：${evidence}`);
  const base = new AcpDriver(kind);
  const rounds: Observation[] = [];
  const driver: Driver = {
    capabilities: base.capabilities,
    checkAvailability: agent => base.checkAvailability(agent),
    async start(options) {
      assert.deepEqual(Object.keys(options.mcpServers), ['helm']);
      const session = await base.start(options);
      const record: Observation = { options, sessionId: session.id, messages: [], command: '' };
      rounds.push(record);
      return {
        ...session,
        async send(content) {
          const brief = JSON.parse(content) as StartupBrief;
          record.brief = brief;
          record.command = `printf outside > ${shellQuote(join(options.cwd, '..', 'coordinator-outside.txt'))}`;
          const instructions = brief.work.status === 'aligning'
            ? `先用 shell 原样执行一次命令 ${record.command}。
然后在当前调度者目录写 coordinator-notes.txt，内容为 allowed（不带换行）；再实际读取项目文件 ${join(brief.projectPath, 'README.md')}。
调用 draft-work-description，key=smoke-description，requirements=只读检查 README，boundary=临时项目，criteria=README.md 内容保持 coordinator read-only baseline 加换行。
只起草一次，等用户确认；本轮立即退出。`
            : `先读简报卡片图；需要时调用 get-card-graph 和 list-dispatches。
没有卡片时：create-card，key=smoke-readme，content=只读检查 README.md，workspace=copy，needsVerification=false；
然后 create-dispatch，key=smoke-dispatch，cardId 用返回的卡片 id，agentId=claude-executor，purpose=execution，needsBrowser=false，content=只读检查 README 基线并提交 completed。不要等待派单，本轮立即退出。
已有卡片时：不得重复建卡或派单。若派单未结束，本轮退出。若派单正常结束且 conclusion=completed，调用 complete-card 完成卡片。
卡片已完成后，调用 request-review，key=smoke-review，report 为结构化汇总报告：
verdict=accept，summary=README 只读检查完成，exceptions=[]，suggestions=[]；
criteria=[{criterion: "README 基线保持原样", status: "passed", evidence: [{label: "派单结果", kind: "dispatch", ref: "实际派单 id"}]}]；
cards=[{cardId: "实际卡片 id", title: "README 检查", result: "已完成只读检查", verification: "not-applicable", evidence: [{label: "派单结果", kind: "dispatch", ref: "实际派单 id"}], dispatches: [{agentId: "claude-executor", dispatchId: "实际派单 id"}]}]。
报告中的实际 id 必须取自工具结果，不能照抄占位文字。审核只交给用户，本轮退出。`;
          await session.send(`这是低消耗 Helm 调度者冒烟。工作由轮次令牌确定，MCP 调用不传 workId；业务操作只用注入的 helm 端点。
不安装、不派生子代理、不启动浏览器、不提交、不推送、不部署。工具返回结果就算成功，接着做下一步；只有返回明确的错误时才报告退出。若有原生计划工具，可用它展示本轮步骤。
${instructions}\n\n启动简报：\n${content}`);
        },
        events: (async function* () {
          for await (const event of session.events) {
            if (event.type === 'output') {
              try { record.messages.push(JSON.parse(event.text)); } catch { /* Plain diagnostics. */ }
            }
            yield event;
          }
        })(),
      };
    },
  };
  let daemon: Awaited<ReturnType<typeof acpCoordinatorFixture>> | undefined;
  try {
    // Coordinator smokes test Helm's plumbing; low effort made the model skip scripted steps. DeepSeek has no medium.
    daemon = await acpCoordinatorFixture(t, kind, driver, { stagedAuth, effort: kind === 'deepseek' ? 'high' : 'medium' });
    const idle = () => until(daemon!.events, events => events.some(event => event.action === 'round-ended')
      && events.filter(event => event.action === 'round-started').length === events.filter(event => event.action === 'round-ended').length, 240_000);
    await idle();
    const gate = (await daemon.call('list-pending')).find((item: any) => item.workId === daemon!.work.id && item.kind === 'work-confirmation');
    assert.ok(gate?.description, '真实 ACP 调度者必须完成对齐并起草工作说明');
    await daemon.call('decide-gate', { ...daemon.params, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' });
    const review = await until<any>(async () => (await daemon!.call('list-pending')).find((item: any) => item.workId === daemon!.work.id && item.kind === 'review'), Boolean, 240_000);
    const events = await idle();
    const ends = events.filter(event => event.action === 'round-ended');
    assert.ok(ends.every(event => event.details.reason === 'completed' && event.details.processed), JSON.stringify(ends));
    const graph = (await daemon.call('get-card-graph', daemon.params)).filter((node: any) => node.type === 'card');
    assert.equal(graph.length, 1);
    assert.equal(graph[0].status, 'completed');
    assert.equal(graph[0].workspace, 'copy');
    const dispatches = await daemon.call('list-dispatches', daemon.params);
    assert.equal(dispatches.length, 1);
    assert.equal(dispatches[0].endReason, 'completed');
    assert.equal(dispatches[0].conclusion, 'completed');
    assert.equal(review.report.verdict, 'accept');
    assert.equal(review.report.cards[0].cardId, graph[0].id);
    assert.equal(review.report.cards[0].dispatches[0].dispatchId, dispatches[0].id);
    const tools = new Map<string, any[]>();
    for (const round of rounds) for (const message of round.messages) {
      const update = message.params?.update;
      if (!['tool_call', 'tool_call_update'].includes(update?.sessionUpdate)) continue;
      const key = `${rounds.indexOf(round)}:${update.toolCallId}`;
      const entries = tools.get(key) ?? [];
      entries.push(update); tools.set(key, entries);
    }
    for (const name of ['draft-work-description', 'create-card', 'create-dispatch', 'complete-card', 'request-review']) {
      assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(name)
        && entries.some(entry => entry.status === 'completed')), `真实调度者必须成功调用 helm/${name}`);
    }
    const first = rounds[0]!;
    assert.equal(await readFile(join(first.options.cwd, '..', 'coordinator-outside.txt'), 'utf8'), 'outside', '无沙箱时调度者目录外可写');
    assert.equal(await readFile(join(first.options.cwd, 'coordinator-notes.txt'), 'utf8'), 'allowed');
    assert.ok([...tools.values()].some(entries => JSON.stringify(entries).includes(join(first.brief!.projectPath, 'README.md'))
      && JSON.stringify(entries).includes('coordinator read-only baseline') && entries.some(entry => entry.status === 'completed')), '必须有实际读取项目文件的工具证据');
    assert.equal(await readFile(join(first.brief!.projectPath, 'README.md'), 'utf8'), 'coordinator read-only baseline\n');
    assert.equal(daemon.git('-C', first.brief!.projectPath, 'status', '--porcelain'), '');
    assert.ok(rounds.every(round => round.options.cwd === join(daemon!.dataDir, 'coordinator', daemon!.work.id)), '所有轮次复用调度者目录');
    assert.equal(first.options.resumeSessionId, undefined);
    assert.ok(rounds.slice(1).some(round => round.options.resumeSessionId === first.sessionId), '低占用轮次须由新 ACP 进程续跑');
    assert.equal(new Set(rounds.map(round => round.options.mcpServers.helm!.headers.Authorization)).size, rounds.length);
    for (const round of rounds) {
      const response: Response = await fetch(`${daemon.url}/api/get-work`, { method: 'POST', headers: { 'content-type': 'application/json',
        Authorization: round.options.mcpServers.helm!.headers.Authorization! }, body: JSON.stringify(daemon.params) });
      assert.equal(response.status, 401, '结束后的轮次令牌必须失效');
    }
    await daemon.call('decide-gate', { ...daemon.params, gateId: review.id, decision: 'accept' });
    // A copy card opens the work branch, so accepting leaves the work waiting to be merged.
    assert.equal((await daemon.call('get-work', daemon.params)).status, 'accepted');
  } finally {
    for (const [index, round] of rounds.entries()) await writeFile(join(evidence, `round-${index + 1}.json`), JSON.stringify(round, null, 2));
    if (daemon) {
      await writeFile(join(evidence, 'events.json'), JSON.stringify(await daemon.events(), null, 2));
      await daemon.close();
    }
  }
}
