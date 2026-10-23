import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { RuleError, TaskStore, type Actor, type ActorType } from './store.js';
import { confirmationDetails, confirmDescription, draftDescription } from './alignment.js';
import { addDependency, cardDetails, cardGraph, createCard, decideGate, gateHistory, proposeGate, removeDependency, updateCard, updateGate, withdrawGate } from './graph.js';
import { activeDispatch, createDispatch, dispatchArtifacts, dispatchOutput, getDispatch, listDispatches, readArtifact, revokeDispatch, submitConclusion } from './dispatch.js';
import { agentTemplates, configureTemplate } from './templates.js';
import { cancelCard, completeCard } from './completion.js';
import type { UserOperations } from './user-operations.js';
import { requestReview, reviewDetails } from './review.js';

interface Context { store: TaskStore; actor: Actor; userOperations: UserOperations }
interface Operation {
  name: string;
  description: string;
  schema: z.ZodObject;
  callers: readonly ActorType[];
  keyed: boolean;
  mutates: boolean;
  transactional?: boolean;
  execute: (context: Context, params: Record<string, unknown>) => unknown;
}

function operation<S extends z.ZodRawShape>(
  definition: Omit<Operation, 'schema' | 'execute'> & {
    schema: z.ZodObject<S>;
    execute: (context: Context, params: z.infer<z.ZodObject<S>>) => unknown;
  },
): Operation {
  return { ...definition, execute: (context, params) => definition.execute(context, params as z.infer<z.ZodObject<S>>) };
}

export const eventFilterSchema = z.object({
  after: z.number().int().nonnegative().optional(),
  workId: z.string().min(1).optional(), cardId: z.string().min(1).optional(), dispatchId: z.string().min(1).optional(),
  actorType: z.enum(['user', 'coordinator-round', 'dispatch', 'runtime']).optional(), actorId: z.string().min(1).optional(),
}).strict();

const nodeSchema = z.object({ type: z.enum(['card', 'gate']), id: z.string().min(1) }).strict();
const dependencySchema = z.object({ workId: z.string().min(1), upstream: nodeSchema, downstream: nodeSchema }).strict();

