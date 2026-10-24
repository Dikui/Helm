import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n } from '../../../shared/i18n.js';
import type { Message, Round, RoundStep } from './types.js';
import { outputSummary } from '../../../../../src/output-summary.js';

export function RoundSteering({ round, steps, queue, interrupt, busy, reference, pauseReason }: {
  round?: Round; steps: RoundStep[]; queue: Message[]; interrupt: () => void; busy: boolean;
  reference: (message: Message) => string | undefined; pauseReason: string | null;
}) {
  const { t } = useI18n();
  const now = useClock();
  return <div className="conversation-steering">
    <div className="conversation-round-heading">
      <span className={`spark ${round ? 'run' : ''}`} aria-hidden="true">✦</span>
      <h3>{t('alignmentCoordinator')}{round ? ` · ${t('conversationRound')} ${round.number}` : ` · ${t('conversationIdle')}`}</h3>
      {round && <><span className="muted">{round.agentId}</span><span className="pill run"><span className="spin" aria-hidden="true" /><time aria-label={t('conversationRoundElapsed')}>{elapsed(round.startedAt, now)}</time></span></>}
      <button type="button" className="btn sm" disabled={!round || busy} onClick={interrupt} title="⌘⏎ / Ctrl+Enter">{t('conversationInterrupt')}</button>
    </div>
    {pauseReason && <p className="pause-reason">{pauseReason}</p>}
    {round && <details className="conversation-round" open>
      <summary>{t('conversationSteps')} <span className="count">{steps.length}</span></summary>
      {steps.length ? <ol>{steps.map((step, index) => {
        const text = step.text ?? step.path ?? t('conversationCompaction');
        const summary = step.text ? outputSummary(step.text, t('conversationOutput')) : text;
        const next = steps[index + 1];
        return <li key={step.step} className={next ? 'done' : 'now'}>
          <span className="conversation-step-number">{step.step}</span>
          <details><summary>{summary.split(/\r?\n/, 1)[0]?.slice(0, 160)}</summary><pre>{text}</pre></details>
          {step.time && <time dateTime={step.time} title={step.time} aria-label={`${t(next ? 'conversationStepGap' : 'conversationStepSince')} ${step.step}`}>{elapsed(step.time, next?.time ? Date.parse(next.time) : now)}</time>}
        </li>;
      })}</ol> : <p className="muted">{t('conversationWaitingOutput')}</p>}
    </details>}
    {queue.length > 0 && <section className="conversation-queue" aria-label={t('conversationQueue')}>
      <h3>{t('conversationQueue')} <span className="count">{queue.length}</span></h3>
      <ul>{queue.map(message => <li key={message.id}>{reference(message) && <small className="muted">{reference(message)}</small>}<p>{message.body}</p></li>)}</ul>
    </section>}
  </div>;
}
