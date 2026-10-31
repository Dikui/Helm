// Append new migrations at the end; list position is the persisted schema version.
// Never reorder or edit a migration that has already shipped.
export const migrations: readonly string[] = [
  `
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
  `,
  `
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
  `,
  `
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
  `,
  `
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
  `,
  `
  ALTER TABLE cards ADD COLUMN repair_of_card_id TEXT REFERENCES cards(id);
  `,
  `
  ALTER TABLE dispatches ADD COLUMN needs_browser INTEGER NOT NULL DEFAULT 0 CHECK(needs_browser IN (0, 1));
  ALTER TABLE dispatches ADD COLUMN browser_pgid INTEGER;
  ALTER TABLE dispatches ADD COLUMN browser_started_at TEXT;
  `,
  `
  ALTER TABLE dispatches ADD COLUMN port_start INTEGER;
  ALTER TABLE dispatches ADD COLUMN port_end INTEGER;
  ALTER TABLE dispatches ADD COLUMN pgid INTEGER;
  ALTER TABLE dispatches ADD COLUMN process_started_at TEXT;
  ALTER TABLE coordinator_rounds ADD COLUMN pgid INTEGER;
  ALTER TABLE coordinator_rounds ADD COLUMN process_started_at TEXT;
  ALTER TABLE settings ADD COLUMN dispatch_wall_timeout_ms INTEGER NOT NULL DEFAULT 1800000 CHECK(dispatch_wall_timeout_ms > 0);
  ALTER TABLE settings ADD COLUMN dispatch_idle_timeout_ms INTEGER NOT NULL DEFAULT 600000 CHECK(dispatch_idle_timeout_ms > 0);
  `,
  `
  ALTER TABLE works ADD COLUMN runtime_pause_reason TEXT;
  ALTER TABLE works ADD COLUMN paused_from_status TEXT;
  ALTER TABLE works ADD COLUMN consecutive_round_failures INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE settings ADD COLUMN round_total_timeout_ms INTEGER NOT NULL DEFAULT 1800000;
  ALTER TABLE settings ADD COLUMN round_idle_timeout_ms INTEGER NOT NULL DEFAULT 600000;
  `,
  `
  ALTER TABLE dispatches ADD COLUMN card_content_snapshot TEXT;
  ALTER TABLE dispatches ADD COLUMN work_description_id TEXT REFERENCES work_descriptions(id);
  ALTER TABLE dispatches ADD COLUMN work_description_version INTEGER;
  `,
  `
  ALTER TABLE gates ADD COLUMN comment TEXT;
  `,
  `
  ALTER TABLE settings ADD COLUMN output_threshold_bytes INTEGER NOT NULL DEFAULT 10000000000 CHECK(output_threshold_bytes >= 0);
  ALTER TABLE settings ADD COLUMN output_total_bytes INTEGER NOT NULL DEFAULT 0 CHECK(output_total_bytes >= 0);
  ALTER TABLE settings ADD COLUMN output_threshold_exceeded INTEGER NOT NULL DEFAULT 0 CHECK(output_threshold_exceeded IN (0, 1));
  `,
  `
  CREATE TEMP TABLE card_template_ids AS SELECT id, template_id FROM cards;
  ALTER TABLE cards DROP COLUMN template_id;
  ALTER TABLE cards ADD COLUMN template_id TEXT;
  UPDATE cards SET template_id = (SELECT template_id FROM card_template_ids WHERE id = cards.id);
  DROP TABLE card_template_ids;
  CREATE TEMP TABLE dispatch_template_ids AS SELECT id, template_id FROM dispatches;
  ALTER TABLE dispatches DROP COLUMN template_id;
  ALTER TABLE dispatches ADD COLUMN template_id TEXT NOT NULL DEFAULT '';
  UPDATE dispatches SET template_id = (SELECT template_id FROM dispatch_template_ids WHERE id = dispatches.id);
  DROP TABLE dispatch_template_ids;
  DROP TABLE agent_templates;
  ALTER TABLE coordinator_rounds ADD COLUMN template_snapshot TEXT;
  `,
  `
  ALTER TABLE works ADD COLUMN outputs_exported_at TEXT;
  ALTER TABLE works ADD COLUMN outputs_deleted_at TEXT;
  `,
  `
  ALTER TABLE projects ADD COLUMN default_coordinator_template_id TEXT NOT NULL DEFAULT 'claude-coordinator';
  ALTER TABLE works ADD COLUMN coordinator_template_id TEXT NOT NULL DEFAULT 'claude-coordinator';
  `,
  `
  ALTER TABLE dispatches ADD COLUMN sqlite_path TEXT;
  `,
  `
  ALTER TABLE messages ADD COLUMN card_id TEXT REFERENCES cards(id);
  `,
  `
  ALTER TABLE cards RENAME COLUMN template_id TO agent_id;
  ALTER TABLE dispatches RENAME COLUMN template_id TO agent_id;
  ALTER TABLE dispatches RENAME COLUMN template_snapshot TO agent_snapshot;
  ALTER TABLE coordinator_rounds RENAME COLUMN template_snapshot TO agent_snapshot;
  ALTER TABLE projects RENAME COLUMN default_coordinator_template_id TO default_coordinator_agent_id;
  ALTER TABLE works RENAME COLUMN coordinator_template_id TO coordinator_agent_id;
  UPDATE dispatches SET agent_snapshot = replace(agent_snapshot, '"home":"template"', '"home":"dedicated"');
  UPDATE coordinator_rounds SET agent_snapshot = replace(agent_snapshot, '"home":"template"', '"home":"dedicated"') WHERE agent_snapshot IS NOT NULL;
  UPDATE events SET object_type = 'agent' WHERE object_type = 'agent-template';
  UPDATE events SET action = CASE action
    WHEN 'round-template-loaded' THEN 'round-agent-loaded'
    WHEN 'coordinator-template-changed' THEN 'coordinator-agent-changed'
    WHEN 'project-coordinator-template-set' THEN 'project-coordinator-agent-set'
    WHEN 'template-availability-changed' THEN 'agent-availability-changed'
    WHEN 'agent-template-saved' THEN 'agent-saved'
    WHEN 'agent-template-deleted' THEN 'agent-deleted'
    ELSE action END;
  UPDATE events SET details = replace(replace(replace(replace(replace(replace(details,
    '"templateId":', '"agentId":'), '"previousTemplateId":', '"previousAgentId":'), '"coordinatorTemplateId":', '"coordinatorAgentId":'),
    '"template":', '"agent":'), '"kind":"template-unavailable"', '"kind":"agent-unavailable"'), '"home":"template"', '"home":"dedicated"');
  `,
  `
  DROP INDEX one_active_dispatch_per_card;
  CREATE UNIQUE INDEX one_active_execution_per_card ON dispatches(card_id) WHERE status IN ('queued', 'running') AND purpose = 'execution';
  `,  `
  ALTER TABLE messages ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE messages ADD COLUMN withdrawn_at TEXT;
  `,
  `
  ALTER TABLE cards ADD COLUMN write_scopes TEXT NOT NULL DEFAULT '[]';
  `,
  `
  ALTER TABLE gates ADD COLUMN report TEXT;
  `,
  `
  CREATE TABLE project_environment (
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL, value TEXT NOT NULL,
    PRIMARY KEY (project_id, name)
  ) STRICT;
  `,
  `
  -- Merge is terminal; an interrupted legacy push is optional and retryable.
  INSERT INTO events (time, actor_type, actor_id, object_type, object_id, action, details, work_id)
    SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'runtime', 'helmd', 'work', w.id, 'base-push-result',
      json_object('status', 'failed', 'reason', '运行层重启，推送已中断，可重试。',
        'baseBranch', COALESCE((SELECT json_extract(e.details, '$.baseBranch') FROM events e
          WHERE e.work_id = w.id AND e.action = 'base-merge-result' ORDER BY e.id DESC LIMIT 1), w.base_ref)), w.id
    FROM works w WHERE w.status = 'pushing';
  INSERT INTO events (time, actor_type, actor_id, object_type, object_id, action, details, work_id)
    SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'runtime', 'helmd', 'work', w.id, 'work-completed',
      json_object('migratedFrom', w.status,
        'gateId', (SELECT g.id FROM gates g WHERE g.work_id = w.id AND g.kind = 'review' AND g.decision = 'accept' ORDER BY g.sequence DESC LIMIT 1),
        'merge', json((SELECT e.details FROM events e WHERE e.work_id = w.id AND e.action = 'base-merge-result' ORDER BY e.id DESC LIMIT 1))), w.id
    FROM works w WHERE w.status IN ('merged', 'pushing')
      AND NOT EXISTS (SELECT 1 FROM events e WHERE e.work_id = w.id AND e.action = 'work-completed');
  UPDATE works SET status = 'completed', paused_from_status = NULL, runtime_pause_reason = NULL
    WHERE status IN ('merged', 'pushing');
  `,
  `
  ALTER TABLE cards ADD COLUMN aggregate INTEGER NOT NULL DEFAULT 0 CHECK(aggregate IN (0, 1));
  `,
  `
  ALTER TABLE coordinator_rounds ADD COLUMN context TEXT;
  `,
  `
  ALTER TABLE cards ADD COLUMN read_only INTEGER NOT NULL DEFAULT 0 CHECK(read_only IN (0, 1));
  `,
  `
  ALTER TABLE work_descriptions RENAME COLUMN base_ref TO legacy_base_ref;
  ALTER TABLE work_descriptions RENAME COLUMN base_commit TO legacy_base_commit;
  ALTER TABLE work_descriptions ADD COLUMN base_ref TEXT;
  ALTER TABLE work_descriptions ADD COLUMN base_commit TEXT;
  UPDATE work_descriptions SET base_ref = legacy_base_ref, base_commit = legacy_base_commit;
  ALTER TABLE work_descriptions DROP COLUMN legacy_base_ref;
  ALTER TABLE work_descriptions DROP COLUMN legacy_base_commit;
  `,
  `
  ALTER TABLE gates ADD COLUMN git_initialization TEXT;
  CREATE UNIQUE INDEX one_pending_git_initialization ON gates(json_extract(git_initialization, '$.projectId'))
    WHERE kind = 'git-initialization' AND status = 'pending';
  `,
  `
  ALTER TABLE gates ADD COLUMN multi_select INTEGER NOT NULL DEFAULT 0 CHECK(multi_select IN (0, 1));
  `,
  `
  ALTER TABLE cards ADD COLUMN auto_flow TEXT;
  `,
];
