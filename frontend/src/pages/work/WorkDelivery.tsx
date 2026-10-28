import { useRef, useState } from 'react';
import { useData } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { Work } from '../../shared/types.js';
import './work-delivery.css';

export function WorkDelivery({ work }: { work: Pick<Work, 'id' | 'status' | 'delivery'> }) {
  const { api } = useData();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<Error>();
  const [changes, setChanges] = useState<{ toCommit?: string; diff: string }>();
  const [notContained, setNotContained] = useState(false);
  const resolution = work.delivery?.resolution;
  const solving = resolution?.status === 'solving' && ['executing', 'paused'].includes(work.status);
  const manual = resolution?.status === 'manual' && work.status === 'accepted';
  const resolved = resolution?.status === 'resolved';
  if (!solving && !['accepted', 'merge-queued', 'merging', 'merged', 'pushing', 'completed'].includes(work.status)) return null;
  if (work.status === 'completed' && work.delivery?.push?.status !== 'pushed') return null;
  const merge = work.delivery?.merge;
  const push = work.delivery?.push;
  const failedMerge = work.status === 'accepted' && merge?.status === 'failed';
  const conflict = work.status === 'accepted' && merge?.status === 'conflict';
  const failedPush = work.status === 'merged' && push?.status === 'failed';
  const inFlight = pending || ['merge-queued', 'merging', 'pushing'].includes(work.status);
  const title = work.status === 'completed' ? 'deliveryCompleted' : solving ? 'deliverySolving' : manual ? 'deliveryManual'
    : resolved && work.status === 'accepted' ? 'deliveryResolved' : conflict ? 'deliveryConflict' : failedMerge ? 'deliveryMergeFailed'
    : failedPush ? 'deliveryPushFailed' : work.status === 'merged' && merge?.status === 'already-contained' ? 'deliveryContained' : work.status;
  async function run(operation: string, params: object = {}) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(undefined);
    try {
      const result = await api.call<{ status?: string; toCommit?: string; diff: string }>(operation, { workId: work.id, ...params });
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
      : work.status === 'merged' ? 'deliveryMergedHint' : work.status === 'pushing' ? 'deliveryPushingHint' : 'deliveryCompletedHint')}</p>
    {(failedMerge || failedPush) && <p role="alert" className="agent-text">{failedPush ? push?.reason : merge?.reason}</p>}
    {(solving || conflict && !resolved) && <table><thead><tr><th>{t('deliveryConflictFiles')}</th></tr></thead><tbody>
      {merge?.conflictFiles?.map(file => <tr key={file}><td className="agent-text">{file}</td></tr>)}
    </tbody></table>}
    {work.delivery?.cleanup?.reason && <p role="alert">{t('deliveryCleanupFailed')} {work.delivery.cleanup.reason}</p>}
    {manual && <>
      <p className="agent-text">{work.delivery?.merge?.workBranch} → {resolution.baseBranch.replace(/^refs\/heads\//, '')}</p>
      {notContained && <p role="status">{t('deliveryNotContained')}</p>}
    </>}
    {resolved && <div>
      <button className="btn sm" disabled={inFlight} onClick={() => void run('get-conflict-resolution')}>{t('deliveryChanges')}</button>
      <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/structure`}>{t('deliveryVerification')}</Link>
      {changes && changes.toCommit === resolution.toCommit && <section aria-label={t('deliveryChanges')}>
        <p className="agent-text">{resolution.fromCommit} → {resolution.toCommit}</p>
        <pre className="conflict-diff">{changes.diff || t('deliveryNoChanges')}</pre>
      </section>}
    </div>}
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
      {['merge-queued', 'merging', 'pushing'].includes(work.status) && <button className="btn sm" disabled>{t(work.status)}</button>}
      {work.status === 'merged' && <button className="btn sm primary" disabled={inFlight} onClick={() => void run('push-work')}>{t(failedPush ? 'retryPush' : 'pushWork')}</button>}
    </div>
    <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/brief`}>{t('deliveryReviewReport')}</Link>
    {error && <ErrorNotice error={error} />}
  </section>;
}
