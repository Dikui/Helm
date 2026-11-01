import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { ReviewDetails } from './ReviewDetails.js';
import { ReviewReport } from './ReviewReport.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import type { Work } from '../../../shared/types.js';
import { Link } from '../../../shared/router.js';
import type { useWorkReview } from './useWorkReview.js';

export function WorkReview({ work, report }: { work: Pick<Work, 'id' | 'status' | 'delivery'>; report: ReturnType<typeof useWorkReview> }) {
  const { t } = useI18n();
  const { conversation, events, gate, invalid } = report;
  const files = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  return <>
    {conversation.error && <><h3>{t('reportReadFailed')}</h3><ErrorNotice error={conversation.error} retry={conversation.reload} /></>}
    {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
    {!conversation.data && !conversation.error && <p role="status">{t('reportLoading')}</p>}
    {conversation.data && invalid && <section role="alert"><h3>{t('reportInvalid')}</h3><p>{(invalid.details as { reason: string }).reason}</p><p>{t('reportInvalidHint')}</p><Link href={`/works/${encodeURIComponent(work.id)}`}>{t('conversationHistory')}</Link></section>}
    {conversation.data && !gate && !invalid && <section><h3>{t('reportEmpty')}</h3><p className="muted">{t('reportEmptyHint')}</p><Link href={`/works/${encodeURIComponent(work.id)}`}>{t('conversationHistory')}</Link></section>}
    {gate && <section className="work-review" aria-label={t('reviewTitle')}>
      {gate.status === 'pending' ? <GateDecision key={gate.id} gate={gate} workStatus={work.status} detailedReview /> : <>
        {gate.report ? <ReviewReport key={gate.id} report={gate.report} workId={work.id} /> : <><h3>{t('reportLegacy')}</h3><Markdown text={gate.body} workId={work.id} files={files} onOpen={preview.open} />{preview.preview}</>}
        {gate.review && (gate.report ? <details className="report-fold"><summary>{t('reportAudit')}</summary><ReviewDetails review={gate.review} detailed /></details> : <ReviewDetails review={gate.review} detailed />)}
        {(work.status === 'completed' || work.status === 'cancelled') && <p className="pill">{t(work.status)}</p>}
        {(gate.decision === 'accept' || gate.decision === 'return') && <p>{t('reviewDecision')} · {t(gate.decision)}</p>}
        {gate.comment && <p className="agent-text">{gate.comment}</p>}
      </>}
    </section>}
  </>;
}
