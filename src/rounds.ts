import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ContextSize, DriverRegistry, DriverSession, EndReason, TokenUsage } from './driver.js';
import { projectPath } from './alignment.js';
import { deliveryDetails } from './delivery.js';
import { cardGraph } from './graph.js';
import { agentEnvironment, type AgentConfig } from './agents.js';
import { RuleError, TaskStore, type Actor, type HelmEvent, type Work, type WorkDescription } from './store.js';
import { noticeStall, pauseWorkFromRuntime } from './work-control.js';
import { cleanupWorktreeProcesses, type ManagedProcess } from './processes.js';
import { projectEnvironmentNames } from './project-environment.js';
import { readPrompt } from './prompts.js';

export interface StartupBrief {
  projectEnvironmentNames: string[];
  work: Work;
  delivery: ReturnType<typeof deliveryDetails>;
  // A resumed session already holds the description and notes; it gets only what changed (ADR 0017).
  resumed?: true;
  phaseRules?: string;
  workDescription?: (WorkDescription & { confirmation: '未确认' | '已确认' }) | null;
  activeWorkDescription?: WorkDescription | null;
  cardGraph: ReturnType<typeof cardGraph>;
  pendingGates: ReturnType<TaskStore['pending']>;
  coordinatorNotes?: string;
  newEvents: HelmEvent[];
  wakeEvents: HelmEvent[];
  recentConversation: ReturnType<TaskStore['conversation']>;
  interruptionNotice?: string;
}

export function startupBrief(store: TaskStore, workId: string, wakeIds: number[], resumedRoundId?: string): StartupBrief {
  const withdrawn = new Set(store.db.prepare('SELECT id FROM messages WHERE work_id = ? AND withdrawn_at IS NOT NULL').all(workId).map(row => String(row.id)));
  const work = store.work(workId);
  const versions = store.descriptions(workId);
  const description = versions.at(-1);
  const lastStart = store.db.prepare(`SELECT MAX(id) AS id FROM events WHERE work_id = ? AND action = 'round-started'`).get(workId)!.id;
  const previous = store.db.prepare('SELECT reason FROM coordinator_rounds WHERE work_id = ? ORDER BY rowid DESC LIMIT 1').get(workId);
  // Agent snapshots carry whole prompts; the coordinator has its own and dispatches keep agentId.
  const brief = (event: HelmEvent) => event.action.startsWith('dispatch-') && event.details && typeof event.details === 'object' && 'agent' in event.details
    ? { ...event, details: { ...event.details, agent: undefined } } : event;
  // Executing rules enter a session once, so the system prompt stays fixed for resume (ADR 0017).
  const resumedStart = resumedRoundId && store.db.prepare(`SELECT details FROM events WHERE action = 'round-started' AND object_id = ?`).get(resumedRoundId);
  const sessionHasExecutingRules = resumedStart && JSON.parse(String(resumedStart.details)).executingRules === true;
  return {
    projectEnvironmentNames: projectEnvironmentNames(store, work.projectId),
    ...(work.activeDescriptionId && !sessionHasExecutingRules ? { phaseRules: readPrompt(store.agents.promptDirectory, 'coordinator-executing') } : {}),
    ...(resumedRoundId ? { resumed: true } : {
      activeWorkDescription: versions.find(item => item.id === work.activeDescriptionId) ?? null,
      workDescription: description ? { ...description, confirmation: description.status === 'draft' ? '未确认' : '已确认' } : null,
      coordinatorNotes: String(store.notes(workId).body),
    }),
    work,
    delivery: deliveryDetails(store, workId),
    cardGraph: cardGraph(store, workId),
    pendingGates: store.gates(workId).filter(gate => gate.status === 'pending'),
    // Executor steps and artifacts can number thousands per round; outcomes arrive as dispatch-ended,
    // details stay readable via get-dispatch-output and get-dispatch-artifacts.
    // Wake events appear only in wakeEvents; a failed round's wakes may predate lastStart.
    newEvents: store.events({ workId, after: Number(lastStart ?? 0) })
      .filter(event => event.action !== 'message-sent' || !withdrawn.has(event.object.id))
      .filter(event => !['dispatch-step', 'round-step', 'artifact-saved', 'round-agent-loaded'].includes(event.action))
      .filter(event => !wakeIds.includes(event.id))
      .filter(event => !resumedRoundId || event.actor.type !== 'coordinator-round' || event.actor.id !== resumedRoundId)
      .filter(event => work.status !== 'paused' || (event.action === 'message-sent' && event.actor.type === 'user'))
      .map(brief),
    wakeEvents: store.events({ workId }).filter(event => wakeIds.includes(event.id)).map(brief),
    recentConversation: store.conversation(workId).slice(-20),
    ...(previous && ['error', 'timed-out', 'context-overflow', 'aborted'].includes(String(previous.reason))
      ? { interruptionNotice: '上一轮中断，期间已做的操作见任务库' } : {}),
  };
}

