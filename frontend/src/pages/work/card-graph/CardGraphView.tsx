import { useId, useRef, useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GraphCanvas } from './GraphCanvas.js';
import { CardInspector } from './CardInspector.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { gateDecision, nodeTitle, NodeStatus } from './labels.js';
import type { Dispatch, GraphNode } from './types.js';
import type { Work } from '../../../shared/types.js';
import { CoordinatorView } from './CoordinatorView.js';
import { TimelineView } from './TimelineView.js';
import { EventsView } from './EventsView.js';
import './card-graph.css';
import './structure.css';

const tabs = ['graphTab', 'structureTimeline', 'structureCoordinator', 'structureEvents'] as const;
export function CardGraphView({ work }: { work: Work }) {
  const workId = work.id;
  const { t } = useI18n();
  const [tab, setTab] = useState<typeof tabs[number]>('graphTab');
  const tabId = useId();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const graph = useResource<GraphNode[]>('get-card-graph', { workId });
  const dispatches = useResource<Dispatch[]>('list-dispatches', { workId });
  const [selection, setSelection] = useState<{ id: string; dispatchId?: string; step?: number; request: number } | null>(null);
  const selectedId = selection?.id ?? null;
  const select = (id: string, dispatchId?: string, step?: number) => setSelection(previous => ({ id, dispatchId, step, request: (previous?.request ?? 0) + 1 }));
  const selected = graph.data?.find(node => node.id === selectedId);
  const loops = sendBackDispatchIds(dispatches.data ?? []);
  const sendBacks = new Map<string, number>();
  for (const dispatch of dispatches.data ?? []) if (loops.has(dispatch.id)) sendBacks.set(dispatch.cardId, (sendBacks.get(dispatch.cardId) ?? 0) + 1);
  return <section className="cg-view" aria-label={t('structure')}>
    <div className="cg-errors">{graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}{dispatches.error && <ErrorNotice error={dispatches.error} retry={dispatches.reload} />}</div>
    {!graph.data ? <p className="hint" role="status">{graph.error ? '' : t('loading')}</p> : <>
      <div className="cg-main">
        <div className="cg-bar"><div className="cs-tabs" role="tablist" aria-label={t('structure')}>
          {tabs.map((key, index) => <button key={key} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab"
            id={`${tabId}-${key}`} aria-controls={`${tabId}-panel`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1}
            onClick={() => setTab(key)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : null;
              if (next !== null) { event.preventDefault(); tabButtons.current[next]?.focus(); }
            }}>{t(key)}</button>)}
        </div><span className="muted">{t('cards')} {graph.data.filter(node => node.type === 'card').length}</span></div>
        <div className={`cs-panel ${tab === 'graphTab' ? 'cs-graph-panel' : ''}`} role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`}>
          {tab === 'graphTab' && <GraphCanvas nodes={graph.data} selectedId={selectedId} sendBacks={sendBacks} select={select} />}
          {tab === 'structureCoordinator' && <CoordinatorView work={work} />}
          {tab === 'structureTimeline' && <TimelineView nodes={graph.data} dispatches={dispatches.data} selectedId={selectedId} select={select} />}
          {tab === 'structureEvents' && <EventsView workId={workId} nodes={graph.data} dispatches={dispatches.data} select={select} />}
        </div>
      </div>
      <aside className="cg-inspector" aria-label={t(selected?.type === 'gate' ? 'graphGateInspector' : 'graphInspector')}>
        {!selected ? <p className="hint">{t('graphSelect')}</p> : <>
          <header className="cg-inspector-head"><span className="muted">{t(selected.type === 'card' ? 'graphCard' : 'graphGate')}</span><h2>{nodeTitle(selected)}</h2><NodeStatus node={selected} /></header>
          <div className="cg-inspector-body">
            <dl className="cg-kv"><dt>{t('graphDependency')}</dt><dd>{selected.dependencies.length ? selected.dependencies.map(ref => <button className="btn sm" key={ref.id} onClick={() => select(ref.id)}>{nodeTitle(graph.data!.find(node => node.id === ref.id)!)}</button>) : '—'}</dd>
              <dt>{t('graphDownstream')}</dt><dd>{graph.data.filter(node => node.dependencies.some(ref => ref.id === selected.id)).map(node => <button className="btn sm" key={node.id} onClick={() => select(node.id)}>{nodeTitle(node)}</button>)}</dd></dl>
            <p className="cg-prose">{selected.type === 'card' ? selected.content : selected.body}</p>
            {selected.type === 'gate' ? <><p className="cg-prose">{gateDecision(selected, t) || selected.withdrawalReason}</p><ul>{selected.options.map(option => <li key={option}>{option}</li>)}</ul></> : <CardInspector key={`${selected.id}:${selection?.request}`} card={selected} dispatches={dispatches.data?.filter(dispatch => dispatch.cardId === selected.id)} initialDispatchId={selection?.dispatchId} initialStep={selection?.step} />}
          </div>
        </>}
      </aside>
    </>}
  </section>;
}
