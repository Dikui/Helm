import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { dispatchGit, type Dispatch } from './dispatch.js';
import type { TaskStore } from './store.js';

// Each verification gets a throwaway detached copy of its pinned commit, outside the card copy.
export const verificationPath = (store: TaskStore, dispatch: Pick<Dispatch, 'workId' | 'id'>) =>
  resolve(store.dataDir, 'worktrees', dispatch.workId, 'verifications', dispatch.id);

// The caller has already stopped every process inside the copy.
export function removeVerificationCopy(store: TaskStore, workId: string, path: string) {
  rmSync(path, { recursive: true, force: true });
  dispatchGit(projectPath(store, workId), 'worktree', 'prune');
}

export function createVerificationCopy(store: TaskStore, dispatch: Dispatch, commit: string) {
  const path = verificationPath(store, dispatch);
  // A crash during an earlier start may have left a partial copy.
  removeVerificationCopy(store, dispatch.workId, path);
  mkdirSync(dirname(path), { recursive: true });
  dispatchGit(projectPath(store, dispatch.workId), 'worktree', 'add', '--detach', path, commit);
}
