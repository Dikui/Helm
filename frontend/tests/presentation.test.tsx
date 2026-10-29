import { expect, test } from 'vitest';
import { displayTopology, dispatchDuration, graphSummary, idleCap, timelineScale } from '../src/pages/work/card-graph/presentation.js';
import { recentProgress } from '../src/pages/inbox/recent-progress.js';
import type { Dispatch, GraphNode } from '../src/pages/work/card-graph/types.js';
import type { HelmEvent } from '../src/shared/types.js';

const card = (id: string, status = 'ready', dependencies: string[] = []) => ({ type: 'card', id, status, dependencies: dependencies.map(id => ({ id, type: 'card' })) }) as GraphNode;
const gate = (id: string, kind: string) => ({ type: 'gate', id, kind, status: 'pending', dependencies: [] }) as unknown as GraphNode;
const dispatch = (id: string, cardId: string, purpose = 'execution', conclusion = 'completed') => ({ id, cardId, purpose, conclusion }) as Dispatch;

test('显示拓扑将确认和审核置于首尾，保留一般关卡及真实依赖，不修改源数据', () => {
  const nodes = [card('a'), card('b'), card('join', 'ready', ['a', 'b', 'choice']), card('cut', 'cancelled'), gate('choice', 'general'), gate('confirm', 'work-confirmation'), gate('review', 'review')];
  const before = JSON.stringify(nodes);
  const topology = displayTopology(nodes);
  const deps = (id: string) => topology.find(node => node.id === id)!.dependencies.map(ref => ref.id);
  expect(deps('confirm')).toEqual([]);
  expect(deps('a')).toEqual(['confirm']);
  expect(deps('b')).toEqual(['confirm']);
  expect(deps('choice')).toEqual(['confirm']);
  expect(deps('join')).toEqual(['a', 'b', 'choice']);
  expect(deps('review')).toEqual(['join', 'cut']);
  expect(JSON.stringify(nodes)).toBe(before);
  expect(displayTopology([])).toEqual([]);
  expect(displayTopology([gate('c', 'work-confirmation'), gate('r', 'review')])[1]?.dependencies).toEqual([{ id: 'c', type: 'gate' }]);
});

test('汇总按卡片数并行、取消，只有验收失败后再执行才算打回', () => {
  const nodes = [card('a', 'executing'), card('b', 'verifying'), card('c', 'cancelled'), gate('decision', 'general')];
  const dispatches = [dispatch('one', 'a'), dispatch('fail', 'a', 'verification', 'failed'), dispatch('repair', 'a'), dispatch('retry', 'a'), dispatch('only-verify', 'b', 'verification', 'failed')];
  const summary = graphSummary(nodes, dispatches);
  expect(summary).toMatchObject({ cards: 3, parallel: 2, cancelled: 1, retries: 1 });
  expect([...summary.sendBacks]).toEqual([['a', 1]]);
  expect(graphSummary([], [])).toMatchObject({ cards: 0, parallel: 0, cancelled: 0, retries: 0 });
});

test('用时跳过排队，完成后的时间线重开不随当前时间拉长，轮次参与范围', () => {
  const at = (seconds: number) => new Date(seconds * 1000).toISOString();
  const runs = [{ startedAt: at(10), endedAt: at(40) }, { startedAt: at(40), endedAt: null }, { startedAt: null, endedAt: null }] as Dispatch[];
  expect(dispatchDuration(runs, 60_000)).toBe(50_000);
  const finished = [{ startedAt: at(10), endedAt: at(40) }] as Dispatch[];
  const rounds = [{ startedAt: at(0), endedAt: at(50) }];
  const scale = (now: number) => { const { position, breaks } = timelineScale(finished, rounds, now); return { end: position(50_000), breaks }; };
  expect(scale(100_000)).toEqual(scale(100_000_000));
  expect(timelineScale([], [], 100_000).position(100_000)).toBe(0);
});

test('时间线把超过上限的空闲压成固定宽度，刻度跳过被压掉的时间', () => {
  const at = (minutes: number) => new Date(minutes * 60_000).toISOString();
  // 10 minutes of work, 3 hours waiting for the user, 10 more minutes of work.
  const rounds = [{ startedAt: at(0), endedAt: at(10) }, { startedAt: at(190), endedAt: at(200) }];
  const { position, timeAt, breaks } = timelineScale([], rounds, 0);
  expect(breaks).toEqual([{ from: 600_000, to: 11_400_000, at: position(600_000 + idleCap / 2) }]);
  const width = (from: number, to: number) => position(to * 60_000) - position(from * 60_000);
  expect(width(0, 10)).toBeCloseTo(width(190, 200));
  expect(width(10, 190)).toBeCloseTo(width(0, idleCap / 60_000));
  expect(width(0, 10) / position(200 * 60_000)).toBeGreaterThan(.4);
  expect(timeAt(position(195 * 60_000))).toBeCloseTo(195 * 60_000);
  expect(timeAt(position(5 * 60_000))).toBeCloseTo(5 * 60_000);
  // Short gaps stay to scale.
  expect(timelineScale([], [{ startedAt: at(0), endedAt: at(10) }, { startedAt: at(11), endedAt: at(20) }], 0).breaks).toEqual([]);
});

test('收件箱只取最近三条进展，忽略噪声且不修改事件顺序', () => {
  const events = [5, 1, 4, 2, 3].map(id => ({ id, action: id === 5 ? 'process-started' : 'dispatch-step' })) as HelmEvent[];
  expect(recentProgress(events).map(event => event.id)).toEqual([2, 3, 4]);
  expect(events.map(event => event.id)).toEqual([5, 1, 4, 2, 3]);
});
