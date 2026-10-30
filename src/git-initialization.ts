import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { projectPath, recordBaseBranch } from './alignment.js';
import { refreshCardReadiness } from './graph.js';
import { projectGitRoot } from './project-reads.js';
import { RuleError, TaskStore, type Actor, type Gate } from './store.js';

export interface GitInitialization {
  projectId: string; projectPath: string; fileCount: number; totalBytes: number; hasGitignore: boolean; ignoreRules: string;
  suspiciousPaths: { path: string; bytes: number; reason: 'large' | 'dependency' | 'secret' }[];
  initialized?: boolean; existingRepository?: boolean; branch?: string; commit?: string;
}

const runtime = { type: 'runtime', id: 'helmd' } as const;
const largeBytes = 32 * 1024 * 1024;
const dependencies = new Set(['node_modules', '.venv', 'venv', 'dist', 'build', 'target', '__pycache__', '.next', '.cache']);
const secret = /^(?:\.env.*|.*\.(?:pem|key)|id_rsa.*|credentials.*)$/i;

function git(path: string, ...args: string[]) {
  return execFileSync('git', ['-C', path, '-c', 'core.hooksPath=/dev/null', ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
  }).trimEnd();
}

function repositoryBase(path: string) {
  if (!projectGitRoot(path)) return null;
  try {
    const branch = git(path, 'symbolic-ref', '--short', 'HEAD');
    return { branch, commit: git(path, 'rev-parse', '--verify', `refs/heads/${branch}^{commit}`) };
  } catch { throw new RuleError('GIT_INITIAL_COMMIT_REQUIRED', '项目已有 git，但没有可用的本地基准分支和提交。请在项目目录完成初始提交或检出本地分支后重试；Helm 没有修改已有仓库。'); }
}

function ignoreRule(path: string) {
  return `/${path.replace(/[\\*?\[\]#! ]/g, '\\$&')}`;
}

