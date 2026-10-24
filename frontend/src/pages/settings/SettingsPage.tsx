import { useI18n } from '../../shared/i18n.js';
import { Link, type RouteParams } from '../../shared/router.js';
import { TemplatesSection } from './TemplatesSection.js';
import { ProjectsSection } from './ProjectsSection.js';
import { RuntimeSection } from './RuntimeSection.js';
import './settings.css';
export function SettingsPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const section = route.section === 'new-template' ? 'templates' : route.section ?? 'templates';
  return <><header className="top"><h1>{t('settings')}</h1></header><div className="page-body settings-page">
    <nav className="settings-nav" aria-label={t('settings')}>{(['templates', 'projects', 'runtime'] as const).map(item => <Link key={item} href={`/settings/${item}`} aria-current={section === item ? 'page' : undefined}>{t(item)}</Link>)}</nav>
    {section === 'projects' ? <ProjectsSection /> : section === 'runtime' ? <RuntimeSection /> : <TemplatesSection templateId={route.templateId} creating={route.section === 'new-template'} />}
  </div></>;
}
