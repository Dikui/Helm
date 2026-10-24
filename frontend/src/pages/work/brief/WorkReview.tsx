import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GateDecision } from '../../inbox/GateActions.js';
import { ReviewDetails } from './ReviewDetails.js';
import type { ReviewGate } from './types.js';

export function WorkReview({ workId }: { workId: string }) {
  const { t } = useI18n();
  const conversation = useResource<(ReviewGate & { type: string })[]>('get-conversation', { workId });
  const gate = conversation.data?.findLast(item => item.type === 'gate' && item.kind === 'review');
  return <>
    {conversation.error && <ErrorNotice error={conversation.error} retry={conversation.reload} />}
    {!conversation.data && !conversation.error && <p role="status">{t('loading')}</p>}
    {gate && <section className="work-review" aria-label={t('reviewTitle')}>
      <h2>{t('reviewTitle')}</h2>
      {gate.status === 'pending' ? <GateDecision key={gate.id} gate={gate} detailedReview /> : <>
        <h3>{t('reviewReport')}</h3><p className="agent-text">{gate.body}</p>
        {gate.review && <ReviewDetails review={gate.review} detailed />}
        <p>{t('reviewDecision')} · {gate.decision === 'accept' ? t('accept') : t('return')}</p>
        {gate.comment && <p className="agent-text">{gate.comment}</p>}
      </>}
    </section>}
  </>;
}
