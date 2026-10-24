import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
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
  fireEvent.click((await screen.findByText('关卡工作')).closest('summary')!);
  fireEvent.click(await screen.findByRole('button', { name: '确认这一版' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('关卡工作')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('▦ 0/1')).toBeTruthy());
  release();
  await until(() => daemon!.call('list-pending'), value => value.result.some((gate: any) => gate.question === '保留多久？'));
  fireEvent.click((await screen.findByText('关卡工作')).closest('summary')!);
  fireEvent.click(await screen.findByRole('button', { name: '一周' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('关卡工作')).toBeTruthy());
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  expect(conversation.find((item: any) => item.question === '保留多久？').decision).toBe('一周');
});

test('断线期间工作说明更新，行内操作显示运行层拒绝的原始原因', async () => {
  daemon = await uiFixture([[draft('v1')], [draft('v2')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '过期确认', key: 'start' })).result.work;
  const network = controlledTransport();
  render(<App baseUrl={daemon.url} transport={network.transport} />);
  fireEvent.click((await screen.findByText('过期确认')).closest('summary')!);
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
  window.history.replaceState(null, '', '/settings/templates/claude-executor');
  render(<App baseUrl={daemon.url} />);
  expect(screen.getByRole('heading', { name: '设置' })).toBeTruthy();
});

test('事件触发的数据读取失败时保留游标，恢复后补读而不丢更新', async () => {
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
  expect(cursors.length).toBeGreaterThan(1);
  const changed = (await daemon.call('get-events')).result.find((event: any) => event.action === 'concurrency-set');
  expect(Number(cursors.at(-1))).toBeLessThan(changed.id);
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
});

test('审核归等你处理，行内退回附意见后恢复进行中', async () => {
  daemon = await uiFixture([[draft('v1')], [
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'review', body: '汇总报告原文' }) },
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '等待审核的工作', key: 'start' })).result.work;
  render(<App baseUrl={daemon.url} />);
  fireEvent.click((await screen.findByText('等待审核的工作')).closest('summary')!);
  fireEvent.click(await screen.findByRole('button', { name: '确认这一版' }));
  await until(() => daemon!.call('list-pending'), value => value.result.some((item: any) => item.kind === 'review'));
  await screen.findByText('待你审核');
  const row = screen.getByText('等待审核的工作').closest('details')!;
  if (!row.open) fireEvent.click(row.querySelector('summary')!);
  expect(await screen.findByText('汇总报告原文')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('意见'), { target: { value: '请补齐边界说明' } });
  fireEvent.click(screen.getByRole('button', { name: '退回' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '进行中' })).getByText('等待审核的工作')).toBeTruthy());
  const review = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(review.decision).toBe('return');
  expect(review.comment).toBe('请补齐边界说明');
});
