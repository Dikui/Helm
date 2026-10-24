import type { RouteDefinition } from './shared/router.js';
import { WorkPage } from './pages/work/WorkPage.js';
import { NewWorkPage } from './pages/new-work/NewWorkPage.js';
import { SettingsPage } from './pages/settings/SettingsPage.js';
// Page registration is the only shared file a new top-level page needs to touch.
export const routes: RouteDefinition[] = [
  { pattern: /^\/(?:works\/([^/]+)(?:\/([^/]+))?)?\/?$/, params: match => ({ workId: match[1], view: match[2] }), component: WorkPage },
  { pattern: /^\/new\/?$/, params: () => ({}), component: NewWorkPage },
  { pattern: /^\/settings(?:\/([^/]+)(?:\/([^/]+))?)?\/?$/, params: match => ({ section: match[1], agentId: match[2] }), component: SettingsPage },
];
