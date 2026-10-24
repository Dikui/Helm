import { useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { Link } from '../../../shared/router.js';
import type { Work } from '../../../shared/types.js';
import type { WorkDescription } from '../aligning/types.js';
import { WorkReview } from './WorkReview.js';
import './brief.css';

export function BriefView({ work }: { work: Work & { workBranch?: string | null } }) {
  const { t } = useI18n();
  const descriptions = useResource<WorkDescription[]>('get-work-descriptions', { workId: work.id });
  const [version, setVersion] = useState<number>();
  const versions = descriptions.data ?? [];
  const active = versions.find(item => item.status === 'active');
  const shown = version === undefined ? active : versions.find(item => item.version === version);
  return <div className="page-body brief-view">
    <WorkReview workId={work.id} />
    <section className="brief-document" aria-label={t('brief')}>
      <header className="row"><h2>{t('brief')}</h2>{shown && <>
        <span className={`pill ${shown.status === 'active' ? 'ok' : ''}`}>{t(shown.status === 'active' ? 'briefActive' : shown.status === 'draft' ? 'alignmentUnconfirmed' : 'briefHistorical')}</span>
        <label>{t('alignmentVersion')}<select value={shown.version} onChange={event => setVersion(Number(event.target.value))}>
          {[...versions].reverse().map(item => <option key={item.id} value={item.version}>v{item.version}{item.status === 'active' ? ` · ${t('briefActive')}` : item.status === 'draft' ? ` · ${t('alignmentUnconfirmed')}` : ''}</option>)}
        </select></label>
      </>}</header>
      {descriptions.error && <ErrorNotice error={descriptions.error} retry={descriptions.reload} />}
      {!descriptions.data && !descriptions.error && <p role="status">{t('loading')}</p>}
      {descriptions.data && !shown && <p>{t('briefNoActive')}</p>}
      {shown && <>
        {(['requirements', 'boundary', 'criteria'] as const).map(field => <section key={field}><h3>{t(field)}</h3><p className="agent-text">{shown[field]}</p></section>)}
        <dl className="brief-base"><dt>{t('newWorkBase')}</dt><dd className="mono">{shown.baseRef} <span title={shown.baseCommit}>{shown.baseCommit}</span></dd>
          <dt>{t('briefWorkBranch')}</dt><dd className="mono">{work.workBranch || '—'}</dd></dl>
      </>}
      <p className="muted">{t('briefChangeHint')}</p>
      <Link href={`/works/${encodeURIComponent(work.id)}`}>{t('briefChangeInChat')}</Link>
    </section>
  </div>;
}
