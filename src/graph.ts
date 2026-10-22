import { randomUUID } from 'node:crypto';
import { RuleError, TaskStore, type Actor } from './store.js';
import type { TokenUsage } from './driver.js';

export interface Card {
  id: string; workId: string; key: string; content: string; needsVerification: boolean;
  status: string; createdAt: string; workPath?: string | null; cardBranch?: string | null;
  templateId?: string | null; latestDispatchId?: string | null; currentStep?: number;
  latestStepSummary?: string | null; lastEndReason?: string | null; lastConclusion?: string | null;
  repairOfCardId?: string | null;
  usage: TokenUsage;
}
export interface NodeRef { type: 'card' | 'gate'; id: string }
interface Dependency { upstream: NodeRef; downstream: NodeRef }

const cardColumns = `id, work_id AS workId, key, content, needs_verification AS needsVerification, status, created_at AS createdAt,
  work_path AS workPath, card_branch AS cardBranch, repair_of_card_id AS repairOfCardId, template_id AS templateId, latest_dispatch_id AS latestDispatchId,
  current_step AS currentStep, latest_step_summary AS latestStepSummary,
  (SELECT end_reason FROM dispatches WHERE id = cards.latest_dispatch_id) AS lastEndReason,
  (SELECT conclusion FROM dispatches WHERE id = cards.latest_dispatch_id) AS lastConclusion,
  (SELECT json_object('inputTokens', COALESCE(SUM(json_extract(usage, '$.inputTokens')), 0),
    'outputTokens', COALESCE(SUM(json_extract(usage, '$.outputTokens')), 0)) FROM dispatches WHERE card_id = cards.id) AS usage`;

function readCard(row: Record<string, unknown>): Card {
  return { ...row, needsVerification: Boolean(row.needsVerification), usage: JSON.parse(String(row.usage)) } as unknown as Card;
}

export function cardDetails(store: TaskStore, workId: string, cardId: string): Card {
  store.work(workId);
  const row = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE id = ? AND work_id = ?`).get(cardId, workId);
  if (!row) throw new RuleError('INVALID_CARD', '卡片必须属于这项工作。', 400);
  return readCard(row);
}

function requireExecuting(store: TaskStore, workId: string) {
  if (store.work(workId).status !== 'executing') throw new RuleError('WORK_NOT_EXECUTING', '只能在执行中的工作里修改卡片图。');
}

function requireMutable(card: Pick<Card, 'status'>) {
  if (card.status === 'completed' || card.status === 'cancelled') throw new RuleError('TERMINAL_CARD', '完成或已取消的卡片不能再修改。');
}

function wake(store: TaskStore, eventId: number, workId: string) {
  store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(eventId, workId);
}

export function createCard(store: TaskStore, actor: Actor, params: {
  workId: string; key: string; content: string; needsVerification?: boolean; repairOfCardId?: string;
}) {
  store.work(params.workId);
  const existing = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE work_id = ? AND key = ?`).get(params.workId, params.key);
  if (existing) return readCard(existing);
  requireExecuting(store, params.workId);
  if (params.repairOfCardId) requireMutable(cardDetails(store, params.workId, params.repairOfCardId));
  const card: Card = { id: randomUUID(), ...params, needsVerification: params.needsVerification ?? false,
    status: 'ready', createdAt: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0 } };
  store.db.prepare('INSERT INTO cards (id, work_id, key, content, needs_verification, status, created_at, repair_of_card_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(card.id, card.workId, card.key, card.content, Number(card.needsVerification), card.status, card.createdAt, card.repairOfCardId ?? null);
  store.appendEvent(actor, { type: 'card', id: card.id }, 'card-created', card, { workId: card.workId, cardId: card.id });
  const event = store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'card', id: card.id }, 'card-ready', { status: card.status }, { workId: card.workId, cardId: card.id });
  wake(store, event.id, card.workId);
  return card;
}

