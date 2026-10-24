import { randomUUID } from 'node:crypto';
import { revokeDispatch } from './dispatch.js';
import { TaskStore } from './store.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

// Called inside the round completion transaction so the pause and its notice agree.
export function pauseWorkFromRuntime(store: TaskStore, workId: string, roundId: string, reason: string) {
  const work = store.work(workId);
  if (['completed', 'cancelled'].includes(work.status)) return;
  store.db.prepare(`UPDATE works SET paused_from_status = CASE WHEN status = 'paused' THEN paused_from_status ELSE status END,
    status = 'paused', runtime_pause_reason = ? WHERE id = ?`)
    .run(reason, workId);
  store.appendEvent(runtime, { type: 'work', id: workId }, 'work-paused', { reason, roundId }, { workId });
  for (const row of store.db.prepare(`SELECT id FROM dispatches WHERE work_id = ? AND status IN ('queued', 'running')`).all(workId)) {
    revokeDispatch(store, runtime, { workId, dispatchId: String(row.id), reason: '工作暂停' });
  }
  const id = randomUUID();
  const body = `工作已由运行层暂停：${reason}。请手动恢复工作。`;
  const event = store.appendEvent(runtime, { type: 'message', id }, 'message-sent', { body }, { workId });
  store.db.prepare('INSERT INTO messages (id, work_id, sender, body, key, gate_id, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workId, 'runtime', body, `runtime-pause:${roundId}`, null, event.time, event.id);
  store.appendEvent(runtime, { type: 'work', id: workId }, 'needs-user-attention', { kind: 'runtime-pause', reason, roundId }, { workId });
}
