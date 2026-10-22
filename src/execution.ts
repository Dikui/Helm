import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Driver, DriverEvent, DriverSession, EndReason, TokenUsage } from './driver.js';
import { activeDispatch, committedFile, dispatchGit, getDispatch, reportedArtifact, saveArtifact, type Dispatch } from './dispatch.js';
import { cardDetails, refreshCardReadiness } from './graph.js';
import { templateEnvironment } from './templates.js';
import { TaskStore, type Actor } from './store.js';
import { removeCardCopy } from './completion.js';
import { resetVerificationCopy } from './verification.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

function stepSummary(event: DriverEvent) {
  const text = event.type === 'output' ? event.text : event.type === 'end' ? (event.reason === 'completed' ? event.finalAnswer ?? '' : event.reason)
    : event.type === 'artifact' ? event.path : '上下文压缩';
  return text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 200) ?? '';
}

export class ExecutionRunner {
  private tokens = new Map<string, Actor>();
  private running = new Map<string, Promise<void>>();
  private sessions = new Map<string, DriverSession>();
  private scheduled = false;
  private stopping = false;
  private unsubscribe: () => void;

  constructor(private store: TaskStore, private driver: Driver, private mcpUrl: string) {
    this.unsubscribe = store.subscribe(events => {
      for (const event of events) {
        if (event.action === 'dispatch-revoked' && event.dispatchId) this.sessions.get(event.dispatchId)?.cancel();
      }
      if (events.some(event => event.action === 'dispatch-created')) this.schedule();
    });
    this.schedule();
  }

  authenticate(header: string): Actor | undefined {
    const actor = header.startsWith('Bearer ') ? this.tokens.get(header.slice(7)) : undefined;
    if (actor) activeDispatch(this.store, actor);
    return actor;
  }

