import { useResource } from '../../../shared/data.js';
import type { WorkDescription } from '../aligning/types.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { ReviewChanges, ReviewDetails } from './ReviewDetails.js';
import { ReviewReport } from './ReviewReport.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import type { Work } from '../../../shared/types.js';
import { Link } from '../../../shared/router.js';
import { GatePin } from '../GatePin.js';
import type { useWorkReview } from './useWorkReview.js';

export function WorkReview({ work, report }: { work: Pick<Work, 'id' | 'status' | 'delivery'>; report: ReturnType<typeof useWorkReview> }) {
  const { t, language } = useI18n();
  const { conversation, events, gate, invalid } = report;
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId: work.id });
  const confirmation = events.data?.findLast(event => event.action === 'gate-decided' && (event.details as { descriptionId?: string })?.descriptionId
    && (!gate?.createdAt || event.time <= gate.createdAt));
  const confirmedVersion = descriptions.data?.find(item => item.id === (confirmation?.details as { descriptionId?: string } | undefined)?.descriptionId)?.version;
  const files = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  return <>
    {conversation.error && <><h3>{t('reportReadFailed')}</h3><ErrorNotice error={conversation.error} retry={conversation.reload} /></>}
    {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
    {(!conversation.data || !events.data) && !conversation.error && !events.error && <section className="report-empty" role="status"><small>{t('reviewReport')}</small><h3>{t('reportLoading')}</h3><p>{t('reportLoadingHint')}</p></section>}
    {conversation.data && events.data && invalid && <section className="report-empty" role="alert"><h3>{t('reportInvalid')}</h3><p>{(invalid.details as { reason: string }).reason}</p><p>{t('reportInvalidHint')}</p><button className="btn" onClick={() => { conversation.reload(); events.reload(); }}>{t('pinRetryRead')}</button></section>}
    {conversation.data && events.data && !gate && !invalid && <section className="report-empty" role="status"><small>{t('reviewReport')}</small><h3>{t('reportEmpty')}</h3><p className="muted">{t('reportEmptyHint')}</p><button className="btn" onClick={() => { conversation.reload(); events.reload(); }}>{t('pinRetryRead')}</button></section>}
    {gate && events.data && !conversation.error && !events.error && <section className="work-review" aria-label={t('reviewTitle')}>
      {gate.report && <p className="report-meta">{t('reviewReport')}{confirmedVersion ? ` · ${t('brief')} v${confirmedVersion}` : ''}{gate.createdAt && <> · {t('alignmentCoordinator')} <time dateTime={gate.createdAt}>{new Date(gate.createdAt).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time></>}</p>}
      {gate.status === 'pending' && !invalid ? <GateDecision key={gate.id} gate={gate} workStatus={work.status} detailedReview /> : <>
        {gate.report ? <ReviewReport key={gate.id} report={gate.report} workId={work.id} /> : <><h3>{t('reportLegacy')}</h3><Markdown text={gate.body} workId={work.id} files={files} onOpen={preview.open} />{preview.preview}</>}
        {gate.review && (gate.report ? <details className="report-fold"><summary>{t('reportAudit')}</summary><ReviewDetails review={gate.review} detailed /></details> : <ReviewDetails review={gate.review} detailed />)}
        {gate.review && <ReviewChanges review={gate.review} />}
        {(work.status === 'completed' || work.status === 'cancelled') && <p className="pill">{t(work.status)}</p>}
        {(gate.decision === 'accept' || gate.decision === 'return') && <p>{t('reviewDecision')} · {t(gate.decision)}</p>}
        {gate.comment && <p className="agent-text">{gate.comment}</p>}
      </>}
    </section>}
  </>;
}

export function ReviewPin({ work, report }: { work: Pick<Work, 'id' | 'status'>; report: ReturnType<typeof useWorkReview> }) {
  const { t } = useI18n();
  if (['accepted', 'merge-queued', 'merging', 'completed', 'cancelled', 'paused'].includes(work.status)) return null;
  const { conversation, events, gate, invalid } = report;
  if (conversation.error || events.error) return <GatePin label={t('reportReadFailed')} source={t('pinRetry')} title={t('reportReadFailed')} tone="failure">
    <button aria-keyshortcuts="1" onClick={() => { conversation.reload(); events.reload(); }}><kbd aria-hidden="true">1</kbd>{t('pinRetryRead')}</button>
  </GatePin>;
  if (invalid) return <GatePin label={t('reportInvalid')} source={t('pinReportNeedsFields')} title={t('pinNoReviewGate')} tone="neutral">
    <Link className="btn sm" aria-keyshortcuts="1" href={`/works/${encodeURIComponent(work.id)}?inspect=report`}><kbd aria-hidden="true">1</kbd>{t('pinMissingFields')}</Link>
  </GatePin>;
  if (!conversation.data || !events.data) return null;
  return gate?.status === 'pending' && work.status === 'awaiting-review' ? <GateDecision key={gate.id} gate={gate} workStatus={work.status} pinned /> : null;
}
