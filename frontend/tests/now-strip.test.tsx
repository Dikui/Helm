import { afterEach, expect, test } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import type { FakeContext, FakeStep } from '../../src/driver.js';
import { reviewReport } from '../../tests/fixtures/review-report.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');
let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => { cleanup(); await daemon?.close(); daemon = undefined; localStorage.clear(); window.history.replaceState(null, '', '/'); });
const ok = (value: unknown) => expect((value as any).ok).toBe(true);
const workId = (ctx: FakeContext) => JSON.parse(ctx.input).work.id;
const id = (ctx: FakeContext, key: string) => (ctx.results.get(key) as any).result.id;
const draft: FakeStep = { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workId(ctx), key: 'draft', requirements: 'Requirements', boundary: 'Local', criteria: 'Works', deliverables: '交付物及查看入口' }), check: ok };
const card = (key: string): FakeStep => ({ type: 'tool', name: 'create-card', arguments: ctx => ({ workId: workId(ctx), key, content: key, workspace: 'copy' }), saveAs: key, check: ok });
const dispatch = (key: string, purpose = 'execution'): FakeStep => ({ type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: workId(ctx), key: `dispatch-${key}`, cardId: id(ctx, key), agentId: 'claude-executor', purpose }), check: ok });
async function create(confirm = true) {
  const work = (await daemon!.call('send-message', { projectId: daemon!.project.id, body: 'Now strip work', key: 'start' })).result.work;
  const descriptions = (await until(() => daemon!.call('get-work-descriptions', { workId: work.id }), value => value.result.length > 0)).result;
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0].status === 'ended');
  if (confirm) ok(await daemon!.call('decide-gate', { workId: work.id, gateId: descriptions[0].gateId, descriptionId: descriptions[0].id, decision: 'confirm' }));
  window.history.replaceState(null, '', `/works/${work.id}`);
  return work;
}

