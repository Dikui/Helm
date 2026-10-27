import { PlanSteps } from '../../../shared/PlanSteps.js';
import type { PlanEntry } from '../../../../../src/driver.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n } from '../../../shared/i18n.js';
import type { Message, Round, RoundStep } from './types.js';
import { isHousekeeping, stepSummary } from '../../../shared/step-summary.js';


export function RoundSteering({ round, steps, plan = [], queue, interrupt, withdraw, busy, reference, pauseReason }: {
  round?: Round; steps: RoundStep[]; plan?: PlanEntry[]; withdraw: (messageId: string) => void; queue: Message[]; interrupt: () => void; busy: boolean;
  reference: (message: Message) => string | undefined; pauseReason: string | null;
}) {
  const { t } = useI18n();
  const now = useClock();
  const position = Math.min(plan.length, plan.filter(entry => entry.status === 'completed').length + 1);
  const meaningful = steps.filter(step => !(step.text && isHousekeeping(step.text)));
  const stepList = (list: RoundStep[]) => <>{list.length ? <ol className="conversation-steps">{list.map((step, index) => {
    const text = step.type === 'plan' ? JSON.stringify(step, null, 2) : step.text ?? step.path ?? t('conversationCompaction');
    const summary = step.type === 'plan' ? t('conversationPlan') : step.text ? stepSummary(step.text, t) : text;
    const next = list[index + 1];
    return <li key={step.step} className={next ? 'done' : 'now'}>
      <span className="conversation-step-icon" aria-hidden="true">{next ? '✓' : <span className="spin" />}</span>
      <details><summary title={summary}>{summary.split(/\r?\n/, 1)[0]?.slice(0, 160)}</summary><pre>{text}</pre></details>
      {step.time && <time dateTime={step.time} title={step.time} aria-label={`${t(next ? 'conversationStepGap' : 'conversationStepSince')} ${step.step}`}>{elapsed(step.time, next?.time ? Date.parse(next.time) : now)}</time>}
    </li>;
  })}</ol> : <p className="muted conversation-waiting">{t('conversationWaitingOutput')}</p>}</>;
  const hidden = steps.filter(step => !meaningful.includes(step));
  const allSteps = <details className="conversation-raw-steps"><summary>{t('conversationRawSteps')}</summary>{stepList(steps)}</details>;
  const rawSteps = <>{stepList(meaningful)}{hidden.length > 0 && <details className="conversation-raw-steps"><summary>{t('conversationHiddenSteps')} · {hidden.length}</summary>{stepList(hidden)}</details>}</>;
  return <div className="conversation-steering">
    <details className="conversation-round" open>
      <summary className="conversation-round-heading">
        <span className={`spark ${round ? 'run busy' : ''}`} aria-hidden="true">✦</span>
        <span className="conversation-round-title"><b>{t('alignmentCoordinator')}{round ? ` · ${t('conversationRound')} ${round.number}` : ` · ${t('conversationIdle')}`}</b>
          {round && <small>{round.agentId} · {plan.length ? t('conversationPlanPosition').replace('{current}', String(position)).replace('{total}', String(plan.length)) : `${t('graphStep')} ${steps.at(-1)?.step ?? 0}`} </small>}</span>
        {round && <span className="pill run"><span className="spin" aria-hidden="true" /><time aria-label={t('conversationRoundElapsed')}>{elapsed(round.startedAt, now)}</time></span>}
        <button type="button" className="conversation-interrupt" aria-label={t('conversationInterrupt')} disabled={!round || busy} onClick={event => { event.preventDefault(); interrupt(); }} title={t('conversationInterrupt')}><span aria-hidden="true">❚❚</span></button>
        <span className="chev" aria-hidden="true">⌄</span>
      </summary>
      {round && <><h3 className="sr">{t('conversationSteps')}</h3>
        {plan.length ? <><PlanSteps entries={plan} />{allSteps}</> : rawSteps}
      </>}
    </details>
    {pauseReason && <p className="pause-reason">{pauseReason}</p>}
    {queue.length > 0 && <section className="conversation-queue" aria-label={t('conversationQueue')}>
      <h3 className="sect">{t('conversationQueue')} <span className="count">{queue.length}</span></h3>
      <ul>{queue.map(message => <li key={message.id}><div>{reference(message) && <small className="ref">{reference(message)}</small>}<p>{message.body}</p></div>
        <button type="button" className="conversation-now" disabled={!round || busy} title={t('conversationProcessNowHint')} onClick={interrupt}><span aria-hidden="true">⚡</span> {t('conversationProcessNow')}</button>
        <button type="button" className="conversation-now" disabled={busy} onClick={() => withdraw(message.id)}><span aria-hidden="true">✕</span> {t('conversationWithdrawMessage')}</button>
      </li>)}</ul>
    </section>}
  </div>;
}
