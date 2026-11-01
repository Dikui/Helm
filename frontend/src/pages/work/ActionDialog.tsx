import { useEffect, useId, useRef, type RefObject, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../shared/i18n.js';

// Native modal behavior owns focus containment, background inertness and Escape.
export function ActionDialog({ title, description, busy, onClose, returnFocus, className, children, open = true }: {
  returnFocus: RefObject<HTMLElement | null>; title: string; description?: string; busy: boolean; onClose: () => void; className?: string; children: ReactNode; open?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    element.showModal();
    back.current?.focus();
    return () => { element.close(); document.documentElement.style.overflow = previousOverflow; returnFocus.current?.focus(); };
  }, [returnFocus, open]);
  return createPortal(<dialog ref={dialog} className={className ? `work-action-dialog ${className}` : 'work-action-dialog'} aria-modal={open ? true : undefined} aria-labelledby={id} aria-describedby={description ? `${id}-description` : undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <div className="work-action-content" aria-busy={busy}>
      <div className="row"><h2 id={id}>{title}</h2><button ref={back} type="button" className="btn sm" disabled={busy} onClick={onClose}>{t('dialogClose')}</button></div>
      {description && <p id={`${id}-description`}>{description}</p>}
      {children}
    </div>
  </dialog>, document.body);
}
