import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../shared/data.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';
import { LibraryField, validLibraryName, type LibraryFormState } from './LibraryField.js';
import { SaveFeedback } from './SaveFeedback.js';
import { useSettingsSave } from './useSettingsSave.js';

const empty = { name: '', transport: 'http' as 'http' | 'stdio', url: '', headers: '', command: '', args: '', env: '' };
type Draft = typeof empty;
function stringMap(text: string): Record<string, string> | undefined {
  try {
    const value: unknown = JSON.parse(text.trim() || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string')) return value as Record<string, string>;
  } catch { /* Report a localized field error without echoing sensitive input. */ }
}
function stringArgs(text: string): string[] | undefined {
  try {
    const value: unknown = JSON.parse(text.trim() || '[]');
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value;
  } catch { /* JSON parse errors can contain the input; keep them out of feedback. */ }
}
export function RegisterMcpForm({ onRegistered, onStateChange }: { onRegistered: () => void; onStateChange: (state: LibraryFormState) => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const [draft, setDraft] = useState(empty);
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, MessageKey>>>({});
  const save = useSettingsSave();
  useEffect(() => { onStateChange({ dirty: Object.entries(draft).some(([key, value]) => key !== 'transport' && !!value), pending: save.pending }); }, [draft, save.pending, onStateChange]);
  function change<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft(previous => ({ ...previous, [key]: value }));
    setErrors(previous => { const next = { ...previous }; delete next[key]; return next; }); save.clear();
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); save.clear();
    const invalid: Partial<Record<keyof Draft, MessageKey>> = {};
    if (!draft.name.trim()) invalid.name = 'requiredField';
    else if (!validLibraryName(draft.name.trim())) invalid.name = 'invalidAgentId';
    let config;
    if (draft.transport === 'http') {
      try { if (!['http:', 'https:'].includes(new URL(draft.url).protocol)) throw new Error(); }
      catch { invalid.url = 'libraryInvalidUrl'; }
      const headers = stringMap(draft.headers);
      if (!headers) invalid.headers = 'libraryInvalidMap';
      config = { type: 'http', url: draft.url.trim(), headers };
    } else {
      if (!draft.command.trim()) invalid.command = 'requiredField';
      const args = stringArgs(draft.args);
      if (!args) invalid.args = 'libraryInvalidArgs';
      const env = stringMap(draft.env);
      if (!env) invalid.env = 'libraryInvalidMap';
      config = { type: 'stdio', command: draft.command, args, env };
    }
    setErrors(invalid);
    const first = Object.keys(invalid)[0];
    if (first) { document.getElementById(`library-mcp-${first}`)?.focus(); return; }
    await save.run(async () => {
      await api.call('register-mcp', { name: draft.name.trim(), config });
      setDraft({ ...empty, transport: draft.transport }); onRegistered();
    });
  }
  const fields: { key: Exclude<keyof Draft, 'transport'>; label: MessageKey; type?: 'url'; reveal?: { show: MessageKey; hide: MessageKey } }[] = [
    { key: 'name', label: 'libraryMcpName' },
    ...(draft.transport === 'http' ? [
      { key: 'url' as const, label: 'libraryMcpUrl' as const, type: 'url' as const },
      { key: 'headers' as const, label: 'libraryMcpHeaders' as const, reveal: { show: 'libraryShowHeaders' as const, hide: 'libraryHideHeaders' as const } },
    ] : [
      { key: 'command' as const, label: 'libraryMcpCommand' as const }, { key: 'args' as const, label: 'libraryMcpArgs' as const },
      { key: 'env' as const, label: 'libraryMcpEnv' as const, reveal: { show: 'libraryShowEnv' as const, hide: 'libraryHideEnv' as const } },
    ]),
  ];
  return <form className="settings-box" aria-label={t('libraryRegisterMcp')} noValidate aria-busy={save.pending} onSubmit={submit}>
    <h3>{t('libraryRegisterMcp')}</h3><p className="muted">{t('libraryMcpHelp')}</p>
    <label>{t('libraryMcpTransport')}{/* Native select follows the settings page's platform-owned popup convention. */}
      <select value={draft.transport} disabled={save.pending} onChange={event => { change('transport', event.target.value as Draft['transport']); setErrors({}); }}>
        <option value="http">HTTP</option><option value="stdio">stdio</option>
      </select></label>
    {fields.map(field => <LibraryField key={field.key} id={`library-mcp-${field.key}`} label={field.label} type={field.type} reveal={field.reveal}
      value={draft[field.key]} error={errors[field.key]} disabled={save.pending} onChange={value => change(field.key, value)} />)}
    <SaveFeedback {...save} /><div className="row"><button className="btn primary" disabled={save.pending}>{t('libraryRegisterMcp')}</button></div>
  </form>;
}
