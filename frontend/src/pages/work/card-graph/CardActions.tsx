import { useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useData } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../../shared/i18n.js';
import { nodeTitle } from './labels.js';
import type { CardNode } from './types.js';

export function CardActions({ card }: { card: CardNode }) {
  const { t } = useI18n();
  const { api } = useData();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [feedback, setFeedback] = useState<MessageKey>();
  const [confirming, setConfirming] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const lock = useRef(false);
  const close = useCallback(() => setConfirming(false), []);
  const run = async (operation: 'pause-card' | 'resume-card') => {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(undefined); setFeedback(undefined);
    try {
      await api.call(operation, { workId: card.workId, cardId: card.id });
      setFeedback(operation === 'pause-card' ? 'graphPausedFeedback' : 'graphResumedFeedback');
    } catch (error) { setError(error as Error); }
    finally { lock.current = false; setPending(false); }
  };
  const terminal = card.status === 'completed' || card.status === 'cancelled';
  return <div className="cg-actions" ref={container} tabIndex={-1}>
    {error && <ErrorNotice error={error} />}
    {feedback && <p role="status">{t(feedback)}</p>}
    {!terminal && <div className="row">
      <button className="btn sm" disabled={pending || confirming} aria-busy={pending} onClick={() => void run(card.status === 'paused' ? 'resume-card' : 'pause-card')}>{t(card.status === 'paused' ? 'graphResume' : 'graphPause')}</button>
      <button className="btn sm cg-danger" ref={cancelButton} disabled={pending || confirming} onClick={() => setConfirming(true)}>{t('graphCancel')}</button>
    </div>}
    {confirming && <CancelCardDialog card={card} close={close} restoreFocus={cancelButton} fallbackFocus={container} completed={() => { close(); setFeedback('graphCancelledFeedback'); }} />}
  </div>;
}
function CancelCardDialog({ card, close, completed, restoreFocus, fallbackFocus }: {
  card: CardNode; close: () => void; completed: () => void;
  restoreFocus: RefObject<HTMLButtonElement | null>; fallbackFocus: RefObject<HTMLDivElement | null>;
}) {
  const { t } = useI18n();
  const { api } = useData();
  const titleId = useId(); const descriptionId = useId(); const errorId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState(t('graphDefaultCancelReason'));
  const [invalid, setInvalid] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const lock = useRef(false);
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('.shell');
    const wasInert = shell?.hasAttribute('inert');
    const overflow = document.body.style.overflow;
    shell?.setAttribute('inert', '');
    document.body.style.overflow = 'hidden';
    keep.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); if (!lock.current) close(); }
      if (event.key === 'Tab') {
        const items = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)')];
        if (!items.length) { event.preventDefault(); dialog.current?.focus(); return; }
        const first = items[0]; const last = items.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const focus = (event: FocusEvent) => { if (!dialog.current?.contains(event.target as Node)) (lock.current ? dialog.current : keep.current)?.focus(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focus);
    return () => {
      document.removeEventListener('keydown', keydown);
      document.removeEventListener('focusin', focus);
      if (!wasInert) shell?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      (restoreFocus.current?.isConnected ? restoreFocus.current : fallbackFocus.current)?.focus();
    };
  }, [close, restoreFocus, fallbackFocus]);
  return createPortal(<div className="cg-dialog-backdrop">
    <div className="cg-dialog" role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} ref={dialog} tabIndex={-1}>
      <h2 id={titleId}>{t('graphCancel')}：{nodeTitle(card)}</h2>
      <p id={descriptionId}>{t('graphCancelConsequence')}</p>
      <form noValidate onSubmit={async event => {
        event.preventDefault();
        if (lock.current) return;
        if (!reason.trim()) { setInvalid(true); reasonInput.current?.focus(); return; }
        lock.current = true; setPending(true); setError(undefined); setInvalid(false);
        try { await api.call('cancel-card', { workId: card.workId, cardId: card.id, reason: reason.trim() }); completed(); }
        catch (error) { setError(error as Error); }
        finally { lock.current = false; setPending(false); }
      }}>
        <label>{t('graphCancelReason')}<textarea className="resize-none" ref={reasonInput} value={reason} disabled={pending} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} onChange={event => setReason(event.target.value)} /></label>
        {invalid && <p className="error" role="alert" id={errorId}>{t('graphReasonRequired')}</p>}
        {error && <ErrorNotice error={error} />}
        <div className="row">
          <button type="button" className="btn" ref={keep} disabled={pending} onClick={close}>{t('graphKeepCard')}</button>
          <button className="btn cg-danger" disabled={pending} aria-busy={pending} type="submit">{t('graphConfirmCancel')}</button>
        </div>
      </form>
    </div>
  </div>, document.body);
}
