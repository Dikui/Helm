import { useEffect, useRef, useState } from 'react';
import { useData } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { PushPreview, Work } from '../../shared/types.js';
import { ActionDialog } from './ActionDialog.js';
import './work-delivery.css';

export function WorkDelivery({ work }: { work: Pick<Work, 'id' | 'status' | 'delivery' | 'workBranch'> }) {
  const { api } = useData();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<Error>();
  const [changes, setChanges] = useState<{ toCommit?: string; diff: string }>();
  const [notContained, setNotContained] = useState(false);
  const [finishConfirm, setFinishConfirm] = useState(false);
  const finishTrigger = useRef<HTMLButtonElement>(null);
  const [preview, setPreview] = useState<PushPreview>();
  const [previewRevision, setPreviewRevision] = useState(0);
  const merge = work.delivery?.merge;
  const push = work.delivery?.push;
  const withoutMerge = work.delivery?.completedWithoutMerge;
  const noCodeChanges = !work.workBranch;
  const canPush = !noCodeChanges && work.status === 'completed' && !withoutMerge && ['merged', 'already-contained'].includes(merge?.status ?? '') && push?.status !== 'pushed';
  useEffect(() => {
    setPreview(undefined);
    if (!canPush) return;
    let stale = false;
    setError(undefined);
    void api.call<PushPreview>('get-work-push-preview', { workId: work.id }).then(result => { if (!stale) setPreview(result); })
      .catch(error => { if (!stale) setError(error as Error); });
    return () => { stale = true; };
  }, [api, work.id, canPush, previewRevision]);
  const resolution = work.delivery?.resolution;
  const solving = resolution?.status === 'solving' && ['executing', 'paused'].includes(work.status);
  const manual = resolution?.status === 'manual' && work.status === 'accepted';
  const resolved = resolution?.status === 'resolved';
  if (noCodeChanges && work.status !== 'completed') return null;
  if (!solving && !['accepted', 'merge-queued', 'merging', 'completed'].includes(work.status)) return null;
  const failedMerge = work.status === 'accepted' && merge?.status === 'failed';
  const conflict = work.status === 'accepted' && merge?.status === 'conflict';
  const failedPush = canPush && push?.status === 'failed';
  const inFlight = pending || ['merge-queued', 'merging'].includes(work.status);
  const title = failedPush ? 'deliveryPushFailed' : work.status === 'completed'
    ? push?.status === 'pushed' ? 'deliveryPushed' : merge?.status === 'already-contained' && !withoutMerge ? 'deliveryContained' : 'deliveryCompleted'
    : solving ? 'deliverySolving' : manual ? 'deliveryManual'
    : resolved && work.status === 'accepted' ? 'deliveryResolved' : conflict ? 'deliveryConflict' : failedMerge ? 'deliveryMergeFailed' : work.status;
  async function run(operation: string, params: object = {}) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(undefined);
    try {
      const result = await api.call<{ status?: string; toCommit?: string; diff: string }>(operation, { workId: work.id, ...params });
      if (operation === 'finish-work-without-merge') setFinishConfirm(false);
      if (operation === 'get-conflict-resolution') setChanges(result);
      if (operation === 'recheck-work-merge') setNotContained(result.status === 'accepted');
    }
    catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="release-panel" aria-label={t('deliveryTitle')} aria-busy={inFlight}>
    <h2>{t(title)}</h2>
    <p>{t(solving ? 'deliverySolvingHint' : manual ? 'deliveryManualHint' : resolved && work.status === 'accepted' ? 'deliveryResolvedHint'
      : work.status === 'accepted' ? conflict ? 'deliveryConflictHint' : 'deliveryAcceptedHint'
      : work.status === 'merge-queued' ? 'deliveryQueuedHint' : work.status === 'merging' ? 'deliveryMergingHint'
      : noCodeChanges ? 'deliveryNoCodeChanges' : withoutMerge ? 'deliveryFinishedWithoutMerge' : 'deliveryCompletedHint')}</p>
    {(failedMerge || failedPush) && <p role="alert" className="agent-text">{failedPush ? push?.reason : merge?.reason}</p>}
    {(solving || conflict && !resolved) && <table><thead><tr><th>{t('deliveryConflictFiles')}</th></tr></thead><tbody>
      {merge?.conflictFiles?.map(file => <tr key={file}><td className="agent-text">{file}</td></tr>)}
    </tbody></table>}
    {work.delivery?.cleanup?.reason && <p role="alert">{t('deliveryCleanupFailed')} {work.delivery.cleanup.reason}</p>}
    {manual && <>
      <p className="agent-text">{work.delivery?.merge?.workBranch} → {resolution.baseBranch.replace(/^refs\/heads\//, '')}</p>
      {notContained && <p role="status">{t('deliveryNotContained')}</p>}
    </>}
    {resolved && !withoutMerge && <div>
      <button className="btn sm" disabled={inFlight} onClick={() => void run('get-conflict-resolution')}>{t('deliveryChanges')}</button>
      <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/structure`}>{t('deliveryVerification')}</Link>
      {changes && changes.toCommit === resolution.toCommit && <section aria-label={t('deliveryChanges')}>
        <p className="agent-text">{resolution.fromCommit} → {resolution.toCommit}</p>
        <pre className="conflict-diff">{changes.diff || t('deliveryNoChanges')}</pre>
      </section>}
    </div>}
    {canPush && <section aria-label={t('deliveryPushPreview')}>
      <h3>{t('deliveryPushPreview')}</h3>
      <p>{t('deliveryPushPreviewHint')}</p>
      {!preview && !error && <p role="status">{t('deliveryPushLoading')}</p>}
      {preview?.reason && <p role="status">{preview.reason}</p>}
      {preview?.remote && <p className="agent-text">{preview.remote}/{preview.remoteBranch?.replace(/^refs\/heads\//, '')}</p>}
      {preview?.newBranch && <p>{t('deliveryPushNewBranch')} <span className="agent-text">{preview.remoteBranch?.replace(/^refs\/heads\//, '')}</span></p>}
      {preview && !preview.reason && (preview.commits.length ? <ul>{preview.commits.map(commit =>
        <li className="agent-text" key={commit.hash}><code>{commit.hash}</code> {commit.subject}</li>)}</ul> : <p>{t('deliveryPushNoCommits')}</p>)}
      <button className="btn sm" disabled={inFlight} onClick={() => setPreviewRevision(value => value + 1)}>{t('deliveryPreviewRefresh')}</button>
    </section>}
    <div className="acts">
      {solving && <>
        <button className="btn sm" disabled>{t('deliverySolvingBusy')}</button>
        <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/chat`}>{t('deliveryProgress')}</Link>
      </>}
      {conflict && !resolved && <>
        {manual && <button className="btn sm primary" disabled={inFlight} onClick={() => void run('recheck-work-merge')}>{t('deliveryRecheck')}</button>}
        <button className={`btn sm ${manual ? '' : 'primary'}`} disabled={inFlight} onClick={() => void run('resolve-merge-conflict', { resolution: 'coordinator' })}>{t(manual ? 'deliverySwitchCoordinator' : 'deliveryCoordinator')}</button>
        {!manual && <button className="btn sm" disabled={inFlight} onClick={() => void run('resolve-merge-conflict', { resolution: 'manual' })}>{t('deliverySelf')}</button>}
      </>}
      {work.status === 'accepted' && !manual && <>
        <button className="btn sm" disabled={inFlight} onClick={() => void run('withdraw-acceptance')}>{t('withdrawAcceptance')}</button>
        {(!conflict || resolved) && <button className="btn sm primary" disabled={inFlight} onClick={() => void run('merge-work')}>{t(resolved ? 'deliveryMergeAgain' : failedMerge ? 'retryMerge' : 'mergeWork')}</button>}
      </>}
      {(work.status === 'accepted' || solving) && <button ref={finishTrigger} className="btn sm" disabled={inFlight} onClick={() => setFinishConfirm(true)}>{t('deliveryFinish')}</button>}
      {['merge-queued', 'merging'].includes(work.status) && <button className="btn sm" disabled>{t(work.status)}</button>}
      {canPush && preview && !preview.reason && (preview.newBranch || preview.commits.length > 0) && <button className="btn sm primary" disabled={inFlight} onClick={() => void run('push-work')}>{t(failedPush ? 'retryPush' : 'pushWork')}</button>}
    </div>
    <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/brief`}>{t('deliveryReviewReport')}</Link>
    {error && !finishConfirm && <ErrorNotice error={error} />}
    {finishConfirm && <ActionDialog title={t('deliveryFinish')} description={t('deliveryFinishHint')} busy={inFlight} onClose={() => setFinishConfirm(false)} returnFocus={finishTrigger}>
      {error && <ErrorNotice error={error} />}
      <button className="btn work-danger" disabled={inFlight} onClick={() => void run('finish-work-without-merge')}>{t('deliveryFinishConfirm')}</button>
    </ActionDialog>}
  </section>;
}
