import type { PlanEntry } from './driver.js';

// Each native update replaces the whole plan; an empty array explicitly clears it.
// Ignore a malformed snapshot rather than inventing statuses or dropping entries.
export function normalizePlan(value: unknown, contentKey: 'content' | 'step' = 'content'): PlanEntry[] | undefined {
  if (!Array.isArray(value)) return;
  const entries: PlanEntry[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || typeof entry[contentKey] !== 'string') return;
    const status = contentKey === 'step' && entry.status === 'inProgress' ? 'in_progress' : entry.status;
    if (status !== 'pending' && status !== 'in_progress' && status !== 'completed') return;
    entries.push({ content: entry[contentKey], status });
  }
  return entries;
}
