import { DataProvider } from './shared/data.js';
import { I18nProvider } from './shared/i18n.js';
import { Router } from './shared/router.js';
import type { Fetch } from './shared/api.js';
import { Shell } from './shared/Shell.js';
export function App({ baseUrl, transport }: { baseUrl?: string; transport?: Fetch }) {
  return <I18nProvider><DataProvider baseUrl={baseUrl} transport={transport}><Router>
    <Shell />
  </Router></DataProvider></I18nProvider>;
}
