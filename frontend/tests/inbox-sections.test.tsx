import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeContext, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const workId = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const idOf = (ctx: FakeContext, key: string) => (ctx.results.get(key) as any).result.id;
const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workId(ctx), key: 'draft', requirements: 'Inbox', boundary: 'Local', criteria: 'States', deliverables: '交付物及查看入口' }), check: ok };
const card = (key: string): FakeStep => ({ type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key, content: key, workspace: 'copy' }), saveAs: key, check: ok });
const dispatch = (key: string, purpose = 'execution'): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), key: `dispatch-${key}`, cardId: idOf(ctx, key), agentId: 'claude-executor', purpose }), check: ok });
async function create(body: string, key = body) {
  return (await daemon!.call('send-message', { projectId: daemon!.project.id, body, key })).result.work;
}
async function confirm(id: string) {
  const descriptions = (await until(() => daemon!.call('get-work-descriptions', { workId: id }), value => value.result.length > 0)).result;
  const description = descriptions.at(-1);
  ok(await daemon!.call('decide-gate', { workId: id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
}

test('空收件箱有两行引导和新建入口；搜索可清除并恢复焦点', async () => {
  daemon = await uiFixture([[{ type: 'hang' }]]);
  render(<App baseUrl={daemon.url} />);
  const inbox = screen.getByRole('complementary', { name: 'Helm' });
  await within(inbox).findByText('收件箱是空的');
  expect(within(inbox).getByText('从一项目标开始。')).toBeTruthy();
  expect(within(inbox).getByRole('link', { name: /新建工作/ }).getAttribute('href')).toBe('/new');
  expect(within(inbox).queryByRole('heading')).toBeNull();
  await create('Search title');
  await within(inbox).findByRole('article', { name: 'Search title' });
  const input = within(inbox).getByRole('searchbox');
  fireEvent.keyDown(window, { key: 'k', metaKey: true });
  expect(document.activeElement).toBe(input);
  fireEvent.change(input, { target: { value: 'missing' } });
  expect(within(inbox).getByText('没有匹配的工作。')).toBeTruthy();
  fireEvent.click(within(inbox).getByRole('button', { name: '清除搜索' }));
  expect(document.activeElement).toBe(input);
  expect(within(inbox).getByRole('article', { name: 'Search title' })).toBeTruthy();
  fireEvent.click(within(inbox).getByRole('button', { name: 'EN' }));
  expect(inbox.textContent).not.toMatch(/[\u3400-\u9fff]/);
});

test('圆点来自真实卡片状态，保留顺序并读出完成、执行、验收未过、受阻、跳过；重派后更新', async () => {
  let continueAfterDispatches!: () => void;
  let retry!: () => void;
  const ready = new Promise<void>(resolve => { continueAfterDispatches = resolve; });
  const retryReady = new Promise<void>(resolve => { retry = resolve; });
  daemon = await uiFixture([[draft], [
    card('done'), dispatch('done'), card('running'), dispatch('running'), card('failed'), dispatch('failed', 'verification'), card('blocked'), dispatch('blocked'),
    card('cancelled'), card('skipped'),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workId(ctx), upstream: { type: 'card', id: idOf(ctx, 'cancelled') }, downstream: { type: 'card', id: idOf(ctx, 'skipped') } }), check: ok },
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workId(ctx), cardId: idOf(ctx, 'cancelled'), reason: 'Discarded direction' }), check: ok },
    { type: 'hang', until: ready },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workId(ctx), cardId: idOf(ctx, 'done') }), check: ok },
    { type: 'hang', until: retryReady },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), key: 'retry', cardId: idOf(ctx, 'failed'), agentId: 'claude-executor' }), check: ok },
    { type: 'hang' },
  ]], undefined, { executorScripts: [
    [], [{ type: 'hang' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: 'Verification failed' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: 'Needs credentials' }, check: ok }],
    [{ type: 'hang' }],
  ] });
  const work = await create('Card states');
  await confirm(work.id);
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 3);
  continueAfterDispatches();
  await until(() => daemon!.call('list-works'), value => value.result[0].completedCards === 1);
  render(<App baseUrl={daemon.url} />);
  const row = await screen.findByRole('article', { name: 'Card states' });
  const states = '卡片状态：1 已完成 · 2 执行中 · 3 验收未过 · 4 受阻 · 5 已取消 · 6 已跳过';
  expect(await within(row).findByRole('img', { name: states })).toBeTruthy();
  expect(within(row).getByRole('link').getAttribute('title')).toContain('1 张在跑');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(row).getByRole('img', { name: 'Card states：1 Completed · 2 Executing · 3 Verification failed · 4 Blocked · 5 Cancelled · 6 Skipped' })).toBeTruthy();
  retry();
  await waitFor(() => expect(within(row).getByRole('img').getAttribute('aria-label')).toContain('3 Executing'));
});

test('收起竖条只列等你和在跑，悬停标题含现状；安静工作可展开后直接打开', async () => {
  daemon = await uiFixture([[draft], [draft], [{ type: 'hang' }], [{ type: 'hang' }]]);
  const waiting = await create('Needs input');
  await until(() => daemon!.call('list-works'), value => value.result[0].hasPendingGate);
  const running = await create('Running work');
  await confirm(running.id);
  await until(() => daemon!.call('list-rounds', { workId: running.id }), value => value.result.rounds.at(-1)?.status === 'running');
  const quiet = await create('Quiet work');
  ok(await daemon.call('pause-work', { workId: quiet.id }));
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('article', { name: 'Needs input' });
  fireEvent.click(screen.getByRole('button', { name: '收起收件箱' }));
  const attention = await screen.findByRole('region', { name: '等你' });
  const active = screen.getByRole('region', { name: '在跑' });
  expect(within(attention).getByRole('link', { name: 'Needs input · 等你：确认工作说明' }).getAttribute('title')).toBe('Needs input — 等你：确认工作说明');
  expect(within(active).getByRole('link', { name: /Running work/ }).getAttribute('href')).toBe(`/works/${running.id}`);
  expect(screen.queryByRole('link', { name: /Quiet work/ })).toBeNull();
  expect(within(screen.getByRole('complementary', { name: 'Helm' })).getByRole('link', { name: '新建工作' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '设置' })).toBeTruthy();
  fireEvent.click(within(attention).getByRole('link'));
  expect(window.location.pathname).toBe(`/works/${waiting.id}`);
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  expect(document.activeElement).toBe(screen.getByRole('searchbox'));
  fireEvent.click(screen.getByRole('button', { name: /安静/ }));
  const paused = await screen.findByRole('article', { name: 'Quiet work' });
  expect(within(paused).queryByRole('button')).toBeNull();
  fireEvent.click(within(paused).getByRole('link'));
  expect(window.location.pathname).toBe(`/works/${quiet.id}`);
});
