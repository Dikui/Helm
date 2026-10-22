import { existsSync } from 'node:fs';
import { projectPath } from './alignment.js';
import { cardDetails, cardGraph, refreshCardReadiness } from './graph.js';
import { cancelCard, removeCardCopy } from './completion.js';
import { dispatchGit, listDispatches, revokeDispatch } from './dispatch.js';
import type { ExecutionRunner } from './execution.js';
import type { RoundScheduler } from './rounds.js';
import { RuleError, TaskStore, type Actor } from './store.js';
import { completeReviewedWork, decideReview } from './review.js';

export class UserOperations {
  private reviewCompletions = new Map<string, Promise<unknown>>();
  constructor(private store: TaskStore, private executions: ExecutionRunner, private rounds: RoundScheduler) {}

  async decideReview(actor: Actor, params: { workId: string; gateId: string; decision: string; comment?: string }) {
    const gate = decideReview(this.store, actor, params);
    if (gate.decision === 'accept' && this.store.work(params.workId).status !== 'completed') {
      let completion = this.reviewCompletions.get(params.workId);
      if (!completion) {
        completion = this.finishReview(actor, params.workId, gate.id).finally(() => this.reviewCompletions.delete(params.workId));
        this.reviewCompletions.set(params.workId, completion);
      }
      await completion;
    }
    return this.store.gate(params.workId, gate.id);
  }

  private async finishReview(actor: Actor, workId: string, gateId: string) {
    this.store.transaction(() => this.abortDispatches(actor, workId, '审核接受'));
    await Promise.all([this.executions.settle(workId), this.rounds.cancel(workId, '审核接受')]);
    return completeReviewedWork(this.store, workId, gateId);
  }

  private abortDispatches(actor: Actor, workId: string, reason: string, cardId?: string) {
    for (const dispatch of listDispatches(this.store, workId, cardId)) {
      revokeDispatch(this.store, actor, { workId, dispatchId: dispatch.id, reason });
    }
  }

  private wake(actor: Actor, type: 'card' | 'work', id: string, action: string, workId: string) {
    const event = this.store.appendEvent(actor, { type, id }, action, {}, { workId, ...(type === 'card' ? { cardId: id } : {}) });
    this.store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
  }

  async pauseCard(actor: Actor, params: { workId: string; cardId: string }) {
    const card = cardDetails(this.store, params.workId, params.cardId);
    if (['completed', 'cancelled'].includes(card.status)) throw new RuleError('TERMINAL_CARD', '完成或已取消的卡片不能再修改。');
    if (card.status !== 'paused') this.store.transaction(() => {
      this.store.db.prepare(`UPDATE cards SET status = 'paused' WHERE id = ?`).run(card.id);
      this.abortDispatches(actor, card.workId, '卡片暂停', card.id);
      this.wake(actor, 'card', card.id, 'card-paused', card.workId);
    });
    await this.executions.settle(card.workId, card.id);
    return cardDetails(this.store, card.workId, card.id);
  }

  resumeCard(actor: Actor, params: { workId: string; cardId: string }) {
    const card = cardDetails(this.store, params.workId, params.cardId);
    if (['completed', 'cancelled'].includes(card.status)) throw new RuleError('TERMINAL_CARD', '完成或已取消的卡片不能再修改。');
    if (card.status === 'paused') this.store.transaction(() => {
      this.store.db.prepare('UPDATE cards SET status = ? WHERE id = ?').run(card.latestDispatchId ? 'executing' : 'ready', card.id);
      refreshCardReadiness(this.store, card.workId);
      this.wake(actor, 'card', card.id, 'card-resumed', card.workId);
    });
    return cardDetails(this.store, card.workId, card.id);
  }

  async cancelCard(actor: Actor, params: { workId: string; cardId: string; reason: string }) {
    // Active dispatches remove the copy themselves when they end.
    const card = cancelCard(this.store, actor, params);
    await this.executions.settle(card.workId, card.id);
    return cardDetails(this.store, card.workId, card.id);
  }

  async pauseWork(actor: Actor, workId: string) {
    const work = this.store.work(workId);
    if (work.status !== 'paused') this.store.transaction(() => {
      this.store.db.prepare(`UPDATE works SET paused_from_status = status, status = 'paused' WHERE id = ?`).run(workId);
      this.abortDispatches(actor, workId, '工作暂停');
      this.wake(actor, 'work', workId, 'work-paused', workId);
    });
    await this.executions.settle(workId);
    return this.store.work(workId);
  }

  resumeWork(actor: Actor, workId: string) {
    const work = this.store.work(workId);
    if (work.status === 'paused') this.store.transaction(() => {
      const review = this.store.gates(workId).some(gate => gate.kind === 'review' && gate.status === 'pending');
      const status = work.activeDescriptionId ? review ? 'awaiting-review' : 'executing' : 'aligning';
      this.store.db.prepare(`UPDATE works SET status = ?, paused_from_status = NULL,
        runtime_pause_reason = NULL, consecutive_round_failures = 0 WHERE id = ?`).run(status, workId);
      this.wake(actor, 'work', workId, 'work-resumed', workId);
    });
    return this.store.work(workId);
  }

  async interruptRound(actor: Actor, workId: string) {
    this.store.work(workId);
    this.store.transaction(() => { this.wake(actor, 'work', workId, 'round-interrupted', workId); });
    await this.rounds.cancel(workId, '用户打断');
    return this.store.work(workId);
  }

  async cancelWork(actor: Actor, workId: string) {
    const work = this.store.work(workId);
    if (work.status !== 'cancelled') this.store.transaction(() => {
      this.store.db.prepare(`UPDATE works SET status = 'cancelled' WHERE id = ?`).run(workId);
      this.abortDispatches(actor, workId, '工作取消');
      this.store.appendEvent(actor, { type: 'work', id: workId }, 'work-cancelled', {}, { workId });
    });
    await Promise.all([this.executions.settle(workId), this.rounds.cancel(workId, '工作取消')]);
    for (const node of cardGraph(this.store, workId)) if (node.type === 'card') removeCardCopy(this.store, node);
    if (work.workPath && existsSync(work.workPath)) dispatchGit(projectPath(this.store, workId), 'worktree', 'remove', '--force', work.workPath);
    return this.store.work(workId);
  }
}
