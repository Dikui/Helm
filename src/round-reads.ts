import type { DriverEvent } from './driver.js';
import { readOutput } from './outputs.js';
import type { TaskStore } from './store.js';

// Historical output is read separately; steering only needs the active round's steps.
export function listRounds(store: TaskStore, workId: string, includeCurrentSteps: boolean) {
  const work = store.work(workId);
  const rows = store.db.prepare(`SELECT id, work_id AS workId, status, started_at AS startedAt,
    ended_at AS endedAt, reason, usage, template_snapshot AS templateSnapshot, event_ids AS eventIds,
    output_path AS outputPath FROM coordinator_rounds WHERE work_id = ? ORDER BY rowid`).all(workId);
  const running = rows.find(row => row.status === 'running');
  const received = new Set<number>(running ? JSON.parse(String(running.eventIds)) : []);
  const queuedMessages = ['completed', 'cancelled'].includes(work.status) ? [] : store.db.prepare(`SELECT m.id, m.work_id AS workId, m.sender, m.body,
    m.card_id AS cardId, m.gate_id AS gateId, m.created_at AS createdAt, m.sequence
    FROM messages m JOIN wake_queue q ON q.event_id = m.sequence
    WHERE q.work_id = ? AND q.processed_by IS NULL AND m.sender = 'user' ORDER BY m.sequence`)
    .all(workId).filter(message => !received.has(Number(message.sequence)));
  const rounds = rows.map(({ eventIds: _eventIds, outputPath: _outputPath, templateSnapshot, usage, ...round }, index) => ({
    ...round, number: index + 1,
    templateId: templateSnapshot ? JSON.parse(String(templateSnapshot)).id as string : null,
    usage: usage ? JSON.parse(String(usage)) : { inputTokens: 0, outputTokens: 0 },
  }));
  // Coordinator tool responses become output too. Returning that output to the
  // same coordinator would recursively embed earlier list-rounds responses.
  const currentSteps = includeCurrentSteps && running ? readOutput(String(running.outputPath)).toString('utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as DriverEvent & { time?: string }) : [];
  return { rounds, queuedMessages, currentSteps };
}
