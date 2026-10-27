import { useRef, useState, type KeyboardEvent } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Gate, Work, WorkStatus } from '../../shared/types.js';
import { Link } from '../../shared/router.js';
import { ReviewDetails } from '../work/brief/ReviewDetails.js';
import type { ReviewGate } from '../work/brief/types.js';

export function GateDecision({ gate, workStatus, detailedReview = false }: { gate: ReviewGate; workStatus?: WorkStatus; detailedReview?: boolean }) {
  const { api } = useData();
  const { t } = useI18n();
  const [answer, setAnswer] = useState('');
  const [comment, setComment] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [decided, setDecided] = useState(false);
  const busy = useRef(false);
  const ended = workStatus === 'completed' || workStatus === 'cancelled';
  const readOnly = ended || gate.status !== 'pending';
  const decide = async (decision: string) => {
    if (readOnly || busy.current || decided || (gate.kind === 'review' && decision === 'return' && !comment.trim())) return;
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
  // 焦点在卡内（不在输入框里）时，按数字键选对应选项
  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    const index = Number(event.key) - 1;
    if (readOnly || gate.kind !== 'general' || event.metaKey || event.ctrlKey || event.altKey || !(index >= 0 && index < 9) || !gate.options[index]) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault(); void decide(gate.options[index]);
  };
  if (decided) return null;
  return <section role="group" aria-busy={pending} className="gate-actions" aria-label={gate.kind === 'review' ? t('reviewTitle') : gate.question} onKeyDown={shortcut}>
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
    {ended && <p className="pill">{t(workStatus)}</p>}
    {!readOnly && gate.kind === 'review' && <><label>{t('comment')}<textarea disabled={pending} value={comment} onChange={e => setComment(e.target.value)} /></label><p className="muted">{t('reviewReturnHint')}</p></>}
    {!readOnly && gate.kind === 'general' && <div className="opts">
      {gate.options.map((option, index) => <button className="btn" key={option} disabled={pending} aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
        onClick={() => void decide(option)}>{option}{index < 9 && <kbd aria-hidden="true">{index + 1}</kbd>}</button>)}
    </div>}
    {!readOnly && gate.kind !== 'general' && <div className="acts">
      {gate.kind === 'work-confirmation'
        ? <button className="btn sm primary" disabled={pending || !gate.descriptionId} onClick={() => void decide('confirm')}>{t('confirm')}</button>
        : gate.options.map(option => <button className="btn sm" key={option} disabled={pending || (gate.kind === 'review' && option === 'return' && !comment.trim())}
          onClick={() => void decide(option)}>{gate.kind === 'review' ? t(option as 'accept' | 'return') : option}</button>)}
    </div>}
    {!readOnly && gate.kind === 'general' && <form noValidate onSubmit={event => { event.preventDefault(); void decide(answer.trim()); }}>
      <label>{t('answer')}<input value={answer} onChange={e => setAnswer(e.target.value)} /></label>
      <button className="btn sm" disabled={pending || !answer.trim()}>{t('decide')}</button>
    </form>}
    {error && <ErrorNotice error={error} />}
  </section>;
}
export function InboxDetails({ work }: { work: Pick<Work, 'id' | 'status'> }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<(Gate & { type: string })[]>('get-conversation', { workId: work.id });
  return <>{error && <ErrorNotice error={error} retry={reload} />}
    {!data && !error && <p role="status">{t('loading')}</p>}
    {data?.filter(item => item.type === 'gate' && item.status === 'pending').map(gate => <GateDecision key={gate.id} gate={gate} workStatus={work.status} />)}
  </>;
}
