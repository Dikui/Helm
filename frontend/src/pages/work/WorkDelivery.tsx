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
  if (!['accepted', 'merge-queued', 'merging', 'merged', 'pushing', 'completed'].includes(work.status)) return null;
  if (work.status === 'completed' && work.delivery?.push?.status !== 'pushed') return null;
  const merge = work.delivery?.merge;
  const push = work.delivery?.push;
  const failedMerge = work.status === 'accepted' && merge?.status === 'failed';
  const conflict = work.status === 'accepted' && merge?.status === 'conflict';
  const failedPush = work.status === 'merged' && push?.status === 'failed';
  const inFlight = pending || ['merge-queued', 'merging', 'pushing'].includes(work.status);
  const title = work.status === 'completed' ? 'deliveryCompleted' : conflict ? 'deliveryConflict' : failedMerge ? 'deliveryMergeFailed'
    : failedPush ? 'deliveryPushFailed' : work.status === 'merged' && merge?.status === 'already-contained' ? 'deliveryContained' : work.status;
  async function run(operation: string) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(undefined);
    try { await api.call(operation, { workId: work.id }); }
    catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); }
  }
  return <section className="release-panel" aria-label={t('deliveryTitle')} aria-busy={inFlight}>
    <h2>{t(title)}</h2>
    <p>{t(work.status === 'accepted' ? conflict ? 'deliveryConflictHint' : 'deliveryAcceptedHint'
      : work.status === 'merge-queued' ? 'deliveryQueuedHint' : work.status === 'merging' ? 'deliveryMergingHint'
      : work.status === 'merged' ? 'deliveryMergedHint' : work.status === 'pushing' ? 'deliveryPushingHint' : 'deliveryCompletedHint')}</p>
    {(failedMerge || failedPush) && <p role="alert" className="agent-text">{failedPush ? push?.reason : merge?.reason}</p>}
    {conflict && <table><thead><tr><th>{t('deliveryConflictFiles')}</th></tr></thead><tbody>
      {merge?.conflictFiles?.map(file => <tr key={file}><td className="agent-text">{file}</td></tr>)}
    </tbody></table>}
    {work.delivery?.cleanup?.reason && <p role="alert">{t('deliveryCleanupFailed')} {work.delivery.cleanup.reason}</p>}
    <div className="acts">
      {work.status === 'accepted' && <>
        <button className="btn sm" disabled={inFlight} onClick={() => void run('withdraw-acceptance')}>{t('withdrawAcceptance')}</button>
        <button className="btn sm primary" disabled={inFlight} onClick={() => void run('merge-work')}>{t(failedMerge || conflict ? 'retryMerge' : 'mergeWork')}</button>
      </>}
      {['merge-queued', 'merging', 'pushing'].includes(work.status) && <button className="btn sm" disabled>{t(work.status)}</button>}
      {work.status === 'merged' && <button className="btn sm primary" disabled={inFlight} onClick={() => void run('push-work')}>{t(failedPush ? 'retryPush' : 'pushWork')}</button>}
    </div>
    <Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}/brief`}>{t('deliveryReviewReport')}</Link>
    {error && <ErrorNotice error={error} />}
  </section>;
}
