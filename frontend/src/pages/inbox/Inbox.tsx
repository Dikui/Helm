import { formatUsage, totalTokens } from '../../shared/token-usage.js';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { elapsed, useClock } from '../../shared/clock.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { formatTokens, useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { HelmEvent, Settings, WorkSummary } from '../../shared/types.js';
import { InboxDetails } from './GateActions.js';
import { AgentNotices } from './AgentNotices.js';

type Group = 'attention' | 'running' | 'ended';
function group(work: WorkSummary): Group {
  if (['completed', 'cancelled'].includes(work.status)) return 'ended';
  return work.hasPendingGate || ['awaiting-review', 'accepted', 'merge-queued', 'merging'].includes(work.status) || (work.status === 'paused' && work.runtimePauseReason) ? 'attention' : 'running';
}
const affectsWorks = (event: HelmEvent) => event.workId !== null;
const affectsSettings = (event: HelmEvent) => Boolean(event.dispatchId) || event.object.type === 'settings';
function InboxRow({ work, now }: { work: WorkSummary; now: number }) {
  const { t, language } = useI18n();
  const { path } = useRouter();
  const [expanded, setExpanded] = useState(false);
  const category = group(work);
  const tokens = totalTokens(work.usage);
  const tone = category === 'attention' ? 'att' : category === 'ended' ? (work.status === 'completed' ? 'ok' : 'idle') : work.status === 'paused' ? 'idle' : 'run';
  const ring = work.status === 'cancelled' ? 'cut' : tone === 'run' && !work.totalCards ? 'run busy' : tone;
  const progress = tone === 'run' && work.totalCards ? { '--p': `${Math.round(work.completedCards / work.totalCards * 100)}%` } as CSSProperties : undefined;
  // 点行打开工作页，右侧按钮在列表里展开详情
  return <div className={`irow${path.startsWith(`/works/${work.id}`) ? ' current' : ''}${expanded ? ' open' : ''}`}>
    <div className="irow-head"><Link className="irow-main" href={`/works/${encodeURIComponent(work.id)}`}>
      <span className="t"><span className={`spark ${ring}`} style={progress} aria-hidden="true">✦</span><span>{work.title || t('untitled')}</span></span>
      {!(work.status === 'paused' && work.summary === work.runtimePauseReason) && <span className="d">{work.summary}</span>}
      {work.runtimePauseReason && work.status === 'paused' && <span className="pause-reason">{work.runtimePauseReason}</span>}
      <span className="f"><span className={`pill ${tone}`}>
        {tone === 'run' && <span className="spin" aria-hidden="true" />}{t(work.status)}
        <time aria-label={t(category === 'ended' ? 'duration' : 'elapsed')} dateTime={work.statusSince}> · {category === 'ended' ? elapsed(work.createdAt, Date.parse(work.statusSince)) : elapsed(work.statusSince, now)}</time>
      </span><span className="stats"><span title={t('cards')}>▦ {work.completedCards}/{work.totalCards}</span><span title={work.usage.incomplete ? t('tokenIncomplete') : `tokens: ${tokens ?? '—'}`}>Token {formatUsage(work.usage, language)}</span></span></span>
    </Link><button type="button" className="chev" aria-expanded={expanded} aria-label={t('showDetails')} onClick={() => setExpanded(!expanded)}>⌄</button></div>
    {expanded && <div className="more"><InboxDetails work={work} /></div>}
  </div>;
}
export function Inbox({ folded, drawer, onToggle, onSearch, searchRequest }: {
  folded: boolean; drawer: boolean; onToggle: () => void; onSearch: () => void; searchRequest: number;
}) {
  const { t, language, setLanguage } = useI18n();
  const { path } = useRouter();
  const { connection } = useData();
  const { data: works, error, reload } = useResource<WorkSummary[]>('list-works', {}, affectsWorks);
  const settings = useResource<Settings>('get-settings', {}, affectsSettings);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const now = useClock();
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
      {(['attention', 'running'] as const).map(category => <section key={category} aria-label={t(category === 'attention' ? 'shellAttention' : 'shellRunning')}>
        <h2>{t(category === 'attention' ? 'shellAttention' : 'shellRunning')}</h2>
        {works?.filter(work => group(work) === category).map(work => <Link key={work.id} className="rail-work" href={`/works/${encodeURIComponent(work.id)}`}
          aria-current={path === `/works/${work.id}` || path.startsWith(`/works/${work.id}/`) ? 'page' : undefined}
          aria-label={`${work.title || t('untitled')} · ${t(work.status)} · ${work.summary}`} title={`${work.title || t('untitled')} — ${t(work.status)} · ${work.summary}`}>
          <span className={`spark ${category === 'attention' ? 'att' : work.status === 'paused' ? 'idle' : 'run busy'}`} aria-hidden="true" />
        </Link>)}
      </section>)}
    </div>
    <div className="rail-footer"><AgentNotices compact /><button type="button" className="shell-fold" aria-label={t('search')} title={`${t('search')} ⌘K`} onClick={onSearch}>⌕</button><Link href="/settings" aria-label={t('settings')} title={t('settings')}>⚙</Link></div>
  </aside>;
  return <aside className="sb" aria-label="Helm">
    <div className="sb-head"><Link className="logo" href="/" aria-label="Helm">H</Link><b>Helm</b>
      <button type="button" className="shell-fold" aria-label={t(drawer ? 'shellCloseInbox' : 'shellCollapseInbox')} title={`${t(drawer ? 'shellCloseInbox' : 'shellCollapseInbox')} ([)`} aria-controls="inbox-content" aria-expanded={true} onClick={onToggle}>⇤</button>
      <Link className="btn sm primary" href="/new">＋ {t('newWork')} <kbd>⌘N</kbd></Link></div>
    <div className="search"><input ref={input} type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="clear-search" aria-label={t('clearSearch')} onClick={() => { setSearch(''); input.current?.focus(); }}>×</button>}<kbd>⌘K</kbd></div>
    <div className="connection" role="status">{t(connection)}</div>
    <div className="inbox">
      <AgentNotices />
      {error && <ErrorNotice error={error} retry={reload} />}
      {!works && !error && <p role="status">{t('loading')}</p>}
      {works && works.length === 0 && <p className="hint">{t('empty')}</p>}
      {works && works.length > 0 && filtered?.length === 0 && <p className="hint">{t('noMatches')}</p>}
      {(['attention', 'running', 'ended'] as const).map(category => {
        const rows = filtered?.filter(work => group(work) === category) ?? [];
        return <section key={category} aria-label={t(category)}><h2 className="sect">{t(category)}<span className="count">{rows.length}</span></h2>
          {rows.map(work => <InboxRow key={work.id} work={work} now={now} />)}</section>;
      })}
    </div>
    <div className="usage">
      {settings.error && <ErrorNotice error={settings.error} retry={settings.reload} />}
      <div className="row"><span className="muted">{t('executors')}</span><b className="num"><span aria-label={t('concurrency')}>{settings.data ? `${settings.data.runningDispatches} / ${settings.data.concurrencyLimit}` : '—'}</span> <span className="muted">· {t('queued')} {settings.data?.queuedDispatches ?? '—'}</span></b></div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${settings.data ? Math.min(100, settings.data.runningDispatches / settings.data.concurrencyLimit * 100) : 0}%` }} /></div>
    </div>
    <div className="sb-foot"><div className="seg" role="group" aria-label={t('language')}>
      <button aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>{t('languageZh')}</button><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('languageEn')}</button>
    </div><Link className="btn ghost sm" href="/settings">{t('settings')}</Link></div>
  </aside>;
}
