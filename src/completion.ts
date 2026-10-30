import { existsSync } from 'node:fs';
import { projectPath } from './alignment.js';
import { branchExists, branchIsContained, deleteBranch } from './branch-cleanup.js';
import { dispatchGit, listDispatches, revokeDispatch, verificationCommit } from './dispatch.js';
import { cancelCard as recordCancellation, cardDetails, refreshCardReadiness, type Card } from './graph.js';
import { RuleError, TaskStore, type Actor } from './store.js';

export function removeCardCopy(store: TaskStore, card: Card) {
  if (!card.workPath && !card.cardBranch) return;
  const project = projectPath(store, card.workId);
  const copies = dispatchGit(project, 'worktree', 'list', '--porcelain').split('\n');
  if (card.workPath && existsSync(card.workPath) && copies.includes(`worktree ${card.workPath}`)) {
    dispatchGit(project, 'worktree', 'remove', '--force', card.workPath);
  }
  if (card.cardBranch && branchExists(project, card.cardBranch)) {
    const work = store.work(card.workId);
    // Whole-work cancellation keeps commits that never reached the work branch.
    // Cancelling one card during execution still discards its branch.
    if (work.status === 'cancelled' && (!work.workBranch || !branchIsContained(project, card.cardBranch, work.workBranch))) return;
    deleteBranch(project, card.cardBranch);
  }
}

export function cancelCard(store: TaskStore, actor: Actor, params: { workId: string; cardId: string; reason: string }) {
  const card = cardDetails(store, params.workId, params.cardId);
  if (card.status === 'completed') throw new RuleError('TERMINAL_CARD', '完成或已取消的卡片不能再修改。');
  const active = listDispatches(store, card.workId, card.id).filter(item => item.status !== 'ended');
  // Active dispatches save their final output and remove the copy before publishing dispatch-ended.
  if (!active.length) removeCardCopy(store, card);
  return store.transaction(() => {
    for (const dispatch of active) revokeDispatch(store, actor, { workId: card.workId, dispatchId: dispatch.id, reason: '卡片取消' });
    return recordCancellation(store, actor, params);
  });
}

export function completeCard(store: TaskStore, actor: Actor, params: { workId: string; cardId: string }) {
  const card = cardDetails(store, params.workId, params.cardId);
  if (card.status === 'completed') return card;
  if (card.status === 'cancelled') throw new RuleError('TERMINAL_CARD', '完成或已取消的卡片不能再修改。');
  const work = store.work(card.workId);
  const runtimePaused = work.status === 'paused' && work.runtimePauseReason
    && store.db.prepare('SELECT paused_from_status FROM works WHERE id = ?').get(work.id)!.paused_from_status === 'executing';
  if (work.status !== 'executing' && !runtimePaused) throw new RuleError('WORK_NOT_EXECUTING', '只能在执行中或由运行层暂停的工作里标记卡片完成。');
  const dispatches = listDispatches(store, work.id, card.id);
  if (dispatches.some(item => item.status !== 'ended')) throw new RuleError('DISPATCH_ACTIVE', '派单结束后才能标记卡片完成。');
  if (['waiting', 'skipped', 'paused'].includes(card.status)) throw new RuleError('CARD_NOT_COMPLETABLE', '等待前置、已跳过或暂停的卡片不能标记完成。');
  if (!dispatches.some(item => item.endReason === 'completed')) throw new RuleError('NO_COMPLETED_DISPATCH', '从没正常完成过派单的卡片不能标完成，只能取消。');
  const passed = dispatches.filter(item => item.purpose === 'verification' && item.endReason === 'completed' && item.conclusion === 'passed');
  if (card.needsVerification && !passed.length) {
    throw new RuleError('VERIFICATION_REQUIRED', '需要验收的卡片须至少有一票正常结束且通过的验收才能标完成；计票由调度者负责。');
  }
  const executed = dispatches.some(item => item.purpose === 'execution');
  if ((work.workBranch && !work.workPath) || (executed && (!work.workBranch || !card.cardBranch))) throw new RuleError('GIT_ERROR', '找不到卡片分支或工作分支。');
  const workPath = work.workPath ?? projectPath(store, work.id);
  if (work.workBranch && (dispatchGit(workPath, 'symbolic-ref', '--short', 'HEAD') !== work.workBranch || dispatchGit(workPath, 'status', '--porcelain'))) {
    throw new RuleError('WORK_COPY_DIRTY', '工作分支的 _work 必须干净且检出工作分支。');
  }
  // A retry after cleanup can still merge the saved commit; the branch may already be gone.
  const branchExists = executed && dispatchGit(workPath, 'for-each-ref', '--format=%(refname)', `refs/heads/${card.cardBranch}`);
  const target = executed ? (branchExists ? card.cardBranch : dispatches.at(-1)?.endCommit) : work.workBranch ?? work.baseRef;
  if (!target) throw new RuleError('GIT_ERROR', '找不到卡片的提交。');
  // Keep the checked commit readable after completion removes the card branch.
  const checkedCommit = card.needsVerification ? (!executed || branchExists ? verificationCommit(store, card) : target) : null;
  if (card.needsVerification && !passed.some(item => item.startCommit === checkedCommit)) {
    throw new RuleError('VERIFICATION_OUTDATED', '当前提交没有有效的通过验收票，须重新验收。');
  }
  // Verification-only cards checked the work branch or base; there is nothing to merge.
  if (executed) {
    try {
      dispatchGit(workPath, '-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false',
        'merge', '--no-ff', '--no-edit', target);
    } catch (error) {
      const conflicts = dispatchGit(workPath, 'diff', '--name-only', '--diff-filter=U');
      if (existsSync(dispatchGit(workPath, 'rev-parse', '--git-path', 'MERGE_HEAD'))) dispatchGit(workPath, 'merge', '--abort');
      if (conflicts) throw new RuleError('WORK_BRANCH_CONFLICT', '与工作分支冲突');
      throw error;
    }
  }
  const mergeCommit = dispatchGit(workPath, 'rev-parse', `refs/heads/${work.workBranch ?? work.baseRef}`);
  removeCardCopy(store, card);
  return store.transaction(() => {
    store.db.prepare(`UPDATE cards SET status = 'completed' WHERE id = ?`).run(card.id);
    store.db.prepare(`UPDATE artifacts SET ref = ?, commit_sha = ? WHERE kind = 'branch'
      AND dispatch_id IN (SELECT id FROM dispatches WHERE card_id = ?)`).run(work.workBranch ?? work.baseRef, mergeCommit, card.id);
    store.appendEvent(actor, { type: 'card', id: card.id }, 'card-completed', { workBranch: work.workBranch, mergeCommit, checkedCommit }, { workId: work.id, cardId: card.id });
    refreshCardReadiness(store, work.id);
    return cardDetails(store, work.id, card.id);
  });
}