test('四张活卡片按卡片顺序单列，标题只在提示和检查器，+N 仅显示其余卡片；点击重新展开检查器并同步 URL', async () => {
  daemon = await uiFixture([[draft], [
    card('Running card'), dispatch('Running card'), card('Verifying card'), dispatch('Verifying card', 'verification'),
    card('Failed card'), dispatch('Failed card', 'verification'), card('Blocked card'), dispatch('Blocked card'), card('Inactive card'), { type: 'hang' },
  ]], undefined, { executorScripts: [
    [{ type: 'hang' }], [{ type: 'hang' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: 'Missing check' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: 'Needs credentials' }, check: ok }],
  ] });
  const work = await create();
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 2);
  render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  await within(strip).findByRole('button', { name: /#4 受阻/ });
  expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([
    expect.stringContaining('调度者'), 'C#1执行中', 'C#2验收中', 'C#3验收未过', 'C#4受阻', '+1', '说明 v1', '结构',
  ]);
  expect(within(strip).queryByText('Running card')).toBeNull();
  expect(within(strip).getByTitle('#1 · Running card · 执行中')).toBeTruthy();
  const chat = screen.getByRole('region', { name: '对话' });
  fireEvent.change(within(chat).getByRole('textbox', { name: '消息' }), { target: { value: 'Unsent draft' } });
  fireEvent.click(screen.getByRole('button', { name: '收起检查器' }));
  fireEvent.click(within(strip).getByRole('button', { name: /#3 验收未过/ }));
  const inspector = screen.getByRole('complementary', { name: '检查器' });
  await within(inspector).findByRole('heading', { name: 'Failed card' });
  const graph = (await daemon.call('get-card-graph', { workId: work.id })).result;
  expect(new URLSearchParams(window.location.search).get('inspect')).toBe(`card:${graph.find((node: any) => node.content === 'Failed card').id}`);
  expect(screen.getByRole('region', { name: '对话' })).toBe(chat);
  expect((within(chat).getByRole('textbox', { name: '消息' }) as HTMLTextAreaElement).value).toBe('Unsent draft');
  fireEvent.click(within(strip).getByRole('button', { name: '+1' }));
  const list = await screen.findByRole('tabpanel', { name: '列表' });
  expect(await within(list).findByRole('button', { name: '卡片 5：Inactive card' })).toBeTruthy();
  expect(within(list).queryByRole('button', { name: '卡片 1：Running card' })).toBeNull();
  fireEvent.click(within(strip).getByRole('button', { name: '结构' }));
  expect(await within(list).findByRole('button', { name: '卡片 1：Running card' })).toBeTruthy();
  expect(window.location.search).toBe('?inspect=list');
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('navigation', { name: 'Now strip' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
});

test('超过四张按状态合并，分别只列执行、验收、验收未过和受阻成员；前后导航和深链接保持筛选', async () => {
  daemon = await uiFixture([[draft], [
    card('Run one'), dispatch('Run one'), card('Run two'), dispatch('Run two'), card('Verify'), dispatch('Verify', 'verification'),
    card('Failed'), dispatch('Failed', 'verification'), card('Blocked'), dispatch('Blocked'), card('Other'), { type: 'hang' },
  ]], undefined, { executorScripts: [
    [{ type: 'hang' }], [{ type: 'hang' }], [{ type: 'hang' }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: 'Failed check' }, check: ok }],
    [{ type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: 'Needs access' }, check: ok }],
  ] });
  const work = await create();
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.filter((item: any) => item.status === 'ended').length === 2);
  const view = render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  await within(strip).findByRole('button', { name: /执行中 2/ });
  for (const [label, status, names] of [
    ['执行中 2', 'executing', ['卡片 1：Run one', '卡片 2：Run two']], ['验收中 1', 'verifying', ['卡片 3：Verify']],
    ['验收未过 1', 'verification-failed', ['卡片 4：Failed']], ['受阻 1', 'blocked', ['卡片 5：Blocked']],
  ] as const) {
    fireEvent.click(within(strip).getByRole('button', { name: new RegExp(label) }));
    const list = await screen.findByRole('tabpanel', { name: '列表' });
    expect(screen.queryByRole('tablist', { name: '结构' })).toBeNull();
    expect(screen.getByText('活卡片超过 4 张，按状态合并；只显示所选组。')).toBeTruthy();
    await waitFor(() => expect(within(list).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(names));
    expect(new URLSearchParams(window.location.search).get('inspect')).toBe('list');
    expect(new URLSearchParams(window.location.search).get('cards')).toBe(status);
  }
  act(() => window.history.back());
  await waitFor(() => expect(new URLSearchParams(window.location.search).get('cards')).toBe('verification-failed'));
  expect(screen.getByRole('button', { name: '卡片 4：Failed' })).toBeTruthy();
  view.unmount();
  render(<App baseUrl={daemon.url} />);
  expect(await screen.findByRole('button', { name: '卡片 4：Failed' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '卡片 1：Run one' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '卡片 4：Failed' }));
  await screen.findByRole('heading', { name: 'Failed' });
  expect(new URLSearchParams(window.location.search).has('cards')).toBe(false);
});

test('等你格随确认、决策和审核出现，报告与交付按阶段开放；空闲原因和版本来自真实状态', async () => {
  let decide!: () => void;
  let review!: () => void;
  daemon = await uiFixture([[draft], [
    { type: 'hang', until: new Promise<void>(resolve => { decide = resolve; }) },
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'gate', question: 'Choose storage', options: ['Memory', 'Disk'] }), check: ok },
  ], [
    { type: 'hang', until: new Promise<void>(resolve => { review = resolve; }) },
    { type: 'tool', name: 'request-review', arguments: ctx => ({ workId: workId(ctx), key: 'review', ...reviewReport('Ready') }), check: ok },
  ]]);
  const work = await create(false);
  render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  expect(await within(strip).findByText('v1 已起草，等你确认')).toBeTruthy();
  expect(within(strip).queryByRole('button', { name: '汇总报告' })).toBeNull();
  expect(within(strip).queryByRole('button', { name: '交付' })).toBeNull();
  expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringContaining('调度者'), expect.stringContaining('等你确认'), '说明 v1']);
  fireEvent.click(within(strip).getByRole('button', { name: /^等你确认/ }));
  expect(window.location.search).toBe('?inspect=spec');
  const description = (await daemon.call('get-work-descriptions', { workId: work.id })).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  await waitFor(() => expect(within(strip).queryByRole('button', { name: /^等你确认/ })).toBeNull());
  decide();
  const decision = await within(strip).findByRole('button', { name: '等你决定 Choose storage' });
  expect(await within(strip).findByText('空闲 · 等待关卡决定')).toBeTruthy();
  fireEvent.click(decision);
  await within(screen.getByRole('complementary', { name: '检查器' })).findByRole('heading', { name: 'Choose storage' });
  const gate = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.question === 'Choose storage');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'Memory' }));
  await waitFor(() => expect(within(strip).queryByRole('button', { name: /^等你决定/ })).toBeNull());
  const decided = await within(strip).findByRole('button', { name: '关卡已决定 Memory' });
  expect(within(strip).getAllByRole('button')[1]).toBe(decided);
  fireEvent.click(decided);
  expect(new URLSearchParams(window.location.search).get('inspect')).toBe(`card:${gate.id}`);
  review();
  expect(await within(strip).findByText('报告已提交 · 等你审核')).toBeTruthy();
  expect(within(strip).queryByRole('button', { name: /^汇总报告/ })).toBeNull();
  expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringContaining('调度者'), expect.stringContaining('等你审核'), '说明 v1', '结构']);
  fireEvent.click(within(strip).getByRole('button', { name: /^等你审核/ }));
  expect(window.location.search).toBe('?inspect=report');
  const reviewGate = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.kind === 'review');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: reviewGate.id, decision: 'accept' }));
  const delivery = await within(strip).findByRole('button', { name: '交付' });
  expect(within(strip).queryByRole('button', { name: /^汇总报告/ })).toBeNull();
  expect(within(strip).queryByRole('button', { name: /^等你审核/ })).toBeNull();
  fireEvent.click(delivery);
  expect(window.location.search).toBe('?inspect=delivery');
  expect(await within(delivery).findByText('已完成 · 无代码改动')).toBeTruthy();
  expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([expect.stringContaining('调度者'), '交付已完成 · 无代码改动', '说明 v1', '结构']);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(screen.getByRole('navigation', { name: 'Now strip' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
});

test('等待决策的卡片作为受阻活卡片，决定后恢复为非活跃；暂停和取消显示实际原因', async () => {
  daemon = await uiFixture([[draft], [
    { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'gate', question: 'Choose database', options: ['Local', 'Remote'] }), saveAs: 'gate', check: ok },
    card('Gated card'), card('Ready card'),
    { type: 'tool', name: 'add-dependency', arguments: ctx => ({ workId: workId(ctx), upstream: { type: 'gate', id: id(ctx, 'gate') }, downstream: { type: 'card', id: id(ctx, 'Gated card') } }), check: ok },
  ]]);
  const work = await create();
  render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  expect(await within(strip).findByRole('button', { name: /#1 等你决定/ })).toBeTruthy();
  expect(within(strip).getByRole('button', { name: '+1' })).toBeTruthy();
  const gate = (await daemon.call('get-conversation', { workId: work.id })).result.find((item: any) => item.question === 'Choose database');
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: gate.id, decision: 'Local' }));
  expect(await within(strip).findByRole('button', { name: '+2' })).toBeTruthy();
  expect(within(strip).queryByRole('button', { name: /#1 等你决定/ })).toBeNull();
  ok(await daemon.call('pause-work', { workId: work.id }));
  expect(await within(strip).findByText('已暂停')).toBeTruthy();
  expect(screen.queryByRole('tablist', { name: '结构' })).toBeNull();
  expect(screen.getByText('工作已暂停。恢复后才继续调度与派单。')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(await within(strip).findByText('Paused')).toBeTruthy();
  ok(await daemon.call('cancel-work', { workId: work.id }));
  expect(await within(strip).findByText('Cancelled')).toBeTruthy();
});

test('对齐草稿更新时第二格替换为更新中，完成后回确认格；两种状态均不显示结构或报告 / 交付', async () => {
  let finish!: () => void;
  daemon = await uiFixture([[draft], [
    { type: 'hang', until: new Promise<void>(resolve => { finish = resolve; }) },
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: workId(ctx), key: 'v2', requirements: 'Updated requirements', boundary: 'Local', criteria: 'Works', deliverables: '交付物及查看入口' }), check: ok },
  ]]);
  const work = await create(false);
  render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  await within(strip).findByRole('button', { name: '等你确认 工作说明 v1' });
  ok(await daemon.call('send-message', { workId: work.id, body: 'Update the brief', key: 'update' }));
  try {
    const updating = await within(strip).findByRole('button', { name: '工作说明更新中 工作说明 v1' });
    expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('调度者'), '工作说明更新中工作说明 v1', '说明 v1',
    ]);
    fireEvent.click(updating);
    expect(window.location.search).toBe('?inspect=spec');
    finish();
    await within(strip).findByRole('button', { name: '等你确认 工作说明 v2' });
    expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual([
      expect.stringContaining('调度者'), '等你确认工作说明 v2', '说明 v2',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'EN' }));
    expect(screen.getByRole('navigation', { name: 'Now strip' }).textContent).not.toMatch(/[\u3400-\u9fff]/);
  } finally { finish(); }
});

