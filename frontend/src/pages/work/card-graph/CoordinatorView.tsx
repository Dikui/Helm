import { useCallback, useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { formatTokens, useI18n } from '../../../shared/i18n.js';
import type { HelmEvent, Work } from '../../../shared/types.js';
import type { Rounds } from '../conversation/types.js';
import { OutputSteps } from './DispatchDetails.js';
import { endLabels } from './labels.js';
import type { Dispatch } from './types.js';

interface Notes { body: string; version: number; versions: { body: string; version: number; time: string }[] }

export function CoordinatorView({ work }: { work: Work }) {
  const { t, language } = useI18n();
  const now = useClock();
  const rounds = useResource<Rounds>('list-rounds', { workId: work.id });
  const notes = useResource<Notes>('get-coordinator-notes', { workId: work.id });
  const [roundId, selectRound] = useState<string | null>(null);
  const [version, selectVersion] = useState<number | null>(null);
  const current = rounds.data?.rounds.find(round => round.status === 'running');
  const selected = rounds.data?.rounds.find(round => round.id === roundId) ?? rounds.data?.rounds.at(-1);
  const note = notes.data?.versions.find(note => note.version === version) ?? notes.data;
  const paused = work.status === 'paused' && work.runtimePauseReason === '调度者连续失败 3 次';
  const affects = useCallback((event: HelmEvent) => event.workId === work.id &&
    (event.object.id === selected?.id || event.action === 'outputs-deleted'), [work.id, selected?.id]);
  const date = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
  return <div className="cs-coordinator">
    <div className="row"><h2>{t('structureCoordinator')}</h2>{rounds.data && <span className={`pill ${current ? 'run' : paused ? 'bad' : ''}`} role="status">{current ? t('structureRunning') : paused ? t('structureFailurePause') : t('conversationIdle')}</span>}</div>
    {work.runtimePauseReason && <p className="pause-reason">{work.runtimePauseReason}</p>}
    {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
    {!rounds.data ? <p role="status">{rounds.error ? '' : t('loading')}</p> : <>
      <h3>{t('structureRounds')} <span className="count">{rounds.data.rounds.length}</span></h3>
      {!rounds.data.rounds.length ? <p className="muted">{t('structureNoRounds')}</p> : <ol className="cs-rounds">
        {rounds.data.rounds.slice().reverse().map(round => <li key={round.id}>
          <button className="btn sm" aria-pressed={selected?.id === round.id} aria-label={`${t('structureRound')} #${round.number}`} onClick={() => selectRound(round.id)}>#{round.number}</button>
          <span>{round.agentId}</span><span className={`pill ${round.status === 'running' ? 'run' : ''}`}>{round.status === 'running' ? t('structureRunning') : round.reason ? t(endLabels[round.reason as NonNullable<Dispatch['endReason']>]) : '—'}</span>
          <time className="mono">{elapsed(round.startedAt, round.endedAt ? Date.parse(round.endedAt) : now)}</time>
          <small className="muted"><time dateTime={round.startedAt}>{date(round.startedAt)}</time> → {round.endedAt ? <time dateTime={round.endedAt}>{date(round.endedAt)}</time> : t('structureNow')}</small>
        </li>)}
      </ol>}
      {selected && <section className="cs-round-detail" aria-label={`${t('structureRound')} #${selected.number}`}>
        <h3>{t('structureRound')} #{selected.number}</h3>
        <dl className="cg-kv"><dt>{t('structureTokens')}</dt><dd className="mono" title={`${selected.usage.inputTokens} / ${selected.usage.outputTokens}`}>{formatTokens(selected.usage.inputTokens, language)} / {formatTokens(selected.usage.outputTokens, language)}</dd></dl>
        <OutputSteps key={selected.id} workId={work.id} roundId={selected.id} affects={affects} />
      </section>}
    </>}
    <section className="cs-notes" aria-label={t('structureNotes')}>
      <h3>{t('structureNotes')}</h3>
      {notes.error && <ErrorNotice error={notes.error} retry={notes.reload} />}
      {!notes.data ? <p role="status">{notes.error ? '' : t('loading')}</p> : notes.data.version === 0 ? <p className="muted">{t('structureNoNotes')}</p> : <>
        <label>{t('structureNotesVersion')}<select value={note?.version} onChange={event => selectVersion(Number(event.target.value))}>
          {notes.data.versions.slice().reverse().map(note => <option key={note.version} value={note.version}>v{note.version} · {date(note.time)}</option>)}
        </select></label>
        <p className="cg-prose">{note?.body}</p>
      </>}
    </section>
  </div>;
}