  private schedule() {
    if (this.stopping || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.stopping) return;
      const queued = this.store.db.prepare(`SELECT id, work_id AS workId FROM dispatches WHERE status = 'queued' ORDER BY created_at, rowid`).all();
      for (const row of queued) {
        const id = String(row.id);
        if (this.running.has(id)) continue;
        const promise = this.run(getDispatch(this.store, String(row.workId), id)).finally(() => { this.running.delete(id); });
        this.running.set(id, promise);
      }
    });
  }

  private async run(dispatch: Dispatch) {
    const scope = { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id };
    const token = randomBytes(32).toString('hex');
    let reason: EndReason = 'error';
    let finalAnswer: string | null = null;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let failure: string | null = null;
    let startCommit: string | null = null;
    let endCommit: string | null = null;
    const card = cardDetails(this.store, dispatch.workId, dispatch.cardId);
    const workPath = card.workPath!;
    try {
      startCommit = dispatchGit(workPath, 'rev-parse', 'HEAD');
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE dispatches SET status = 'running', started_at = ?, start_commit = ? WHERE id = ?`)
          .run(new Date().toISOString(), startCommit, dispatch.id);
        this.store.db.prepare(`UPDATE cards SET status = ? WHERE id = ? AND status NOT IN ('completed', 'cancelled')`)
          .run(dispatch.purpose === 'verification' ? 'verifying' : 'executing', card.id);
        this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-started', { startCommit }, scope);
      });
      if (!getDispatch(this.store, dispatch.workId, dispatch.id).abortReason && !this.stopping) {
        this.tokens.set(token, { type: 'dispatch', id: dispatch.id, workId: dispatch.workId });
        const pushUrls = dispatchGit(workPath, 'remote').split('\n').filter(Boolean)
          .flatMap(remote => dispatchGit(workPath, 'remote', 'get-url', '--push', '--all', remote).split('\n'));
        const session = await this.driver.start({
          template: dispatch.template, cwd: workPath, env: templateEnvironment(dispatch.template, pushUrls),
          sandbox: { mode: 'workspace-write', writableRoots: [workPath] },
          mcpServers: { helm: { url: this.mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
          ...(dispatch.resumeSessionId ? { resumeSessionId: dispatch.resumeSessionId } : {}),
        });
        this.sessions.set(dispatch.id, session);
        if (dispatch.resumeSessionId && session.id !== dispatch.resumeSessionId) throw new Error('Driver did not resume the requested session');
        if (this.store.db.prepare(`SELECT id FROM dispatches WHERE session_id = ? AND id <> ? AND status IN ('queued', 'running')`).get(session.id, dispatch.id)) {
          throw new Error('Driver returned a session already used by an active dispatch');
        }
        this.store.transaction(() => { this.store.db.prepare('UPDATE dispatches SET session_id = ? WHERE id = ?').run(session.id, dispatch.id); });
        if (this.stopping || getDispatch(this.store, dispatch.workId, dispatch.id).abortReason) session.cancel();
        await session.send(JSON.stringify({ dispatchId: dispatch.id, cardId: card.id, content: dispatch.content }));
        let previousStep = 0;
        for await (const event of session.events) {
          if (!Number.isSafeInteger(event.step) || event.step <= previousStep) throw new Error('Driver step numbers must increase');
          previousStep = event.step;
          writeFileSync(join(dispatch.outputPath, `${event.step}.json`), JSON.stringify(event));
          const summary = stepSummary(event);
          const artifact = event.type === 'artifact' ? reportedArtifact(workPath, event.path) : undefined;
          this.store.transaction(() => {
            this.store.db.prepare('UPDATE cards SET current_step = ?, latest_step_summary = ? WHERE id = ?').run(event.step, summary, card.id);
            this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-step', { step: event.step, summary }, scope);
            if (event.type === 'compaction') this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'context-compacted', { step: event.step }, scope);
            if (event.type === 'artifact' && artifact) saveArtifact(this.store, dispatch, event.kind, artifact.name, artifact.content);
          });
          if (event.type === 'end') {
            reason = event.reason === 'context-overflow' ? 'error' : event.reason;
            usage = event.usage;
            if (reason === 'completed') finalAnswer = event.finalAnswer ?? '';
            break;
          }
        }
      }
    } catch (error) { failure = error instanceof Error ? error.message : String(error); }
    finally {
      this.tokens.delete(token);
      this.sessions.get(dispatch.id)?.cancel();
      this.sessions.delete(dispatch.id);
      if (this.stopping || getDispatch(this.store, dispatch.workId, dispatch.id).abortReason) reason = 'aborted';
      try {
        if (dispatch.purpose === 'verification') {
          if (startCommit) await resetVerificationCopy(workPath, card.cardBranch!, startCommit);
        } else {
          // Runtime commits are outside the executor's restricted environment.
          const changes = dispatchGit(workPath, 'status', '--porcelain');
          if (changes) {
            const names = dispatchGit(workPath, 'ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
            if (names.length) dispatchGit(workPath, 'add', '--', ...names);
            dispatchGit(workPath, '-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false', 'commit', '-m', `Helm dispatch ${dispatch.id}: ${reason}`);
          }
        }
        endCommit = dispatchGit(workPath, 'rev-parse', 'HEAD');
        const files = startCommit ? dispatchGit(workPath, 'diff', '--name-only', '--diff-filter=ACMRT', '-z', startCommit, endCommit).split('\0').filter(Boolean) : [];
        this.store.transaction(() => {
          saveArtifact(this.store, dispatch, 'branch', card.cardBranch!, card.cardBranch!, endCommit!);
          for (const name of files) saveArtifact(this.store, dispatch, 'file', name, committedFile(workPath, endCommit!, name), endCommit!);
        });
      } catch (error) {
        failure = [failure, error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ');
        if (reason !== 'aborted') reason = 'error';
      }
      try {
        if (cardDetails(this.store, dispatch.workId, card.id).status === 'cancelled') removeCardCopy(this.store, card);
      } catch (error) {
        failure = [failure, error instanceof Error ? error.message : String(error)].filter(Boolean).join('; ');
      }
      // Revocation or shutdown can arrive while verification processes are exiting.
      let current = getDispatch(this.store, dispatch.workId, dispatch.id);
      if (this.stopping && !current.abortReason) {
        this.store.transaction(() => { this.store.db.prepare('UPDATE dispatches SET abort_reason = ? WHERE id = ?').run('运行层停止', dispatch.id); });
        current = getDispatch(this.store, dispatch.workId, dispatch.id);
      }
      if (current.abortReason) reason = 'aborted';
      if (reason !== 'completed') finalAnswer = null;
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE dispatches SET status = 'ended', ended_at = ?, end_reason = ?, final_answer = ?, usage = ?, failure = ?, end_commit = ?,
          conclusion = CASE WHEN ? = 'completed' THEN conclusion ELSE 'undeclared' END,
          conclusion_reason = CASE WHEN ? = 'completed' THEN conclusion_reason ELSE NULL END WHERE id = ?`)
          .run(new Date().toISOString(), reason, finalAnswer, JSON.stringify(usage), failure, endCommit, reason, reason, dispatch.id);
        const result = getDispatch(this.store, dispatch.workId, dispatch.id);
        refreshCardReadiness(this.store, dispatch.workId);
        const event = this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-ended', result, scope);
        this.store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, dispatch.workId);
      });
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
