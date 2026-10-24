import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { AgentSettings, LibraryEntry } from './types.js';

export function AgentLibrarySelection({ ownSkills, settings, change }: {
  ownSkills: string[]; settings: AgentSettings; change: (key: 'skills' | 'mcp', selected: string[]) => void;
}) {
  const { t } = useI18n();
  const library = useResource<LibraryEntry[]>('list-library');
  return <>
    <fieldset className="settings-capabilities"><legend>{t('agentOwnSkills')} · skills/</legend>
      <p className="muted">{t('skillsReadOnly')}</p>
      {ownSkills.length ? <ul className="settings-files">{ownSkills.map(file => <li key={file}><code>{file}</code></li>)}</ul> : <p className="muted">{t('noSkills')}</p>}
    </fieldset>
    {library.error && <div><ErrorNotice error={library.error} /><button type="button" className="btn sm" onClick={library.reload}>{t('retry')}</button></div>}
    {!library.data && !library.error && <p role="status">{t('loading')}</p>}
    {(['skills', 'mcp'] as const).map(key => {
      const entries = library.data?.filter(entry => entry.type === (key === 'skills' ? 'skill' : 'mcp')) ?? [];
      const selected = settings[key] ?? [];
      const names = [...new Set([...entries.map(entry => entry.name), ...selected])];
      return <fieldset key={key} className="settings-capabilities"><legend>{t(key === 'skills' ? 'librarySkills' : 'libraryMcp')}</legend>
        {library.data && !names.length && <p className="muted">{t('libraryNoChoices')}</p>}
        {names.map(name => {
          const missing = library.data && !entries.some(entry => entry.name === name);
          return <label key={name} className="settings-checkbox">
            <input type="checkbox" checked={selected.includes(name)} onChange={event => change(key,
              event.target.checked ? [...selected, name] : selected.filter(selectedName => selectedName !== name))} />
            <code>{name}</code>{missing && <span className="settings-reason">{t('unavailable')}</span>}
          </label>;
        })}
      </fieldset>;
    })}
  </>;
}
