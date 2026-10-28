import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { RuleError, TaskStore, type Actor } from './store.js';
import type { ConflictResolution } from './conflict-resolution.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;
const exec = promisify(execFile);
async function git(project: string, ...args: string[]) {
  return (await exec('git', ['-C', project, ...args], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })).stdout;
}
function failureReason(error: unknown) {
  const failure = error as { stderr?: string; message?: string };
  return String(failure.stderr || failure.message || error).trim();
}

export interface MergeResult {
  status: 'merged' | 'already-contained' | 'conflict' | 'failed';
  baseBranch: string | null; workBranch: string; commit?: string; conflictFiles?: string[]; reason?: string;
}

async function mergeIntoBase(store: TaskStore, workId: string): Promise<MergeResult> {
  const work = store.work(workId);
  const project = projectPath(store, workId);
  const result: MergeResult = { status: 'failed', baseBranch: null, workBranch: work.workBranch! };
  try {
    const baseBranch = (await git(project, 'rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', work.baseRef!)).trim();
    if (!baseBranch.startsWith('refs/heads/')) throw new Error(`基准 ref ${work.baseRef} 不是本地分支，无法合并推送。`);
    result.baseBranch = baseBranch;
    const baseCommit = (await git(project, 'rev-parse', '--verify', `${baseBranch}^{commit}`)).trim();
    const workCommit = (await git(project, 'rev-parse', '--verify', `refs/heads/${work.workBranch}^{commit}`)).trim();
    let tree: string;
    try {
      tree = (await git(project, 'merge-tree', '--write-tree', '--name-only', '-z', baseCommit, workCommit)).split('\0')[0]!;
    } catch (error) {
      const failure = error as { code?: number; stdout?: string };
      if (failure.code !== 1) throw error;
      const paths = String(failure.stdout).split('\0').slice(1);
      const end = paths.indexOf('');
      return { ...result, status: 'conflict', conflictFiles: end < 0 ? paths : paths.slice(0, end) };
    }
    try {
      await git(project, 'merge-base', '--is-ancestor', workCommit, baseCommit);
      return { ...result, status: 'already-contained', commit: baseCommit };
    } catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
    let checkedOut = '';
    try { checkedOut = (await git(project, 'symbolic-ref', '-q', 'HEAD')).trim(); }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
    const identity = ['-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false'];
    let commit: string;
    if (checkedOut === baseBranch) {
      const mergeHead = resolve(project, (await git(project, 'rev-parse', '--git-path', 'MERGE_HEAD')).trim());
      const alreadyMerging = existsSync(mergeHead);
      if (alreadyMerging) throw new Error('项目目录已有未结束的合并。');
      // This durable intent distinguishes our interrupted merge from a user's merge.
      store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-started',
        { baseBranch, baseCommit, workCommit, mergeTree: tree }, { workId }));
      try {
        await git(project, ...identity, '-c', 'merge.autoStash=false', 'merge', '--no-ff', '--commit', '--no-edit', workCommit);
      } catch (error) {
        // Only abort a merge started here; an existing user merge belongs to the user.
        if (!alreadyMerging && existsSync(mergeHead) && readFileSync(mergeHead, 'utf8').trim() === workCommit) await git(project, 'merge', '--abort');
        throw error;
      }
      commit = (await git(project, 'rev-parse', baseBranch)).trim();
    } else {
      commit = (await git(project, ...identity, 'commit-tree', tree, '-p', baseCommit, '-p', workCommit, '-m', `Merge ${work.workBranch}`)).trim();
      await git(project, 'update-ref', baseBranch, commit, baseCommit);
    }
    return { ...result, status: 'merged', commit };
  } catch (error) { return { ...result, reason: failureReason(error) }; }
}

export interface PushResult { status: 'pushed' | 'failed'; reason?: string; baseBranch: string }
export function deliveryDetails(store: TaskStore, workId: string) {
  const events = store.events({ workId });
  const withdrawn = events.findLast(event => event.action === 'acceptance-withdrawn')?.id ?? 0;
  const current = events.filter(event => event.id > withdrawn);
  const mergeEvent = current.findLast(event => event.action === 'base-merge-result');
  const resolutionEvent = current.findLast(event => ['conflict-resolution-requested', 'conflict-resolution-finished'].includes(event.action));
  const merge = mergeEvent?.details as MergeResult | undefined;
  // A new conflict requires a new choice and verification, even after a previous resolution succeeded.
  const resolution = merge?.status === 'conflict' && mergeEvent!.id > (resolutionEvent?.id ?? 0)
    ? undefined : resolutionEvent?.details as ConflictResolution | undefined;
  return {
    merge,
    push: current.findLast(event => event.action === 'base-push-result')?.details as PushResult | undefined,
    cleanup: current.findLast(event => event.action === 'work-copy-cleanup')?.details as { reason?: string } | undefined,
    resolution,
  };
}

function acceptedGate(store: TaskStore, workId: string) {
  const gate = store.gates(workId).findLast(item => item.kind === 'review' && item.decision === 'accept');
  if (!gate) throw new RuleError('REVIEW_NOT_ACCEPTED', '须先接受审核。');
  return gate;
}

