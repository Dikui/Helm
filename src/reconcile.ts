import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { removeCardCopy } from './completion.js';
import { dispatchGit, getDispatch } from './dispatch.js';
import { finishDispatchCopy } from './execution.js';
import { cardGraph, refreshCardReadiness } from './graph.js';
import { cleanupRecordedProcessGroup, cleanupWorktreeProcesses } from './processes.js';
import { deliveryDetails, mergeReviewedWork, completeReviewedWork, cleanupReviewedCopy } from './delivery.js';
import type { TaskStore } from './store.js';
import { checkOutputUsage, compressWorkOutputs } from './outputs.js';
import { removeVerificationCopy } from './verification.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;
const restartReason = '运行层重启';

function abortMerge(store: TaskStore, workId: string, path: string, action: string, resetWorkCopy = false) {
  const gitPath = (name: string) => resolve(path, dispatchGit(path, 'rev-parse', '--git-path', name));
  if (existsSync(gitPath('index.lock'))) rmSync(gitPath('index.lock'));
  if (existsSync(gitPath('MERGE_HEAD'))) dispatchGit(path, 'merge', '--abort');
  else if (resetWorkCopy && dispatchGit(path, 'status', '--porcelain')) {
    // merge can update the index before it writes MERGE_HEAD. _work belongs to
    // the runtime and the coordinator is read-only, so restore its saved HEAD.
    dispatchGit(path, 'reset', '--hard', 'HEAD');
    dispatchGit(path, 'clean', '-fd');
  } else return;
  store.transaction(() => store.appendEvent(runtime, { type: 'work', id: workId }, action, { path }, { workId }));
}

