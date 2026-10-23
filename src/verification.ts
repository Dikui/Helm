import { abortCardGit, dispatchGit, listDispatches, type Dispatch } from './dispatch.js';
import type { TaskStore } from './store.js';

export function refreshVerificationCopy(store: TaskStore, dispatch: Dispatch, workPath: string, cardBranch: string) {
  if (dispatch.purpose !== 'verification' || listDispatches(store, dispatch.workId, dispatch.cardId).some(item => item.purpose === 'execution')) return;
  const work = store.work(dispatch.workId);
  const previousCommit = dispatchGit(workPath, 'rev-parse', 'HEAD');
  const startCommit = dispatchGit(workPath, 'rev-parse', `refs/heads/${work.workBranch}`);
  dispatchGit(workPath, 'reset', '--hard', startCommit);
  store.transaction(() => store.appendEvent({ type: 'runtime', id: 'helmd' }, { type: 'dispatch', id: dispatch.id },
    'verification-copy-refreshed', { cardBranch, workBranch: work.workBranch, previousCommit, startCommit },
    { workId: dispatch.workId, cardId: dispatch.cardId, dispatchId: dispatch.id }));
}

// The runner has already stopped all processes before touching the copy.
export function resetVerificationCopy(store: TaskStore, dispatch: Dispatch, workPath: string, cardBranch: string, startCommit: string) {
  abortCardGit(store, dispatch, workPath);
  // Tests may leave HEAD detached; restore the card branch as well as the files.
  dispatchGit(workPath, 'symbolic-ref', 'HEAD', `refs/heads/${cardBranch}`);
  dispatchGit(workPath, 'reset', '--hard', startCommit);
  dispatchGit(workPath, 'clean', '-fd');
}
