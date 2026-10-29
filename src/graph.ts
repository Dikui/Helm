import { randomUUID } from 'node:crypto';
import { RuleError, TaskStore, type Actor } from './store.js';
import type { TokenUsage } from './driver.js';

export interface Card {
  id: string; workId: string; key: string; content: string; needsVerification: boolean; aggregate: boolean;
  status: string; createdAt: string; workPath?: string | null; cardBranch?: string | null;
  agentId?: string | null; latestDispatchId?: string | null; currentStep?: number;
  latestStepSummary?: string | null; lastEndReason?: string | null; lastConclusion?: string | null;
  repairOfCardId?: string | null; writeScopes: string[];
  usage: TokenUsage;
}
export interface NodeRef { type: 'card' | 'gate'; id: string }
interface Dependency { upstream: NodeRef; downstream: NodeRef }

const cardColumns = `id, work_id AS workId, key, content, needs_verification AS needsVerification, aggregate, status, created_at AS createdAt,
  work_path AS workPath, card_branch AS cardBranch, repair_of_card_id AS repairOfCardId, write_scopes AS writeScopes, agent_id AS agentId, latest_dispatch_id AS latestDispatchId,
  current_step AS currentStep, latest_step_summary AS latestStepSummary,
  (SELECT end_reason FROM dispatches WHERE id = cards.latest_dispatch_id) AS lastEndReason,
  (SELECT conclusion FROM dispatches WHERE id = cards.latest_dispatch_id) AS lastConclusion,
  (SELECT json_object('inputTokens', SUM(json_extract(usage, '$.inputTokens')), 'outputTokens', SUM(json_extract(usage, '$.outputTokens')),
    'cacheReadTokens', SUM(json_extract(usage, '$.cacheReadTokens')), 'cacheWriteTokens', SUM(json_extract(usage, '$.cacheWriteTokens')),
    'incomplete', COUNT(*) > MIN(COUNT(json_extract(usage, '$.inputTokens')), COUNT(json_extract(usage, '$.outputTokens'))))
    FROM dispatches WHERE card_id = cards.id) AS usage`;

function readCard(row: Record<string, unknown>): Card {
  const { incomplete, cacheReadTokens, cacheWriteTokens, ...usage } = JSON.parse(String(row.usage));
  if (cacheReadTokens !== null) usage.cacheReadTokens = cacheReadTokens;
  if (cacheWriteTokens !== null) usage.cacheWriteTokens = cacheWriteTokens;
  return { ...row, needsVerification: Boolean(row.needsVerification), aggregate: Boolean(row.aggregate), writeScopes: JSON.parse(String(row.writeScopes)),
    usage: incomplete && (usage.inputTokens !== null || usage.outputTokens !== null) ? { ...usage, incomplete: true } : usage } as unknown as Card;
}

// Repo-relative path prefixes; advisory only, so malformed input is rejected rather than guessed at.
function normalizeWriteScopes(scopes: string[]) {
  const result = new Set<string>();
  for (const scope of scopes) {
    const path = scope.trim().replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    if (!path || path === '.' || path.startsWith('/') || path.split('/').some(part => part === '..' || part === ''))
      throw new RuleError('INVALID_WRITE_SCOPE', `写入范围须为仓库内的相对路径：${scope}`, 400);
    result.add(path);
  }
  return [...result].sort();
}

function scopesOverlap(left: string, right: string) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
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

