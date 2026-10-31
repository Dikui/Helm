import { useEffect, useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { AgentEntry } from './types.js';
import { AgentEditor } from './AgentEditor.js';
export function AgentsSection({ agentId, creating = false }: { agentId?: string; creating?: boolean }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<AgentEntry[]>('list-agents');
  const { navigate } = useRouter();
  const [lastSaved, setLastSaved] = useState<AgentEntry>();
  const saveFinished = (result: AgentEntry) => { setLastSaved({ ...result, runningDispatches: result.runningDispatches ?? 0, activeWorks: result.activeWorks ?? 0 }); reload(); };
  const [copy, setCopy] = useState<AgentEntry>();
  useEffect(() => { if (!creating) setCopy(undefined); }, [creating]);
  const selected = agentId ? data?.find(item => item.id === agentId) ?? (lastSaved?.id === agentId ? lastSaved : undefined) : data?.[0];
  return <div className="settings-agents">
    <div className="settings-agent-list">
      <div className="settings-heading"><div><h2>{t('agents')}</h2><p className="muted">{t('agentHelp')}</p></div>
        <Link className="btn sm" href="/settings/new-agent">{t('newAgent')}</Link></div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {!data && !error && <p role="status">{t('loading')}</p>}
      {data?.length === 0 && <p>{t('emptyAgents')}</p>}
      {(['coordinator', 'executor', null] as const).map(role => {
        const entries = data?.filter(item => item.role === role) ?? [];
        if (!entries.length) return null;
        const title = t(role === 'coordinator' ? 'coordinatorRole' : role === 'executor' ? 'executorAgents' : 'unrecognizedAgents');
        return <section key={role ?? 'unknown'} aria-label={title}><h3 className="sect">{title} <span className="count">{entries.length}</span></h3>
          {entries.map(item => <Link key={item.id} href={`/settings/agents/${encodeURIComponent(item.id)}`} className={`settings-agent-row${item.available ? '' : ' off'}`} aria-current={item.id === selected?.id ? 'page' : undefined}>
            <span className="settings-driver mono">{item.driver ? { 'claude-sdk': 'C', codex: 'X', grok: 'G', deepseek: 'D' }[item.driver] : '?'}</span>
            <span><b className="mono">{item.id}</b><span className="settings-meta">{item.driver} · {item.model ?? t('driverDefault')}{item.reasoningEffort ? ` · ${item.reasoningEffort}` : ''} <span className="settings-bill">{t(item.billing === 'api' ? 'apiBilling' : 'subscription')}</span></span><span className="settings-meta">{item.description}</span>
              {!item.available && <span className="settings-reason">{item.reason}{item.command && <> <code>{item.command}</code></>}</span>}
              {item.warnings?.map(warning => <span key={warning} className="settings-warning">{warning}</span>)}</span>
            <span className="settings-agent-status"><span className={`pill ${item.available ? 'ok' : 'bad'}`}>{t(item.available ? 'available' : 'unavailable')}</span>
              <span>{item.runningDispatches} {t('dispatchCount')} · {item.activeWorks} {t('workCount')}</span></span>
          </Link>)}
        </section>;
      })}
    </div>
    {creating ? <AgentEditor key="create-agent" source={copy} creating onSaved={result => { setCopy(undefined); saveFinished(result); }} />
      : selected ? <AgentEditor key={`agent:${selected.id}`} source={selected} initialSaved={lastSaved?.id === selected.id} onSaved={saveFinished} onRechecked={reload} onDeleted={() => { setLastSaved(undefined); reload(); }} onDuplicate={source => { setCopy(source); navigate('/settings/new-agent'); }} />
      : data && agentId && <p>{t('agentMissing')}</p>}
  </div>;
}
