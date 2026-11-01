import { useEffect, useRef, useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import { ActionDialog } from './ActionDialog.js';
import { WorkActions } from './WorkActions.js';
import { ReviewChanges, ReviewDiff } from './brief/ReviewDetails.js';
import type { useWorkReview } from './brief/useWorkReview.js';
import { DispatchDetails, ReadArtifact } from './card-graph/DispatchDetails.js';
import type { Artifact } from './card-graph/types.js';
import type { PushPreview, Work } from '../../shared/types.js';
import type { WorkDeliveryState } from './useWorkDelivery.js';
import './work-delivery.css';

type Report = ReturnType<typeof useWorkReview>;
const branch = (ref?: string | null) => ref?.replace(/^refs\/heads\//, '') || '—';
export function WorkDelivery({ delivery: d, reload }: { delivery: WorkDeliveryState; reload: () => void }) {
  const { t } = useI18n();
  if (!d.visible) return null;
  const { work } = d;
  const title = d.pushing ? 'nowPushing' : d.failedPush ? 'nowPushFailed' : work.status === 'completed'
    ? d.withoutMerge ? 'nowWithoutMerge' : d.noCodeChanges ? 'nowReadOnly' : work.delivery?.push?.status === 'pushed' ? 'nowPushed'
      : d.merge?.status === 'already-contained' ? 'nowContained' : d.merge?.status === 'merged' ? 'nowMerged' : 'deliveryCompleted'
    : d.solving ? 'deliverySolving' : d.manual ? 'deliveryManual' : d.resolved ? 'deliveryResolved'
      : d.conflict ? 'deliveryConflict' : d.failedMerge ? 'deliveryMergeFailed' : work.status === 'accepted' ? 'nowAwaitingMerge' : work.status;
  const hint = d.pushing ? 'deliveryPushingHint' : d.failedPush ? 'deliveryPushFailedHint' : d.solving ? 'deliverySolvingHint'
    : d.manual ? 'deliveryManualHint' : d.resolved ? 'deliveryResolvedHint' : d.failedMerge ? 'deliveryMergeFailedHint'
      : work.status === 'accepted' ? d.conflict ? 'deliveryConflictHint' : 'deliveryAcceptedHint'
        : work.status === 'merge-queued' ? 'deliveryQueuedHint' : work.status === 'merging' ? 'deliveryMergingHint'
          : d.noCodeChanges ? 'deliveryNoCodeChanges' : d.withoutMerge ? 'deliveryFinishedWithoutMerge'
            : work.delivery?.push?.status === 'pushed' ? 'deliveryPushedHint' : d.merge?.status === 'already-contained' ? 'deliveryContainedHint' : 'deliveryCompletedHint';
  const reason = d.failedPush ? work.delivery?.push?.reason : d.failedMerge ? d.merge?.reason : undefined;
  return <section className="delivery-view" aria-label={t('deliveryTitle')} aria-busy={d.inFlight}>
    <div className="delivery-sub">{t('inspectorDelivery')}</div>
    <h2>{t(title)}</h2><p>{t(hint)}</p>
    {reason && <details className="delivery-details"><summary>{t('deliveryRawReason')}</summary><pre>{reason}</pre></details>}
    {d.noCodeChanges ? <><h3>{t('deliveryReadonly')}</h3><p className="hint">{t('deliveryReadonlyHint')}</p></> : <>
      <h3>{t('graphBranch')}</h3><div className="delivery-branches" aria-label={t('deliveryBranchFlow')}>
        <span className="ref">{d.merge?.workBranch || work.workBranch}</span><span aria-hidden="true">→</span><span className="ref">{branch(d.merge?.baseBranch || work.baseRef)}</span>
        {d.preview?.remote && <><span aria-hidden="true">→</span><span className="ref">{d.preview.remote}/{branch(d.preview.remoteBranch)}</span></>}
      </div>
    </>}
    {(d.solving || d.conflict) && Boolean(d.merge?.conflictFiles?.length) && <>
      <h3>{t('deliveryConflictFiles')}</h3><div className="delivery-table"><table><thead><tr><th scope="col">{t('graphFile')}</th></tr></thead><tbody>
        {d.merge!.conflictFiles!.map(file => <tr key={file}><td>{file}</td></tr>)}
      </tbody></table></div>
    </>}
    {d.solving && d.resolution && <p className="hint">{t('deliveryFixedBase')} <code>{d.resolution.baseCommit}</code></p>}
    {d.notContained && d.manual && <p role="status">{t('deliveryNotContained')}</p>}
    {work.status === 'completed' && <details className="delivery-cleanup"><summary>{t('deliveryCleanup')}{work.delivery?.cleanup?.reason && <span className="delivery-cleanup-warning"> · {t('deliveryCleanupFailedHint')}</span>}</summary><section aria-label={t('deliveryCleanup')}><p className="hint" role={work.delivery?.cleanup?.reason ? 'status' : undefined}>{t(work.delivery?.cleanup?.reason ? 'deliveryCleanupFailedHint'
        : work.delivery?.cleanup ? d.noCodeChanges ? 'deliveryReadonlyCleanup' : d.withoutMerge || !['merged', 'already-contained'].includes(d.merge?.status ?? '') ? 'deliveryCleanupKeptBranch' : 'deliveryCleanupDone' : 'deliveryCleanupPending')}</p>
      {work.delivery?.cleanup?.reason && <details className="delivery-details"><summary>{t('deliveryRawReason')}</summary><pre>{work.delivery.cleanup.reason}</pre></details>}</section>
    </details>}
    {d.noCodeChanges && <DeliveryArtifacts workId={work.id} />}
    <div className="delivery-actions">
      {d.solving && <><button className="btn sm" disabled aria-busy="true">{t('deliverySolvingBusy')}</button><Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}?inspect=coord`}>{t('deliveryProgress')}</Link></>}
      {d.resolved ? <>
        <button className="btn sm" disabled={d.inFlight} onClick={event => d.open('changes', event.currentTarget)}>{t('deliveryChanges')}</button>
        <button className="btn sm primary" disabled={d.inFlight} onClick={() => void d.run('merge-work')}>{t('deliveryMergeAgain')}</button>
        <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('withdraw-acceptance')}>{t('withdrawAcceptance')}</button>
      </> : d.manual ? <>
        <button className="btn sm primary" disabled={d.inFlight} onClick={() => void d.run('recheck-work-merge')}>{t('deliveryRecheck')}</button>
        <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('resolve-merge-conflict', { resolution: 'coordinator' })}>{t('deliverySwitchCoordinator')}</button>
      </> : d.conflict ? <>
        <button className="btn sm primary" disabled={d.inFlight} onClick={() => void d.run('resolve-merge-conflict', { resolution: 'coordinator' })}>{t('deliveryCoordinator')}</button>
        <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('resolve-merge-conflict', { resolution: 'manual' })}>{t('deliverySelf')}</button>
        <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('withdraw-acceptance')}>{t('withdrawAcceptance')}</button>
      </> : work.status === 'accepted' && <>
        <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('withdraw-acceptance')}>{t('withdrawAcceptance')}</button>
        <button className="btn sm primary" disabled={d.inFlight} onClick={() => void d.run('merge-work')}>{t(d.failedMerge ? 'retryMerge' : 'mergeWork')}</button>
      </>}
      {(work.status === 'accepted' || d.solving) && <button className="btn sm" disabled={d.inFlight} onClick={event => d.open('finish', event.currentTarget)}>{t('deliveryFinish')}</button>}
      {['merge-queued', 'merging'].includes(work.status) && <button className="btn sm" disabled aria-busy="true">{t(work.status === 'merge-queued' ? 'deliveryQueued' : 'deliveryMerging')}</button>}
      {(d.canPush || d.pushing) && <button className={`btn sm ${d.pushing ? '' : 'primary'}`} disabled={d.inFlight} onClick={event => d.open('push', event.currentTarget)}>{t(d.pushing ? 'deliveryPushing' : d.failedPush ? 'deliveryRetryPushPreview' : 'deliveryOpenPushPreview')}</button>}
      {work.delivery?.push?.status === 'pushed' && <button className="btn sm" disabled={d.inFlight} onClick={event => d.open('final', event.currentTarget)}>{t('deliveryFinalChanges')}</button>}
      {d.noCodeChanges && <WorkActions work={work} inline reload={reload} />}
    </div>
    {d.resolved && <p className="delivery-report"><button className="report-link" onClick={event => d.open('verification', event.currentTarget)}>{t('deliveryVerificationEvidence')}</button></p>}
    {work.status === 'completed' && !d.noCodeChanges && !d.withoutMerge && !d.pushing && <p className="delivery-persist">{t('deliveryPersistHint')}</p>}
    <p className="delivery-report"><Link href={`/works/${encodeURIComponent(work.id)}?inspect=report`}>{t('deliveryReviewReport')}</Link></p>
    {d.error && !d.panel && <ErrorNotice error={d.error} />}
  </section>;
}

export function DeliveryDialogs({ delivery: d, report }: { delivery: WorkDeliveryState; report: Report }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  if (!d.panel) return null;
  const showGraph = () => { d.close(); navigate(`/works/${encodeURIComponent(d.work.id)}?inspect=graph`); };
  const title = d.panel === 'push' ? t('deliveryPushTo').replace('{base}', branch(d.preview?.baseBranch || d.work.baseRef))
    .replace('{remote}', d.preview?.remote ? `${d.preview.remote}/${branch(d.preview.remoteBranch)}` : '—')
    : t(d.panel === 'finish' ? 'deliveryFinish' : d.panel === 'changes' ? 'deliveryChanges' : d.panel === 'verification' ? 'deliveryVerificationEvidence' : 'deliveryFinalChanges');
  return <ActionDialog title={title} description={d.panel === 'finish' ? t('deliveryFinishHint') : undefined} busy={d.inFlight} onClose={d.close} returnFocus={d.opener}
    className={['changes', 'verification', 'final'].includes(d.panel) ? 'report-preview delivery-dialog' : 'delivery-dialog'}>
    {d.error && <ErrorNotice error={d.error} />}
    {d.panel === 'finish' ? <button className="btn work-danger" disabled={d.inFlight} onClick={() => void d.run('finish-work-without-merge')}>{t('deliveryFinishConfirm')}</button>
      : d.panel === 'push' ? <>
        <p>{t('deliveryPushLocalHint')}</p>
        <div><button className="btn sm" disabled={d.inFlight} onClick={d.refreshPreview}>{t('deliveryPreviewRefresh')}</button></div>
        {!d.preview && !d.previewError && <p role="status">{t('deliveryPushLoading')}</p>}
        {d.previewError && <ErrorNotice error={d.previewError} retry={d.refreshPreview} />}
        {d.preview?.reason && <><p role="status">{t('deliveryPushUnavailable')}</p><details className="delivery-details"><summary>{t('deliveryRawReason')}</summary><pre>{d.preview.reason}</pre></details></>}
        {d.preview && !d.preview.reason && <>
          {d.preview.newBranch && <p>{t('deliveryPushNewBranch')} <span className="ref">{branch(d.preview.remoteBranch)}</span></p>}
          {d.preview.commits.length ? <PushCommits preview={d.preview} work={d.work} /> : <p>{t('deliveryPushNoCommits')}</p>}
          <p className="delivery-notice">{t('deliveryPushPreviewHint')}</p>
        </>}
        <div className="delivery-actions"><button className="btn sm" disabled={d.inFlight} onClick={d.close}>{t('newWorkCancel')}</button>
          <button className="btn sm primary" disabled={d.inFlight || !d.canPush || !d.preview || Boolean(d.previewError || d.preview.reason) || !d.preview.newBranch && d.preview.commits.length === 0}
            onClick={() => void d.run('push-work')}>{t('deliveryConfirmPush').replace('{count}', String(d.preview?.commits.length ?? 0))}</button></div>
      </> : d.panel === 'changes' ? <>
        {d.changes && d.changes.toCommit === d.resolution?.toCommit ? <><p className="delivery-branches"><code>{d.resolution?.fromCommit}</code> → <code>{d.changes.toCommit}</code></p><ReviewDiff diff={d.changes.diff} /></>
          : !d.error && <p role="status">{t('loading')}</p>}
        {d.error && <button className="btn sm" disabled={d.inFlight} onClick={() => void d.run('get-conflict-resolution')}>{t('retry')}</button>}
        <button className="report-link" onClick={showGraph}>{t('deliveryVerification')}</button>
      </> : d.panel === 'verification' ? <>
        <p className="delivery-branches"><code>{d.resolution?.fromCommit}</code> → <code>{d.resolution?.toCommit}</code></p>
        {d.resolution?.cards?.map(card => <DispatchDetails key={card.verificationId} workId={d.work.id} dispatchId={card.verificationId} />)}
        <button className="report-link" onClick={showGraph}>{t('deliveryVerification')}</button>
      </> : report.gate?.review ? <><ReviewChanges review={report.gate.review} />{report.gate.review.diff === null ? <p>{report.gate.review.diffUnavailableReason}</p> : <ReviewDiff diff={report.gate.review.diff} />}</>
        : report.conversation.error ? <ErrorNotice error={report.conversation.error} retry={report.conversation.reload} /> : <p role="status">{t('loading')}</p>}
  </ActionDialog>;
}

function DeliveryArtifacts({ workId }: { workId: string }) {
  const { api } = useData();
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<Artifact[]>();
  const [error, setError] = useState<Error>();
  const [revision, setRevision] = useState(0);
  const [selected, select] = useState<Artifact>();
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    let stale = false;
    setError(undefined);
    void api.call<{ id: string }[]>('list-dispatches', { workId }).then(async dispatches => {
      const results = await Promise.all(dispatches.map(dispatch => api.call<Artifact[]>('get-dispatch-artifacts', { workId, dispatchId: dispatch.id })));
      if (!stale) setArtifacts(results.flat().filter(item => item.kind !== 'branch'));
    }).catch(error => { if (!stale) setError(error as Error); });
    return () => { stale = true; };
  }, [api, workId, revision]);
  return <section><h3>{t('graphArtifacts')}</h3>
    {error && <ErrorNotice error={error} retry={() => setRevision(value => value + 1)} />}
    {!artifacts && !error ? <p role="status">{t('loading')}</p> : artifacts?.length ? <ul className="delivery-artifacts">{artifacts.map(artifact => <li key={artifact.id}><button className="report-link" onClick={event => { opener.current = event.currentTarget; select(artifact); }}>{artifact.name}</button></li>)}</ul> : !error && <p className="hint">{t('graphNoArtifacts')}</p>}
    {selected && <ActionDialog title={selected.name} busy={false} returnFocus={opener} onClose={() => select(undefined)} className="report-preview"><ReadArtifact workId={workId} artifactId={selected.id} /></ActionDialog>}
  </section>;
}

function PushCommits({ preview, work }: { preview: PushPreview; work: Work }) {
  const { t } = useI18n();
  const works = useResource<Work[]>('list-works');
  return <div className="delivery-table"><table aria-label={t('deliveryPushPreview')}><thead><tr>
    <th scope="col">{t('deliveryCommit')}</th><th scope="col">{t('deliveryCommitTitle')}</th><th scope="col">{t('deliveryCommitSource')}</th>
  </tr></thead><tbody>{preview.commits.map(commit => {
    // Only a recorded merge commit establishes ownership; commit messages are not evidence.
    const candidates = (works.data ?? [work]).filter(item => item.projectId === work.projectId && item.delivery?.merge?.status === 'merged' && item.delivery.merge.commit?.startsWith(commit.hash));
    return <tr key={commit.hash}><td className="delivery-hash"><code>{commit.hash}</code></td><td>{commit.subject}</td><td>{candidates.length === 1 ? candidates[0]!.title : t('deliverySourceUnknown')}</td></tr>;
  })}</tbody></table></div>;
}
