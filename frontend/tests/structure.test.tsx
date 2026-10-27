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

test('泳道显示并行及打回，事件经接口筛选后跳到历史派单步骤，检查器保留选择', async () => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  const advance: FakeScript = ctx => JSON.parse(ctx.input).newEvents
    .filter((event: any) => event.action === 'dispatch-ended' && ['first', 'verify'].includes(event.details.key))
    .map((event: any): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: { workId: workId(ctx), cardId: event.details.cardId,
      key: event.details.key === 'first' ? 'verify' : 'repair', purpose: event.details.key === 'first' ? 'verification' : 'execution', agentId: 'claude-executor' }, check: ok }));
  const createCard = (key: string, content: string): FakeStep => ({ type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key, content }), saveAs: key, check: ok });
  const dispatch = (key: string, card: string): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx),
    cardId: (ctx.results.get(card) as any).result.id, key, agentId: 'claude-executor' }), check: ok });
  daemon = await uiFixture([[draft], [createCard('login', '验证码登录'), createCard('mail', '发送邮件'), dispatch('first', 'login'), dispatch('parallel', 'mail')],
    ...Array<FakeScript>(12).fill(advance)], undefined, { executorScripts: [
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'completed', reason: '首版完成' }, check: ok }],
    [{ type: 'output', text: '邮件并行处理中' }, { type: 'hang', until: hold }],
    [...Array.from({ length: 24 }, (_, index): FakeStep => ({ type: 'output', text: `验收步骤 ${index + 1}` })),
      { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: '验证码过期检查缺失' }, check: ok }],
    [{ type: 'output', text: '修复验证码过期检查' }, { type: 'hang', until: hold }],
  ] });
  try {
    const work = await executeWork();
    const history = (await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.length === 4 && value.result.at(-1).status === 'running')).result;
    const filters: Record<string, string>[] = [];
    const pages: { dispatchId: string; fromStep: number; toStep: number }[] = [];
    const transport: typeof fetch = (input, init) => {
      if (String(input).endsWith('/api/get-events')) filters.push(JSON.parse(String(init?.body)));
      if (String(input).endsWith('/api/get-dispatch-output')) pages.push(JSON.parse(String(init?.body)));
      return fetch(input, init);
    };
    render(<App baseUrl={daemon.url} transport={transport} />);
    await clickReady(await screen.findByRole('tab', { name: '时间线' }));
    const panel = screen.getByRole('tabpanel', { name: '时间线' });
    const lanes = await within(panel).findAllByRole('group', { name: /^卡片 \d+：/ });
    expect(lanes).toHaveLength(2);
    const lane = within(panel).getByRole('group', { name: '卡片 1：验证码登录' });
    expect(within(lane).getByRole('button', { name: '派单 #2 · 验收 ✗' })).toBeTruthy();
    const repair = within(lane).getByRole('button', { name: '派单 #3 · ↺ 执行' });
    expect(within(panel).getByText('验收 ✗ → ↺ 执行')).toBeTruthy();
    const clock = within(panel).getByRole('time', { name: '现在' });
    const firstTime = clock.getAttribute('datetime');
    await waitFor(() => expect(clock.getAttribute('datetime')).not.toBe(firstTime));
    await clickReady(repair);
    const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
    expect(await within(inspector).findByText('修复验证码过期检查')).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: '派单 #3 · 执行' }).getAttribute('aria-pressed')).toBe('true');
    await clickReady(within(lane).getByRole('button', { name: '派单 #2 · 验收 ✗' }));
    expect(await within(inspector).findByText('验证码过期检查缺失')).toBeTruthy();
    expect(within(inspector).getByRole('button', { name: '派单 #2 · 验收' }).getAttribute('aria-pressed')).toBe('true');
    await clickReady(screen.getByRole('tab', { name: '事件' }));
    const events = screen.getByRole('tabpanel', { name: '事件' });
    const verification = history.find((dispatch: any) => dispatch.purpose === 'verification');
    fireEvent.change(within(events).getByLabelText('卡片筛选'), { target: { value: verification.cardId } });
    fireEvent.change(within(events).getByLabelText('派单筛选'), { target: { value: verification.id } });
    fireEvent.change(within(events).getByLabelText('执行方筛选'), { target: { value: 'runtime' } });
    const event = await within(events).findByRole('button', { name: 'dispatch-step · 卡片 1 · 步骤 24' });
    expect(filters.some(filter => filter.cardId === verification.cardId && filter.dispatchId === verification.id && filter.actorType === 'runtime')).toBe(true);
    expect(within(events).queryByRole('button', { name: /卡片 2/ })).toBeNull();
    await clickReady(event);
    const output = await within(inspector).findByRole('region', { name: '派单输出' });
    expect(await within(output).findByText('验收步骤 24')).toBeTruthy();
    expect(within(output).queryByText('验收步骤 1')).toBeNull();
    expect((within(output).getByLabelText('从步骤') as HTMLInputElement).value).toBe('24');
    expect(pages.some(page => page.dispatchId === verification.id && page.fromStep === 24 && page.toStep === 43)).toBe(true);
    expect(document.activeElement?.textContent).toContain('验收步骤 24');
    fireEvent.change(within(events).getByLabelText('执行方筛选'), { target: { value: 'user' } });
    expect(await within(events).findByText('没有符合筛选条件的事件。')).toBeTruthy();
    await clickReady(within(events).getByRole('button', { name: '清除筛选' }));
    expect(await within(events).findByRole('button', { name: 'dispatch-step · 卡片 1 · 步骤 24' })).toBeTruthy();
    await clickReady(screen.getByRole('tab', { name: '图' }));
    expect(within(inspector).getByRole('button', { name: '派单 #2 · 验收' }).getAttribute('aria-pressed')).toBe('true');
    await clickReady(screen.getByRole('tab', { name: '时间线' }));
    const roundBlock = await waitFor(() => {
      const block = screen.getByRole('tabpanel', { name: '时间线' }).querySelector<HTMLButtonElement>('.cs-round-lane button');
      expect(block).not.toBeNull(); return block!;
    });
    await clickReady(roundBlock);
    expect(screen.getByRole('tab', { name: '调度者' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '调度者' }));
  } finally { finish(); }
});
const workId = (ctx: FakeContext): string => JSON.parse(ctx.input).work.id;
const ok = (value: unknown) => expect((value as { ok: boolean }).ok).toBe(true);
const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workId(ctx), key: 'brief',
  requirements: '追溯调度结构', boundary: '本机', criteria: '时间、轮次、事件可查' }), check: ok };
