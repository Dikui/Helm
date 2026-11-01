import { useResource } from '../../../shared/data.js';
import type { HelmEvent } from '../../../shared/types.js';
import type { ReviewGate } from './types.js';

export function useWorkReview(workId: string) {
  const conversation = useResource<(ReviewGate & { type: string })[]>('get-conversation', { workId });
  const events = useResource<HelmEvent[]>('get-events', { workId });
  const gate = conversation.data?.findLast(item => item.type === 'gate' && item.kind === 'review');
  const invalid = events.data?.findLast(event => event.action === 'operation-rejected' && event.object.id === 'request-review'
    && (event.details as { code?: string })?.code === 'INVALID_PARAMS' && gate?.status !== 'pending' && event.id > (gate?.sequence ?? 0));
  return { conversation, events, gate, invalid };
}
