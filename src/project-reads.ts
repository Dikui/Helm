import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RuleError } from './store.js';

export function projectGitRoot(path: string): string | null {
  try {
    return realpathSync(execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
    }).trim());
  } catch { return null; }
}

// Copies need a checked-out local branch with a commit, not just git init.
export function projectGitReady(path: string): boolean {
  if (!projectGitRoot(path)) return false;
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
  }).trim();
  try {
    const branch = git('symbolic-ref', 'HEAD');
    if (!branch.startsWith('refs/heads/')) return false;
    git('rev-parse', '--verify', '--end-of-options', `${branch}^{commit}`);
    return true;
  } catch { return false; }
}

// shortcut: symlinked directories are not listed; follow them if users keep projects behind links.
export function listDirectories(path = homedir()) {
  const directory = resolve(path);
  let entries;
  try { entries = readdirSync(directory, { withFileTypes: true }); } catch { throw new RuleError('DIRECTORY_UNAVAILABLE', '无法读取这个目录。', 400); }
  return { path: directory, directories: entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => ({ name: entry.name, git: existsSync(join(directory, entry.name, '.git')) }))
    .sort((a, b) => a.name.localeCompare(b.name)) };
}

export function projectBranches(path: string) {
  const git = (...args: string[]) => execFileSync('git', ['-C', path, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
  }).trim();
  try {
    const branches = git('for-each-ref', '--format=%(refname:strip=2)', 'refs/heads/').split('\n').filter(Boolean);
    let currentBranch: string | null = null;
    try { currentBranch = git('symbolic-ref', 'HEAD').replace(/^refs\/heads\//, ''); } catch { /* Detached HEAD. */ }
    return { currentBranch, branches };
  } catch { throw new RuleError('PROJECT_BRANCHES_UNAVAILABLE', '无法读取项目分支，请检查项目路径后重试。'); }
}

// Keep live git metadata out of persisted project settings and write responses.
export function projectGitStatus(project: Record<string, unknown>) {
  const isGit = projectGitReady(String(project.path));
  if (!isGit) return { ...project, isGit, currentBranch: null, headCommit: null, uncommittedChanges: null,
    gitStatusReason: '项目目录没有可读取的 git 工作树、本地检出分支或初始提交。' };
  const git = (...args: string[]) => execFileSync('git', ['-C', String(project.path), ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 3_000,
  });
  try {
    const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
    const headCommit = git('rev-parse', '--verify', 'HEAD^{commit}').trim();
    const entries = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0');
    let uncommittedChanges = 0;
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      if (!entry) continue;
      uncommittedChanges++;
      // A rename/copy has a second NUL-delimited pathname, not another change.
      if (/[RC]/.test(entry.slice(0, 2))) index++;
    }
    return { ...project, isGit, currentBranch: branch === 'HEAD' ? null : branch, headCommit, uncommittedChanges, gitStatusReason: null };
  } catch (error) {
    return { ...project, isGit, currentBranch: null, headCommit: null, uncommittedChanges: null,
      gitStatusReason: `无法读取项目 git 状态：${error instanceof Error ? error.message : String(error)}` };
  }
}
