import { useI18n } from '../../../shared/i18n.js';
import type { Message } from './types.js';


export function RoundSteering({ active, queue, interrupt, withdraw, busy, reference, pauseReason }: {
  active: boolean; withdraw: (messageId: string) => void; queue: Message[]; interrupt: () => void; busy: boolean;
  reference: (message: Message) => string | undefined; pauseReason: string | null;
}) {
  const { t } = useI18n();
  return <div className="conversation-steering">
    {pauseReason && <p className="pause-reason">{pauseReason}</p>}
    {queue.length > 0 && <section className="conversation-queue" aria-label={t('conversationQueue')}>
      <h3 className="sect">{t('conversationQueue')} <span className="count">{queue.length}</span></h3>
      <ul>{queue.map(message => <li key={message.id}><div>{reference(message) && <small className="ref">{reference(message)}</small>}<p title={message.body}>{message.body}</p></div>
        <button type="button" className="conversation-now" disabled={!active || busy} title={t('conversationProcessNowHint')} onClick={interrupt}><span aria-hidden="true">⚡</span> {t('conversationProcessNow')}</button>
        <button type="button" className="conversation-now" disabled={busy} onClick={() => withdraw(message.id)}><span aria-hidden="true">✕</span> {t('conversationWithdrawMessage')}</button>
      </li>)}</ul>
    </section>}
  </div>;
}
