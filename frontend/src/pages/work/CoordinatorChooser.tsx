import { useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { AgentInstall } from '../../shared/AgentInstall.js';

interface CoordinatorAgent { id: string; role: string | null; driver: string | null; available: boolean; reason: string | null; description: string | null }
export function CoordinatorChooser({ current, busy, onSubmit }: { current?: string; busy: boolean; onSubmit: (id: string) => void }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<CoordinatorAgent[]>('list-agents');
  const [selected, setSelected] = useState(current ?? '');
  const agents = data?.filter(agent => agent.role === 'coordinator');
  const chosen = agents?.find(agent => agent.id === selected);
  return <form noValidate onSubmit={event => { event.preventDefault(); if (!busy && !error && chosen?.available) onSubmit(selected); }}>
    <p>{t('coordinatorNextRound')}</p>
    {error && <ErrorNotice error={error} retry={reload} />}
    {!data && !error && <p role="status">{t('loading')}</p>}
    {agents && <fieldset disabled={busy || Boolean(error)} className="coordinator-options"><legend>{t('availableCoordinators')}</legend>
      {agents.length === 0 && <p>{t('noAvailableCoordinators')}</p>}
      {agents.map(agent => <label key={agent.id} className="coordinator-option"><input type="radio" name="coordinator" value={agent.id}
        checked={selected === agent.id} onChange={() => setSelected(agent.id)} /><span><b>{agent.id}</b><span className="muted">{agent.description}</span>{!agent.available && <span className="settings-reason">{agent.reason}</span>}</span></label>)}
    </fieldset>}
    {chosen?.driver && <AgentInstall key={chosen.driver} driver={chosen.driver} onInstalled={reload} />}
    <button className="btn primary" disabled={busy || Boolean(error) || !chosen?.available}>{t('applyCoordinator')}</button>
  </form>;
}
