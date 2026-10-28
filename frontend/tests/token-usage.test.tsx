import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
import { I18nProvider } from '../src/shared/i18n.js';
import { sumUsage } from '../src/shared/token-usage.js';
import { CoordinatorTokens } from '../src/pages/work/card-graph/TokenDetails.js';
import { GraphCanvas } from '../src/pages/work/card-graph/GraphCanvas.js';
import type { Round } from '../src/pages/work/conversation/types.js';
import type { FakeScript, FakeStep } from '../../src/driver.js';
const { uiFixture, until }: typeof import('../../tests/ui-fixture.js') = await import('../../dist/tests/' + 'ui-fixture.js');

let daemon: Awaited<ReturnType<typeof uiFixture>> | undefined;
afterEach(async () => {
  cleanup(); await daemon?.close(); daemon = undefined;
  localStorage.clear(); window.history.replaceState(null, '', '/');
});

test('卡片节点与明细显示全部派单用量，独立调度者节点按轮次展示并可切回卡片', async () => {
  const ok = (value: any) => expect(value.ok).toBe(true);
  const next: FakeScript = ctx => {
    const ended = JSON.parse(ctx.input).newEvents.find((event: any) => event.action === 'dispatch-ended' && event.details.key === 'first');
    return ended ? [{ type: 'tool', name: 'create-dispatch', arguments: { workId: ended.workId, cardId: ended.details.cardId,
      key: 'verify', purpose: 'verification', agentId: 'claude-executor' }, check: ok }] : [];
  };
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: 'Token', boundary: '本机', criteria: '可查' }), check: ok },
    { type: 'end', reason: 'completed', usage: { inputTokens: 100, outputTokens: 20 } },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '用量卡片' }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, cardId: (ctx.results.get('card') as any).result.id, key: 'first', agentId: 'claude-executor' }), check: ok },
    { type: 'end', reason: 'completed', usage: { inputTokens: 50, outputTokens: 10 } },
  ], ...Array<FakeScript>(10).fill(next)], undefined, { executorScripts: [
    [{ type: 'end', reason: 'completed', usage: { inputTokens: 30, outputTokens: 5 } }],
    [{ type: 'end', reason: 'error', usage: { inputTokens: 10, outputTokens: 2 } }],
  ] });
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '用量工作' })).result.work;
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  const description = (await daemon.call('get-work-descriptions', { workId: work.id })).result[0];
  ok(await daemon.call('decide-gate', { workId: work.id, gateId: description.gateId, descriptionId: description.id, decision: 'confirm' }));
  await until(() => daemon!.call('list-dispatches', { workId: work.id }), value => value.result.length === 2 && value.result.every((dispatch: any) => dispatch.status === 'ended'));
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds.every((round: any) => round.status === 'ended'));
  window.history.replaceState(null, '', `/works/${work.id}/structure`);
  render(<App baseUrl={daemon.url} />);
  const graph = await screen.findByRole('region', { name: '卡片图' });
  const card = await within(graph).findByRole('button', { name: '卡片 1：用量卡片' });
  expect(card.textContent).toContain('Token 47');
  fireEvent.click(card);
  const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
  expect(within(inspector).getByText('Token 合计 47')).toBeTruthy();
  const table = within(inspector).getByRole('table', { name: '派单 Token' });
  expect(within(table).getAllByRole('row').map(row => row.textContent)).toEqual(['派单输入 Token输出 Token', '#1 · 执行305', '#2 · 验收102']);
  fireEvent.click(within(graph).getByRole('button', { name: '调度者 Token 明细' }));
  const coordinator = screen.getByRole('complementary', { name: '调度者 Token 明细' });
  expect(within(coordinator).getByText('Token 合计 180')).toBeTruthy();
  const rounds = within(coordinator).getByRole('table', { name: '调度轮次 Token' });
  expect(within(rounds).getAllByRole('row').slice(1, 3).map(row => row.textContent)).toEqual(['#110020', '#25010']);
  fireEvent.click(card);
  expect(screen.getByRole('complementary', { name: '卡片检查器' })).toBeTruthy();
  await waitFor(() => expect(screen.getAllByText('Token 227')).toHaveLength(2));
});

test('对齐阶段的顶部和收件箱始终显示 Token 标签，未报告用量显示 —', async () => {
  daemon = await uiFixture([[{ type: 'end', reason: 'completed' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '对齐用量' })).result.work;
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await waitFor(() => expect(screen.getAllByText('Token —')).toHaveLength(2));
});

test('调度者的合计不会用已知轮次掩盖缺项，明细保留已知输入和真实零输出', () => {
  const rounds: Round[] = [
    { id: 'one', number: 1, agentId: 'coordinator', status: 'ended', startedAt: '', endedAt: '', reason: 'completed', usage: { inputTokens: 100, outputTokens: 20 } },
    { id: 'two', number: 2, agentId: 'coordinator', status: 'ended', startedAt: '', endedAt: '', reason: 'error', usage: { inputTokens: null, outputTokens: 0 } },
  ];
  render(<I18nProvider><CoordinatorTokens rounds={rounds} /></I18nProvider>);
  expect(screen.getByText('Token 合计 —')).toBeTruthy();
  expect(screen.getByText('输入 — · 输出 20')).toBeTruthy();
  const rows = within(screen.getByRole('table')).getAllByRole('row');
  expect(rows[2]?.textContent).toBe('#2 · 出错退出—0');
});

test('尚无卡片和轮次时保留独立调度者节点，用量显示 —', () => {
  render(<I18nProvider><GraphCanvas nodes={[]} dispatches={[]} selectedId={null} sendBacks={new Map()} select={() => {}}
    coordinator={{ count: 0, usage: sumUsage([]), selected: true, select: () => {} }} /><CoordinatorTokens rounds={[]} /></I18nProvider>);
  expect(screen.getByRole('button', { name: '调度者 Token 明细' }).textContent).toContain('Token —');
  expect(screen.getByText('Token 合计 —')).toBeTruthy();
  expect(screen.getAllByText('还没有调度轮次。').length).toBeGreaterThan(0);
});
