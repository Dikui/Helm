import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeContext, FakeScript, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

test('派单打回回路、步骤分页及成果可查，派单结束经 SSE 同步更新卡片与检查器', async () => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const nextDispatch: FakeScript = ctx => {
    const ended = JSON.parse(ctx.input).wakeEvents.filter((event: any) => event.action === 'dispatch-ended').at(-1)?.details;
    if (!ended || ended.key === 'repair') return [];
    return [{ type: 'tool', name: 'create-dispatch', arguments: { workId: workId(ctx), cardId: ended.cardId,
      key: ended.key === 'first' ? 'verify' : 'repair', purpose: ended.key === 'first' ? 'verification' : 'execution', agentId: 'claude-executor',
    }, check: ok }];
  };
  daemon = await uiFixture([[draft], [card('login', '验证码登录'), {
    type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'login'), key: 'first', agentId: 'claude-executor' }), check: ok,
  }], ...Array<FakeScript>(12).fill(nextDispatch)], undefined, { executorScripts: [
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '首版已实现' }, check: ok }, { type: 'end', reason: 'completed', finalAnswer: '第一版实现' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: '过期验证码仍能登录' }, check: ok }, { type: 'end', reason: 'completed', finalAnswer: '请修复过期校验' }],
    [...Array.from({ length: 24 }, (_, index): FakeStep => ({ type: 'output', text: `修复步骤 ${index + 1}` })),
      { type: 'write', path: 'login.txt', content: '验证码过期校验已实现\n' },
      { type: 'write', path: 'tests.txt', content: 'tests: 2; pass: 2\n' },
      { type: 'artifact', kind: 'test-output', path: 'tests.txt' },
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '边界检查通过' }, check: ok },
      { type: 'output', text: '修复中，等待结果' }, { type: 'hang', until: hold },
      { type: 'end', reason: 'completed', finalAnswer: '修复完成，测试全通过' },
    ],
  ] });
  try {
    const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '卡片图工作', key: 'start' })).result.work;
    const pages: { fromStep?: number; toStep?: number }[] = [];
    const transport: typeof fetch = (input, init) => {
      if (String(input).endsWith('/api/get-dispatch-output')) pages.push(JSON.parse(String(init?.body)));
      return fetch(input, init);
    };
    window.history.replaceState(null, '', `/works/${work.id}/structure`);
    render(<App baseUrl={daemon.url} transport={transport} />);
    await screen.findByText('实时更新已连接');
    const pending = await until(() => daemon!.call('list-pending'), value => value.result[0]?.description);
    const gate = pending.result[0];
    ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
    const graph = await screen.findByRole('region', { name: '卡片图' });
    const node = await within(graph).findByRole('button', { name: '卡片 1：验证码登录' });
    // This waits for execution, verification, and a coordinator round before the repair dispatch.
    await waitFor(() => expect(node.textContent).toContain('↺ 1'), { timeout: 10_000 });
    await waitFor(() => expect(node.title).toContain('修复中，等待结果'), { timeout: 5_000 });
    expect(node.title).toContain('claude-executor');
    expect(node.title).toContain('步骤 29');
    expect(node.title).toContain('修复中，等待结果');
    fireEvent.click(node);
    const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
    expect(await within(inspector).findByText('过期验证码仍能登录')).toBeTruthy();
    expect(within(inspector).getByText('↺ 调度者打回，同一张卡片重新执行')).toBeTruthy();
    fireEvent.click(within(inspector).getByRole('button', { name: '派单 #3 · 执行' }));
    expect(await within(inspector).findByText('修复步骤 1')).toBeTruthy();
    expect(within(inspector).queryByText('修复步骤 21')).toBeNull();
    fireEvent.click(within(inspector).getByRole('button', { name: '下一页步骤' }));
    expect(await within(inspector).findByText('修复步骤 21')).toBeTruthy();
    expect(pages.some(page => page.fromStep === 21 && page.toStep === 40)).toBe(true);
    expect(pages.every(page => page.fromStep && page.toStep && page.toStep - page.fromStep < 20)).toBe(true);
    fireEvent.click(await within(inspector).findByRole('button', { name: '读取成果：tests.txt' }));
    expect(await within(inspector).findByText('tests: 2; pass: 2')).toBeTruthy();
    finish();
    await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.at(-1)?.status === 'ended');
    await waitFor(() => expect(node.title).toContain('修复完成，测试全通过'), { timeout: 5_000 });
    expect(await within(inspector).findByText('修复完成，测试全通过', { selector: 'p' })).toBeTruthy();
    expect(within(inspector).getAllByText('正常完成').length).toBeGreaterThan(0);
    expect(within(inspector).getAllByText('边界检查通过').length).toBeGreaterThan(0);
    fireEvent.click(await within(inspector).findByRole('button', { name: '读取成果：login.txt' }));
    expect(await within(inspector).findByText('验证码过期校验已实现')).toBeTruthy();
    expect(within(inspector).getAllByText(/helm-card\//).length).toBeGreaterThan(0);
    expect(within(inspector).getByText('别在副本目录开终端，看代码去工作分支。')).toBeTruthy();
    fireEvent.click(within(inspector).getByRole('button', { name: '派单 #2 · 验收' }));
    expect(await within(inspector).findByText('请修复过期校验')).toBeTruthy();
  } finally { finish(); }
}, 30_000);

