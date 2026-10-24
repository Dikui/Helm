import { useEffect, useState } from 'react';
import { useI18n, type MessageKey } from '../../shared/i18n.js';

export const validLibraryName = (name: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(name);
export interface LibraryFormState { dirty: boolean; pending: boolean }

export function LibraryField({ id, label, value, onChange, disabled, error, type = 'text', reveal }: {
  id: string; label: MessageKey; value: string; onChange: (value: string) => void; disabled: boolean;
  error?: MessageKey; type?: 'text' | 'url'; reveal?: { show: MessageKey; hide: MessageKey };
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!value) setVisible(false); }, [value]);
  return <div className="settings-library-field">
    <label htmlFor={id}>{t(label)}</label><div className="settings-library-input">
      <input id={id} type={reveal && !visible ? 'password' : type} value={value} disabled={disabled} spellCheck={false}
        autoComplete="off" aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} onChange={event => onChange(event.target.value)} />
      {reveal && <button type="button" className="btn sm" aria-controls={id} aria-pressed={visible} disabled={disabled}
        onClick={() => setVisible(value => !value)}>{t(visible ? reveal.hide : reveal.show)}</button>}
    </div>{error && <p className="settings-reason" id={`${id}-error`}>{t(error)}</p>}
  </div>;
}
