import { useState, type KeyboardEvent, type PointerEvent } from 'react';

// 尺寸只是本机偏好，存不进去（隐私模式等）时退回默认布局
export function useStoredSize(key: string) {
  const [size, setSize] = useState<number | undefined>(() => {
    try { const value = Number(localStorage.getItem(key)); return value > 0 ? value : undefined; } catch { return undefined; }
  });
  const store = (value: number | undefined) => {
    setSize(value);
    try { if (value === undefined) localStorage.removeItem(key); else localStorage.setItem(key, String(Math.round(value))); } catch { /* 只影响记忆 */ }
  };
  return [size, store] as const;
}

/** 拖动或方向键调整相邻区域尺寸；双击恢复默认。grow 为 -1 时向上 / 向左拖动变大。 */
export function Splitter({ label, orientation, measure, onResize, min, max, grow = 1 }: {
  label: string; orientation: 'vertical' | 'horizontal'; measure: () => number; onResize: (size: number | undefined) => void;
  min: number; max: () => number; grow?: 1 | -1;
}) {
  const [now, setNow] = useState<number>();
  const clamp = (value: number) => Math.min(Math.max(value, min), Math.max(min, max()));
  const axis = (event: PointerEvent) => orientation === 'vertical' ? event.clientX : event.clientY;
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button) return;
    event.preventDefault();
    const target = event.currentTarget; const start = axis(event); const base = measure();
    target.setPointerCapture(event.pointerId);
    const move = (next: globalThis.PointerEvent) => { const size = clamp(base + grow * ((orientation === 'vertical' ? next.clientX : next.clientY) - start)); setNow(size); onResize(size); };
    const up = () => { target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up); target.removeEventListener('pointercancel', up); };
    target.addEventListener('pointermove', move); target.addEventListener('pointerup', up); target.addEventListener('pointercancel', up);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const delta = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step }[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const size = clamp(measure() + grow * delta); setNow(size); onResize(size);
  };
  return <div className={`splitter ${orientation}`} role="separator" aria-orientation={orientation} aria-label={label} tabIndex={0}
    aria-valuemin={min} aria-valuenow={Math.round(now ?? measure())} onPointerDown={down} onKeyDown={key}
    onDoubleClick={() => { setNow(undefined); onResize(undefined); }} />;
}