// Nothing can dispatch or serve requests until every recovery step has settled.
export async function reconcileStartup(store: TaskStore) {
  const browsers = store.db.prepare('SELECT id, work_id, card_id, browser_pgid, browser_started_at FROM dispatches WHERE browser_pgid IS NOT NULL').all();
  for (const row of browsers) {
    if (row.browser_started_at && await cleanupRecordedProcessGroup(Number(row.browser_pgid), String(row.browser_started_at))) {
      store.transaction(() => store.appendEvent(runtime, { type: 'dispatch', id: String(row.id) }, 'browser-processes-cleaned',
        { pgid: row.browser_pgid, startedAt: row.browser_started_at }, { workId: String(row.work_id), cardId: String(row.card_id), dispatchId: String(row.id) }));
    }
  }
  // Read-only executors can run in the project directory, outside the copy tree.
  const readOnlyProcesses = store.db.prepare(`SELECT d.id, d.work_id, d.card_id, d.pgid, d.process_started_at FROM dispatches d
    JOIN cards c ON c.id = d.card_id WHERE c.read_only = 1 AND d.purpose = 'execution' AND d.pgid IS NOT NULL`).all();
  for (const row of readOnlyProcesses) {
    if (row.process_started_at && await cleanupRecordedProcessGroup(Number(row.pgid), String(row.process_started_at))) {
      store.transaction(() => store.appendEvent(runtime, { type: 'dispatch', id: String(row.id) }, 'dispatch-processes-cleaned',
        { pgid: row.pgid, startedAt: row.process_started_at }, { workId: String(row.work_id), cardId: String(row.card_id), dispatchId: String(row.id) }));
    }
  }
  const root = join(store.dataDir, 'worktrees');
  if (existsSync(root)) await cleanupWorktreeProcesses(root);

  const works = store.db.prepare('SELECT id FROM works ORDER BY rowid').all().map(row => store.work(String(row.id)));
  for (const work of works) {
    // Also settle a queued dispatch whose revocation was interrupted before shutdown.
    const dispatches = store.db.prepare(`SELECT id, status FROM dispatches WHERE work_id = ? AND
      (status = 'running' OR (status = 'queued' AND (abort_reason IS NOT NULL OR ? IN ('completed', 'cancelled')
        OR (? NOT IN ('executing', 'paused') AND EXISTS (SELECT 1 FROM gates WHERE work_id = ? AND kind = 'review' AND decision = 'accept')))))`).all(work.id, work.status, work.status, work.id);
    for (const row of dispatches) {
      const dispatch = getDispatch(store, work.id, String(row.id));
      const endCommit = dispatch.status === 'running' ? finishDispatchCopy(store, dispatch, 'aborted', restartReason) : null;
      store.transaction(() => {
        store.db.prepare(`UPDATE dispatches SET status = 'ended', ended_at = ?, end_reason = 'aborted', abort_reason = ?,
          final_answer = NULL, conclusion = 'undeclared', conclusion_reason = NULL, end_commit = ? WHERE id = ?`)
          .run(new Date().toISOString(), dispatch.status === 'running' ? restartReason : dispatch.abortReason ?? restartReason, endCommit, dispatch.id);
        refreshCardReadiness(store, work.id);
        const event = store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-ended', getDispatch(store, work.id, dispatch.id),
          { workId: work.id, cardId: dispatch.cardId, dispatchId: dispatch.id });
        store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, work.id);
      });
    }
  }
  for (const row of store.db.prepare(`SELECT id, work_id, event_ids FROM coordinator_rounds WHERE status = 'running'`).all()) {
    store.transaction(() => {
      store.db.prepare(`UPDATE coordinator_rounds SET status = 'ended', ended_at = ?, reason = 'aborted' WHERE id = ?`).run(new Date().toISOString(), String(row.id));
      store.appendEvent(runtime, { type: 'coordinator-round', id: String(row.id) }, 'round-ended',
        { reason: 'aborted', abortReason: restartReason, eventIds: JSON.parse(String(row.event_ids)), processed: false }, { workId: String(row.work_id) });
    });
  }

  // Recover active Git operations before queued merges, regardless of work creation order.
  const queuedAt = new Map(store.db.prepare(`SELECT work_id, MAX(id) AS sequence FROM events
    WHERE action = 'delivery-status-changed' AND json_extract(details, '$.status') = 'merge-queued'
    GROUP BY work_id`).all().map(row => [String(row.work_id), Number(row.sequence)]));
  const recoveryRank = (status: string) => status === 'merging' ? 0 : status === 'merge-queued' ? 1 : 2;
  const recoveryWorks = [...works].sort((a, b) => recoveryRank(a.status) - recoveryRank(b.status)
    || (queuedAt.get(a.id) ?? 0) - (queuedAt.get(b.id) ?? 0));
  for (const work of recoveryWorks) {
    const accepted = store.gates(work.id).findLast(gate => gate.kind === 'review' && gate.decision === 'accept');
    if (accepted && !work.workBranch && work.status === 'accepted') {
      store.transaction(() => completeReviewedWork(store, runtime, work.id, { gateId: accepted.id, noCodeChanges: true }));
    }
    // A deleted project has no repository to repair; keep the work as recorded instead of failing startup.
    if (!existsSync(projectPath(store, work.id))) { await compressWorkOutputs(store, work.id); continue; }
    // No dispatch runs yet, so every verification copy left by a crash is stale.
    if (existsSync(join(root, work.id, 'verifications'))) removeVerificationCopy(store, work.id, join(root, work.id, 'verifications'));
    if (work.workPath && existsSync(work.workPath)) abortMerge(store, work.id, work.workPath, 'work-merge-aborted', true);
    if (accepted && work.workBranch) {
      const project = projectPath(store, work.id);
      const events = store.events({ workId: work.id });
      const intent = events.filter(event => event.action === 'base-merge-started').at(-1);
      const settled = events.filter(event => ['base-merge-result', 'base-merge-aborted'].includes(event.action)).at(-1);
      const mergeHead = resolve(project, dispatchGit(project, 'rev-parse', '--git-path', 'MERGE_HEAD'));
      if (intent && intent.id > (settled?.id ?? 0)) {
        const saved = intent.details as { baseBranch: string; baseCommit: string; workCommit: string; mergeTree: string };
        const originalBase = dispatchGit(project, 'rev-parse', '--symbolic-full-name', 'HEAD') === saved.baseBranch
          && dispatchGit(project, 'rev-parse', 'HEAD') === saved.baseCommit;
        if (originalBase && existsSync(mergeHead) && readFileSync(mergeHead, 'utf8').trim() === saved.workCommit) {
          abortMerge(store, work.id, project, 'base-merge-aborted');
        } else if (originalBase && !existsSync(mergeHead) && !dispatchGit(project, 'ls-files', '--unmerged')
          && dispatchGit(project, 'write-tree') === saved.mergeTree) {
          // This is the exact index our merge was about to commit. --merge
          // restores it while retaining unrelated unstaged user changes.
          dispatchGit(project, 'reset', '--merge', saved.baseCommit);
          store.transaction(() => store.appendEvent(runtime, { type: 'work', id: work.id }, 'base-merge-aborted', { path: project }, { workId: work.id }));
        }
      }
      const delivery = deliveryDetails(store, work.id);
      if (delivery.merge && ['merged', 'already-contained'].includes(delivery.merge.status) && work.status !== 'completed') {
        store.transaction(() => completeReviewedWork(store, runtime, work.id, { gateId: accepted.id, merge: delivery.merge }));
      } else if (['merging', 'merge-queued'].includes(work.status)) await mergeReviewedWork(store, work.id);
    }
    for (const node of cardGraph(store, work.id)) {
      if (node.type !== 'card' || node.readOnly || (!['completed', 'cancelled'].includes(node.status) && !['completed', 'cancelled'].includes(work.status))) continue;
      removeCardCopy(store, { ...node, workPath: node.workPath ?? join(root, work.id, node.id), cardBranch: node.cardBranch ?? `helm-card/${work.id}/${node.id}` });
    }
    const workPath = work.workPath ?? join(root, work.id, '_work');
    if (['completed', 'cancelled'].includes(store.work(work.id).status)) {
      if (accepted) await cleanupReviewedCopy(store, work.id);
      else if (existsSync(workPath)) dispatchGit(projectPath(store, work.id), 'worktree', 'remove', '--force', workPath);
    }
    await compressWorkOutputs(store, work.id);
  }
  store.transaction(() => checkOutputUsage(store));
}
