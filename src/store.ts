import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import type { TokenUsage } from './driver.js';
import { migrations } from './migrations.js';
import type { AgentCatalog } from './agents.js';
import type { ReviewReport } from './review-report.js';

export type ActorType = 'user' | 'coordinator-round' | 'dispatch' | 'runtime';
export interface Actor { type: ActorType; id: string; workId?: string }
export interface Work {
  id: string; projectId: string; status: string; createdAt: string; coordinatorAgentId: string;
  baseRef: string | null; baseCommit: string | null; workBranch: string | null;
  workPath: string | null; activeDescriptionId: string | null;
  runtimePauseReason: string | null;
  outputsExportedAt: string | null; outputsDeletedAt: string | null;
  usage: TokenUsage;
}
export interface WorkDescription {
  id: string; workId: string; version: number; status: string; key: string;
  requirements: string; boundary: string; criteria: string; gateId: string;
  baseRef: string; baseCommit: string;
}
export interface Gate {
  id: string; workId: string; kind: string; status: string; key: string | null;
  question: string; body: string; options: string[]; multiSelect: boolean; creator: Actor;
  createdAt: string; sequence: number; descriptionId: string | null;
  decision: string | null; withdrawalReason: string | null; comment: string | null;
  report: ReviewReport | null;
}

const gateColumns = `id, work_id AS workId, kind, status, key, question, body, options, multi_select AS multiSelect,
  creator_type AS creatorType, creator_id AS creatorId, created_at AS createdAt, sequence,
  description_id AS descriptionId, decision, withdrawal_reason AS withdrawalReason, comment, report`;

function readGate(row: Record<string, unknown>): Gate {
  const { creatorType, creatorId, options, multiSelect, report, ...fields } = row;
  return { ...fields, options: JSON.parse(String(options)), multiSelect: multiSelect === 1, report: report ? JSON.parse(String(report)) : null,
    creator: { type: creatorType, id: creatorId } } as Gate;
}
export interface EventFilter {
  after?: number;
  workId?: string;
  cardId?: string;
  dispatchId?: string;
  actorType?: ActorType;
  actorId?: string;
}
export interface HelmEvent {
  id: number;
  time: string;
  actor: Actor;
  object: { type: string; id: string };
  action: string;
  details: unknown;
  workId: string | null;
  cardId: string | null;
  dispatchId: string | null;
}

export class RuleError extends Error {
  constructor(public code: string, reason: string, public status = 409, public details?: Record<string, unknown>) { super(reason); }
}

export class TaskStore {
  readonly db: DatabaseSync;
  private pendingEvents: HelmEvent[] = [];
  private listeners = new Set<(events: HelmEvent[]) => void>();

