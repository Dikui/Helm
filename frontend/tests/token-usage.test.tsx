import { structureTab } from './inspector-navigation.js';
import { afterEach, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../src/App.js';
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
    const ended = JSON.parse(ctx.input).wakeEvents.find((event: any) => event.action === 'dispatch-ended' && event.details.key === 'first');
    return ended ? [{ type: 'tool', name: 'create-dispatch', arguments: { workId: ended.workId, cardId: ended.details.cardId,
      key: 'verify', purpose: 'verification', agentId: 'claude-executor' }, check: ok }] : [];
  };
  daemon = await uiFixture([[
    { type: 'tool', name: 'draft-work-description', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'brief', requirements: 'Token', boundary: '本机', criteria: '可查' }), check: ok },
    { type: 'end', reason: 'completed', usage: { inputTokens: 100, outputTokens: 20 } },
  ], [
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'card', content: '用量卡片' }), saveAs: 'card', check: ok },
    { type: 'tool', name: 'create-dispatch', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, cardId: (ctx.results.get('card') as any).result.id, key: 'first', agentId: 'claude-executor' }), check: ok },
    { type: 'tool', name: 'create-card', arguments: ctx => ({ workId: JSON.parse(ctx.input).work.id, key: 'empty-card', content: '尚未派单的用量卡片' }), check: ok },
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
  expect(card.getAttribute('title')).toContain('Token 47');
  fireEvent.click(card);
  const inspector = screen.getByRole('complementary', { name: '卡片检查器' });
  expect(within(inspector).getByText('Token 合计 47')).toBeTruthy();
  const table = within(inspector).getByRole('table', { name: '派单 Token' });
  expect(within(table).getAllByRole('row').map(row => row.textContent)).toEqual(['派单总输入输出', '#1 · 执行305', '#2 · 验收102']);
  fireEvent.click(within(within(inspector).getByRole('navigation', { name: '选择卡片用量' })).getByRole('button', { name: '卡片 2' }));
  expect(await within(inspector).findByRole('heading', { name: '尚未派单的用量卡片' })).toBeTruthy();
  const emptyUsage = within(inspector).getByRole('region', { name: '派单 Token' });
  await waitFor(() => expect(document.activeElement).toBe(emptyUsage));
  expect(await within(emptyUsage).findByText('尚无派单用量。')).toBeTruthy();
  expect(within(emptyUsage).getByText('Token 合计 —')).toBeTruthy();
  fireEvent.click(within(within(inspector).getByRole('navigation', { name: '选择卡片用量' })).getByRole('button', { name: '卡片 1' }));
  expect(await within(inspector).findByText('Token 合计 47')).toBeTruthy();

  fireEvent.click(structureTab('依赖图'));
  fireEvent.click(within(screen.getByRole('navigation', { name: '现在条' })).getByRole('button', { name: /调度者/ }));
  const coordinator = screen.getByRole('complementary', { name: '调度者检查器' });
  expect(await within(coordinator).findByText('Token 合计 180')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  const rounds = within(coordinator).getByRole('table', { name: '调度轮次 Token' });
  expect(within(rounds).getAllByRole('row').slice(1, 3).map(row => row.textContent)).toEqual(['第 1 轮10020', '第 2 轮5010']);
  fireEvent.click(structureTab('依赖图'));
  fireEvent.click(await screen.findByRole('button', { name: '卡片 1：用量卡片' }));
  expect(screen.getByRole('complementary', { name: '卡片检查器' })).toBeTruthy();
  await waitFor(() => expect(within(screen.getByRole('banner', { name: '工作概况' })).getByText('Token 227')).toBeTruthy());
});

