import { useRef, useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Gate } from '../../shared/types.js';
import { Link } from '../../shared/router.js';
import { ReviewDetails } from '../work/brief/ReviewDetails.js';
import type { ReviewGate } from '../work/brief/types.js';

export function GateDecision({ gate, detailedReview = false }: { gate: ReviewGate; detailedReview?: boolean }) {
  const { api } = useData();
  const { t } = useI18n();
  const [answer, setAnswer] = useState('');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [decided, setDecided] = useState(false);
  const busy = useRef(false);
  const decide = async (decision: string) => {
    if (busy.current || decided || (gate.kind === 'review' && decision === 'return' && !comment.trim())) return;
    busy.current = true;
    setPending(true); setError(undefined);
    try {
      await api.call('decide-gate', { workId: gate.workId, gateId: gate.id, decision,
        ...(gate.kind === 'work-confirmation' ? { descriptionId: gate.descriptionId } : {}),
        ...(gate.kind === 'review' && comment.trim() ? { comment: comment.trim() } : {}) });
      setDecided(true);
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); }
  };
  if (decided) return null;
  return <section role="group" aria-busy={pending} className="gate-actions" aria-label={gate.kind === 'review' ? t('reviewTitle') : gate.question}>
    <strong>{gate.kind === 'review' ? t('reviewTitle') : gate.question}</strong>
    {gate.kind === 'review' && <b>{t('reviewReport')}</b>}
    {gate.body && <p className="agent-text">{gate.body}</p>}
    {gate.kind === 'review' && gate.review && <ReviewDetails review={gate.review} detailed={detailedReview} />}
    {gate.kind === 'review' && !detailedReview && <Link href={`/works/${encodeURIComponent(gate.workId)}/brief`}>{t('reviewOpenDetails')}</Link>}
    {gate.description && <dl className="brief-preview">
      <dt>{t('requirements')}</dt><dd>{gate.description.requirements}</dd>
      <dt>{t('boundary')}</dt><dd>{gate.description.boundary}</dd>
      <dt>{t('criteria')}</dt><dd>{gate.description.criteria}</dd>
    </dl>}
    {gate.kind === 'work-confirmation' && !gate.descriptionId && <p>{t('noDescription')}</p>}
    {gate.kind === 'review' && <><label>{t('comment')}<textarea disabled={pending} value={comment} onChange={e => setComment(e.target.value)} /></label><p className="muted">{t('reviewReturnHint')}</p></>}
    <div className="acts">
      {gate.kind === 'work-confirmation'
        ? <button className="btn sm primary" disabled={pending || !gate.descriptionId} onClick={() => void decide('confirm')}>{t('confirm')}</button>
        : gate.options.map(option => <button className="btn sm" key={option} disabled={pending || (gate.kind === 'review' && option === 'return' && !comment.trim())}
          onClick={() => void decide(option)}>{gate.kind === 'review' ? t(option as 'accept' | 'return') : option}</button>)}
    </div>
    {gate.kind === 'general' && <form noValidate onSubmit={event => { event.preventDefault(); void decide(answer.trim()); }}>
      <label>{t('answer')}<input value={answer} onChange={e => setAnswer(e.target.value)} /></label>
      <button className="btn sm" disabled={pending || !answer.trim()}>{t('decide')}</button>
    </form>}
    {error && <ErrorNotice error={error} />}
  </section>;
}
export function InboxDetails({ workId }: { workId: string }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<(Gate & { type: string })[]>('get-conversation', { workId });
  return <>{error && <ErrorNotice error={error} retry={reload} />}
    {!data && !error && <p role="status">{t('loading')}</p>}
    {data?.filter(item => item.type === 'gate' && item.status === 'pending').map(gate => <GateDecision key={gate.id} gate={gate} />)}
  </>;
}
