import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

export type ActorType = 'user' | 'coordinator-round' | 'dispatch' | 'runtime';
export interface Actor { type: ActorType; id: string; workId?: string }
export interface Work {
  id: string; projectId: string; status: string; createdAt: string;
  baseRef: string | null; baseCommit: string | null; workBranch: string | null;
  workPath: string | null; activeDescriptionId: string | null;
}
export interface WorkDescription {
  id: string; workId: string; version: number; status: string; key: string;
  requirements: string; boundary: string; criteria: string; gateId: string;
  baseRef: string; baseCommit: string;
}
export interface Gate {
  id: string; workId: string; kind: string; status: string; key: string | null;
  question: string; body: string; options: string[]; creator: Actor;
  createdAt: string; sequence: number; descriptionId: string | null;
  decision: string | null; withdrawalReason: string | null;
}

const gateColumns = `id, work_id AS workId, kind, status, key, question, body, options,
  creator_type AS creatorType, creator_id AS creatorId, created_at AS createdAt, sequence,
  description_id AS descriptionId, decision, withdrawal_reason AS withdrawalReason`;

function readGate(row: Record<string, unknown>): Gate {
  const { creatorType, creatorId, options, ...fields } = row;
  return { ...fields, options: JSON.parse(String(options)), creator: { type: creatorType, id: creatorId } } as Gate;
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
  constructor(public code: string, reason: string, public status = 409) { super(reason); }
}

export class TaskStore {
  readonly db: DatabaseSync;
  private pendingEvents: HelmEvent[] = [];
  private listeners = new Set<(events: HelmEvent[]) => void>();

