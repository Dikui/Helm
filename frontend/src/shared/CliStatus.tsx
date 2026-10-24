import { useResource } from './data.js';
import { useI18n } from './i18n.js';
import { Link } from './router.js';
// Installing happens in the environment section; here a missing CLI only points there.
export function CliStatus({ driver }: { driver: string }) {
  const { t } = useI18n();
  const { data } = useResource<{ installed: boolean }>('check-agent', { driver });
  if (!data || data.installed) return null;
  return <p className="settings-reason" role="status">{t('cliMissing')} <Link href="/settings/environment">{t('openEnvironment')}</Link></p>;
}
