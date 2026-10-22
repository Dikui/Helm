import { randomBytes, randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Driver, DriverSession, EndReason, TokenUsage } from './driver.js';
import { projectPath } from './alignment.js';
import { cardGraph } from './graph.js';
import { agentTemplate, templateEnvironment } from './templates.js';
import { RuleError, TaskStore, type Actor, type HelmEvent, type Work, type WorkDescription } from './store.js';

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
}

export function startupBrief(store: TaskStore, workId: string, wakeIds: number[]): StartupBrief {
  const work = store.work(workId);
  const versions = store.descriptions(workId);
  const description = versions.at(-1);
  const lastStart = store.db.prepare(`SELECT MAX(id) AS id FROM events WHERE work_id = ? AND action = 'round-started'`).get(workId)!.id;
  return {
    work,
    workDescription: description ? { ...description, confirmation: description.status === 'draft' ? '未确认' : '已确认' } : null,
    activeWorkDescription: versions.find(item => item.id === work.activeDescriptionId) ?? null,
    cardGraph: cardGraph(store, workId),
    pendingGates: store.pending().filter(gate => gate.workId === workId),
    coordinatorNotes: String(store.notes(workId).body),
    newEvents: store.events({ workId, after: Number(lastStart ?? 0) }),
    wakeEvents: store.events({ workId }).filter(event => wakeIds.includes(event.id)),
    recentConversation: store.conversation(workId).slice(-20),
  };
}

const runtime = { type: 'runtime', id: 'helmd' } as const;

export class RoundScheduler {
  private tokens = new Map<string, Actor>();
  private running = new Map<string, Promise<void>>();
  private sessions = new Map<string, DriverSession>();
  private failed = new Set<string>();
  private scheduled = false;
  private stopping = false;
  private unsubscribe: () => void;

  constructor(private store: TaskStore, private driver: Driver, private mcpUrl: string) {
    this.unsubscribe = store.subscribe(events => {
      const wakes = events.filter(event => (event.action === 'message-sent' && event.actor.type === 'user')
        || ['gate-decided', 'card-ready', 'card-cancelled', 'gate-withdrawn', 'dispatch-ended'].includes(event.action));
      for (const event of wakes) if (event.workId) this.failed.delete(event.workId);
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
      const works = this.store.db.prepare(`SELECT DISTINCT q.work_id AS id FROM wake_queue q JOIN works w ON w.id = q.work_id
        WHERE q.processed_by IS NULL AND w.status IN ('aligning', 'executing')
        AND NOT EXISTS (SELECT 1 FROM coordinator_rounds r WHERE r.work_id = q.work_id AND r.status = 'running')`).all();
      for (const work of works) {
        const workId = String(work.id);
        if (this.running.has(workId) || this.failed.has(workId)) continue;
        const promise = this.run(workId).finally(() => { this.running.delete(workId); });
        this.running.set(workId, promise);
      }
    });
  }

  private async run(workId: string) {
    const id = randomUUID();
    const token = randomBytes(32).toString('hex');
    const ids = this.store.db.prepare('SELECT event_id FROM wake_queue WHERE work_id = ? AND processed_by IS NULL ORDER BY event_id').all(workId).map(row => Number(row.event_id));
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
    try {
      const template = agentTemplate(this.store, 'claude-coordinator', 'coordinator');
      const session = await this.driver.start({
        template,
        cwd: brief.work.workPath ?? projectPath(this.store, workId),
        env: templateEnvironment(template),
        sandbox: { mode: 'read-only', writableRoots: [] },
        mcpServers: { helm: { url: this.mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
      });
      this.sessions.set(workId, session);
      this.store.transaction(() => { this.store.db.prepare('UPDATE coordinator_rounds SET session_id = ? WHERE id = ?').run(session.id, id); });
      if (this.stopping) session.cancel();
      await session.send(JSON.stringify(brief));
      let previousStep = 0;
      for await (const event of session.events) {
        if (!Number.isInteger(event.step) || event.step <= previousStep) throw new Error('Driver step numbers must increase');
        previousStep = event.step;
        appendFileSync(outputPath, `${JSON.stringify(event)}\n`);
        if (event.type === 'end') {
          reason = event.reason;
          usage = event.usage;
          if (reason === 'completed') finalAnswer = event.finalAnswer;
          break;
        }
      }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    finally {
      // Revocation comes before completion is published or another round can start.
      this.tokens.delete(token);
      this.sessions.delete(workId);
      if (this.stopping) { reason = 'aborted'; finalAnswer = undefined; }
      if (reason !== 'completed') this.failed.add(workId);
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE coordinator_rounds SET status = 'ended', ended_at = ?, reason = ?, usage = ? WHERE id = ?`)
          .run(new Date().toISOString(), reason, JSON.stringify(usage), id);
        if (reason === 'completed') {
          const mark = this.store.db.prepare('UPDATE wake_queue SET processed_by = ? WHERE event_id = ?');
          for (const eventId of ids) mark.run(id, eventId);
        }
        this.store.appendEvent(runtime, { type: 'coordinator-round', id }, 'round-ended', { reason, usage, finalAnswer, failure, eventIds: ids, processed: reason === 'completed' }, { workId });
      });
      if (reason === 'completed') this.schedule();
    }
  }

  async close() {
    this.stopping = true;
    this.unsubscribe();
    for (const session of this.sessions.values()) session.cancel();
    await Promise.all(this.running.values());
    this.tokens.clear();
  }
}
