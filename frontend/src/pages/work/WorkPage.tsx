import { formatUsage } from '../../shared/token-usage.js';
import { WorkDelivery } from './WorkDelivery.js';
import { useEffect, useState, type ReactNode } from 'react';
import { elapsed, useClock } from '../../shared/clock.js';
import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { GraphNode } from './card-graph/types.js';
import type { Work, WorkSummary } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link, useRouter } from '../../shared/router.js';
import { CardGraphView } from './card-graph/CardGraphView.js';
import { BriefView } from './brief/BriefView.js';
import { ConversationView } from './conversation/ConversationView.js';
import { createPortal } from 'react-dom';
import { Inspector, useInspector } from '../../shared/Inspector.js';
import { WorkReview } from './brief/WorkReview.js';
import { useWorkInspector } from './useWorkInspector.js';
import { NowStrip } from './NowStrip.js';
import { cardStatusLabels } from '../inbox/presentation.js';
import { useWorkReview } from './brief/useWorkReview.js';
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
function SelectedWork({ route }: { route: RouteParams }) {
  const { t, language } = useI18n();
  const now = useClock();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  const summaries = useResource<WorkSummary[]>('list-works');
  const projects = useResource<{ id: string; name: string }[]>('list-projects');
  const summary = summaries.data?.find(item => item.id === route.workId);
  const project = projects.data?.find(item => item.id === work?.projectId);
  const { header } = useInspector();
  const status = work?.delivery?.push?.status === 'failed' ? 'nowPushFailed'
    : work?.delivery?.resolution?.status === 'solving' ? 'deliverySolving'
    : work?.status === 'accepted' && work.delivery?.merge?.status === 'conflict' ? 'deliveryConflict'
    : work?.status === 'accepted' && work.delivery?.merge?.status === 'failed' ? 'deliveryMergeFailed'
    : work?.status === 'completed' ? work.delivery?.completedWithoutMerge ? 'nowWithoutMerge'
    : work.delivery?.push?.status === 'pushed' ? 'nowPushed' : work.delivery?.merge?.status === 'already-contained' ? 'nowContained'
    : work.delivery?.merge?.status === 'merged' ? 'nowMerged' : 'nowReadOnly'
    : work?.status === 'accepted' ? 'nowAwaitingMerge' : work?.status;
  const tone = work?.delivery?.push?.status === 'failed' || work?.delivery?.merge?.status === 'failed' ? 'bad'
    : work?.status === 'executing' || work?.status === 'merging' || work?.delivery?.resolution?.status === 'solving' ? 'run'
    : work?.status === 'completed' ? 'ok' : work && ['awaiting-review', 'accepted', 'merge-queued'].includes(work.status) ? 'att' : '';
  const heading = <header className="top work-header" aria-label={t('workHeader')}>
    <div className="work-title"><div>
      {work && <div className="work-meta"><span className={`work-badge ${tone}`}>{status && t(status)}</span>
        <span>· {project?.name}</span>{work.workBranch && <span className="ref">{work.workBranch}</span>}
        {summary && <time dateTime={summary.statusSince}>· {elapsed(['completed', 'cancelled'].includes(work.status) ? work.createdAt : summary.statusSince, ['completed', 'cancelled'].includes(work.status) ? Date.parse(summary.statusSince) : now)}</time>}
        <span>·</span><span title={work.usage.incomplete ? t('tokenIncomplete') : 'tokens'}>Token {formatUsage(work.usage, language)}</span>
      </div>}
      <h1 title={work?.title}>{work?.title || t('loading')}</h1>
    </div></div>
    {work && <WorkActions work={work} reload={reload} />}
  </header>;
  return <>
    {error && <ErrorNotice error={error} retry={reload} />}
    {work ? <WorkContent work={work} heading={heading} /> : header && createPortal(<p className="hint" role="status">{t('loading')}</p>, header)}
  </>;
}

function WorkContent({ work, heading }: { work: Work; heading: ReactNode }) {
  const { t } = useI18n();
  const { header } = useInspector();
  const [pushing, setPushing] = useState(false);
  const report = useWorkReview(work.id);
  const { inspection, choose, filter, chooseCards } = useWorkInspector(work.id, work.status);
  const graph = useResource<GraphNode[]>('get-card-graph', { workId: work.id });
  const selectedCard = graph.data?.filter(node => node.type === 'card').findIndex(node => inspection === `card:${node.id}`);
  const structure = !['spec', 'report', 'delivery'].includes(inspection);
  const title = selectedCard !== undefined && selectedCard >= 0 ? `${t('graphCard')} ${selectedCard + 1}` : filter ? filter === 'other' ? t('nowInactiveCards') : t('nowFilteredCards').replace('{status}', t(cardStatusLabels[filter]!))
    : t(inspection === 'spec' ? 'brief' : inspection === 'report' ? 'reviewReport' : inspection === 'delivery' ? 'inspectorDelivery' : inspection === 'coord' ? 'alignmentCoordinator' : inspection.startsWith('card:') ? 'graphInspector' : 'structure');
  return <>
    {header && createPortal(<>{heading}<NowStrip work={work} inspection={inspection} filter={filter} choose={choose} chooseCards={chooseCards} pushing={pushing} report={report} /></>, header)}
    {work.status === 'aligning' ? <AligningWork workId={work.id} projectId={work.projectId} workBranch={work.workBranch} showBrief={inspection === 'spec'} inspectorTitle={title} /> : <ConversationView work={work} />}
    {inspection === 'spec' && work.status !== 'aligning' && <Inspector title={title}><BriefView work={work} /></Inspector>}
    {inspection === 'report' && <Inspector title={title}><WorkReview work={work} report={report} /></Inspector>}
    {inspection === 'delivery' && <Inspector title={title}><WorkDelivery work={work} onPushingChange={setPushing} /></Inspector>}
    {structure && <Inspector title={title}><CardGraphView work={work} inspection={inspection} filter={filter} inspect={choose} /></Inspector>}
  </>;
}

function EmptyWork() {
  const { t } = useI18n();
  const works = useResource<WorkSummary[]>('list-works');
  return <div className="empty-main">
    {works.error ? <ErrorNotice error={works.error} retry={works.reload} /> : !works.data ? <p role="status">{t('loading')}</p> : <><h1>{t(works.data.length ? 'choose' : 'emptyTitle')}</h1><p>{t(works.data.length ? 'inboxHelp' : 'emptyHelp')}</p><Link className="btn primary" href="/new">{t('newWork')}</Link></>}
  </div>;
}