async function executeWork() {
  const work = (await daemon!.call('send-message', { projectId: daemon!.project.id, body: '调度结构工作', key: 'start' })).result.work;
  const pending = await until(() => daemon!.call('list-pending'), value => value.result[0]?.description);
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  const gate = pending.result[0];
  ok(await daemon!.call('decide-gate', { workId: work.id, gateId: gate.id, descriptionId: gate.description.id, decision: 'confirm' }));
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  return work;
}
async function clickReady(button: HTMLElement) {
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
}

test('调度者标签查看运行状态、历史轮次分页输出与调度笔记版本，实时更新并支持键盘标签', async () => {
  let finish!: () => void;
  const hold = new Promise<void>(resolve => { finish = resolve; });
  daemon = await uiFixture([[{ type: 'output', text: '第一轮对齐决策' }, draft], [
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workId(ctx), body: '先做接口' }), check: ok },
    { type: 'tool', name: 'write-coordinator-notes', arguments: ctx => ({ workId: workId(ctx), body: '接口通过后做表单' }), check: ok },
    ...Array.from({ length: 24 }, (_, index): FakeStep => ({ type: 'output', text: `调度输出 ${index + 1}` })),
    { type: 'hang', until: hold }, { type: 'end', reason: 'completed', usage: { inputTokens: 872308, outputTokens: 12345 } },
  ]]);
  try {
    await executeWork();
    const pages: { fromStep?: number; toStep?: number }[] = [];
    const transport: typeof fetch = (input, init) => {
      if (String(input).endsWith('/api/get-round-output')) pages.push(JSON.parse(String(init?.body)));
      return fetch(input, init);
    };
    render(<App baseUrl={daemon.url} transport={transport} />);
    const tabs = await screen.findByRole('tablist', { name: '调度结构' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['图', '时间线', '调度者', '事件']);
    await clickReady(within(tabs).getByRole('tab', { name: '调度者' }));
    const panel = screen.getByRole('tabpanel', { name: '调度者' });
    await waitFor(() => expect(within(panel).getByRole('status').textContent).toBe('运行中'));
    expect(await within(panel).findByText('接口通过后做表单')).toBeTruthy();
    fireEvent.change(within(panel).getByLabelText('调度笔记版本'), { target: { value: '1' } });
    expect(await within(panel).findByText('先做接口')).toBeTruthy();
    const output = await within(panel).findByRole('region', { name: '调度轮次输出' });
    expect(await within(output).findByText('调度输出 1')).toBeTruthy();
    expect(within(output).queryByText('调度输出 24')).toBeNull();
    await clickReady(within(output).getByRole('button', { name: '下一页步骤' }));
    expect(await within(output).findByText('调度输出 24')).toBeTruthy();
    expect(pages.some(page => page.fromStep === 21 && page.toStep === 40)).toBe(true);
    expect(pages.every(page => page.fromStep && page.toStep && page.toStep - page.fromStep < 20)).toBe(true);
    await clickReady(within(panel).getByRole('button', { name: '调度轮次 #1' }));
    expect(await within(panel).findByText('第一轮对齐决策')).toBeTruthy();
    await clickReady(within(panel).getByRole('button', { name: '调度轮次 #2' }));
    finish();
    expect(await within(panel).findByText('空闲')).toBeTruthy();
    expect(await within(panel).findByText('87.2万 / 1.23万')).toBeTruthy();
    expect(within(panel).getByTitle('872308 / 12345').textContent).toBe('87.2万 / 1.23万');
    const inboxTokens = await screen.findByTitle('tokens: 884653');
    expect(inboxTokens.textContent).toBe('◇ 88.5万');
    await clickReady(screen.getByRole('button', { name: 'EN' }));
    expect(within(panel).getByTitle('872308 / 12345').textContent).toBe('872K / 12.3K');
    expect(screen.getByTitle('tokens: 884653').textContent).toBe('◇ 885K');
    await clickReady(screen.getByRole('button', { name: '中文' }));
    // Focus moves without activating a remote panel; Enter/Space activates the focused tab.
    const coordinatorTab = within(tabs).getByRole('tab', { name: '调度者' });
    coordinatorTab.focus();
    fireEvent.keyDown(coordinatorTab, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(within(tabs).getByRole('tab', { name: '时间线' }));
    expect(coordinatorTab.getAttribute('aria-selected')).toBe('true');
    await clickReady(within(tabs).getByRole('tab', { name: '时间线' }));
    expect(screen.getByRole('tabpanel', { name: '时间线' })).toBeTruthy();
    await clickReady(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('tab', { name: 'Coordinator' })).toBeTruthy();
  } finally { finish(); }
});