test('卡片操作被运行层拒绝时显示原始原因，重连后读取真实终态', async () => {
  daemon = await uiFixture([[draft], [card('stale', '操作中的卡片')]]);
  const work = await executeWork();
  const nodes = await until(() => daemon!.call('get-card-graph', { workId: work.id }), value => value.result.some((node: any) => node.type === 'card'));
  const cardId = nodes.result.find((node: any) => node.type === 'card').id;
  let online = true;
  let stream: AbortController | undefined;
  const transport: typeof fetch = (input, init) => {
    if (!String(input).endsWith('/events')) return fetch(input, init);
    if (!online) return Promise.reject(new Error('Offline'));
    const controller = new AbortController(); stream = controller;
    init?.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    return fetch(input, { ...init, signal: controller.signal });
  };
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  fireEvent.click(await within(graph).findByRole('button', { name: '卡片 1：操作中的卡片' }));
  const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
  await within(inspector).findByText('还没有派单。');
  online = false; stream?.abort();
  await screen.findByText('连接已断开，正在重连…');
  ok(await daemon.call('cancel-card', { workId: work.id, cardId, reason: '已换方案' }));
  fireEvent.click(within(inspector).getByRole('button', { name: '暂停卡片' }));
  expect((await within(inspector).findByRole('alert')).textContent).toContain('完成或已取消的卡片不能再修改。');
  online = true;
  await waitFor(() => expect(within(graph).getByRole('button', { name: '卡片 1：操作中的卡片' }).textContent).toContain('已取消'), { timeout: 5_000 });
  expect(within(inspector).queryByRole('button', { name: '暂停卡片' })).toBeNull();
});

const workId = (ctx: FakeContext): string => JSON.parse(ctx.input).work.id;
const savedId = (ctx: FakeContext, key: string): string => (ctx.results.get(key) as { result: { id: string } }).result.id;
const ok = (value: unknown) => expect((value as { ok: boolean }).ok).toBe(true);
const draft: FakeStep = {
  type: 'tool', name: 'draft-work-description', arguments: ctx => ({
    workId: workId(ctx), key: 'brief', requirements: '查看卡片图', boundary: '本机', criteria: '结构和派单可追溯',
  }), check: ok,
};
const card = (key: string, content: string): FakeStep => ({
  type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key, content }), saveAs: key, check: ok,
});
const dependency = (upstream: string, downstream: string, type: 'card' | 'gate' = 'card'): FakeStep => ({
  type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workId(ctx),
    upstream: { type, id: savedId(ctx, upstream) }, downstream: { type: 'card', id: savedId(ctx, downstream) },
  }), check: ok,
});
async function executeWork() {
  const work = (await daemon!.call('send-message', { projectId: daemon!.project.id, body: '卡片图工作', key: 'start' })).result.work;
  const pending = await until(() => daemon!.call('list-pending'), value => value.result[0]?.description);
  const gate = pending.result[0];
  ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  return work;
}

