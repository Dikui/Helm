import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, type RouteParams } from '../../shared/router.js';
import { AgentsSection } from './AgentsSection.js';
import { EnvironmentSection } from './EnvironmentSection.js';
import { LibrarySection } from './LibrarySection.js';
import { ProjectsSection } from './ProjectsSection.js';
import { PromptsSection } from './PromptsSection.js';
import { RuntimeSection } from './RuntimeSection.js';
import './settings.css';
export function SettingsPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const agents = useResource<unknown[]>('list-agents');
  const projects = useResource<unknown[]>('list-projects');
  const section = route.section === 'new-agent' ? 'agents' : route.section ?? 'agents';
  return <><header className="top"><h1>{t('settings')}</h1></header><div className="page-body settings-page">
    <nav className="settings-nav" aria-label={t('settings')}>{(['agents', 'library', 'environment', 'projects', 'prompts', 'runtime'] as const).map(item => <Link key={item} href={`/settings/${item}`} aria-current={section === item ? 'page' : undefined}><span>{t(item)}</span>{(item === 'agents' || item === 'projects') && <span className="count" aria-hidden="true">{(item === 'agents' ? agents : projects).data?.length ?? '—'}</span>}</Link>)}{agents.error && <ErrorNotice error={agents.error} retry={agents.reload} />}{projects.error && <ErrorNotice error={projects.error} retry={projects.reload} />}</nav>
    {section === 'library' ? <LibrarySection /> : section === 'environment' ? <EnvironmentSection /> : section === 'projects' ? <ProjectsSection /> : section === 'prompts' ? <PromptsSection /> : section === 'runtime' ? <RuntimeSection /> : <AgentsSection agentId={route.agentId} creating={route.section === 'new-agent'} />}
  </div></>;
}