export function updateCard(store: TaskStore, actor: Actor, params: {
  workId: string; cardId: string; content?: string; needsVerification?: boolean;
}) {
  const card = cardDetails(store, params.workId, params.cardId);
  requireMutable(card);
  const content = params.content ?? card.content;
  const needsVerification = params.needsVerification ?? card.needsVerification;
  if (content === card.content && needsVerification === card.needsVerification) return card;
  store.db.prepare('UPDATE cards SET content = ?, needs_verification = ? WHERE id = ?').run(content, Number(needsVerification), card.id);
  const updated = cardDetails(store, card.workId, card.id);
  store.appendEvent(actor, { type: 'card', id: card.id }, 'card-updated', { before: card, after: updated }, { workId: card.workId, cardId: card.id });
  return updated;
}

export function cancelCard(store: TaskStore, actor: Actor, params: { workId: string; cardId: string; reason: string }) {
  const card = cardDetails(store, params.workId, params.cardId);
  if (card.status === 'cancelled') return card;
  requireMutable(card);
  store.db.prepare(`UPDATE cards SET status = 'cancelled' WHERE id = ?`).run(card.id);
  const event = store.appendEvent(actor, { type: 'card', id: card.id }, 'card-cancelled', { reason: params.reason }, { workId: card.workId, cardId: card.id });
  wake(store, event.id, card.workId);
  refreshCardReadiness(store, card.workId);
  return cardDetails(store, card.workId, card.id);
}

export function cardGraph(store: TaskStore, workId: string) {
  store.work(workId);
  const cards = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE work_id = ? ORDER BY created_at, id`).all(workId).map(readCard);
  const gates = store.gates(workId);
  const edges = dependencies(store, workId);
  return [
    ...cards.map(card => ({ type: 'card' as const, ...card })),
    ...gates.map(gate => ({ type: 'gate' as const, ...gate })),
  ].map(node => ({ ...node, dependencies: edges.filter(edge => sameNode(edge.downstream, node)).map(edge => edge.upstream) }));
}

function dependencies(store: TaskStore, workId: string): Dependency[] {
  return store.db.prepare(`SELECT upstream_type, upstream_id, downstream_type, downstream_id FROM dependencies
    WHERE work_id = ? ORDER BY upstream_type, upstream_id, downstream_type, downstream_id`).all(workId).map(row => ({
    upstream: { type: row.upstream_type as NodeRef['type'], id: String(row.upstream_id) },
    downstream: { type: row.downstream_type as NodeRef['type'], id: String(row.downstream_id) },
  }));
}

function sameNode(left: NodeRef, right: NodeRef) { return left.type === right.type && left.id === right.id; }

function graphNode(store: TaskStore, workId: string, node: NodeRef) {
  const row = store.db.prepare(`SELECT work_id FROM ${node.type === 'card' ? 'cards' : 'gates'} WHERE id = ?`).get(node.id);
  if (!row) throw new RuleError('INVALID_NODE', '找不到依赖中的卡片或关卡。', 400);
  if (row.work_id !== workId) throw new RuleError('CROSS_WORK_DEPENDENCY', '依赖两端必须属于同一项工作。');
  return node.type === 'card' ? cardDetails(store, workId, node.id) : store.gate(workId, node.id);
}

function ancestors(edges: Dependency[], node: NodeRef): NodeRef[] {
  const result = new Map<string, NodeRef>();
  const pending = [node];
  while (pending.length) {
    const current = pending.pop()!;
    for (const edge of edges) {
      if (!sameNode(edge.downstream, current)) continue;
      const key = `${edge.upstream.type}:${edge.upstream.id}`;
      if (result.has(key)) continue;
      result.set(key, edge.upstream);
      pending.push(edge.upstream);
    }
  }
  return [...result.values()];
}

// Re-evaluate idle cards; active dispatches and user-set paused/terminal states stay intact.
export function refreshCardReadiness(store: TaskStore, workId: string) {
  const edges = dependencies(store, workId);
  const cards = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE work_id = ? AND status NOT IN ('paused', 'completed', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM dispatches WHERE card_id = cards.id AND status IN ('queued', 'running'))`).all(workId).map(readCard);
  for (const card of cards) {
    const blocked = ancestors(edges, { type: 'card', id: card.id }).some(node => {
      const upstream = graphNode(store, workId, node);
      return upstream.status !== (node.type === 'card' ? 'completed' : 'decided');
    });
    const status = blocked ? 'waiting' : card.latestDispatchId ? 'executing' : 'ready';
    if (status === card.status) continue;
    store.db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(status, card.id);
    const event = store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'card', id: card.id },
      status === 'waiting' ? 'card-waiting' : status === 'ready' ? 'card-ready' : 'card-unblocked', { previousStatus: card.status, status }, { workId, cardId: card.id });
    if (status === 'ready') wake(store, event.id, workId);
  }
}

