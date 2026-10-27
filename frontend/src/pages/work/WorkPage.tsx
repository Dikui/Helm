import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work, WorkStatus } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link } from '../../shared/router.js';
import { CardGraphView } from './card-graph/CardGraphView.js';
import { BriefView } from './brief/BriefView.js';
import { ConversationView } from './conversation/ConversationView.js';

export function WorkPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <div className="empty-main"><span className="spark" aria-hidden="true">✦</span><h1>{t('choose')}</h1><p>{t('inboxHelp')}</p></div>;
}
const headerRing: Record<WorkStatus, string> = { aligning: 'att', executing: 'run busy', paused: '', 'awaiting-review': 'att', completed: 'ok', cancelled: 'cut' };
function SelectedWork({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  const view = route.view === 'structure' || route.view === 'graph' ? 'structure' : route.view === 'brief' ? 'brief' : 'chat';
  return <>
    <header className="top"><div className="work-title">
      {work && <span className={`spark big ${work.status === 'paused' && work.runtimePauseReason ? 'att' : headerRing[work.status]}`} aria-hidden="true">✦</span>}
      <div>{work && <span className="pill">{t(work.status)}</span>}<h1 title={work?.title}>{work?.title || t('loading')}</h1></div></div>
      {work && work.status !== 'aligning' && <nav className="seg conversation-view-switch" aria-label={t('conversationViews')}>
        {(['chat', 'structure', 'brief'] as const).map(item => <Link key={item} href={`/works/${work.id}/${item}`} aria-current={view === item ? 'page' : undefined}>{t(item)}</Link>)}
      </nav>}
      {work && <WorkActions work={work} reload={reload} />}</header>
    {error && <ErrorNotice error={error} retry={reload} />}
    {work?.status === 'aligning' ? <AligningWork workId={work.id} /> : work && (view === 'chat' ? <ConversationView work={work} />
      : view === 'brief' ? <BriefView work={work} /> : <CardGraphView key={work.id} work={work} />)}
  </>;
}
