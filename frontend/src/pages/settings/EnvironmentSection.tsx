import { useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n, type MessageKey } from '../../shared/i18n.js';

interface Tool { name: string; executable: string; installed: boolean; version: string | null; install: string; login: string | null }
const labels: Record<string, string | MessageKey> = { 'claude-sdk': 'Claude Code', codex: 'Codex', grok: 'Grok', deepseek: 'DeepSeek (dsh)', browser: 'toolBrowser' };

export function EnvironmentSection() {
  const { t } = useI18n();
  const { data, error, reload } = useResource<Tool[]>('check-environment');
  return <section className="settings-simple" aria-label={t('environment')}>
    <div className="settings-heading"><div><h2>{t('environment')}</h2><p className="muted">{t('environmentHelp')}</p></div>
      <button type="button" className="btn sm" onClick={reload}>{t('recheck')}</button></div>
    {error && <ErrorNotice error={error} retry={reload} />}{!data && !error && <p role="status">{t('loading')}</p>}
    {data?.map(tool => <ToolRow key={tool.name} tool={tool} onInstalled={reload} />)}
  </section>;
}

function ToolRow({ tool, onInstalled }: { tool: Tool; onInstalled: () => void }) {
  const { t } = useI18n();
  const { api } = useData();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error>();
  const label = labels[tool.name] ?? tool.name;
  const name = label === 'toolBrowser' ? t('toolBrowser') : label;
  async function install() {
    setPending(true); setError(undefined);
    try { await api.call('install-tool', { name: tool.name }); onInstalled(); }
    catch (failure) { setError(failure as Error); }
    finally { setPending(false); }
  }
  return <div className="settings-box" role="group" aria-label={name}>
    <div className="settings-tool-head"><strong>{name}</strong>
      <span className={tool.installed ? 'settings-ok' : 'settings-reason'}>{tool.installed ? [t('toolInstalled'), tool.version].filter(Boolean).join(' · ') : t('toolMissing')}</span></div>
    {!tool.installed && <><p className="muted">{t('installRuns')} <code>{tool.install}</code></p>{error && <ErrorNotice error={error} />}
      <div><button type="button" className="btn sm" disabled={pending} aria-busy={pending} onClick={() => void install()}>{t(pending ? 'installing' : 'install')}</button></div></>}
    {tool.login && <p className="muted">{t('loginHint')} <code>{tool.login}</code></p>}
  </div>;
}