test('对齐阶段顶部显示 Token，未报告用量显示 —；收件箱只显示进展', async () => {
  daemon = await uiFixture([[{ type: 'end', reason: 'completed' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: '对齐用量' })).result.work;
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  window.history.replaceState(null, '', `/works/${work.id}`);
  render(<App baseUrl={daemon.url} />);
  await waitFor(() => expect(within(screen.getByRole('banner', { name: '工作概况' })).getByText('Token —')).toBeTruthy());
  expect(within(screen.getByRole('complementary', { name: 'Helm' })).queryByText(/Token/)).toBeNull();
});

test('调度者未知计数及含未知项的合计显示 —，缓存明细和真实零值仍可查，支持英文', async () => {
  daemon = await uiFixture([[
    { type: 'end', reason: 'completed', usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 15 } },
  ], [
    { type: 'end', reason: 'completed', usage: { inputTokens: null, outputTokens: 0 } },
  ]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: 'Partial usage' })).result.work;
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[0]?.status === 'ended');
  await daemon.call('send-message', { workId: work.id, key: 'more', body: 'Next round' });
  await until(() => daemon!.call('list-rounds', { workId: work.id }), value => value.result.rounds[1]?.status === 'ended');
  window.history.replaceState(null, '', `/works/${work.id}?inspect=coord`);
  render(<App baseUrl={daemon.url} />);
  const coordinator = await screen.findByRole('complementary', { name: '调度者检查器' });
  const usage = within(coordinator).getByRole('region', { name: '调度轮次 Token' });
  expect(await within(usage).findByText('Token 合计 —')).toBeTruthy();
  expect(await within(usage).findByText('总输入 — · 输出 20')).toBeTruthy();
  expect(within(usage).getByText('驱动未报告的用量和含未知项的合计显示 —，不记为 0。')).toBeTruthy();
  const rows = within(within(usage).getByRole('table', { name: '调度轮次 Token' })).getAllByRole('row');
  expect(rows.map(row => row.textContent)).toEqual(['调度轮次总输入输出', '第 1 轮10020', '第 2 轮—0']);
  fireEvent.click(within(usage).getByText('缓存明细', { selector: 'summary' }));
  const cache = within(usage).getByRole('table', { name: '缓存明细' });
  expect(within(cache).getAllByRole('row').map(row => row.textContent)).toEqual(['调度轮次未缓存缓存读取缓存写入', '第 1 轮58015', '第 2 轮———']);
  fireEvent.click(screen.getByRole('button', { name: 'EN' }));
  expect(within(usage).getByText('Token total —')).toBeTruthy();
  expect(within(usage).getByText('Usage not reported by the driver and totals containing unknown counts show —, never 0.')).toBeTruthy();
  expect(within(usage).getByRole('table', { name: 'Cache details' })).toBeTruthy();
  expect(coordinator.textContent).not.toMatch(/[\u3400-\u9fff]/);
});

test('尚无卡片、派单、轮次、笔记时检查器给出空态，Token 显示 —', async () => {
  daemon = await uiFixture([[{ type: 'end', reason: 'completed' }]]);
  const work = (await daemon.call('send-message', { projectId: daemon.project.id, key: 'start', body: 'Empty inspector' })).result.work;
  // Historical work can have no saved rounds or graph; other reads still use the real helmd.
  const transport: typeof fetch = async (input, init) => {
    const response = await fetch(input, init);
    const rounds = String(input).endsWith('/api/list-rounds');
    if (!rounds && !String(input).endsWith('/api/get-card-graph')) return response;
    const body = await response.json();
    body.result = rounds ? { ...body.result, rounds: [], currentSteps: [], currentPlan: [] } : [];
    return Response.json(body);
  };
  window.history.replaceState(null, '', `/works/${work.id}?inspect=coord`);
  const view = render(<App baseUrl={daemon.url} transport={transport} />);
  const coordinator = await screen.findByRole('complementary', { name: '调度者检查器' });
  expect(await within(coordinator).findByText('Token 合计 —')).toBeTruthy();
  expect(await within(coordinator).findByText('还没有调度轮次。')).toBeTruthy();
  expect(await within(coordinator).findByText('尚无轮次用量。')).toBeTruthy();
  expect(await within(coordinator).findByText('还没有调度笔记。')).toBeTruthy();
  expect(within(coordinator).queryByRole('table')).toBeNull();
  view.unmount();
  window.history.replaceState(null, '', `/works/${work.id}?inspect=graph`);
  render(<App baseUrl={daemon.url} transport={transport} />);
  expect(await screen.findByText('调度者尚未创建卡片或关卡。')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '调度者 Token 明细' })).toBeNull();
});

test('工作概况保留已知部分用量的原有格式，真实零值不当作缺项', async () => {
  const { formatUsage } = await import('../src/shared/token-usage.js');
  expect(formatUsage({ inputTokens: 0, outputTokens: 0, incomplete: true }, 'zh')).toBe('—');
  expect(formatUsage({ inputTokens: 0, outputTokens: null }, 'zh')).toBe('—');
  expect(formatUsage({ inputTokens: 0, outputTokens: 0 }, 'zh')).toBe('0');
  expect(formatUsage({ inputTokens: 1200, outputTokens: 0, incomplete: true }, 'zh')).toBe('1200+');
});
