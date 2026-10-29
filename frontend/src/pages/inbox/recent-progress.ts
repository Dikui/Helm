import type { HelmEvent } from '../../shared/types.js';
import type { MessageKey } from '../../shared/i18n.js';

export const progressLabels: Record<string, MessageKey> = {
  'card-completed': 'progressCardCompleted', 'card-cancelled': 'cancelled', 'card-skipped': 'skipped',
  'dispatch-started': 'progressDispatchStarted', 'dispatch-ended': 'progressDispatchEnded', 'dispatch-step': 'progressStep',
  'gate-created': 'progressGateCreated', 'gate-decided': 'graphDecided',
  'work-description-drafted': 'progressBriefDrafted', 'work-paused': 'paused', 'work-completed': 'completed',
  'round-started': 'progressRoundStarted', 'round-ended': 'progressRoundEnded', 'round-step': 'progressRoundStep',
};
export function recentProgress(events: HelmEvent[]) {
  return events.filter(event => progressLabels[event.action]).slice().sort((a, b) => a.id - b.id).slice(-3);
}
