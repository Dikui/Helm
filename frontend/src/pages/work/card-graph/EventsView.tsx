import { useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent } from '../../../shared/types.js';
import { nodeTitle } from './labels.js';
import type { Dispatch, GraphNode } from './types.js';

const actorLabels = { user: 'structureActorUser', 'coordinator-round': 'structureActorRound', dispatch: 'structureActorDispatch', runtime: 'structureActorRuntime' } as const;
type TimelineEvent = HelmEvent & { actor: { type: keyof typeof actorLabels; id: string } };

export function EventsView({ workId, nodes, dispatches, select }: {
  workId: string; nodes: GraphNode[]; dispatches?: Dispatch[];
  select: (cardId: string, dispatchId?: string, step?: number) => void;
}) {
  const { t, language } = useI18n();
  const [cardId, setCardId] = useState('');
  const [dispatchId, setDispatchId] = useState('');
  const [actorType, setActorType] = useState('');
  const events = useResource<TimelineEvent[]>('get-events', { workId, ...(cardId ? { cardId } : {}), ...(dispatchId ? { dispatchId } : {}), ...(actorType ? { actorType } : {}) });
  const cards = nodes.filter(node => node.type === 'card');
  const cardTitle = (id: string) => { const card = cards.find(card => card.id === id); return card ? nodeTitle(card) : id; };
  const filteredDispatches = dispatches?.filter(dispatch => !cardId || dispatch.cardId === cardId);
  return <section className="cs-events" aria-label={t('structureEvents')}>
    <div className="cs-filters">
      <label><span className="sr">{t('structureCardFilter')}</span><select value={cardId} onChange={event => { setCardId(event.target.value); setDispatchId(''); }}>
        <option value="">{t('structureAllCards')}</option>{cards.map((card, index) => <option key={card.id} value={card.id}>{index + 1} · {nodeTitle(card)}</option>)}
      </select></label>
      <label><span className="sr">{t('structureDispatchFilter')}</span><select value={dispatchId} disabled={!dispatches} onChange={event => setDispatchId(event.target.value)}>
        <option value="">{t('structureAllDispatches')}</option>{filteredDispatches?.map(dispatch => <option key={dispatch.id} value={dispatch.id}>
          #{dispatches!.filter(item => item.cardId === dispatch.cardId).findIndex(item => item.id === dispatch.id) + 1} · {cardTitle(dispatch.cardId)} · {t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}
        </option>)}
      </select></label>
      <label><span className="sr">{t('structureActorFilter')}</span><select value={actorType} onChange={event => setActorType(event.target.value)}>
        <option value="">{t('structureAllActors')}</option>{Object.entries(actorLabels).map(([value, key]) => <option key={value} value={value}>{t(key)}</option>)}
      </select></label>
      {(cardId || dispatchId || actorType) && <button className="btn sm" onClick={() => { setCardId(''); setDispatchId(''); setActorType(''); }}>{t('structureClearFilters')}</button>}
    </div>
    {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
    {!events.data ? <p role="status">{events.error ? '' : t('loading')}</p> : !events.data.length ? <p className="muted">{t('structureNoEvents')}</p> : <ol className="cs-event-list">
      {events.data.slice().reverse().map(event => {
        const dispatch = dispatches?.find(dispatch => dispatch.id === event.dispatchId);
        const cardIndex = cards.findIndex(card => card.id === (dispatch?.cardId ?? event.cardId));
        const details = event.details as { step?: number; summary?: string; reason?: string } | null;
        const step = Number.isSafeInteger(details?.step) && details!.step! > 0 ? details!.step : undefined;
        const label = [event.action, cardIndex >= 0 ? `${t('graphCard')} ${cardIndex + 1}` : null, step ? `${t('graphStep')} ${step}` : null].filter(Boolean).join(' · ');
        return <li key={event.id}>
          <time dateTime={event.time} title={new Date(event.time).toLocaleString(language === 'zh' ? 'zh-CN' : 'en', { timeZoneName: 'short' })}>{new Date(event.time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })}</time>
          <div className="cs-event-body">{dispatch ? <button className="cs-event-link" onClick={() => select(dispatch.cardId, dispatch.id, step ?? 1)}>{label}</button> : <span>{label}</span>}
            <small className="muted">{t(actorLabels[event.actor.type])} · <span className="mono">{event.actor.id}</span>{dispatch && <> · {t('graphDispatch')} <span className="mono">{dispatch.id}</span></>}</small>
            {(details?.summary || details?.reason) && <p className="cg-prose">{details.summary || details.reason}</p>}
            <details><summary>{t('structureEventDetails')}</summary><pre>{JSON.stringify(event.details, null, 2)}</pre></details>
          </div>
        </li>;
      })}
    </ol>}
  </section>;
}
