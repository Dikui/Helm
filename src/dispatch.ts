import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { EndReason, TokenUsage } from './driver.js';
import { projectPath } from './alignment.js';
import { cardDetails } from './graph.js';
import { agentTemplate, type AgentTemplate } from './templates.js';
import { RuleError, TaskStore, type Actor } from './store.js';

export interface Dispatch {
  id: string; workId: string; cardId: string; key: string; purpose: 'execution' | 'verification'; templateId: string;
  template: AgentTemplate; content: string; status: 'queued' | 'running' | 'ended';
  needsBrowser: boolean; browserPgid: number | null; browserStartedAt: string | null;
  resumeSessionId: string | null; sessionId: string | null; createdAt: string; startedAt: string | null; endedAt: string | null;
  startCommit: string | null; endCommit: string | null; outputPath: string;
  portStart: number | null; portEnd: number | null; pgid: number | null; processStartedAt: string | null;
  cardContentSnapshot: string | null; workDescriptionId: string | null; workDescriptionVersion: number | null;
  endReason: EndReason | null; abortReason: string | null; finalAnswer: string | null;
  conclusion: 'completed' | 'blocked' | 'passed' | 'failed' | 'undeclared'; conclusionReason: string | null; usage: TokenUsage; failure: string | null;
}

const dispatchColumns = `id, work_id AS workId, card_id AS cardId, key, purpose, template_id AS templateId,
  template_snapshot AS template, content, status, resume_session_id AS resumeSessionId, session_id AS sessionId,
  created_at AS createdAt, started_at AS startedAt, ended_at AS endedAt, start_commit AS startCommit, end_commit AS endCommit,
  output_path AS outputPath, end_reason AS endReason, abort_reason AS abortReason, final_answer AS finalAnswer,
  conclusion, conclusion_reason AS conclusionReason, usage, failure,
  needs_browser AS needsBrowser, browser_pgid AS browserPgid, browser_started_at AS browserStartedAt,
  port_start AS portStart, port_end AS portEnd, pgid, process_started_at AS processStartedAt,
  card_content_snapshot AS cardContentSnapshot, work_description_id AS workDescriptionId, work_description_version AS workDescriptionVersion`;

function readDispatch(row: Record<string, unknown>): Dispatch {
  return { ...row, needsBrowser: Boolean(row.needsBrowser), template: JSON.parse(String(row.template)), usage: JSON.parse(String(row.usage)) } as unknown as Dispatch;
}

export function getDispatch(store: TaskStore, workId: string, dispatchId: string) {
  store.work(workId);
  const row = store.db.prepare(`SELECT ${dispatchColumns} FROM dispatches WHERE id = ? AND work_id = ?`).get(dispatchId, workId);
  if (!row) throw new RuleError('INVALID_DISPATCH', '派单必须属于这项工作。', 400);
  return readDispatch(row);
}

export function listDispatches(store: TaskStore, workId: string, cardId?: string) {
  store.work(workId);
  if (cardId) cardDetails(store, workId, cardId);
  return store.db.prepare(`SELECT ${dispatchColumns} FROM dispatches WHERE work_id = ? AND (? IS NULL OR card_id = ?) ORDER BY created_at, rowid`)
    .all(workId, cardId ?? null, cardId ?? null).map(readDispatch);
}

export function dispatchGit(path: string, ...args: string[]) {
  try { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd(); }
  catch { throw new RuleError('GIT_ERROR', '派单 git 操作失败，请检查卡片副本和分支。'); }
}

