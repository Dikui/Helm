import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { Gate, WorkSummary, WorkStatus } from '../../shared/types.js';
import { Link } from '../../shared/router.js';
import { ReviewDetails } from '../work/brief/ReviewDetails.js';
import { ReviewReport } from '../work/brief/ReviewReport.js';
import { Markdown, useFilePreview } from '../../shared/files.js';
import type { ReviewGate } from '../work/brief/types.js';
import { GitInitializationDetails } from './GitInitializationDetails.js';

const noFiles: ReadonlySet<string> = new Set();
export function GateDecision({ gate, workStatus, decisionWorkId = gate.workId, detailedReview = false }: { gate: ReviewGate; workStatus?: WorkStatus; decisionWorkId?: string; detailedReview?: boolean }) {
  const { api } = useData();
  const { t } = useI18n();
  const preview = useFilePreview(gate.workId);
  const [answer, setAnswer] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  // An explicit label keeps the rules text out of the textarea's accessible name.
  const rulesId = useId();
  const [ignoreRules, setIgnoreRules] = useState(gate.gitInitialization?.ignoreRules ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [decided, setDecided] = useState(false);
  const busy = useRef(false);
  const ended = workStatus === 'completed' || workStatus === 'cancelled';
  const readOnly = ended || gate.status !== 'pending';
  const multi = gate.kind === 'general' && gate.multiSelect;
  const toggle = (option: string) => setSelected(current => current.includes(option) ? current.filter(item => item !== option) : [...current, option]);
  // 多选时选中项按选项顺序一行一个，自由回答接在最后
  const multiAnswer = () => [...gate.options.filter(option => selected.includes(option)), answer.trim()].filter(Boolean).join('\n');
  const decide = async (decision: string) => {
    if (readOnly || busy.current || decided || ((gate.kind === 'review' && decision === 'return' || gate.kind === 'git-initialization' && decision === 'refuse') && !comment.trim())) return;
    busy.current = true;
    setPending(true); setError(undefined);
    try {
      await api.call('decide-gate', { workId: decisionWorkId, gateId: gate.id, decision,
        ...(gate.kind === 'work-confirmation' ? { descriptionId: gate.descriptionId } : {}),
        ...(['review', 'git-initialization'].includes(gate.kind) && comment.trim() ? { comment: comment.trim() } : {}),
        ...(gate.kind === 'git-initialization' && !gate.gitInitialization?.hasGitignore ? { ignoreRules } : {}) });
      setDecided(true);
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); }
  };
  const title = gate.kind === 'review' ? t('reviewTitle') : gate.kind === 'git-initialization' ? t('gitInitTitle') : gate.question;
  // 焦点在卡内（不在输入框里）时，按数字键选对应选项
  const shortcut = (event: KeyboardEvent<HTMLElement>) => {
    const index = Number(event.key) - 1;
    if (event.nativeEvent.isComposing || readOnly || gate.kind !== 'general' || event.metaKey || event.ctrlKey || event.altKey || !(index >= 0 && index < 9) || !gate.options[index]) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    if (multi) toggle(gate.options[index]); else void decide(gate.options[index]);
  };
  if (decided) return null;
  return <section role="group" aria-busy={pending} className="gate-actions" aria-label={title} onKeyDown={shortcut}>
    <strong>{title}</strong>
    {gate.kind === 'git-initialization' && <GitInitializationDetails gate={gate} />}
    {gate.kind === 'review' && !gate.report && <b>{t('reportLegacy')}</b>}
    {gate.kind === 'review' && gate.report ? <ReviewReport key={gate.id} report={gate.report} workId={gate.workId} compact={!detailedReview} />
      : gate.body && <Markdown text={gate.body} workId={gate.workId} files={noFiles} onOpen={preview.open} />}
    {preview.preview}
    {gate.kind === 'review' && gate.review && (gate.report ? <details className="report-fold"><summary>{t('reportAudit')}</summary><ReviewDetails review={gate.review} detailed={detailedReview} /></details> : <ReviewDetails review={gate.review} detailed={detailedReview} />)}
    {gate.kind === 'review' && !detailedReview && <Link href={`/works/${encodeURIComponent(gate.workId)}/brief`}>{t('reviewOpenDetails')}</Link>}
    {gate.description && <dl className="brief-preview">
      <dt>{t('requirements')}</dt><dd>{gate.description.requirements}</dd>
      <dt>{t('boundary')}</dt><dd>{gate.description.boundary}</dd>
      <dt>{t('criteria')}</dt><dd>{gate.description.criteria}</dd>
    </dl>}
    {gate.kind === 'work-confirmation' && !gate.descriptionId && <p>{t('noDescription')}</p>}
    {ended && <p className="pill">{t(workStatus)}</p>}
    {!readOnly && gate.kind === 'review' && <><label>{t('comment')}<textarea className="resize-none" disabled={pending} value={comment} onChange={e => setComment(e.target.value)} /></label><p className="muted">{t(gate.review?.noCodeChanges ? 'reviewNoCodeChangesHint' : 'reviewReturnHint')}</p></>}
    {!readOnly && gate.kind === 'git-initialization' && <>
      {!gate.gitInitialization?.hasGitignore && <><label htmlFor={rulesId}>{t('gitInitIgnoreRules')}</label><textarea id={rulesId} className="resize-none git-ignore-rules" rows={8} disabled={pending} value={ignoreRules} onChange={event => setIgnoreRules(event.target.value)} /></>}
      <label>{t('gitInitReason')}<textarea className="resize-none" disabled={pending} value={comment} onChange={event => setComment(event.target.value)} /></label>
      <div className="acts"><button className="btn sm primary" disabled={pending} onClick={() => void decide('initialize')}>{t('gitInitApprove')}</button>
        <button className="btn sm" disabled={pending || !comment.trim()} onClick={() => void decide('refuse')}>{t('gitInitReject')}</button></div>
    </>}
    {!readOnly && gate.kind === 'general' && <div className={multi ? 'opts multi' : 'opts'}>
      {gate.options.map((option, index) => <button className="btn" key={option} disabled={pending} aria-keyshortcuts={index < 9 ? String(index + 1) : undefined}
        aria-pressed={multi ? selected.includes(option) : undefined} onClick={() => multi ? toggle(option) : void decide(option)}>{option}{index < 9 && <kbd aria-hidden="true">{index + 1}</kbd>}</button>)}
    </div>}
    {!readOnly && gate.kind !== 'general' && gate.kind !== 'git-initialization' && <div className="acts">
      {gate.kind === 'work-confirmation'
        ? <button className="btn sm primary" disabled={pending || !gate.descriptionId} onClick={() => void decide('confirm')}>{t('confirm')}</button>
        : gate.options.map(option => <button className="btn sm" key={option} disabled={pending || (gate.kind === 'review' && option === 'return' && !comment.trim())}
          onClick={() => void decide(option)}>{gate.kind === 'review' ? t(option as 'accept' | 'return') : option}</button>)}
    </div>}
    {!readOnly && gate.kind === 'general' && <form noValidate onSubmit={event => { event.preventDefault(); const decision = multi ? multiAnswer() : answer.trim(); if (decision) void decide(decision); }}>
      <label>{t(multi ? 'answerMore' : 'answer')}<input value={answer} onChange={e => setAnswer(e.target.value)} /></label>
      <button className="btn sm" disabled={pending || !(multi ? multiAnswer() : answer.trim())}>{t('decide')}</button>
    </form>}
    {error && <ErrorNotice error={error} />}
  </section>;
}
export function InboxDetails({ work }: { work: WorkSummary }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<(Gate & { type: string })[]>('get-conversation', { workId: work.id });
  return <>{error && <ErrorNotice error={error} retry={reload} />}
    {!data && !error && <p role="status">{t('loading')}</p>}
    {data?.filter(item => item.type === 'gate' && item.status === 'pending').map(gate => <GateDecision key={gate.id} gate={gate} workStatus={work.status} decisionWorkId={work.id} />)}
    <div className="acts"><Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}${work.status === 'accepted' || work.delivery?.push?.status === 'failed' ? '/brief' : ''}`}>{t(work.status === 'accepted' || work.delivery?.push?.status === 'failed' ? 'deliveryTitle' : 'inboxOpen')}</Link></div>
  </>;
}
