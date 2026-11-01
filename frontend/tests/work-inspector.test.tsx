import { afterEach, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeContext, FakeStep } from '../../src/driver.js';
import { reviewReport } from '../../tests/fixtures/review-report.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
const initialWidth = window.innerWidth;
afterEach(async () => {
  cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/');
  act(() => { Object.defineProperty(window, 'innerWidth', { value: initialWidth, configurable: true }); window.dispatchEvent(new Event('resize')); });
});
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const workId = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workId(ctx), key: 'draft', requirements: 'Requirements', boundary: 'Local', criteria: 'Works' }), check: ok };
async function create() {
  return (await daemon!.call('send-message', { projectId: daemon!.project.id, body: 'Inspector work', key: 'start' })).result.work;
}
async function confirm(id: string) {
  const descriptions = (await until(() => daemon!.call('get-work-descriptions', { workId: id }), value => value.result.length > 0)).result;
  const description = descriptions.at(-1);
  ok(await daemon!.call('decide-gate', { workId: id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
}

test('检查器随对齐、执行、审核和交付阶段归默认；阶段内的主动选择经 SSE 保持，对话始终挂载', async () => {
  let review!: () => void;
  daemon = await uiFixture([[draft], [
    { type: 'hang', until: new Promise<void>(resolve => { review = resolve; }) },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workId(ctx), key: 'review', report: reviewReport('Ready for review') }), check: ok },
  ]]);
  const work = await create();
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('complementary', { name: '工作说明' });
  const aligningChat = screen.getByRole('region', { name: '对话' });
  fireEvent.click(screen.getByRole('button', { name: '结构' }));
  fireEvent.click(await screen.findByRole('tab', { name: '事件' }));
  const events = screen.getByRole('tabpanel', { name: '事件' });
  ok(await daemon.call('send-message', { workId: work.id, body: 'Alignment note', key: 'note' }));
  await within(aligningChat).findByText('Alignment note');
  expect(screen.getByRole('tabpanel', { name: '事件' })).toBe(events);
  expect(screen.getByRole('region', { name: '对话' })).toBe(aligningChat);
  await confirm(work.id);
  await screen.findByRole('tabpanel', { name: '列表' });
  const chat = screen.getByRole('region', { name: '对话' });
  const input = within(chat).getByRole('textbox', { name: '消息' });
  fireEvent.change(input, { target: { value: 'Unsent draft' } });
  fireEvent.click(screen.getByRole('tab', { name: '时间线' }));
  ok(await daemon.call('send-message', { workId: work.id, body: 'Execution note', key: 'execute-note' }));
  await within(chat).findByText('Execution note', { selector: 'article p' });
  expect(screen.getByRole('tab', { name: '时间线' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  review();
  await waitFor(() => expect(window.location.search).toBe('?inspect=report'));
  expect(screen.getByRole('button', { name: '展开检查器' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开检查器' }));
  await within(screen.getByRole('complementary', { name: '检查器' })).findByRole('region', { name: '审核' });
  expect(window.location.search).toBe('?inspect=report');
  expect(screen.getByRole('region', { name: '对话' })).toBe(chat);
  expect((input as HTMLTextAreaElement).value).toBe('Unsent draft');
  const gate = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'accept' }));
  await screen.findByRole('region', { name: '合入与推送' });
  expect(window.location.search).toBe('?inspect=delivery');
  expect(screen.getByRole('region', { name: '对话' })).toBe(chat);
  expect((input as HTMLTextAreaElement).disabled).toBe(true);
});

test('放宽默认依赖图，收窄回列表；折叠和重新展开保持选择，深链接可重新打开检查器', async () => {
  daemon = await uiFixture([[draft], []]);
  const work = await create(); await confirm(work.id);
  act(() => { Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true }); });
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('tabpanel', { name: '列表' });
  fireEvent.click(screen.getByRole('button', { name: '放宽检查器' }));
  await screen.findByRole('tabpanel', { name: '依赖图' });
  fireEvent.click(screen.getByRole('tab', { name: '事件' }));
  act(() => { Object.defineProperty(window, 'innerWidth', { value: 800, configurable: true }); window.dispatchEvent(new Event('resize')); });
  expect(screen.getByRole('tabpanel', { name: '事件' })).toBeTruthy();
  act(() => { Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true }); window.dispatchEvent(new Event('resize')); });
  expect(screen.getByRole('tabpanel', { name: '事件' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  expect(screen.queryByRole('tabpanel')).toBeNull();
  expect(screen.getByRole('region', { name: '对话' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '展开检查器' }));
  expect(screen.getByRole('tabpanel', { name: '事件' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收窄检查器' }));
  await screen.findByRole('tabpanel', { name: '列表' });
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  act(() => { window.history.pushState(null, '', `/works/${work.id}?inspect=rounds`); window.dispatchEvent(new PopStateEvent('popstate')); });
  await screen.findByRole('tabpanel', { name: '调度轮次' });
  expect(screen.getByRole('button', { name: '收起检查器' })).toBeTruthy();
  expect(localStorage.getItem('helm.inspector-width')).toBeNull();
});

test.each([['chat', null], ['structure', 'graph'], ['graph', 'graph'], ['brief', 'spec']] as const)('旧 %s 路由重定向到工作页与对应检查器', async (view, inspect) => {
  daemon = await uiFixture([[draft], []]);
  const work = await create(); await confirm(work.id);
  window.history.replaceState(null, '', `/works/${work.id}/${view}`);
  const historyLength = window.history.length;
  render(<App baseUrl={daemon.url} />);
  await screen.findByRole('region', { name: '对话' });
  expect(window.location.pathname).toBe(`/works/${work.id}`);
  expect(new URLSearchParams(window.location.search).get('inspect')).toBe(inspect);
  expect(window.history.length).toBe(historyLength);
  expect(screen.queryByRole('navigation', { name: '工作视图' })).toBeNull();
});

test('全部 inspect 深链接、前后导航、卡片跳转与英文界面均可用', async () => {
  daemon = await uiFixture([[draft], [{ type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key: 'card', content: 'A real card', readOnly: true }), check: ok }]]);
  const work = await create(); await confirm(work.id);
  const nodes = (await until(() => daemon!.call('get-card-graph', { workId: work.id }), value => value.result.some((node: any) => node.type === 'card'))).result;
  const cardId = nodes.find((node: any) => node.type === 'card').id;
  localStorage.setItem('helm.inspector-folded', 'true');
  localStorage.setItem('helm.language', 'en');
  window.history.replaceState(null, '', `/works/${work.id}?inspect=card:${cardId}`);
  render(<App baseUrl={daemon.url} />);
  const inspector = await screen.findByRole('complementary', { name: 'Inspector' });
  await within(inspector).findByRole('heading', { name: 'A real card' });
  expect(screen.getByRole('button', { name: 'Collapse inspector' })).toBeTruthy();
  const chat = screen.getByRole('region', { name: 'Chat' });
  for (const [value, label] of [['list', 'List'], ['graph', 'Dependency graph'], ['timeline', 'Timeline'], ['rounds', 'Rounds'], ['events', 'Events']] as const) {
    act(() => { window.history.pushState(null, '', `/works/${work.id}?inspect=${value}`); window.dispatchEvent(new PopStateEvent('popstate')); });
    await screen.findByRole('tabpanel', { name: label });
    expect(screen.getByRole('region', { name: 'Chat' })).toBe(chat);
  }
  for (const value of ['spec', 'report', 'delivery', 'coord']) {
    act(() => { window.history.pushState(null, '', `/works/${work.id}?inspect=${value}`); window.dispatchEvent(new PopStateEvent('popstate')); });
    await waitFor(() => expect(inspector.textContent).toContain(value === 'spec' ? 'Requirements' : value === 'report' ? 'No summary report yet' : value === 'coord' ? 'Tokens by round' : 'Delivery'));
    expect(inspector.textContent).not.toMatch(/[\u3400-\u9fff]/);
  }
  fireEvent.click(screen.getByRole('button', { name: 'Structure' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Card 1：A real card' }));
  expect(new URLSearchParams(window.location.search).get('inspect')).toBe(`card:${cardId}`);
  expect(screen.getByRole('region', { name: 'Chat' })).toBe(chat);
  act(() => window.history.back());
  await screen.findByRole('tabpanel', { name: 'List' });
  act(() => window.history.forward());
  await within(inspector).findByRole('heading', { name: 'A real card' });
});

test('列表用真实卡片分组，展示等你决定、验收未过、受阻、跳过原因、Agent 和汇总；打开详情后对话保留', async () => {
  let complete!: () => void;
  const id = (ctx: FakeContext, key: string) => (ctx.results.get(key) as any).result.id;
  const card = (key: string, aggregate = false): FakeStep => ({ type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key, content: key, readOnly: true, aggregate }), saveAs: key, check: ok });
  const dispatch = (key: string, purpose = 'execution'): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), key: `dispatch-${key}`, cardId: id(ctx, key), agentId: 'claude-executor', purpose }), check: ok });
  const depends = (upstream: string, downstream: string, type = 'card'): FakeStep => ({ type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workId(ctx), upstream: { type, id: id(ctx, upstream) }, downstream: { type: 'card', id: id(ctx, downstream) } }), check: ok });
  daemon = await uiFixture([[draft], [
    card('done'), dispatch('done'), card('running'), dispatch('running'), card('failed'), dispatch('failed', 'verification'), card('blocked'), dispatch('blocked'),
    card('cancelled'), card('skipped'), card('aggregate', true), card('gated'),
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'choice', question: 'Choose storage', options: ['Redis', 'Memory'] }), saveAs: 'choice', check: ok },
    depends('cancelled', 'skipped'), depends('cancelled', 'aggregate'), depends('running', 'aggregate'), depends('choice', 'gated', 'gate'),
    { type: 'tool', name: 'cancel-card', arguments: ctx => ({ workId: workId(ctx), cardId: id(ctx, 'cancelled'), reason: 'Discarded' }), check: ok },
    { type: 'hang', until: new Promise<void>(resolve => { complete = resolve; }) },
    { type: 'tool', name: 'complete-card', arguments: ctx => ({ workId: workId(ctx), cardId: id(ctx, 'done') }), check: ok },
    { type: 'hang' },
  ]], undefined, { executorScripts: [[], [{ type: 'output', text: 'Running tests' }, { type: 'hang' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: 'Missing expiration check' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: 'Needs credentials' }, check: ok }],
  ] });
  const work = await create(); await confirm(work.id);
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 3);
  complete();
  await until(() => daemon!.call('list-works'), value => value.result[0].completedCards === 1);
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  const list = await screen.findByRole('tabpanel', { name: '列表' });
  for (const name of ['等你决定', '执行中', '验收未过', '受阻', '已完成', '已跳过', '已取消']) expect(await within(list).findByRole('region', { name })).toBeTruthy();
  expect(within(list).getByText('Choose storage', { exact: false })).toBeTruthy();
  expect(within(list).getByText('验收未过 · Missing expiration check')).toBeTruthy();
  expect(within(list).getByText('受阻 · Needs credentials')).toBeTruthy();
  expect(within(list).getByText('已跳过 · 因「cancelled」取消')).toBeTruthy();
  expect(within(list).getByText('汇总')).toBeTruthy();
  expect(await within(list).findAllByRole('img', { name: 'Claude' })).toHaveLength(4);
  const chat = screen.getByRole('region', { name: '对话' });
  fireEvent.click(within(list).getByRole('button', { name: '卡片 6：skipped' }));
  const detail = screen.getByRole('complementary', { name: '卡片检查器' });
  expect(detail.contains(document.activeElement)).toBe(true);
  expect(within(detail).getByRole('heading', { name: 'skipped' })).toBeTruthy();
  expect(within(detail).getByText('已跳过 · 因「cancelled」取消')).toBeTruthy();
  expect(screen.getByRole('region', { name: '对话' })).toBe(chat);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  fireEvent.click(screen.getByRole('tab', { name: 'List' }));
  const english = screen.getByRole('tabpanel', { name: 'List' });
  expect(await within(english).findByRole('region', { name: 'Needs your decision' })).toBeTruthy();
  expect(within(english).getByRole('region', { name: 'Blocked' })).toBeTruthy();
  expect(within(english).getByText('Skipped · “cancelled” cancelled')).toBeTruthy();
  expect(screen.getByRole('complementary', { name: 'Inspector' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
});