export function addDependency(store: TaskStore, actor: Actor, params: { workId: string } & Dependency) {
  requireExecuting(store, params.workId);
  const upstream = graphNode(store, params.workId, params.upstream);
  const downstream = graphNode(store, params.workId, params.downstream);
  if (params.downstream.type === 'card') requireMutable(downstream);
  if (upstream.status === 'cancelled' || upstream.status === 'withdrawn') throw new RuleError('INACTIVE_UPSTREAM', '不能依赖已取消的卡片或已撤回的关卡。');
  const edges = dependencies(store, params.workId);
  if (edges.some(edge => sameNode(edge.upstream, params.upstream) && sameNode(edge.downstream, params.downstream))) return params;
  if (sameNode(params.upstream, params.downstream) || ancestors(edges, params.upstream).some(node => sameNode(node, params.downstream))) {
    throw new RuleError('DEPENDENCY_CYCLE', '依赖不能成环。');
  }
  store.db.prepare('INSERT INTO dependencies VALUES (?, ?, ?, ?, ?)')
    .run(params.workId, params.upstream.type, params.upstream.id, params.downstream.type, params.downstream.id);
  store.appendEvent(actor, { type: params.downstream.type, id: params.downstream.id }, 'dependency-added', params,
    { workId: params.workId, ...(params.downstream.type === 'card' ? { cardId: params.downstream.id } : {}) });
  refreshCardReadiness(store, params.workId);
  return params;
}

export function removeDependency(store: TaskStore, actor: Actor, params: { workId: string } & Dependency) {
  requireExecuting(store, params.workId);
  graphNode(store, params.workId, params.upstream);
  graphNode(store, params.workId, params.downstream);
  const removed = store.db.prepare(`DELETE FROM dependencies WHERE work_id = ? AND upstream_type = ? AND upstream_id = ? AND downstream_type = ? AND downstream_id = ?`)
    .run(params.workId, params.upstream.type, params.upstream.id, params.downstream.type, params.downstream.id);
  if (removed.changes) {
    store.appendEvent(actor, { type: params.downstream.type, id: params.downstream.id }, 'dependency-removed', params,
      { workId: params.workId, ...(params.downstream.type === 'card' ? { cardId: params.downstream.id } : {}) });
    refreshCardReadiness(store, params.workId);
  }
  return params;
}

