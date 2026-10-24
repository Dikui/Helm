import { DataProvider } from './shared/data.js';
import { I18nProvider } from './shared/i18n.js';
import { Router, RouteOutlet } from './shared/router.js';
import type { Fetch } from './shared/api.js';
import { Inbox } from './pages/inbox/Inbox.js';
import { routes } from './routes.js';
export function App({ baseUrl, transport }: { baseUrl?: string; transport?: Fetch }) {
  return <I18nProvider><DataProvider baseUrl={baseUrl} transport={transport}><Router>
    <div className="shell"><Inbox /><main className="inset"><RouteOutlet routes={routes} /></main></div>
  </Router></DataProvider></I18nProvider>;
}