const runtime = { type: 'runtime', id: 'helmd' } as const;
// ADR 0017: past this size rereading the session each request costs more than a fresh brief.
const resumeContextLimit = 150_000;

export class RoundScheduler {
  private tokens = new Map<string, Actor>();
  private running = new Map<string, Promise<void>>();
  private sessions = new Map<string, DriverSession>();
  private cancellations = new Map<string, (reason?: string) => void>();
  private retryTimers = new Map<string, NodeJS.Timeout>();
  private scheduled = false;
  private stopping = false;
  private unsubscribe: () => void;

  constructor(private store: TaskStore, private drivers: DriverRegistry, private mcpUrl: string,
    private retryDelaysMs: readonly [number, number] = [30_000, 120_000]) {
    this.unsubscribe = store.subscribe(events => {
      const wakes = events.filter(event => (event.action === 'message-sent' && event.actor.type === 'user')
        || ['conflict-resolution-requested', 'gate-decided', 'card-cancelled', 'card-paused', 'card-resumed', 'work-paused', 'work-resumed', 'round-interrupted', 'coordinator-agent-changed', 'gate-withdrawn', 'dispatch-ended', 'card-completed', 'auto-flow-stopped'].includes(event.action));
      if (wakes.length) this.schedule();
    });
    this.schedule();
  }

  authenticate(header: string): Actor {
    const actor = header.startsWith('Bearer ') ? this.tokens.get(header.slice(7)) : undefined;
    if (!actor) throw new RuleError('INVALID_TOKEN', '轮次令牌无效或已失效。', 401);
    return actor;
  }

