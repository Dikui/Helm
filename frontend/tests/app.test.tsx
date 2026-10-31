import { reviewReport } from '../../tests/fixtures/review-report.js';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';

// 收件箱行点击会打开工作页，详情要用右侧按钮展开
function expandRow(text: HTMLElement) {
  const row = text.closest('.irow') as HTMLElement;
  const toggle = within(row).getByRole('button', { name: '展开详情' });
  if (toggle.getAttribute('aria-expanded') !== 'true') fireEvent.click(toggle);
  return row;
}
// Load the compiled Node fixture natively; Vite must not rewrite helmd's file URLs.
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => {
  cleanup();
  await daemon?.close();
  daemon = undefined;
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

test('整页读取真实 helmd：收件箱分组、搜索、SSE 更新及语言持久化', async () => {
  daemon = await uiFixture();
  const create = async (body: string, key: string) => (await daemon!.call('send-message', { projectId: daemon!.project.id, body, key })).result.work;
  const active = await create('登录页改版\n第二行不显示在标题', 'active');
  const ended = await create('整理 README', 'ended');
  await daemon.call('cancel-work', { workId: ended.id });
  render(<App baseUrl={daemon.url} />);
  const attention = await screen.findByRole('region', { name: '等你处理' });
  expect(await within(attention).findByText('登录页改版')).toBeTruthy();
  expect(within(screen.getByRole('region', { name: '已结束' })).getByText('整理 README')).toBeTruthy();
  expect(screen.getByLabelText('执行者并发')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索工作' }), { target: { value: 'README' } });
  expect(screen.queryByText('登录页改版')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await daemon.call('cancel-work', { workId: active.id });
  await waitFor(() => expect(within(screen.getByRole('region', { name: '已结束' })).getByText('登录页改版')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('region', { name: 'Ended' })).toBeTruthy();
  expect(screen.getByText('登录页改版')).toBeTruthy();
  expect(localStorage.getItem('helm.language')).toBe('en');
  cleanup();
  render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('region', { name: 'Ended' })).toBeTruthy();
});

// These scripts use the same MCP boundary as real coordinators.
const draft = (key: string): import('../../src/driver.js').FakeStep => ({
  type: 'tool', name: 'draft-work-description', arguments: ctx => ({
    workId: JSON.parse(ctx.input).work.id, key, requirements: `用户需求 ${key}`, boundary: '本机', criteria: '显示正确',
  }), check: value => expect((value as any).ok).toBe(true),
});

function controlledTransport() {
  const realFetch = fetch;
  let controller: AbortController | undefined;
  let online = true;
  const cursors: (string | null)[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (!String(input).endsWith('/events')) return realFetch(input, init);
    if (!online) throw new Error('Simulated connection loss');
    cursors.push(new Headers(init?.headers).get('Last-Event-ID'));
    controller = new AbortController();
    const current = controller;
    init?.signal?.addEventListener('abort', () => current.abort(), { once: true });
    return realFetch(input, { ...init, signal: current.signal });
  };
  return { transport, cursors, disconnect() { online = false; controller?.abort(); }, reconnect() { online = true; } };
}

test('点收件箱行打开工作页，右侧按钮只在列表里展开详情', async () => {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '点行打开', key: 'start' })).result.work;
  render(<App baseUrl={daemon.url} />);
  const title = await screen.findByText('点行打开');
  const row = expandRow(title);
  expect(window.location.pathname).toBe('/');
  expect(within(row).getByRole('button', { name: '展开详情' }).getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(title.closest('a')!);
  expect(window.location.pathname).toBe(`/works/${work.id}`);
  await waitFor(() => expect(row.classList.contains('current')).toBe(true));
});

test('断线后用 Last-Event-ID 补齐真实 helmd 的状态变化，并更新全局并发', async () => {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '断线中的工作', key: 'start' })).result.work;
  const network = controlledTransport();
  render(<App baseUrl={daemon.url} transport={network.transport} />);
  expect(await screen.findByText('断线中的工作')).toBeTruthy();
  await screen.findByText('实时更新已连接');
  // The initial event replay is consumed before we cut its actual HTTP stream.
  await waitFor(() => expect(screen.queryByText('调度轮次结束')).toBeTruthy());
  network.disconnect();
  await screen.findByText('连接已断开，正在重连…');
  await daemon.call('cancel-work', { workId: work.id });
  await daemon.call('set-concurrency', { limit: 4 });
  network.reconnect();
  await waitFor(() => expect(within(screen.getByRole('region', { name: '已结束' })).getByText('断线中的工作')).toBeTruthy(), { timeout: 5_000 });
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 4'));
  expect(network.cursors[0]).toBeNull();
  expect(Number(network.cursors.at(-1))).toBeGreaterThan(0);
});

test('行内确认和一般关卡决定经 HTTP 生效，工作在等你处理与进行中间移动', async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  daemon = await uiFixture([[draft('v1')], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '实现登录' }) },
    { type: 'hang', until: hold },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'question', question: '保留多久？', options: ['一周', '一直'] }) },
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '关卡工作', key: 'start' })).result.work;
  render(<App baseUrl={daemon.url} />);
  expandRow(await screen.findByText('关卡工作'));
  const confirm = await screen.findByRole('button', { name: '确认这一版' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('关卡工作')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('▦ 0/1')).toBeTruthy());
  release();
  await until(() => daemon!.call('list-pending'), value => value.result.some((gate: any) => gate.question === '保留多久？'));
  expandRow(await screen.findByText('关卡工作'));
  const gate = await screen.findByRole('group', { name: '保留多久？' });
  expect(within(gate).getByRole('button', { name: '一周' }).getAttribute('aria-keyshortcuts')).toBe('1');
  fireEvent.keyDown(gate, { key: '1' });
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('关卡工作')).toBeTruthy());
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  expect(conversation.find((item: any) => item.question === '保留多久？').decision).toBe('一周');
});