function preview(store: TaskStore, projectId: string, path: string): GitInitialization {
  const hasGitignore = existsSync(join(path, '.gitignore'));
  const suspiciousPaths: GitInitialization['suspiciousPaths'] = [];
  const scan = (prefix: string): number => readdirSync(join(path, prefix), { withFileTypes: true }).reduce((bytes, entry) => {
    if (entry.name === '.git') return bytes;
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = lstatSync(join(path, name));
    const size = stat.isDirectory() ? scan(name) : stat.size;
    const reason = secret.test(entry.name) ? 'secret' : stat.isDirectory() && dependencies.has(entry.name) ? 'dependency' : size >= largeBytes ? 'large' : null;
    if (reason) suspiciousPaths.push({ path: name + (stat.isDirectory() ? '/' : ''), bytes: size, reason });
    return bytes + size;
  }, 0);
  if (!hasGitignore) scan('');
  const paths = suspiciousPaths.filter(item => !suspiciousPaths.some(parent => parent !== item && parent.path.endsWith('/') && item.path.startsWith(parent.path)))
    .sort((a, b) => a.path.localeCompare(b.path));
  // Never interpret an unusual filename as another ignore rule.
  if (!hasGitignore && paths.some(item => /[\r\n]/.test(item.path))) throw new RuleError('GIT_PREVIEW_FAILED', '可疑路径包含换行，无法生成可靠的忽略规则。请先自行编写 .gitignore，再重试派单。');
  const ignoreRules = hasGitignore ? readFileSync(join(path, '.gitignore'), 'utf8') : paths.map(item => ignoreRule(item.path)).join('\n') + (paths.length ? '\n' : '');
  const temporary = mkdtempSync(join(store.dataDir, 'git-preview-'));
  try {
    git(temporary, 'init', '--template=');
    // With no root .gitignore, info/exclude has the same precedence relative to nested ignore files.
    if (!hasGitignore) {
      mkdirSync(join(temporary, '.git', 'info'), { recursive: true });
      writeFileSync(join(temporary, '.git', 'info', 'exclude'), ignoreRules);
    }
    const files = git(path, `--git-dir=${join(temporary, '.git')}`, `--work-tree=${path}`, 'ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean);
    return { projectId, projectPath: path, hasGitignore, ignoreRules, suspiciousPaths: hasGitignore ? [] : paths,
      fileCount: files.length + (hasGitignore ? 0 : 1),
      totalBytes: files.reduce((total, name) => total + lstatSync(join(path, name)).size, hasGitignore ? 0 : Buffer.byteLength(ignoreRules)) };
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

// Only runtime-created initialization gates may be shared across works in one project.
export function requireGitInitialization(store: TaskStore, workId: string, cardId: string): never {
  const work = store.work(workId);
  const row = store.db.prepare(`SELECT g.id, g.work_id FROM gates g JOIN works w ON w.id = g.work_id
    WHERE w.project_id = ? AND g.kind = 'git-initialization' AND (g.status = 'pending' OR (g.decision = 'refuse' AND COALESCE(json_extract(g.git_initialization, '$.initialized'), 0) = 0))
    ORDER BY g.sequence DESC LIMIT 1`).get(work.projectId);
  let details: GitInitialization | null = null;
  if (!row) try { details = preview(store, work.projectId, projectPath(store, workId)); }
  catch (error) {
    if (error instanceof RuleError) throw error;
    throw new RuleError('GIT_PREVIEW_FAILED', '无法读取项目文件概况。请检查目录与 .gitignore 是否可读，然后重试派单。');
  }
  const gate = store.transaction(() => {
    const id = row ? String(row.id) : randomUUID();
    if (!row) {
      const event = store.appendEvent(runtime, { type: 'gate', id }, 'gate-created', { kind: 'git-initialization', question: '初始化 git', gitInitialization: details }, { workId });
      store.db.prepare(`INSERT INTO gates (id, work_id, kind, status, question, options, creator_type, creator_id, created_at, sequence, git_initialization)
        VALUES (?, ?, 'git-initialization', 'pending', '初始化 git', '["initialize","refuse"]', 'runtime', 'helmd', ?, ?, ?)`)
        .run(id, workId, event.time, event.id, JSON.stringify(details));
      store.appendEvent(runtime, { type: 'gate', id }, 'needs-user-attention', { kind: 'git-initialization' }, { workId });
    }
    const added = store.db.prepare(`INSERT OR IGNORE INTO dependencies VALUES (?, 'gate', ?, 'card', ?)`).run(workId, id, cardId);
    if (added.changes) store.appendEvent(runtime, { type: 'card', id: cardId }, 'dependency-added',
      { workId, upstream: { type: 'gate', id }, downstream: { type: 'card', id: cardId }, gateWorkId: row?.work_id ?? workId }, { workId, cardId });
    refreshCardReadiness(store, workId);
    return store.gate(workId, id);
  });
  throw new RuleError(gate.decision === 'refuse' ? 'GIT_INITIALIZATION_REFUSED' : 'GIT_INITIALIZATION_PENDING',
    gate.decision === 'refuse' ? `用户已拒绝初始化 git：${gate.comment}。卡片保持阻塞，可改成只读或取消。`
      : '已请用户决定是否初始化 git。卡片已阻塞，请等待关卡决定后重新派单。', 409, { gateId: gate.id, gateWorkId: gate.workId });
}

function finish(store: TaskStore, gate: Gate, actor: Actor, decision: string, comment: string | undefined, base?: { branch: string; commit: string }, existingRepository = false) {
  return store.transaction(() => {
    const details = { ...gate.gitInitialization!, initialized: Boolean(base), existingRepository, ...base };
    store.db.prepare(`UPDATE gates SET status = 'decided', decision = ?, comment = ?, git_initialization = ? WHERE id = ?`)
      .run(decision, comment ?? null, JSON.stringify(details), gate.id);
    const works = new Set([gate.workId, ...store.db.prepare(`SELECT DISTINCT work_id FROM dependencies WHERE upstream_type = 'gate' AND upstream_id = ?`).all(gate.id).map(row => String(row.work_id))]);
    for (const workId of works) {
      if (base && !store.work(workId).baseRef) recordBaseBranch(store, workId, base.branch);
      const event = store.appendEvent(actor, { type: 'gate', id: gate.id }, 'gate-decided',
        { decision, comment: comment ?? null, initialized: Boolean(base), existingRepository, ...base }, { workId });
      store.db.prepare('INSERT INTO wake_queue (event_id, work_id) VALUES (?, ?)').run(event.id, workId);
      refreshCardReadiness(store, workId);
    }
    return store.gate(gate.workId, gate.id);
  });
}

// A user-created repository supersedes the request; no files or existing git metadata are changed.
export function reconcileGitInitialization(store: TaskStore, workId: string) {
  const gates = store.gates(workId).filter(gate => gate.kind === 'git-initialization' && !gate.gitInitialization?.initialized);
  if (!gates.length) return;
  let base;
  try { base = repositoryBase(projectPath(store, workId)); }
  catch (error) {
    if (error instanceof RuleError && error.code === 'GIT_INITIAL_COMMIT_REQUIRED') return;
    throw error;
  }
  if (base) for (const gate of gates) finish(store, gate, runtime, gate.decision ?? 'initialize', gate.comment ?? undefined, base, true);
}

export function decideGitInitialization(store: TaskStore, actor: Actor, params: {
  workId: string; gateId: string; decision: string; comment?: string; ignoreRules?: string;
}) {
  const gate = store.gate(params.workId, params.gateId);
  if (!['initialize', 'refuse'].includes(params.decision)) throw new RuleError('INVALID_PARAMS', '初始化 git 关卡只能选择 initialize 或 refuse。', 400);
  if (gate.status !== 'pending') {
    if (gate.decision !== params.decision) throw new RuleError('GATE_DECIDED', '关卡已经决定，不能改写用户的决定。');
    return gate;
  }
  const path = projectPath(store, params.workId);
  let existing;
  try { existing = repositoryBase(path); }
  catch (error) {
    if (params.decision !== 'refuse' || !(error instanceof RuleError) || error.code !== 'GIT_INITIAL_COMMIT_REQUIRED') throw error;
  }
  if (existing) return finish(store, gate, actor, 'initialize', params.comment, existing, true);
  if (params.decision === 'refuse') {
    if (!params.comment?.trim()) throw new RuleError('INVALID_PARAMS', '拒绝初始化 git 须填写原因。', 400);
    return finish(store, gate, actor, 'refuse', params.comment.trim());
  }
  const ignorePath = join(path, '.gitignore');
  const rules = params.ignoreRules ?? gate.gitInitialization!.ignoreRules;
  if (rules.includes('\0')) throw new RuleError('INVALID_PARAMS', '忽略规则不能包含 NUL 字符。', 400);
  const temporaryPrefix = `.helm-git-init-${gate.id}-`;
  const interrupted = readdirSync(path).find(name => name.startsWith(temporaryPrefix));
  if (interrupted) throw new RuleError('GIT_INITIALIZATION_INTERRUPTED', `上次初始化可能已中断，项目内仍有临时路径 ${interrupted}。请检查并移走这个临时路径后重试；现有文件和 git 状态未修改。`);
  // Keep the final rename on the project's filesystem, including projects on external drives.
  let temporary: string | undefined;
  let wroteIgnore = false;
  const hadGitignore = existsSync(ignorePath);
  try {
    temporary = mkdtempSync(join(path, temporaryPrefix));
    git(temporary, 'init', '--template=');
    if (!hadGitignore) { writeFileSync(ignorePath, rules, { flag: 'wx' }); wroteIgnore = true; }
    const args = [`--git-dir=${join(temporary, '.git')}`, `--work-tree=${path}`];
    git(path, ...args, 'add', '--all', '--', '.', `:(exclude,top,literal)${basename(temporary)}`);
    git(path, ...args, '-c', 'user.name=Helm', '-c', 'user.email=helm@localhost', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Initial project files');
    const branch = git(path, ...args, 'symbolic-ref', '--short', 'HEAD');
    const commit = git(path, ...args, 'rev-parse', 'HEAD');
    if (existsSync(join(path, '.git')) || projectGitRoot(path)) throw new Error('项目的 git 状态已变化，请重新查看关卡后重试。');
    renameSync(join(temporary, '.git'), join(path, '.git'));
    return finish(store, { ...gate, gitInitialization: { ...gate.gitInitialization!, hasGitignore: hadGitignore, ignoreRules: readFileSync(ignorePath, 'utf8') } }, actor, 'initialize', params.comment, { branch, commit });
  } catch (error) {
    // A completed repository survives a database failure and is recognized on retry.
    const initialized = Boolean(projectGitRoot(path));
    if (!initialized && wroteIgnore && existsSync(ignorePath) && readFileSync(ignorePath, 'utf8') === rules) rmSync(ignorePath);
    throw new RuleError('GIT_INITIALIZATION_FAILED', initialized
      ? 'git 仓库已存在，但关卡未完成。请重试决定；Helm 将识别已有仓库。'
      : '初始化 git 失败，临时 git 元数据已清理，关卡仍待决定。请检查项目权限、忽略规则和可提交文件后重试。', 409,
    { cause: error instanceof Error ? error.message : String(error), initialized });
  } finally { if (temporary) rmSync(temporary, { recursive: true, force: true }); }
}
