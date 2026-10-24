import { useEffect, useState } from 'react';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { TemplateEntry } from './types.js';
import { TemplateEditor } from './TemplateEditor.js';
export function TemplatesSection({ templateId, creating = false }: { templateId?: string; creating?: boolean }) {
  const { t } = useI18n();
  const { data, error, reload } = useResource<TemplateEntry[]>('list-agent-templates');
  const { navigate } = useRouter();
  const [lastSaved, setLastSaved] = useState<TemplateEntry>();
  const saveFinished = (result: TemplateEntry) => { setLastSaved({ ...result, runningDispatches: result.runningDispatches ?? 0, activeWorks: result.activeWorks ?? 0 }); reload(); };
  const [copy, setCopy] = useState<TemplateEntry>();
  useEffect(() => { if (!creating) setCopy(undefined); }, [creating]);
  const selected = templateId ? data?.find(item => item.id === templateId) ?? (lastSaved?.id === templateId ? lastSaved : undefined) : data?.[0];
  return <div className="settings-templates">
    <div className="settings-template-list">
      <div className="settings-heading"><div><h2>{t('templates')}</h2><p className="muted">{t('templateHelp')}</p></div>
        <Link className="btn sm" href="/settings/new-template">{t('newTemplate')}</Link></div>
      {error && <ErrorNotice error={error} retry={reload} />}
      {!data && !error && <p role="status">{t('loading')}</p>}
      {data?.length === 0 && <p>{t('emptyTemplates')}</p>}
      {(['coordinator', 'executor', null] as const).map(role => {
        const entries = data?.filter(item => item.role === role) ?? [];
        if (!entries.length) return null;
        const title = t(role === 'coordinator' ? 'coordinatorRole' : role === 'executor' ? 'executorTemplates' : 'unrecognizedTemplates');
        return <section key={role ?? 'unknown'} aria-label={title}><h3 className="sect">{title} <span className="count">{entries.length}</span></h3>
          {entries.map(item => <Link key={item.id} href={`/settings/templates/${encodeURIComponent(item.id)}`} className="settings-template-row" aria-current={item.id === selected?.id ? 'page' : undefined}>
            <span className="settings-driver mono">{item.driver?.slice(0, 2) ?? '?'}</span>
            <span><b className="mono">{item.id}</b><span className="settings-meta">{item.driver} · {item.model ?? t('driverDefault')} · {t(item.billing === 'api' ? 'apiBilling' : 'subscription')}</span><span className="settings-meta">{item.description}</span>
              {!item.available && <span className="settings-reason">{item.reason}{item.command && <> <code>{item.command}</code></>}</span>}</span>
            <span className="settings-template-status"><span className={`pill ${item.available ? 'ok' : 'bad'}`}>{t(item.available ? 'available' : 'unavailable')}</span>
              <span>{item.runningDispatches} {t('dispatchCount')} · {item.activeWorks} {t('workCount')}</span></span>
          </Link>)}
        </section>;
      })}
    </div>
    {creating ? <TemplateEditor key="create-template" source={copy} creating onSaved={result => { setCopy(undefined); saveFinished(result); }} />
      : selected ? <TemplateEditor key={`template:${selected.id}`} source={selected} initialSaved={lastSaved?.id === selected.id} onSaved={saveFinished} onDeleted={() => { setLastSaved(undefined); reload(); }} onDuplicate={source => { setCopy(source); navigate('/settings/new-template'); }} />
      : data && templateId && <p>{t('templateMissing')}</p>}
  </div>;
}
