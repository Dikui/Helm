import { formatTokens, useI18n, type Language } from '../../../shared/i18n.js';
import { sumUsage, uncachedTokens } from '../../../shared/token-usage.js';
import type { Usage } from '../../../shared/types.js';

// Inspector totals stay unknown if any dispatch or round omitted that count.
export function inspectorUsage(rows: { usage: Usage }[]): Usage {
  const usage = sumUsage(rows);
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens'] as const) {
    if (rows.some(row => row.usage[key] == null)) usage[key] = null;
  }
  return usage;
}
export function formatInspectorUsage(usage: Usage, language: Language) {
  return formatTokens(usage.incomplete || usage.inputTokens == null || usage.outputTokens == null ? null : usage.inputTokens + usage.outputTokens, language);
}

export function UsageSummary({ usage }: { usage: Usage }) {
  const { t, language } = useI18n();
  return <div className="cg-token-summary"><p>{t('tokenTotal')} {formatInspectorUsage(usage, language)}</p>
    <p className="muted">{t('tokenInput')} {formatTokens(usage.inputTokens, language)} · {t('tokenOutput')} {formatTokens(usage.outputTokens, language)}</p>
    {(usage.cacheReadTokens != null || usage.cacheWriteTokens != null) && <p className="muted">{t('tokenUncached')} {formatTokens(uncachedTokens(usage), language)} · {t('tokenCacheRead')} {formatTokens(usage.cacheReadTokens, language)} · {t('tokenCacheWrite')} {formatTokens(usage.cacheWriteTokens, language)}</p>}
  </div>;
}

export function UsageTable({ kind, rows, select }: { kind: 'dispatch' | 'round'; rows: { id: string; label: string; usage: Usage }[]; select?: (id: string) => void }) {
  const { t, language } = useI18n();
  if (!rows.length) return <p className="hint">{t(kind === 'dispatch' ? 'inspectorNoDispatchUsage' : 'inspectorNoRoundUsage')}</p>;
  const hasCache = rows.some(row => row.usage.cacheReadTokens != null || row.usage.cacheWriteTokens != null);
  return <><div className="cg-token-table"><table aria-label={t(kind === 'dispatch' ? 'tokenDispatches' : 'tokenRounds')}>
    <thead><tr><th scope="col">{t(kind === 'dispatch' ? 'graphDispatch' : 'structureRound')}</th><th scope="col">{t('tokenInput')}</th><th scope="col">{t('tokenOutput')}</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{select ? <button className="cg-text-link" onClick={() => select(row.id)}>{row.label}</button> : row.label}</th><td>{formatTokens(row.usage.inputTokens, language)}</td><td>{formatTokens(row.usage.outputTokens, language)}</td></tr>)}</tbody>
  </table></div>
    {rows.some(row => row.usage.incomplete || row.usage.inputTokens == null || row.usage.outputTokens == null) && <p className="hint">{t('inspectorTokenUnknown')}</p>}
    {hasCache && <details className="cg-cache-details"><summary>{t('inspectorCacheDetails')}</summary><div className="cg-token-table"><table aria-label={t('inspectorCacheDetails')}>
      <thead><tr><th scope="col">{t(kind === 'dispatch' ? 'graphDispatch' : 'structureRound')}</th><th scope="col">{t('tokenUncached')}</th><th scope="col">{t('tokenCacheRead')}</th><th scope="col">{t('tokenCacheWrite')}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{formatTokens(uncachedTokens(row.usage), language)}</td><td>{formatTokens(row.usage.cacheReadTokens, language)}</td><td>{formatTokens(row.usage.cacheWriteTokens, language)}</td></tr>)}</tbody>
    </table></div></details>}
  </>;
}
