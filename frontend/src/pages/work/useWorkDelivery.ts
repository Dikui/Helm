import { useEffect, useRef, useState } from 'react';
import { useData } from '../../shared/data.js';
import type { PushPreview, Work } from '../../shared/types.js';

export function useWorkDelivery(work: Work) {
  const { api } = useData();
  const [operation, setOperation] = useState<string>();
  const busy = useRef(false);
  const [error, setError] = useState<Error>();
  const [panel, setPanel] = useState<'push' | 'finish' | 'changes' | 'verification' | 'final'>();
  const opener = useRef<HTMLElement | null>(null);
  const [changes, setChanges] = useState<{ toCommit?: string; diff: string }>();
  const [notContained, setNotContained] = useState(false);
  const [preview, setPreview] = useState<PushPreview>();
  const [previewError, setPreviewError] = useState<Error>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const merge = work.delivery?.merge;
  const resolution = work.delivery?.resolution;
  const withoutMerge = work.delivery?.completedWithoutMerge;
  const noCodeChanges = !work.workBranch;
  const merged = !noCodeChanges && work.status === 'completed' && !withoutMerge && ['merged', 'already-contained'].includes(merge?.status ?? '');
  const canPush = merged && work.delivery?.push?.status !== 'pushed';
  const pushing = operation === 'push-work';
  const solving = resolution?.status === 'solving' && ['executing', 'paused'].includes(work.status);
  const manual = resolution?.status === 'manual' && work.status === 'accepted';
  const resolved = resolution?.status === 'resolved' && work.status === 'accepted';
  const failedMerge = work.status === 'accepted' && merge?.status === 'failed';
  const conflict = work.status === 'accepted' && merge?.status === 'conflict';
  const failedPush = canPush && work.delivery?.push?.status === 'failed';
  const inFlight = Boolean(operation) || ['merge-queued', 'merging'].includes(work.status);
  const visible = noCodeChanges ? work.status === 'completed' : solving || ['accepted', 'merge-queued', 'merging', 'completed'].includes(work.status);
  useEffect(() => {
    setPreview(undefined); setPreviewError(undefined);
    if (!merged) return;
    let stale = false;
    void api.call<PushPreview>('get-work-push-preview', { workId: work.id }).then(result => { if (!stale) setPreview(result); })
      .catch(error => { if (!stale) setPreviewError(error as Error); });
    return () => { stale = true; };
  }, [api, work.id, merged, work.delivery?.push?.status, previewRevision]);
  function open(next: typeof panel, from: HTMLElement) {
    opener.current = from; setError(undefined); setPanel(next);
    if (next === 'push') setPreviewRevision(value => value + 1);
    if (next === 'changes') { setChanges(undefined); void run('get-conflict-resolution'); }
  }
  async function run(name: string, params: object = {}) {
    if (busy.current || ['merge-queued', 'merging'].includes(work.status)) return;
    busy.current = true; setOperation(name); setError(undefined);
    try {
      const result = await api.call<{ status?: string; toCommit?: string; diff: string }>(name, { workId: work.id, ...params });
      if (name === 'finish-work-without-merge' || name === 'push-work') setPanel(undefined);
      if (name === 'get-conflict-resolution') setChanges(result);
      if (name === 'recheck-work-merge') setNotContained(result.status === 'accepted');
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setOperation(undefined); }
  }
  return { work, visible, merge, resolution, withoutMerge, noCodeChanges, canPush, pushing, solving, manual, resolved,
    failedMerge, conflict, failedPush, inFlight, error, preview, previewError, panel, opener, changes, notContained,
    open, run, close: () => setPanel(undefined), refreshPreview: () => setPreviewRevision(value => value + 1) };
}
export type WorkDeliveryState = ReturnType<typeof useWorkDelivery>;
