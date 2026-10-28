import { afterEach, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../src/shared/i18n.js';
import { RoundSteering } from '../src/pages/work/conversation/RoundSteering.js';
import { Thinking } from '../src/pages/work/conversation/RoundProgress.js';
import type { Round } from '../src/pages/work/conversation/types.js';

afterEach(() => { cleanup(); vi.useRealTimers(); });
const round: Round = { id: 'round-1', number: 1, agentId: 'coordinator', status: 'running', startedAt: '2026-10-28T10:00:00Z', endedAt: null, usage: { inputTokens: 0, outputTokens: 0 }, reason: null };
const props = { round, workId: 'work-1', queue: [], interrupt: () => {}, withdraw: () => {}, busy: false, reference: () => undefined, pauseReason: null };

test('本轮步骤默认折叠成最新首行，展开和收起正常，零间隔不显示', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-28T10:00:05Z'));
  render(<I18nProvider><RoundSteering {...props} steps={[
    { step: 1, type: 'output', text: '读取结果\n详细内容', time: '2026-10-28T10:00:00Z' },
    { step: 2, type: 'output', text: '安排验收', time: '2026-10-28T10:00:00Z' },
    { step: 3, type: 'output', text: '检查邮件模板', time: '2026-10-28T10:00:04Z' },
  ]} /></I18nProvider>);
  const heading = screen.getByText('本轮 3 步 · 最新：检查邮件模板');
  const folded = heading.closest('details')!;
  expect(folded.open).toBe(false);
  fireEvent.click(heading.closest('summary')!);
  expect(folded.open).toBe(true);
  expect(within(folded).getByText('读取结果', { selector: 'summary' })).toBeTruthy();
  expect(within(folded).queryByLabelText('输出间隔 1')).toBeNull();
  expect(within(folded).getByLabelText('输出间隔 2').textContent).toBe('00:04');
  fireEvent.click(heading.closest('summary')!);
  expect(folded.open).toBe(false);
});

test('轮次开始无步骤也显示思考提示和递增用时，首行截断且忽略 CLI 流水，结束后消失', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(round.startedAt));
  const view = render(<I18nProvider><Thinking round={round} steps={[]} /></I18nProvider>);
  const status = screen.getByRole('status');
  expect(within(status).getByText('调度者正在思考…')).toBeTruthy();
  expect(within(status).getByText('等待首次输出')).toBeTruthy();
  expect(within(status).getByLabelText('本轮用时').textContent).toBe('00:00');
  act(() => { vi.advanceTimersByTime(3000); });
  expect(within(status).getByLabelText('本轮用时').textContent).toBe('00:03');
  const firstLine = '核对邮件模板'.repeat(40);
  view.rerender(<I18nProvider><Thinking round={round} steps={[
    { step: 1, type: 'output', text: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: `${firstLine}\n后续说明不显示` }] } }) },
    { step: 2, type: 'output', text: JSON.stringify({ type: 'system', subtype: 'status' }) },
  ]} /></I18nProvider>);
  const latest = within(status).getByTitle(firstLine);
  expect(latest.textContent).toBe(`${firstLine.slice(0, 160)}…`);
  expect(status.textContent).not.toContain('后续说明');
  view.rerender(<I18nProvider><Thinking round={{ ...round, status: 'ended', endedAt: '2026-10-28T10:00:03Z' }} steps={[]} /></I18nProvider>);
  expect(screen.queryByRole('status')).toBeNull();
});

test('有本轮计划时先展开计划，再展开执行步骤，清空计划后直接显示执行步骤', () => {
  const plan = [{ content: '读取结果', status: 'completed' as const }, { content: '安排验收', status: 'in_progress' as const }, { content: '汇报进度', status: 'pending' as const }];
  const steps = [{ step: 1, type: 'plan' as const, entries: plan }, { step: 2, type: 'output' as const, text: '已安排验收' }];
  const view = render(<I18nProvider><RoundSteering {...props} steps={steps} plan={plan} /></I18nProvider>);
  expect(screen.getByRole('list', { name: '本轮计划' }).closest('details')!.open).toBe(false);
  const heading = screen.getByText('本轮 1 步 · 最新：已安排验收');
  fireEvent.click(heading.closest('summary')!);
  const list = screen.getByRole('list', { name: '本轮计划' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(3);
  expect(within(list).getByText('进行中').closest('li')!.getAttribute('aria-current')).toBe('step');
  const raw = screen.getByText('执行步骤 · 1', { selector: 'summary' });
  expect(raw.closest('details')!.open).toBe(false);
  fireEvent.click(raw);
  expect(raw.closest('details')!.open).toBe(true);
  expect(within(raw.closest('details')!).getByText('已安排验收', { selector: 'summary' })).toBeTruthy();
  view.rerender(<I18nProvider><RoundSteering {...props} steps={steps} plan={[]} /></I18nProvider>);
  expect(screen.queryByRole('list', { name: '本轮计划' })).toBeNull();
  expect(screen.getByText('已安排验收', { selector: 'summary' }).closest('details')!.parentElement!.tagName).toBe('LI');
});

test.each([
  (text: string) => text,
  (text: string) => JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }),
  (text: string) => JSON.stringify({ method: 'item/completed', params: { item: { type: 'agentMessage', text } } }),
  (text: string) => JSON.stringify({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } }),
])('文字输出显示第一行并截断，展开后保留完整原文 %#', encode => {
  const first = '检查邮件模板'.repeat(40);
  const raw = encode(`\n${first}\n完整第二行`);
  render(<I18nProvider><RoundSteering {...props} steps={[{ step: 1, type: 'output', text: raw }]} /></I18nProvider>);
  const heading = screen.getByTitle(`本轮 1 步 · 最新：${first}`);
  expect(heading.textContent!.length).toBeLessThanOrEqual(161);
  fireEvent.click(heading.closest('summary')!);
  const step = screen.getByText(`${first.slice(0, 160)}…`, { selector: 'summary' });
  expect(step.title).toBe(first);
  fireEvent.click(step);
  expect(step.closest('details')!.open).toBe(true);
  expect(step.closest('details')!.querySelector('pre')!.textContent).toBe(raw);
});

test('只有 CLI 内部事件时保持等待首次输出，仍能展开原始事件', () => {
  render(<I18nProvider><RoundSteering {...props} steps={[{ step: 1, type: 'output', text: JSON.stringify({ type: 'system', subtype: 'init' }) }]} /></I18nProvider>);
  const heading = screen.getByText('本轮 0 步 · 等待首次输出');
  fireEvent.click(heading.closest('summary')!);
  const internal = screen.getByText('CLI 内部事件 · 1', { selector: 'summary' });
  fireEvent.click(internal);
  expect(internal.closest('details')!.open).toBe(true);
  expect(within(internal.closest('details')!).getByText('会话初始化', { selector: 'summary' })).toBeTruthy();
});
