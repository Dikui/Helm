import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { realpathSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import { RuleError, TaskStore, type Actor, type ActorType } from './store.js';
import { confirmationDetails, confirmDescription, draftDescription, ensureWorkCopy } from './alignment.js';
import { addDependency, cardDetails, cardGraph, createCard, decideGate, gateHistory, proposeGate, removeDependency, updateCard, updateGate, withdrawGate } from './graph.js';
import { activeDispatch, createDispatch, dispatchArtifacts, dispatchOutput, getDispatch, listDispatches, markOutdated, readArtifact, revokeDispatch, submitConclusion } from './dispatch.js';
import { listAgents, saveAgentSchema } from './agents.js';
import { promptNames, readPrompt, writePrompt } from './prompts.js';
import { cancelCard, completeCard } from './completion.js';
import type { UserOperations } from './user-operations.js';
import { requestReview, reviewDetails } from './review.js';
import { checkOutputUsage, deleteWork, deleteWorkOutputs, exportWorkOutputs, pendingOutputWarning } from './outputs.js';
import { pendingAgents } from './availability.js';
import { listWorks, readWork } from './work-reads.js';
import { projectBranches, projectGitStatus } from './project-reads.js';
import { coordinatorNotes, listRounds, roundOutput } from './round-reads.js';
import { deleteLibraryEntry, installSkill, libraryName, listLibrary, mcpSchema, registerMcp } from './library.js';
import { attachmentsSchema, saveAttachments } from './attachments.js';
import { listWorkFiles, readWorkFile } from './work-files.js';
import { resolveMergeConflict, finishConflictResolution, conflictResolutionChanges, resolvingConflict } from './conflict-resolution.js';

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
const writeScopesSchema = z.array(z.string().trim().min(1)).max(50).optional();
const projectColumns = 'id, name, path, created_at, default_coordinator_agent_id AS defaultCoordinatorAgentId';

export const operations: readonly Operation[] = [
  operation({
    name: 'list-library', description: '列出库条目及引用它们的 Agent', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(), execute: ({ store }) => listLibrary(store),
  }),
  operation({
    name: 'install-skill', description: '从本地目录安装 skill 到库，可指定名字；replace: true 覆盖同名 skill（允许被 Agent 引用，不影响正在运行的副本）', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ path: z.string().min(1), name: libraryName.optional(), replace: z.boolean().optional() }).strict(),
    execute: ({ store, actor }, { path, name, replace }) => installSkill(store, actor, path, name, replace),
  }),
  operation({
    name: 'register-mcp', description: '登记 HTTP 或 stdio MCP 到库', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ name: libraryName, config: mcpSchema }).strict(),
    execute: ({ store, actor }, { name, config }) => registerMcp(store, actor, name, config),
  }),
  operation({
    name: 'delete-library-entry', description: '删除未被 Agent 引用的库条目', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ type: z.enum(['skill', 'mcp']), name: libraryName }).strict(),
    execute: ({ store, actor }, { type, name }) => deleteLibraryEntry(store, actor, type, name),
  }),
  operation({
    name: 'export-outputs', description: '导出已结束工作的全部输出、成果文件和任务库记录为 .tar.gz', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), targetPath: z.string().min(1) }).strict(),
    execute: ({ store, actor }, { workId, targetPath }) => exportWorkOutputs(store, actor, workId, targetPath),
  }),
  operation({
    name: 'delete-outputs', description: '删除已结束工作的原始事件流；未导出时先提示，confirm: true 确认删除', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), confirm: z.boolean().optional() }).strict(),
    execute: ({ store, actor }, { workId, confirm }) => deleteWorkOutputs(store, actor, workId, confirm),
  }),
  operation({
    name: 'delete-work', description: '删除已结束的工作及其记录和输出；已合并的工作分支一并删除，未合并的保留；未导出时先提示，confirm: true 确认删除', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), confirm: z.boolean().optional() }).strict(),
    execute: ({ store, actor }, { workId, confirm }) => deleteWork(store, actor, workId, confirm),
  }),
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
    name: 'withdraw-message', description: '撤回尚未被任何调度轮次领取的排队用户消息，保留对话记录', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), messageId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, params) => userOperations.withdrawMessage(actor, params),
  }),
  operation({
    name: 'open-agent-prompt', description: '在本机默认文本编辑器中打开此 Agent 已保存的 prompt.md', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ agentId: saveAgentSchema.shape.id }).strict(),
    execute: ({ userOperations }, { agentId }) => userOperations.openAgentPrompt(agentId),
  }),
  operation({
    name: 'interrupt-round', description: '打断当前调度轮次并重投事件和用户消息', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.interruptRound(actor, workId),
  }),
  operation({
    name: 'change-coordinator-agent', description: '更换工作的调度者 Agent，从下一调度轮次起生效', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), agentId: z.string().min(1) }).strict(),
    execute({ store, actor }, { workId, agentId }) {
      const work = store.work(workId);
      store.agents.get(agentId, 'coordinator');
      if (work.coordinatorAgentId !== agentId) {
        store.db.prepare('UPDATE works SET coordinator_agent_id = ? WHERE id = ?').run(agentId, workId);
        const event = store.appendEvent(actor, { type: 'work', id: workId }, 'coordinator-agent-changed',
          { previousAgentId: work.coordinatorAgentId, agentId }, { workId });
        store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
      }
      return store.work(workId);
    },
  }),
  operation({
    name: 'save-agent', description: '保存文件中的 Agent；更新须带列表中的 revision，新建须使用新 id', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: saveAgentSchema,
    async execute({ store, actor }, params) {
      const agent = store.agents.save(params);
      store.transaction(() => store.appendEvent(actor, { type: 'agent', id: agent.id }, 'agent-saved',
        { mode: params.mode, revision: agent.revision, skills: agent.skills, mcp: agent.mcp }));
      try { await store.agents.check(agent.id); }
      catch (error) { if (!(error instanceof RuleError)) throw error; }
      const saved = store.agents.list().find(item => item.id === agent.id)!;
      return { ...saved, notice: agent.home === 'dedicated' ? `请按 CLI 格式配置 ~/.helm/agent-homes/${agent.id}/ 中的接口和凭据。` : null };
    },
  }),
  operation({
    name: 'delete-agent', description: '删除文件中的 Agent；仍被未结束的工作、排队或运行中的派单、项目默认调度者使用时拒绝', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ id: z.string().min(1) }).strict(),
    execute({ store, actor }, { id }) {
      const usage = store.db.prepare(`SELECT
        (SELECT count(*) FROM works WHERE coordinator_agent_id = ? AND status NOT IN ('completed', 'cancelled')) AS works,
        (SELECT count(*) FROM dispatches WHERE agent_id = ? AND status IN ('queued', 'running')) AS dispatches,
        (SELECT count(*) FROM projects WHERE default_coordinator_agent_id = ?) AS projects`).get(id, id, id)!;
      const [works, dispatches, projects] = [Number(usage.works), Number(usage.dispatches), Number(usage.projects)];
      if (works || dispatches || projects) throw new RuleError('AGENT_IN_USE',
        `Agent ${id} 仍在使用：${works} 个未结束的工作、${dispatches} 个排队或运行中的派单、${projects} 个项目的默认调度者。`, 409, { agentId: id });
      store.appendEvent(actor, { type: 'agent', id }, 'agent-deleted', {});
      store.agents.remove(id);
      return { id, deleted: true };
    },
  }),
  operation({
    name: 'list-agents', description: '读取文件中的 Agent、计费方式和可用性', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1).optional() }).strict(), execute: ({ store }) => listAgents(store),
  }),
  operation({
    name: 'create-dispatch', description: '给卡片派执行或验收单；执行可续跑并独占卡片，验收一律新开对话，同一卡片可同时跑多个验收，各自检查派单时固定的提交', callers: ['coordinator-round'], keyed: true, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1), key: z.string().min(1), agentId: z.string().min(1),
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
    name: 'list-dispatches', description: '读取工作或卡片的全部派单及结果；验收派单的 startCommit 是它检查的提交，outdated=true 表示卡片已有新提交、结论已过期', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1).optional() }).strict(),
    execute: ({ store }, { workId, cardId }) => markOutdated(store, listDispatches(store, workId, cardId)),
  }),
  operation({
    name: 'get-dispatch', description: '读取派单详情和完整最终回答', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), dispatchId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId, dispatchId }) => markOutdated(store, [getDispatch(store, workId, dispatchId)])[0],
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
    name: 'list-work-files', description: '列出工作分支上的文件路径；创建工作副本后即可读取', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId }) => listWorkFiles(store, workId),
  }),
  operation({
    name: 'read-work-file', description: '读取工作分支上的文件（相对仓库根目录的路径）或这项工作的附件（绝对路径），二进制文件用 encoding: base64', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), path: z.string().min(1), encoding: z.enum(['utf8', 'base64']).optional() }).strict(),
    execute: ({ store }, { workId, path, encoding }) => readWorkFile(store, workId, path, encoding),
  }),
  operation({
    name: 'register-project', description: '登记本机 git 项目', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ path: z.string().min(1), name: z.string().trim().min(1).optional(), initGit: z.boolean().optional() }).strict(),
    execute({ store, actor }, params) {
      let candidate: string;
      try {
        candidate = realpathSync(resolve(params.path));
        if (!statSync(candidate).isDirectory()) throw new Error();
      } catch { throw new RuleError('INVALID_PROJECT', '项目路径不存在或不是目录。', 400); }
      const git = (...args: string[]) => execFileSync('git', ['-C', candidate, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
      let path: string;
      try { path = realpathSync(git('rev-parse', '--show-toplevel')); } catch {
        let insideGit = true;
        try { git('rev-parse', '--git-dir'); } catch { insideGit = false; }
        if (insideGit) throw new RuleError('INVALID_PROJECT', '项目路径必须位于本机 git 工作树中。', 400);
        if (!params.initGit) throw new RuleError('INVALID_PROJECT', '这个目录还不是 git 仓库。Helm 需要用 git 记录开工起点并开工作分支。', 400, { initializable: true });
        // Helm needs a commit to fix the base on; an empty one leaves the user's files untouched.
        try {
          git('init');
          git('-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Initial commit');
        } catch (error) { throw new RuleError('INVALID_PROJECT', `git 初始化失败：${(error as Error).message}`, 400); }
        path = candidate;
      }
      const existing = store.db.prepare(`SELECT ${projectColumns} FROM projects WHERE path = ?`).get(path);
      if (existing) return existing;
      const id = randomUUID();
      const time = new Date().toISOString();
      store.db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)').run(id, params.name ?? basename(path), path, time);
      store.appendEvent(actor, { type: 'project', id }, 'project-registered', { path, name: params.name ?? basename(path) });
      return store.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(id);
    },
  }),
  operation({
    name: 'delete-project', description: '删除没有工作的项目登记，只删除数据库记录，不删除磁盘上的仓库或文件', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ projectId: z.string().min(1) }).strict(),
    execute({ store, actor }, { projectId }) {
      const project = store.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(projectId);
      if (!project) throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
      const workCount = Number(store.db.prepare('SELECT count(*) AS count FROM works WHERE project_id = ?').get(projectId)!.count);
      if (workCount) throw new RuleError('PROJECT_IN_USE', `项目下还有 ${workCount} 项工作，请先删除这些工作。`, 409, { projectId, workCount });
      store.db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      store.appendEvent(actor, { type: 'project', id: projectId }, 'project-deleted', { path: project.path, name: project.name });
      return { id: projectId, deleted: true };
    },
  }),
  operation({
    name: 'list-projects', description: '列出项目', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(),
    execute: ({ store }) => store.db.prepare(`SELECT ${projectColumns} FROM projects ORDER BY created_at, id`).all().map(projectGitStatus),
  }),
  operation({
    name: 'list-project-branches', description: '读取项目当前检出分支及可用的本地基准分支', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ projectId: z.string().min(1) }).strict(),
    execute({ store }, { projectId }) {
      const project = store.db.prepare('SELECT path FROM projects WHERE id = ?').get(projectId);
      if (!project) throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
      return projectBranches(String(project.path));
    },
  }),
  operation({
    name: 'set-project-coordinator-agent', description: '设置项目默认调度者 Agent，仅影响之后创建的工作', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ projectId: z.string().min(1), agentId: z.string().min(1) }).strict(),
    execute({ store, actor }, { projectId, agentId }) {
      const project = store.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(projectId);
      if (!project) throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
      store.agents.get(agentId, 'coordinator');
      if (project.defaultCoordinatorAgentId !== agentId) {
        store.db.prepare('UPDATE projects SET default_coordinator_agent_id = ? WHERE id = ?').run(agentId, projectId);
        store.appendEvent(actor, { type: 'project', id: projectId }, 'project-coordinator-agent-set',
          { previousAgentId: project.defaultCoordinatorAgentId, agentId });
      }
      return store.db.prepare(`SELECT ${projectColumns} FROM projects WHERE id = ?`).get(projectId);
    },
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
      outputThresholdBytes: store.db.prepare('SELECT output_threshold_bytes FROM settings WHERE id = 1').get()!.output_threshold_bytes,
      outputTotalBytes: store.db.prepare('SELECT output_total_bytes FROM settings WHERE id = 1').get()!.output_total_bytes,
      outputThresholdExceeded: Boolean(store.db.prepare('SELECT output_threshold_exceeded FROM settings WHERE id = 1').get()!.output_threshold_exceeded),
      runningDispatches: store.db.prepare(`SELECT count(*) AS count FROM dispatches WHERE status = 'running'`).get()!.count,
      queuedDispatches: store.db.prepare(`SELECT count(*) AS count FROM dispatches WHERE status = 'queued'`).get()!.count,
    }),
  }),
  operation({
    name: 'set-output-threshold', description: '设置输出提示阈值（字节，默认 10 GB）并立即检查输出总量', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ thresholdBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) }).strict(),
    execute({ store, actor }, { thresholdBytes }) {
      const current = store.db.prepare('SELECT output_threshold_bytes FROM settings WHERE id = 1').get()!;
      if (current.output_threshold_bytes !== thresholdBytes) {
        store.db.prepare('UPDATE settings SET output_threshold_bytes = ? WHERE id = 1').run(thresholdBytes);
        store.appendEvent(actor, { type: 'settings', id: 'global' }, 'output-threshold-set', { thresholdBytes });
      }
      checkOutputUsage(store);
      return { outputThresholdBytes: thresholdBytes };
    },
  }),
  operation({
    name: 'get-prompts', description: '读取调度者和执行者的内置规则提示词', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(),
    execute: ({ store }) => Object.fromEntries(promptNames.map(name => [name, readPrompt(store.agents.promptDirectory, name)])),
  }),
  operation({
    name: 'set-prompt', description: '改写一段内置规则提示词，从下一次派单或调度轮次起生效', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ name: z.enum(promptNames), text: z.string() }).strict(),
    execute({ store, actor }, { name, text }) {
      writePrompt(store.agents.promptDirectory, name, text);
      store.transaction(() => store.appendEvent(actor, { type: 'settings', id: 'global' }, 'prompt-set', { name }));
      return { name, text };
    },
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
    name: 'check-agent', description: '检查驱动对应的 CLI 是否在 PATH 上；未安装时返回官方安装命令', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ driver: z.string().min(1) }).strict(),
    execute: ({ userOperations }, { driver }) => userOperations.checkAgent(driver),
  }),
  operation({
    name: 'list-agent-models', description: '向驱动的 CLI 询问可选模型及各模型支持的推理强度（CLI 原生取值）；id 为 null 表示 CLI 默认模型', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ driver: z.string().min(1), agent: z.object({
      id: saveAgentSchema.shape.id, home: saveAgentSchema.shape.config.shape.home,
    }).strict().optional() }).strict(),
    execute: ({ userOperations }, { driver, agent }) => userOperations.listModels(driver, agent),
  }),
  operation({
    name: 'check-environment', description: '检查各驱动 CLI 和浏览器检查用的 Chromium 是否已安装，返回版本、安装命令和登录命令', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(), execute: ({ userOperations }) => userOperations.checkEnvironment(),
  }),
  operation({
    name: 'install-tool', description: '在本机运行驱动 CLI 或浏览器（browser）的固定安装命令（登录仍需在终端完成）', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ name: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { name }) => userOperations.installTool(actor, name),
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
    name: 'send-message', description: '发消息；选项目发第一条消息即新建工作。用户可带附件 attachments: [{ name, content(base64) }]，存到 Helm 数据目录，消息里返回绝对路径', callers: ['user', 'coordinator-round'], keyed: true, mutates: true,
    schema: z.object({
      attachments: attachmentsSchema.optional(),
      projectId: z.string().min(1).optional(), workId: z.string().min(1).optional(),
      body: z.string().trim().min(1), key: z.string().min(1), gateId: z.string().min(1).optional(),
      cardId: z.string().min(1).optional(),
      coordinatorAgentId: z.string().min(1).optional(),
      baseRef: z.string().min(1).optional(),
    }).strict().refine(params => Boolean(params.projectId) !== Boolean(params.workId), '必须且只能提供 projectId 或 workId。')
      .refine(params => !params.coordinatorAgentId || Boolean(params.projectId), 'coordinatorAgentId 只能在创建工作时指定；已有工作请用 change-coordinator-agent。')
      .refine(params => !params.baseRef || Boolean(params.projectId), 'baseRef 只能在创建工作时指定。'),
    execute({ store, actor }, params) {
      let workId = params.workId;
      let isNew = false;
      if (params.projectId) {
        const project = store.db.prepare('SELECT default_coordinator_agent_id FROM projects WHERE id = ?').get(params.projectId);
        if (!project) {
          throw new RuleError('NOT_FOUND', '找不到这个项目。', 404);
        }
        const existing = store.db.prepare('SELECT id FROM works WHERE project_id = ? AND creation_key = ?').get(params.projectId, params.key);
        if (existing) workId = String(existing.id);
        else {
          workId = randomUUID();
          const coordinatorAgentId = params.coordinatorAgentId ?? String(project.default_coordinator_agent_id);
          store.agents.get(coordinatorAgentId, 'coordinator');
          store.db.prepare('INSERT INTO works (id, project_id, status, creation_key, created_at, coordinator_agent_id) VALUES (?, ?, ?, ?, ?, ?)')
            .run(workId, params.projectId, 'aligning', params.key, new Date().toISOString(), coordinatorAgentId);
          store.appendEvent(actor, { type: 'work', id: workId }, 'work-created', { projectId: params.projectId, coordinatorAgentId }, { workId });
          isNew = true;
        }
      }
      // The parameter schema guarantees one of projectId/workId.
      if (!workId) throw new RuleError('INVALID_PARAMS', '必须指定项目或工作。', 400);
      const work = store.work(workId);
      const existing = store.message(workId, params.key);
      if (existing) return { work, message: existing };
      if (['completed', 'cancelled'].includes(work.status)) throw new RuleError('TERMINAL_WORK', '完成或已取消的工作不能再修改。');
      if (params.attachments?.length && actor.type !== 'user') throw new RuleError('FORBIDDEN', '只有用户可以发送附件。', 403);
      if (params.cardId) cardDetails(store, workId, params.cardId);
      if (params.gateId) {
        const gate = store.db.prepare('SELECT id FROM gates WHERE id = ? AND work_id = ?').get(params.gateId, workId);
        if (!gate) throw new RuleError('INVALID_GATE', '关卡必须属于这项工作。', 400);
      }
      const id = randomUUID();
      const attachments = saveAttachments(store, workId, id, params.attachments ?? []);
      const event = store.appendEvent(actor, { type: 'message', id }, 'message-sent', { body: params.body, gateId: params.gateId ?? null, cardId: params.cardId ?? null, attachments }, { workId, cardId: params.cardId });
      store.db.prepare('INSERT INTO messages (id, work_id, sender, body, key, gate_id, created_at, sequence, card_id, attachments) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, workId, actor.type, params.body, params.key, params.gateId ?? null, event.time, event.id, params.cardId ?? null, JSON.stringify(attachments),
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
        ensureWorkCopy(store, workId, params.baseRef);
      }
      return { work: store.work(workId), message: store.message(workId, params.key) };
    },
  }),
  operation({
    name: 'list-works', description: '列出工作及状态和待决定关卡', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ projectId: z.string().min(1).optional() }).strict(),
    execute: ({ store }, { projectId }) => listWorks(store, projectId),
  }),
  operation({
    name: 'get-work', description: '读取工作', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => readWork(store, workId),
  }),
  operation({
    name: 'list-rounds', description: '读取调度轮次、运行中步骤和排队待下一轮处理的用户消息', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store, actor }, { workId }) => listRounds(store, workId, actor.type === 'user'),
  }),
  operation({
    name: 'get-round-output', description: '按步骤读取调度轮次输出', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1), roundId: z.string().min(1), fromStep: z.number().int().positive().optional(), toStep: z.number().int().positive().optional() }).strict(),
    execute: ({ store }, params) => roundOutput(store, params),
  }),
  operation({
    name: 'get-conversation', description: '按时间读取消息和关卡', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId }) => store.conversation(workId).map(item => reviewDetails(store, confirmationDetails(store, item))),
  }),
  operation({
    name: 'list-pending', description: '列出所有待用户处理的事项', callers: ['user'], keyed: false, mutates: false,
    schema: z.object({}).strict(), execute: async ({ store }) => [
      ...store.pending().map(gate => reviewDetails(store, confirmationDetails(store, gate))),
      ...store.db.prepare(`SELECT id, id AS workId, status, runtime_pause_reason AS runtimePauseReason
        FROM works WHERE status = 'paused' AND runtime_pause_reason IS NOT NULL ORDER BY created_at, id`).all()
        .map(work => ({ type: 'work', kind: 'runtime-pause', ...work })),
      ...pendingOutputWarning(store),
      ...await pendingAgents(store),
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
    name: 'recheck-work-merge', description: '重新检测本地合并；仅在基准已包含工作分支时记录已合入', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.deliverWork(actor, workId, 'detect'),
  }),
  operation({
    name: 'resolve-merge-conflict', description: '选择由调度者派卡片解决合入冲突，或在本地自行处理', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), resolution: z.enum(['coordinator', 'manual']) }).strict(),
    execute: ({ store, actor }, { workId, resolution }) => resolveMergeConflict(store, actor, workId, resolution),
  }),
  operation({
    name: 'finish-conflict-resolution', description: '冲突卡片验收完成后回到待合入，保留接受决定，不重新审核', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store, actor }, { workId }) => finishConflictResolution(store, actor, workId),
  }),
  operation({
    name: 'get-conflict-resolution', description: '查看冲突解决的固定提交间改动及验收派单', callers: ['user', 'coordinator-round'], keyed: false, mutates: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ store }, { workId }) => conflictResolutionChanges(store, workId),
  }),
  ...(['merge', 'push'] as const).map(phase => operation({
    name: `${phase}-work`, description: phase === 'merge' ? '把工作分支合入基准分支，不推送' : '推送已合入的基准分支', callers: ['user'], keyed: false, mutates: true, transactional: false,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.deliverWork(actor, workId, phase),
  })),
  operation({
    name: 'withdraw-acceptance', description: '合入前撤回审核接受，回到待决定', callers: ['user'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1) }).strict(),
    execute: ({ actor, userOperations }, { workId }) => userOperations.withdrawAcceptance(actor, workId),
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
    name: 'create-card', description: '建卡片；writeScopes 写预计改动的仓库相对路径前缀，卡片图对没有依赖、范围重叠的卡片给出 writeScopeWarnings（只提示，不拦）', callers: ['coordinator-round'], keyed: true, mutates: true,
    schema: z.object({ workId: z.string().min(1), key: z.string().min(1), content: z.string().trim().min(1), needsVerification: z.boolean().optional(), repairOfCardId: z.string().min(1).optional(),
      writeScopes: writeScopesSchema }).strict(),
    execute: ({ store, actor }, params) => createCard(store, actor, params),
  }),
  operation({
    name: 'update-card', description: '修改卡片内容、是否需要验收或写入范围（writeScopes 整组替换）', callers: ['coordinator-round'], keyed: false, mutates: true,
    schema: z.object({ workId: z.string().min(1), cardId: z.string().min(1), content: z.string().trim().min(1).optional(), needsVerification: z.boolean().optional(),
      writeScopes: writeScopesSchema }).strict(),
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
    schema: z.object({ workId: z.string().min(1) }).strict(), execute: ({ store }, { workId }) => coordinatorNotes(store, workId),
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
      const managesOutputs = name === 'export-outputs' || name === 'delete-outputs' || name === 'delete-work';
      const resolving = Boolean(acceptedReview) && resolvingConflict(store, work.id) && ['executing', 'paused'].includes(work.status);
      if (resolving && ['request-review', 'draft-work-description'].includes(name)) throw new RuleError('CONFLICT_RESOLUTION_ACTIVE', '冲突解决后直接回到待合入，不重新审核或修改工作说明。');
      if (resolving && ((name === 'create-card' && parsed.data.needsVerification !== true) || (name === 'update-card' && parsed.data.needsVerification === false))) {
        throw new RuleError('VERIFICATION_REQUIRED', '冲突处理卡片必须安排验收。');
      }
      if ((['completed', 'cancelled'].includes(work.status) || (acceptedReview && !resolving)) && !repeatReview && !['withdraw-acceptance', 'merge-work', 'push-work', 'resolve-merge-conflict', 'recheck-work-merge', 'finish-conflict-resolution'].includes(name) && !managesOutputs && !(name === 'cancel-work' && work.status === 'cancelled')) {
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
