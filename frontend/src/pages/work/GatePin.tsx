import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../../shared/i18n.js';
import './gate-pin.css';

export function GatePin({ label, source, title, reason, busy = false, tone = 'attention', children }: {
  label: string; source: string; title: string; reason?: ReactNode; busy?: boolean; tone?: 'attention' | 'failure' | 'neutral'; children: ReactNode;
}) {
  const { t } = useI18n();
  const pin = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : document.activeElement;
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.repeat || event.metaKey || event.ctrlKey || event.altKey
        || !/^[1-9]$/.test(event.key) || busy || document.querySelector('dialog[open], [aria-modal="true"]')
        || target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')
        || document.querySelector('[data-gate-pin]') !== pin.current) return;
      const button = pin.current?.querySelector<HTMLButtonElement | HTMLAnchorElement>(`[aria-keyshortcuts="${event.key}"]`);
      if (!button || 'disabled' in button && button.disabled) return;
      event.preventDefault(); button.click();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [busy]);
  return <section ref={pin} data-gate-pin role="group" aria-label={label} aria-busy={busy} className={`gate-pin ${tone}`}>
    <div className="gate-pin-heading"><span className="gate-pin-source">{source}</span><b>{title}</b>
      {reason && <details><summary>{t('pinReason')}</summary><div className="gate-pin-reason">{reason}</div></details>}
    </div>
    <div className="gate-pin-options">{children}</div>
  </section>;
}