export const operations: readonly Operation[] = [
  operation({
    name: 'pause-card', description: '暂停卡片并中止派单', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, params) => userOperations.pauseCard(actor, params),
  }),
  operation({
    name: 'resume-card', description: '恢复卡片并唤醒调度者', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, params) => userOperations.resumeCard(actor, params),
  }),
  operation({
    name: 'pause-work', description: '暂停工作并中止全部派单', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.pauseWork(actor, workId),
  }),
  operation({
    name: 'resume-work', description: '恢复工作并投递积压事件', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.resumeWork(actor, workId),
  }),
  operation({
    name: 'cancel-work', description: '取消工作，中止派单并删除副本', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.cancelWork(actor, workId),
  }),
  operation({
    name: 'interrupt-round', description: '打断当前调度轮次并重投事件和用户消息', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.interruptRound(actor, workId),
  }),
  operation({
    name: 'list-agent-templates', description: '读取内置 Agent 模板', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1).optional() }).strict(), execute: ({ store }) => agentTemplates(store),
  }),
  operation({
    name: 'configure-agent-template', description: '设置内置 Agent 模板的模型和推理强度', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ templateId: z.string().min(1), model: z.string().trim().min(1).optional(), reasoningEffort: z.enum(['low', 'medium', 'high', 'max']).optional() }).strict(),
    execute: ({ store, actor }, params) => configureTemplate(store, actor, params),
  }),
  operation({
    name: 'create-dispatch', description: '给卡片派执行或验收单；执行可续跑，验收一律新开对话', callers: ['coordinator-round'], keyed: true, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1), key: z.string().min(1), templateId: z.string().min(1),
      purpose: z.enum(['execution', 'verification']).optional(), content: z.string().trim().min(1).optional(), resumeSessionId: z.string().min(1).optional(), needsBrowser: z.boolean().optional() }).strict(),
    execute: ({ store, actor }, params) => createDispatch(store, actor, params),
  }),
  operation({
    name: 'revoke-dispatch', description: '调度者撤销派单并写明原因', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), dispatchId: z.string().min(1), reason: z.string().trim().min(1) }).strict(),
    execute: ({ store, actor }, params) => revokeDispatch(store, actor, params),
  }),
  operation({
    name: 'submit-conclusion', description: '执行派单报完成或受阻，验收派单报通过或不通过；附一句理由，以最后一次为准', callers: ['dispatch'], keyed: false, mutates: true,
    schema: z.object({ conclusion: z.enum(['completed', 'blocked', 'passed', 'failed']), reason: z.string().trim().min(1) }).strict(),
    execute: ({ store, actor }, params) => submitConclusion(store, actor, params),
  }),
  operation({
    name: 'list-dispatches', description: '读取工作或卡片的全部派单及结果', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1).optional() }).strict(),
    execute: ({ store }, { workId, cardId }) => listDispatches(store, workId, cardId),
  }),
  operation({
    name: 'get-dispatch', description: '读取派单详情和完整最终回答', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), dispatchId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId, dispatchId }) => getDispatch(store, workId, dispatchId),
  }),
  operation({
    name: 'get-dispatch-output', description: '按步骤读取派单输出', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), dispatchId: z.string().min(1), fromStep: z.number().int().positive().optional(), toStep: z.number().int().positive().optional() }).strict(),
    execute: ({ store }, params) => dispatchOutput(store, params),
  }),
  operation({
    name: 'get-dispatch-artifacts', description: '读取派单成果：分支、文件和测试输出', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), dispatchId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId, dispatchId }) => dispatchArtifacts(store, workId, dispatchId),
  }),
  operation({
    name: 'read-artifact', description: '读取成果内容，二进制文件用 encoding: base64', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), artifactId: z.string().min(1), encoding: z.enum(['utf8', 'base64']).optional() }).strict(),
    execute: ({ store }, { workId, artifactId, encoding }) => readArtifact(store, workId, artifactId, encoding),
  }),
  operation({
    name: 'register-project', description: '登记本机 git 项目', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ path: z.string().min(1), name: z.string().trim().min(1).optional() }).strict(),
    execute({ store, actor }, params) {
      let path: string;
      try {
        const candidate = realpathSync(resolve(params.path));
        path = realpathSync(execFileSync('git', ['-C', candidate, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim());
      } catch { throw new RuleError('INVALID_PROJECT', '项目路径必须位于本机 git 工作树中。', 400); }
      const existing = store.db.prepare('SELECT * FROM projects WHERE path = ?').get(path);
      if (existing) return existing;
      const id = randomUUID();
      const time = new Date().toISOString();
      store.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, params.name ?? basename(path), path, time);
      store.appendEvent(actor, { type: 'project', id }, 'project-registered', { path, name: params.name ?? basename(path) });
      return store.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    },
  }),
  operation({
    name: 'list-projects', description: '列出项目', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(),
    execute: ({ store }) => store.db.prepare('SELECT * FROM projects ORDER BY created_at, id').all(),
  }),
  operation({
    name: 'get-settings', description: '读取全局设置', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(),
    execute: ({ store }) => ({
      concurrencyLimit: store.db.prepare('SELECT concurrency_limit FROM settings WHERE id = 1').get()!.concurrency_limit,
      dispatchWallTimeoutMs: store.db.prepare('SELECT dispatch_wall_timeout_ms FROM settings WHERE id = 1').get()!.dispatch_wall_timeout_ms,
      dispatchIdleTimeoutMs: store.db.prepare('SELECT dispatch_idle_timeout_ms FROM settings WHERE id = 1').get()!.dispatch_idle_timeout_ms,
      roundTotalTimeoutMs: store.db.prepare('SELECT round_total_timeout_ms FROM settings WHERE id = 1').get()!.round_total_timeout_ms,
      roundIdleTimeoutMs: store.db.prepare('SELECT round_idle_timeout_ms FROM settings WHERE id = 1').get()!.round_idle_timeout_ms,
      runningDispatches: store.db.prepare(`SELECT count(*) AS count FROM dispatches WHERE status = 'running'`).get()!.count,
      queuedDispatches: store.db.prepare(`SELECT count(*) AS count FROM dispatches WHERE status = 'queued'`).get()!.count,
    }),
  }),
  operation({
    name: 'set-dispatch-watchdog', description: '设置派单墙钟总时长和无输出超时（毫秒），对后续派单生效', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ wallTimeoutMs: z.number().int().min(1).max(2147483647), idleTimeoutMs: z.number().int().min(1).max(2147483647) }).strict(),
    execute({ store, actor }, { wallTimeoutMs, idleTimeoutMs }) {
      const current = store.db.prepare('SELECT dispatch_wall_timeout_ms, dispatch_idle_timeout_ms FROM settings WHERE id = 1').get()!;
      if (current.dispatch_wall_timeout_ms !== wallTimeoutMs || current.dispatch_idle_timeout_ms !== idleTimeoutMs) {
        store.db.prepare('UPDATE settings SET dispatch_wall_timeout_ms = ?, dispatch_idle_timeout_ms = ? WHERE id = 1').run(wallTimeoutMs, idleTimeoutMs);
        store.appendEvent(actor, { type: 'settings', id: 'global' }, 'dispatch-watchdog-set', { wallTimeoutMs, idleTimeoutMs });
      }
      return { dispatchWallTimeoutMs: wallTimeoutMs, dispatchIdleTimeoutMs: idleTimeoutMs };
    },
  }),
  operation({
    name: 'set-round-watchdog', description: '设置调度轮次的总时长和无输出时长上限（毫秒，下一轮生效）', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ totalTimeoutMs: z.number().int().min(1).max(2 ** 31 - 1).optional(), idleTimeoutMs: z.number().int().min(1).max(2 ** 31 - 1).optional() })
      .strict().refine(params => params.totalTimeoutMs !== undefined || params.idleTimeoutMs !== undefined, '至少指定一个时长。'),
    execute({ store, actor }, { totalTimeoutMs, idleTimeoutMs }) {
      store.db.prepare(`UPDATE settings SET round_total_timeout_ms = COALESCE(?, round_total_timeout_ms),
        round_idle_timeout_ms = COALESCE(?, round_idle_timeout_ms) WHERE id = 1`).run(totalTimeoutMs ?? null, idleTimeoutMs ?? null);
      const settings = store.db.prepare(`SELECT round_total_timeout_ms AS roundTotalTimeoutMs, round_idle_timeout_ms AS roundIdleTimeoutMs FROM settings WHERE id = 1`).get()!;
      store.appendEvent(actor, { type: 'settings', id: 'global' }, 'round-watchdog-set', settings);
      return settings;
    },
  }),
  operation({
    name: 'set-concurrency', description: '设置全局执行者并发上限', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ limit: z.number().int().min(1) }).strict(),
    execute({ store, actor }, { limit }) {
      const current = store.db.prepare('SELECT concurrency_limit FROM settings WHERE id = 1').get()!;
      if (current.concurrency_limit !== limit) {
        store.db.prepare('UPDATE settings SET concurrency_limit = ? WHERE id = 1').run(limit);
        store.appendEvent(actor, { type: 'settings', id: 'global' }, 'concurrency-set', { limit });
      }
      return { concurrencyLimit: limit };
    },
  }),
  operation({
    name: 'send-message', description: '发消息；选项目发第一条消息即新建工作', callers: ['user', 'coordinator-round'], keyed: true, mutates: true,
    schema: z.object({
      projectId: z.string().min(1).optional(), workId: z.string().min(1).optional(),
      body: z.string().trim().min(1), key: z.string().min(1), gateId: z.string().min(1).optional(),
    }).strict().refine(params => Boolean(params.projectId) !== Boolean(params.workId), '必须且只能提供 projectId 或 workId。'),
    execute({ store, actor }, params) {
      let workId = params.workId;
      let isNew = false;
      if (params.projectId) {
        if (!store.db.prepare('SELECT id FROM projects WHERE id = ?').get(params.projectId)) {
          throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
        }
        const existing = store.db.prepare('SELECT id FROM works WHERE project_id = ? AND creation_key = ?').get(params.projectId, params.key);
        if (existing) workId = String(existing.id);
        else {
          workId = randomUUID();
          store.db.prepare('INSERT INTO works (id, project_id, status, creation_key, created_at) VALUES (?, ?, ?, ?, ?)').run(workId, params.projectId, 'aligning', params.key, new Date().toISOString());
          store.appendEvent(actor, { type: 'work', id: workId }, 'work-created', { projectId: params.projectId }, { workId });
          isNew = true;
        }
      }
      // The parameter schema guarantees one of projectId/workId.
      if (!workId) throw new RuleError('INVALID_PARAMS', '必须指定项目或工作。', 400);
      const work = store.work(workId);
      const existing = store.message(workId, params.key);
      if (existing) return { work, message: existing };
      if (['completed', 'cancelled'].includes(work.status)) throw new RuleError('TERMINAL_WORK', '完成或已取消的工作不能再修改。');
      if (params.gateId) {
        const gate = store.db.prepare('SELECT id FROM gates WHERE id = ? AND work_id = ?').get(params.gateId, workId);
        if (!gate) throw new RuleError('INVALID_GATE', '关卡必须属于这项工作。', 400);
      }
      const id = randomUUID();
      const event = store.appendEvent(actor, { type: 'message', id }, 'message-sent', { body: params.body, gateId: params.gateId ?? null }, { workId });
      store.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, workId, actor.type, params.body, params.key, params.gateId ?? null, event.time, event.id,
      );
      if (actor.type === 'user') store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
      if (isNew) {
        const gateId = randomUUID();
        const runtime = { type: 'runtime', id: 'helmd' } as const;
        const created = store.appendEvent(runtime, { type: 'gate', id: gateId }, 'gate-created', { kind: 'work-confirmation', question: '确认工作说明' }, { workId });
        store.db.prepare('INSERT INTO gates (id, work_id, kind, status, question, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          gateId, workId, 'work-confirmation', 'pending', '确认工作说明', created.time, created.id,
        );
        store.appendEvent(runtime, { type: 'gate', id: gateId }, 'needs-user-attention', { kind: 'work-confirmation' }, { workId });
      }
      return { work, message: store.message(workId, params.key) };
    },
  }),
  operation({
    name: 'list-works', description: '列出工作及状态和待决定关卡', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ projectId: z.string().min(1).optional() }).strict(),
    execute: ({ store }, { projectId }) => store.db.prepare(`SELECT id, project_id AS projectId, status, created_at AS createdAt,
      runtime_pause_reason AS runtimePauseReason,
      (status NOT IN ('completed', 'cancelled') AND EXISTS(SELECT 1 FROM gates WHERE gates.work_id = works.id AND gates.status = 'pending')) AS hasPendingGate
      FROM works WHERE (? IS NULL OR project_id = ?) ORDER BY created_at, id`).all(projectId ?? null, projectId ?? null)
      .map(work => ({ ...work, hasPendingGate: Boolean(work.hasPendingGate), usage: store.workUsage(String(work.id)) })),
  }),
  operation({
    name: 'get-work', description: '读取工作', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => store.work(workId),
  }),
  operation({
    name: 'get-conversation', description: '按时间读取消息和关卡', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId }) => store.conversation(workId).map(item => reviewDetails(store, confirmationDetails(store, item))),
  }),
  operation({
    name: 'list-pending', description: '列出所有待用户处理的事项', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(), execute: ({ store }) => [
      ...store.pending().map(gate => reviewDetails(store, confirmationDetails(store, gate))),
      ...store.db.prepare(`SELECT id, id AS workId, status, runtime_pause_reason AS runtimePauseReason
        FROM works WHERE status = 'paused' AND runtime_pause_reason IS NOT NULL ORDER BY created_at, id`).all()
        .map(work => ({ type: 'work', kind: 'runtime-pause', ...work })),
    ],
  }),
  operation({
    name: 'get-events', description: '按卡片、派单或执行方读取事件时间线', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: eventFilterSchema,
    execute: ({ store }, params) => store.events(params),
  }),
  operation({
    name: 'draft-work-description', description: '起草工作说明新版本并请求用户确认', callers: ['coordinator-round'], keyed: true, mutates: true,
    schema: z.object({ workId: z.string().min(1), key: z.string().min(1), requirements: z.string().trim().min(1),
      boundary: z.string().trim().min(1), criteria: z.string().trim().min(1), baseRef: z.string().min(1).optional() }).strict(),
    execute: ({ store, actor }, params) => draftDescription(store, actor, params),
  }),
  operation({
    name: 'get-work-descriptions', description: '读取工作说明的全部版本', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => store.descriptions(workId),
  }),
  operation({
    name: 'decide-gate', description: '用户确认工作说明、决定一般关卡，或接受 / 退回审核并附意见', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), gateId: z.string().min(1), decision: z.string().trim().min(1), descriptionId: z.string().min(1).optional(), comment: z.string().optional() }).strict(),
    execute({ store, actor, userOperations }, params) {
      const kind = store.gate(params.workId, params.gateId).kind;
      if (kind === 'review') return userOperations.decideReview(actor, params);
      if (kind !== 'work-confirmation') return decideGate(store, actor, params);
      if (params.decision !== 'confirm' || !params.descriptionId) throw new RuleError('INVALID_PARAMS', '确认工作说明须指定所查看的版本并选择 confirm。', 400);
      return confirmDescription(store, actor, { ...params, descriptionId: params.descriptionId });
    },
  }),
  operation({
    name: 'request-review', description: '以汇总报告发起审核，只能由用户接受或退回', callers: ['coordinator-round'], keyed: true, mutates: true,
    schema: z.object({ workId: z.string().min(1), key: z.string().min(1), body: z.string().trim().min(1) }).strict(),
    execute: ({ store, actor }, params) => requestReview(store, actor, params),
  }),
  operation({
    name: 'propose-gate', description: '提出一般决策关卡', callers: ['coordinator-round'], keyed: true, mutates: true,
    schema: z.object({ workId: z.string().min(1), key: z.string().min(1), question: z.string().trim().min(1), body: z.string().optional(), options: z.array(z.string().trim().min(1)).optional() }).strict(),
    execute: ({ store, actor }, params) => proposeGate(store, actor, params),
  }),
  operation({
    name: 'update-gate', description: '修改一般决策关卡并保存历史', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), gateId: z.string().min(1), question: z.string().trim().min(1).optional(), body: z.string().optional(), options: z.array(z.string().trim().min(1)).optional() }).strict(),
    execute: ({ store, actor }, params) => updateGate(store, actor, params),
  }),
  operation({
    name: 'withdraw-gate', description: '撤回调度者提出的一般关卡', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), gateId: z.string().min(1), reason: z.string().trim().min(1) }).strict(),
    execute: ({ store, actor }, params) => withdrawGate(store, actor, params),
  }),
  operation({
    name: 'get-gate-history', description: '读取关卡修改历史', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), gateId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId, gateId }) => gateHistory(store, workId, gateId),
  }),
  operation({
    name: 'create-card', description: '建卡片', callers: ['coordinator-round'], keyed: true, mutates: true,
    schema: z.object({ workId: z.string().min(1), key: z.string().min(1), content: z.string().trim().min(1), needsVerification: z.boolean().optional(), repairOfCardId: z.string().min(1).optional() }).strict(),
    execute: ({ store, actor }, params) => createCard(store, actor, params),
  }),
  operation({
    name: 'update-card', description: '修改卡片内容或是否需要验收', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1), content: z.string().trim().min(1).optional(), needsVerification: z.boolean().optional() }).strict(),
    execute: ({ store, actor }, params) => updateCard(store, actor, params),
  }),
  operation({
    name: 'complete-card', description: '合并卡片分支后标记完成并删除卡片副本', callers: ['coordinator-round'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1) }).strict(),
    execute: ({ store, actor }, params) => completeCard(store, actor, params),
  }),
  operation({
    name: 'cancel-card', description: '取消卡片、中止派单并唤醒后续处理', callers: ['user', 'coordinator-round'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1), reason: z.string().trim().min(1) }).strict(),
    execute: ({ actor, userOperations }, params) => userOperations.cancelCard(actor, params),
  }),
  operation({
    name: 'get-card', description: '读取卡片详情', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId, cardId }) => cardDetails(store, workId, cardId),
  }),
  operation({
    name: 'get-card-graph', description: '读取卡片、关卡及其依赖', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => cardGraph(store, workId),
  }),
  operation({
    name: 'add-dependency', description: '添加卡片或关卡之间的依赖', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: dependencySchema, execute: ({ store, actor }, params) => addDependency(store, actor, params),
  }),
  operation({
    name: 'remove-dependency', description: '删除依赖并重新推导卡片状态', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: dependencySchema, execute: ({ store, actor }, params) => removeDependency(store, actor, params),
  }),
  operation({
    name: 'get-coordinator-notes', description: '读取调度笔记全文与版本', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => store.notes(workId),
  }),
  operation({
    name: 'write-coordinator-notes', description: '整份改写调度笔记', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), body: z.string() }).strict(),
    execute({ store, actor }, { workId, body }) {
      const current = store.notes(workId);
      if (current.body === body) return current;
      const version = Number(current.version) + 1;
      store.db.prepare(`INSERT INTO coordinator_notes VALUES (?, ?, ?) ON CONFLICT(work_id) DO UPDATE SET body = excluded.body, version = excluded.version`)
        .run(workId, body, version);
      store.appendEvent(actor, { type: 'coordinator-notes', id: workId }, 'coordinator-notes-written', { body, version }, { workId });
      return { body, version };
    },
  }),
];

