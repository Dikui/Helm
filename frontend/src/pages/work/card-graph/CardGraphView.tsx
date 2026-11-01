import { sumUsage } from '../../../shared/token-usage.js';
import { CoordinatorTokens, UsageSummary } from './TokenDetails.js';
import type { Rounds } from '../conversation/types.js';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GraphCanvas } from './GraphCanvas.js';
import { CardInspector } from './CardInspector.js';
import { graphSummary, dispatchDuration } from './presentation.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { Markdown, useFilePreview, useWorkFiles } from '../../../shared/files.js';
import { gateDecision, nodeTitle, NodeStatus, AggregateBadge, ReadOnlyBadge } from './labels.js';
import type { Dispatch, GraphNode } from './types.js';
import type { Work } from '../../../shared/types.js';
import { CoordinatorView } from './CoordinatorView.js';
import { TimelineView } from './TimelineView.js';
import { EventsView } from './EventsView.js';
import { CardList } from './CardList.js';
import { structureViews, type Inspection, type StructureView } from '../useWorkInspector.js';
import './card-graph.css';
import './structure.css';

const tabLabels = { list: 'inspectorList', graph: 'graphTab', timeline: 'structureTimeline', rounds: 'inspectorRounds', events: 'structureEvents' } as const;
export function CardGraphView({ work, inspection, inspect }: { work: Work; inspection: Inspection; inspect: (inspection: Inspection) => void }) {
  const workId = work.id;
  const { t } = useI18n();
  const now = useClock();
  const files = useWorkFiles(workId);
  const preview = useFilePreview(workId);
  const tab = structureViews.includes(inspection as StructureView) ? inspection as StructureView : null;
  const tabId = useId();
  const [roundId, setRoundId] = useState<string>();
  const tabButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const rounds = useResource<Rounds>('list-rounds', { workId });
  const coordinatorSelected = inspection === 'coord';
  const graph = useResource<GraphNode[]>('get-card-graph', { workId });
  // An ended work keeps its review gate pending on purpose; show the work's end state instead of a ticking "pending".
  const nodes = ['completed', 'cancelled'].includes(work.status)
    ? graph.data?.map(node => node.type === 'gate' && node.status === 'pending' ? { ...node, status: work.status } : node) : graph.data;
  const dispatches = useResource<Dispatch[]>('list-dispatches', { workId });
  const [selection, setSelection] = useState<{ id: string; dispatchId?: string; step?: number; request: number } | null>(null);
  const details = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (!tab) details.current?.focus(); }, [inspection, Boolean(nodes)]);
  const selectedId = inspection.startsWith('card:') ? inspection.slice(5) : selection?.id ?? null;
  const select = (id: string, dispatchId?: string, step?: number) => {
    setSelection(previous => previous?.id === id && !dispatchId && !step ? previous : { id, dispatchId, step, request: (previous?.request ?? 0) + 1 });
    inspect(`card:${id}`);
  };
  const selected = nodes?.find(node => node.id === selectedId);
  const summary = graphSummary(nodes ?? [], dispatches.data ?? []);
  const ordinal = (id: string) => (nodes ?? []).filter(node => node.type === 'card').findIndex(node => node.id === id) + 1;
  const selectedDispatches = dispatches.data?.filter(dispatch => dispatch.cardId === selected?.id);
  const refButton = (id: string) => {
    const node = nodes?.find(node => node.id === id);
    return node ? <button className="ref" key={id} title={nodeTitle(node)} aria-label={`${t(node.type === 'card' ? 'graphCard' : 'graphGate')} ${node.type === 'card' ? ordinal(id) : ''}：${nodeTitle(node)}`} onClick={() => select(id)}>{node.type === 'card' ? ordinal(id) : nodeTitle(node)}</button> : null;
  };
  return <section className="cg-view work-structure" aria-label={t('structure')}>
    <div className="cg-errors">{rounds.error && <ErrorNotice error={rounds.error} retry={rounds.reload} />}{graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}{dispatches.error && <ErrorNotice error={dispatches.error} retry={dispatches.reload} />}</div>
    {!nodes ? <p className="hint" role="status">{graph.error ? '' : t('loading')}</p> : <>
      <div className="cg-main">
        <div className="cg-bar"><div className="cs-tabs" role="tablist" aria-label={t('structure')}>
          {structureViews.map((key, index) => <button key={key} ref={element => { tabButtons.current[index] = element; }} type="button" role="tab"
            id={`${tabId}-${key}`} aria-controls={`${tabId}-panel`} aria-selected={tab === key} tabIndex={tab === key || !tab && index === 0 ? 0 : -1}
            onClick={() => inspect(key)} onKeyDown={event => {
              const next = event.key === 'ArrowRight' ? (index + 1) % structureViews.length : event.key === 'ArrowLeft' ? (index + structureViews.length - 1) % structureViews.length : event.key === 'Home' ? 0 : event.key === 'End' ? structureViews.length - 1 : null;
              if (next !== null) { event.preventDefault(); tabButtons.current[next]?.focus(); }
            }}>{t(tabLabels[key])}</button>)}
        </div><div className="cs-summary">
          <span><b>{nodes.filter(node => node.type === 'card' && node.status === 'completed').length}/{summary.cards}</b> {t('completed')}</span><span><b>{summary.parallel}</b> {t('shellRunning')}</span>
          <span><b>{dispatches.data ? summary.retries : '—'}</b> {t('graphSummaryRetries')}</span><span><b>{summary.cancelled}</b> {t('graphSummaryCancelled')}</span>
          {summary.skipped > 0 && <span><b>{summary.skipped}</b> {t('graphSummarySkipped')}</span>}
        </div></div>
        <div hidden={!tab} className={`cs-panel ${tab === 'graph' ? 'cs-graph-panel' : ''}`} role="tabpanel" id={`${tabId}-panel`} aria-labelledby={tab ? `${tabId}-${tab}` : undefined}>
          {tab === 'list' && <CardList nodes={nodes} dispatches={dispatches.data} select={select} />}
          {tab === 'graph' && <GraphCanvas nodes={nodes} dispatches={dispatches.data ?? []} selectedId={selectedId} sendBacks={summary.sendBacks} select={select} coordinator={{ count: rounds.data?.rounds.length, usage: sumUsage(rounds.data?.rounds ?? []), selected: false, select: () => inspect('coord') }} />}
          {tab === 'rounds' && <CoordinatorView key={roundId} work={work} initialRoundId={roundId} />}
          {tab === 'timeline' && <TimelineView inspectRound={id => { setRoundId(id); inspect('rounds'); tabButtons.current[3]?.focus(); }} workId={workId} nodes={nodes} dispatches={dispatches.data} selectedId={selectedId} select={select} />}
          {tab === 'events' && <EventsView workId={workId} nodes={nodes} dispatches={dispatches.data} select={select} />}
        </div>
      </div>
      <aside hidden={Boolean(tab)} className="cg-inspector" ref={details} tabIndex={-1} aria-label={t(coordinatorSelected ? 'tokenCoordinator' : selected?.type === 'gate' ? 'graphGateInspector' : 'graphInspector')}>
        {coordinatorSelected ? <><CoordinatorTokens rounds={rounds.data?.rounds} /><CoordinatorView work={work} /></> : !selected ? <p className="hint">{t('graphSelect')}</p> : <>
          <header className="cg-inspector-head"><small className="muted">{t(selected.type === 'card' ? 'graphCard' : 'graphGate')}{selected.type === 'card' ? ` ${ordinal(selected.id)}` : ''}</small><h2>{nodeTitle(selected)}</h2>
            <div className="row"><NodeStatus node={selected} />{selected.type === 'card' && selected.readOnly && <ReadOnlyBadge />}{selected.type === 'card' && selected.aggregate && <AggregateBadge />}{selected.type === 'card' && <time className="muted">{selectedDispatches ? elapsed(new Date(0).toISOString(), dispatchDuration(selectedDispatches, now)) : '—'}</time>}
              {!!summary.sendBacks.get(selected.id) && <span className="cg-rework">↺ {t('graphSendBackPrefix')} {summary.sendBacks.get(selected.id)} {t('graphSendBackSuffix')}</span>}</div>
            {selected.type === 'card' && <UsageSummary usage={selected.usage} />}
          </header>
          <div className="cg-inspector-body">
            <dl className="cg-kv"><dt>{t('graphDependency')}</dt><dd>{selected.dependencies.length ? selected.dependencies.map(ref => refButton(ref.id)) : '—'}</dd>
              <dt>{t('graphDownstream')}</dt><dd>{nodes.some(node => node.dependencies.some(ref => ref.id === selected.id)) ? nodes.filter(node => node.dependencies.some(ref => ref.id === selected.id)).map(node => refButton(node.id)) : '—'}</dd>
            </dl>
            <Markdown text={selected.type === 'card' ? selected.content : selected.body} workId={workId} files={files} onOpen={preview.open} />
            {selected.type === 'gate' ? <><p className="cg-prose">{gateDecision(selected, t) || selected.withdrawalReason}</p><ul>{selected.options.map(option => <li key={option}>{option}</li>)}</ul></> : <CardInspector key={`${selected.id}:${selection?.request}`} card={selected} dispatches={selectedDispatches} initialDispatchId={selection?.id === selected.id ? selection.dispatchId : undefined} initialStep={selection?.id === selected.id ? selection.step : undefined} />}
          </div>
        </>}
      </aside>
    </>}
    {preview.preview}
  </section>;
}
