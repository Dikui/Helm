import { existsSync } from 'node:fs';
import { projectPath } from './alignment.js';
import { cardDetails, cardGraph, refreshCardReadiness } from './graph.js';
import { cancelCard, removeCardCopy } from './completion.js';
import { dispatchGit, listDispatches, revokeDispatch } from './dispatch.js';
import type { ExecutionRunner } from './execution.js';
import type { RoundScheduler } from './rounds.js';
import { RuleError, TaskStore, type Actor } from './store.js';
import { decideReview, withdrawAcceptance } from './review.js';
import { compressWorkOutputs } from './outputs.js';
import { checkAgent, checkEnvironment, installTool, listModels } from './availability.js';
import type { DriverRegistry, ModelContext } from './driver.js';
import { mergeReviewedWork, pushReviewedWork, recheckReviewedWork, setDeliveryStatus } from './delivery.js';

export class UserOperations {
  private projectDeliveries = new Map<string, Promise<unknown>>();
  private workDeliveries = new Map<string, { phase: 'merge' | 'push' | 'detect'; promise: Promise<unknown> }>();
  constructor(private store: TaskStore, private executions: ExecutionRunner, private rounds: RoundScheduler, private drivers: DriverRegistry) {}

  async settleDeliveries() { await Promise.allSettled([...this.workDeliveries.values()].map(item => item.promise)); }

  // invoke() holds BEGIN IMMEDIATE through all eligibility checks and the write.
  withdrawMessage(actor: Actor, { workId, messageId }: { workId: string; messageId: string }) {
    const message = this.store.db.prepare('SELECT sender, sequence, withdrawn_at FROM messages WHERE id = ? AND work_id = ?').get(messageId, workId);
    if (!message) throw new RuleError('MESSAGE_NOT_FOUND', '找不到这项工作的消息。', 404);
    if (message.sender !== 'user') throw new RuleError('MESSAGE_NOT_USER', '只能撤回用户发送的消息。', 409);
    if (message.withdrawn_at) throw new RuleError('MESSAGE_WITHDRAWN', '这条消息已撤回。', 409);
    const claimed = this.store.db.prepare(`SELECT 1 FROM coordinator_rounds r, json_each(r.event_ids) e
      WHERE r.work_id = ? AND e.value = ? LIMIT 1`).get(workId, Number(message.sequence));
    if (claimed) throw new RuleError('MESSAGE_CLAIMED', '这条消息已被调度者领取，不能撤回。', 409);
    const queued = this.store.db.prepare('SELECT processed_by FROM wake_queue WHERE event_id = ? AND work_id = ?').get(Number(message.sequence), workId);
    if (!queued || queued.processed_by !== null) throw new RuleError('MESSAGE_NOT_QUEUED', '这条消息已不在等待队列中，不能撤回。', 409);
    const event = this.store.appendEvent(actor, { type: 'message', id: messageId }, 'message-withdrawn', { messageId }, { workId });
    this.store.db.prepare('DELETE FROM wake_queue WHERE event_id = ? AND work_id = ?').run(Number(message.sequence), workId);
    this.store.db.prepare('UPDATE messages SET withdrawn_at = ? WHERE id = ?').run(event.time, messageId);
    return { workId, messageId, withdrawnAt: event.time };
  }

  checkAgent(driver: string) { return checkAgent(this.drivers, driver); }

  checkEnvironment() { return checkEnvironment(this.drivers); }

  listModels(driver: string, agent?: ModelContext) { return listModels(this.drivers, driver, agent); }

  installTool(actor: Actor, name: string) { return installTool(this.store, this.drivers, actor, name); }

  async decideReview(actor: Actor, params: { workId: string; gateId: string; decision: string; comment?: string }) {
    const gate = decideReview(this.store, actor, params);
    if (gate.decision === 'accept') {
      this.store.transaction(() => this.abortDispatches(actor, params.workId, '审核接受'));
      await Promise.all([this.executions.settle(params.workId), this.rounds.cancel(params.workId, '审核接受')]);
    }
    return this.store.gate(params.workId, gate.id);
  }

  withdrawAcceptance(actor: Actor, workId: string) { return withdrawAcceptance(this.store, actor, workId); }

  deliverWork(actor: Actor, workId: string, phase: 'merge' | 'push' | 'detect') {
    const work = this.store.work(workId);
    const active = this.workDeliveries.get(workId);
    if (active) {
      if (active.phase !== phase) throw new RuleError('DELIVERY_BUSY', '请等待当前合入或推送操作结束。');
      return active.promise;
    }
    if (phase === 'merge' && !['accepted', 'merged', 'completed'].includes(work.status)) throw new RuleError('REVIEW_NOT_ACCEPTED', '须先接受审核。');
    if (phase === 'push' && !['merged', 'completed'].includes(work.status)) throw new RuleError('WORK_NOT_MERGED', '合入完成后才能推送。');
    if (phase === 'detect' && !['accepted', 'merged'].includes(work.status)) throw new RuleError('NO_MANUAL_RESOLUTION', '请先选择自己处理合入冲突。');
    const previous = this.projectDeliveries.get(work.projectId) ?? Promise.resolve();
    if (phase === 'merge' && work.status === 'accepted') setDeliveryStatus(this.store, actor, workId, 'merge-queued');
    const next = previous.catch(() => {}).then(async () => {
      const result = phase === 'merge' ? await mergeReviewedWork(this.store, workId)
        : phase === 'detect' ? await recheckReviewedWork(this.store, workId) : await pushReviewedWork(this.store, workId);
      if (result.status === 'completed') await compressWorkOutputs(this.store, workId);
      return result;
    }).finally(() => {
      this.workDeliveries.delete(workId);
      if (this.projectDeliveries.get(work.projectId) === next) this.projectDeliveries.delete(work.projectId);
    });
    this.workDeliveries.set(workId, { phase, promise: next });
    this.projectDeliveries.set(work.projectId, next);
    return next;
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
    if (!work.activeDescriptionId && work.workBranch) {
      const project = projectPath(this.store, workId);
      if (dispatchGit(project, 'for-each-ref', '--format=%(refname)', `refs/heads/${work.workBranch}`)) {
        dispatchGit(project, 'branch', '-D', work.workBranch);
      }
    }
    await compressWorkOutputs(this.store, workId);
    return this.store.work(workId);
  }
}