  private schedule() {
    if (this.stopping || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.stopping) return;
      const works = this.store.db.prepare(`SELECT DISTINCT q.work_id AS id FROM wake_queue q JOIN works w ON w.id = q.work_id JOIN events e ON e.id = q.event_id
        WHERE q.processed_by IS NULL AND (w.status IN ('aligning', 'executing', 'awaiting-review')
          OR (w.status = 'paused' AND e.action = 'message-sent' AND e.actor_type = 'user'
            AND e.id > (SELECT COALESCE(MAX(id), 0) FROM events WHERE work_id = w.id AND action = 'work-paused')))
        AND (w.status IN ('executing', 'paused') OR NOT EXISTS (SELECT 1 FROM gates g WHERE g.work_id = w.id AND g.kind = 'review' AND g.decision = 'accept'))
        AND NOT EXISTS (SELECT 1 FROM coordinator_rounds r WHERE r.work_id = q.work_id AND r.status = 'running')`).all();
      for (const work of works) {
        const workId = String(work.id);
        if (this.running.has(workId)) continue;
        if (this.retryTimers.has(workId)) {
          // Failed rounds keep their wakes queued. Only a user message sent
          // after the latest round claimed its events may bypass backoff.
          const message = this.store.db.prepare(`SELECT 1 FROM wake_queue q JOIN events e ON e.id = q.event_id
            WHERE q.work_id = ? AND q.processed_by IS NULL AND e.action = 'message-sent' AND e.actor_type = 'user'
            AND e.id > (SELECT COALESCE(MAX(id), 0) FROM events
              WHERE work_id = q.work_id AND action = 'round-started') LIMIT 1`).get(workId);
          if (!message) continue;
          clearTimeout(this.retryTimers.get(workId));
          this.retryTimers.delete(workId);
        }
        const promise = this.run(workId).finally(() => { this.running.delete(workId); this.schedule(); });
        this.running.set(workId, promise);
      }
    });
  }

  private async run(workId: string) {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const outputPath = join(this.store.dataDir, 'rounds', `${id}.jsonl`);
    mkdirSync(join(this.store.dataDir, 'rounds'), { recursive: true });
    writeFileSync(outputPath, '');
    const started = this.store.transaction(() => {
      const ids = this.store.db.prepare(`SELECT q.event_id FROM wake_queue q JOIN events e ON e.id = q.event_id JOIN works w ON w.id = q.work_id
        WHERE q.work_id = ? AND q.processed_by IS NULL
        AND (w.status <> 'paused' OR (e.action = 'message-sent' AND e.actor_type = 'user'
          AND e.id > (SELECT COALESCE(MAX(id), 0) FROM events WHERE work_id = w.id AND action = 'work-paused')))
        ORDER BY q.event_id`).all(workId).map(row => Number(row.event_id));
      // Failed, interrupted, compacted or large sessions start fresh; the agent is compared once loaded.
      const previous = this.store.db.prepare(`SELECT id, session_id AS sessionId, agent_snapshot AS agent, context FROM coordinator_rounds
        WHERE work_id = ? ORDER BY rowid DESC LIMIT 1`).get(workId);
      const context = previous?.context ? JSON.parse(String(previous.context)) as ContextSize : undefined;
      const previousCwd = previous ? this.store.db.prepare(`SELECT json_extract(details, '$.cwd') AS cwd FROM events
        WHERE object_type = 'coordinator-round' AND object_id = ? AND action IN ('round-started', 'process-started')
          AND json_extract(details, '$.cwd') IS NOT NULL ORDER BY id DESC LIMIT 1`).get(String(previous.id))?.cwd : undefined;
      const resume = previous?.sessionId && previous.agent && context && context.tokens < Math.min(resumeContextLimit, (context.window ?? Infinity) / 2)
        ? { roundId: String(previous.id), sessionId: String(previous.sessionId), agent: JSON.parse(String(previous.agent)) as AgentConfig, cwd: previousCwd } : undefined;
      const brief = startupBrief(this.store, workId, ids, resume?.roundId);
      this.store.db.prepare(`INSERT INTO coordinator_rounds (id, work_id, status, started_at, event_ids, output_path) VALUES (?, ?, 'running', ?, ?, ?)`)
        .run(id, workId, new Date().toISOString(), JSON.stringify(ids), outputPath);
      this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-started',
        { eventIds: ids, outputPath, cwd: brief.work.workPath ?? projectPath(this.store, workId), executingRules: Boolean(brief.work.activeDescriptionId) }, { workId });
      return { ids, brief, resume };
    });
    const ids = started.ids;
    let { brief, resume } = started;
    this.tokens.set(token, { type: 'coordinator-round', id, workId });
    let reason: EndReason = 'error';
    let usage: TokenUsage = { inputTokens: null, outputTokens: null };
    let context: ContextSize | undefined;
    let compacted = false;
    let finalAnswer: string | undefined;
    let failure: string | undefined;
    let ruleFailure: { code: string; reason: string; details?: Record<string, unknown> } | undefined;
    let accepting = true;
    let stopReason: 'aborted' | 'timed-out' | undefined;
    let abortReason: string | undefined;
    const processes: ManagedProcess[] = [];
    const controller = new AbortController();
    let stopped!: () => void;
    const cancellation = new Promise<void>(resolve => { stopped = resolve; });
    const stop = (reason: 'aborted' | 'timed-out') => {
      if (!accepting || stopReason) return;
      stopReason = reason;
      stopped();
      controller.abort();
      this.sessions.get(workId)?.cancel();
    };
    this.cancellations.set(workId, reason => {
      abortReason = reason;
      // Work cancellation must settle a session still starting before deleting _work.
      // The watchdog remains active if that start never resolves.
      if ((reason === '工作取消' || reason === '审核接受') && !this.sessions.has(workId)) controller.abort();
      else stop('aborted');
    });
    const settings = this.store.db.prepare('SELECT round_total_timeout_ms, round_idle_timeout_ms FROM settings WHERE id = 1').get()!;
    const totalTimer = setTimeout(() => stop('timed-out'), Number(settings.round_total_timeout_ms));
    let idleTimer = setTimeout(() => stop('timed-out'), Number(settings.round_idle_timeout_ms));
    try {
      const result = await Promise.race([consume.call(this), cancellation]);
      if (result) { reason = result.reason; usage = result.usage; finalAnswer = result.finalAnswer; }
    } catch (error) {
      reason = 'error'; finalAnswer = undefined; failure = error instanceof Error ? error.message : String(error);
      if (error instanceof RuleError) ruleFailure = { code: error.code, reason: error.message, details: error.details };
    }
    finally {
      accepting = false;
      controller.abort();
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      this.cancellations.delete(workId);
      // Revocation comes before completion is published or another round can start.
      this.tokens.delete(token);
      this.sessions.get(workId)?.cancel();
      this.sessions.delete(workId);
      if (stopReason || this.stopping || abortReason) { reason = this.stopping || abortReason ? 'aborted' : stopReason!; finalAnswer = undefined; }
      if (this.stopping) abortReason ??= '运行层重启';
      if (brief.work.workPath || processes.length) {
        try {
          const cleaned = await cleanupWorktreeProcesses(brief.work.workPath ?? projectPath(this.store, workId), processes, Boolean(brief.work.workPath));
          if (cleaned.pids.length) this.store.transaction(() => {
            this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-processes-cleaned', cleaned, { workId });
          });
        } catch (error) {
          failure = [failure, error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ');
          if (reason === 'completed') { reason = 'error'; finalAnswer = undefined; }
        }
      }
      if (reason === 'timed-out') failure = [failure, '调度轮次超时终止，可在设置的运行页调整超时。'].filter(Boolean).join('; ');
      let failures = 0;
      this.store.transaction(() => {
        // Only a completed, uncompacted round leaves a session the next round may resume.
        this.store.db.prepare(`UPDATE coordinator_rounds SET status = 'ended', ended_at = ?, reason = ?, usage = ?, context = ? WHERE id = ?`)
          .run(new Date().toISOString(), reason, JSON.stringify(usage), reason === 'completed' && context && !compacted ? JSON.stringify(context) : null, id);
        if (reason === 'completed') {
          const mark = this.store.db.prepare('UPDATE wake_queue SET processed_by = ? WHERE event_id = ?');
          for (const eventId of ids) mark.run(id, eventId);
        }
        this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-ended', { reason, abortReason, usage, finalAnswer, failure,
          ...(ruleFailure ? { error: ruleFailure } : {}), eventIds: ids, processed: reason === 'completed' }, { workId });
        if (reason === 'error' && ruleFailure?.code === 'AGENT_UNAVAILABLE') pauseWorkFromRuntime(this.store, workId, id, `调度者 Agent 不可用：${ruleFailure.reason}`);
        else if (reason === 'completed') {
          this.store.db.prepare('UPDATE works SET consecutive_round_failures = 0 WHERE id = ?').run(workId);
          noticeStall(this.store, workId, id);
        }
        else if (['error', 'timed-out', 'context-overflow'].includes(reason)) {
          const row = this.store.db.prepare(`UPDATE works SET consecutive_round_failures = consecutive_round_failures + 1 WHERE id = ? RETURNING consecutive_round_failures`).get(workId)!;
          failures = Number(row.consecutive_round_failures);
          if (failures >= 3) pauseWorkFromRuntime(this.store, workId, id, '调度者连续失败 3 次');
        } else if (reason === 'quota-exhausted') pauseWorkFromRuntime(this.store, workId, id, '调度者额度用完');
      });
      if (!this.stopping && failures > 0 && failures < 3) {
        const timer = setTimeout(() => {
          this.retryTimers.delete(workId);
          this.schedule();
        }, this.retryDelaysMs[failures - 1]);
        this.retryTimers.set(workId, timer);
      }
    }

    async function consume(this: RoundScheduler) {
      const cwd = brief.work.workPath ?? projectPath(this.store, workId);
      const configuredAgent = await this.store.agents.check(brief.work.coordinatorAgentId, 'coordinator');
      if (!accepting || stopReason || abortReason) return;
      const agent = this.store.agents.snapshot(configuredAgent, join(this.store.dataDir, 'rounds', id));
      const mcpServers = this.store.agents.mcpServers(agent);
      // Model, prompt, rules, skill names or MCP changes need a fresh session.
      // shortcut: edited skill files under unchanged names still resume; compare their contents if that bites.
      const comparable = (snapshot: AgentConfig) => JSON.stringify({ ...snapshot, skillsPath: null });
      if (resume && (resume.cwd !== cwd || comparable(resume.agent) !== comparable(agent))) {
        resume = undefined;
        brief = this.store.transaction(() => startupBrief(this.store, workId, ids));
      }
      this.store.transaction(() => {
        this.store.db.prepare('UPDATE coordinator_rounds SET agent_snapshot = ? WHERE id = ?').run(JSON.stringify(agent), id);
        this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-agent-loaded', { agent, resumed: Boolean(resume) }, { workId });
      });
      const session = await this.drivers[agent.driver]!.start({
        agent,
        cwd,
        env: agentEnvironment(agent),
        dataDir: join(this.store.dataDir, 'rounds', id),
        sandbox: { mode: 'read-only', writableRoots: [] },
        mcpServers: { ...mcpServers, helm: { url: this.mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
        ...(resume ? { resumeSessionId: resume.sessionId } : {}),
        signal: controller.signal,
        onProcess: process => {
          processes.push(process);
          if (!accepting) return;
          this.store.transaction(() => {
            this.store.db.prepare('UPDATE coordinator_rounds SET pgid = ?, process_started_at = ? WHERE id = ?').run(process.pgid, process.startedAt, id);
            this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'process-started',
              { ...process, cwd, role: 'coordinator' }, { workId });
          });
        },
      });
      if (!accepting || stopReason || abortReason) { session.cancel(); return; }
      this.sessions.set(workId, session);
      this.store.transaction(() => { this.store.db.prepare('UPDATE coordinator_rounds SET session_id = ? WHERE id = ?').run(session.id, id); });
      if (this.stopping) { stop('aborted'); return; }
      await session.send(JSON.stringify(brief));
      if (!accepting || stopReason) return;
      let previousStep = 0;
      for await (const event of session.events) {
        if (!accepting || stopReason) return;
        if (!Number.isInteger(event.step) || event.step <= previousStep) throw new Error('Driver step numbers must increase');
        previousStep = event.step;
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => stop('timed-out'), Number(settings.round_idle_timeout_ms));
        appendFileSync(outputPath, `${JSON.stringify({ ...event, time: new Date().toISOString() })}\n`);
        if (event.type !== 'end') this.store.transaction(() => {
          this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-step', { step: event.step }, { workId });
        });
        if (event.type === 'compaction') {
          compacted = true;
          this.store.transaction(() => {
            this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'context-compacted', { step: event.step }, { workId });
          });
        }
        if (event.type === 'end') {
          // Keep reported usage even if closing the iterator stalls or fails.
          usage = event.usage;
          context = event.context;
          return { reason: event.reason, usage: event.usage, finalAnswer: event.reason === 'completed' ? event.finalAnswer : undefined };
        }
      }
    }
  }

  async cancel(workId: string, reason: '用户打断' | '工作取消' | '审核接受' | '结束（不合入）') {
    const running = this.running.get(workId);
    if (running) {
      this.cancellations.get(workId)?.(reason);
      for (const [token, actor] of this.tokens) if (actor.workId === workId) this.tokens.delete(token);
      this.sessions.get(workId)?.cancel();
      await running;
    }
    if (reason === '用户打断') this.schedule();
  }

  async close() {
    this.stopping = true;
    this.unsubscribe();
    for (const timer of this.retryTimers.values()) clearTimeout(timer);
    this.retryTimers.clear();
    for (const cancel of this.cancellations.values()) cancel();
    await Promise.all(this.running.values());
    this.tokens.clear();
  }
}