export function committedFile(path: string, commit: string, name: string) {
  return execFileSync('git', ['-C', path, 'show', `${commit}:${name}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

export function abortCardGit(store: TaskStore, dispatch: Dispatch, workPath: string, cardBranch?: string) {
  const gitPath = (name: string) => resolve(workPath, dispatchGit(workPath, 'rev-parse', '--git-path', name));
  const record = (action: string, details: object) => store.transaction(() => store.appendEvent(
    { type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id }, action, details,
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id },
  ));
  if (existsSync(gitPath('index.lock'))) {
    rmSync(gitPath('index.lock'));
    record('dispatch-index-lock-removed', {});
  }
  // A rebase can leave both a detached HEAD and conflict entries. Abort it first.
  const operations = [
    { name: 'rebase', markers: ['rebase-merge', 'rebase-apply'] },
    { name: 'merge', markers: ['MERGE_HEAD'] },
    { name: 'cherry-pick', markers: ['CHERRY_PICK_HEAD'] },
    { name: 'revert', markers: ['REVERT_HEAD'] },
  ];
  for (const operation of operations) if (operation.markers.some(marker => existsSync(gitPath(marker)))) {
    dispatchGit(workPath, operation.name, '--abort');
    record('dispatch-git-aborted', { operation: operation.name });
  }
  // Sequencer directories can remain between two clean cherry-pick/revert steps.
  if (existsSync(gitPath('sequencer'))) {
    const todo = readFileSync(join(gitPath('sequencer'), 'todo'), 'utf8');
    const operation = /^revert /m.test(todo) ? 'revert' : 'cherry-pick';
    dispatchGit(workPath, operation, '--abort');
    record('dispatch-git-aborted', { operation });
  }
  if (cardBranch && dispatchGit(workPath, 'rev-parse', '--symbolic-full-name', 'HEAD') !== `refs/heads/${cardBranch}`) {
    throw new RuleError('CARD_BRANCH_CHANGED', '卡片副本未处于卡片分支，拒绝提交游离或其他分支上的改动。');
  }
  if (dispatchGit(workPath, 'ls-files', '--unmerged')) throw new RuleError('UNMERGED_CARD', '卡片副本仍有冲突，拒绝提交。');
}

export function prepareCardCopy(store: TaskStore, dispatch: Dispatch, workPath: string, cardBranch: string) {
  abortCardGit(store, dispatch, workPath, cardBranch);
  if (!dispatchGit(workPath, 'status', '--porcelain')) return;
  const files = [...new Set([
    ...dispatchGit(workPath, 'ls-files', '--modified', '--deleted', '--others', '--exclude-standard', '-z').split('\0'),
    ...dispatchGit(workPath, 'diff', '--cached', '--name-only', '-z').split('\0'),
  ].filter(Boolean))].sort();
  store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id }, 'dispatch-copy-reset', { files },
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id }));
  dispatchGit(workPath, 'reset', '--hard', `refs/heads/${cardBranch}`);
  dispatchGit(workPath, 'clean', '-fd');
}

// This is an external action: finish it before publishing the dispatch transaction.
function cardCopy(store: TaskStore, workId: string, cardId: string) {
  const card = cardDetails(store, workId, cardId);
  const work = store.work(workId);
  if (!work.workBranch) throw new RuleError('WORK_NOT_EXECUTING', '工作尚未建立工作分支。');
  const workPath = card.workPath ?? resolve(store.dataDir, 'worktrees', workId, cardId);
  const cardBranch = card.cardBranch ?? `helm-card/${workId}/${cardId}`;
  const project = projectPath(store, workId);
  if (!dispatchGit(project, 'for-each-ref', '--format=%(refname)', `refs/heads/${cardBranch}`)) {
    dispatchGit(project, 'branch', cardBranch, work.workBranch);
  }
  if (!existsSync(workPath)) {
    mkdirSync(dirname(workPath), { recursive: true });
    dispatchGit(project, 'worktree', 'add', workPath, cardBranch);
  } else if (dispatchGit(workPath, 'rev-parse', '--show-toplevel') !== workPath
    || dispatchGit(workPath, 'symbolic-ref', '--short', 'HEAD') !== cardBranch) {
    throw new RuleError('CARD_PATH_CONFLICT', '卡片副本路径已被其他目录或分支占用。');
  }
  return { workPath, cardBranch };
}

export function createDispatch(store: TaskStore, actor: Actor, params: {
  workId: string; cardId: string; key: string; templateId: string; purpose?: Dispatch['purpose']; content?: string; resumeSessionId?: string; needsBrowser?: boolean;
}) {
  const existing = listDispatches(store, params.workId).find(item => item.key === params.key);
  if (existing) return existing;
  const work = store.work(params.workId);
  if (!['executing', 'awaiting-review'].includes(work.status)) throw new RuleError('WORK_NOT_EXECUTING', '对齐中、暂停或终态工作不能派单。');
  const card = cardDetails(store, work.id, params.cardId);
  if (['waiting', 'paused', 'completed', 'cancelled'].includes(card.status)) throw new RuleError('CARD_NOT_DISPATCHABLE', '等待前置、暂停或终态卡片不能派单。');
  if (listDispatches(store, work.id, card.id).some(item => item.status !== 'ended')) throw new RuleError('DISPATCH_ACTIVE', '卡片已有运行中或排队中的派单。');
  const purpose = params.purpose ?? 'execution';
  if (purpose === 'verification' && params.resumeSessionId) throw new RuleError('INVALID_RESUME', '验收派单一律新开对话，不能续跑。');
  const template = agentTemplate(store, params.templateId, 'executor');
  if (params.resumeSessionId) {
    const previous = listDispatches(store, work.id, card.id).find(item => item.sessionId === params.resumeSessionId && item.status === 'ended' && item.purpose === 'execution');
    if (!previous || previous.templateId !== params.templateId || (previous.template.driver ?? 'claude-sdk') !== template.driver) {
      throw new RuleError('INVALID_RESUME', '只能用原模板和驱动续跑本卡片以前的执行者对话。');
    }
    if (store.db.prepare(`SELECT id FROM dispatches WHERE session_id = ? AND status IN ('queued', 'running')`).get(params.resumeSessionId)) {
      throw new RuleError('SESSION_ACTIVE', '同一会话不能同时被两次派单续跑。');
    }
  }
  let content = params.content ?? card.content;
  if (card.repairOfCardId && purpose === 'execution') {
    const original = cardDetails(store, work.id, card.repairOfCardId);
    if (!original.cardBranch || ['completed', 'cancelled'].includes(original.status)) throw new RuleError('REPAIR_SOURCE_UNAVAILABLE', '修复自卡片的分支已不可用。');
    content = `修复自卡片 ${original.id}。请把原卡片分支 ${original.cardBranch} 合进当前卡片分支并解决冲突，保留合并关系。\n\n${content}`;
  }
  const description = purpose === 'verification' ? store.descriptions(work.id).find(item => item.id === work.activeDescriptionId) : undefined;
  const cardContentSnapshot = purpose === 'verification' ? card.content : null;
  if (cardContentSnapshot !== null) content = `卡片说明快照：\n${cardContentSnapshot}\n\n${content}`;
  const copy = cardCopy(store, work.id, card.id);
  const id = randomUUID();
  const outputPath = join(store.dataDir, 'dispatches', id, 'steps');
  mkdirSync(outputPath, { recursive: true });
  return store.transaction(() => {
    store.db.prepare(`INSERT INTO dispatches
      (id, work_id, card_id, key, purpose, template_id, template_snapshot, content, status, resume_session_id, session_id, created_at, output_path,
        needs_browser, card_content_snapshot, work_description_id, work_description_version)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, work.id, card.id, params.key, purpose, template.id, JSON.stringify(template), content,
        params.resumeSessionId ?? null, params.resumeSessionId ?? null, new Date().toISOString(), outputPath,
        params.needsBrowser ? 1 : 0, cardContentSnapshot, description?.id ?? null, description?.version ?? null);
    store.db.prepare(`UPDATE cards SET work_path = ?, card_branch = ?, template_id = ?, latest_dispatch_id = ?, current_step = 0, latest_step_summary = NULL WHERE id = ?`)
      .run(copy.workPath, copy.cardBranch, template.id, id, card.id);
    const dispatch = getDispatch(store, work.id, id);
    store.appendEvent(actor, { type: 'dispatch', id }, 'dispatch-created', dispatch, { workId: work.id, cardId: card.id, dispatchId: id });
    return dispatch;
  });
}

