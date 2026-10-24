import type { Dispatch } from './types.js';

// A failed verification becomes a send-back when the coordinator dispatches
// execution again on that same card. Retries without failed verification do not count.
export function sendBackDispatchIds(dispatches: Dispatch[]) {
  const pending = new Set<string>();
  const result = new Set<string>();
  for (const dispatch of dispatches) {
    if (dispatch.purpose === 'verification') {
      if (dispatch.conclusion === 'failed') pending.add(dispatch.cardId);
      else pending.delete(dispatch.cardId);
    } else if (pending.delete(dispatch.cardId)) result.add(dispatch.id);
  }
  return result;
}
