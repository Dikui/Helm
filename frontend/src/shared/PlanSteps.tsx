import type { PlanEntry } from '../../../src/driver.js';
import { useI18n } from './i18n.js';
import './plan-steps.css';

export function PlanSteps({ entries }: { entries: PlanEntry[] }) {
  const { t } = useI18n();
  return <ol className="plan-steps" aria-label={t('conversationPlan')}>
    {entries.map((entry, index) => <li key={index} className={`plan-${entry.status}`} aria-current={entry.status === 'in_progress' ? 'step' : undefined}>
      <span className="plan-icon" aria-hidden="true">{entry.status === 'completed' ? '✓' : entry.status === 'in_progress' ? <span className="spin" /> : null}</span>
      <span>{entry.content}</span><small>{t(entry.status === 'completed' ? 'planCompleted' : entry.status === 'in_progress' ? 'planInProgress' : 'planPending')}</small>
    </li>)}
  </ol>;
}
