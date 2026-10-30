import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { RuleError, TaskStore, type Actor, type WorkDescription } from './store.js';
import { refreshCardReadiness } from './graph.js';
import { deleteBranch } from './branch-cleanup.js';
import { runtimeMessage } from './work-control.js';
import { projectGitReady, projectGitRoot } from './project-reads.js';

function git(path: string, ...args: string[]) {
  try { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new RuleError('GIT_ERROR', 'git 操作失败，请检查项目、基准 ref 和工作分支。'); }
}

function resolveBaseCommit(project: string, baseRef: string) {
  const ref = `refs/heads/${baseRef}`;
  return git(project, 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`);
}

function validWorkCopy(project: string, path: string, branch: string) {
  try {
    return !lstatSync(path).isSymbolicLink() && git(path, 'rev-parse', '--show-toplevel') === path
      && git(path, 'symbolic-ref', '--short', 'HEAD') === branch
      && realpathSync(git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir'))
        === realpathSync(git(project, 'rev-parse', '--path-format=absolute', '--git-common-dir'));
  } catch { return false; }
}

function assertOwnedWorkPath(store: TaskStore, workId: string, path: string) {
  const expected = resolve(join(store.dataDir, 'worktrees', workId, '_work'));
  let parent = dirname(path);
  while (!existsSync(parent)) parent = dirname(parent);
  const suffix = relative(realpathSync(store.dataDir), realpathSync(parent));
  if (path !== expected || suffix === '..' || suffix.startsWith('../') || isAbsolute(suffix)) {
    throw new RuleError('WORK_PATH_CONFLICT', '工作副本只能在 Helm 数据目录内修复。');
  }
}

export function projectPath(store: TaskStore, workId: string) {
  const work = store.work(workId);
  return String(store.db.prepare('SELECT path FROM projects WHERE id = ?').get(work.projectId)!.path);
}

export function recordBaseBranch(store: TaskStore, workId: string, selectedBase?: string) {
  const work = store.work(workId);
  const project = projectPath(store, workId);
  const draft = store.descriptions(workId).at(-1);
  let baseRef = work.baseRef ?? selectedBase ?? draft?.baseRef;
  if (!baseRef) {
    try { baseRef = git(project, 'symbolic-ref', 'HEAD').replace(/^refs\/heads\//, ''); }
    catch { throw new RuleError('INVALID_BASE_BRANCH', '项目未检出本地分支，请指定基准分支。', 400); }
  }
  if (!work.baseRef) {
    try {
      git(project, 'check-ref-format', `refs/heads/${baseRef}`);
      git(project, 'rev-parse', '--verify', '--end-of-options', `refs/heads/${baseRef}^{commit}`);
    } catch { throw new RuleError('INVALID_BASE_BRANCH', '基准必须是已存在的本地分支，请指定基准分支。', 400); }
  }
  store.db.prepare('UPDATE works SET base_ref = ? WHERE id = ?').run(baseRef, workId);
  return baseRef;
}

export function ensureWorkCopy(store: TaskStore, workId: string) {
  const work = store.work(workId);
  const project = projectPath(store, workId);
  const baseRef = recordBaseBranch(store, workId);
  const baseCommit = work.workBranch ? work.baseCommit ?? resolveBaseCommit(project, baseRef) : resolveBaseCommit(project, baseRef);
  const workBranch = work.workBranch ?? `helm/${work.id}`;
  const workPath = work.workPath ?? resolve(join(store.dataDir, 'worktrees', work.id, '_work'));
  const projectDiffers = !work.workPath && (git(project, 'rev-parse', '--symbolic-full-name', 'HEAD') !== `refs/heads/${baseRef}`
    || Boolean(git(project, 'status', '--porcelain')));
  let createdBranch = false;
  let addingCopy = false;
  try {
    const branches = git(project, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${workBranch}`);
    if (branches && !work.workBranch) {
      // A rolled-back transaction may leave a branch at an older base commit.
      // Only reuse it when every commit is already contained in the current base.
      try { git(project, 'merge-base', '--is-ancestor', `refs/heads/${workBranch}`, baseCommit); }
      catch { throw new RuleError('WORK_BRANCH_CONFLICT', '已有工作分支包含基准之外的提交。'); }
    }
    const validCopy = validWorkCopy(project, workPath, workBranch);
    if (!work.workBranch) {
      assertOwnedWorkPath(store, work.id, workPath);
      if (!validCopy) {
        // Only this Helm-owned path is disposable; never follow a parent symlink outside dataDir.
        if (existsSync(workPath) && !lstatSync(workPath).isSymbolicLink()) {
          try { git(project, 'worktree', 'remove', '--force', workPath); } catch { /* Checkout may have stopped before registration. */ }
        }
        rmSync(workPath, { recursive: true, force: true });
        git(project, 'worktree', 'prune');
      }
      if (branches && git(project, 'rev-parse', `refs/heads/${workBranch}`) !== baseCommit) {
        if (validCopy) git(workPath, 'reset', '--keep', baseCommit);
        else git(project, 'branch', '-f', workBranch, baseCommit);
      }
    }
    if (!branches) { git(project, 'branch', workBranch, baseCommit); createdBranch = true; }
    if (existsSync(workPath)) {
      if (!validCopy) {
        throw new RuleError('WORK_PATH_CONFLICT', '工作分支的 _work 路径已被占用。');
      }
    } else {
      mkdirSync(dirname(workPath), { recursive: true });
      addingCopy = true;
      git(project, 'worktree', 'add', workPath, workBranch);
    }
  } catch (error) {
    // post-checkout can fail after git has already registered and populated the copy.
    if (addingCopy) {
      try { git(project, 'worktree', 'remove', '--force', workPath); } catch { /* git may have failed before registering it. */ }
    }
    if (createdBranch) deleteBranch(project, workBranch);
    throw error;
  }
  store.db.prepare('UPDATE works SET base_ref = ?, base_commit = ?, work_branch = ?, work_path = ? WHERE id = ?')
    .run(baseRef, baseCommit, workBranch, workPath, work.id);
  if (projectDiffers) runtimeMessage(store, workId, 'runtime-work-copy',
    `已从基准分支 ${baseRef} 的最新提交建立工作副本。项目目录当前检出的不是基准分支，或有未提交改动；工作副本不包含这些差异和未提交改动。`);
  return store.work(workId);
}