test('没有卡片和已保存轮次的读取状态只有调度者和说明，检查器深链接仍可用', async () => {
  daemon = await uiFixture([[draft], []]);
  const work = await create();
  // Historical work can have no persisted rounds. Keep the real daemon and all other reads.
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    if (!String(input).endsWith('/api/list-rounds')) return response;
    const body = await response.json();
    body.result = { ...body.result, rounds: [], currentSteps: [], currentPlan: [] };
    return Response.json(body);
  };
  window.history.replaceState(null, '', `/works/${work.id}?inspect=coord`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  await within(strip).findByText('尚无调度轮次');
  expect(within(strip).getAllByRole('button').map(button => button.textContent)).toEqual(['调调度者尚无调度轮次', '说明 v1']);
  expect(await screen.findByRole('complementary', { name: '检查器' })).toBeTruthy();
  fireEvent.click(within(strip).getByRole('button', { name: '工作说明' }));
  expect(window.location.search).toBe('?inspect=spec');
});


test('对齐的多选提问优先固定说明确认，回答后回到说明确认', async () => {
  daemon = await uiFixture([[draft, { type: 'tool', name: 'propose-gate', arguments: ctx => ({ workId: workId(ctx), key: 'scope', question: '选择覆盖范围', options: ['桌面', '窄屏'], multiSelect: true }), check: ok }]]);
  const work = await create(false);
  render(<App baseUrl={daemon.url} />);
  const strip = await screen.findByRole('navigation', { name: '现在条' });
  const choice = await within(strip).findByRole('button', { name: '等你决定 选择覆盖范围' });
  expect(within(strip).queryByRole('button', { name: /^等你确认/ })).toBeNull();
  expect(within(strip).getByRole('button', { name: '工作说明' })).toBeTruthy();
  fireEvent.click(choice);
  expect(await screen.findByRole('heading', { name: '选择覆盖范围' })).toBeTruthy();
  const gates = (await daemon.call('get-conversation', { workId: work.id })).result.filter((item: any) => item.type === 'gate');
  const general = gates.find((gate: any) => gate.kind === 'general');
  expect(gates.filter((gate: any) => gate.status === 'pending')).toHaveLength(2);
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: general.id, decision: '桌面\n窄屏' }));
  expect(await within(strip).findByRole('button', { name: '等你确认 工作说明 v1' })).toBeTruthy();
  expect((await daemon.call('get-work', { workId: work.id })).result.status).toBe('aligning');
});