test('断线期间工作说明更新，行内操作显示运行层拒绝的原始原因', async () => {
  daemon = await uiFixture([[draft('v1')], [draft('v2')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '过期确认', key: 'start' })).result.work;
  const network = controlledTransport();
  render(<App baseUrl={daemon.url} transport={network.transport} />);
  expandRow(await screen.findByText('过期确认'));
  await screen.findByText('用户需求 v1');
  const button = await screen.findByRole('button', { name: '确认这一版' });
  network.disconnect();
  await screen.findByText('连接已断开，正在重连…');
  await daemon.call('send-message', { workId: work.id, body: '请更新', key: 'next' });
  await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length === 2);
  fireEvent.click(button);
  expect((await screen.findByRole('alert')).textContent).toContain('工作说明已更新，请重新查看关卡后确认。');
  expect((await daemon.call('get-work', { workId: work.id })).result.status).toBe('aligning');
});

test('运行层暂停带原因归等你处理，计时来自时间戳并每秒走，深链接保持位置', async () => {
  daemon = await uiFixture([[{ type: 'end', reason: 'quota-exhausted' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '额度暂停', key: 'start' })).result.work;
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  const view = render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('heading', { name: '额度暂停' })).toBeTruthy();
  const region = screen.getByRole('region', { name: '等你处理' });
  await waitFor(() => expect(within(region).getByText('调度者额度用完')).toBeTruthy());
  const timer = within(region).getByLabelText('状态计时');
  const first = timer.textContent;
  await waitFor(() => expect(timer.textContent).not.toBe(first), { timeout: 2_500 });
  expect(window.location.pathname).toBe(`/works/${work.id}/brief`);
  view.unmount();
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy();
});

test('事件触发的数据读取失败时由该资源自行重试，恢复后补读而不丢更新，实时连接不中断', async () => {
  daemon = await uiFixture();
  const realFetch = fetch;
  let failReads = false;
  const cursors: (string | null)[] = [];
  const transport: typeof fetch = async (input, init) => {
    if (String(input).endsWith('/events')) cursors.push(new Headers(init?.headers).get('Last-Event-ID'));
    if (failReads && String(input).endsWith('/api/get-settings')) throw new Error('数据读取暂时失败');
    return realFetch(input, init);
  };
  render(<App baseUrl={daemon.url} transport={transport} />);
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 10'));
  await screen.findByText('实时更新已连接');
  failReads = true;
  // This operation emits exactly one event; no later event can mask a lost cursor.
  await daemon.call('set-concurrency', { limit: 4 });
  expect((await screen.findByRole('alert')).textContent).toContain('数据读取暂时失败');
  failReads = false;
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 4'), { timeout: 5_000 });
  // The failed read recovered by its own retry; the stream was never torn down or replayed.
  expect(cursors).toHaveLength(1);
  expect(screen.queryByText('连接已断开，正在重连…')).toBeNull();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

test('审核归等你处理，行内退回附意见后恢复进行中', async () => {
  daemon = await uiFixture([[draft('v1')], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'review', report: reviewReport('汇总报告原文') }) },
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '等待审核的工作', key: 'start' })).result.work;
  render(<App baseUrl={daemon.url} />);
  expandRow(await screen.findByText('等待审核的工作'));
  const confirm = await screen.findByRole('button', { name: '确认这一版' }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(false));
  fireEvent.click(confirm);
  await until(() => daemon!.call('list-pending'), value => value.result.some((item: any) => item.kind === 'review'));
  await screen.findByText('待你审核');
  expandRow(screen.getByText('等待审核的工作'));
  expect(await screen.findByText('汇总报告原文')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('意见'), { target: { value: '请补齐边界说明' } });
  fireEvent.click(screen.getByRole('button', { name: '退回' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('等待审核的工作')).toBeTruthy());
  const review = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(review.decision).toBe('return');
  expect(review.comment).toBe('请补齐边界说明');
});

test('v2 收件箱展开显示最近进展和行内工作操作，暂停恢复后仍可直接打开', async () => {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '行内管理进展', key: 'inline' })).result.work;
  render(<App baseUrl={daemon.url} />);
  const row = expandRow(await screen.findByText('行内管理进展'));
  const recent = await within(row).findByRole('list', { name: '最近步骤' });
  expect(within(recent).getAllByRole('listitem').length).toBeLessThanOrEqual(3);
  fireEvent.click(within(row).getByRole('button', { name: '暂停工作' }));
  const resume = await within(row).findByRole('button', { name: '恢复工作' });
  await waitFor(() => expect((resume as HTMLButtonElement).disabled).toBe(false));
  expect((await daemon.call('get-work', { workId: work.id })).result.status).toBe('paused');
  fireEvent.click(resume);
  await within(row).findByRole('button', { name: '暂停工作' });
  fireEvent.click(within(row).getByRole('link', { name: '打开' }));
  expect(window.location.pathname).toBe(`/works/${work.id}`);
});
