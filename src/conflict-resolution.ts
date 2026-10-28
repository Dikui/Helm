import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { deliveryDetails } from './delivery.js';
import { cardGraph } from './graph.js';
import { listDispatches, type Dispatch } from './dispatch.js';
import { RuleError, TaskStore, type Actor } from './store.js';

export interface ConflictResolution {
  status: 'solving' | 'manual' | 'resolved';
  fromCommit: string;
  baseBranch: string;
  baseCommit: string;
  toCommit?: string;
  cards?: { cardId: string; verificationId: string }[];
}

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 }).trimEnd();
}

export function resolvingConflict(store: TaskStore, workId: string) {
  return deliveryDetails(store, workId).resolution?.status === 'solving';
}

// Executors can edit their copy, but cannot write Git metadata outside the sandbox.
export function prepareConflictCardMerge(store: TaskStore, dispatch: Dispatch, path: string) {
  const resolution = deliveryDetails(store, dispatch.workId).resolution;
  if (dispatch.purpose !== 'execution' || resolution?.status !== 'solving') return undefined;
  try {
    git(path, 'merge-base', '--is-ancestor', resolution.baseCommit, 'HEAD');
    return { baseCommit: resolution.baseCommit, conflictFiles: [] as string[], instruction: '基准提交已包含在卡片分支中；只修改文件，不运行 git merge/add/commit。' };
  } catch (error) { if ((error as { status?: number }).status !== 1) throw error; }
  store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id },
    'conflict-card-merge-started', { baseCommit: resolution.baseCommit }, { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id }));
  try {
    git(path, '-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'merge.autoStash=false',
      'merge', '--no-ff', '--no-commit', resolution.baseCommit);
  } catch (error) {
    if ((error as { status?: number }).status !== 1 || !pendingConflictCardMerge(store, dispatch, path)) throw error;
  }
  return { baseCommit: resolution.baseCommit, conflictFiles: git(path, 'diff', '--name-only', '--diff-filter=U', '-z').split('\0').filter(Boolean),
    instruction: '运行层已在卡片副本预备基准合并。只编辑文件解决冲突，不运行 git merge/add/commit；正常结束后运行层暂存并保存合并提交。' };
}

export function pendingConflictCardMerge(store: TaskStore, dispatch: Dispatch, path: string) {
  const intent = store.events({ workId: dispatch.workId }).findLast(event => event.action === 'conflict-card-merge-started' && event.dispatchId === dispatch.id);
  if (!intent) return false;
  const mergeHead = resolve(path, git(path, 'rev-parse', '--git-path', 'MERGE_HEAD'));
  return existsSync(mergeHead) && readFileSync(mergeHead, 'utf8').trim() === (intent.details as { baseCommit: string }).baseCommit;
}

export function resolveMergeConflict(store: TaskStore, actor: Actor, workId: string, mode: 'coordinator' | 'manual') {
  const work = store.work(workId);
  const { merge, resolution } = deliveryDetails(store, workId);
  if (resolution?.status === 'solving') return work;
  if (work.status !== 'accepted' || merge?.status !== 'conflict' || !merge.baseBranch) {
    throw new RuleError('NO_MERGE_CONFLICT', '只能处理待合入工作的合入冲突。');
  }
  const project = projectPath(store, workId);
  const details: ConflictResolution = { status: mode === 'coordinator' ? 'solving' : 'manual', baseBranch: merge.baseBranch,
    baseCommit: git(project, 'rev-parse', `${merge.baseBranch}^{commit}`),
    fromCommit: git(project, 'rev-parse', `refs/heads/${work.workBranch}^{commit}`) };
  const event = store.appendEvent(actor, { type: 'work', id: workId }, 'conflict-resolution-requested', details, { workId });
  if (mode === 'coordinator') {
    store.db.prepare("UPDATE works SET status = 'executing' WHERE id = ?").run(workId);
    store.appendEvent(actor, { type: 'work', id: workId }, 'delivery-status-changed', { status: 'executing' }, { workId });
    store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
  }
  return store.work(workId);
}

export function finishConflictResolution(store: TaskStore, actor: Actor, workId: string) {
  const work = store.work(workId);
  const resolution = deliveryDetails(store, workId).resolution;
  if (resolution?.status === 'resolved' && work.status === 'accepted') return work;
  if (resolution?.status !== 'solving' || work.status !== 'executing') throw new RuleError('NO_CONFLICT_RESOLUTION', '工作没有正在进行的冲突处理。');
  const request = store.events({ workId }).findLast(event => event.action === 'conflict-resolution-requested')!;
  const newCardIds = new Set(store.events({ workId, after: request.id }).filter(event => event.action === 'card-created').map(event => event.object.id));
  const cards = cardGraph(store, workId).filter(node => node.type === 'card');
  const completed = cards.filter(card => newCardIds.has(card.id) && card.status === 'completed');
  const dispatches = listDispatches(store, workId);
  if (!completed.length || cards.some(card => !['completed', 'cancelled'].includes(card.status))
    || dispatches.some(dispatch => dispatch.status !== 'ended') || completed.some(card => !card.needsVerification)) {
    throw new RuleError('RESOLUTION_UNVERIFIED', '冲突处理卡片必须通过验收并完成，其他卡片和派单也须结束。');
  }
  const project = projectPath(store, workId);
  const toCommit = git(project, 'rev-parse', `refs/heads/${work.workBranch}^{commit}`);
  // The fixed base from the request must be present. A newer base is checked by the next merge.
  try { git(project, 'merge-base', '--is-ancestor', resolution.baseCommit, toCommit); }
  catch { throw new RuleError('BASE_NOT_IN_WORK', '冲突处理尚未把基准提交合进工作分支。'); }
  const evidence = completed.map(card => {
    const verification = dispatches.filter(dispatch => dispatch.cardId === card.id && dispatch.purpose === 'verification').at(-1);
    if (verification?.endReason !== 'completed' || verification.conclusion !== 'passed') throw new RuleError('RESOLUTION_UNVERIFIED', '冲突处理卡片须验收通过。');
    return { cardId: card.id, verificationId: verification.id };
  });
  store.appendEvent(actor, { type: 'work', id: workId }, 'conflict-resolution-finished',
    { ...resolution, status: 'resolved', toCommit, cards: evidence }, { workId });
  store.db.prepare("UPDATE works SET status = 'accepted' WHERE id = ?").run(workId);
  store.appendEvent(actor, { type: 'work', id: workId }, 'delivery-status-changed', { status: 'accepted' }, { workId });
  return store.work(workId);
}

export function conflictResolutionChanges(store: TaskStore, workId: string) {
  const resolution = deliveryDetails(store, workId).resolution;
  if (resolution?.status !== 'resolved' || !resolution.toCommit) throw new RuleError('RESOLUTION_NOT_FINISHED', '冲突处理尚未完成。');
  return { ...resolution, diff: git(projectPath(store, workId), 'diff', '--no-color', '--no-ext-diff', '--no-textconv', resolution.fromCommit, resolution.toCommit, '--') };
}
