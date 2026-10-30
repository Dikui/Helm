import { useI18n } from '../../../shared/i18n.js';
import type { ConversationItem } from './types.js';
import './conversation.css';

export function GateHistory({ gate }: { gate: Extract<ConversationItem, { type: 'gate' }> }) {
  const { t } = useI18n();
  return <div className="conversation-gate-history"><strong>{gate.question}</strong><span className="pill">{t(gate.status === 'decided' ? 'conversationDecided' : gate.status === 'withdrawn' ? 'conversationWithdrawn' : 'conversationClosed')}</span>
    {gate.body && <p>{gate.body}</p>}{gate.decision && <p className="conversation-gate-decision">{gate.kind === 'work-confirmation' && gate.decision === 'confirm' ? t('confirm') : gate.decision}</p>}{gate.withdrawalReason && <p>{gate.withdrawalReason}</p>}</div>;
}
