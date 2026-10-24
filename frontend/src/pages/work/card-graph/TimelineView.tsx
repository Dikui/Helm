import type { CSSProperties } from 'react';
import { elapsed, useClock } from '../../../shared/clock.js';
import { useI18n } from '../../../shared/i18n.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { NodeStatus, nodeTitle } from './labels.js';
import type { CardNode, Dispatch, GraphNode } from './types.js';

export function TimelineView({ nodes, dispatches, selectedId, select }: {
  nodes: GraphNode[]; dispatches?: Dispatch[]; selectedId: string | null;
  select: (cardId: string, dispatchId?: string) => void;
}) {
  const { t, language } = useI18n();
  const now = useClock();
  const cards = nodes.filter((node): node is CardNode => node.type === 'card');
  const started = (dispatches ?? []).filter(dispatch => dispatch.startedAt);
  const start = Math.min(now, ...started.map(dispatch => Date.parse(dispatch.startedAt!)));
  const span = Math.max(60_000, Math.ceil((now - start) / 60_000) * 60_000) * 1.08;
  const position = (time: number) => `${(time - start) / span * 100}%`;
  const loops = sendBackDispatchIds(dispatches ?? []);
  const time = (value: number) => new Date(value).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour12: false });
  const date = (value: string) => new Date(value).toLocaleString(language === 'zh' ? 'zh-CN' : 'en');
  return <section className="cs-timeline" aria-label={t('structureTimeline')}>
    {!dispatches ? <p className="hint" role="status">{t('loading')}</p> : !cards.length ? <p className="hint">{t('structureNoCards')}</p> : <>
      <div className="cs-lanes">
        <div className="cs-axis"><span /><div className="cs-track">{[0, .25, .5, .75, 1].map(tick => <span key={tick} style={{ left: `${tick * 100}%` }}>{time(start + span * tick)}</span>)}</div></div>
        {cards.map((card, index) => {
          const history = dispatches.filter(dispatch => dispatch.cardId === card.id);
          return <div key={card.id} className={`cs-lane ${selectedId === card.id ? 'selected' : ''} ${card.status === 'cancelled' ? 'cancelled' : ''}`} role="group" aria-label={`${t('graphCard')} ${index + 1}：${nodeTitle(card)}`}>
            <div className="cs-lane-label"><button className="cs-card-label" onClick={() => select(card.id)}>{index + 1} · {nodeTitle(card)}</button><NodeStatus node={card} /></div>
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
              {!history.length && <span className="cs-lane-empty">{t('graphNoDispatches')}</span>}
              {history.some(dispatch => dispatch.status === 'queued') && <span className="cs-lane-queued">{t('graphQueued')}</span>}
            </div>
          </div>;
        })}
        <div className="cs-now" style={{ '--cs-now': position(now) } as CSSProperties}><span /><div><time aria-label={t('structureNow')} dateTime={new Date(now).toISOString()}>{t('structureNow')} · {time(now)}</time></div></div>
      </div>
      <p className="cg-legend">{t('structureTimelineLegend')} · <span className="cs-sendback">{t('structureSendBack')}</span></p>
    </>}
  </section>;
}
