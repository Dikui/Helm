import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { RuleError, TaskStore, type Actor, type ActorType } from './store.js';

interface Context { store: TaskStore; actor: Actor }
interface Operation {
  name: string;
  description: string;
  schema: z.ZodObject;
  callers: readonly ActorType[];
  keyed: boolean;
  mutates: boolean;
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

export const operations: readonly Operation[] = [
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
    execute: ({ store }) => ({ concurrencyLimit: store.db.prepare('SELECT concurrency_limit FROM settings WHERE id = 1').get()!.concurrency_limit }),
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
    name: 'send-message', description: '发消息；选项目发第一条消息即新建工作', callers: ['user'], keyed: true, mutates: true,
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
          store.db.prepare('INSERT INTO works VALUES (?, ?, ?, ?, ?)').run(workId, params.projectId, 'aligning', params.key, new Date().toISOString());
          store.appendEvent(actor, { type: 'work', id: workId }, 'work-created', { projectId: params.projectId }, { workId });
          isNew = true;
        }
      }
      // The parameter schema guarantees one of projectId/workId.
      if (!workId) throw new RuleError('INVALID_PARAMS', '必须指定项目或工作。', 400);
      const work = store.work(workId);
      const existing = store.message(workId, params.key);
      if (existing) return { work, message: existing };
      if (params.gateId) {
        const gate = store.db.prepare('SELECT id FROM gates WHERE id = ? AND work_id = ?').get(params.gateId, workId);
        if (!gate) throw new RuleError('INVALID_GATE', '关卡必须属于这项工作。', 400);
      }
      const id = randomUUID();
      const event = store.appendEvent(actor, { type: 'message', id }, 'message-sent', { body: params.body, gateId: params.gateId ?? null }, { workId });
      store.db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, workId, actor.type, params.body, params.key, params.gateId ?? null, event.time, event.id,
      );
      if (isNew) {
        const gateId = randomUUID();
        const runtime = { type: 'runtime', id: 'helmd' } as const;
        const created = store.appendEvent(runtime, { type: 'gate', id: gateId }, 'gate-created', { kind: 'work-confirmation', question: '确认工作说明' }, { workId });
        store.db.prepare('INSERT INTO gates VALUES (?, ?, ?, ?, ?, ?, ?)').run(
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
      EXISTS(SELECT 1 FROM gates WHERE gates.work_id = works.id AND gates.status = 'pending') AS hasPendingGate
      FROM works WHERE (? IS NULL OR project_id = ?) ORDER BY created_at, id`).all(projectId ?? null, projectId ?? null)
      .map(work => ({ ...work, hasPendingGate: Boolean(work.hasPendingGate) })),
  }),
  operation({
    name: 'get-work', description: '读取工作', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => store.work(workId),
  }),
  operation({
    name: 'get-conversation', description: '按时间读取消息和关卡', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => store.conversation(workId),
  }),
  operation({
    name: 'list-pending', description: '列出所有待用户处理的事项', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(), execute: ({ store }) => store.pending(),
  }),
  operation({
    name: 'get-events', description: '按卡片、派单或执行方读取事件时间线', callers: ['user'], keyed: false, mutates: false,
    schema: eventFilterSchema,
    execute: ({ store }, params) => store.events(params),
  }),
];

export function invoke(store: TaskStore, actor: Actor, name: string, input: unknown) {
  const definition = operations.find(item => item.name === name);
  try {
    if (!definition) throw new RuleError('UNKNOWN_OPERATION', `未知操作：${name}`, 404);
    if (!definition.callers.includes(actor.type)) throw new RuleError('FORBIDDEN', '该调用方不能执行此操作。', 403);
    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) throw new RuleError('INVALID_PARAMS', parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '), 400);
    const run = () => definition.execute({ store, actor }, parsed.data);
    const result = definition.mutates ? store.transaction(run) : run();
    return { status: 200, body: { ok: true as const, result } };
  } catch (error) {
    if (!(error instanceof RuleError)) throw error;
    return rejectOperation(store, actor, name, error, input);
  }
}

export function rejectOperation(store: TaskStore, actor: Actor, name: string, error: RuleError, input?: unknown) {
  const allowedOperations = operations.filter(item => item.callers.includes(actor.type)).map(item => item.name);
  const failure = { code: error.code, reason: error.message, allowedOperations };
  const workId = input && typeof input === 'object' && 'workId' in input && typeof input.workId === 'string' ? input.workId : undefined;
  store.transaction(() => store.appendEvent(actor, { type: 'operation', id: name }, 'operation-rejected', failure, { workId }));
  return { status: error.status, body: { ok: false as const, error: failure } };
}
