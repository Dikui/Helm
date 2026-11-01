// Persistent, disposable UI data. Run with npm run demo:ui; no real agents or browsers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { FakeContext, FakeScript, FakeStep } from '../src/driver.js';
import type { ReviewReport } from '../src/review-report.js';
import { defaultStaticDir } from '../src/static-files.js';
import { uiFixture } from './ui-fixture.js';

const port = Number(process.env.PORT ?? 4344);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT 必须是 1–65535 的整数');

let stopping = false;
let scriptFailure: Error | undefined;
const stages = new Map<string, FakeStep[]>();
const seen = new Set<string>();
const executorScripts: FakeScript[] = [];
const workIdOf = (ctx: FakeContext): string => JSON.parse(ctx.input).work.id;
const savedId = (ctx: FakeContext, key: string): string => (ctx.results.get(key) as { result: { id: string } }).result.id;
function ok(value: unknown) {
  try { assert.equal((value as { ok: boolean }).ok, true, JSON.stringify(value)); }
  catch (error) { scriptFailure = error as Error; throw error; }
}
const tool = (name: string, args: Record<string, unknown> | ((ctx: FakeContext) => Record<string, unknown>), saveAs?: string): FakeStep =>
  ({ type: 'tool', name, arguments: args, saveAs, check: ok });
const end = (known = true): FakeStep => ({ type: 'end', reason: 'completed', finalAnswer: '演示派单完成（FakeDriver）',
  ...(known ? { usage: { inputTokens: 2400, outputTokens: 360, cacheReadTokens: 1200, cacheWriteTokens: 200 } } : {}) });
const draft = (version = 1): FakeStep => tool('draft-work-description', ctx => ({ workId: workIdOf(ctx), key: `brief-${version}`,
  requirements: `- 展示本机演示工作的真实状态\n- 所有 Agent 使用 FakeDriver${version > 1 ? '\n- 新增：支持深浅主题和窄屏检查' : ''}`,
  boundary: '只修改临时项目；不调用付费 Agent，不启动浏览器。',
  criteria: `- 状态、历史和证据可读取${version > 1 ? '\n- 新增：检查工作说明新增条目高亮' : ''}`,
}));

// Replenish the same queue consumed by FakeDriver, so all future rounds remain scripted.
// Route by work id: wake events from parallel works must not steal another work's seed stage.
const coordinatorScripts: FakeScript[] = [];
const route: FakeScript = ctx => {
  coordinatorScripts.push(route);
  const workId = workIdOf(ctx);
  const stage = stages.get(workId);
  if (stage) { stages.delete(workId); return stage; }
  if (!seen.has(workId)) {
    seen.add(workId);
    return [draft(), tool('write-coordinator-notes', { workId, body: '第一轮：整理需求，等待确认工作说明。' }), end()];
  }
  return [end()];
};
coordinatorScripts.push(route);

const starting = uiFixture(coordinatorScripts, defaultStaticDir, { port, executorScripts });
let closing: Promise<void> | undefined;
function close() {
  return closing ??= (async () => { const fixture = await starting; await fixture.close(); })();
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`\n收到 ${signal}，正在清理演示临时目录…`);
    void close().then(() => { console.log('演示临时目录已清理。'); process.exit(0); }, error => { console.error(error); process.exit(1); });
  });
}