  constructor(readonly dataDir: string, readonly agents: AgentCatalog) {
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = realpathSync(dataDir);
    this.db = new DatabaseSync(join(this.dataDir, 'helm.db'));
    try {
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
      const version = Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
      if (version < 0 || version > migrations.length) throw new Error(`Unsupported task store version: ${version}`);
      for (let index = version; index < migrations.length; index++) {
        this.db.exec(`BEGIN IMMEDIATE;
${migrations[index]}
PRAGMA user_version = ${index + 1};
COMMIT;`);
      }
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    this.pendingEvents = [];
    let result: T;
    try {
      result = run();
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      this.pendingEvents = [];
      throw error;
    }
    const committed = this.pendingEvents;
    this.pendingEvents = [];
    for (const listener of this.listeners) listener(committed);
    return result;
  }

  appendEvent(actor: Actor, object: HelmEvent['object'], action: string, details: unknown, scope: Omit<EventFilter, 'after' | 'actorType' | 'actorId'> = {}) {
    const time = new Date().toISOString();
    const inserted = this.db.prepare(`INSERT INTO events
      (time, actor_type, actor_id, object_type, object_id, action, details, work_id, card_id, dispatch_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      time, actor.type, actor.id, object.type, object.id, action, JSON.stringify(details),
      scope.workId ?? null, scope.cardId ?? null, scope.dispatchId ?? null,
    );
    const event: HelmEvent = {
      id: Number(inserted.lastInsertRowid), time, actor, object, action, details,
      workId: scope.workId ?? null, cardId: scope.cardId ?? null, dispatchId: scope.dispatchId ?? null,
    };
    this.pendingEvents.push(event);
    return event;
  }

  events(filter: EventFilter = {}): HelmEvent[] {
    const clauses = ['id > ?'];
    const values: SQLInputValue[] = [filter.after ?? 0];
    const fields = { workId: 'work_id', cardId: 'card_id', dispatchId: 'dispatch_id', actorType: 'actor_type', actorId: 'actor_id' } as const;
    for (const [field, column] of Object.entries(fields)) {
      const value = filter[field as keyof typeof fields];
      if (value !== undefined) { clauses.push(`${column} = ?`); values.push(value); }
    }
    return this.db.prepare(`SELECT * FROM events WHERE ${clauses.join(' AND ')} ORDER BY id`).all(...values).map(row => ({
      id: Number(row.id), time: String(row.time),
      actor: { type: row.actor_type as ActorType, id: String(row.actor_id) },
      object: { type: String(row.object_type), id: String(row.object_id) },
      action: String(row.action), details: JSON.parse(String(row.details)),
      workId: row.work_id as string | null, cardId: row.card_id as string | null, dispatchId: row.dispatch_id as string | null,
    }));
  }

  work(id: string): Work {
    const work = this.db.prepare(`SELECT id, project_id AS projectId, status, created_at AS createdAt,
      base_ref AS baseRef, base_commit AS baseCommit, work_branch AS workBranch,
      work_path AS workPath, active_description_id AS activeDescriptionId,
      runtime_pause_reason AS runtimePauseReason, outputs_exported_at AS outputsExportedAt,
      outputs_deleted_at AS outputsDeletedAt, coordinator_agent_id AS coordinatorAgentId FROM works WHERE id = ?`).get(id);
    if (!work) throw new RuleError('NOT_FOUND', '找不到这项工作。', 404);
    return { ...work, usage: this.workUsage(id) } as unknown as Work;
  }

  workUsage(workId: string): TokenUsage {
    const row = this.db.prepare(`SELECT SUM(json_extract(usage, '$.inputTokens')) AS inputTokens, SUM(json_extract(usage, '$.outputTokens')) AS outputTokens,
      SUM(json_extract(usage, '$.cacheReadTokens')) AS cacheReadTokens, SUM(json_extract(usage, '$.cacheWriteTokens')) AS cacheWriteTokens,
      COUNT(*) > MIN(COUNT(json_extract(usage, '$.inputTokens')), COUNT(json_extract(usage, '$.outputTokens'))) AS incomplete FROM (
        SELECT usage FROM dispatches WHERE work_id = ? UNION ALL
        SELECT usage FROM coordinator_rounds WHERE work_id = ?
      )`).get(workId, workId) as { inputTokens: number | null; outputTokens: number | null; cacheReadTokens: number | null; cacheWriteTokens: number | null; incomplete: number };
    return { inputTokens: row.inputTokens, outputTokens: row.outputTokens, ...(row.cacheReadTokens !== null ? { cacheReadTokens: row.cacheReadTokens } : {}),
      ...(row.cacheWriteTokens !== null ? { cacheWriteTokens: row.cacheWriteTokens } : {}), ...(row.incomplete && (row.inputTokens !== null || row.outputTokens !== null) ? { incomplete: true } : {}) };
  }

  descriptions(workId: string): WorkDescription[] {
    this.work(workId);
    return this.db.prepare(`SELECT id, work_id AS workId, version, status, key, requirements, boundary, criteria,
      gate_id AS gateId, base_ref AS baseRef, base_commit AS baseCommit
      FROM work_descriptions WHERE work_id = ? ORDER BY version`).all(workId) as unknown as WorkDescription[];
  }

  notes(workId: string) {
    this.work(workId);
    return this.db.prepare('SELECT body, version FROM coordinator_notes WHERE work_id = ?').get(workId) ?? { body: '', version: 0 };
  }

  message(workId: string, key: string) {
    const row = this.db.prepare(`SELECT id, work_id AS workId, sender, body, key, gate_id AS gateId, card_id AS cardId,
      created_at AS createdAt, sequence, attachments, withdrawn_at AS withdrawnAt FROM messages WHERE work_id = ? AND key = ?`).get(workId, key);
    return row && Object.assign(row, { attachments: JSON.parse(String(row.attachments)) as unknown[] });
  }

  conversation(workId: string) {
    this.work(workId);
    return this.db.prepare(`
      SELECT 'message' AS type, id, work_id AS workId, sender, body, gate_id AS gateId, card_id AS cardId,
        NULL AS kind, NULL AS status, NULL AS question, created_at AS createdAt, sequence,
        NULL AS descriptionId, NULL AS decision, attachments, withdrawn_at AS withdrawnAt
      FROM messages WHERE work_id = ?
      UNION ALL
      SELECT 'gate', id, work_id, NULL, NULL, NULL, NULL, kind, status, question, created_at, sequence, description_id, decision, NULL, NULL
      FROM gates WHERE work_id = ? ORDER BY sequence
    `).all(workId, workId).map(item => item.type === 'gate' ? { ...item, ...this.gate(workId, String(item.id)) }
      : Object.assign(item, { attachments: JSON.parse(String(item.attachments)) as unknown[] }));
  }

  gate(workId: string, gateId: string): Gate {
    this.work(workId);
    const row = this.db.prepare(`SELECT ${gateColumns} FROM gates WHERE id = ? AND work_id = ?`).get(gateId, workId);
    if (!row) throw new RuleError('INVALID_GATE', '关卡必须属于这项工作。', 400);
    return readGate(row);
  }

  gates(workId: string): Gate[] {
    this.work(workId);
    return this.db.prepare(`SELECT ${gateColumns} FROM gates WHERE work_id = ? ORDER BY sequence`).all(workId).map(readGate);
  }

  pending() {
    return this.db.prepare(`SELECT ${gateColumns} FROM gates WHERE status = 'pending'
      AND work_id IN (SELECT id FROM works WHERE status NOT IN ('completed', 'cancelled')) ORDER BY sequence`).all().map(readGate);
  }

  subscribe(listener: (events: HelmEvent[]) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close() { this.db.close(); }
}
