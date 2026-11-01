import { useEffect, useRef, useState } from 'react';
import { useInspector } from '../../shared/Inspector.js';
import { useRouter } from '../../shared/router.js';
import type { WorkStatus } from '../../shared/types.js';
import { liveCardStatuses, type CardFilter } from './card-graph/presentation.js';

export const structureViews = ['list', 'graph', 'timeline', 'rounds', 'events'] as const;
export type StructureView = typeof structureViews[number];
export type Inspection = StructureView | 'coord' | 'spec' | 'report' | 'delivery' | `card:${string}`;
export function parseInspection(value: string | null): Inspection | undefined {
  return value && ([...structureViews, 'coord', 'spec', 'report', 'delivery'].includes(value) || /^card:.+/.test(value)) ? value as Inspection : undefined;
}
function phase(status: WorkStatus) {
  return status === 'aligning' ? 'alignment' : status === 'awaiting-review' ? 'review'
    : ['accepted', 'merge-queued', 'merging', 'completed'].includes(status) ? 'delivery' : 'execution';
}
function defaultInspection(status: WorkStatus): Inspection {
  return status === 'aligning' ? 'spec' : status === 'awaiting-review' ? 'report'
    : phase(status) === 'delivery' ? 'delivery' : 'list';
}

export function useWorkInspector(workId: string, status: WorkStatus) {
  const { search, navigate } = useRouter();
  const { wide, width, reveal } = useInspector();
  const requested = parseInspection(new URLSearchParams(search).get('inspect'));
  const requestedFilter = new URLSearchParams(search).get('cards');
  const filter = requested === 'list' && [...liveCardStatuses, 'other'].includes(requestedFilter ?? '') ? requestedFilter as CardFilter : undefined;
  const [inspection, setInspection] = useState<Inspection>(() => requested ?? (wide && phase(status) === 'execution' ? 'graph' : defaultInspection(status)));
  const previous = useRef({ phase: phase(status), search, wide, width });
  // Automatic defaults update the URL without reopening a folded inspector.
  const ownSearch = useRef<string | undefined>(undefined);
  const choose = (next: Inspection, replace = false, open = true, cards?: CardFilter) => {
    setInspection(next);
    const params = new URLSearchParams(window.location.search);
    params.set('inspect', next);
    if (cards) params.set('cards', cards); else params.delete('cards');
    ownSearch.current = `?${params}`;
    navigate(`/works/${encodeURIComponent(workId)}${ownSearch.current}`, replace);
    if (open) reveal();
  };
  useEffect(() => { if (requested) reveal(); }, []);
  useEffect(() => {
    const old = previous.current;
    previous.current = { phase: phase(status), search, wide, width };
    if (old.phase !== phase(status)) choose(defaultInspection(status), true, false);
    else if (old.search !== search) {
      setInspection(requested ?? defaultInspection(status));
      if (requested && ownSearch.current !== search) reveal();
      ownSearch.current = undefined;
    } else if (old.wide !== wide && old.width !== width) choose(wide ? 'graph' : 'list', true, false);
  }, [status, search, wide, width]);
  return { inspection, choose, filter, chooseCards: (cards: CardFilter) => choose('list', false, true, cards) };
}
