import { abortCardGit, dispatchGit, type Dispatch } from './dispatch.js';
import type { TaskStore } from './store.js';

// The runner has already stopped all processes before touching the copy.
export function resetVerificationCopy(store: TaskStore, dispatch: Dispatch, workPath: string, cardBranch: string, startCommit: string) {
  abortCardGit(store, dispatch, workPath);
  // Tests may leave HEAD detached; restore the card branch as well as the files.
  dispatchGit(workPath, 'symbolic-ref', 'HEAD', `refs/heads/${cardBranch}`);
  dispatchGit(workPath, 'reset', '--hard', startCommit);
  dispatchGit(workPath, 'clean', '-fd');
}
