import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { OperationError } from '../../shared/api.js';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';

const unaffected = () => false;

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
  const missing = error instanceof OperationError && Boolean(error.failure.details?.missing);
  // The dropdown lists subdirectories of the typed path's parent, filtered by the last segment.
  const parent = path.slice(0, path.lastIndexOf('/') + 1);
  const listing = useResource<{ path: string; directories: { name: string; git: boolean }[] }>('list-directories', parent ? { path: parent } : {}, unaffected);
  const prefix = path.slice(parent.length).toLowerCase();
  const options = (listing.data?.directories ?? []).filter(directory => directory.name.toLowerCase().startsWith(prefix))
    .map(directory => ({ ...directory, path: `${listing.data!.path.replace(/\/$/, '')}/${directory.name}/` }));
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const expanded = open && !pending && options.length > 0;
  const choose = (value: string) => {
    setPath(value); setError(undefined); setActive(-1); setOpen(true);
    // Keep the newly appended segment in view; a long path otherwise stays scrolled at the old end.
    requestAnimationFrame(() => { const field = input.current; if (field) { field.setSelectionRange(value.length, value.length); field.scrollLeft = field.scrollWidth; } });
  };
  const register = async (createDirectory = false) => {
    if (busy.current) return;
    if (!path.trim()) { input.current?.focus(); return; }
    busy.current = true; setPending(true); onPendingChange?.(true); setError(undefined);
    try {
      const project = await api.call<{ id: string }>('register-project', { path: path.trim(), ...(createDirectory ? { createDirectory } : {}) });
      onRegistered(project.id);
    } catch (error) { setError(error as Error); }
    finally { busy.current = false; setPending(false); onPendingChange?.(false); }
  };
  return <form noValidate className="project-registration" aria-busy={pending} onSubmit={event => { event.preventDefault(); void register(); }}>
    <p id="project-path-help" className="muted">{t('newWorkRegisterHint')}</p>
    <label>{t('newWorkProjectPath')}<input ref={input} value={path} disabled={pending} placeholder="/Users/you/code/web-app"
      role="combobox" aria-autocomplete="list" aria-expanded={expanded} aria-controls="project-path-options"
      aria-activedescendant={expanded && active >= 0 ? `project-path-option-${active}` : undefined}
      aria-invalid={invalidPath || undefined} aria-describedby={`project-path-help${error ? ' project-register-error' : ''}`}
      onClick={() => setOpen(true)}
      // Closing on a click into the form's buttons would shift them before mouseup and swallow the click.
      onBlur={event => { if (!event.currentTarget.form?.contains(event.relatedTarget)) setOpen(false); }}
      onChange={event => { setPath(event.target.value); setError(undefined); setActive(-1); setOpen(true); }}
      onKeyDown={event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault(); setOpen(true);
          if (options.length) setActive(index => (index + (event.key === 'ArrowDown' ? 1 : options.length - 1 + (index < 0 ? 1 : 0))) % options.length);
        } else if (event.key === 'Enter' && expanded && active >= 0) { event.preventDefault(); choose(options[active]!.path); }
        else if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); setOpen(false); }
        else if (event.key === 'Tab') setOpen(false);
      }} /></label>
    {expanded && <ul id="project-path-options" role="listbox" className="project-path-options">
      {options.map((option, index) => <li key={option.path} id={`project-path-option-${index}`} role="option" aria-selected={index === active}
        onMouseDown={event => event.preventDefault()} onClick={() => choose(option.path)}>
        <span>{option.name}/</span>{option.git && <span className="muted">git</span>}</li>)}
    </ul>}
    {error && <div id="project-register-error"><ErrorNotice error={error} /></div>}
    {missing && <p className="muted">{t('newWorkCreateDirectoryHint')} <button type="button" className="btn" disabled={pending} onClick={() => void register(true)}>{t('newWorkCreateDirectory')}</button></p>}
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
