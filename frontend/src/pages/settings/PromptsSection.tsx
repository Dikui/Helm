import { useState, type FormEvent } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';

const names = ['coordinator-role', 'coordinator-runtime', 'executor-role', 'executor-runtime'] as const;
type PromptName = typeof names[number];
export function PromptsSection() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<Record<PromptName, string>>('get-prompts');
  return <section className="settings-simple" aria-label={t('prompts')}><h2>{t('prompts')}</h2><p className="muted">{t('promptsHelp')}</p>
    {error && <ErrorNotice error={error} retry={reload} />}{!data && !error && <p role="status">{t('loading')}</p>}
    {data && names.map(name => <PromptForm key={name} name={name} text={data[name]} />)}
  </section>;
}
function PromptForm({ name, text }: { name: PromptName; text: string }) {
  const { t } = useI18n();
  const { api } = useData();
  const [draft, setDraft] = useState(text);
  const save = useSettingsSave();
  async function submit(event: FormEvent) {
    event.preventDefault();
    await save.run(async () => { await api.call('set-prompt', { name, text: draft }); });
  }
  return <form className="settings-box" aria-label={t(name)} onSubmit={submit} aria-busy={save.pending}>
    <label htmlFor={`prompt-${name}`}><h3>{t(name)}</h3></label>
    <textarea id={`prompt-${name}`} className="mono settings-prompt" rows={name.endsWith('role') ? 16 : 6} disabled={save.pending} value={draft}
      onChange={event => { setDraft(event.target.value); save.clear(); }} />
    <SaveFeedback {...save} /><div className="row"><button className="btn primary" disabled={save.pending}>{t('save')}</button></div>
  </form>;
}
