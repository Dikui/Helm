import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { projectPath } from './alignment.js';
import { listDispatches } from './dispatch.js';
import { cardGraph } from './graph.js';
import { RuleError, TaskStore, type Actor } from './store.js';
import type { ReviewReport } from './review-report.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

export function reviewDetails<T extends object>(store: TaskStore, gate: T) {
  const fields = gate as { kind?: unknown; workId?: unknown };
  if (fields.kind !== 'review') return gate;
  const work = store.work(String(fields.workId));
  const project = projectPath(store, work.id);
  const cards = cardGraph(store, work.id).filter(node => node.type === 'card').filter(card => card.status !== 'cancelled');
  const dispatches = listDispatches(store, work.id);
  const verificationOnlyCards = cards.filter(card => card.needsVerification
    && !dispatches.some(dispatch => dispatch.cardId === card.id && dispatch.purpose === 'execution'));
  const requiredCards = cards.filter(card => !verificationOnlyCards.includes(card));
  const overallVerification = verificationOnlyCards.filter(card => requiredCards.every(other =>
    card.dependencies.some(node => node.type === 'card' && node.id === other.id)))
    .map(card => {
      const latest = dispatches.filter(dispatch => dispatch.cardId === card.id && dispatch.purpose === 'verification').at(-1);
      return { cardId: card.id, dispatchId: latest?.id ?? null, status: latest?.status ?? null,
        endReason: latest?.endReason ?? null, conclusion: latest?.status === 'ended' ? latest.conclusion : 'undeclared',
        reason: latest?.status === 'ended' ? latest.conclusionReason : null };
    });
  const workCommit = git(project, 'rev-parse', `refs/heads/${work.workBranch}`).trim();
  return { ...gate, review: {
    baseRef: work.baseRef, baseCommit: work.baseCommit, workBranch: work.workBranch, workCommit,
    diff: git(project, 'diff', '--no-color', '--no-ext-diff', '--no-textconv', work.baseCommit!, workCommit, '--'),
    overallVerification,
    rejectedOperationCount: store.events({ workId: work.id }).filter(event => event.action === 'operation-rejected').length,
    undeclaredDispatchCount: dispatches.filter(dispatch => dispatch.status === 'ended' && dispatch.conclusion === 'undeclared').length,
  } };
}

export function requestReview(store: TaskStore, actor: Actor, params: { workId: string; key: string; report: ReviewReport }) {
  const gates = store.gates(params.workId);
  const existing = gates.find(gate => gate.key === params.key);
  if (existing) {
    if (existing.kind !== 'review') throw new RuleError('KEY_CONFLICT', '此 key 已用于其他种类的关卡。');
    return existing;
  }
  if (gates.some(gate => gate.kind === 'review' && gate.status === 'pending')) throw new RuleError('REVIEW_PENDING', '工作已有未关闭的审核关卡。');
  if (store.work(params.workId).status !== 'executing') throw new RuleError('WORK_NOT_EXECUTING', '只能为执行中的工作发起审核。');
  const nonTerminalCards = cardGraph(store, params.workId)
    .filter(node => node.type === 'card').filter(card => card.status !== 'completed' && card.status !== 'cancelled')
    .map(card => ({ id: card.id, content: card.content, status: card.status }));
  if (nonTerminalCards.length) throw new RuleError('NON_TERMINAL_CARDS', '所有卡片必须完成或取消后才能发起审核。', 409, { nonTerminalCards });
  const id = randomUUID();
  const options = ['accept', 'return'];
  const event = store.appendEvent(actor, { type: 'gate', id }, 'gate-created', { kind: 'review', question: '审核', body: params.report.summary, report: params.report, options }, { workId: params.workId });
  store.db.prepare(`INSERT INTO gates
    (id, work_id, kind, status, key, question, body, options, creator_type, creator_id, created_at, sequence, report)
    VALUES (?, ?, 'review', 'pending', ?, '审核', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, params.workId, params.key, params.report.summary, JSON.stringify(options), actor.type, actor.id, event.time, event.id, JSON.stringify(params.report));
  store.db.prepare(`UPDATE works SET status = 'awaiting-review' WHERE id = ?`).run(params.workId);
  store.appendEvent(runtime, { type: 'gate', id }, 'needs-user-attention', { kind: 'review' }, { workId: params.workId });
  return store.gate(params.workId, id);
}

export function decideReview(store: TaskStore, actor: Actor, params: { workId: string; gateId: string; decision: string; comment?: string }) {
  const gate = store.gate(params.workId, params.gateId);
  if (!['accept', 'return'].includes(params.decision)) throw new RuleError('INVALID_PARAMS', '审核只能选择 accept（接受）或 return（退回）。', 400);
  if (gate.status === 'decided') {
    if (gate.decision !== params.decision || gate.comment !== (params.comment ?? null)) throw new RuleError('GATE_DECIDED', '审核已经决定，不能改写用户的决定或意见。');
    return gate;
  }
  return store.transaction(() => {
    store.db.prepare(`UPDATE gates SET status = 'decided', decision = ?, comment = ? WHERE id = ?`).run(params.decision, params.comment ?? null, gate.id);
    const event = store.appendEvent(actor, { type: 'gate', id: gate.id }, 'gate-decided', { decision: params.decision, comment: params.comment ?? null }, { workId: gate.workId });
    if (params.decision === 'accept') {
      store.db.prepare("UPDATE works SET status = 'accepted', paused_from_status = NULL, runtime_pause_reason = NULL WHERE id = ?").run(gate.workId);
    }
    if (params.decision === 'return') {
      store.db.prepare(`UPDATE works SET status = CASE WHEN status = 'paused' THEN status ELSE 'executing' END,
        paused_from_status = CASE WHEN status = 'paused' THEN 'executing' ELSE paused_from_status END WHERE id = ?`).run(gate.workId);
      store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, gate.workId);
    }
    return store.gate(gate.workId, gate.id);
  });
}

export function withdrawAcceptance(store: TaskStore, actor: Actor, workId: string) {
  const work = store.work(workId);
  if (work.status !== 'accepted') throw new RuleError('ACCEPTANCE_LOCKED', '只能在合入前撤回接受。');
  const gate = store.gates(workId).findLast(item => item.kind === 'review' && item.decision === 'accept');
  if (!gate) throw new RuleError('REVIEW_NOT_ACCEPTED', '工作尚未接受审核。');
  store.db.prepare("UPDATE gates SET status = 'pending', decision = NULL, comment = NULL WHERE id = ?").run(gate.id);
  store.db.prepare("UPDATE works SET status = 'awaiting-review' WHERE id = ?").run(workId);
  store.appendEvent(actor, { type: 'gate', id: gate.id }, 'acceptance-withdrawn', {}, { workId });
  return store.gate(workId, gate.id);
}

function git(project: string, ...args: string[]) {
  return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}
