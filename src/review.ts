import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { listDispatches } from './dispatch.js';
import { cardGraph } from './graph.js';
import { RuleError, TaskStore, type Actor } from './store.js';

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

export function requestReview(store: TaskStore, actor: Actor, params: { workId: string; key: string; body: string }) {
  const gates = store.gates(params.workId);
  const existing = gates.find(gate => gate.key === params.key);
  if (existing) {
    if (existing.kind !== 'review') throw new RuleError('KEY_CONFLICT', '此 key 已用于其他种类的关卡。');
    return existing;
  }
  if (gates.some(gate => gate.kind === 'review' && gate.status === 'pending')) throw new RuleError('REVIEW_PENDING', '工作已有未关闭的审核关卡。');
  if (store.work(params.workId).status !== 'executing') throw new RuleError('WORK_NOT_EXECUTING', '只能为执行中的工作发起审核。');
  const id = randomUUID();
  const options = ['accept', 'return'];
  const event = store.appendEvent(actor, { type: 'gate', id }, 'gate-created', { kind: 'review', question: '审核', body: params.body, options }, { workId: params.workId });
  store.db.prepare(`INSERT INTO gates
    (id, work_id, kind, status, key, question, body, options, creator_type, creator_id, created_at, sequence)
    VALUES (?, ?, 'review', 'pending', ?, '审核', ?, ?, ?, ?, ?, ?)`)
    .run(id, params.workId, params.key, params.body, JSON.stringify(options), actor.type, actor.id, event.time, event.id);
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
    if (params.decision === 'return') {
      store.db.prepare(`UPDATE works SET status = CASE WHEN status = 'paused' THEN status ELSE 'executing' END,
        paused_from_status = CASE WHEN status = 'paused' THEN 'executing' ELSE paused_from_status END WHERE id = ?`).run(gate.workId);
      store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, gate.workId);
    }
    return store.gate(gate.workId, gate.id);
  });
}

function git(project: string, ...args: string[]) {
  return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 });
}

function failureReason(error: unknown) {
  const failure = error as { stderr?: string; message?: string };
  return String(failure.stderr || failure.message || error).trim();
}

interface MergeResult {
  status: 'merged' | 'already-contained' | 'conflict' | 'failed';
  baseBranch: string | null; workBranch: string; commit?: string; conflictFiles?: string[]; reason?: string;
}

function mergeIntoBase(store: TaskStore, workId: string): MergeResult {
  const work = store.work(workId);
  const project = projectPath(store, workId);
  const result: MergeResult = { status: 'failed', baseBranch: null, workBranch: work.workBranch! };
  try {
    const baseBranch = git(project, 'rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', work.baseRef!).trim();
    if (!baseBranch.startsWith('refs/heads/')) throw new Error(`基准 ref ${work.baseRef} 不是本地分支，无法合并推送。`);
    result.baseBranch = baseBranch;
    const baseCommit = git(project, 'rev-parse', '--verify', `${baseBranch}^{commit}`).trim();
    const workCommit = git(project, 'rev-parse', '--verify', `refs/heads/${work.workBranch}^{commit}`).trim();
    let tree: string;
    try {
      tree = git(project, 'merge-tree', '--write-tree', '--name-only', '-z', baseCommit, workCommit).split('\0')[0]!;
    } catch (error) {
      const failure = error as { status?: number; stdout?: string };
      if (failure.status !== 1) throw error;
      const paths = String(failure.stdout).split('\0').slice(1);
      const end = paths.indexOf('');
      return { ...result, status: 'conflict', conflictFiles: end < 0 ? paths : paths.slice(0, end) };
    }
    try {
      git(project, 'merge-base', '--is-ancestor', workCommit, baseCommit);
      return { ...result, status: 'already-contained', commit: baseCommit };
    } catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
    let checkedOut = '';
    try { checkedOut = git(project, 'symbolic-ref', '-q', 'HEAD').trim(); }
    catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
    const identity = ['-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false'];
    let commit: string;
    if (checkedOut === baseBranch) {
      const mergeHead = resolve(project, git(project, 'rev-parse', '--git-path', 'MERGE_HEAD').trim());
      const alreadyMerging = existsSync(mergeHead);
      if (alreadyMerging) throw new Error('项目目录已有未结束的合并。');
      // This durable intent distinguishes our interrupted merge from a user's merge.
      store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-started',
        { baseBranch, baseCommit, workCommit, mergeTree: tree }, { workId }));
      try {
        git(project, ...identity, '-c', 'merge.autoStash=false', 'merge', '--no-ff', '--commit', '--no-edit', workCommit);
      } catch (error) {
        // Only abort a merge started here; an existing user merge belongs to the user.
        if (!alreadyMerging && existsSync(mergeHead) && readFileSync(mergeHead, 'utf8').trim() === workCommit) git(project, 'merge', '--abort');
        throw error;
      }
      commit = git(project, 'rev-parse', baseBranch).trim();
    } else {
      commit = git(project, ...identity, 'commit-tree', tree, '-p', baseCommit, '-p', workCommit, '-m', `Merge ${work.workBranch}`).trim();
      git(project, 'update-ref', baseBranch, commit, baseCommit);
    }
    return { ...result, status: 'merged', commit };
  } catch (error) { return { ...result, reason: failureReason(error) }; }
}

