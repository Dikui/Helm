import { useResource } from './data.js';
import { useI18n } from './i18n.js';
import { Link } from './router.js';
// Installing happens in the Agent driver group; here a missing CLI points there.
export function CliStatus({ driver }: { driver: string }) {
  const { t } = useI18n();
  const { data } = useResource<{ installed: boolean }>('check-agent', { driver });
  if (!data || data.installed) return null;
  return <p className="settings-reason" role="status">{t('cliMissing')} <Link href="/settings/agents">{t('openEnvironment')}</Link></p>;
}
