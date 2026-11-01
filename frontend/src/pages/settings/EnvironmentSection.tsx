import { useState } from 'react';
import { AgentMark } from '../../shared/AgentMark.js';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link } from '../../shared/router.js';
import type { HelmEvent } from '../../shared/types.js';
import type { AgentEntry } from './types.js';

export interface Tool { name: string; executable: string; installed: boolean; version: string | null; smokeVersion: string | null; install: string; login: string | null }
export const environmentChanged = (event: HelmEvent) => event.object.type === 'tool';
const labels: Record<string, string> = { 'claude-sdk': 'Claude CLI', codex: 'Codex CLI', grok: 'Grok CLI', deepseek: 'DeepSeek CLI' };

// The browser prerequisite remains available in Advanced after merging the CLI groups into Agents.
export function EnvironmentSection() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<Tool[]>('check-environment', {}, environmentChanged);
  return <section className="settings-simple" aria-label={t('toolBrowser')}>
    {error && <ErrorNotice error={error} retry={reload} />}
    {data?.filter(tool => tool.name === 'browser').map(tool => <DriverGroup key={tool.name} driver="browser" tool={tool} entries={[]} onRechecked={reload} />)}
  </section>;
}

export function DriverGroup({ driver, tool, entries, selectedId, onRechecked }: {
  driver: string | null; tool?: Tool; entries: AgentEntry[]; selectedId?: string; onRechecked: () => void;
}) {
  const { t } = useI18n();
  const { api } = useData();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const name = driver === 'browser' ? t('toolBrowser') : driver ? labels[driver] ?? driver : t('unrecognizedAgents');
  // Availability confirms usable credentials for these Agents, not a separate CLI login query.
  const shared = entries.filter(entry => entry.home === 'shared');
  const loginFailure = shared.some(entry => !entry.available && /未登录|登录状态|认证|not logged|auth|log.?in/i.test(entry.reason ?? ''));
  const loginStatus = loginFailure ? 'cliNotLoggedIn' : shared.some(entry => entry.available) ? 'cliCredentialsReady' : 'cliLoginUnknown';
  async function run(install = false) {
    if (pending) return;
    setPending(true); setError(undefined);
    try {
      if (install && tool) await api.call('install-tool', { name: tool.name });
      await Promise.all(entries.map(entry => api.call('recheck-agent', { id: entry.id })));
      onRechecked();
    } catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  return <section className="settings-driver-group" role="group" aria-label={name} aria-busy={pending}>
    <div className="settings-driver-head">{driver !== 'browser' && <AgentMark driver={driver} />}<h3>{name}</h3>
      <span className="mono muted">{tool?.version ?? '—'}</span>
      <span className={`pill ${tool && !tool.installed || loginFailure ? 'bad' : ''}`}>{t(tool ? tool.installed ? 'toolInstalled' : 'toolMissing' : 'cliStatusUnknown')}</span>
      {driver !== 'browser' && <span className={`pill ${loginFailure ? 'bad' : ''}`}>{t(loginStatus)}</span>}
      <button type="button" className="btn sm" disabled={pending} onClick={() => void run()}>{t('recheck')}</button>
      {tool && !tool.installed && <button type="button" className="btn sm" disabled={pending} onClick={() => void run(true)}>{t(pending ? 'installing' : 'install')}</button>}
    </div>
    {error && <ErrorNotice error={error} />}
    {tool && <details className="settings-cli-details"><summary>{t('cliInstructions')}</summary><div>
      {!tool.installed && <p className="muted">{t('installRuns')} <code>{tool.install}</code></p>}
      {tool.installed && tool.version && tool.version !== tool.smokeVersion && driver !== 'browser' && <p className="settings-reason">{tool.smokeVersion ? `${t('versionUntested')} ${tool.smokeVersion}` : t('versionNeverTested')}</p>}
      {tool.login && <p className="muted">{t('loginHint')} <code>{tool.login}</code></p>}
    </div></details>}
    {entries.map(item => <Link key={item.id} href={`/settings/agents/${encodeURIComponent(item.id)}`} className="settings-agent-row" aria-current={item.id === selectedId ? 'page' : undefined}>
      <span><b>{item.id}</b> <span className="pill">{t(item.role === 'coordinator' ? 'coordinatorRole' : item.role === 'executor' ? 'executorAgents' : 'unrecognizedAgents')}</span></span>
      <span className="settings-meta">{item.runningDispatches} {t('dispatchCount')} · {item.activeWorks} {t('workCount')}</span>
      <span className="settings-meta">{item.model ?? t('driverDefault')}{item.reasoningEffort ? ` · ${item.reasoningEffort}` : ''} · {t(item.billing === 'api' ? 'apiBilling' : 'subscription')}{item.fast ? ' · Fast' : ''} — {item.description}
        {item.warnings?.map(warning => <span key={warning} className="settings-warning">{warning}</span>)}</span>
      <span className={item.available ? 'settings-meta' : 'settings-reason'}>{t(item.available ? 'available' : 'unavailable')}{!item.available && <>: {item.reason}{item.command && <> <code>{item.command}</code></>}</>}</span>
    </Link>)}
  </section>;
}
