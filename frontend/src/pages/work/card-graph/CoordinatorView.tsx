import { inspectorUsage, UsageSummary, UsageTable } from './TokenDetails.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
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
import type { AgentEntry } from '../../settings/types.js';
import { WorkActions } from '../WorkActions.js';
import { RoundSteps } from '../conversation/RoundProgress.js';

interface Notes { body: string; version: number; versions: { body: string; version: number; time: string }[] }

export function CoordinatorView({ work, initialRoundId, initialStep, compact = false, agents }: { work: Work; initialRoundId?: string; initialStep?: number; compact?: boolean; agents?: AgentEntry[] }) {
  const { t, language } = useI18n();
  const now = useClock();
  const files = useWorkFiles(work.id);
  const preview = useFilePreview(work.id);
  const rounds = useResource<Rounds>('list-rounds', { workId: work.id });
  const notes = useResource<Notes>('get-coordinator-notes', { workId: work.id });
  const [roundId, selectRound] = useState<string | null>(initialRoundId ?? null);
  const [version, selectVersion] = useState<number | null>(null);
  const current = rounds.data?.rounds.find(round => round.status === 'running');
  const latest = current ?? rounds.data?.rounds.at(-1);
  const selected = rounds.data?.rounds.find(round => round.id === roundId) ?? latest;
  const agent = agents?.find(agent => agent.id === latest?.agentId);
  const note = notes.data?.versions.find(note => note.version === version) ?? notes.data;
  const paused = work.status === 'paused' && work.runtimePauseReason === '调度者连续失败 3 次';
  const affects = useCallback((event: HelmEvent) => event.workId === work.id &&
    (event.object.id === selected?.id || event.action === 'outputs-deleted'), [work.id, selected?.id]);
  const date = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
  const notesSection = <section className="cs-notes" aria-label={t('structureNotes')}>
      <h3 className="sect">{t('structureNotes')}{note?.version ? <span className="count">v{note.version}</span> : null}</h3>
      {notes.error && <ErrorNotice error={notes.error} retry={notes.reload} />}
      {!notes.data ? <p role="status">{notes.error ? '' : t('loading')}</p> : notes.data.version === 0 ? <p className="muted">{t('structureNoNotes')}</p> : <>
        <label>{t('structureNotesVersion')}<select value={note?.version} onChange={event => selectVersion(Number(event.target.value))}>
          {notes.data.versions.slice().reverse().map(note => <option key={note.version} value={note.version}>v{note.version} · {date(note.time)}</option>)}
        </select></label>
        <div className="cs-note"><Markdown text={note?.body ?? ''} workId={work.id} files={files} onOpen={preview.open} /></div>
      </>}
    </section>;
  const roundDetails = selected && <section className="cs-round-detail" aria-label={`${t('structureRound')} #${selected.number}`}>
        <h3>{t('structureRound')} #{selected.number}</h3>
        <dl className="cg-kv"><dt>{t('structureCoordinator')}</dt><dd>{selected.agentId ?? '—'}</dd><dt>{t('inspectorStarted')}</dt><dd><time dateTime={selected.startedAt}>{date(selected.startedAt)}</time></dd><dt>{t('inspectorEnded')}</dt><dd>{selected.endedAt ? <time dateTime={selected.endedAt}>{date(selected.endedAt)}</time> : t('structureRunning')}</dd><dt>{t('structureTokens')}</dt><dd className="mono" title={`${selected.usage.inputTokens ?? '—'} / ${selected.usage.outputTokens ?? '—'}`}>{formatTokens(selected.usage.inputTokens, language)} / {formatTokens(selected.usage.outputTokens, language)}</dd></dl>
        <OutputSteps initialStep={initialStep} key={`${selected.id}:${initialStep}`} workId={work.id} roundId={selected.id} affects={affects} />
      </section>;
  const roundList = <>
    {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
    {!rounds.data ? <p role="status">{rounds.error ? '' : t('loading')}</p> : !rounds.data.rounds.length ? <p className="muted">{t('structureNoRounds')}</p> : <ol className="cs-rounds compact">
      {rounds.data.rounds.map(round => <li key={round.id}>
        <span className={`spark ${round.status === 'running' ? 'run busy' : round.reason === 'completed' ? 'ok' : 'bad'}`} aria-hidden="true" />
        <span>{t('structureRound')} #{round.number} · <span>{round.status === 'running' ? t('structureRunning') : round.reason ? t(endLabels[round.reason as NonNullable<Dispatch['endReason']>]) : '—'}</span></span>
        <time>{elapsed(round.startedAt, round.endedAt ? Date.parse(round.endedAt) : now)}</time>
        <button className="cs-event-link" aria-label={`${t('structureRound')} #${round.number}`} aria-pressed={roundId === round.id} onClick={() => selectRound(round.id)}>{t('roundView')}</button>
      </li>)}
    </ol>}
  </>;
  return <div className={`cs-coordinator ${compact ? 'cs-rounds-view' : 'coordinator-inspector'}`}>
    {!compact && <p className="muted cg-coordinator-identity">{[t('structureCoordinator'), latest?.agentId, agent?.model, agent?.reasoningEffort].filter(Boolean).join(' · ')}</p>}
    {work.runtimePauseReason && <p className="pause-reason">{paused ? t('inspectorFailureReason') : work.runtimePauseReason}</p>}
    {rounds.data && <span className={compact || !paused ? 'sr' : 'pill bad'} role="status">{t(current ? 'structureRunning' : paused ? 'structureFailurePause' : 'conversationIdle')}</span>}
    {!compact && latest && <RoundSteps key={latest.id} inspector workId={work.id} round={latest} steps={rounds.data?.currentSteps ?? []} plan={rounds.data?.currentPlan ?? []} />}
    <section aria-label={t('structureRounds')}>{!compact && <h3 className="sect">{t('structureRounds')}</h3>}{roundList}</section>
    {notesSection}
    {roundId && roundDetails}
    {!compact && <section className="cg-usage" aria-label={t('tokenRounds')}><h3 className="sect">{t('tokenRounds')}</h3>
      {!rounds.data ? !rounds.error && <p role="status">{t('loading')}</p> : <><UsageSummary usage={inspectorUsage(rounds.data.rounds)} /><UsageTable kind="round" select={selectRound} rows={rounds.data.rounds.map(round => ({ ...round, label: `#${round.number}${round.status === 'running' ? ` · ${t('structureRunning')}` : round.reason && round.reason !== 'completed' ? ` · ${t(endLabels[round.reason as NonNullable<Dispatch['endReason']>])}` : ''}` }))} /></>}
    </section>}
    {!compact && <WorkActions work={work} reload={rounds.reload} coordinatorOnly />}
    {preview.preview}
  </div>;
}
