import { randomUUID } from 'node:crypto';
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
  runtimeMessage(store, workId, `runtime-pause:${roundId}`, `工作已由运行层暂停：${reason}。请手动恢复工作。`);
  store.appendEvent(runtime, { type: 'work', id: workId }, 'needs-user-attention', { kind: 'runtime-pause', reason, roundId }, { workId });
}

// Called inside the round completion transaction, after its wake events are marked processed.
export function noticeStall(store: TaskStore, workId: string, roundId: string) {
  if (store.work(workId).status !== 'executing') return;
  const busy = store.db.prepare(`SELECT
    EXISTS (SELECT 1 FROM dispatches WHERE work_id = ? AND status IN ('queued', 'running'))
    OR EXISTS (SELECT 1 FROM wake_queue WHERE work_id = ? AND processed_by IS NULL)
    OR EXISTS (SELECT 1 FROM gates WHERE work_id = ? AND status = 'pending')
    OR EXISTS (SELECT 1 FROM cards WHERE work_id = ? AND status = 'paused') AS busy`).get(workId, workId, workId, workId)!.busy;
  if (busy || store.gates(workId).some(gate => gate.status === 'pending')) return;
  const cards = store.db.prepare('SELECT status FROM cards WHERE work_id = ?').all(workId);
  const nudged = store.db.prepare(`SELECT 1 FROM coordinator_rounds r JOIN json_each(r.event_ids) wake
    JOIN events e ON e.id = wake.value
    WHERE r.id = ? AND r.work_id = ? AND e.action = 'work-stall-nudged' LIMIT 1`).get(roundId, workId);
  if (nudged) {
    const reason = '调度者结束了这一轮，但没有运行中的派单、待你决定的关卡或待处理事件，工作不会自己推进，运行层已提醒过调度者一次';
    store.appendEvent(runtime, { type: 'work', id: workId }, 'work-stalled', { reason, roundId }, { workId });
    runtimeMessage(store, workId, `runtime-stall:${roundId}`, `${reason}。发一条消息即可唤醒调度者。`);
    store.appendEvent(runtime, { type: 'work', id: workId }, 'needs-user-attention', { kind: 'work-stalled', reason, roundId }, { workId });
    return;
  }
  const reason = cards.length && cards.every(card => ['completed', 'cancelled', 'skipped'].includes(String(card.status)))
    ? '全部卡片已结束，但工作没有进入审核：目标满足就发起审核；正在处理合入冲突就完成冲突处理；还有差距就继续派单'
    : '调度者结束了这一轮，但没有运行中的派单、待决定关卡或待处理事件，工作不会自己推进。请继续推进工作，或发起需要用户决定的关卡';
  const event = store.appendEvent(runtime, { type: 'work', id: workId }, 'work-stall-nudged', { reason, roundId }, { workId });
  store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
}

export function runtimeMessage(store: TaskStore, workId: string, key: string, body: string) {
  const id = randomUUID();
  const event = store.appendEvent(runtime, { type: 'message', id }, 'message-sent', { body }, { workId });
  store.db.prepare('INSERT INTO messages (id, work_id, sender, body, key, gate_id, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workId, 'runtime', body, key, null, event.time, event.id);
}
