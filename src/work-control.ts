import { randomUUID } from 'node:crypto';
import { revokeDispatch } from './dispatch.js';
import { RuleError, TaskStore, type Actor } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

// Called inside the round completion transaction so the pause and its notice agree.
export function pauseWorkFromRuntime(store: TaskStore, workId: string, roundId: string, reason: string) {
  const work = store.work(workId);
  if (!['aligning', 'executing'].includes(work.status)) return;
  store.db.prepare(`UPDATE works SET paused_from_status = status, status = 'paused', runtime_pause_reason = ? WHERE id = ?`)
    .run(reason, workId);
  store.appendEvent(runtime, { type: 'work', id: workId }, 'work-paused', { reason, roundId }, { workId });
  for (const row of store.db.prepare(`SELECT id FROM dispatches WHERE work_id = ? AND status IN ('queued', 'running')`).all(workId)) {
    revokeDispatch(store, runtime, { workId, dispatchId: String(row.id), reason: '工作暂停' });
  }
  const id = randomUUID();
  const body = `工作已由运行层暂停：${reason}。请手动恢复工作。`;
  const event = store.appendEvent(runtime, { type: 'message', id }, 'message-sent', { body }, { workId });
  store.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workId, 'runtime', body, `runtime-pause:${roundId}`, null, event.time, event.id);
  store.appendEvent(runtime, { type: 'work', id: workId }, 'needs-user-attention', { kind: 'runtime-pause', reason, roundId }, { workId });
}

export function resumeWork(store: TaskStore, actor: Actor, workId: string) {
  const work = store.work(workId);
  if (['aligning', 'executing'].includes(work.status)) return work;
  if (work.status !== 'paused' || !work.runtimePauseReason) throw new RuleError('WORK_NOT_RUNTIME_PAUSED', '只能恢复被运行层暂停的工作。');
  store.db.prepare(`UPDATE works SET status = paused_from_status, paused_from_status = NULL,
    runtime_pause_reason = NULL, consecutive_round_failures = 0 WHERE id = ?`).run(workId);
  const event = store.appendEvent(actor, { type: 'work', id: workId }, 'work-resumed', { previousReason: work.runtimePauseReason }, { workId });
  store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
  return store.work(workId);
}
