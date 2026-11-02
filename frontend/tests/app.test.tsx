import { reviewReport } from '../../tests/fixtures/review-report.js';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';

// 收件箱行点击会打开工作页，详情要用右侧按钮展开
function expandRow(text: HTMLElement) {
  const row = screen.getByRole('article', { name: text.textContent! });
  const toggle = within(row).getByRole('button', { name: `快速决定：${text.textContent}` });
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
  daemon = await uiFixture([[{ type: 'hang' }]]);
  const create = async (body: string, key: string) => (await daemon!.call('send-message', { projectId: daemon!.project.id, body, key })).result.work;
  const active = await create('登录页改版\n第二行不显示在标题', 'active');
  const ended = await create('整理 README', 'ended');
  await daemon.call('cancel-work', { workId: ended.id });
  render(<App baseUrl={daemon.url} />);
  // The coordinator round is still drafting, so the confirmation gate is not yet the user's turn.
  const running = await screen.findByRole('region', { name: '在跑' });
  expect(await within(running).findByText('登录页改版')).toBeTruthy();
  expect(screen.queryByRole('article', { name: '整理 README' })).toBeNull();
  await waitFor(() => expect(screen.getByLabelText('执行者并发').textContent).toBe('0 / 10'));
  fireEvent.click(screen.getByRole('button', { name: /安静/ }));
  expect(within(screen.getByRole('region', { name: '安静' })).getByRole('article', { name: '整理 README' })).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索工作' }), { target: { value: 'README' } });
  expect(screen.queryByText('登录页改版')).toBeNull();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '' } });
  await daemon.call('cancel-work', { workId: active.id });
  await waitFor(() => expect(within(screen.getByRole('region', { name: '安静' })).getByText('登录页改版')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('region', { name: 'Quiet' })).toBeTruthy();
  expect(screen.getByRole('article', { name: '登录页改版' })).toBeTruthy();
  expect(localStorage.getItem('helm.language')).toBe('en');
  cleanup();
  render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('region', { name: 'Quiet' })).toBeTruthy();
  expect(screen.queryByRole('article', { name: '登录页改版' })).toBeNull();
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

test('收件箱底部随真实派单更新运行数、排队数和上限，收起后不显示用量', async () => {
  const ok = (value: unknown) => expect((value as any).ok).toBe(true);
  daemon = await uiFixture([[draft('v1')], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'first', content: '第一张', workspace: 'scratch' }), saveAs: 'first', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'first', cardId: (ctx.results.get('first') as any).result.id, agentId: 'claude-executor' }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'second', content: '第二张', workspace: 'scratch' }), saveAs: 'second', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'second', cardId: (ctx.results.get('second') as any).result.id, agentId: 'claude-executor' }), check: ok },
    { type: 'hang' },
  ]], undefined, { executorScripts: [[{ type: 'hang' }], [{ type: 'hang' }]] });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '底部用量', key: 'usage' })).result.work;
  ok(await daemon.call('set-concurrency', { limit: 1 }));
  render(<App baseUrl={daemon.url} />);
  const inbox = screen.getByRole('complementary', { name: 'Helm' });
  await waitFor(() => expect(within(inbox).getByLabelText('执行者并发').textContent).toBe('0 / 1'));
  expect(within(inbox).getByText('排队 0')).toBeTruthy();
  await within(inbox).findByText('等你：确认工作说明');
  expandRow(within(inbox).getByText('底部用量'));
  const confirm = await within(inbox).findByRole('button', { name: '确认这一版' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await waitFor(() => expect(within(inbox).getByLabelText('执行者并发').textContent).toBe('1 / 1'));
  await within(inbox).findByText('排队 1');
  ok(await daemon.call('set-concurrency', { limit: 2 }));
  await waitFor(() => expect(within(inbox).getByLabelText('执行者并发').textContent).toBe('2 / 2'));
  await within(inbox).findByText('排队 0');
  ok(await daemon.call('pause-work', { workId: work.id }));
  await waitFor(() => expect(within(inbox).getByLabelText('执行者并发').textContent).toBe('0 / 2'));
  fireEvent.click(within(inbox).getByRole('button', { name: 'EN' }));
  expect(within(inbox).getByLabelText('Executor concurrency').textContent).toBe('0 / 2');
  expect(within(inbox).getByText('Queued 0')).toBeTruthy();
  fireEvent.click(within(inbox).getByRole('button', { name: 'Collapse inbox' }));
  expect(within(inbox).queryByLabelText('Executor concurrency')).toBeNull();
});

