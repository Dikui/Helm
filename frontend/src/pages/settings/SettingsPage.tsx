import { useI18n } from '../../shared/i18n.js';
import { Link, type RouteParams } from '../../shared/router.js';
export function SettingsPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  return <><header className="top"><h1>{t('settings')}</h1></header><div className="page-body">
    <nav className="settings-nav" aria-label={t('settings')}>{(['templates', 'projects', 'runtime'] as const).map(section => <Link key={section} href={`/settings/${section}`} aria-current={route.section === section ? 'page' : undefined}>{t(section)}</Link>)}</nav>
    <p className="muted">{t('pagePending')}</p>
  </div></>;
}
