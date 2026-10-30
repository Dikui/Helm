import { execFile, execFileSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { branchExists, branchIsContained, deleteBranch } from './branch-cleanup.js';
import { RuleError, TaskStore, type Actor } from './store.js';
import { compressWorkOutputs } from './outputs.js';
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
  baseBranch: string | null; workBranch: string; workCommit?: string; commit?: string; conflictFiles?: string[]; reason?: string;
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
    result.workCommit = workCommit;
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
    completedWithoutMerge: current.some(event => event.action === 'work-completed' && (event.details as { withoutMerge?: boolean }).withoutMerge),
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
    const project = projectPath(store, workId);
    if (work.workPath && existsSync(work.workPath)) await git(project, 'worktree', 'remove', '--force', work.workPath);
    const { merge, completedWithoutMerge } = deliveryDetails(store, workId);
    if (!completedWithoutMerge && merge && ['merged', 'already-contained'].includes(merge.status)
      && work.workBranch && branchExists(project, work.workBranch)) {
      if (branchIsContained(project, work.workBranch, work.baseRef)) deleteBranch(project, work.workBranch);
      else reason = `工作分支 ${work.workBranch} 尚未合入基准分支 ${work.baseRef}，已保留。`;
    }
  } catch (error) { reason = failureReason(error); }
  store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'work-copy-cleanup', { reason }, { workId }));
}

// Record completion in the same transaction as acceptance or the merge result, before cleanup.
export function completeReviewedWork(store: TaskStore, actor: Actor, workId: string, details: Record<string, unknown>) {
  store.db.prepare("UPDATE works SET status = 'completed', paused_from_status = NULL, runtime_pause_reason = NULL WHERE id = ?").run(workId);
  if (!store.events({ workId }).some(event => event.action === 'work-completed')) {
    store.appendEvent(actor, { type: 'work', id: workId }, 'work-completed', details, { workId });
  }
}

export async function finishDelivery(store: TaskStore, workId: string) {
  await cleanupReviewedCopy(store, workId);
  await compressWorkOutputs(store, workId);
  return store.work(workId);
}

export async function mergeReviewedWork(store: TaskStore, workId: string) {
  const gate = acceptedGate(store, workId);
  if (store.work(workId).status === 'completed') return store.work(workId);
  const saved = deliveryDetails(store, workId).merge;
  if (saved?.status === 'merged' || saved?.status === 'already-contained') {
    store.transaction(() => completeReviewedWork(store, runtime, workId, { gateId: gate.id, merge: saved }));
    return finishDelivery(store, workId);
  }
  setDeliveryStatus(store, runtime, workId, 'merging');
  const merge = await mergeIntoBase(store, workId);
  store.transaction(() => {
    store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-result', { gateId: gate.id, ...merge }, { workId });
    if (merge.status === 'merged' || merge.status === 'already-contained') completeReviewedWork(store, runtime, workId, { gateId: gate.id, merge });
    else store.db.prepare("UPDATE works SET status = 'accepted' WHERE id = ?").run(workId);
  });
  return store.work(workId).status === 'completed' ? finishDelivery(store, workId) : store.work(workId);
}

// Detection never creates a merge: a user may still be resolving it in their project directory.
export async function recheckReviewedWork(store: TaskStore, workId: string) {
  const gate = acceptedGate(store, workId);
  const work = store.work(workId);
  const { merge, resolution } = deliveryDetails(store, workId);
  if (work.status === 'completed') return work;
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
  const contained = { status: 'already-contained', baseBranch: merge.baseBranch, workBranch: work.workBranch, workCommit, commit: baseCommit };
  store.transaction(() => {
    store.appendEvent(runtime, { type: 'work', id: workId }, 'base-merge-result', { gateId: gate.id, ...contained }, { workId });
    completeReviewedWork(store, runtime, workId, { gateId: gate.id, merge: contained });
  });
  return finishDelivery(store, workId);
}

export function completeWithoutMerge(store: TaskStore, actor: Actor, workId: string) {
  const gate = acceptedGate(store, workId);
  const work = store.work(workId);
  if (work.status === 'completed' && deliveryDetails(store, workId).completedWithoutMerge) return work;
  const resolving = deliveryDetails(store, workId).resolution?.status === 'solving' && ['executing', 'paused'].includes(work.status);
  if (work.status !== 'accepted' && !resolving) throw new RuleError('WORK_NOT_ACCEPTED', '只能结束已接受、尚未合入的工作。');
  store.transaction(() => completeReviewedWork(store, actor, workId, { gateId: gate.id, withoutMerge: true, workBranch: work.workBranch }));
  return store.work(workId);
}

