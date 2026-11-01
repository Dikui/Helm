import { formatUsage } from '../../shared/token-usage.js';
import { WorkDelivery } from './WorkDelivery.js';
import { useEffect, type CSSProperties } from 'react';
import { elapsed, useClock } from '../../shared/clock.js';
import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work, WorkStatus, WorkSummary } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link, useRouter } from '../../shared/router.js';
import { CardGraphView } from './card-graph/CardGraphView.js';
import { BriefView } from './brief/BriefView.js';
import { ConversationView } from './conversation/ConversationView.js';
import { Inspector } from '../../shared/Inspector.js';
import { WorkReview } from './brief/WorkReview.js';
import { useWorkInspector } from './useWorkInspector.js';
import './work-inspector.css';

export function WorkPage({ route }: { route: RouteParams }) {
  const { navigate, search } = useRouter();
  useEffect(() => {
    if (!route.workId || !route.view) return;
    const params = new URLSearchParams(search);
    const legacy: Record<string, string | undefined> = { structure: 'graph', graph: 'graph', brief: 'spec', chat: undefined };
    if (!params.has('inspect') && legacy[route.view]) params.set('inspect', legacy[route.view]!);
    navigate(`/works/${encodeURIComponent(route.workId)}${params.size ? `?${params}` : ''}`, true);
  }, [route.workId, route.view]);
  if (route.view) return null;
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <EmptyWork />;
}
const headerRing: Record<WorkStatus, string> = { aligning: 'att', executing: 'run busy', paused: '', 'awaiting-review': 'att', completed: 'ok', cancelled: 'cut', accepted: 'att', 'merge-queued': 'att', merging: 'run busy' };
function SelectedWork({ route }: { route: RouteParams }) {
  const { t, language } = useI18n();
  const now = useClock();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  const summaries = useResource<WorkSummary[]>('list-works');
  const projects = useResource<{ id: string; name: string }[]>('list-projects');
  const summary = summaries.data?.find(item => item.id === route.workId);
  const project = projects.data?.find(item => item.id === work?.projectId);
  const tone = work?.status === 'executing' ? 'run' : work?.status === 'completed' ? 'ok' : work?.status === 'aligning' || work?.status === 'awaiting-review' || work?.runtimePauseReason ? 'att' : '';
  const progress = summary?.totalCards ? { '--p': `${Math.round(summary.completedCards / summary.totalCards * 100)}%` } as CSSProperties : undefined;
  return <>
    <header className="top"><div className="work-title">
      {work && <span className={`spark big ${work.status === 'paused' && work.runtimePauseReason ? 'att' : work.status === 'executing' && summary?.totalCards ? 'run' : headerRing[work.status]}`} style={progress} aria-hidden="true">✦</span>}
      <div>{work && <small>{project?.name}<span className={`pill ${tone}`}>{t(work.status)}{summary && <time dateTime={summary.statusSince}> · {elapsed(['completed', 'cancelled'].includes(work.status) ? work.createdAt : summary.statusSince, ['completed', 'cancelled'].includes(work.status) ? Date.parse(summary.statusSince) : now)}</time>}</span></small>}<h1 title={work?.title}>{work?.title || t('loading')}</h1></div></div>
      {work && <div className="stats work-stats">{work.status !== 'aligning' && <span className="stat" title={t('cards')}>▦ {summary ? `${summary.completedCards}/${summary.totalCards}` : '—'}</span>}<span className="stat" title={work.usage.incomplete ? t('tokenIncomplete') : 'tokens'}>Token {formatUsage(work.usage, language)}</span></div>}
      {work && <WorkActions work={work} reload={reload} />}</header>
    {error && <ErrorNotice error={error} retry={reload} />}
    {work && <WorkContent work={work} />}
  </>;
}

function WorkContent({ work }: { work: Work }) {
  const { t } = useI18n();
  const { inspection, choose } = useWorkInspector(work.id, work.status);
  const structure = !['spec', 'report', 'delivery'].includes(inspection);
  const title = t(inspection === 'spec' ? 'brief' : inspection === 'report' ? 'reviewReport' : inspection === 'delivery' ? 'inspectorDelivery' : inspection === 'coord' ? 'alignmentCoordinator' : inspection.startsWith('card:') ? 'graphInspector' : 'structure');
  return <>
    <nav className="work-inspect-links" aria-label={t('shellInspector')}>
      {(['spec', 'list', 'report', 'delivery'] as const).map(value => <button type="button" key={value} aria-pressed={value === 'list' ? structure : inspection === value} onClick={() => choose(value)}>{t(value === 'spec' ? 'brief' : value === 'list' ? 'structure' : value === 'report' ? 'reviewReport' : 'inspectorDelivery')}</button>)}
    </nav>
    {work.status === 'aligning' ? <AligningWork workId={work.id} projectId={work.projectId} workBranch={work.workBranch} showBrief={inspection === 'spec'} inspectorTitle={title} /> : <ConversationView work={work} />}
    {inspection === 'spec' && work.status !== 'aligning' && <Inspector title={title}><BriefView work={work} /></Inspector>}
    {inspection === 'report' && <Inspector title={title}><WorkReview work={work} /></Inspector>}
    {inspection === 'delivery' && <Inspector title={title}><WorkDelivery work={work} /></Inspector>}
    {structure && <Inspector title={title}><CardGraphView work={work} inspection={inspection} inspect={choose} /></Inspector>}
  </>;
}

function EmptyWork() {
  const { t } = useI18n();
  const works = useResource<WorkSummary[]>('list-works');
  return <div className="empty-main">
    {works.error ? <ErrorNotice error={works.error} retry={works.reload} /> : !works.data ? <p role="status">{t('loading')}</p> : <><h1>{t(works.data.length ? 'choose' : 'emptyTitle')}</h1><p>{t(works.data.length ? 'inboxHelp' : 'emptyHelp')}</p><Link className="btn primary" href="/new">{t('newWork')}</Link></>}
  </div>;
}
