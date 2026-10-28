import { totalTokens } from '../../shared/token-usage.js';
import { WorkDelivery } from './WorkDelivery.js';
import type { CSSProperties } from 'react';
import { elapsed, useClock } from '../../shared/clock.js';
import { formatTokens } from '../../shared/i18n.js';
import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work, WorkStatus, WorkSummary } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link } from '../../shared/router.js';
import { CardGraphView } from './card-graph/CardGraphView.js';
import { BriefView } from './brief/BriefView.js';
import { ConversationView } from './conversation/ConversationView.js';

export function WorkPage({ route }: { route: RouteParams }) {
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <EmptyWork />;
}
const headerRing: Record<WorkStatus, string> = { aligning: 'att', executing: 'run busy', paused: '', 'awaiting-review': 'att', completed: 'ok', cancelled: 'cut', accepted: 'att', 'merge-queued': 'att', merging: 'run busy', merged: 'ok', pushing: 'run busy' };
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
  const view = route.view === 'structure' || route.view === 'graph' ? 'structure' : route.view === 'brief' ? 'brief' : 'chat';
  return <>
    <header className="top"><div className="work-title">
      {work && <span className={`spark big ${work.status === 'paused' && work.runtimePauseReason ? 'att' : work.status === 'executing' && summary?.totalCards ? 'run' : headerRing[work.status]}`} style={progress} aria-hidden="true">✦</span>}
      <div>{work && <small>{project?.name}<span className={`pill ${tone}`}>{t(work.status)}{summary && <time dateTime={summary.statusSince}> · {elapsed(['completed', 'cancelled'].includes(work.status) ? work.createdAt : summary.statusSince, ['completed', 'cancelled'].includes(work.status) ? Date.parse(summary.statusSince) : now)}</time>}</span></small>}<h1 title={work?.title}>{work?.title || t('loading')}</h1></div></div>
      {work && work.status !== 'aligning' && <nav className="seg conversation-view-switch" aria-label={t('conversationViews')}>
        {(['chat', 'structure', 'brief'] as const).map(item => <Link key={item} href={`/works/${work.id}/${item}`} aria-current={view === item ? 'page' : undefined}>{t(item)}{item === 'structure' && summary && <span className="count" aria-hidden="true">{summary.totalCards}</span>}</Link>)}
      </nav>}
      {work && <div className="stats work-stats">{work.status !== 'aligning' && <span className="stat" title={t('cards')}>▦ {summary ? `${summary.completedCards}/${summary.totalCards}` : '—'}</span>}<span className="stat" title="tokens">Token {formatTokens(totalTokens(work.usage), language)}</span></div>}
      {work && <WorkActions work={work} reload={reload} />}</header>
    {work && view !== 'brief' && <WorkDelivery work={work} />}
    {error && <ErrorNotice error={error} retry={reload} />}
    {work?.status === 'aligning' ? <AligningWork workId={work.id} projectId={work.projectId} workBranch={work.workBranch} /> : work && (view === 'chat' ? <ConversationView work={work} />
      : view === 'brief' ? <BriefView work={work} /> : <CardGraphView key={work.id} work={work} />)}
  </>;
}

function EmptyWork() {
  const { t } = useI18n();
  const works = useResource<WorkSummary[]>('list-works');
  return <div className="empty-main"><span className="spark" aria-hidden="true">✦</span>
    {works.error ? <ErrorNotice error={works.error} retry={works.reload} /> : !works.data ? <p role="status">{t('loading')}</p> : <><h1>{t(works.data.length ? 'choose' : 'emptyTitle')}</h1><p>{t(works.data.length ? 'inboxHelp' : 'emptyHelp')}</p><Link className="btn primary" href="/new">{t('newWork')}</Link></>}
  </div>;
}
