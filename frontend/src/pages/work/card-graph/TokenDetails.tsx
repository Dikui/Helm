import { formatTokens, useI18n } from '../../../shared/i18n.js';
import { formatUsage, sumUsage, totalTokens } from '../../../shared/token-usage.js';
import type { Usage } from '../../../shared/types.js';
import type { Round } from '../conversation/types.js';
import { endLabels } from './labels.js';
import type { Dispatch } from './types.js';

export function UsageSummary({ usage }: { usage: Usage }) {
  const { t, language } = useI18n();
  return <div className="cg-token-summary"><p>{t('tokenTotal')} {formatUsage(usage, language)}</p>
    <p className="muted">{t('tokenInput')} {formatTokens(usage.inputTokens, language)} · {t('tokenOutput')} {formatTokens(usage.outputTokens, language)}</p>
    {totalTokens(usage) === null ? <p className="hint">{t('tokenUnknown')}</p> : usage.incomplete && <p className="hint">{t('tokenIncomplete')}</p>}
  </div>;
}

export function UsageTable({ kind, rows }: { kind: 'dispatch' | 'round'; rows: { id: string; label: string; usage: Usage }[] }) {
  const { t, language } = useI18n();
  return rows.length ? <div className="cg-token-table"><table aria-label={t(kind === 'dispatch' ? 'tokenDispatches' : 'tokenRounds')}>
    <thead><tr><th>{t(kind === 'dispatch' ? 'graphDispatch' : 'structureRound')}</th><th>{t('tokenInput')} Token</th><th>{t('tokenOutput')} Token</th></tr></thead>
    <tbody>{rows.map(row => <tr key={row.id}><th scope="row">{row.label}</th><td>{formatTokens(row.usage.inputTokens, language)}</td><td>{formatTokens(row.usage.outputTokens, language)}</td></tr>)}</tbody>
  </table></div> : <p className="hint">{t(kind === 'dispatch' ? 'graphNoDispatches' : 'structureNoRounds')}</p>;
}

export function CoordinatorTokens({ rounds }: { rounds?: Round[] }) {
  const { t } = useI18n();
  return <><header className="cg-inspector-head"><small>{t('structureCoordinator')}</small><h2>{t('tokenByRound')}</h2>
    <UsageSummary usage={sumUsage(rounds ?? [])} /></header><div className="cg-inspector-body">
    {!rounds ? <p role="status">{t('loading')}</p> : <UsageTable kind="round" rows={rounds.map(round => ({ ...round,
      label: `#${round.number}${round.status === 'running' ? ` · ${t('structureRunning')}` : round.reason && round.reason !== 'completed' ? ` · ${t(endLabels[round.reason as NonNullable<Dispatch['endReason']>])}` : ''}`,
    }))} />}
  </div></>;
}
