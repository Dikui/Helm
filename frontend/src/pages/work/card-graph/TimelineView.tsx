import type { CSSProperties } from 'react';
import { useResource } from '../../../shared/data.js';
import type { Rounds } from '../conversation/types.js';
import { timelineRange } from './presentation.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n } from '../../../shared/i18n.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { nodeRingTone } from './labels.js';
import { NodeStatus, nodeTitle } from './labels.js';
import type { CardNode, Dispatch, GraphNode } from './types.js';

export function TimelineView({ workId, nodes, dispatches, selectedId, select, inspectRound }: {
  workId: string; nodes: GraphNode[]; dispatches?: Dispatch[]; inspectRound: (roundId: string) => void; selectedId: string | null;
  select: (cardId: string, dispatchId?: string) => void;
}) {
  const { t, language } = useI18n();
  const now = useClock();
  const cards = nodes.filter((node): node is CardNode => node.type === 'card');
  const rounds = useResource<Rounds>('list-rounds', { workId });
  const { start, span } = timelineRange(dispatches ?? [], rounds.data?.rounds ?? [], now);
  const position = (time: number) => `${(time - start) / span * 100}%`;
  const loops = sendBackDispatchIds(dispatches ?? []);
  const time = (value: number) => new Date(value).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour12: false });
  const date = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
  return <section className="cs-timeline" aria-label={t('structureTimeline')}>
    {rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}
    {!dispatches ? <p className="hint" role="status">{t('loading')}</p> : !cards.length ? <p className="hint">{t('structureNoCards')}</p> : <>
      <div className="cs-lanes">
        <div className="cs-axis"><span /><div className="cs-track">{[0, .25, .5, .75, 1].map(tick => <span key={tick} style={{ left: `${tick * 100}%` }}>{time(start + span * tick)}</span>)}</div></div>
        <div className="cs-lane cs-round-lane"><span className="cs-lane-label"><span className={`spark ${rounds.data?.rounds.some(round => round.status === 'running') ? 'run busy' : ''}`} aria-hidden="true" />{t('structureCoordinator')}</span><div className="cs-track">
          {rounds.data?.rounds.map(round => <button key={round.id} className={`cs-block round ${round.status}`} style={{ left: position(Date.parse(round.startedAt)), width: position(start + Math.max(0, (round.endedAt ? Date.parse(round.endedAt) : now) - Date.parse(round.startedAt))) }}
            aria-label={`${t('structureRound')} #${round.number}`} title={`${t('structureRound')} #${round.number} · ${round.agentId ?? ''} · ${elapsed(round.startedAt, round.endedAt ? Date.parse(round.endedAt) : now)}`} onClick={() => inspectRound(round.id)}>#{round.number}</button>)}
        </div></div>
        {cards.map((card, index) => {
          const history = dispatches.filter(dispatch => dispatch.cardId === card.id);
          const withdrawn = card.status === 'skipped' ? card.skippedBy?.filter(cause => cause.status === 'withdrawn') ?? [] : [];
          return <div key={card.id} className={`cs-lane ${selectedId === card.id ? 'selected' : ''} ${card.status}`} style={withdrawn.length > 1 ? { minHeight: 12 + withdrawn.length * 22 } : undefined} role="group" aria-label={`${t('graphCard')} ${index + 1}：${nodeTitle(card)}`}>
            <div className="cs-lane-label"><span className={`spark ${nodeRingTone[card.status] ?? ''}`} aria-hidden="true" /><button className="cs-card-label" onClick={() => select(card.id)}>{index + 1} · {nodeTitle(card)}</button><NodeStatus node={card} /></div>
            <div className="cs-track">
              {history.filter(dispatch => dispatch.startedAt).map(dispatch => {
                const begin = Date.parse(dispatch.startedAt!);
                const end = dispatch.endedAt ? Date.parse(dispatch.endedAt) : now;
                const label = `${loops.has(dispatch.id) ? '↺ ' : ''}${t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}${dispatch.conclusion === 'failed' ? ' ✗' : dispatch.conclusion === 'passed' ? ' ✓' : ''}`;
                const name = `${t('graphDispatch')} #${history.indexOf(dispatch) + 1} · ${label}`;
                return <button key={dispatch.id} className={`cs-block ${dispatch.purpose} ${dispatch.conclusion} ${dispatch.status}`} style={{ left: position(begin), width: position(start + Math.max(0, end - begin)) }}
                  aria-label={name} title={`${name} · ${dispatch.agentId}\n${date(dispatch.startedAt!)} → ${dispatch.endedAt ? date(dispatch.endedAt) : t('structureNow')} · ${elapsed(dispatch.startedAt!, end)}`}
                  onClick={() => select(card.id, dispatch.id)}>{label}</button>;
              })}
              {card.status === 'skipped' && <>
                {withdrawn.map((cause, index) => <button key={cause.id}
                  className="cs-gate-marker withdrawn" style={{ right: '14%', top: 7 + index * 22 }}
                  title={cause.title} aria-label={`${t('graphGateWithdrawn')}：${cause.title}`} onClick={() => select(cause.id)}>▲ {t('graphGateWithdrawn')} · {cause.title}</button>)}
                <span className="cs-block skipped cg-skip-fill" style={{ left: '87.5%', width: '12.5%' }}>{t('graphSkip')}</span>
              </>}
              {card.status !== 'skipped' && !history.length && <span className="cs-lane-empty">{t('graphNoDispatches')}</span>}
              {history.some(dispatch => dispatch.status === 'queued') && <span className="cs-lane-queued">{t('graphQueued')}</span>}
            </div>
          </div>;
        })}
        {now <= start + span && <div className="cs-now" style={{ '--cs-now': position(now) } as CSSProperties}><span /><div><time aria-label={t('structureNow')} dateTime={new Date(now).toISOString()}>{t('structureNow')} · {time(now)}</time></div></div>}
      </div>
      <div className="cg-legend cs-timeline-legend"><span><i className="cs-block execution" />{t('graphExecution')}</span><span><i className="cs-block verification passed">✓</i>{t('graphReportedPassed')}</span><span><i className="cs-block verification failed">✗</i>{t('structureSendBack')}</span><span><i className="cs-block skipped cg-skip-fill" />{t('structureSkippedLegend')}</span><span>{t('structureTimelineLegend')}</span></div>
    </>}
  </section>;
}
