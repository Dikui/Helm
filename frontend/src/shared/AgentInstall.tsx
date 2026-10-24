import { useState } from 'react';
import { useData, useResource } from './data.js';
import { ErrorNotice } from './feedback.js';
import { useI18n } from './i18n.js';
// Checks the selected driver's CLI and offers its official install command when missing.
export function AgentInstall({ driver, onInstalled }: { driver: string; onInstalled?: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const { data, reload } = useResource<{ installed: boolean; install: string | null }>('check-agent', { driver });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const [done, setDone] = useState(false);
  async function install() {
    setPending(true); setError(undefined);
    try { await api.call('install-agent', { driver }); setDone(true); reload(); onInstalled?.(); }
    catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  if (done && data?.installed) return <small className="muted" role="status">{t('installDone')}</small>;
  if (!data || data.installed) return null;
  return <div className="settings-reason" role="group" aria-label={t('missingAgent')}>{t('missingAgent')} <code>{data.install}</code>
    {error && <ErrorNotice error={error} />}
    <button type="button" className="btn sm" disabled={pending} aria-busy={pending} onClick={() => void install()}>{t(pending ? 'installing' : 'install')}</button>
  </div>;
}
