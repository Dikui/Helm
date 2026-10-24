import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link } from '../../shared/router.js';
import { CardGraphView } from './card-graph/CardGraphView.js';
import { BriefView } from './brief/BriefView.js';

export function WorkPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <div className="empty-main"><span className="spark" aria-hidden="true">✦</span><h1>{t('choose')}</h1><p>{t('inboxHelp')}</p></div>;
}
function SelectedWork({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  const showGraph = work?.status !== 'aligning' && (route.view === 'structure' || route.view === 'graph' || !route.view);
  return <>
    <header className="top"><span className="muted">{t('work')} /</span><h1>{work?.title || t('loading')}</h1>{work && <span className="pill">{t(work.status)}</span>}{work && <WorkActions work={work} reload={reload} />}</header>
    {error && <ErrorNotice error={error} retry={reload} />}
    {work && work.status !== 'aligning' && <nav className="cg-work-nav" aria-label={t('work')}>
      <Link href={`/works/${work.id}/chat`} aria-current={route.view === 'chat' ? 'page' : undefined}>{t('chat')}</Link>
      <Link href={`/works/${work.id}/structure`} aria-current={showGraph ? 'page' : undefined}>{t('structure')}</Link>
      <Link href={`/works/${work.id}/brief`} aria-current={route.view === 'brief' ? 'page' : undefined}>{t('brief')}</Link>
    </nav>}
    {work?.status === 'aligning' ? <AligningWork workId={work.id} /> : work && route.view === 'brief' ? <BriefView work={work} /> : work && showGraph ? <CardGraphView key={work.id} workId={work.id} /> : <div className="page-body">
      {work && <><h2>{t('overview')}</h2><p className="muted">{t('pagePending')}</p></>}
    </div>}
  </>;
}