export function setDeliveryStatus(store: TaskStore, actor: Actor, workId: string, status: string) {
  store.transaction(() => {
    store.db.prepare('UPDATE works SET status = ? WHERE id = ?').run(status, workId);
    store.appendEvent(actor, { type: 'work', id: workId }, 'delivery-status-changed', { status }, { workId });
  });
}

export async function cleanupReviewedCopy(store: TaskStore, workId: string) {
  const work = store.work(workId);
  let reason: string | undefined;
  try {
    if (work.workPath && existsSync(work.workPath)) await git(projectPath(store, workId), 'worktree', 'remove', '--force', work.workPath);
  } catch (error) { reason = failureReason(error); }
  store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'work-copy-cleanup', { reason }, { workId }));
}

export async function mergeReviewedWork(store: TaskStore, workId: string) {
  const gate = acceptedGate(store, workId);
  const saved = deliveryDetails(store, workId).merge;
  if (saved?.status === 'merged' || saved?.status === 'already-contained') {
    await cleanupReviewedCopy(store, workId);
    return store.work(workId);
  }
  setDeliveryStatus(store, runtime, workId, 'merging');
  const merge = await mergeIntoBase(store, workId);
  // Persist the result and next phase together before removing the work copy.
  store.transaction(() => {
    store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-result', { gateId: gate.id, ...merge }, { workId });
    store.db.prepare('UPDATE works SET status = ? WHERE id = ?')
      .run(merge.status === 'merged' || merge.status === 'already-contained' ? 'merged' : 'accepted', workId);
  });
  if (store.work(workId).status === 'merged') await cleanupReviewedCopy(store, workId);
  return store.work(workId);
}

// Detection never creates a merge: a user may still be resolving it in their project directory.
export async function recheckReviewedWork(store: TaskStore, workId: string) {
  const gate = acceptedGate(store, workId);
  const work = store.work(workId);
  const { merge, resolution } = deliveryDetails(store, workId);
  if (work.status === 'merged') return work;
  if (work.status !== 'accepted' || merge?.status !== 'conflict' || resolution?.status !== 'manual' || !merge.baseBranch) {
    throw new RuleError('NO_MANUAL_RESOLUTION', '请先选择自己处理合入冲突。');
  }
  const project = projectPath(store, workId);
  const run = (...args: string[]) => execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
  const baseCommit = run('rev-parse', '--verify', `${merge.baseBranch}^{commit}`);
  const workCommit = run('rev-parse', '--verify', `refs/heads/${work.workBranch}^{commit}`);
  try { run('merge-base', '--is-ancestor', workCommit, baseCommit); }
  catch (error) {
    if ((error as { status?: number }).status === 1) return work;
    throw error;
  }
  store.transaction(() => {
    store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-result',
      { gateId: gate.id, status: 'already-contained', baseBranch: merge.baseBranch, workBranch: work.workBranch, commit: baseCommit }, { workId });
    store.db.prepare("UPDATE works SET status = 'merged' WHERE id = ?").run(workId);
  });
  await cleanupReviewedCopy(store, workId);
  return store.work(workId);
}

export async function pushReviewedWork(store: TaskStore, workId: string) {
  const gate = acceptedGate(store, workId);
  const { merge, push: saved } = deliveryDetails(store, workId);
  if (!merge?.baseBranch || !['merged', 'already-contained'].includes(merge.status)) throw new RuleError('WORK_NOT_MERGED', '合入完成后才能推送。');
  let push = saved;
  if (push?.status !== 'pushed') {
    setDeliveryStatus(store, runtime, workId, 'pushing');
    const project = projectPath(store, workId);
    try {
      let remote = 'origin';
      try { remote = (await git(project, 'config', '--get', `branch.${merge.baseBranch.slice('refs/heads/'.length)}.remote`)).trim() || remote; }
      catch (error) { if ((error as { code?: number }).code !== 1) throw error; }
      await git(project, 'push', '--', remote, `${merge.baseBranch}:${merge.baseBranch}`);
      push = { status: 'pushed', baseBranch: merge.baseBranch };
    } catch (error) { push = { status: 'failed', baseBranch: merge.baseBranch, reason: failureReason(error) }; }
    store.transaction(() => {
      store.appendEvent(runtime, { type: 'work', id: workId }, 'base-push-result', { gateId: gate.id, ...push }, { workId });
      store.db.prepare("UPDATE works SET status = 'merged' WHERE id = ?").run(workId);
    });
  }
  if (push.status === 'pushed') store.transaction(() => {
    store.db.prepare("UPDATE works SET status = 'completed', paused_from_status = NULL, runtime_pause_reason = NULL WHERE id = ?").run(workId);
    if (!store.events({ workId }).some(event => event.action === 'work-completed')) {
      store.appendEvent(runtime, { type: 'work', id: workId }, 'work-completed', { gateId: gate.id, merge, push }, { workId });
    }
  });
  return store.work(workId);
}
