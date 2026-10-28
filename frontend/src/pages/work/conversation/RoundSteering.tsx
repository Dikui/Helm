import { RoundSteps } from './RoundProgress.js';
import type { PlanEntry } from '../../../../../src/driver.js';
import { useI18n } from '../../../shared/i18n.js';
import type { Message, Round, RoundStep } from './types.js';


export function RoundSteering({ workId, round, steps, plan = [], queue, interrupt, withdraw, busy, reference, pauseReason }: {
  workId: string; round?: Round; steps: RoundStep[]; plan?: PlanEntry[]; withdraw: (messageId: string) => void; queue: Message[]; interrupt: () => void; busy: boolean;
  reference: (message: Message) => string | undefined; pauseReason: string | null;
}) {
  const { t } = useI18n();
  const active = round?.status === 'running';
  const interruptButton = <button type="button" className="conversation-interrupt" aria-label={t('conversationInterrupt')} disabled={!active || busy} onClick={event => { event.preventDefault(); interrupt(); }} title={t('conversationInterrupt')}><span aria-hidden="true">❚❚</span></button>;
  return <div className="conversation-steering">
    {round ? <RoundSteps key={round.id} workId={workId} round={round} steps={steps} plan={plan} action={interruptButton} />
      : <div className="conversation-round-heading"><span className="conversation-round-title">{t('alignmentCoordinator')} · {t('conversationIdle')}</span>{interruptButton}</div>}
    {pauseReason && <p className="pause-reason">{pauseReason}</p>}
    {queue.length > 0 && <section className="conversation-queue" aria-label={t('conversationQueue')}>
      <h3 className="sect">{t('conversationQueue')} <span className="count">{queue.length}</span></h3>
      <ul>{queue.map(message => <li key={message.id}><div>{reference(message) && <small className="ref">{reference(message)}</small>}<p>{message.body}</p></div>
        <button type="button" className="conversation-now" disabled={!active || busy} title={t('conversationProcessNowHint')} onClick={interrupt}><span aria-hidden="true">⚡</span> {t('conversationProcessNow')}</button>
        <button type="button" className="conversation-now" disabled={busy} onClick={() => withdraw(message.id)}><span aria-hidden="true">✕</span> {t('conversationWithdrawMessage')}</button>
      </li>)}</ul>
    </section>}
  </div>;
}
