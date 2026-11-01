import { useEffect, useRef, useState } from 'react';
import { ActionDialog } from '../work/ActionDialog.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { useRouter } from '../../shared/router.js';

// Keep the scope local to settings forms; routing and history remain shared.
export function UnsavedChanges({ dirty, pending, onSave, error }: { dirty: boolean; pending: boolean; onSave: () => Promise<boolean>; error?: Error }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const [destination, setDestination] = useState<string>();
  const [failed, setFailed] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!dirty && !pending) return;
    const unload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const click = (event: MouseEvent) => {
      if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.origin !== window.location.origin || link.pathname === window.location.pathname) return;
      event.preventDefault(); event.stopPropagation();
      if (!pending) { trigger.current = link; setFailed(false); setDestination(`${link.pathname}${link.search}${link.hash}`); }
    };
    window.addEventListener('beforeunload', unload);
    document.addEventListener('click', click, true);
    return () => { window.removeEventListener('beforeunload', unload); document.removeEventListener('click', click, true); };
  }, [dirty, pending]);
  if (!destination) return null;
  const close = () => { setDestination(undefined); setFailed(false); };
  return <ActionDialog title={t('unsavedTitle')} description={t('unsavedHint')} busy={pending} onClose={close} returnFocus={trigger}>
    {(error || failed) && <ErrorNotice error={error ?? new Error(t('unsavedSaveFailed'))} />}
    <div className="row">
      <button type="button" className="btn" disabled={pending} onClick={close}>{t('keepEditing')}</button>
      <button type="button" className="btn" disabled={pending} onClick={() => { close(); navigate(destination); }}>{t('discardChanges')}</button>
      <button type="button" className="btn primary" disabled={pending} onClick={async () => {
        if (await onSave()) { close(); navigate(destination); } else setFailed(true);
      }}>{t(pending ? 'savingSettings' : 'saveAndLeave')}</button>
    </div>
  </ActionDialog>;
}
