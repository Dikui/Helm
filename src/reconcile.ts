import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { removeCardCopy } from './completion.js';
import { dispatchGit, getDispatch } from './dispatch.js';
import { finishDispatchCopy } from './execution.js';
import { cardGraph, refreshCardReadiness } from './graph.js';
import { cleanupRecordedProcessGroup, cleanupWorktreeProcesses } from './processes.js';
import { completeReviewedWork } from './review.js';
import type { TaskStore } from './store.js';

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
  const root = join(store.dataDir, 'worktrees');
  if (existsSync(root)) await cleanupWorktreeProcesses(root);

  const works = store.db.prepare('SELECT id FROM works ORDER BY rowid').all().map(row => store.work(String(row.id)));
  for (const work of works) {
    // Also settle a queued dispatch whose revocation was interrupted before shutdown.
    const dispatches = store.db.prepare(`SELECT id, status FROM dispatches WHERE work_id = ? AND
      (status = 'running' OR (status = 'queued' AND (abort_reason IS NOT NULL OR ? IN ('completed', 'cancelled')
        OR EXISTS (SELECT 1 FROM gates WHERE work_id = ? AND kind = 'review' AND decision = 'accept'))))`).all(work.id, work.status, work.id);
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

  for (const work of works) {
    if (work.workPath && existsSync(work.workPath)) abortMerge(store, work.id, work.workPath, 'work-merge-aborted', true);
    const accepted = store.gates(work.id).find(gate => gate.kind === 'review' && gate.decision === 'accept');
    if (accepted) {
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
      if (work.status !== 'completed' || ['base-merge-result', 'base-push-result', 'work-completed'].some(action =>
        !events.some(event => event.action === action && (event.details as { gateId?: string }).gateId === accepted.id))) {
        completeReviewedWork(store, work.id, accepted.id);
      }
    }
    for (const node of cardGraph(store, work.id)) {
      if (node.type !== 'card' || (!['completed', 'cancelled'].includes(node.status) && work.status !== 'cancelled')) continue;
      removeCardCopy(store, { ...node, workPath: node.workPath ?? join(root, work.id, node.id), cardBranch: node.cardBranch ?? `helm-card/${work.id}/${node.id}` });
    }
    const workPath = work.workPath ?? join(root, work.id, '_work');
    if (['completed', 'cancelled'].includes(store.work(work.id).status) && existsSync(workPath)) {
      dispatchGit(projectPath(store, work.id), 'worktree', 'remove', '--force', workPath);
    }
  }
}