test('无卡片和笔记时显示空态，事件读取错误可重试，轮次输出删除后显示已删除', async () => {
  daemon = await uiFixture([[draft], []]);
  const work = await executeWork();
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[1]?.status === 'ended');
  let fail = true;
  const transport: typeof fetch = (input, init) => {
    if (String(input).endsWith('/api/get-events') && fail) return Promise.reject(new Error('读取事件连接失败'));
    return fetch(input, init);
  };
  render(<App baseUrl={daemon.url} transport={transport} />);
  await clickReady(await screen.findByRole('tab', { name: '时间线' }));
  expect(await screen.findByText('调度者还没有创建卡片。')).toBeTruthy();
  await clickReady(screen.getByRole('tab', { name: '事件' }));
  const events = screen.getByRole('tabpanel', { name: '事件' });
  expect((await within(events).findByRole('alert')).textContent).toContain('读取事件连接失败');
  fail = false;
  await clickReady(within(events).getByRole('button', { name: '重新读取' }));
  expect(await within(events).findByText('work-created')).toBeTruthy();
  await clickReady(screen.getByRole('tab', { name: '调度者' }));
  const coordinator = screen.getByRole('tabpanel', { name: '调度者' });
  expect(await within(coordinator).findByText('还没有调度笔记。')).toBeTruthy();
  ok(await daemon.call('cancel-work', { workId: work.id }));
  ok(await daemon.call('delete-outputs', { workId: work.id, confirm: true }));
  expect(await within(coordinator).findByText('已删除')).toBeTruthy();
});

test('调度者连续失败后从工作和轮次读取连败暂停与原始原因', async () => {
  daemon = await uiFixture([[draft], ...Array<FakeScript>(3).fill([{ type: 'end', reason: 'error' }])]);
  const work = await executeWork();
  await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.runtimePauseReason === '调度者连续失败 3 次');
  render(<App baseUrl={daemon.url} />);
  await clickReady(await screen.findByRole('tab', { name: '调度者' }));
  const coordinator = screen.getByRole('tabpanel', { name: '调度者' });
  expect(await within(coordinator).findByText('连败暂停')).toBeTruthy();
  expect(await within(coordinator).findByText('调度者连续失败 3 次')).toBeTruthy();
  expect(within(coordinator).getAllByText('出错退出')).toHaveLength(3);
});
