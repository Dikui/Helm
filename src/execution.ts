import { randomBytes } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Driver, DriverEvent, DriverSession, EndReason, TokenUsage } from './driver.js';
import { abortCardGit, activeDispatch, committedFile, dispatchGit, getDispatch, prepareCardCopy, reportedArtifact, saveArtifact, type Dispatch } from './dispatch.js';
import { cardDetails, refreshCardReadiness } from './graph.js';
import { templateEnvironment } from './templates.js';
import { cleanupWorktreeProcesses, type ManagedProcess } from './processes.js';
import { TaskStore, type Actor } from './store.js';
import { removeCardCopy } from './completion.js';
import { BrowserProcess, playwrightCommand, type BrowserCommand } from './browser.js';
import { resetVerificationCopy } from './verification.js';

const runtime = { type: 'runtime', id: 'helmd' } as const;

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

function stepSummary(event: DriverEvent) {
  const text = event.type === 'output' ? event.text : event.type === 'end' ? (event.reason === 'completed' ? event.finalAnswer ?? '' : event.reason)
    : event.type === 'artifact' ? event.path : '上下文压缩';
  return text.split(/\r?\n/).find(line => line.trim())?.trim().slice(0, 200) ?? '';
}

export class ExecutionRunner {
  private tokens = new Map<string, Actor>();
  private running = new Map<string, Promise<void>>();
  private sessions = new Map<string, DriverSession>();
  private browsers = new Map<string, BrowserProcess>();
  private ports = new Map<string, { start: number; end: number }>();
  private stops = new Map<string, AbortController>();
  private scheduled = false;
  private stopping = false;
  private unsubscribe: () => void;

  constructor(private store: TaskStore, private driver: Driver, private mcpUrl: string, private browserCommand: BrowserCommand = playwrightCommand) {
    this.unsubscribe = store.subscribe(events => {
      for (const event of events) {
        if (event.action === 'dispatch-revoked' && event.dispatchId) {
          this.stops.get(event.dispatchId)?.abort();
          this.sessions.get(event.dispatchId)?.cancel();
          void this.browsers.get(event.dispatchId)?.close().catch(() => {});
        }
      }
      if (events.some(event => ['dispatch-created', 'concurrency-set'].includes(event.action))) this.schedule();
    });
    this.schedule();
  }

  authenticate(header: string): Actor | undefined {
    const actor = header.startsWith('Bearer ') ? this.tokens.get(header.slice(7)) : undefined;
    if (actor) activeDispatch(this.store, actor);
    return actor;
  }

  browserFor(actor: Actor) {
    if (actor.type !== 'dispatch') return undefined;
    const dispatch = activeDispatch(this.store, actor);
    return dispatch.needsBrowser ? this.browsers.get(dispatch.id) : undefined;
  }

  private schedule() {
    if (this.stopping || this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => {
      this.scheduled = false;
      if (this.stopping) return;
      const queued = this.store.db.prepare(`SELECT id, work_id AS workId FROM dispatches WHERE status = 'queued' ORDER BY created_at, rowid`).all();
      const limit = Number(this.store.db.prepare('SELECT concurrency_limit FROM settings WHERE id = 1').get()!.concurrency_limit);
      for (const row of queued) {
        if (this.running.size >= limit) break;
        const id = String(row.id);
        if (this.running.has(id)) continue;
        if (!this.start(id, String(row.workId))) break;
      }
    });
  }

  private start(id: string, workId: string) {
    const range = this.allocatePorts();
    if (!range) return undefined;
    this.ports.set(id, range);
    const promise = this.run(getDispatch(this.store, workId, id), range).finally(() => {
      this.ports.delete(id); this.running.delete(id); this.schedule();
    });
    this.running.set(id, promise);
    return promise;
  }

  private allocatePorts() {
    for (let start = 20000; start + 19 <= 65535; start += 20) {
      if (![...this.ports.values()].some(range => range.start === start)) return { start, end: start + 19 };
    }
  }

