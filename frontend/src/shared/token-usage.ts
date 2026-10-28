import type { Usage } from './types.js';

export function totalTokens(usage: Usage): number | null {
  return usage.inputTokens == null || usage.outputTokens == null ? null : usage.inputTokens + usage.outputTokens;
}

export function sumUsage(rows: { usage: Usage }[]): Usage {
  const sum = (key: keyof Usage) => rows.length && rows.every(row => row.usage[key] != null)
    ? rows.reduce((total, row) => total + row.usage[key]!, 0) : null;
  return { inputTokens: sum('inputTokens'), outputTokens: sum('outputTokens') };
}