  constructor(readonly dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.dataDir = realpathSync(dataDir);
    this.db = new DatabaseSync(join(this.dataDir, 'helm.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const version = this.db.prepare('PRAGMA user_version').get()!.user_version;
    if (![0, 1, 2, 3, 4, 5, 6, 7].includes(Number(version))) {
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
    if (version === 0 || version === 1) this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE works ADD COLUMN base_ref TEXT;
      ALTER TABLE works ADD COLUMN base_commit TEXT;
      ALTER TABLE works ADD COLUMN work_branch TEXT;
      ALTER TABLE works ADD COLUMN work_path TEXT;
      ALTER TABLE works ADD COLUMN active_description_id TEXT;
      ALTER TABLE gates ADD COLUMN description_id TEXT;
      ALTER TABLE gates ADD COLUMN decision TEXT;
      CREATE TABLE work_descriptions (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), version INTEGER NOT NULL,
        status TEXT NOT NULL, key TEXT NOT NULL, requirements TEXT NOT NULL, boundary TEXT NOT NULL,
        criteria TEXT NOT NULL, gate_id TEXT NOT NULL REFERENCES gates(id), base_ref TEXT NOT NULL, base_commit TEXT NOT NULL,
        UNIQUE(work_id, key), UNIQUE(work_id, version)
      ) STRICT;
      CREATE TABLE coordinator_notes (
        work_id TEXT PRIMARY KEY REFERENCES works(id), body TEXT NOT NULL, version INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE coordinator_rounds (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), status TEXT NOT NULL,
        session_id TEXT, started_at TEXT NOT NULL, ended_at TEXT, reason TEXT,
        event_ids TEXT NOT NULL, output_path TEXT NOT NULL, usage TEXT
      ) STRICT;
      CREATE UNIQUE INDEX one_running_round ON coordinator_rounds(work_id) WHERE status = 'running';
      CREATE TABLE wake_queue (
        event_id INTEGER PRIMARY KEY REFERENCES events(id), work_id TEXT NOT NULL REFERENCES works(id),
        processed_by TEXT REFERENCES coordinator_rounds(id)
      ) STRICT;
      CREATE INDEX wake_queue_work ON wake_queue(work_id, event_id) WHERE processed_by IS NULL;
      PRAGMA user_version = 2;
      COMMIT;
    `);
    if (Number(version) < 3) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE cards (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), key TEXT NOT NULL,
        content TEXT NOT NULL, needs_verification INTEGER NOT NULL CHECK(needs_verification IN (0, 1)),
        status TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(work_id, key)
      ) STRICT;
      ALTER TABLE gates ADD COLUMN key TEXT;
      ALTER TABLE gates ADD COLUMN body TEXT NOT NULL DEFAULT '';
      ALTER TABLE gates ADD COLUMN options TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE gates ADD COLUMN creator_type TEXT NOT NULL DEFAULT 'runtime';
      ALTER TABLE gates ADD COLUMN creator_id TEXT NOT NULL DEFAULT 'helmd';
      ALTER TABLE gates ADD COLUMN withdrawal_reason TEXT;
      UPDATE gates SET creator_type = (SELECT actor_type FROM events WHERE id = gates.sequence),
        creator_id = (SELECT actor_id FROM events WHERE id = gates.sequence);
      CREATE UNIQUE INDEX gates_key ON gates(work_id, key) WHERE key IS NOT NULL;
      CREATE TABLE dependencies (
        work_id TEXT NOT NULL REFERENCES works(id),
        upstream_type TEXT NOT NULL CHECK(upstream_type IN ('card', 'gate')), upstream_id TEXT NOT NULL,
        downstream_type TEXT NOT NULL CHECK(downstream_type IN ('card', 'gate')), downstream_id TEXT NOT NULL,
        PRIMARY KEY(work_id, upstream_type, upstream_id, downstream_type, downstream_id)
      ) STRICT;
      PRAGMA user_version = 3;
      COMMIT;
    `);
    if (Number(version) < 4) this.db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE agent_templates (
        id TEXT PRIMARY KEY, role TEXT NOT NULL, model TEXT, reasoning_effort TEXT
      ) STRICT;
      INSERT INTO agent_templates VALUES ('claude-coordinator', 'coordinator', NULL, NULL), ('claude-executor', 'executor', NULL, NULL);
      ALTER TABLE cards ADD COLUMN work_path TEXT;
      ALTER TABLE cards ADD COLUMN card_branch TEXT;
      ALTER TABLE cards ADD COLUMN template_id TEXT REFERENCES agent_templates(id);
      ALTER TABLE cards ADD COLUMN latest_dispatch_id TEXT;
      ALTER TABLE cards ADD COLUMN current_step INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE cards ADD COLUMN latest_step_summary TEXT;
      CREATE TABLE dispatches (
        id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id), card_id TEXT NOT NULL REFERENCES cards(id),
        key TEXT NOT NULL, purpose TEXT NOT NULL, template_id TEXT NOT NULL REFERENCES agent_templates(id),
        template_snapshot TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL,
        resume_session_id TEXT, session_id TEXT, created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT,
        start_commit TEXT, end_commit TEXT, output_path TEXT NOT NULL,
        end_reason TEXT, abort_reason TEXT, final_answer TEXT, conclusion TEXT NOT NULL DEFAULT 'undeclared',
        conclusion_reason TEXT, usage TEXT NOT NULL DEFAULT '{"inputTokens":0,"outputTokens":0}', failure TEXT,
        UNIQUE(work_id, key)
      ) STRICT;
      CREATE UNIQUE INDEX one_active_dispatch_per_card ON dispatches(card_id) WHERE status IN ('queued', 'running');
      CREATE UNIQUE INDEX one_active_dispatch_per_session ON dispatches(session_id) WHERE status IN ('queued', 'running') AND session_id IS NOT NULL;
      CREATE TABLE artifacts (
        id TEXT PRIMARY KEY, dispatch_id TEXT NOT NULL REFERENCES dispatches(id),
        kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT, ref TEXT, commit_sha TEXT
      ) STRICT;
      CREATE INDEX artifacts_dispatch ON artifacts(dispatch_id);
      PRAGMA user_version = 4;
      COMMIT;
    `);
    if (Number(version) < 5) this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE cards ADD COLUMN repair_of_card_id TEXT REFERENCES cards(id);
      PRAGMA user_version = 5;
      COMMIT;
    `);
    if (Number(version) < 6) this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE dispatches ADD COLUMN needs_browser INTEGER NOT NULL DEFAULT 0 CHECK(needs_browser IN (0, 1));
      ALTER TABLE dispatches ADD COLUMN browser_pgid INTEGER;
      ALTER TABLE dispatches ADD COLUMN browser_started_at TEXT;
      PRAGMA user_version = 6;
      COMMIT;
    `);
    if (Number(version) < 7) this.db.exec(`
      BEGIN IMMEDIATE;
      ALTER TABLE dispatches ADD COLUMN port_start INTEGER;
      ALTER TABLE dispatches ADD COLUMN port_end INTEGER;
      ALTER TABLE dispatches ADD COLUMN pgid INTEGER;
      ALTER TABLE dispatches ADD COLUMN process_started_at TEXT;
      ALTER TABLE coordinator_rounds ADD COLUMN pgid INTEGER;
      ALTER TABLE coordinator_rounds ADD COLUMN process_started_at TEXT;
      ALTER TABLE settings ADD COLUMN dispatch_wall_timeout_ms INTEGER NOT NULL DEFAULT 1800000 CHECK(dispatch_wall_timeout_ms > 0);
      ALTER TABLE settings ADD COLUMN dispatch_idle_timeout_ms INTEGER NOT NULL DEFAULT 600000 CHECK(dispatch_idle_timeout_ms > 0);
      PRAGMA user_version = 7;
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

  work(id: string): Work {
    const work = this.db.prepare(`SELECT id, project_id AS projectId, status, created_at AS createdAt,
      base_ref AS baseRef, base_commit AS baseCommit, work_branch AS workBranch,
      work_path AS workPath, active_description_id AS activeDescriptionId FROM works WHERE id = ?`).get(id);
    if (!work) throw new RuleError('NOT_FOUND', '找不到这项工作。', 404);
    return work as unknown as Work;
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
    return this.db.prepare(`SELECT id, work_id AS workId, sender, body, key, gate_id AS gateId,
      created_at AS createdAt, sequence FROM messages WHERE work_id = ? AND key = ?`).get(workId, key);
  }

  conversation(workId: string) {
    this.work(workId);
    return this.db.prepare(`
      SELECT 'message' AS type, id, work_id AS workId, sender, body, gate_id AS gateId,
        NULL AS kind, NULL AS status, NULL AS question, created_at AS createdAt, sequence,
        NULL AS descriptionId, NULL AS decision
      FROM messages WHERE work_id = ?
      UNION ALL
      SELECT 'gate', id, work_id, NULL, NULL, NULL, kind, status, question, created_at, sequence, description_id, decision
      FROM gates WHERE work_id = ? ORDER BY sequence
    `).all(workId, workId).map(item => item.type === 'gate' ? { ...item, ...this.gate(workId, String(item.id)) } : item);
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
