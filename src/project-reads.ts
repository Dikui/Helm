import { execFileSync } from 'node:child_process';

// Keep live git metadata out of persisted project settings and write responses.
export function projectGitStatus(project: Record<string, unknown>) {
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
    return { ...project, currentBranch: branch === 'HEAD' ? null : branch, headCommit, uncommittedChanges, gitStatusReason: null };
  } catch (error) {
    return { ...project, currentBranch: null, headCommit: null, uncommittedChanges: null,
      gitStatusReason: `无法读取项目 git 状态：${error instanceof Error ? error.message : String(error)}` };
  }
}
