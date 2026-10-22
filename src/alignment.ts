import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { RuleError, TaskStore, type Actor, type WorkDescription } from './store.js';

function git(path: string, ...args: string[]) {
  try { return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  catch { throw new RuleError('GIT_ERROR', 'git 操作失败，请检查项目、基准 ref 和工作分支。'); }
}

export function projectPath(store: TaskStore, workId: string) {
  const work = store.work(workId);
  return String(store.db.prepare('SELECT path FROM projects WHERE id = ?').get(work.projectId)!.path);
}

export function confirmationDetails(store: TaskStore, gate: Record<string, unknown>) {
  if (gate.kind !== 'work-confirmation') return gate;
  const description = store.descriptions(String(gate.workId)).find(item => item.id === gate.descriptionId) ?? null;
  return { ...gate, description, baseRef: description?.baseRef ?? null, baseCommit: description?.baseCommit ?? null,
    uncommittedChanges: git(projectPath(store, String(gate.workId)), 'status', '--porcelain') };
}

export function draftDescription(store: TaskStore, actor: Actor, params: {
  workId: string; key: string; requirements: string; boundary: string; criteria: string; baseRef?: string;
}) {
  const work = store.work(params.workId);
  const versions = store.descriptions(work.id);
  const existing = versions.find(item => item.key === params.key);
  if (existing) return existing;
  const path = projectPath(store, work.id);
  let baseRef = work.baseRef ?? params.baseRef;
  if (!baseRef) {
    try { baseRef = execFileSync('git', ['-C', path, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
    catch { baseRef = 'HEAD'; }
  }
  if (work.baseRef && params.baseRef && params.baseRef !== work.baseRef) throw new RuleError('BASE_REF_FIXED', '确认后不能改变工作的基准 ref。');
  const baseCommit = work.baseCommit ?? git(path, 'rev-parse', '--verify', '--end-of-options', `${baseRef}^{commit}`);
  let gate = store.db.prepare(`SELECT id FROM gates WHERE work_id = ? AND kind = 'work-confirmation' AND status = 'pending'`).get(work.id);
  if (!gate) {
    const id = randomUUID();
    const event = store.appendEvent(actor, { type: 'gate', id }, 'gate-created', { kind: 'work-confirmation', question: '确认工作说明' }, { workId: work.id });
    store.db.prepare(`INSERT INTO gates (id, work_id, kind, status, question, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?)`)
      .run(id, work.id, 'work-confirmation', 'pending', '确认工作说明', event.time, event.id);
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
  let workPath = work.workPath;
  const workBranch = work.workBranch ?? `helm/${work.id}`;
  if (!workPath) {
    workPath = resolve(join(store.dataDir, 'worktrees', work.id, '_work'));
    const project = projectPath(store, work.id);
    // UUID-derived branch names and paths cannot collide across works.
    const branches = git(project, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${workBranch}`);
    if (!branches) git(project, 'branch', workBranch, description.baseCommit);
    else if (git(project, 'rev-parse', workBranch) !== description.baseCommit) throw new RuleError('WORK_BRANCH_CONFLICT', '已有工作分支不指向确认的基准提交。');
    if (existsSync(workPath)) {
      if (git(workPath, 'rev-parse', '--show-toplevel') !== workPath || git(workPath, 'symbolic-ref', '--short', 'HEAD') !== workBranch) {
        throw new RuleError('WORK_PATH_CONFLICT', '工作分支的 _work 路径已被占用。');
      }
    } else {
      mkdirSync(dirname(workPath), { recursive: true });
      git(project, 'worktree', 'add', workPath, workBranch);
    }
  }
  return store.transaction(() => {
    store.db.prepare(`UPDATE work_descriptions SET status = 'superseded' WHERE work_id = ? AND status = 'active'`).run(work.id);
    store.db.prepare(`UPDATE work_descriptions SET status = 'active' WHERE id = ?`).run(description.id);
    store.db.prepare(`UPDATE gates SET status = 'decided', decision = ? WHERE id = ?`).run(params.decision, params.gateId);
    store.db.prepare(`UPDATE works SET status = 'executing', base_ref = ?, base_commit = ?, work_branch = ?, work_path = ?, active_description_id = ? WHERE id = ?`)
      .run(description.baseRef, description.baseCommit, workBranch, workPath, description.id, work.id);
    const event = store.appendEvent(actor, { type: 'gate', id: params.gateId }, 'gate-decided', { decision: params.decision, descriptionId: description.id, workBranch, workPath }, { workId: work.id });
    store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, work.id);
    return store.work(work.id);
  });
}
