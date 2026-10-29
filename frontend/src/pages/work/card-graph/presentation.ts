import type { Dispatch, GraphNode, NodeRef } from './types.js';
import { sendBackDispatchIds } from './dispatch-history.js';

// These edges only arrange the two workflow gates. Never send them to the API.
export function displayTopology(nodes: GraphNode[]) {
  const confirmations = nodes.filter(node => node.type === 'gate' && node.kind === 'work-confirmation');
  const reviews = nodes.filter(node => node.type === 'gate' && node.kind === 'review');
  const fixed = new Set([...confirmations, ...reviews].map(node => node.id));
  const ordinary = nodes.filter(node => !fixed.has(node.id));
  const ids = new Set(ordinary.map(node => node.id));
  const roots = ordinary.filter(node => !node.dependencies.some(ref => ids.has(ref.id)));
  const leaves = ordinary.filter(node => !ordinary.some(next => next.dependencies.some(ref => ref.id === node.id)));
  const ref = (node: GraphNode): NodeRef => ({ type: node.type, id: node.id });
  return nodes.map(node => ({ id: node.id, dependencies: fixed.has(node.id)
    ? reviews.some(review => review.id === node.id) ? (leaves.length ? leaves : confirmations).map(ref) : []
    : [...node.dependencies.filter(item => ids.has(item.id)), ...(roots.some(root => root.id === node.id) ? confirmations.map(ref) : [])] }));
}

export function graphSummary(nodes: GraphNode[], dispatches: Dispatch[]) {
  const cards = nodes.filter(node => node.type === 'card');
  const loops = sendBackDispatchIds(dispatches);
  const sendBacks = new Map<string, number>();
  for (const dispatch of dispatches) if (loops.has(dispatch.id)) sendBacks.set(dispatch.cardId, (sendBacks.get(dispatch.cardId) ?? 0) + 1);
  return { cards: cards.length, parallel: cards.filter(card => card.status === 'executing' || card.status === 'verifying').length,
    skipped: cards.filter(card => card.status === 'skipped').length,
    cancelled: cards.filter(card => card.status === 'cancelled').length, retries: loops.size, sendBacks };
}

export function dispatchDuration(dispatches: Dispatch[], now: number) {
  return dispatches.reduce((total, dispatch) => total + (dispatch.startedAt
    ? Math.max(0, (dispatch.endedAt ? Date.parse(dispatch.endedAt) : now) - Date.parse(dispatch.startedAt)) : 0), 0);
}

// Idle stretches longer than this (waiting for the user, paused) are drawn at this length with a break mark, so runs keep the width.
export const idleCap = 2 * 60_000;

export function timelineScale(dispatches: Dispatch[], rounds: { startedAt: string; endedAt: string | null }[], now: number) {
  const runs = [...dispatches.filter(dispatch => dispatch.startedAt).map(dispatch => ({ startedAt: dispatch.startedAt!, endedAt: dispatch.endedAt })), ...rounds]
    .map(run => [Date.parse(run.startedAt), run.endedAt ? Date.parse(run.endedAt) : now] as const).sort((a, b) => a[0] - b[0]);
  const start = Math.min(now, ...runs.map(run => run[0]));
  // Finished work keeps a readable time scale even when reopened much later.
  const end = runs.length ? Math.max(...runs.map(run => run[1])) : now;
  const gaps: { from: number; to: number }[] = [];
  let busy = start;
  for (const [from, to] of runs) {
    if (from - busy > idleCap) gaps.push({ from: busy, to: from });
    busy = Math.max(busy, to);
  }
  // Each long gap loses its middle; later times shift left by what was dropped.
  const shown = (time: number) => gaps.reduce((value, gap) =>
    value - Math.max(0, Math.min(time, gap.to - idleCap / 2) - (gap.from + idleCap / 2)), time) - start;
  const span = Math.max(60_000, Math.ceil(shown(end) / 60_000) * 60_000) * 1.08;
  const position = (time: number) => shown(time) / span;
  // Real time at a fraction of the axis; a tick on a break reads as the break's start.
  const timeAt = (fraction: number) => gaps.reduce((time, gap) => time > gap.from + idleCap / 2 ? time + gap.to - gap.from - idleCap : time, start + fraction * span);
  return { position, timeAt, breaks: gaps.map(gap => ({ ...gap, at: position(gap.from + idleCap / 2) })) };
}
