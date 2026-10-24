import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work } from '../../shared/types.js';
import { AligningWork } from './aligning/AligningWork.js';
import { Link } from '../../shared/router.js';
import { ConversationView } from './conversation/ConversationView.js';

export function WorkPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <div className="empty-main"><span className="spark" aria-hidden="true">✦</span><h1>{t('choose')}</h1><p>{t('inboxHelp')}</p></div>;
}
function SelectedWork({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  const view = route.view === 'structure' || route.view === 'brief' ? route.view : 'chat';
  return <>
    <header className="top"><span className="muted">{t('work')} /</span><h1>{work?.title || t('loading')}</h1>{work && <span className="pill">{t(work.status)}</span>}
      {work && work.status !== 'aligning' && <nav className="seg conversation-view-switch" aria-label={t('conversationViews')}>
        {(['chat', 'structure', 'brief'] as const).map(item => <Link key={item} href={`/works/${work.id}/${item}`} aria-current={view === item ? 'page' : undefined}>{t(item)}</Link>)}
      </nav>}
      {work && <WorkActions work={work} reload={reload} />}</header>
    {error && <ErrorNotice error={error} retry={reload} />}
    {work?.status === 'aligning' ? <AligningWork workId={work.id} /> : work && (view === 'chat'
      ? <ConversationView work={work} />
      : <div className="page-body"><h2>{t(view)}</h2><p className="muted">{t('pagePending')}</p></div>)}
  </>;
}
