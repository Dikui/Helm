import { WorkActions } from './WorkActions.js';
import { useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import type { RouteParams } from '../../shared/router.js';
import type { Work } from '../../shared/types.js';

export function WorkPage({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  return route.workId ? <SelectedWork key={route.workId} route={route} /> : <div className="empty-main"><span className="spark" aria-hidden="true">✦</span><h1>{t('choose')}</h1><p>{t('inboxHelp')}</p></div>;
}
function SelectedWork({ route }: { route: RouteParams }) {
  const { t } = useI18n();
  const { data: work, error, reload } = useResource<Work>('get-work', { workId: route.workId });
  return <>
    <header className="top"><span className="muted">{t('work')} /</span><h1>{work?.title || t('loading')}</h1>{work && <span className="pill">{t(work.status)}</span>}{work && <WorkActions work={work} reload={reload} />}</header>
    <div className="page-body">{error && <ErrorNotice error={error} retry={reload} />}
      {work && <><h2>{t('overview')}</h2><p className="muted">{t('pagePending')}</p></>}
    </div>
  </>;
}
