import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { ReviewDetails } from './ReviewDetails.js';
import type { Work } from '../../../shared/types.js';
import type { ReviewGate } from './types.js';

export function WorkReview({ work }: { work: Pick<Work, 'id' | 'status'> }) {
  const { t } = useI18n();
  const conversation = useResource<(ReviewGate & { type: string })[]>('get-conversation', { workId: work.id });
  const gate = conversation.data?.findLast(item => item.type === 'gate' && item.kind === 'review');
  return <>
    {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
    {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
    {gate && <section className="work-review" aria-label={t('reviewTitle')}>
      <h2>{t('reviewTitle')}</h2>
      {gate.status === 'pending' ? <GateDecision key={gate.id} gate={gate} workStatus={work.status} detailedReview /> : <>
        <h3>{t('reviewReport')}</h3><p className="agent-text">{gate.body}</p>
        {gate.review && <ReviewDetails review={gate.review} detailed />}
        {(work.status === 'completed' || work.status === 'cancelled') && <p className="pill">{t(work.status)}</p>}
        {(gate.decision === 'accept' || gate.decision === 'return') && <p>{t('reviewDecision')} · {t(gate.decision)}</p>}
        {gate.comment && <p className="agent-text">{gate.comment}</p>}
      </>}
    </section>}
  </>;
}
