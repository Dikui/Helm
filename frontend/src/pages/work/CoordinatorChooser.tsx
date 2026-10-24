import { useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { AgentInstall } from '../../shared/AgentInstall.js';

interface CoordinatorTemplate { id: string; role: string | null; driver: string | null; available: boolean; reason: string | null; description: string | null }
export function CoordinatorChooser({ current, busy, onSubmit }: { current?: string; busy: boolean; onSubmit: (id: string) => void }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<CoordinatorTemplate[]>('list-agent-templates');
  const [selected, setSelected] = useState(current ?? '');
  const templates = data?.filter(template => template.role === 'coordinator');
  const chosen = templates?.find(template => template.id === selected);
  return <form noValidate onSubmit={event => { event.preventDefault(); if (!busy && !error && chosen?.available) onSubmit(selected); }}>
    <p>{t('coordinatorNextRound')}</p>
    {error && <ErrorNotice error={error} retry={reload} />}
    {!data && !error && <p role="status">{t('loading')}</p>}
    {templates && <fieldset disabled={busy || Boolean(error)} className="coordinator-options"><legend>{t('availableCoordinators')}</legend>
      {templates.length === 0 && <p>{t('noAvailableCoordinators')}</p>}
      {templates.map(template => <label key={template.id} className="coordinator-option"><input type="radio" name="coordinator" value={template.id}
        checked={selected === template.id} onChange={() => setSelected(template.id)} /><span><b>{template.id}</b><span className="muted">{template.description}</span>{!template.available && <span className="settings-reason">{template.reason}</span>}</span></label>)}
    </fieldset>}
    {chosen?.driver && <AgentInstall key={chosen.driver} driver={chosen.driver} onInstalled={reload} />}
    <button className="btn primary" disabled={busy || Boolean(error) || !chosen?.available}>{t('applyCoordinator')}</button>
  </form>;
}