export function confirmationDetails<T extends object>(store: TaskStore, gate: T) {
  const fields = gate as { kind?: unknown; workId?: unknown; descriptionId?: unknown };
  if (fields.kind !== 'work-confirmation') return gate;
  const description = store.descriptions(String(fields.workId)).find(item => item.id === fields.descriptionId) ?? null;
  const work = store.work(String(fields.workId));
  let uncommittedChanges = '';
  // Keep history and the confirmation gate readable after cleanup or a failed copy repair.
  const path = work.workPath ?? projectPath(store, work.id);
  if (existsSync(path)) {
    try { uncommittedChanges = git(path, 'status', '--porcelain'); } catch { /* Confirmation reports the git error when retried. */ }
  }
  return { ...gate, description, baseRef: description?.baseRef ?? null, baseCommit: description?.baseCommit ?? null,
    uncommittedChanges };
}

export function draftDescription(store: TaskStore, actor: Actor, params: {
  workId: string; key: string; requirements: string; boundary: string; criteria: string; baseRef?: string;
}) {
  const work = store.work(params.workId);
  const versions = store.descriptions(work.id);
  const existing = versions.find(item => item.key === params.key);
  if (existing) return existing;
  const path = projectPath(store, work.id);
  if (work.baseRef && params.baseRef && params.baseRef !== work.baseRef) throw new RuleError('BASE_REF_FIXED', '创建后不能改变工作的基准分支。');
  const baseRef = (work.baseRef ? projectGitRoot(path) : projectGitReady(path)) ? recordBaseBranch(store, work.id, params.baseRef) : null;
  const baseCommit = baseRef ? work.baseCommit ?? resolveBaseCommit(path, baseRef) : null;
  let gate = store.db.prepare(`SELECT id FROM gates WHERE work_id = ? AND kind = 'work-confirmation' AND status = 'pending'`).get(work.id);
  if (!gate) {
    const id = randomUUID();
    const event = store.appendEvent(actor, { type: 'gate', id }, 'gate-created', { kind: 'work-confirmation', question: '确认工作说明' }, { workId: work.id });
    store.db.prepare(`INSERT INTO gates (id, work_id, kind, status, question, created_at, sequence, creator_type, creator_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, work.id, 'work-confirmation', 'pending', '确认工作说明', event.time, event.id, actor.type, actor.id);
    store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'gate', id }, 'needs-user-attention', { kind: 'work-confirmation' }, { workId: work.id });
    gate = { id };
  }
  const description: WorkDescription = {
    id: randomUUID(), workId: work.id, version: versions.length + 1, status: 'draft', key: params.key,
    requirements: params.requirements, boundary: params.boundary, criteria: params.criteria,
    gateId: String(gate.id), baseRef, baseCommit,
  };
  store.db.prepare('INSERT INTO work_descriptions VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    description.id, work.id, description.version, description.status, params.key, params.requirements, params.boundary,
    params.criteria, description.gateId, baseRef, baseCommit,
  );
  store.db.prepare('UPDATE gates SET description_id = ? WHERE id = ?').run(description.id, description.gateId);
  store.appendEvent(actor, { type: 'work-description', id: description.id }, 'work-description-drafted', description, { workId: work.id });
  return description;
}

// External git actions precede the state transaction and can be repeated after an interrupted operation.
export function confirmDescription(store: TaskStore, actor: Actor, params: {
  workId: string; gateId: string; decision: string; descriptionId: string;
}) {
  const work = store.work(params.workId);
  const gate = store.db.prepare('SELECT * FROM gates WHERE id = ? AND work_id = ?').get(params.gateId, work.id);
  if (!gate) throw new RuleError('INVALID_GATE', '关卡必须属于这项工作。', 400);
  if (gate.kind !== 'work-confirmation') throw new RuleError('INVALID_GATE', '这里只能确认工作说明。', 400);
  if (gate.description_id === null) throw new RuleError('NO_DESCRIPTION', '调度者尚未起草工作说明。');
  if (gate.description_id !== params.descriptionId) throw new RuleError('STALE_DESCRIPTION', '工作说明已更新，请重新查看关卡后确认。');
  if (gate.status === 'decided') return store.work(work.id);
  const description = store.descriptions(work.id).find(item => item.id === params.descriptionId);
  if (!description) throw new RuleError('NO_DESCRIPTION', '调度者尚未起草工作说明。');
  const { workPath, workBranch } = work;
  const project = projectPath(store, work.id);
  const baseRef = (work.baseRef ? projectGitRoot(project) : projectGitReady(project)) ? recordBaseBranch(store, work.id) : null;
  let baseCommit = baseRef ? work.baseCommit ?? description.baseCommit : null;
  if (workPath && workBranch && (git(workPath, 'rev-parse', '--show-toplevel') !== workPath
    || git(workPath, 'symbolic-ref', '--short', 'HEAD') !== workBranch)) {
    throw new RuleError('WORK_PATH_CONFLICT', '工作分支的 _work 路径已被占用。');
  }
  // Equality with the recorded starting point means there are no work commits to preserve.
  if (baseRef && (!workBranch || git(project, 'rev-parse', `refs/heads/${workBranch}`) === baseCommit)) {
    const latest = resolveBaseCommit(project, baseRef);
    if (workBranch && latest !== baseCommit) {
      if (workPath) git(workPath, 'reset', '--keep', latest);
      else git(project, 'branch', '-f', workBranch, latest);
    }
    baseCommit = latest;
  }
  return store.transaction(() => {
    store.db.prepare(`UPDATE work_descriptions SET status = 'superseded' WHERE work_id = ? AND status = 'active'`).run(work.id);
    store.db.prepare(`UPDATE work_descriptions SET status = 'active', base_ref = ?, base_commit = ? WHERE id = ?`).run(baseRef, baseCommit, description.id);
    store.db.prepare(`UPDATE gates SET status = 'decided', decision = ? WHERE id = ?`).run(params.decision, params.gateId);
    const status = store.gates(work.id).some(item => item.kind === 'review' && item.status === 'pending') ? 'awaiting-review' : 'executing';
    store.db.prepare(`UPDATE works SET status = CASE WHEN status = 'paused' THEN status ELSE ? END,
      paused_from_status = CASE WHEN status = 'paused' THEN ? ELSE paused_from_status END,
      base_ref = ?, base_commit = ?, work_branch = ?, work_path = ?, active_description_id = ? WHERE id = ?`)
      .run(status, status, baseRef, baseCommit, workBranch, workPath, description.id, work.id);
    const event = store.appendEvent(actor, { type: 'gate', id: params.gateId }, 'gate-decided', { decision: params.decision, descriptionId: description.id, baseRef, baseCommit, workBranch, workPath }, { workId: work.id });
    store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, work.id);
    refreshCardReadiness(store, work.id);
    return store.work(work.id);
  });
}
