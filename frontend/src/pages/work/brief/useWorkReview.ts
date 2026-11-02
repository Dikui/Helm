import { useCallback } from 'react';
import { useResource } from '../../../shared/data.js';
import type { HelmEvent } from '../../../shared/types.js';
import type { ReviewGate } from './types.js';

// NowStrip also reads the latest gate decision from these events.
const reviewEvents = ['operation-rejected', 'gate-decided'];

export function useWorkReview(workId: string) {
  const conversationAffects = useCallback((event: HelmEvent) => event.workId === workId
    && (event.action.startsWith('message-') || event.action.startsWith('gate-') || event.action === 'work-description-drafted'), [workId]);
  const eventsAffects = useCallback((event: HelmEvent) => event.workId === workId && reviewEvents.includes(event.action), [workId]);
  const conversation = useResource<(ReviewGate & { type: string })[]>('get-conversation', { workId }, conversationAffects);
  const events = useResource<HelmEvent[]>('get-events', { workId, actions: reviewEvents }, eventsAffects);
  const gate = conversation.data?.findLast(item => item.type === 'gate' && item.kind === 'review');
  const invalid = events.data?.findLast(event => event.action === 'operation-rejected' && event.object.id === 'request-review'
    && (event.details as { code?: string })?.code === 'INVALID_PARAMS' && gate?.status !== 'pending' && event.id > (gate?.sequence ?? 0));
  return { conversation, events, gate, invalid };
}
