import { expect, test } from 'vitest';
import { inboxGroup, workSituation } from '../src/pages/inbox/presentation.js';
import { messages } from '../src/shared/i18n.js';
import type { WorkSummary } from '../src/shared/types.js';

const base: WorkSummary = {
  id: 'work', projectId: 'project', title: 'Work', status: 'executing', createdAt: '2026-01-01', statusSince: '2026-01-01',
  runtimePauseReason: null, usage: { inputTokens: null, outputTokens: null }, summary: '调度轮次结束',
  completedCards: 0, totalCards: 0, cardStatuses: [], hasPendingGate: false, pendingGates: [],
};
const merge = { status: 'conflict' as const, baseBranch: 'main', workBranch: 'helm/work' };
const resolution = { fromCommit: 'before', baseCommit: 'base', baseBranch: 'main' };

test.each<[string, Partial<WorkSummary>, string]>([
  ['aligning', { status: 'aligning' }, 'running'], ['executing', {}, 'running'],
  ['confirmation', { status: 'aligning', hasPendingGate: true, pendingGates: [{ id: 'gate', kind: 'work-confirmation', question: '确认' }] }, 'attention'],
  ['alignment question', { status: 'aligning', hasPendingGate: true }, 'attention'],
  ['execution question', { hasPendingGate: true }, 'attention'],
  ['git initialization', { hasPendingGate: true, pendingGates: [{ id: 'gate', kind: 'git-initialization', question: '初始化' }] }, 'attention'],
  ['review', { status: 'awaiting-review' }, 'attention'], ['accepted', { status: 'accepted' }, 'attention'],
  ['merge queued', { status: 'merge-queued', delivery: { merge } }, 'running'],
  ['merging', { status: 'merging', delivery: { merge } }, 'running'],
  ['conflict', { status: 'accepted', delivery: { merge } }, 'attention'],
  ['conflict solving', { delivery: { merge, resolution: { ...resolution, status: 'solving' } } }, 'running'],
  ['conflict solving with gate', { hasPendingGate: true, delivery: { merge, resolution: { ...resolution, status: 'solving' } } }, 'attention'],
  ['conflict resolved', { status: 'accepted', delivery: { merge, resolution: { ...resolution, status: 'resolved' } } }, 'attention'],
  ['manual conflict', { status: 'accepted', delivery: { merge, resolution: { ...resolution, status: 'manual' } } }, 'attention'],
  ['merge failed', { status: 'accepted', delivery: { merge: { ...merge, status: 'failed' } } }, 'attention'],
  ['push failed', { status: 'completed', delivery: { push: { status: 'failed', baseBranch: 'main' } } }, 'attention'],
  ['paused', { status: 'paused' }, 'quiet'],
  ['paused with pending gate', { status: 'paused', hasPendingGate: true, runtimePauseReason: 'quota' }, 'quiet'],
  ['completed', { status: 'completed' }, 'quiet'], ['cancelled', { status: 'cancelled', hasPendingGate: true }, 'quiet'],
  ['completed without merge', { status: 'completed', delivery: { completedWithoutMerge: true, merge } }, 'quiet'],
])('%s belongs to %s', (_label, patch, expected) => {
  expect(inboxGroup({ ...base, ...patch })).toBe(expected);
});

test('现状用真实活卡片计数；英文翻译运行层文案，保留 Agent 原文', () => {
  const t = (key: keyof typeof messages.en) => messages.en[key];
  expect(workSituation({ ...base, cardStatuses: ['completed', 'executing', 'verifying', 'verification-failed', 'skipped'] }, t)).toBe('2 cards running · Round ended');
  expect(workSituation({ ...base, summary: 'Checking the email template' }, t)).toBe('Executing · Checking the email template');
  expect(workSituation({ ...base, status: 'paused', runtimePauseReason: '调度者额度用完' }, t)).toBe('Paused · Coordinator quota exhausted');
});
