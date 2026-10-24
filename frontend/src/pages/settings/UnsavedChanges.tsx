import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../shared/i18n.js';
import { useRouter } from '../../shared/router.js';

// Keep the scope local to settings forms; routing and history remain shared.
export function UnsavedChanges({ dirty, pending }: { dirty: boolean; pending: boolean }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [destination, setDestination] = useState<string>();
  const cancel = useRef<HTMLButtonElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dirty && !pending) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      if (!pending) { trigger.current = link; setDestination(link.pathname); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, pending]);
  useEffect(() => { if (destination) cancel.current?.focus(); }, [destination]);
  if (!destination) return null;
  return <div className="settings-leave" role="region" aria-label={t('unsavedChanges')}><p>{t('unsavedChanges')}</p><div className="row">
    <button ref={cancel} type="button" className="btn" onClick={() => { setDestination(undefined); trigger.current?.focus(); }}>{t('keepEditing')}</button>
    <button type="button" className="btn" onClick={() => { setDestination(undefined); navigate(destination); }}>{t('discardChanges')}</button>
  </div></div>;
}
