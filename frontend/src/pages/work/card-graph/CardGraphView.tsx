import { useState } from 'react';
import { useResource } from '../../../shared/data.js';
import { ErrorNotice } from '../../../shared/feedback.js';
import { useI18n } from '../../../shared/i18n.js';
import { GraphCanvas } from './GraphCanvas.js';
import { CardInspector } from './CardInspector.js';
import { sendBackDispatchIds } from './dispatch-history.js';
import { nodeTitle, NodeStatus } from './labels.js';
import type { Dispatch, GraphNode } from './types.js';
import './card-graph.css';

export function CardGraphView({ workId }: { workId: string }) {
  const { t } = useI18n();
  const graph = useResource<GraphNode[]>('get-card-graph', { workId });
  const dispatches = useResource<Dispatch[]>('list-dispatches', { workId });
  const [selectedId, select] = useState<string | null>(null);
  const selected = graph.data?.find(node => node.id === selectedId);
  const loops = sendBackDispatchIds(dispatches.data ?? []);
  const sendBacks = new Map<string, number>();
  for (const dispatch of dispatches.data ?? []) if (loops.has(dispatch.id)) sendBacks.set(dispatch.cardId, (sendBacks.get(dispatch.cardId) ?? 0) + 1);
  return <section className="cg-view" aria-label={t('structure')}>
    <div className="cg-errors">{graph.error && <ErrorNotice error={graph.error} retry={graph.reload} />}{dispatches.error && <ErrorNotice error={dispatches.error} retry={dispatches.reload} />}</div>
    {!graph.data ? <p className="hint" role="status">{graph.error ? '' : t('loading')}</p> : <>
      <div className="cg-main">
        <div className="cg-bar"><span className="cg-tab" aria-current="page">{t('graphTab')}</span><span className="muted">{t('cards')} {graph.data.filter(node => node.type === 'card').length}</span></div>
        <GraphCanvas nodes={graph.data} selectedId={selectedId} sendBacks={sendBacks} select={select} />
      </div>
      <aside className="cg-inspector" aria-label={t(selected?.type === 'gate' ? 'graphGateInspector' : 'graphInspector')}>
        {!selected ? <p className="hint">{t('graphSelect')}</p> : <>
          <header className="cg-inspector-head"><span className="muted">{t(selected.type === 'card' ? 'graphCard' : 'graphGate')}</span><h2>{nodeTitle(selected)}</h2><NodeStatus node={selected} /></header>
          <div className="cg-inspector-body">
            <dl className="cg-kv"><dt>{t('graphDependency')}</dt><dd>{selected.dependencies.length ? selected.dependencies.map(ref => <button className="btn sm" key={ref.id} onClick={() => select(ref.id)}>{nodeTitle(graph.data!.find(node => node.id === ref.id)!)}</button>) : '—'}</dd>
              <dt>{t('graphDownstream')}</dt><dd>{graph.data.filter(node => node.dependencies.some(ref => ref.id === selected.id)).map(node => <button className="btn sm" key={node.id} onClick={() => select(node.id)}>{nodeTitle(node)}</button>)}</dd></dl>
            <p className="cg-prose">{selected.type === 'card' ? selected.content : selected.body}</p>
            {selected.type === 'gate' ? <><p className="cg-prose">{selected.decision || selected.withdrawalReason}</p><ul>{selected.options.map(option => <li key={option}>{option}</li>)}</ul></> : <CardInspector key={selected.id} card={selected} dispatches={dispatches.data?.filter(dispatch => dispatch.cardId === selected.id)} />}
          </div>
        </>}
      </aside>
    </>}
  </section>;
}
