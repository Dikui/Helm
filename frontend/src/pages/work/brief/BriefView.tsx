import { useCallback, useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { Link } from '../../../shared/router.js';
import type { HelmEvent, Work } from '../../../shared/types.js';
import type { WorkDescription } from '../aligning/types.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import './brief.css';

export function BriefView({ work }: { work: Work & { workBranch?: string | null } }) {
  const { t, language } = useI18n();
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId: work.id });
  const files = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  const decidedAffects = useCallback((event: HelmEvent) => event.workId === work.id && event.action === 'gate-decided', [work.id]);
  const events = useResource<HelmEvent[]>('get-events', { workId: work.id, actions: ['gate-decided'] }, decidedAffects);
  const [version, setVersion] = useState<number>();
  const versions = descriptions.data ?? [];
  const shown = version === undefined ? versions.at(-1) : versions.find(item => item.version === version);
  const confirmed = events.data?.find(event => event.action === 'gate-decided' && (event.details as { descriptionId?: string })?.descriptionId === shown?.id);
  return <div className="page-body brief-view">
    <section className="brief-document" aria-label={t('brief')}>
      <header>{shown && <>
        <span className="muted">{t('brief')} · v{shown.version} · <span>{t(shown.status === 'active' ? 'briefConfirmed' : shown.status === 'draft' ? 'alignmentUnconfirmed' : 'briefHistorical')}</span>{confirmed && <> <time dateTime={confirmed.time}>{new Date(confirmed.time).toLocaleString(language === 'zh' ? 'zh-CN' : 'en', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</time></>}</span>
        <label><span className="sr">{t('alignmentVersion')}</span><select value={shown.version} onChange={event => setVersion(Number(event.target.value))}>
          {[...versions].reverse().map(item => <option key={item.id} value={item.version}>v{item.version} · {t(item.status === 'active' ? 'briefConfirmed' : item.status === 'draft' ? 'alignmentUnconfirmed' : 'alignmentHistory')}</option>)}
        </select></label>
      </>}</header>
      {shown && <h2>{work.title}</h2>}
      {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
      {descriptions.error && <ErrorNotice error={descriptions.error} retry={descriptions.reload} />}
      {!descriptions.data && !descriptions.error && <p role="status">{t('loading')}</p>}
      {descriptions.data && !shown && <p>{t('briefNoActive')}</p>}
      {shown && <>
        {(['requirements', 'boundary', 'criteria', 'deliverables'] as const).map(field => <section key={field}><h3>{t(field)}</h3><ul>{shown[field].split(/\r?\n/).filter(line => line.trim()).map((line, index) => <li key={index}><Markdown inline text={line.replace(/^\s*[-*+]\s+|^\s*\d+[.)]\s+/, '')} workId={work.id} files={files} onOpen={preview.open} /></li>)}</ul></section>)}
        {preview.preview}
        {shown.baseCommit ? <div className="brief-branches" aria-label={t('deliveryBranchFlow')}><span className="ref">{shown.baseRef}</span><span className="ref" title={shown.baseCommit}>{shown.baseCommit.slice(0, 7)}</span><span aria-hidden="true">→</span><span className="ref">{work.workBranch || '—'}</span></div> : <p className="muted">{t('projectWithoutGitHint')}</p>}
      </>}
      <p className="muted">{t('briefChangeHint')}</p>
      <Link href={`/works/${encodeURIComponent(work.id)}`}>{t('briefChangeInChat')}</Link>
    </section>
  </div>;
}