test('卡片图显示并行依赖汇合、关卡与取消卡片，选择节点查看关系', async () => {
  daemon = await uiFixture([[draft], [
    card('api', '接通接口'), card('form', '实现表单'), card('join', '集成检查'), card('old', '废弃方案'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'choice', question: '选择发布时机', body: '等待用户决定', options: ['confirm', '稍后'] }), saveAs: 'choice', check: ok },
    dependency('api', 'join'), dependency('form', 'join'), dependency('choice', 'join', 'gate'),
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'old'), reason: '由新方案替代' }), check: ok },
  ]]);
  const work = await executeWork();
  await until(() => daemon!.call('get-card-graph', { workId: work.id }), value => value.result.some((node: any) => node.status === 'cancelled'));
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const gates = (await daemon.call('get-card-graph', { workId: work.id })).result.filter((node: any) => node.type === 'gate');
  const confirmation = gates.find((node: any) => node.kind === 'work-confirmation');
  const confirmationNode = await within(graph).findByRole('button', { name: `关卡：${confirmation.question}` });
  expect(confirmationNode.textContent).toContain('已确认');
  expect(confirmationNode.title).toContain('已确认');
  fireEvent.click(confirmationNode);
  expect(within(screen.getByRole('complementary', { name: '关卡检查器' })).getByText('已确认', { selector: 'p' })).toBeTruthy();
  expect(await within(graph).findByRole('button', { name: /卡片 \d+：接通接口/ })).toBeTruthy();
  expect(within(graph).getByRole('button', { name: /卡片 \d+：实现表单/ })).toBeTruthy();
  expect(within(graph).getByRole('button', { name: '关卡：选择发布时机' }).textContent).toContain('待你决定');
  expect(within(graph).getByRole('button', { name: /卡片 \d+：废弃方案/ }).textContent).toContain('已取消');
  expect(within(graph).getByRole('img', { name: '依赖：接通接口 → 集成检查' })).toBeTruthy();
  expect(within(graph).getByRole('img', { name: '依赖：实现表单 → 集成检查' })).toBeTruthy();
  expect(within(graph).getByRole('img', { name: '依赖：选择发布时机 → 集成检查' })).toBeTruthy();
  const zoom = within(graph).getByLabelText('缩放比例').textContent;
  fireEvent.click(within(graph).getByRole('button', { name: '放大' }));
  expect(within(graph).getByLabelText('缩放比例').textContent).not.toBe(zoom);
  fireEvent.click(within(graph).getByRole('button', { name: /卡片 \d+：集成检查/ }));
  const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
  expect(within(inspector).getByRole('heading', { name: '集成检查' })).toBeTruthy();
  expect(within(inspector).getByRole('button', { name: /接通接口/ })).toBeTruthy();
  expect(within(inspector).getByRole('button', { name: /实现表单/ })).toBeTruthy();
  expect(within(inspector).getByText('选择发布时机')).toBeTruthy();
  expect(await within(inspector).findByText('还没有派单。')).toBeTruthy();
  fireEvent.click(within(graph).getByRole('button', { name: '关卡：选择发布时机' }));
  expect(screen.getByRole('complementary', { name: '关卡检查器' }).textContent).toContain('等待用户决定');
  const choice = gates.find((node: any) => node.kind === 'general');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: choice.id, decision: 'confirm' }));
  await waitFor(() => expect(within(graph).getByRole('button', { name: '关卡：选择发布时机' }).title).toContain('confirm'));
  expect(within(screen.getByRole('complementary', { name: '关卡检查器' })).getByText('confirm', { selector: 'p' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('region', { name: 'Card graph' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Card \d+：接通接口/ })).toBeTruthy();
  expect(confirmationNode.title).toContain('Confirmed');
  fireEvent.click(confirmationNode);
  expect(within(screen.getByRole('complementary', { name: 'Gate inspector' })).getByText('Confirmed', { selector: 'p' })).toBeTruthy();
});

test('排队和运行中的派单结论显示占位符，结束后才显示未声明，支持中英文', async () => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const dispatch = (key: string): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({
    workId: workId(ctx), cardId: savedId(ctx, key), key: `${key}-dispatch`, agentId: 'claude-executor',
  }), check: ok });
  daemon = await uiFixture([[draft], [card('running', '运行卡片'), card('queued', '排队卡片'), dispatch('running'), dispatch('queued')]], undefined, {
    executorScripts: [[{ type: 'hang', until: hold }], [{ type: 'hang', until: hold }]],
  });
  ok(await daemon.call('set-concurrency', { limit: 1 }));
  try {
    const work = await executeWork();
    await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.length === 2 && value.result[0].status === 'running' && value.result[1].status === 'queued');
    window.history.replaceState(null, '', `/works/${work.id}/structure`);
    render(<App baseUrl={daemon.url} />);
    const graph = await screen.findByRole('region', { name: '卡片图' });
    for (const name of ['卡片 1：运行卡片', '卡片 2：排队卡片']) {
      fireEvent.click(await within(graph).findByRole('button', { name }));
      const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
      fireEvent.click(within(inspector).getByRole('button', { name: '派单 #1 · 执行' }));
      const detail = await within(inspector).findByRole('region', { name: '派单详情' });
      const label = await within(detail).findByText('自报结论');
      expect(label.nextElementSibling!.textContent).toBe('—');
      expect(within(inspector).getByText('claude-executor · —')).toBeTruthy();
      expect(inspector.textContent).not.toContain('未声明');
    }
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    const inspector = screen.getByRole('complementary', { name: 'Card inspector' });
    const detail = within(inspector).getByRole('region', { name: 'Dispatch details' });
    expect(within(detail).getByText('Self-reported conclusion').nextElementSibling!.textContent).toBe('—');
    finish();
    expect(await within(detail).findByText('Undeclared')).toBeTruthy();
    expect(await within(inspector).findByText('claude-executor · Undeclared')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '中文' }));
    expect(within(detail).getByText('未声明')).toBeTruthy();
    expect(within(inspector).getByText('claude-executor · 未声明')).toBeTruthy();
  } finally { finish(); }
});

