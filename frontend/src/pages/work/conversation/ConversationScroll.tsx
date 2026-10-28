import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../../../shared/i18n.js';
import './conversation-scroll.css';

export function ConversationScroll({ className, children }: { className: string; children: ReactNode }) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const [away, setAway] = useState(false);
  const updatePosition = useCallback(() => {
    const element = viewport.current!;
    // scrollTop can be fractional; allow rounding at the bottom.
    following.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 2;
    setAway(!following.current);
  }, []);
  const follow = useCallback(() => {
    const element = viewport.current;
    if (element && following.current) element.scrollTop = element.scrollHeight;
    updatePosition();
  }, [updatePosition]);
  // Run after each rendered update, including the first asynchronous history read.
  useLayoutEffect(follow);
  useLayoutEffect(() => {
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(follow);
    observer.observe(viewport.current!);
    observer.observe(content.current!);
    return () => observer.disconnect();
  }, [follow]);
  return <div className="conversation-scroll">
    <div ref={viewport} className={className} role="region" aria-label={t('conversationHistory')} tabIndex={0} onScroll={updatePosition}>
      <div ref={content} className={`${className}-content`}>{children}</div>
    </div>
    {away && <button type="button" className="btn conversation-jump-latest" aria-label={t('conversationJumpLatest')} title={t('conversationJumpLatest')} onClick={() => {
      viewport.current!.scrollTo({ top: viewport.current!.scrollHeight,
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }}><span aria-hidden="true">↓</span></button>}
  </div>;
}
