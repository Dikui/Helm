import { useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { Link } from '../../../shared/router.js';
import type { HelmEvent, Work } from '../../../shared/types.js';
import type { WorkDescription } from '../aligning/types.js';
import { WorkReview } from './WorkReview.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import './brief.css';

export function BriefView({ work }: { work: Work & { workBranch?: string | null } }) {
  const { t, language } = useI18n();
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId: work.id });
  const files = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  const events = useResource<HelmEvent[]>('get-events', { workId: work.id });
  const [version, setVersion] = useState<number>();
  const versions = descriptions.data ?? [];
  const active = versions.find(item => item.status === 'active');
  const shown = version === undefined ? active : versions.find(item => item.version === version);
  const confirmed = events.data?.find(event => event.action === 'gate-decided' && (event.details as { descriptionId?: string })?.descriptionId === shown?.id);
  return <div className="page-body brief-view">
    <WorkReview work={work} />
    <section className="brief-document" aria-label={t('brief')}>
      <header className="row"><h2>{t('brief')}</h2>{shown && <>
        <span className={`pill ${shown.status === 'active' ? 'ok' : ''}`}><span>{t(shown.status === 'active' ? 'briefActive' : shown.status === 'draft' ? 'alignmentUnconfirmed' : 'briefHistorical')}</span>{confirmed && <> · <time dateTime={confirmed.time}>{new Date(confirmed.time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' })}</time></>}</span>
        <label><span className="sr">{t('alignmentVersion')}</span><select value={shown.version} onChange={event => setVersion(Number(event.target.value))}>
          {[...versions].reverse().map(item => <option key={item.id} value={item.version}>v{item.version}{item.status === 'active' ? ` · ${t('briefActive')}` : item.status === 'draft' ? ` · ${t('alignmentUnconfirmed')}` : ''}</option>)}
        </select></label>
      </>}</header>
      {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
      {descriptions.error && <ErrorNotice error={descriptions.error} retry={descriptions.reload} />}
      {!descriptions.data && !descriptions.error && <p role="status">{t('loading')}</p>}
      {descriptions.data && !shown && <p>{t('briefNoActive')}</p>}
      {shown && <>
        {(['requirements', 'boundary', 'criteria'] as const).map(field => <section key={field}><h3>{t(field)}</h3><Markdown text={shown[field]} workId={work.id} files={files} onOpen={preview.open} /></section>)}
        {preview.preview}
        {shown.baseCommit ? <dl className="brief-base"><dt>{t('newWorkBase')}</dt><dd><span className="ref">{shown.baseRef}</span> <span className="ref" title={shown.baseCommit}>{shown.baseCommit.slice(0, 7)}</span></dd>
          <dt>{t('briefWorkBranch')}</dt><dd><span className="ref">{work.workBranch || '—'}</span></dd></dl> : <p className="muted">{t('projectWithoutGitHint')}</p>}
      </>}
      <p className="muted">{t('briefChangeHint')}</p>
      <Link href={`/works/${encodeURIComponent(work.id)}`}>{t('briefChangeInChat')}</Link>
    </section>
  </div>;
}
