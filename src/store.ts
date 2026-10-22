import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type ActorType = 'user' | 'coordinator-round' | 'dispatch' | 'runtime';
export interface Actor { type: ActorType; id: string }
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
  constructor(public code: string, reason: string, public status = 409) { super(reason); }
}

export class TaskStore {
  readonly db: DatabaseSync;
  private pendingEvents: HelmEvent[] = [];
  private listeners = new Set<(events: HelmEvent[]) => void>();

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'helm.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
    if (version !== 0 && version !== 1) {
      this.db.close();
      throw new Error(`Unsupported task store version: ${version}`);
    }
    if (version === 0) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id = 1), concurrency_limit INTEGER NOT NULL CHECK(concurrency_limit > 0)) STRICT;
      INSERT INTO settings VALUES (1, 10);
      CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL) STRICT;
      CREATE TABLE works (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        status TEXT NOT NULL, creation_key TEXT NOT NULL, created_at TEXT NOT NULL,
        UNIQUE(project_id, creation_key)
      ) STRICT;
      CREATE TABLE events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, time TEXT NOT NULL,
        actor_type TEXT NOT NULL, actor_id TEXT NOT NULL,
        object_type TEXT NOT NULL, object_id TEXT NOT NULL, action TEXT NOT NULL,
        details TEXT NOT NULL, work_id TEXT, card_id TEXT, dispatch_id TEXT
      ) STRICT;
      CREATE INDEX events_work ON events(work_id, id);
      CREATE INDEX events_card ON events(card_id, id);
      CREATE INDEX events_dispatch ON events(dispatch_id, id);
      CREATE INDEX events_actor ON events(actor_type, actor_id, id);
      CREATE TABLE gates (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
        kind TEXT NOT NULL, status TEXT NOT NULL, question TEXT NOT NULL,
        created_at TEXT NOT NULL, sequence INTEGER NOT NULL REFERENCES events(id)
      ) STRICT;
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id),
        sender TEXT NOT NULL, body TEXT NOT NULL, key TEXT NOT NULL,
        gate_id TEXT REFERENCES gates(id), created_at TEXT NOT NULL,
        sequence INTEGER NOT NULL REFERENCES events(id), UNIQUE(work_id, key)
      ) STRICT;
      PRAGMA user_version = 1;
      COMMIT;
    `);
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

  work(id: string) {
    const work = this.db.prepare(`SELECT id, project_id AS projectId, status, created_at AS createdAt
      FROM works WHERE id = ?`).get(id);
    if (!work) throw new RuleError('NOT_FOUND', '找不到这项工作。', 404);
    return work;
  }

  message(workId: string, key: string) {
    return this.db.prepare(`SELECT id, work_id AS workId, sender, body, key, gate_id AS gateId,
      created_at AS createdAt, sequence FROM messages WHERE work_id = ? AND key = ?`).get(workId, key);
  }

  conversation(workId: string) {
    this.work(workId);
    return this.db.prepare(`
      SELECT 'message' AS type, id, work_id AS workId, sender, body, gate_id AS gateId,
        NULL AS kind, NULL AS status, NULL AS question, created_at AS createdAt, sequence
      FROM messages WHERE work_id = ?
      UNION ALL
      SELECT 'gate', id, work_id, NULL, NULL, NULL, kind, status, question, created_at, sequence
      FROM gates WHERE work_id = ? ORDER BY sequence
    `).all(workId, workId);
  }

  pending() {
    return this.db.prepare(`SELECT id, work_id AS workId, kind, status, question,
      created_at AS createdAt, sequence FROM gates WHERE status = 'pending' ORDER BY sequence`).all();
  }

  subscribe(listener: (events: HelmEvent[]) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  close() { this.db.close(); }
}
