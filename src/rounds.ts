import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DriverRegistry, DriverSession, EndReason, TokenUsage } from './driver.js';
import { projectPath } from './alignment.js';
import { cardGraph } from './graph.js';
import { templateEnvironment } from './templates.js';
import { RuleError, TaskStore, type Actor, type HelmEvent, type Work, type WorkDescription } from './store.js';
import { pauseWorkFromRuntime } from './work-control.js';
import { cleanupWorktreeProcesses, type ManagedProcess } from './processes.js';

export interface StartupBrief {
  work: Work;
  workDescription: (WorkDescription & { confirmation: '未确认' | '已确认' }) | null;
  activeWorkDescription: WorkDescription | null;
  cardGraph: ReturnType<typeof cardGraph>;
  pendingGates: ReturnType<TaskStore['pending']>;
  coordinatorNotes: string;
  newEvents: HelmEvent[];
  wakeEvents: HelmEvent[];
  recentConversation: ReturnType<TaskStore['conversation']>;
  interruptionNotice?: string;
}

export function startupBrief(store: TaskStore, workId: string, wakeIds: number[]): StartupBrief {
  const work = store.work(workId);
  const versions = store.descriptions(workId);
  const description = versions.at(-1);
  const lastStart = store.db.prepare(`SELECT MAX(id) AS id FROM events WHERE work_id = ? AND action = 'round-started'`).get(workId)!.id;
  const previous = store.db.prepare('SELECT reason FROM coordinator_rounds WHERE work_id = ? ORDER BY rowid DESC LIMIT 1').get(workId);
  return {
    work,
    workDescription: description ? { ...description, confirmation: description.status === 'draft' ? '未确认' : '已确认' } : null,
    activeWorkDescription: versions.find(item => item.id === work.activeDescriptionId) ?? null,
    cardGraph: cardGraph(store, workId),
    pendingGates: store.pending().filter(gate => gate.workId === workId),
    coordinatorNotes: String(store.notes(workId).body),
    // Executor steps can number thousands per round; outcomes arrive as dispatch-ended, steps stay readable via get-dispatch-output.
    newEvents: store.events({ workId, after: Number(lastStart ?? 0) })
      .filter(event => event.action !== 'dispatch-step')
      .filter(event => work.status !== 'paused' || (event.action === 'message-sent' && event.actor.type === 'user')),
    wakeEvents: store.events({ workId }).filter(event => wakeIds.includes(event.id)),
    recentConversation: store.conversation(workId).slice(-20),
    ...(previous && ['error', 'timed-out', 'context-overflow', 'aborted'].includes(String(previous.reason))
      ? { interruptionNotice: '上一轮中断，期间已做的操作见任务库' } : {}),
  };
}

const runtime = { type: 'runtime', id: 'helmd' } as const;

export class RoundScheduler {
  private tokens = new Map<string, Actor>();
  private running = new Map<string, Promise<void>>();
  private sessions = new Map<string, DriverSession>();
  private cancellations = new Map<string, (reason?: string) => void>();
  private scheduled = false;
  private stopping = false;
  private unsubscribe: () => void;

