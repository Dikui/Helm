import { useEffect, useId, useRef, useState } from 'react';
import { ErrorNotice } from './feedback.js';
import { useI18n } from './i18n.js';
import './copy-text.css';

export function CopyText({ label, action, value, rows = 2 }: { label: string; action: string; value: string; rows?: number }) {
  const { t } = useI18n();
  const id = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<Error>();
  useEffect(() => { setCopied(false); setError(undefined); }, [value]);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true); setCopied(false); setError(undefined);
    try {
      try {
        await navigator.clipboard.writeText(value);
      } catch {
        // Older/insecure contexts may only support copying the selected field.
        field.current?.focus(); field.current?.select();
        if (!field.current || !document.execCommand?.('copy')) throw new Error(t('copyTextFailed'));
      }
      setCopied(true);
    } catch { setError(new Error(t('copyTextFailed'))); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="copy-text" aria-busy={busy}>
    <div className="row"><label htmlFor={id}>{label}</label><button type="button" className="btn sm" disabled={busy} onClick={() => void copy()}>{action}</button></div>
    <textarea ref={field} id={id} className="mono resize-none" readOnly value={value} rows={rows} spellCheck={false} />
    <div className="copy-text-feedback">{error ? <ErrorNotice error={error} /> : <span role="status">{busy ? t('copyTextPending') : copied ? t('copyTextDone') : ''}</span>}</div>
  </div>;
}