test('检查器暂停和恢复卡片，取消前二次确认，关闭确认不改变状态', async () => {
  daemon = await uiFixture([[draft], [card('active', '正在执行的卡片'), {
    type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'active'), key: 'active-dispatch', agentId: 'claude-executor' }), check: ok,
  }]], undefined, { executorScripts: [[{ type: 'output', text: '等待用户操作' }, { type: 'hang' }]] });
  const work = await executeWork();
  const records = await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result[0]?.status === 'running');
  const dispatch = records.result[0];
  const cardState = async () => (await daemon!.call('get-card-graph', { workId: work.id })).result.find((node: any) => node.id === dispatch.cardId);
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  fireEvent.click(await within(graph).findByRole('button', { name: '卡片 1：正在执行的卡片' }));
  const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
  fireEvent.click(await within(inspector).findByRole('button', { name: '暂停卡片' }));
  await until(cardState, card => card.status === 'paused');
  const resume = await within(inspector).findByRole('button', { name: '恢复卡片' });
  await waitFor(() => expect((resume as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(resume);
  await until(cardState, card => card.status === 'executing');
  await waitFor(() => expect((within(inspector).getByRole('button', { name: '取消卡片' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(within(inspector).getByRole('button', { name: '取消卡片' }));
  let dialog = screen.getByRole('alertdialog', { name: '取消卡片：正在执行的卡片' });
  expect((await cardState()).status).toBe('executing');
  expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '保留卡片' }));
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(document.activeElement).toBe(within(inspector).getByRole('button', { name: '取消卡片' }));
  expect((await cardState()).status).toBe('executing');
  fireEvent.click(within(inspector).getByRole('button', { name: '取消卡片' }));
  dialog = screen.getByRole('alertdialog');
  fireEvent.change(within(dialog).getByLabelText('取消理由'), { target: { value: '' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认取消卡片' }));
  expect(within(dialog).getByRole('alert').textContent).toContain('请填写取消理由。');
  expect(document.activeElement).toBe(within(dialog).getByLabelText('取消理由'));
  expect((await cardState()).status).toBe('executing');
  fireEvent.change(within(dialog).getByLabelText('取消理由'), { target: { value: '改用其他方案' } });
  fireEvent.click(within(dialog).getByRole('button', { name: '确认取消卡片' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull(), { timeout: 5_000 });
  expect((await cardState()).status).toBe('cancelled');
  await waitFor(() => expect(within(graph).getByRole('button', { name: '卡片 1：正在执行的卡片' }).textContent).toContain('已取消'));
  expect(within(inspector).queryByRole('button', { name: '暂停卡片' })).toBeNull();
  const ended = (await daemon.call('get-dispatch', { workId: work.id, dispatchId: dispatch.id })).result;
  expect(ended.endReason).toBe('aborted');
  expect(ended.abortReason).toBe('卡片暂停');
  fireEvent.click(within(inspector).getByRole('button', { name: '派单 #1 · 执行' }));
  expect(await within(inspector).findByText('卡片暂停')).toBeTruthy();
});

test('跳过节点及致因、汇总标记、切断连线、泳道和摘要随中英切换正确显示', async () => {
  daemon = await uiFixture([[draft], [
    card('loser', '落选方案'), card('gated', '旧方向实现'), card('leaf', '旧方向测试'), card('other', '保留实现'),
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key: 'aggregate', content: '整体验收', aggregate: true, needsVerification: true }), saveAs: 'aggregate', check: value => { ok(value); expect((value as any).result.aggregate).toBe(true); } },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'choice', question: '旧方向确认' }), saveAs: 'choice', check: ok },
    dependency('choice', 'gated', 'gate'), dependency('gated', 'leaf'), dependency('loser', 'aggregate'), dependency('leaf', 'aggregate'), dependency('other', 'aggregate'),
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'loser'), reason: '落选' }), check: ok },
    { type: 'tool', name: 'withdraw-gate', arguments: ctx => ({ workId: workId(ctx), gateId: savedId(ctx, 'choice'), reason: '不再采用' }), check: ok },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'aggregate'), aggregate: false }), check: value => { ok(value); expect((value as any).result.status).toBe('skipped'); } },
    { type: 'tool', name: 'update-card', arguments: ctx => ({ workId: workId(ctx), cardId: savedId(ctx, 'aggregate'), aggregate: true }), check: value => { ok(value); expect((value as any).result.status).toBe('waiting'); } },
  ]]);
  const work = await executeWork();
  await until(() => daemon!.call('get-events', { workId: work.id }), value => value.result.filter((event: any) => event.action === 'card-updated').length === 2);
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const skipped = await within(graph).findByRole('button', { name: /卡片 \d+：旧方向实现/ });
  expect(skipped.classList.contains('skipped')).toBe(true);
  expect(within(skipped).getByTitle('已跳过 · 因「旧方向确认」撤回')).toBeTruthy();
  const leaf = within(graph).getByRole('button', { name: /卡片 \d+：旧方向测试/ });
  expect(within(leaf).getByTitle('已跳过 · 因「旧方向确认」撤回')).toBeTruthy();
  const aggregate = within(graph).getByRole('button', { name: /卡片 \d+：整体验收/ });
  expect(within(aggregate).getByText('汇总')).toBeTruthy();
  expect(aggregate.classList.contains('waiting')).toBe(true);
  for (const name of ['依赖：旧方向确认 → 旧方向实现', '依赖：旧方向实现 → 旧方向测试', '依赖：旧方向测试 → 整体验收']) {
    expect(within(graph).getByRole('img', { name }).classList.contains('cut')).toBe(true);
  }
  expect(within(graph).getByText('已取消 / 跳过')).toBeTruthy();
  expect(within(graph).getByText('上游取消或撤回，不执行')).toBeTruthy();
  expect(within(graph).getByText('不因单个上游取消而跳过')).toBeTruthy();
  expect(screen.getByText('张跳过').textContent).toBe('2 张跳过');
  fireEvent.click(screen.getByRole('tab', { name: '时间线' }));
  const timeline = screen.getByRole('tabpanel', { name: '时间线' });
  const lane = await within(timeline).findByRole('group', { name: /卡片 \d+：旧方向测试/ });
  expect(lane.classList.contains('skipped')).toBe(true);
  expect(within(lane).getByText('跳过').classList.contains('cg-skip-fill')).toBe(true);
  expect(within(lane).queryByText('还没有派单。')).toBeNull();
  expect(within(lane).getByRole('button', { name: '关卡撤回：旧方向确认' }).classList.contains('withdrawn')).toBe(true);
  expect(within(timeline).getByText('已跳过（上游取消或撤回）')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByText('skipped').textContent).toBe('2 skipped');
  expect(within(timeline).getByText('Skipped (upstream cancelled or withdrawn)')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: 'Graph' }));
  const english = screen.getByRole('region', { name: 'Card graph' });
  expect(within(english).getByText('Cancelled / skipped')).toBeTruthy();
  expect(within(english).getAllByTitle('Skipped · “旧方向确认” withdrawn').length).toBe(2);
  expect(within(english).getAllByText('Aggregate').length).toBe(2);
});


test('卡片图节点和卡片详情显示只读标记，随中英文切换显示', async () => {
  daemon = await uiFixture([[draft], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key: 'research', content: '调查现有行为', readOnly: true }), check: ok },
  ]]);
  const work = await executeWork();
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const node = await within(graph).findByRole('button', { name: /卡片 \d+：调查现有行为/ });
  expect(within(node).getByText('只读')).toBeTruthy();
  fireEvent.click(node);
  const detail = screen.getByRole('complementary', { name: '卡片检查器' });
  expect(within(detail).getByText('只读')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(node).getByText('Read-only')).toBeTruthy();
  expect(within(detail).getByText('Read-only')).toBeTruthy();
});
