import { useI18n, type MessageKey } from '../../../shared/i18n.js';
import type { Dispatch, GateNode, GraphNode } from './types.js';

export const nodeTitle = (node: GraphNode) => node.type === 'card' ? (node.content.split(/\r?\n/).find(line => line.trim()) || node.content).replace(/^\s*#+\s*/, '') : node.question;
export function gateDecision(node: Pick<GateNode, 'kind' | 'decision'>, t: (key: MessageKey) => string) {
  if (node.kind === 'work-confirmation' && node.decision === 'confirm') return t('graphConfirmed');
  if (node.kind === 'review' && node.decision === 'accept') return t('graphAccepted');
  if (node.kind === 'review' && node.decision === 'return') return t('graphReturned');
  return node.decision;
}
const statuses: Record<string, MessageKey> = {
  ready: 'graphReady', waiting: 'graphWaiting', executing: 'executing', verifying: 'graphVerifying',
  paused: 'paused', completed: 'completed', cancelled: 'cancelled', skipped: 'skipped', pending: 'graphPending', decided: 'graphDecided', withdrawn: 'graphWithdrawn',
};
export function NodeStatus({ node }: { node: GraphNode }) {
  const { t } = useI18n();
  if (node.type === 'card' && node.status === 'skipped') {
    const label = node.skippedBy?.map(cause => t('graphSkippedCause').replace('{name}', cause.title)
      .replace('{reason}', t(cause.status === 'withdrawn' ? 'graphCauseWithdrawn' : 'graphCauseCancelled'))).join('；') || t('skipped');
    return <span className="pill cg-skip-chip" title={label}>{label}</span>;
  }
  const tone = node.status === 'pending' ? 'att' : ['executing', 'verifying'].includes(node.status) ? 'run' : ['completed', 'decided'].includes(node.status) ? 'ok' : 'idle';
  return <span className={`pill ${tone}`}>{node.type === 'gate' && node.kind === 'work-confirmation' && node.status === 'decided' ? t('graphConfirmed') : t(statuses[node.status]!)}</span>;
}
export const endLabels: Record<NonNullable<Dispatch['endReason']>, MessageKey> = {
  completed: 'graphEndCompleted', error: 'graphEndError', 'quota-exhausted': 'graphEndQuota',
  'timed-out': 'graphEndTimeout', aborted: 'graphEndAborted', 'context-overflow': 'graphEndContext',
};
export const conclusionLabels: Record<Dispatch['conclusion'], MessageKey> = {
  completed: 'graphReportedCompleted', blocked: 'graphReportedBlocked', passed: 'graphReportedPassed', failed: 'graphReportedFailed', undeclared: 'graphUndeclared',
};
export function DispatchStatus({ dispatch }: { dispatch: Pick<Dispatch, 'status' | 'endReason'> }) {
  const { t } = useI18n();
  return <span className={`pill ${dispatch.status !== 'ended' ? 'run' : dispatch.endReason === 'completed' ? 'ok' : 'bad'}`}>
    {t(dispatch.status === 'queued' ? 'graphQueued' : dispatch.status === 'running' ? 'graphDispatchRunning' : endLabels[dispatch.endReason!]!)}
  </span>;
}

export const nodeRingTone: Record<string, string> = { executing: 'run busy', verifying: 'run busy', completed: 'ok', decided: 'ok', pending: 'att', cancelled: 'cut', skipped: 'cut', withdrawn: 'cut' };

export function AggregateBadge() {
  const { t } = useI18n();
  return <span className="cg-aggregate" title={t('graphAggregateHint')}>{t('graphAggregate')}</span>;
}

export function ReadOnlyBadge() {
  const { t } = useI18n();
  return <span className="cg-read-only" title={t('graphReadOnlyHint')}>{t('graphReadOnly')}</span>;
}
