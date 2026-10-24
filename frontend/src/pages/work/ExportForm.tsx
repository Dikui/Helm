import { useState } from 'react';
import { useI18n } from '../../shared/i18n.js';

export function ExportForm({ busy, onSubmit }: { busy: boolean; onSubmit: (targetPath: string) => void }) {
  const { t } = useI18n();
  const [path, setPath] = useState('');
  return <form noValidate onSubmit={event => { event.preventDefault(); if (!busy && path.trim()) onSubmit(path.trim()); }}>
    <p className="muted">{t('exportPathHelp')}</p>
    <label>{t('exportPath')}<input value={path} onChange={event => setPath(event.target.value)} disabled={busy} spellCheck={false} /></label>
    <button className="btn primary" disabled={busy || !path.trim()}>{t('exportAction')}</button>
  </form>;
}
