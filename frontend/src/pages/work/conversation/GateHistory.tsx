import { useI18n } from '../../../shared/i18n.js';
import { GitInitializationDetails } from '../../inbox/GitInitializationDetails.js';
import type { ConversationItem } from './types.js';
import './conversation.css';

export function GateHistory({ gate, decidedAt }: { decidedAt?: string; gate: Extract<ConversationItem, { type: 'gate' }> }) {
  const { t, language } = useI18n();
  const time = decidedAt ?? gate.createdAt;
  const decision = gate.status === 'pending' ? `${t('conversationClosed')} · ${gate.question}` : gate.kind === 'work-confirmation' && gate.decision === 'confirm' ? t('eventConfirmed')
    : gate.kind === 'review' && gate.decision === 'accept' ? t('graphAccepted')
    : gate.kind === 'review' && gate.decision === 'return' ? t('graphReturned') : `${t(gate.status === 'withdrawn' ? 'eventGateWithdrawn' : 'eventGateDecided')} · ${gate.question} · ${gate.decision ?? ''}`;
  return <details className="conversation-event-history"><summary className={`conversation-event ${gate.decision === 'return' ? 'bad' : gate.status === 'decided' ? 'ok' : ''}`}>
    <time dateTime={time}>{new Date(time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time><span title={decision}>{decision}</span>
  </summary><GateDetails gate={gate} /></details>;
}

function GateDetails({ gate }: { gate: Extract<ConversationItem, { type: 'gate' }> }) {
  const { t } = useI18n();
  return <div className="conversation-gate-history"><strong>{gate.kind === 'git-initialization' ? t('gitInitTitle') : gate.question}</strong><span className="pill">{t(gate.status === 'decided' ? 'conversationDecided' : gate.status === 'withdrawn' ? 'conversationWithdrawn' : 'conversationClosed')}</span>
    {gate.kind === 'git-initialization' ? <GitInitializationDetails gate={gate} />
      : <>{gate.body && <p>{gate.body}</p>}{gate.decision && <p className="conversation-gate-decision">{gate.kind === 'work-confirmation' && gate.decision === 'confirm' ? t('confirm') : gate.decision}</p>}</>}
    {gate.withdrawalReason && <p>{gate.withdrawalReason}</p>}</div>;
}