test('在跑行直接打开工作；待决定行的快速决定不改变路由', async () => {
  daemon = await uiFixture([[draft('v1')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '点行打开', key: 'start' })).result.work;
  render(<App baseUrl={daemon.url} />);
  await screen.findByText('等你：确认工作说明');
  const row = expandRow(screen.getByText('点行打开'));
  expect(window.location.pathname).toBe('/');
  await within(row).findByRole('button', { name: '确认这一版' });
  fireEvent.click(within(row).getByRole('link', { name: /点行打开 ·/ }));
  expect(window.location.pathname).toBe(`/works/${work.id}`);
  expect(within(row).getByRole('link', { name: /点行打开 ·/ }).getAttribute('aria-current')).toBe('page');
});

test('断线后用 Last-Event-ID 补齐真实 helmd 的状态变化，并更新收件箱底部的并发', async () => {
  daemon = await uiFixture();
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '断线中的工作', key: 'start' })).result.work;
  const network = controlledTransport();
  render(<App baseUrl={daemon.url} transport={network.transport} />);
  expect(await screen.findByText('断线中的工作')).toBeTruthy();
  await screen.findByText('实时更新已连接');
  // The initial event replay is consumed before we cut its actual HTTP stream.
  await waitFor(() => expect(screen.queryByText('等你：确认工作说明')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: /安静/ }));
  network.disconnect();
  await screen.findByText('连接已断开，正在重连…');
  await daemon.call('cancel-work', { workId: work.id });
  await daemon.call('set-concurrency', { limit: 4 });
  network.reconnect();
  await waitFor(() => expect(within(screen.getByRole('region', { name: '安静' })).getByText('断线中的工作')).toBeTruthy(), { timeout: 5_000 });
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
  await screen.findByText('等你：确认工作说明');
  expandRow(screen.getByText('关卡工作'));
  const confirm = await screen.findByRole('button', { name: '确认这一版' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await waitFor(() => expect(within(screen.getByRole('region', { name: '在跑' })).getByText('关卡工作')).toBeTruthy());
  expect(await screen.findByRole('img', { name: '卡片状态：1 待开始' })).toBeTruthy();
  release();
  await until(() => daemon!.call('list-pending'), value => value.result.some((gate: any) => gate.question === '保留多久？'));
  expandRow(await screen.findByText('关卡工作'));
  const gate = await screen.findByRole('group', { name: '保留多久？' });
  expect(within(gate).getByRole('button', { name: '一周' }).getAttribute('aria-keyshortcuts')).toBe('1');
  fireEvent.keyDown(gate, { key: '1' });
  await waitFor(() => expect(within(screen.getByRole('region', { name: '在跑' })).getByText('关卡工作')).toBeTruthy());
  const conversation = (await daemon.call('get-conversation', { workId: work.id })).result;
  expect(conversation.find((item: any) => item.question === '保留多久？').decision).toBe('一周');
});

