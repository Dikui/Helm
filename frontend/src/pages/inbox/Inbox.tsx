import { useEffect, useRef, useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { HelmEvent, WorkSummary } from '../../shared/types.js';
import { InboxDetails } from './GateActions.js';
import { AgentNotices } from './AgentNotices.js';
import { cardStatusLabels, cardStatusTones, groupLabels, inboxGroup, workSituation } from './presentation.js';
import './inbox.css';

const affectsWorks = (event: HelmEvent) => event.workId !== null;
function WorkRing({ work }: { work: WorkSummary }) {
  const category = inboxGroup(work);
  return <span className={`inbox-ring ${category === 'attention' ? 'att' : category === 'running' ? 'run' : work.status === 'completed' ? 'ok' : 'idle'}`} aria-hidden="true" />;
}
function InboxRow({ work }: { work: WorkSummary }) {
  const { t } = useI18n();
  const { path } = useRouter();
  const [expanded, setExpanded] = useState(false);
  const category = inboxGroup(work);
  const title = work.title || t('untitled');
  const situation = workSituation(work, t);
  const href = `/works/${encodeURIComponent(work.id)}`;
  const current = path === href || path.startsWith(`${href}/`);
  const quick = category === 'attention';
  return <article className="inbox-item" aria-label={title}>
    <div className={`inbox-row${quick ? ' attention' : ''}`}>
      <Link className="inbox-work" href={href} aria-current={current ? 'page' : undefined} aria-label={`${title} · ${situation}`} title={`${title} — ${situation}`}>
        <WorkRing work={work} />
        <span className="inbox-copy"><span className="inbox-title-line"><span className="inbox-title">{title}</span>
          {work.cardStatuses.length > 0 && <span className="inbox-dots" role="img" aria-label={`${t('inboxCardStates')}：${work.cardStatuses.map((status, index) => `${index + 1} ${t(cardStatusLabels[status] || 'graphReady')}`).join(' · ')}`}>
            {work.cardStatuses.map((status, index) => <i key={index} className={cardStatusTones[status]} aria-hidden="true" />)}
          </span>}
        </span><span className="inbox-situation">{situation}</span></span>
      </Link>
      {quick && <button type="button" className="inbox-quick-toggle" aria-expanded={expanded} aria-label={t('inboxQuickDecision').replace('{title}', title)} onClick={() => setExpanded(!expanded)}>{expanded ? '⌃' : '⌄'}</button>}
    </div>
    {quick && expanded && <div className="inbox-quick"><InboxDetails work={work} /></div>}
  </article>;
}
export function Inbox({ folded, drawer, onToggle, searchRequest }: {
  folded: boolean; drawer: boolean; onToggle: () => void; searchRequest: number;
}) {
  const { t, language, setLanguage } = useI18n();
  const { path } = useRouter();
  const { connection } = useData();
  const { data: works, error, reload } = useResource<WorkSummary[]>('list-works', {}, affectsWorks);
  const [search, setSearch] = useState('');
  const [quietOpen, setQuietOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (searchRequest && !folded) input.current?.focus();
  }, [searchRequest, folded]);
  const filtered = works?.filter(work => work.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  if (folded) return <aside className="sb sb-rail" aria-label="Helm">
    <button type="button" className="logo" aria-label={t('shellExpandInbox')} title={`${t('shellExpandInbox')} ([)`} aria-controls="inbox-content" aria-expanded={false} onClick={onToggle}>H</button>
    <Link className="rail-new" href="/new" aria-label={t('newWork')} title={`${t('newWork')} ⌘N`}>＋</Link>
    <div className="rail-works">
      <span className="sr" role="status">{t(connection)}</span>
      {error && <ErrorNotice error={error} retry={reload} />}
      {!works && !error && <span className="sr" role="status">{t('loading')}</span>}
      {(['attention', 'running'] as const).map(category => <section key={category} aria-label={t(groupLabels[category])}>
        <h2>{t(groupLabels[category])}</h2>
        {works?.filter(work => inboxGroup(work) === category).map(work => {
          const href = `/works/${encodeURIComponent(work.id)}`;
          const title = work.title || t('untitled');
          const situation = workSituation(work, t);
          return <Link key={work.id} className="rail-work" href={href}
            aria-current={path === href || path.startsWith(`${href}/`) ? 'page' : undefined}
            aria-label={`${title} · ${situation}`} title={`${title} — ${situation}`}><WorkRing work={work} /></Link>;
        })}
      </section>)}
    </div>
    <div className="rail-footer"><AgentNotices compact /><Link href="/settings" aria-label={t('settings')} title={t('settings')}>⚙</Link></div>
  </aside>;
  return <aside className="sb" aria-label="Helm">
    <div className="sb-head"><Link className="logo" href="/" aria-label="Helm">H</Link><b>Helm</b>
      <button type="button" className="shell-fold" aria-label={t(drawer ? 'shellCloseInbox' : 'shellCollapseInbox')} title={`${t(drawer ? 'shellCloseInbox' : 'shellCollapseInbox')} ([)`} aria-controls="inbox-content" aria-expanded={true} onClick={onToggle}>⇤</button>
      <Link className="btn sm primary" href="/new" aria-label={t('newWork')} title={`${t('newWork')} ⌘N`}>＋ {t('inboxNew')} <kbd>⌘N</kbd></Link></div>
    <div className="search"><input ref={input} type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="clear-search" aria-label={t('clearSearch')} onClick={() => { setSearch(''); input.current?.focus(); }}>×</button>}<kbd>⌘K</kbd></div>
    <span className={connection === 'connected' ? 'sr' : 'inbox-connection'} role="status">{t(connection)}</span>
    <div className="inbox">
      {error && <ErrorNotice error={error} retry={reload} />}
      {!works && !error && <p role="status">{t('loading')}</p>}
      {works?.length === 0 && <p className="empty-inbox"><span>{t('inboxEmpty')}</span><br /><span>{t('inboxEmptyHint')}</span></p>}
      {works && works.length > 0 && filtered?.length === 0 && <p className="hint">{t('noMatches')}</p>}
      {Boolean(filtered?.length) && (['attention', 'running'] as const).map(category => {
        const rows = filtered!.filter(work => inboxGroup(work) === category);
        return <section key={category} aria-label={t(groupLabels[category])}><h2 className={`sect${category === 'attention' ? ' attention' : ''}`}>{t(groupLabels[category])}<span className="count">{rows.length}</span></h2>
          {rows.map(work => <InboxRow key={work.id} work={work} />)}</section>;
      })}
      {Boolean(filtered?.length) && <section aria-label={t('inboxQuiet')}>
        <button type="button" className="sect quiet-toggle" aria-expanded={quietOpen} aria-controls="inbox-quiet" onClick={() => setQuietOpen(!quietOpen)}><span aria-hidden="true">{quietOpen ? '▾' : '▸'}</span>{t('inboxQuiet')}<span className="count">{filtered!.filter(work => inboxGroup(work) === 'quiet').length}</span></button>
        <div id="inbox-quiet" hidden={!quietOpen}>{quietOpen && filtered!.filter(work => inboxGroup(work) === 'quiet').map(work => <InboxRow key={work.id} work={work} />)}</div>
      </section>}
    </div>
    <div className="sb-bottom"><AgentNotices />
      <div className="sb-foot"><div className="seg" role="group" aria-label={t('language')}>
        <button aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>{t('languageZh')}</button><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('languageEn')}</button>
      </div><Link className="btn ghost sm" href="/settings">{t('settings')}</Link></div>
    </div>
  </aside>;
}
