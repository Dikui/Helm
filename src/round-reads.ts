import type { DriverEvent } from './driver.js';
import { readOutput } from './outputs.js';
import { RuleError, type TaskStore } from './store.js';

export function coordinatorNotes(store: TaskStore, workId: string) {
  const current = store.notes(workId);
  const versions = store.events({ workId }).filter(event => event.action === 'coordinator-notes-written').map(event => ({
    ...(event.details as { body: string; version: number }), time: event.time,
  }));
  return { ...current, versions };
}

export function roundOutput(store: TaskStore, params: { workId: string; roundId: string; fromStep?: number; toStep?: number }) {
  const work = store.work(params.workId);
  const round = store.db.prepare('SELECT output_path AS outputPath FROM coordinator_rounds WHERE work_id = ? AND id = ?')
    .get(params.workId, params.roundId);
  if (!round) throw new RuleError('NOT_FOUND', '找不到这个调度轮次。', 404);
  const from = params.fromStep ?? 1;
  const to = params.toStep ?? Number.MAX_SAFE_INTEGER;
  if (to < from) throw new RuleError('INVALID_PARAMS', '结束步骤不能小于开始步骤。', 400);
  if (work.outputsDeletedAt) return { status: 'deleted', message: '已删除' };
  return readOutput(String(round.outputPath)).toString('utf8').split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as DriverEvent & { time?: string }).filter(step => step.step >= from && step.step <= to);
}

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
