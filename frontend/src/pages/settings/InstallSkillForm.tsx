import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../shared/data.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';
import { LibraryField, validLibraryName, type LibraryFormState } from './LibraryField.js';

export function InstallSkillForm({ onInstalled, onStateChange }: { onInstalled: () => void; onStateChange: (state: LibraryFormState) => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const [path, setPath] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const save = useSettingsSave();
  useEffect(() => { onStateChange({ dirty: !!(path || name), pending: save.pending }); }, [path, name, save.pending, onStateChange]);
  async function submit(event: FormEvent) {
    event.preventDefault(); save.clear();
    const invalid: Record<string, MessageKey> = {};
    if (!path.trim()) invalid.path = 'requiredField';
    if (name.trim() && !validLibraryName(name.trim())) invalid.name = 'invalidAgentId';
    setErrors(invalid);
    const first = Object.keys(invalid)[0];
    if (first) { document.getElementById(`library-skill-${first}`)?.focus(); return; }
    await save.run(async () => {
      await api.call('install-skill', { path, ...(name.trim() ? { name: name.trim() } : {}) });
      setPath(''); setName(''); onInstalled();
    });
  }
  return <form className="settings-box" aria-label={t('libraryInstallSkill')} noValidate aria-busy={save.pending} onSubmit={submit}>
      <h3>{t('libraryInstallSkill')}</h3><p className="muted">{t('librarySkillHelp')}</p>
      {([{ key: 'path', label: 'librarySkillPath', value: path, change: setPath },
        { key: 'name', label: 'librarySkillName', value: name, change: setName }] as const).map(field => <LibraryField key={field.key}
        id={`library-skill-${field.key}`} label={field.label} disabled={save.pending} value={field.value} error={errors[field.key]} onChange={value => {
          field.change(value); setErrors(previous => { const next = { ...previous }; delete next[field.key]; return next; }); save.clear();
        }} />)}
      <SaveFeedback {...save} /><div className="row"><button className="btn primary" disabled={save.pending}>{t('libraryInstallSkill')}</button></div>
    </form>;
}