export function activeDispatch(store: TaskStore, actor: Actor) {
  if (!actor.workId) throw new RuleError('INVALID_TOKEN', '派单令牌无效。', 401);
  const dispatch = getDispatch(store, actor.workId, actor.id);
  if (dispatch.status !== 'running' || dispatch.abortReason) throw new RuleError('INVALID_TOKEN', '派单令牌已失效。', 401);
  return dispatch;
}

export function submitConclusion(store: TaskStore, actor: Actor, params: { conclusion: Exclude<Dispatch['conclusion'], 'undeclared'>; reason: string }) {
  const dispatch = activeDispatch(store, actor);
  const allowed = dispatch.purpose === 'verification' ? ['passed', 'failed'] : ['completed', 'blocked'];
  if (!allowed.includes(params.conclusion)) throw new RuleError('INVALID_PARAMS', '结论必须符合派单用途：执行报完成或受阻，验收报通过或不通过。', 400);
  if (dispatch.conclusion === params.conclusion && dispatch.conclusionReason === params.reason) return { conclusion: params.conclusion, reason: params.reason };
  store.db.prepare('UPDATE dispatches SET conclusion = ?, conclusion_reason = ? WHERE id = ?').run(params.conclusion, params.reason, dispatch.id);
  store.appendEvent(actor, { type: 'dispatch', id: dispatch.id }, 'conclusion-submitted', params,
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id });
  return { conclusion: params.conclusion, reason: params.reason };
}

