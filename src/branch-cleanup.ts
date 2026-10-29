import { execFileSync } from 'node:child_process';
import { RuleError } from './store.js';

function git(project: string, ...args: string[]) {
  return execFileSync('git', ['-C', project, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitError(error: unknown) {
  const failure = error as { stderr?: string; message?: string };
  return new RuleError('GIT_ERROR', String(failure.stderr || failure.message || error).trim());
}

export function branchExists(project: string, branch: string) {
  try { git(project, 'show-ref', '--verify', '--quiet', `refs/heads/${branch}`); return true; }
  catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw gitError(error);
  }
}

export function branchIsContained(project: string, branch: string, baseRef: string | null) {
  if (!baseRef) throw new Error('工作未记录基准分支，无法判断分支是否已合入。');
  const base = baseRef.startsWith('refs/heads/') ? baseRef : `refs/heads/${baseRef}`;
  try { git(project, 'merge-base', '--is-ancestor', `refs/heads/${branch}`, base); return true; }
  catch (error) {
    if ((error as { status?: number }).status === 1) return false;
    throw gitError(error);
  }
}

// Callers either check containment first or explicitly choose to discard the branch.
export function deleteBranch(project: string, branch: string) {
  try {
    git(project, 'worktree', 'prune');
    git(project, 'branch', '-D', branch);
  } catch (error) { throw gitError(error); }
}
