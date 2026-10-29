import { expect, test } from 'vitest';
import { displayTopology, dispatchDuration, graphSummary, timelineRange } from '../src/pages/work/card-graph/presentation.js';
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
  const nodes = [card('a', 'executing'), card('b', 'verifying'), card('c', 'cancelled'), card('skip', 'skipped'), gate('decision', 'general')];
  const dispatches = [dispatch('one', 'a'), dispatch('fail', 'a', 'verification', 'failed'), dispatch('repair', 'a'), dispatch('retry', 'a'), dispatch('only-verify', 'b', 'verification', 'failed')];
  const summary = graphSummary(nodes, dispatches);
  expect(summary).toMatchObject({ cards: 4, parallel: 2, cancelled: 1, skipped: 1, retries: 1 });
  expect([...summary.sendBacks]).toEqual([['a', 1]]);
  expect(graphSummary([], [])).toMatchObject({ cards: 0, parallel: 0, cancelled: 0, skipped: 0, retries: 0 });
});

test('用时跳过排队，完成后的时间线重开不随当前时间拉长，轮次参与范围', () => {
  const at = (seconds: number) => new Date(seconds * 1000).toISOString();
  const runs = [{ startedAt: at(10), endedAt: at(40) }, { startedAt: at(40), endedAt: null }, { startedAt: null, endedAt: null }] as Dispatch[];
  expect(dispatchDuration(runs, 60_000)).toBe(50_000);
  const finished = [{ startedAt: at(10), endedAt: at(40) }] as Dispatch[];
  const rounds = [{ startedAt: at(0), endedAt: at(50) }];
  expect(timelineRange(finished, rounds, 100_000)).toEqual(timelineRange(finished, rounds, 100_000_000));
  expect(timelineRange([], [], 100_000).span).toBeGreaterThan(0);
});

test('收件箱只取最近三条进展，忽略噪声且不修改事件顺序', () => {
  const events = [5, 1, 4, 2, 3].map(id => ({ id, action: id === 5 ? 'process-started' : 'dispatch-step' })) as HelmEvent[];
  expect(recentProgress(events).map(event => event.id)).toEqual([2, 3, 4]);
  expect(events.map(event => event.id)).toEqual([5, 1, 4, 2, 3]);
});
