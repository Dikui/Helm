import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OperationError } from '../../shared/api.js';
import { useData } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';

export function RegisterProjectForm({ onRegistered, onCancel, onPendingChange }: {
  onRegistered: (id: string) => void; onCancel?: () => void; onPendingChange?: (pending: boolean) => void;
}) {
  const { api } = useData();
  const { t } = useI18n();
  const [path, setPath] = useState('');
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const [error, setError] = useState<Error>();
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (error && !pending) input.current?.focus(); }, [error, pending]);
  const invalidPath = error instanceof OperationError && error.failure.code === 'INVALID_PROJECT';
  const initializable = error instanceof OperationError && Boolean(error.failure.details?.initializable);
  const register = async (initGit: boolean) => {
    if (busy.current) return;
    if (!path.trim()) { input.current?.focus(); return; }
    busy.current = true; setPending(true); onPendingChange?.(true); setError(undefined);
    try {
      const project = await api.call<{ id: string }>('register-project', { path: path.trim(), ...(initGit ? { initGit } : {}) });
      onRegistered(project.id);
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); onPendingChange?.(false); }
  };
  return <form noValidate className="project-registration" aria-busy={pending} onSubmit={event => { event.preventDefault(); void register(false); }}>
    <p id="project-path-help" className="muted">{t('newWorkRegisterHint')}</p>
    <label>{t('newWorkProjectPath')}<input ref={input} value={path} disabled={pending} placeholder="/Users/you/code/web-app"
      aria-invalid={invalidPath || undefined} aria-describedby={`project-path-help${error ? ' project-register-error' : ''}`}
      onChange={event => { setPath(event.target.value); setError(undefined); }} /></label>
    {error && <div id="project-register-error"><ErrorNotice error={error} /></div>}
    {initializable && <p className="muted">{t('newWorkInitGitHint')} <button type="button" className="btn" disabled={pending} onClick={() => void register(true)}>{t('newWorkInitGit')}</button></p>}
    <div className="acts">{onCancel && <button type="button" className="btn" disabled={pending} onClick={onCancel}>{t('newWorkCancel')}</button>}
      <button className="btn primary" disabled={pending || !path.trim()}>{t('newWorkRegister')}</button></div>
  </form>;
}

export function RegisterProjectDialog({ onRegistered, onClose }: { onRegistered: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const panel = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (pending) panel.current?.focus(); }, [pending]);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const shell = document.querySelector<HTMLElement>('.shell');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    panel.current?.querySelector('input')?.focus();
    return () => { if (shell) shell.inert = wasInert; opener?.focus(); };
  }, []);
  return createPortal(<div className="register-overlay">
    <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-busy={pending} aria-labelledby="register-project-title" className="register-dialog" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); if (!pending) onClose(); }
      if (event.key !== 'Tab') return;
      const controls = [...panel.current!.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')];
      if (!controls.length) { event.preventDefault(); panel.current?.focus(); return; }
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
      <h2 id="register-project-title">{t('newWorkRegisterProject')}</h2>
      <RegisterProjectForm onRegistered={onRegistered} onCancel={onClose} onPendingChange={setPending} />
      <button type="button" className="btn sm ghost register-close" disabled={pending} aria-label={t('close')} onClick={onClose}>×</button>
    </div>
  </div>, document.body);
}
