import { useEffect } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter, type RouteParams } from '../../shared/router.js';
import { AgentsSection } from './AgentsSection.js';
import { LibrarySection } from './LibrarySection.js';
import { ProjectsSection } from './ProjectsSection.js';
import { PromptsSection } from './PromptsSection.js';
import { RuntimeSection } from './RuntimeSection.js';
import { EnvironmentSection } from './EnvironmentSection.js';
import './settings.css';
const sections = ['agents', 'library', 'projects', 'advanced'] as const;
export function SettingsPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const { navigate } = useRouter();
  const agents = useResource<unknown[]>('list-agents');
  const library = useResource<unknown[]>('list-library');
  const projects = useResource<unknown[]>('list-projects');
  const legacy = route.section === 'environment' ? 'agents' : route.section === 'prompts' || route.section === 'runtime' ? 'advanced' : undefined;
  const section = legacy ?? sections.find(item => item === route.section) ?? 'agents';
  useEffect(() => { if (legacy) navigate(`/settings/${legacy}`, true); }, [legacy, navigate]);
  const counts = { agents, library, projects };
  return <><header className="top settings-top"><div><div className="muted">{t('settings')}</div><h1>{t(section)}</h1></div><Link className="btn" href="/">{t('backToWork')}</Link></header><div className="page-body settings-page">
    <nav className="settings-nav" aria-label={t('settings')}>{sections.map(item => <Link key={item} href={`/settings/${item}`} aria-current={section === item ? 'page' : undefined}><span>{t(item)}</span>{item !== 'advanced' && <span className="count" aria-hidden="true">{counts[item].data?.length ?? '—'}</span>}</Link>)}{Object.entries(counts).map(([name, resource]) => resource.error && <ErrorNotice key={name} error={resource.error} retry={resource.reload} />)}</nav>
    {section === 'library' ? <LibrarySection /> : section === 'projects' ? <ProjectsSection /> : section === 'advanced' ? <div className="settings-advanced"><PromptsSection /><RuntimeSection /><EnvironmentSection /></div> : <AgentsSection agentId={route.agentId} creating={route.section === 'new-agent'} />}
  </div></>;
}