function mergedWork(store: TaskStore, workId: string) {
  const { merge, completedWithoutMerge } = deliveryDetails(store, workId);
  if (store.work(workId).status !== 'completed' || completedWithoutMerge || !merge?.baseBranch || !['merged', 'already-contained'].includes(merge.status)) {
    throw new RuleError('WORK_NOT_MERGED', '工作完成且已合入后才能推送。');
  }
  return merge as MergeResult & { baseBranch: string };
}

export interface PushPreview {
  baseBranch: string; remote?: string; remoteBranch?: string; trackingBranch?: string; newBranch?: boolean;
  commits: { hash: string; subject: string }[]; reason?: string;
}

// Uses local remote-tracking refs; no network access or fetch during a read.
export async function previewWorkPush(store: TaskStore, workId: string): Promise<PushPreview> {
  const merge = mergedWork(store, workId);
  const project = projectPath(store, workId);
  const preview: PushPreview = { baseBranch: merge.baseBranch, commits: [] };
  try {
    const config = async (key: string) => {
      try { return (await git(project, 'config', '--get', key)).trim(); }
      catch (error) { if ((error as { code?: number }).code === 1) return ''; throw error; }
    };
    const branch = merge.baseBranch.slice('refs/heads/'.length);
    const remotes = (await git(project, 'remote')).trim().split('\n').filter(Boolean);
    const remote = await config(`branch.${branch}.remote`) || (remotes.includes('origin') ? 'origin' : remotes.length === 1 ? remotes[0] : undefined);
    if (!remote || !remotes.includes(remote)) return { ...preview, reason: '没有可用的远端仓库，请先为基准分支配置远端。' };
    const remoteBranch = await config(`branch.${branch}.merge`) || merge.baseBranch;
    if (!remoteBranch.startsWith('refs/heads/')) throw new Error('远端跟踪目标不是分支，无法推送。');
    // for-each-ref respects custom fetch refspecs as well as upstream branch names.
    const upstream = (await git(project, 'for-each-ref', '--format=%(upstream)', merge.baseBranch)).trim();
    const trackingBranch = upstream || `refs/remotes/${remote}/${remoteBranch.slice('refs/heads/'.length)}`;
    let newBranch = false;
    try { await git(project, 'show-ref', '--verify', '--quiet', trackingBranch); }
    catch (error) { if ((error as { code?: number }).code !== 1) throw error; newBranch = true; }
    const log = await git(project, 'log', '--format=%h%x00%s', newBranch ? merge.baseBranch : `${trackingBranch}..${merge.baseBranch}`, '--');
    const commits = log.trimEnd().split('\n').filter(Boolean).map(line => {
      const [hash, subject] = line.split('\0');
      return { hash: hash!, subject: subject! };
    });
    return { ...preview, remote, remoteBranch, trackingBranch, newBranch, commits };
  } catch (error) { return { ...preview, reason: failureReason(error) }; }
}

// Kill the entire push process group so hooks/credential helpers cannot keep it waiting.
async function pushGit(project: string, remote: string, refspec: string, timeoutMs: number) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', ['-C', project, 'push', '--', remote, refspec], { detached: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let timedOut = false;
    child.stderr.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-1024 * 1024); });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        try { process.kill(-child.pid, 'SIGKILL'); }
        catch { child.kill('SIGKILL'); }
      }
    }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error(`推送超时（${timeoutMs} ms），可重试。`));
      else if (code !== 0) reject(new Error(stderr.trim() || `git push exited: ${code ?? signal}`));
      else resolve();
    });
  });
}

export async function pushReviewedWork(store: TaskStore, workId: string, timeoutMs = 120_000) {
  const merge = mergedWork(store, workId);
  if (deliveryDetails(store, workId).push?.status === 'pushed') return store.work(workId);
  const gate = acceptedGate(store, workId);
  let push: PushResult;
  try {
    const preview = await previewWorkPush(store, workId);
    if (preview.reason) throw new Error(preview.reason);
    await pushGit(projectPath(store, workId), preview.remote!, `${merge.baseBranch}:${preview.remoteBranch}`, timeoutMs);
    push = { status: 'pushed', baseBranch: merge.baseBranch };
  } catch (error) { push = { status: 'failed', baseBranch: merge.baseBranch, reason: failureReason(error) }; }
  store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, 'base-push-result', { gateId: gate.id, ...push }, { workId }));
  return store.work(workId);
}
