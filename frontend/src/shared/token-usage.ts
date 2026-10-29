import { formatTokens, type Language } from './i18n.js';
import type { Usage } from './types.js';

// Known part of the total; null only when nothing was reported.
export function totalTokens(usage: Usage): number | null {
  return usage.inputTokens == null && usage.outputTokens == null ? null : (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
}

// Input that touched neither cache side; unknown unless both cache counts were reported.
export function uncachedTokens(usage: Usage): number | null {
  return usage.inputTokens == null || usage.cacheReadTokens == null || usage.cacheWriteTokens == null ? null
    : Math.max(0, usage.inputTokens - usage.cacheReadTokens - usage.cacheWriteTokens);
}

const incomplete = (usage: Usage) => Boolean(usage.incomplete) || (usage.inputTokens == null) !== (usage.outputTokens == null);

// Sums what was reported; marks the result incomplete when any run left a count unknown.
export function sumUsage(rows: { usage: Usage }[]): Usage {
  const sum = (key: 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens') => rows.some(row => row.usage[key] != null)
    ? rows.reduce((total, row) => total + (row.usage[key] ?? 0), 0) : null;
  const usage: Usage = { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens'), cacheReadTokens: sum('cacheReadTokens'), cacheWriteTokens: sum('cacheWriteTokens') };
  return rows.some(row => row.usage.inputTokens == null || row.usage.outputTokens == null || row.usage.incomplete) && totalTokens(usage) !== null
    ? { ...usage, incomplete: true } : usage;
}

// "1.2M+" when part of the usage is unknown, "—" when all of it is (a known 0 plus unknowns is still nothing to show).
export function formatUsage(usage: Usage, language: Language) {
  const total = totalTokens(usage);
  if (total === 0 && incomplete(usage)) return formatTokens(null, language);
  return formatTokens(total, language) + (total !== null && incomplete(usage) ? '+' : '');
}
