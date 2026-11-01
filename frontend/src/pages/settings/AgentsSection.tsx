import { useEffect, useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { AgentEntry } from './types.js';
import { AgentEditor } from './AgentEditor.js';
import { DriverGroup, environmentChanged, type Tool } from './EnvironmentSection.js';
export function AgentsSection({ agentId, creating = false }: { agentId?: string; creating?: boolean }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<AgentEntry[]>('list-agents');
  const environment = useResource<Tool[]>('check-environment', {}, environmentChanged);
  const { navigate } = useRouter();
  const [lastSaved, setLastSaved] = useState<AgentEntry>();
  const saveFinished = (result: AgentEntry) => { setLastSaved({ ...result, runningDispatches: result.runningDispatches ?? 0, activeWorks: result.activeWorks ?? 0 }); reload(); };
  const [copy, setCopy] = useState<AgentEntry>();
  useEffect(() => { if (!creating) setCopy(undefined); }, [creating]);
  const selected = agentId ? data?.find(item => item.id === agentId) ?? (lastSaved?.id === agentId ? lastSaved : undefined) : data?.[0];
  return <div className="settings-agents">
    <div className="settings-agent-list">
      <div className="settings-heading"><p className="muted">{t('agentHelp')}</p>
        <Link className="btn sm" href="/settings/new-agent">{t('newAgent')}</Link></div>
      {error && <ErrorNotice error={error} retry={reload} />}{environment.error && <ErrorNotice error={environment.error} retry={environment.reload} />}
      {!data && !error && <p role="status">{t('loading')}</p>}
      {data?.length === 0 && <p>{t('emptyAgents')}</p>}
      {(['claude-sdk', 'codex', 'grok', 'deepseek', null] as const).map(driver => {
        const entries = data?.filter(item => item.driver === driver) ?? [];
        if (driver === null && !entries.length) return null;
        return <DriverGroup key={driver ?? 'unknown'} driver={driver} tool={environment.data?.find(tool => tool.name === driver)} entries={entries} selectedId={creating ? undefined : selected?.id} onRechecked={() => { reload(); environment.reload(); }} />;
      })}
    </div>
    {creating ? <AgentEditor key="create-agent" source={copy} creating onSaved={result => { setCopy(undefined); saveFinished(result); }} />
      : selected ? <AgentEditor key={`agent:${selected.id}`} source={selected} initialSaved={lastSaved?.id === selected.id} onSaved={saveFinished} onRechecked={reload} onDeleted={() => { setLastSaved(undefined); reload(); }} onDuplicate={source => { setCopy(source); navigate('/settings/new-agent'); }} />
      : data && agentId && <p>{t('agentMissing')}</p>}
  </div>;
}