  constructor(private store: TaskStore, private drivers: DriverRegistry, private mcpUrl: string) {
    this.unsubscribe = store.subscribe(events => {
      const wakes = events.filter(event => (event.action === 'message-sent' && event.actor.type === 'user')
        || ['gate-decided', 'card-ready', 'card-cancelled', 'card-paused', 'card-resumed', 'work-paused', 'work-resumed', 'round-interrupted', 'coordinator-template-changed', 'gate-withdrawn', 'dispatch-ended'].includes(event.action));
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
        AND NOT EXISTS (SELECT 1 FROM gates g WHERE g.work_id = w.id AND g.kind = 'review' AND g.decision = 'accept')
        AND NOT EXISTS (SELECT 1 FROM coordinator_rounds r WHERE r.work_id = q.work_id AND r.status = 'running')`).all();
      for (const work of works) {
        const workId = String(work.id);
        if (this.running.has(workId)) continue;
        const promise = this.run(workId).finally(() => { this.running.delete(workId); this.schedule(); });
        this.running.set(workId, promise);
      }
    });
  }

  private async run(workId: string) {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const ids = this.store.db.prepare(`SELECT q.event_id FROM wake_queue q JOIN events e ON e.id = q.event_id JOIN works w ON w.id = q.work_id
      WHERE q.work_id = ? AND q.processed_by IS NULL
      AND (w.status <> 'paused' OR (e.action = 'message-sent' AND e.actor_type = 'user'
        AND e.id > (SELECT COALESCE(MAX(id), 0) FROM events WHERE work_id = w.id AND action = 'work-paused')))
      ORDER BY q.event_id`).all(workId).map(row => Number(row.event_id));
    const brief = startupBrief(this.store, workId, ids);
    const outputPath = join(this.store.dataDir, 'rounds', `${id}.jsonl`);
    mkdirSync(join(this.store.dataDir, 'rounds'), { recursive: true });
    writeFileSync(outputPath, '');
    this.store.transaction(() => {
      this.store.db.prepare(`INSERT INTO coordinator_rounds (id, work_id, status, started_at, event_ids, output_path) VALUES (?, ?, 'running', ?, ?, ?)`)
        .run(id, workId, new Date().toISOString(), JSON.stringify(ids), outputPath);
      this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-started', { eventIds: ids, outputPath }, { workId });
    });
    this.tokens.set(token, { type: 'coordinator-round', id, workId });
    let reason: EndReason = 'error';
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
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
      if (brief.work.workPath) {
        try {
          const cleaned = await cleanupWorktreeProcesses(brief.work.workPath, processes);
          if (cleaned.pids.length) this.store.transaction(() => {
            this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-processes-cleaned', cleaned, { workId });
          });
        } catch (error) {
          failure = [failure, error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ');
          if (reason === 'completed') { reason = 'error'; finalAnswer = undefined; }
        }
      }
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE coordinator_rounds SET status = 'ended', ended_at = ?, reason = ?, usage = ? WHERE id = ?`)
          .run(new Date().toISOString(), reason, JSON.stringify(usage), id);
        if (reason === 'completed') {
          const mark = this.store.db.prepare('UPDATE wake_queue SET processed_by = ? WHERE event_id = ?');
          for (const eventId of ids) mark.run(id, eventId);
        }
        this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-ended', { reason, abortReason, usage, finalAnswer, failure,
          ...(ruleFailure ? { error: ruleFailure } : {}), eventIds: ids, processed: reason === 'completed' }, { workId });
        if (reason === 'error' && ruleFailure?.code === 'TEMPLATE_UNAVAILABLE') pauseWorkFromRuntime(this.store, workId, id, `调度者模板不可用：${ruleFailure.reason}`);
        else if (reason === 'completed') this.store.db.prepare('UPDATE works SET consecutive_round_failures = 0 WHERE id = ?').run(workId);
        else if (['error', 'timed-out', 'context-overflow'].includes(reason)) {
          const row = this.store.db.prepare(`UPDATE works SET consecutive_round_failures = consecutive_round_failures + 1 WHERE id = ? RETURNING consecutive_round_failures`).get(workId)!;
          if (Number(row.consecutive_round_failures) >= 3) pauseWorkFromRuntime(this.store, workId, id, '调度者连续失败 3 次');
        } else if (reason === 'quota-exhausted') pauseWorkFromRuntime(this.store, workId, id, '调度者额度用完');
      });
    }

    async function consume(this: RoundScheduler) {
      const template = await this.store.templates.check(brief.work.coordinatorTemplateId, 'coordinator');
      if (!accepting || stopReason || abortReason) return;
      this.store.transaction(() => {
        this.store.db.prepare('UPDATE coordinator_rounds SET template_snapshot = ? WHERE id = ?').run(JSON.stringify(template), id);
        this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-template-loaded', { template }, { workId });
      });
      const session = await this.drivers[template.driver]!.start({
        template,
        cwd: brief.work.workPath ?? projectPath(this.store, workId),
        env: templateEnvironment(template),
        dataDir: join(this.store.dataDir, 'rounds', id),
        sandbox: { mode: 'read-only', writableRoots: [] },
        mcpServers: { helm: { url: this.mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
        signal: controller.signal,
        onProcess: process => {
          processes.push(process);
          if (!accepting) return;
          this.store.transaction(() => {
            this.store.db.prepare('UPDATE coordinator_rounds SET pgid = ?, process_started_at = ? WHERE id = ?').run(process.pgid, process.startedAt, id);
            this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'process-started',
              { ...process, cwd: brief.work.workPath ?? projectPath(this.store, workId), role: 'coordinator' }, { workId });
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
        appendFileSync(outputPath, `${JSON.stringify(event)}\n`);
        if (event.type === 'compaction') this.store.transaction(() => {
          this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'context-compacted', { step: event.step }, { workId });
        });
        if (event.type === 'end') {
          // Keep reported usage even if closing the iterator stalls or fails.
          usage = event.usage;
          return { reason: event.reason, usage: event.usage, finalAnswer: event.reason === 'completed' ? event.finalAnswer : undefined };
        }
      }
    }
  }

  async cancel(workId: string, reason: '用户打断' | '工作取消' | '审核接受') {
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
    for (const cancel of this.cancellations.values()) cancel();
    await Promise.all(this.running.values());
    this.tokens.clear();
  }
}
