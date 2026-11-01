import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export const InspectorContext = createContext<{
  content: HTMLDivElement | null; heading: HTMLElement | null; rail: HTMLElement | null; header: HTMLDivElement | null;
  wide: boolean; width: number | undefined; reveal: () => void;
} | null>(null);

export function useInspector() {
  const value = useContext(InspectorContext);
  if (!value) throw new Error('InspectorContext is required');
  return value;
}

export function Inspector({ title, children }: { title: string; children: ReactNode }) {
  const { content, heading, rail } = useInspector();
  return <>
    {heading && createPortal(title, heading)}
    {rail && createPortal(`⇤ ${title}`, rail)}
    {content && createPortal(children, content)}
  </>;
}