test('断线期间工作说明更新，行内操作显示运行层拒绝的原始原因', async () => {
  daemon = await uiFixture([[draft('v1')], [draft('v2')]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '过期确认', key: 'start' })).result.work;
  const network = controlledTransport();
  render(<App baseUrl={daemon.url} transport={network.transport} />);
  await screen.findByText('等你：确认工作说明');
  expandRow(screen.getByText('过期确认'));
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

test('运行层暂停归安静并保留原因；工作页计时每秒走，深链接保持位置', async () => {
  daemon = await uiFixture([[{ type: 'end', reason: 'quota-exhausted' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '额度暂停', key: 'start' })).result.work;
  // 目录清理完成后才发布暂停；页面标题出现不代表轮次已结束。
  await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  window.history.replaceState(null, '', `/works/${work.id}/brief`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('heading', { level: 1, name: '额度暂停' });
  expect(screen.queryByRole('article', { name: '额度暂停' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /安静/ }));
  const row = await screen.findByRole('article', { name: '额度暂停' });
  expect(within(row).getByText('已暂停 · 调度者额度用完')).toBeTruthy();
  expect(within(row).queryByRole('button')).toBeNull();
  const header = screen.getByRole('banner', { name: '工作概况' });
  await waitFor(() => expect(header.querySelector('time')).toBeTruthy());
  const clock = header.querySelector('time')!;
  const first = clock.textContent;
  await waitFor(() => expect(clock.textContent).not.toBe(first), { timeout: 2_500 });
  expect(window.location.pathname).toBe(`/works/${work.id}`);
  expect(window.location.search).toBe('?inspect=spec');
  cleanup();
  window.history.replaceState(null, '', '/settings/agents/claude-executor');
  render(<App baseUrl={daemon.url} />);
  expect(screen.getByRole('heading', { name: 'Agent' })).toBeTruthy();
});

test('收件箱用量读取失败时由该资源自行重试，恢复后补读而不丢更新，实时连接不中断', async () => {
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
  await screen.findByText('等你：确认工作说明');
  expandRow(screen.getByText('等待审核的工作'));
  const confirm = await screen.findByRole('button', { name: '确认这一版' }) as HTMLButtonElement;
  await waitFor(() => expect(confirm.disabled).toBe(false));
  fireEvent.click(confirm);
  await until(() => daemon!.call('list-pending'), value => value.result.some((item: any) => item.kind === 'review'));
  await screen.findByText('等你：审核汇总报告');
  expandRow(screen.getByText('等待审核的工作'));
  expect(await screen.findByText('汇总报告原文')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('意见'), { target: { value: '请补齐边界说明' } });
  fireEvent.click(screen.getByRole('button', { name: '退回' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '在跑' })).getByText('等待审核的工作')).toBeTruthy());
  const review = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  expect(review.decision).toBe('return');
  expect(review.comment).toBe('请补齐边界说明');
});

test('在跑与安静行不展开；打开工作后仍可暂停、恢复并查看进展', async () => {
  daemon = await uiFixture([[draft('v1')], [{ type: 'output', text: '检查邮件模板' }, { type: 'hang' }], [{ type: 'hang' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, body: '管理进展', key: 'inline' })).result.work;
  const description = (await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result[0];
  await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' });
  render(<App baseUrl={daemon.url} />);
  const row = await screen.findByRole('article', { name: '管理进展' });
  expect(within(row).queryByRole('button')).toBeNull();
  fireEvent.click(within(row).getByRole('link'));
  await screen.findByRole('heading', { level: 1, name: '管理进展' });
  await within(screen.getByRole('navigation', { name: '现在条' })).findByText('本轮 1 步 · 检查邮件模板');
  fireEvent.click(screen.getByRole('button', { name: '操作' }));
  fireEvent.click(within(screen.getByRole('group', { name: '工作操作' })).getByRole('button', { name: '暂停工作' }));
  await until(() => daemon!.call('get-work', { workId: work.id }), value => value.result.status === 'paused');
  fireEvent.click(screen.getByRole('button', { name: /安静/ }));
  const paused = await screen.findByRole('article', { name: '管理进展' });
  expect(within(paused).queryByRole('button')).toBeNull();
  await waitFor(() => expect(screen.queryByRole('group', { name: '工作操作' })).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: '操作' }));
  fireEvent.click(await within(screen.getByRole('group', { name: '工作操作' })).findByRole('button', { name: '恢复工作' }));
  await waitFor(() => expect(within(screen.getByRole('region', { name: '在跑' })).getByRole('article', { name: '管理进展' })).toBeTruthy());
  expect(window.location.pathname).toBe(`/works/${work.id}`);
});