async function main() {
  const fixture = await starting;
  const call = async (name: string, params: object = {}) => {
    if (stopping) throw new Error('演示正在退出');
    const response = await fixture.call(name, params);
    assert.equal(response.ok, true, `${name}: ${JSON.stringify(response)}`);
    return response.result;
  };
  async function wait<T>(label: string, read: () => Promise<T>, ready: (value: T) => boolean): Promise<T> {
    const deadline = Date.now() + 30_000;
    for (;;) {
      if (scriptFailure) throw scriptFailure;
      const value = await read();
      if (ready(value)) return value;
      if (Date.now() >= deadline) throw new Error(`${label} 超时：${JSON.stringify(value)}`);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  const quiet = (workId: string) => wait('等待调度轮次结束', () => call('list-rounds', { workId }),
    value => value.rounds.length > 0 && value.rounds.every((round: any) => round.status === 'ended') && value.queuedMessages.length === 0);
  let sequence = 0;
  async function run(workId: string, steps: FakeStep[]) {
    let ran = false;
    assert(!stages.has(workId));
    stages.set(workId, [...steps, { type: 'tool', name: 'get-work', arguments: { workId }, check: value => { ok(value); ran = true; } }, end()]);
    await call('send-message', { workId, key: `seed-${++sequence}`, body: `演示准备第 ${sequence} 步：记录卡片、派单或关卡。` });
    await wait('等待演示操作', () => call('list-rounds', { workId }), () => ran);
    await quiet(workId);
  }
  async function create(title: string, projectId = fixture.project.id, confirm = true) {
    const work = (await call('send-message', { projectId, key: `demo-${++sequence}`, body: title })).work;
    await quiet(work.id);
    if (confirm) {
      const description = (await call('get-work-descriptions', { workId: work.id })).at(-1);
      await call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
      await quiet(work.id);
    }
    return work.id as string;
  }
  const card = (key: string, content: string, extra: object = {}): FakeStep => tool('create-card', ctx => ({ workId: workIdOf(ctx), key, content, ...extra }), key);
  const graph = (workId: string): Promise<any[]> => call('get-card-graph', { workId });
  const cards = async (workId: string): Promise<Record<string, any>> => Object.fromEntries((await graph(workId)).filter(node => node.type === 'card').map(node => [node.key, node]));
  const dependency = (upstream: string, downstream: string, type = 'card'): FakeStep => tool('add-dependency', ctx => ({ workId: workIdOf(ctx),
    upstream: { type, id: savedId(ctx, upstream) }, downstream: { type: 'card', id: savedId(ctx, downstream) } }));
  const gate = (key: string, question: string, multiSelect = false): FakeStep => tool('propose-gate', ctx => ({ workId: workIdOf(ctx), key, question,
    body: '这是演示用的真实决策关卡，可以在界面选择或补充回答。', options: multiSelect ? ['桌面布局', '窄屏布局', '深色主题', '键盘操作'] : ['SQLite（推荐）', '文件存储'], multiSelect }), key);
  async function dispatch(workId: string, cardId: string, script: FakeStep[], purpose = 'execution', running = false) {
    executorScripts.push(script);
    const key = `dispatch-${++sequence}`;
    await run(workId, [tool('create-dispatch', { workId, cardId, key, purpose, agentId: 'claude-executor', needsBrowser: false })]);
    const records = await wait('等待派单', () => call('list-dispatches', { workId, cardId }),
      value => value.some((item: any) => item.key === key && item.status === (running ? 'running' : 'ended')));
    return records.find((item: any) => item.key === key);
  }
  const conclusion = (value: string, reason: string): FakeStep => tool('submit-conclusion', { conclusion: value, reason });
  const execution = (path: string, content = 'FakeDriver 演示成果\n'): FakeStep[] => [
    { type: 'write', path, content }, { type: 'artifact', kind: 'file', path }, conclusion('completed', '演示改动已完成'), end(),
  ];
  const held = (text: string): FakeStep[] => [{ type: 'output', text }, { type: 'hang' }];
  const git = (repo: string, ...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  async function commit(repo: string, files: Record<string, string>, message: string) {
    for (const [path, content] of Object.entries(files)) await writeFile(join(repo, path), content);
    git(repo, 'add', ...Object.keys(files));
    git(repo, '-c', 'user.name=Helm Demo', '-c', 'user.email=demo@helm.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', message);
  }
  async function project(name: string, files: Record<string, string>, initialize = true) {
    const repo = join(fixture.directory, name);
    await mkdir(repo);
    if (initialize) {
      git(fixture.directory, 'init', '-b', 'main', repo);
      await commit(repo, files, 'Demo baseline');
    } else for (const [path, content] of Object.entries(files)) await writeFile(join(repo, path), content);
    return { repo, id: (await call('register-project', { path: repo, name })).id as string };
  }

  // Keep waiting agents and the current native plan stable for a long inspection session (24.8 days).
  await call('set-concurrency', { limit: 24 });
  await call('set-dispatch-watchdog', { wallTimeoutMs: 2147483647, idleTimeoutMs: 2147483647 });
  await call('set-round-watchdog', { totalTimeoutMs: 2147483647, idleTimeoutMs: 2147483647 });
  console.log(`演示服务：${fixture.url}\n临时目录：${fixture.directory}\n正在准备演示数据…`);

  const aligning = await create('演示 01 · 对齐中：工作说明 v2 与新增条目', undefined, false);
  await run(aligning, [draft(2), tool('send-message', { workId: aligning, key: 'brief-updated', body: '第二版新增了主题和窄屏检查，请确认最新版工作说明。' })]);

  const active = await create('演示 02 · 执行中：九张卡片、决策关卡、打回与 Token');
  await run(active, [
    card('done', '基础接口'), card('run', '表单实现'), card('verify', '可访问性检查', { needsVerification: true }),
    card('failed', '过期校验', { needsVerification: true }), card('blocked', '外部接口'),
    card('join', '整体验收', { aggregate: true, needsVerification: true }), card('skipped', '旧存储方案'),
    card('cancelled', '旧导出入口'), card('gated', '存储适配'),
    gate('pending', '演示：请选择数据存储方案'), gate('decided', '演示：历史上已决定的存储选择'), gate('withdrawn', '演示：旧方案确认（稍后撤回）'),
    dependency('done', 'run'), dependency('run', 'join'), dependency('verify', 'join'), dependency('skipped', 'join'),
    dependency('pending', 'gated', 'gate'), dependency('decided', 'run', 'gate'), dependency('withdrawn', 'skipped', 'gate'),
    tool('withdraw-gate', ctx => ({ workId: active, gateId: savedId(ctx, 'withdrawn'), reason: '旧方案撤回，后续卡片自动跳过。' })),
    tool('cancel-card', ctx => ({ workId: active, cardId: savedId(ctx, 'cancelled'), reason: '已由新入口替代' })),
    tool('write-coordinator-notes', { workId: active, body: '第二轮：并行实现表单和检查，整体验收等待汇合；撤回旧方案。' }),
  ]);
  const activeCards = await cards(active);
  const decided = (await graph(active)).find(node => node.key === 'decided');
  await call('decide-gate', { workId: active, gateId: decided.id, decision: 'SQLite（推荐）' });
  await dispatch(active, activeCards.done.id, execution('api.txt'));
  await run(active, [tool('complete-card', { workId: active, cardId: activeCards.done.id })]);
  await dispatch(active, activeCards.run.id, held('正在实现表单字段与提交反馈；此派单保持运行供检查。'), 'execution', true);
  await dispatch(active, activeCards.verify.id, held('正在核对可访问性标准；此验收保持运行供检查。'), 'verification', true);
  await dispatch(active, activeCards.blocked.id, [conclusion('blocked', '缺少外部接口测试凭据，请用户提供。'), end(false)]);
  await dispatch(active, activeCards.failed.id, execution('expiry.txt', '首版校验\n'));
  await dispatch(active, activeCards.failed.id, [conclusion('failed', '过期验证码仍可登录。'), end()], 'verification');
  await dispatch(active, activeCards.failed.id, execution('expiry.txt', '打回后的第二版校验\n'));
  await dispatch(active, activeCards.failed.id, [conclusion('failed', '修复后仍未覆盖时钟偏移边界。'), end()], 'verification');
  await run(active, [tool('write-coordinator-notes', { workId: active, body: '第三轮：校验已打回一次，仍有时钟偏移问题；缺少外部凭据。待用户决定存储，再做汇合验收。' })]);

  const many = await create('演示 03 · 执行中：六张活卡片，检查现在条合并');
  await run(many, Array.from({ length: 6 }, (_, index) => card(`parallel-${index}`, `并行卡片 ${index + 1} · ${index < 4 ? '执行中' : index === 4 ? '验收中' : '验收未过'}`, { readOnly: true })));
  const manyCards = Object.values(await cards(many));
  for (const [index, item] of manyCards.entries()) {
    await dispatch(many, item.id, index === 5 ? [conclusion('failed', '演示未通过的验收结果。'), end()] : held(`并行步骤 ${index + 1}：保持活动，检查合并状态格。`),
      index < 4 ? 'execution' : 'verification', index !== 5);
  }

  const multi = await create('演示 04 · 多选关卡：选择本次覆盖范围（ADR 0020）', undefined, false);
  await run(multi, [gate('coverage', '演示：本次需要检查哪些界面？（可多选）', true)]);

  async function review(title: string, projectId = fixture.project.id, files: Record<string, string> = { 'result.txt': '演示实现已完成\n' }, reservations = false) {
    const workId = await create(title, projectId);
    await run(workId, [card('delivery', '交付实现与检查', { needsVerification: true })]);
    const item = (await cards(workId)).delivery;
    const executionSteps: FakeStep[] = Object.entries(files).flatMap(([path, content]) => [{ type: 'write', path, content }, { type: 'artifact', kind: 'file', path }] as FakeStep[]);
    const executed = await dispatch(workId, item.id, [...executionSteps, conclusion('completed', '交付改动已完成，成果已登记。'), end()]);
    const verified = await dispatch(workId, item.id, [conclusion('passed', '演示范围内的实现检查通过；保留项见报告。'), end()], 'verification');
    const evidence = [{ label: '执行成果与最终回答', kind: 'dispatch' as const, ref: executed.id }, { label: '验收记录', kind: 'dispatch' as const, ref: verified.id }];
    const report: ReviewReport = {
      verdict: reservations ? 'reservations' : 'accept', summary: reservations ? '主要功能已完成；导出格式未满足约定，真实服务兼容性尚未验证，建议有保留接受。' : '演示改动已实现且验收通过，可以接受并合入。',
      exceptions: reservations ? [
        { kind: 'unmet', what: '尚未提供 CSV 导出', why: '当前仅交付文本格式，未满足导出标准。', evidence },
        { kind: 'unverified', what: '真实外部服务兼容性', why: '本演示只用 FakeDriver，没有外部服务凭据。', evidence },
        { kind: 'truncated', what: '只覆盖本机演示场景', why: '未扩展到所有系统和设备组合。', evidence },
      ] : [],
      criteria: [{ criterion: '本机演示成果可读取', status: 'passed', evidence }, ...(reservations ? [
        { criterion: 'CSV 导出', status: 'unmet' as const, evidence }, { criterion: '真实服务兼容性', status: 'unverified' as const, evidence },
      ] : [])],
      cards: [{ cardId: item.id, title: item.content, result: '演示实现完成', verification: 'passed', evidence,
        dispatches: [{ agentId: 'claude-executor', dispatchId: executed.id }, { agentId: 'claude-executor', dispatchId: verified.id }] }],
      suggestions: reservations ? ['接受前确认保留项，或退回调度者补齐导出和真实服务验证。'] : [],
    };
    await run(workId, [tool('complete-card', { workId, cardId: item.id }), tool('request-review', { workId, key: 'review', report })]);
    const gate = (await call('get-conversation', { workId })).find((node: any) => node.kind === 'review');
    return { workId, gateId: gate.id as string };
  }
  const accept = (item: { workId: string; gateId: string }) => call('decide-gate', { ...item, decision: 'accept' });
  await review('演示 05 · 待审核：有保留，含未满足与未验证（ADR 0013）', undefined, undefined, true);
  await accept(await review('演示 06 · 已接受：等待合入', undefined, { 'accepted.txt': '等待用户单独合入\n' }));

  const conflictProject = await project('演示冲突项目', { 'shared.txt': 'baseline\n', 'settings.txt': 'baseline\n' });
  const conflict = await review('演示 07 · 合入冲突：两个真实冲突文件', conflictProject.id, { 'shared.txt': 'work version\n', 'settings.txt': 'work setting\n' });
  await commit(conflictProject.repo, { 'shared.txt': 'base version\n', 'settings.txt': 'base setting\n' }, 'Independent base changes');
  await accept(conflict);
  await call('merge-work', { workId: conflict.workId });
  const conflicted = await call('get-work', { workId: conflict.workId });
  assert.equal(conflicted.delivery.merge.status, 'conflict');
  assert.equal(conflicted.delivery.merge.conflictFiles.length, 2);

  const deliveryProject = await project('演示交付项目', { 'README.md': 'delivery baseline\n' });
  const remote = join(fixture.directory, 'local-remote.git');
  git(fixture.directory, 'init', '--bare', remote);
  git(deliveryProject.repo, 'remote', 'add', 'origin', remote);
  git(deliveryProject.repo, 'push', '-u', 'origin', 'main');
  const merged = await review('演示 08 · 已完成且已合入：有待推送提交', deliveryProject.id, { 'merged.txt': 'merged demo\n' });
  await accept(merged);
  await call('merge-work', { workId: merged.workId });
  assert((await call('get-work-push-preview', { workId: merged.workId })).commits.length > 0);
  const failedPush = await review('演示 08b · 已完成且已合入：本机不可达远端，推送失败', deliveryProject.id, { 'push-failed.txt': 'failed push demo\n' });
  await accept(failedPush);
  await call('merge-work', { workId: failedPush.workId });
  // A missing local path fails immediately without contacting any network remote.
  git(deliveryProject.repo, 'remote', 'set-url', '--push', 'origin', join(fixture.directory, 'missing-remote.git'));
  await call('push-work', { workId: failedPush.workId });
  assert.equal((await call('get-work', { workId: failedPush.workId })).delivery.push.status, 'failed');

  const paused = await create('演示 09 · 已暂停：可恢复的安静工作');
  await call('pause-work', { workId: paused });
  const cancelled = await create('演示 09b · 已取消：安静段历史工作', undefined, false);
  await call('cancel-work', { workId: cancelled });

  const plain = await project('演示非 git 项目', { 'README.md': '尚未初始化 git 的演示目录\n', '.env': 'DEMO_ONLY=placeholder\n' }, false);
  const initialization = await create('演示 10 · 初始化 git：非 git 项目首次写入前', plain.id);
  await run(initialization, [card('first-write', '首次写入：等待用户同意初始化 git'), {
    type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: initialization, cardId: savedId(ctx, 'first-write'), key: 'initial-write', agentId: 'claude-executor', needsBrowser: false }),
    check: value => {
      try { assert.equal((value as any).error.code, 'GIT_INITIALIZATION_PENDING'); }
      catch (error) { scriptFailure = error as Error; throw error; }
    },
  }]);
  assert((await call('list-pending')).some((node: any) => node.kind === 'git-initialization' && node.workId === initialization));

  // Last round stays active with a native plan and real output steps for the coordinator inspector.
  stages.set(active, [
    tool('write-coordinator-notes', { workId: active, body: '最后一轮：核对所有分支与例外，等待存储决定；下一步处理打回和汇合验收。演示派单保持活动。' }),
    { type: 'plan', entries: [
      { content: '核对已完成卡片与打回记录', status: 'completed' }, { content: '等待存储关卡与外部凭据', status: 'in_progress' }, { content: '继续修复并做汇合验收', status: 'pending' },
    ] },
    { type: 'output', text: '已核对九张卡片；缺少外部凭据，存储方案待用户决定。' }, { type: 'hang' },
  ]);
  await call('send-message', { workId: active, key: 'native-plan', body: '请保留当前计划与步骤，供界面检查。' });
  await wait('等待原生计划', () => call('list-rounds', { workId: active }), value => value.currentPlan.length === 3);

  const works = await call('list-works');
  assert.equal(works.length, 12);
  console.log(`\n演示数据已就绪：${fixture.url}`);
  for (const work of works) console.log(`${work.status.padEnd(15)} ${work.title}\n  ${fixture.url}/works/${work.id}`);
  console.log('\n所有驱动均为 FakeDriver。Ctrl+C / SIGTERM 停止并删除全部临时数据。');
}

void main().catch(async error => {
  if (stopping) return;
  console.error('演示启动失败：', error);
  process.exitCode = 1;
  try { await close(); } catch (cleanupError) { console.error('演示清理失败：', cleanupError); }
});
