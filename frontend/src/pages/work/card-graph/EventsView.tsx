import { useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import type { HelmEvent } from '../../../shared/types.js';
import { nodeTitle } from './labels.js';
import { eventSummary } from './event-summary.js';
import type { Dispatch, GraphNode } from './types.js';

const actorLabels = { user: 'structureActorUser', 'coordinator-round': 'structureActorRound', dispatch: 'structureActorDispatch', runtime: 'structureActorRuntime' } as const;
type TimelineEvent = HelmEvent & { actor: { type: keyof typeof actorLabels; id: string } };

export function EventsView({ workId, nodes, dispatches, select, inspectRound }: {
  workId: string; nodes: GraphNode[]; dispatches?: Dispatch[];
  select: (cardId: string, dispatchId?: string, step?: number) => void;
  inspectRound: (roundId: string, step?: number) => void;
}) {
  const { t, language } = useI18n();
  const [filters, setFilters] = useState({ cardId: '', dispatchId: '', actorType: '' });
  const events = useResource<TimelineEvent[]>('get-events', { workId, ...(filters.cardId ? { cardId: filters.cardId } : {}),
    ...(filters.dispatchId ? { dispatchId: filters.dispatchId } : {}), ...(filters.actorType ? { actorType: filters.actorType } : {}) });
  const cards = nodes.filter(node => node.type === 'card');
  const selectedDispatch = dispatches?.find(dispatch => dispatch.id === filters.dispatchId);
  const selectedCardId = filters.cardId || selectedDispatch?.cardId;
  const filterLabel = [selectedCardId ? `${t('graphCard')} ${cards.findIndex(card => card.id === selectedCardId) + 1}` : '',
    selectedDispatch ? `${t('graphDispatch')} #${dispatches!.filter(dispatch => dispatch.cardId === selectedDispatch.cardId).indexOf(selectedDispatch) + 1}` : '',
    filters.actorType ? t(actorLabels[filters.actorType as keyof typeof actorLabels]) : ''].filter(Boolean).join(' · ');
  const filterValue = filterLabel ? JSON.stringify(filters) : '';
  const changeFilter = (choice: string) => {
    const [kind, ...parts] = choice.split(':');
    const value = parts.join(':');
    setFilters(previous => kind === 'card' ? { ...previous, cardId: value, dispatchId: '' }
      : kind === 'dispatch' ? { ...previous, dispatchId: value } : kind === 'actor' ? { ...previous, actorType: value }
      : { cardId: '', dispatchId: '', actorType: '' });
  };
  return <section className="cs-events" aria-label={t('structureEvents')}>
    <label className="cs-event-filter"><span className="sr">{t('eventFilter')}</span><select value={filterValue} onChange={event => changeFilter(event.target.value)}>
      <option value="">{t('allEvents')}</option>
      {filterLabel && <option value={filterValue} disabled>{filterLabel}</option>}
      <optgroup label={t('structureCardFilter')}><option value="card:">{t('structureAllCards')}</option>{cards.map((card, index) => <option key={card.id} value={`card:${card.id}`}>{t('graphCard')} {index + 1} · {nodeTitle(card)}</option>)}</optgroup>
      <optgroup label={t('structureDispatchFilter')}><option value="dispatch:">{t('structureAllDispatches')}</option>{dispatches?.filter(dispatch => !filters.cardId || dispatch.cardId === filters.cardId).map(dispatch => <option key={dispatch.id} value={`dispatch:${dispatch.id}`}>
        {t('graphCard')} {cards.findIndex(card => card.id === dispatch.cardId) + 1} · {t('graphDispatch')} #{dispatches.filter(item => item.cardId === dispatch.cardId).indexOf(dispatch) + 1} · {t(dispatch.purpose === 'execution' ? 'graphExecution' : 'graphVerification')}
      </option>)}</optgroup>
      <optgroup label={t('structureActorFilter')}><option value="actor:">{t('structureAllActors')}</option>{Object.entries(actorLabels).map(([value, key]) => <option key={value} value={`actor:${value}`}>{t(key)}</option>)}</optgroup>
    </select></label>
    {events.error && <ErrorNotice error={events.error} retry={events.reload} />}
    {!events.data ? <p role="status">{events.error ? '' : t('loading')}</p> : !events.data.length ? <p className="muted">{t('structureNoEvents')}</p> : <ol className="cs-event-list">
      {events.data.slice().reverse().map(event => {
        const dispatch = dispatches?.find(dispatch => dispatch.id === event.dispatchId);
        const cardIndex = cards.findIndex(card => card.id === (dispatch?.cardId ?? event.cardId));
        const details = event.details as { step?: number } | null;
        const step = Number.isSafeInteger(details?.step) && details!.step! > 0 ? details!.step : undefined;
        const roundId = event.object.type === 'coordinator-round' ? event.object.id : event.actor.type === 'coordinator-round' ? event.actor.id : undefined;
        const label = eventSummary(event, t, cardIndex + 1);
        return <li key={event.id}>
          <time dateTime={event.time} title={new Date(event.time).toLocaleString(language === 'zh' ? 'zh-CN' : 'en', { timeZoneName: 'short' })}>{new Date(event.time).toLocaleTimeString(language === 'zh' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit', hour12: false })}</time>
          <div className="cs-event-body"><div className="cs-event-line"><span title={label}>{label}</span>
            {(dispatch || roundId || cardIndex >= 0) && <a className="cs-event-link" href={`/works/${encodeURIComponent(workId)}?inspect=${dispatch ? `card:${dispatch.cardId}` : roundId ? 'rounds' : `card:${cards[cardIndex]!.id}`}`} aria-label={`${t('eventStepLink')}：${label}`} onClick={click => { click.preventDefault(); if (dispatch) select(dispatch.cardId, dispatch.id, step ?? 1); else if (roundId) inspectRound(roundId, step); else select(cards[cardIndex]!.id); }}>{t('eventStepLink')}</a>}
            <details><summary aria-label={`${t('structureEventDetails')}：${label}`}>⋯</summary><pre>{JSON.stringify(event, null, 2)}</pre></details>
          </div></div>
        </li>;
      })}
    </ol>}
  </section>;
}