  private async run(dispatch: Dispatch, ports: { start: number; end: number }) {
    const scope = { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id };
    const token = randomBytes(32).toString('hex');
    let reason: EndReason = 'error';
    let finalAnswer: string | null = null;
    let usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
    let failure: string | null = null;
    let browserFailed = false;
    let startCommit: string | null = null;
    let endCommit: string | null = null;
    const card = cardDetails(this.store, dispatch.workId, dispatch.cardId);
    const workPath = card.workPath!;
    const processes: ManagedProcess[] = [];
    const stop = new AbortController();
    let events: AsyncIterator<DriverEvent> | undefined;
    this.stops.set(dispatch.id, stop);
    const watchdog = this.store.db.prepare('SELECT dispatch_wall_timeout_ms, dispatch_idle_timeout_ms FROM settings WHERE id = 1').get()!;
    let timedOut = false;
    const timeout = (threshold: 'wall' | 'idle') => {
      if (stop.signal.aborted) return;
      timedOut = true;
      this.store.transaction(() => this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-timed-out', { threshold }, scope));
      stop.abort();
      this.sessions.get(dispatch.id)?.cancel();
    };
    const wallTimer = setTimeout(() => timeout('wall'), Number(watchdog.dispatch_wall_timeout_ms));
    let idleTimer = setTimeout(() => timeout('idle'), Number(watchdog.dispatch_idle_timeout_ms));
    try {
      prepareCardCopy(this.store, dispatch, workPath, card.cardBranch!);
      startCommit = dispatchGit(workPath, 'rev-parse', 'HEAD');
      this.store.transaction(() => {
        this.store.db.prepare(`UPDATE dispatches SET status = 'running', started_at = ?, start_commit = ?, port_start = ?, port_end = ? WHERE id = ?`)
          .run(new Date().toISOString(), startCommit, ports.start, ports.end, dispatch.id);
        if (!getDispatch(this.store, dispatch.workId, dispatch.id).abortReason && !['paused', 'completed', 'cancelled'].includes(card.status)) {
          this.store.db.prepare(`UPDATE cards SET status = ? WHERE id = ?`).run(dispatch.purpose === 'verification' ? 'verifying' : 'executing', card.id);
        }
        this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'dispatch-started', { startCommit, portStart: ports.start, portEnd: ports.end }, scope);
      });
      if (!getDispatch(this.store, dispatch.workId, dispatch.id).abortReason && !this.stopping) {
        if (dispatch.needsBrowser) {
          const browser = new BrowserProcess(this.browserCommand, join(dispatch.outputPath, '..', 'browser'), () => {
            browserFailed = true;
            failure = 'Browser MCP exited unexpectedly';
            this.sessions.get(dispatch.id)?.cancel();
          });
          this.browsers.set(dispatch.id, browser);
          this.store.transaction(() => {
            this.store.db.prepare('UPDATE dispatches SET browser_pgid = ?, browser_started_at = ? WHERE id = ?').run(browser.pgid, browser.startedAt, dispatch.id);
            this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'browser-started', { pgid: browser.pgid, startedAt: browser.startedAt }, scope);
          });
          await abortable(browser.connect(), stop.signal);
        }
        if (getDispatch(this.store, dispatch.workId, dispatch.id).abortReason || this.stopping) return;
        this.tokens.set(token, { type: 'dispatch', id: dispatch.id, workId: dispatch.workId });
        const pushUrls = dispatchGit(workPath, 'remote').split('\n').filter(Boolean)
          .flatMap(remote => dispatchGit(workPath, 'remote', 'get-url', '--push', '--all', remote).split('\n'));
        const starting = this.driver.start({
          template: dispatch.template, cwd: workPath, env: { ...templateEnvironment(dispatch.template, pushUrls),
            HELM_PORT_START: String(ports.start), HELM_PORT_END: String(ports.end) },
          sandbox: { mode: 'workspace-write', writableRoots: [workPath] },
          mcpServers: { helm: { url: this.mcpUrl, headers: { Authorization: `Bearer ${token}` } } },
          ...(dispatch.resumeSessionId ? { resumeSessionId: dispatch.resumeSessionId } : {}),
          signal: stop.signal,
          onProcess: process => {
            processes.push(process);
            this.store.transaction(() => {
              this.store.db.prepare('UPDATE dispatches SET pgid = ?, process_started_at = ? WHERE id = ?').run(process.pgid, process.startedAt, dispatch.id);
              this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'process-started', { ...process, cwd: workPath, role: 'executor' }, scope);
            });
          },
        });
        void starting.then(session => { if (stop.signal.aborted) session.cancel(); }, () => {});
        const session = await abortable(starting, stop.signal);
        this.sessions.set(dispatch.id, session);
        if (dispatch.resumeSessionId && session.id !== dispatch.resumeSessionId) throw new Error('Driver did not resume the requested session');
        if (this.store.db.prepare(`SELECT id FROM dispatches WHERE session_id = ? AND id <> ? AND status IN ('queued', 'running')`).get(session.id, dispatch.id)) {
          throw new Error('Driver returned a session already used by an active dispatch');
        }
        this.store.transaction(() => { this.store.db.prepare('UPDATE dispatches SET session_id = ? WHERE id = ?').run(session.id, dispatch.id); });
        if (this.stopping || getDispatch(this.store, dispatch.workId, dispatch.id).abortReason) stop.abort();
        await abortable(session.send(JSON.stringify({ dispatchId: dispatch.id, cardId: card.id, content: dispatch.content })), stop.signal);
        let previousStep = 0;
        events = session.events[Symbol.asyncIterator]();
        for (;;) {
          const next = await abortable(events.next(), stop.signal);
          if (next.done) break;
          const event = next.value;
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => timeout('idle'), Number(watchdog.dispatch_idle_timeout_ms));
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
      clearTimeout(wallTimer);
      clearTimeout(idleTimer);
      this.stops.delete(dispatch.id);
      if (timedOut) reason = 'timed-out';
      this.tokens.delete(token);
      this.sessions.get(dispatch.id)?.cancel();
      this.sessions.delete(dispatch.id);
      void events?.return?.().catch(() => {});
      const browser = this.browsers.get(dispatch.id);
      if (browser) {
        try {
          await browser.close();
          this.store.transaction(() => this.store.appendEvent(runtime, { type: 'dispatch', id: dispatch.id }, 'browser-stopped', { pgid: browser.pgid }, scope));
        } catch (error) {
          failure = [failure, String(error)].filter(Boolean).join('; ');
          reason = 'error';
        }
        this.browsers.delete(dispatch.id);
        try {
          const files = readdirSync(browser.outputDir, { recursive: true }) as string[];
          this.store.transaction(() => {
            for (const name of files) {
              const path = join(browser.outputDir, name);
              if (name !== 'config.json' && lstatSync(path).isFile()) {
                saveArtifact(this.store, dispatch, 'file', `browser/${name}`, readFileSync(path));
              }
            }
          });
        } catch (error) {
          failure = [failure, String(error)].filter(Boolean).join('; ');
          reason = 'error';
        }
      }
      if (browserFailed) reason = 'error';
      if (this.stopping || getDispatch(this.store, dispatch.workId, dispatch.id).abortReason) reason = 'aborted';
      try {
        const cleaned = await cleanupWorktreeProcesses(workPath, processes);
        if (cleaned.pids.length) this.store.transaction(() => this.store.appendEvent(runtime,
          { type: 'dispatch', id: dispatch.id }, 'dispatch-processes-cleaned', cleaned, scope));
        // A revocation may arrive while waiting for the processes to exit.
        if (getDispatch(this.store, dispatch.workId, dispatch.id).abortReason) reason = 'aborted';
        if (dispatch.purpose === 'verification') {
          if (startCommit) resetVerificationCopy(this.store, dispatch, workPath, card.cardBranch!, startCommit);
        } else {
          // Runtime commits are outside the executor's restricted environment.
          abortCardGit(this.store, dispatch, workPath, card.cardBranch!);
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
        if (!['aborted', 'timed-out'].includes(reason)) reason = 'error';
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

  async settle(workId: string, cardId?: string) {
    const active = this.store.db.prepare(`SELECT id FROM dispatches WHERE work_id = ? AND (? IS NULL OR card_id = ?)
      AND status IN ('queued', 'running')`).all(workId, cardId ?? null, cardId ?? null);
    const pending = active.map(row => {
      const id = String(row.id);
      const promise = this.running.get(id) ?? this.start(id, workId);
      if (!promise) throw new Error('No free port range to settle dispatch');
      return promise;
    });
    await Promise.all(pending);
  }

  async close() {
    this.stopping = true;
    this.unsubscribe();
    for (const stop of this.stops.values()) stop.abort();
    for (const session of this.sessions.values()) session.cancel();
    for (const browser of this.browsers.values()) void browser.close().catch(() => {});
    await Promise.all(this.running.values());
    this.tokens.clear();
  }
}