export function revokeDispatch(store: TaskStore, actor: Actor, params: { workId: string; dispatchId: string; reason: string }) {
  const dispatch = getDispatch(store, params.workId, params.dispatchId);
  if (dispatch.status === 'ended' || dispatch.abortReason) return dispatch;
  store.db.prepare('UPDATE dispatches SET abort_reason = ? WHERE id = ?').run(params.reason, dispatch.id);
  store.appendEvent(actor, { type: 'dispatch', id: dispatch.id }, 'dispatch-revoked', { reason: params.reason },
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id });
  return getDispatch(store, params.workId, params.dispatchId);
}

export function dispatchOutput(store: TaskStore, params: { workId: string; dispatchId: string; fromStep?: number; toStep?: number }) {
  const dispatch = getDispatch(store, params.workId, params.dispatchId);
  // The latest dispatch may already differ; files remain the source for older outputs.
  const from = params.fromStep ?? 1;
  const to = params.toStep ?? Number.MAX_SAFE_INTEGER;
  if (to < from) throw new RuleError('INVALID_PARAMS', '结束步骤不能小于开始步骤。', 400);
  return readdirSync(dispatch.outputPath).filter(name => /^\d+\.json$/.test(name))
    .map(name => Number(name.slice(0, -5))).filter(step => step >= from && step <= to).sort((a, b) => a - b)
    .map(step => JSON.parse(readFileSync(join(dispatch.outputPath, `${step}.json`), 'utf8')) as unknown);
}

export function dispatchArtifacts(store: TaskStore, workId: string, dispatchId: string) {
  getDispatch(store, workId, dispatchId);
  return store.db.prepare('SELECT id, dispatch_id AS dispatchId, kind, name, path, ref, commit_sha AS commitSha FROM artifacts WHERE dispatch_id = ? ORDER BY rowid').all(dispatchId);
}

export function saveArtifact(store: TaskStore, dispatch: Dispatch, kind: 'branch' | 'file' | 'test-output', name: string, value: string | Buffer, commit?: string) {
  const id = randomUUID();
  const path = kind === 'branch' ? null : join(store.dataDir, 'dispatches', dispatch.id, 'artifacts', id);
  if (path) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, value); }
  store.db.prepare('INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, dispatch.id, kind, name, path, kind === 'branch' ? value : null, commit ?? null);
  store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'artifact', id }, 'artifact-saved', { kind, name, path, ref: kind === 'branch' ? value : null, commitSha: commit ?? null },
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id });
}

export function reportedArtifact(workPath: string, path: string) {
  const source = realpathSync(resolve(workPath, path));
  const suffix = relative(realpathSync(workPath), source);
  if (suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix)) throw new RuleError('ARTIFACT_SCOPE', '成果文件必须位于卡片副本中。');
  return { name: suffix, content: readFileSync(source, 'utf8') };
}

export function readArtifact(store: TaskStore, workId: string, artifactId: string, encoding: 'utf8' | 'base64' = 'utf8') {
  store.work(workId);
  const artifact = store.db.prepare(`SELECT a.id, a.kind, a.name, a.path, a.ref, a.commit_sha AS commitSha FROM artifacts a
    JOIN dispatches d ON d.id = a.dispatch_id WHERE a.id = ? AND d.work_id = ?`).get(artifactId, workId);
  if (!artifact) throw new RuleError('INVALID_ARTIFACT', '成果必须属于这项工作。', 400);
  return { ...artifact, content: artifact.path ? readFileSync(String(artifact.path)).toString(encoding) : null };
}
