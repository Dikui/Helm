import { useRef, type CSSProperties } from 'react';
import { DataProvider } from './shared/data.js';
import { I18nProvider, useI18n } from './shared/i18n.js';
import { Splitter, useStoredSize } from './shared/Splitter.js';
import { Router, RouteOutlet } from './shared/router.js';
import type { Fetch } from './shared/api.js';
import { Inbox } from './pages/inbox/Inbox.js';
import { OutputWarning } from './pages/work/OutputWarning.js';
import { routes } from './routes.js';
export function App({ baseUrl, transport }: { baseUrl?: string; transport?: Fetch }) {
  return <I18nProvider><DataProvider baseUrl={baseUrl} transport={transport}><Router>
    <Shell />
  </Router></DataProvider></I18nProvider>;
}
function Shell() {
  const { t } = useI18n();
  const shell = useRef<HTMLDivElement>(null);
  const [sidebar, setSidebar] = useStoredSize('helm.sidebar-width');
  return <div className="shell" ref={shell} style={sidebar ? { '--sidebar-w': `${sidebar}px` } as CSSProperties : undefined}>
    <Inbox />
    <Splitter label={t('resizeSidebar')} orientation="vertical" min={220} max={() => Math.min(560, window.innerWidth - 480)} onResize={setSidebar}
      measure={() => shell.current?.querySelector('.sb')?.getBoundingClientRect().width ?? 320} />
    <main className="inset"><OutputWarning /><RouteOutlet routes={routes} /></main>
  </div>;
}