// The accepted gate is durable before external actions. Startup reconciliation can use the result events.
export function completeReviewedWork(store: TaskStore, workId: string, gateId: string) {
  const work = store.work(workId);
  const project = projectPath(store, workId);
  const events = store.events({ workId });
  const savedResult = (action: string) => events.find(event => event.action === action && (event.details as { gateId?: string }).gateId === gateId);
  const savedMerge = savedResult('base-merge-result');
  const merge = savedMerge ? savedMerge.details as MergeResult : mergeIntoBase(store, workId);
  if (!savedMerge) store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-result', { gateId, ...merge }, { workId }));
  const savedPush = savedResult('base-push-result');
  let push: { status: 'pushed' | 'failed' | 'skipped'; reason?: string } = savedPush ? savedPush.details as typeof push : { status: 'skipped' };
  if (!savedPush && (merge.status === 'merged' || merge.status === 'already-contained')) {
    try {
      let remote = 'origin';
      try { remote = git(project, 'config', '--get', `branch.${merge.baseBranch!.slice('refs/heads/'.length)}.remote`).trim() || remote; }
      catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
      git(project, 'push', '--', remote, `${merge.baseBranch}:${merge.baseBranch}`);
      push = { status: 'pushed' };
    } catch (error) { push = { status: 'failed', reason: failureReason(error) }; }
  }
  if (!savedPush) store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'base-push-result', { gateId, baseBranch: merge.baseBranch, ...push }, { workId }));
  let cleanupFailure: string | undefined;
  try {
    if (work.workPath && existsSync(work.workPath)) git(project, 'worktree', 'remove', '--force', work.workPath);
  } catch (error) { cleanupFailure = failureReason(error); }
  return store.transaction(() => {
    const notices: string[] = [];
    if (merge.status === 'conflict') notices.push(`工作分支 ${work.workBranch} 与基准分支冲突，未合并。冲突文件：${merge.conflictFiles!.join('、')}。`);
    if (merge.status === 'failed') notices.push(`工作分支 ${work.workBranch} 合进基准分支失败：${merge.reason}`);
    if (push.status === 'failed') notices.push(`基准分支 ${merge.baseBranch} 推送失败：${push.reason}`);
    if (cleanupFailure) notices.push(`删除 _work 失败：${cleanupFailure}`);
    if (notices.length && !store.message(workId, `review-result:${gateId}`)) {
      const id = randomUUID();
      const body = notices.join('\n');
      const event = store.appendEvent(runtime, { type: 'message', id }, 'message-sent', { body, gateId }, { workId });
      store.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, workId, 'runtime', body, `review-result:${gateId}`, gateId, event.time, event.id);
    }
    store.db.prepare(`UPDATE works SET status = 'completed', paused_from_status = NULL, runtime_pause_reason = NULL WHERE id = ?`).run(workId);
    if (!savedResult('work-completed')) store.appendEvent(runtime, { type: 'work', id: workId }, 'work-completed', { gateId, merge, push, cleanupFailure }, { workId });
    return store.work(workId);
  });
}
