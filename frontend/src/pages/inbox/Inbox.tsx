import { useEffect, useRef, useState } from 'react';
import { useData, useResource } from '../../shared/data.js';
import { elapsed, useClock } from '../../shared/clock.js';
import { ErrorNotice } from '../../shared/feedback.js';
import { formatTokens, useI18n } from '../../shared/i18n.js';
import { Link, useRouter } from '../../shared/router.js';
import type { HelmEvent, Settings, WorkSummary } from '../../shared/types.js';
import { InboxDetails } from './GateActions.js';

type Group = 'attention' | 'running' | 'ended';
function group(work: WorkSummary): Group {
  if (['completed', 'cancelled'].includes(work.status)) return 'ended';
  return work.hasPendingGate || work.status === 'awaiting-review' || (work.status === 'paused' && work.runtimePauseReason) ? 'attention' : 'running';
}
const affectsWorks = (event: HelmEvent) => event.workId !== null;
const affectsSettings = (event: HelmEvent) => Boolean(event.dispatchId) || event.object.type === 'settings';
function InboxRow({ work, now }: { work: WorkSummary; now: number }) {
  const { t, language } = useI18n();
  const { path } = useRouter();
  const [expanded, setExpanded] = useState(false);
  const category = group(work);
  const tokens = work.usage.inputTokens + work.usage.outputTokens;
  const tone = category === 'attention' ? 'att' : category === 'ended' ? (work.status === 'completed' ? 'ok' : 'idle') : work.status === 'paused' ? 'idle' : 'run';
  return <details className={`irow${path.startsWith(`/works/${work.id}`) ? ' current' : ''}`} onToggle={e => setExpanded(e.currentTarget.open)}>
    <summary>
      <span className="t"><span className={`spark ${tone}`} aria-hidden="true">✦</span><span>{work.title || t('untitled')}</span><span className="chev" aria-hidden="true">⌄</span></span>
      {!(work.status === 'paused' && work.summary === work.runtimePauseReason) && <span className="d">{work.summary}</span>}
      {work.runtimePauseReason && work.status === 'paused' && <span className="pause-reason">{work.runtimePauseReason}</span>}
      <span className="f"><span className={`pill ${tone}`}>
        {tone === 'run' && <span className="spin" aria-hidden="true" />}{t(work.status)}
        <time aria-label={t(category === 'ended' ? 'duration' : 'elapsed')} dateTime={work.statusSince}> · {category === 'ended' ? elapsed(work.createdAt, Date.parse(work.statusSince)) : elapsed(work.statusSince, now)}</time>
      </span><span className="stats"><span title={t('cards')}>▦ {work.completedCards}/{work.totalCards}</span><span title={`tokens: ${tokens}`}>◇ {formatTokens(tokens, language)}</span></span></span>
    </summary>
    {expanded && <div className="more"><InboxDetails work={work} /><Link className="btn sm" href={`/works/${encodeURIComponent(work.id)}`}>{t('open')}</Link></div>}
  </details>;
}
export function Inbox() {
  const { t, language, setLanguage } = useI18n();
  const { connection } = useData();
  const { data: works, error, reload } = useResource<WorkSummary[]>('list-works', {}, affectsWorks);
  const settings = useResource<Settings>('get-settings', {}, affectsSettings);
  const [search, setSearch] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const now = useClock();
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); input.current?.focus(); } };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const filtered = works?.filter(work => work.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <aside className="sb" aria-label="Helm">
    <div className="sb-head"><Link className="logo" href="/">H</Link><b>Helm</b><Link className="btn sm primary" href="/new">＋ {t('newWork')}</Link></div>
    <div className="search"><input ref={input} type="search" aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)} />{search && <button className="clear-search" aria-label={t('clearSearch')} onClick={() => { setSearch(''); input.current?.focus(); }}>×</button>}<kbd>⌘K</kbd></div>
    <div className="connection" role="status">{t(connection)}</div>
    <div className="inbox">
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
      <div className="row"><span>{t('executors')}</span><b className="num" aria-label={t('concurrency')}>{settings.data ? `${settings.data.runningDispatches} / ${settings.data.concurrencyLimit}` : '—'}</b>
        <span>{t('queued')} {settings.data?.queuedDispatches ?? '—'}</span></div>
      <div className="bar" aria-hidden="true"><i style={{ width: `${settings.data ? Math.min(100, settings.data.runningDispatches / settings.data.concurrencyLimit * 100) : 0}%` }} /></div>
    </div>
    <div className="sb-foot"><div className="seg" role="group" aria-label="语言 / Language">
      <button aria-pressed={language === 'zh'} onClick={() => setLanguage('zh')}>中文</button><button aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>EN</button>
    </div><Link className="btn sm" href="/settings">{t('settings')}</Link></div>
  </aside>;
}