export async function invoke(store: TaskStore, actor: Actor, name: string, input: unknown, userOperations: UserOperations) {
  const definition = operations.find(item => item.name === name);
  try {
    if (!definition) throw new RuleError('UNKNOWN_OPERATION', `未知操作：${name}`, 404);
    if (!definition.callers.includes(actor.type)) throw new RuleError('FORBIDDEN', '该调用方不能执行此操作。', 403);
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) throw new RuleError('INVALID_PARAMS', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
    if (actor.type === 'coordinator-round') {
      const round = store.db.prepare(`SELECT work_id FROM coordinator_rounds WHERE id = ? AND status = 'running'`).get(actor.id);
      if (!round) throw new RuleError('INVALID_TOKEN', '轮次令牌已失效。', 401);
      if (parsed.data.workId !== round.work_id || actor.workId !== round.work_id) throw new RuleError('WORK_SCOPE', '轮次令牌只能操作所属工作。', 403);
    }
    if (actor.type === 'dispatch') activeDispatch(store, actor);
    if (definition.mutates && typeof parsed.data.workId === 'string') {
      const work = store.work(parsed.data.workId);
      const acceptedReview = store.gates(work.id).find(gate => gate.kind === 'review' && gate.decision === 'accept');
      const repeatReview = name === 'decide-gate' && parsed.data.gateId === acceptedReview?.id;
      if ((['completed', 'cancelled'].includes(work.status) || acceptedReview) && !repeatReview && !(name === 'cancel-work' && work.status === 'cancelled')) {
        throw new RuleError('TERMINAL_WORK', '完成或已取消的工作不能再修改。');
      }
    }
    const run = () => definition.execute({ store, actor, userOperations }, parsed.data);
    const result = await (definition.mutates && definition.transactional !== false ? store.transaction(run) : run());
    return { status: 200, body: { ok: true as const, result } };
  } catch (error) {
    if (!(error instanceof RuleError)) throw error;
    return rejectOperation(store, actor, name, error, input);
  }
}

export function rejectOperation(store: TaskStore, actor: Actor, name: string, error: RuleError, input?: unknown) {
  const allowedOperations = operations.filter(item => item.callers.includes(actor.type)).map(item => item.name);
  const failure = { code: error.code, reason: error.message, allowedOperations,
    ...(error.details ? { details: error.details } : {}) };
  const workId = actor.workId ?? (input && typeof input === 'object' && 'workId' in input && typeof input.workId === 'string' ? input.workId : undefined);
  store.transaction(() => store.appendEvent(actor, { type: 'operation', id: name }, 'operation-rejected', failure, { workId }));
  return { status: error.status, body: { ok: false as const, error: failure } };
}
