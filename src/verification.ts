import { cpSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { projectPath } from './alignment.js';
import { dispatchGit, type Dispatch } from './dispatch.js';
import { cardDetails } from './graph.js';
import { projectGitRoot } from './project-reads.js';
import { scratchPath } from './scratch.js';
import type { TaskStore } from './store.js';

// Each verification gets a throwaway copy, outside the card's execution directory.
export const verificationPath = (store: TaskStore, dispatch: Pick<Dispatch, 'workId' | 'id'>) =>
  resolve(store.dataDir, 'worktrees', dispatch.workId, 'verifications', dispatch.id);

// The caller has already stopped every process inside the copy.
export function removeVerificationCopy(store: TaskStore, workId: string, path: string) {
  rmSync(path, { recursive: true, force: true });
  const project = projectPath(store, workId);
  if (projectGitRoot(project)) dispatchGit(project, 'worktree', 'prune');
}

export function createVerificationCopy(store: TaskStore, dispatch: Dispatch, commit: string | null) {
  const path = verificationPath(store, dispatch);
  // A crash during an earlier start may have left a partial copy.
  removeVerificationCopy(store, dispatch.workId, path);
  mkdirSync(dirname(path), { recursive: true });
  if (cardDetails(store, dispatch.workId, dispatch.cardId).workspace === 'scratch') {
    const source = scratchPath(store, dispatch.workId, dispatch.cardId);
    if (existsSync(source)) cpSync(source, path, { recursive: true, filter: entry => !lstatSync(entry).isSymbolicLink() });
    else mkdirSync(path);
  } else dispatchGit(projectPath(store, dispatch.workId), 'worktree', 'add', '--detach', path, commit!);
}