test('派单结论经 SSE 同时更新依赖图、现在条、列表和卡片详情，最近步骤使用显示名称', async () => {
  let finish!: () => void;
  const completed = new Promise<void>(resolve => { finish = resolve; });
  daemon = await uiFixture([[draft], [card('Failed verification'), dispatch('Failed verification', 'verification'), card('Blocked execution'), dispatch('Blocked execution'), { type: 'hang' }]], undefined, { executorScripts: [
    [{ type: 'hang', until: completed }, { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'failed', reason: 'Expiry unchecked' }, check: ok }],
    [{ type: 'hang', until: completed }, { type: 'tool', name: 'submit-conclusion', arguments: { conclusion: 'blocked', reason: 'Credentials needed' }, check: ok }],
  ] });
  const work = await create();
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.length === 2);
  window.history.replaceState(null, '', `/works/${work.id}?inspect=graph`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const failed = await within(graph).findByRole('button', { name: '卡片 1：Failed verification' });
  const blocked = within(graph).getByRole('button', { name: '卡片 2：Blocked execution' });
  expect(within(failed).getByText('验收中')).toBeTruthy();
  expect(within(blocked).getByText('执行中')).toBeTruthy();
  finish();
  await within(failed).findByText('验收未过');
  await within(blocked).findByText('受阻');
  expect(within(failed).queryByText('验收中')).toBeNull();
  const strip = screen.getByRole('navigation', { name: '现在条' });
  await within(strip).findByRole('button', { name: /#1 验收未过/ });
  await within(strip).findByRole('button', { name: /#2 受阻/ });
  fireEvent.click(failed);
  const inspector = screen.getByRole('complementary', { name: '检查器' });
  await within(inspector).findByRole('heading', { name: 'Failed verification' });
  expect(within(inspector).getByText('验收未过')).toBeTruthy();
  const recent = within(inspector).getByRole('region', { name: '最近步骤' });
  expect((await within(recent).findAllByText('提交结论')).length).toBeGreaterThan(0);
  expect(recent.textContent).not.toContain('submit-conclusion');
  fireEvent.click(within(strip).getByRole('button', { name: '结构' }));
  const list = await screen.findByRole('tabpanel', { name: '列表' });
  expect(await within(list).findByRole('region', { name: '验收未过' })).toBeTruthy();
  expect(within(list).getByRole('region', { name: '受阻' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Dependency graph' }));
  const english = await screen.findByRole('region', { name: 'Card graph' });
  expect(await within(english).findByText('Verification failed')).toBeTruthy();
  expect(within(english).getByText('Blocked')).toBeTruthy();
});