export function proposeGate(store: TaskStore, actor: Actor, params: {
  workId: string; key: string; question: string; body?: string; options?: string[];
}) {
  const existing = store.gates(params.workId).find(gate => gate.key === params.key);
  if (existing) return existing;
  requireExecuting(store, params.workId);
  const id = randomUUID();
  const body = params.body ?? '';
  const options = params.options ?? [];
  const event = store.appendEvent(actor, { type: 'gate', id }, 'gate-created', { kind: 'general', question: params.question, body, options }, { workId: params.workId });
  store.db.prepare(`INSERT INTO gates
    (id, work_id, kind, status, key, question, body, options, creator_type, creator_id, created_at, sequence)
    VALUES (?, ?, 'general', 'pending', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, params.workId, params.key, params.question, body, JSON.stringify(options), actor.type, actor.id, event.time, event.id);
  store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'gate', id }, 'needs-user-attention', { kind: 'general' }, { workId: params.workId });
  return store.gate(params.workId, id);
}

function ownGeneralGate(store: TaskStore, workId: string, gateId: string) {
  const gate = store.gate(workId, gateId);
  if (gate.kind !== 'general') throw new RuleError('FIXED_GATE', '固定关卡不能修改或撤回。');
  // A later round of the same work can maintain gates proposed by an earlier round.
  if (gate.creator.type !== 'coordinator-round') throw new RuleError('GATE_NOT_OWNED', '调度者只能修改或撤回自己提出的一般关卡。');
  return gate;
}

export function updateGate(store: TaskStore, actor: Actor, params: {
  workId: string; gateId: string; question?: string; body?: string; options?: string[];
}) {
  const gate = ownGeneralGate(store, params.workId, params.gateId);
  if (gate.status !== 'pending') throw new RuleError('GATE_CLOSED', '只能修改等待决定的关卡。');
  const question = params.question ?? gate.question;
  const body = params.body ?? gate.body;
  const options = params.options ?? gate.options;
  if (question === gate.question && body === gate.body && JSON.stringify(options) === JSON.stringify(gate.options)) return gate;
  store.db.prepare('UPDATE gates SET question = ?, body = ?, options = ? WHERE id = ?').run(question, body, JSON.stringify(options), gate.id);
  const updated = store.gate(gate.workId, gate.id);
  store.appendEvent(actor, { type: 'gate', id: gate.id }, 'gate-updated', { before: gate, after: updated }, { workId: gate.workId });
  return updated;
}

export function withdrawGate(store: TaskStore, actor: Actor, params: { workId: string; gateId: string; reason: string }) {
  const gate = ownGeneralGate(store, params.workId, params.gateId);
  if (gate.status === 'withdrawn') return gate;
  if (gate.status !== 'pending') throw new RuleError('GATE_CLOSED', '已决定的关卡不能撤回。');
  store.db.prepare(`UPDATE gates SET status = 'withdrawn', withdrawal_reason = ? WHERE id = ?`).run(params.reason, gate.id);
  const event = store.appendEvent(actor, { type: 'gate', id: gate.id }, 'gate-withdrawn', { reason: params.reason }, { workId: gate.workId });
  wake(store, event.id, gate.workId);
  refreshCardReadiness(store, gate.workId);
  return store.gate(gate.workId, gate.id);
}

export function decideGate(store: TaskStore, actor: Actor, params: {
  workId: string; gateId: string; decision: string;
}) {
  const gate = store.gate(params.workId, params.gateId);
  if (gate.kind !== 'general') throw new RuleError('INVALID_GATE', '此关卡不支持一般决定。', 400);
  if (gate.status === 'withdrawn') throw new RuleError('GATE_WITHDRAWN', '已撤回的关卡不能作决定。');
  if (gate.status === 'decided') {
    if (gate.decision !== params.decision) throw new RuleError('GATE_DECIDED', '关卡已经决定，不能改写用户的决定。');
    return gate;
  }
  return store.transaction(() => {
    store.db.prepare(`UPDATE gates SET status = 'decided', decision = ? WHERE id = ?`).run(params.decision, gate.id);
    const event = store.appendEvent(actor, { type: 'gate', id: gate.id }, 'gate-decided', { decision: params.decision }, { workId: gate.workId });
    wake(store, event.id, gate.workId);
    refreshCardReadiness(store, gate.workId);
    return store.gate(gate.workId, gate.id);
  });
}

export function gateHistory(store: TaskStore, workId: string, gateId: string) {
  store.gate(workId, gateId);
  return store.events({ workId }).filter(event => event.object.type === 'gate' && event.object.id === gateId
    && ['gate-created', 'gate-updated', 'gate-decided', 'gate-withdrawn'].includes(event.action));
}