export function createCard(store: TaskStore, actor: Actor, { writeScopes, ...params }: {
  workId: string; key: string; content: string; needsVerification?: boolean; aggregate?: boolean; repairOfCardId?: string; writeScopes?: string[];
}) {
  store.work(params.workId);
  const existing = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE work_id = ? AND key = ?`).get(params.workId, params.key);
  if (existing) return readCard(existing);
  requireExecuting(store, params.workId);
  if (params.repairOfCardId) requireMutable(cardDetails(store, params.workId, params.repairOfCardId));
  const card: Card = { id: randomUUID(), ...params, needsVerification: params.needsVerification ?? false, aggregate: params.aggregate ?? false,
    writeScopes: normalizeWriteScopes(writeScopes ?? []), status: 'ready', createdAt: new Date().toISOString(), usage: { inputTokens: null, outputTokens: null } };
  store.db.prepare('INSERT INTO cards (id, work_id, key, content, needs_verification, aggregate, status, created_at, repair_of_card_id, write_scopes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(card.id, card.workId, card.key, card.content, Number(card.needsVerification), Number(card.aggregate), card.status, card.createdAt, card.repairOfCardId ?? null,
      JSON.stringify(card.writeScopes));
  store.appendEvent(actor, { type: 'card', id: card.id }, 'card-created', card, { workId: card.workId, cardId: card.id });
  store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'card', id: card.id }, 'card-ready', { status: card.status }, { workId: card.workId, cardId: card.id });
  return card;
}

export function updateCard(store: TaskStore, actor: Actor, params: {
  workId: string; cardId: string; content?: string; needsVerification?: boolean; aggregate?: boolean; writeScopes?: string[];
}) {
  const card = cardDetails(store, params.workId, params.cardId);
  requireMutable(card);
  const content = params.content ?? card.content;
  const needsVerification = params.needsVerification ?? card.needsVerification;
  const aggregate = params.aggregate ?? card.aggregate;
  const writeScopes = params.writeScopes ? normalizeWriteScopes(params.writeScopes) : card.writeScopes;
  if (content === card.content && needsVerification === card.needsVerification && aggregate === card.aggregate && writeScopes.join('\n') === card.writeScopes.join('\n')) return card;
  store.db.prepare('UPDATE cards SET content = ?, needs_verification = ?, aggregate = ?, write_scopes = ? WHERE id = ?')
    .run(content, Number(needsVerification), Number(aggregate), JSON.stringify(writeScopes), card.id);
  const updated = cardDetails(store, card.workId, card.id);
  store.appendEvent(actor, { type: 'card', id: card.id }, 'card-updated', { before: card, after: updated }, { workId: card.workId, cardId: card.id });
  refreshCardReadiness(store, card.workId);
  return cardDetails(store, card.workId, card.id);
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
  const active = cards.filter(card => !['completed', 'cancelled', 'skipped'].includes(card.status) && card.writeScopes.length);
  const upstream = new Map(active.map(card => [card.id, new Set(ancestors(edges, { type: 'card', id: card.id }).map(node => `${node.type}:${node.id}`))]));
  // Overlap only matters between cards that no dependency orders; it warns and never blocks.
  const warnings = (card: Card) => active.flatMap(other => {
    if (other.id === card.id || upstream.get(card.id)?.has(`card:${other.id}`) || upstream.get(other.id)?.has(`card:${card.id}`)) return [];
    const overlap = card.writeScopes.flatMap(mine => other.writeScopes.filter(theirs => scopesOverlap(mine, theirs)).map(theirs => `${mine} ↔ ${theirs}`));
    return overlap.length ? [`与卡片 ${other.key}（${other.id}）没有依赖、写入范围重叠：${overlap.join('，')}`] : [];
  });
  return [
    ...cards.map(card => ({ type: 'card' as const, ...card, skippedBy: card.status === 'skipped' ? skippedCauses(store, workId, edges, { type: 'card', id: card.id }) : [], writeScopeWarnings: upstream.has(card.id) ? warnings(card) : [] })),
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

// An aggregate absorbs inactive branches. Other cards and gates still require
// their upstream chain, as before; inactive nodes end a branch.
function readinessUpstreams(store: TaskStore, workId: string, edges: Dependency[], node: NodeRef): NodeRef[] {
  const result = new Map<string, NodeRef>();
  const visit = (current: NodeRef) => {
    for (const { upstream, downstream } of edges) {
      if (!sameNode(downstream, current) || result.has(`${upstream.type}:${upstream.id}`)) continue;
      result.set(`${upstream.type}:${upstream.id}`, upstream);
      const node = graphNode(store, workId, upstream);
      if (!['cancelled', 'withdrawn', 'skipped'].includes(node.status) && !('aggregate' in node && node.aggregate)) visit(upstream);
    }
  };
  visit(node);
  return [...result.values()];
}

export interface SkippedUpstream extends NodeRef { status: 'cancelled' | 'withdrawn'; title: string }
function skippedCauses(store: TaskStore, workId: string, edges: Dependency[], node: NodeRef): SkippedUpstream[] {
  const causes = new Map<string, SkippedUpstream>();
  const visited = new Set<string>();
  const visit = (current: NodeRef) => {
    if (visited.has(`${current.type}:${current.id}`)) return;
    visited.add(`${current.type}:${current.id}`);
    for (const ref of readinessUpstreams(store, workId, edges, current)) {
      const upstream = graphNode(store, workId, ref);
      if (upstream.status === 'cancelled' || upstream.status === 'withdrawn') {
        const title = 'content' in upstream ? (upstream.content.split(/\r?\n/).find(line => line.trim()) ?? upstream.content).replace(/^\s*#+\s*/, '') : upstream.question;
        causes.set(`${ref.type}:${ref.id}`, { ...ref, status: upstream.status, title });
      } else if (upstream.status === 'skipped') visit(ref);
    }
  };
  visit(node);
  return [...causes.values()];
}

// Re-evaluate upstream first, irrespective of creation order. Active dispatches and
// user-set paused/terminal states stay intact; skipped is always recoverable.
export function refreshCardReadiness(store: TaskStore, workId: string) {
  const edges = dependencies(store, workId);
  const cards = store.db.prepare(`SELECT ${cardColumns} FROM cards WHERE work_id = ? AND status NOT IN ('paused', 'completed', 'cancelled')
    AND NOT EXISTS (SELECT 1 FROM dispatches WHERE card_id = cards.id AND status IN ('queued', 'running'))`).all(workId).map(readCard);
  const eligible = new Map(cards.map(card => [card.id, card]));
  const visited = new Set<string>();
  const refresh = (node: NodeRef) => {
    const key = `${node.type}:${node.id}`;
    if (visited.has(key)) return;
    visited.add(key);
    for (const edge of edges) if (sameNode(edge.downstream, node)) refresh(edge.upstream);
    const card = node.type === 'card' ? eligible.get(node.id) : undefined;
    if (!card) return;
    const upstream = readinessUpstreams(store, workId, edges, node).map(ref => ({ ref, node: graphNode(store, workId, ref) }));
    const inactive = upstream.filter(({ node }) => ['cancelled', 'withdrawn', 'skipped'].includes(node.status));
    const skipped = inactive.length > 0 && (!card.aggregate || inactive.length === upstream.length);
    const blocked = upstream.some(({ ref, node }) => !(card.aggregate && ['cancelled', 'withdrawn', 'skipped'].includes(node.status))
      && node.status !== (ref.type === 'card' ? 'completed' : 'decided'));
    const latest = card.latestDispatchId ? store.db.prepare('SELECT purpose FROM dispatches WHERE id = ?').get(card.latestDispatchId) : undefined;
    const status = skipped ? 'skipped' : blocked ? 'waiting' : latest ? latest.purpose === 'verification' ? 'verifying' : 'executing' : 'ready';
    if (status === card.status) return;
    store.db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(status, card.id);
    // The triggering event already wakes the coordinator; the same brief includes these transitions.
    store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'card', id: card.id },
      status === 'skipped' ? 'card-skipped' : status === 'waiting' ? 'card-waiting' : status === 'ready' ? 'card-ready' : 'card-unblocked',
      { previousStatus: card.status, status, ...(skipped ? { upstream: inactive.map(({ ref, node }) => ({ ...ref, status: node.status })), skippedBy: skippedCauses(store, workId, edges, node) } : {}) },
      { workId, cardId: card.id });
  };
  for (const card of cards) refresh({ type: 'card', id: card.id });
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
