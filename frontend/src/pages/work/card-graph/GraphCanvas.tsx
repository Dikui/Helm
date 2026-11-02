import { AgentMark } from '../../../shared/AgentMark.js';
import type { AgentEntry } from '../../settings/types.js';
import { formatUsage } from '../../../shared/token-usage.js';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { arrange, initialGraphView, nodeHeight, nodeWidth } from './graph-layout.js';
import { formatTokens, useI18n } from '../../../shared/i18n.js';
import { gateDecision, nodeTitle, NodeStatus, nodeRingTone, AggregateBadge, WorkspaceBadge } from './labels.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { cardDisplayStatus, displayTopology, dispatchDuration } from './presentation.js';
import type { Dispatch, GraphNode } from './types.js';

function relatedNodes(nodes: GraphNode[], focus: string | null) {
  if (!focus) return null;
  const related = new Set([focus]);
  for (const upstream of [true, false]) {
    const pending = [focus];
    const visited = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      const neighbours = upstream ? nodes.find(node => node.id === id)?.dependencies.map(node => node.id) ?? []
        : nodes.filter(node => node.dependencies.some(dependency => dependency.id === id)).map(node => node.id);
      for (const neighbour of neighbours) { related.add(neighbour); pending.push(neighbour); }
    }
  }
  return related;
}

export function GraphCanvas({ nodes, dispatches, selectedId, sendBacks, select, agents = [] }: {
  agents?: AgentEntry[];
  nodes: GraphNode[]; dispatches: Dispatch[]; selectedId: string | null; sendBacks: Map<string, number>; select: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const marker = useId();
  const now = useClock();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [canvasWidth, setCanvasWidth] = useState(500);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Step events change labels, but only topology changes need a new layout.
  const topology = JSON.stringify(displayTopology(nodes));
  const positions = useMemo(() => arrange(JSON.parse(topology), canvasWidth), [topology, canvasWidth]);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const statusOf = (node: GraphNode) => node.type === 'card' ? cardDisplayStatus(node, nodes, dispatches) : node.status;
  const related = relatedNodes(nodes.map(node => ({ ...node, dependencies: positions.edges.filter(edge => edge.to === node.id).map(edge => ({ type: byId.get(edge.from)!.type, id: edge.from })) })), hovered ?? focused);
  const reset = useCallback(() => {
    const element = viewport.current;
    if (!element?.clientWidth) return;
    const width = Math.max(1, element.clientWidth - 24);
    setCanvasWidth(width);
    const view = initialGraphView(positions, width, Math.max(1, element.clientHeight - 24));
    setZoom(view.zoom);
    requestAnimationFrame(() => {
      if (!element.isConnected) return;
      element.scrollLeft = view.left; element.scrollTop = view.top;
    });
  }, [positions]);
  useEffect(() => {
    reset();
    if (typeof ResizeObserver === 'undefined' || !viewport.current) return;
    const observer = new ResizeObserver(reset);
    // Observe the panel, so scrollbars appearing during zoom do not reset it.
    observer.observe(viewport.current.parentElement!);
    return () => observer.disconnect();
  }, [reset]);
  const fit = () => {
    const element = viewport.current;
    if (!element?.clientWidth) return;
    setZoom(Math.max(.25, Math.min(1, (element.clientWidth - 24) / positions.width, (element.clientHeight - 24) / positions.height)));
    element.scrollLeft = 0; element.scrollTop = 0;
  };
  const percent = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en', { style: 'percent', maximumFractionDigits: 0 }).format(zoom);
  return <section className="cg-graph" aria-label={t('graphTitle')}>
    <div className="cg-canvas-wrap" style={{ '--graph-height': `${positions.height + 24}px` } as CSSProperties}><div className="cg-viewport" ref={viewport} tabIndex={0} aria-label={t('graphPanHelp')}
      onPointerDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return;
        const element = event.currentTarget;
        drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop };
        element.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!drag.current) return;
        event.currentTarget.scrollLeft = drag.current.left + drag.current.x - event.clientX;
        event.currentTarget.scrollTop = drag.current.top + drag.current.y - event.clientY;
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}>
      {!nodes.length ? <p className="hint">{t('graphEmpty')}</p> : <div className="cg-extent" style={{ width: positions.width * zoom, height: positions.height * zoom }}>
        <div className="cg-surface" style={{ width: positions.width, height: positions.height, transform: `scale(${zoom})` }}>
          <svg width={positions.width} height={positions.height}>
            <defs><marker id={marker} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L8 4 L0 8 z" fill="context-stroke" /></marker></defs>
            {positions.edges.map(edge => {
              const from = byId.get(edge.from)!; const to = byId.get(edge.to)!;
              const tone = [statusOf(from), statusOf(to)].some(status => ['cancelled', 'withdrawn', 'skipped'].includes(status)) ? 'cut'
                : statusOf(from) === 'pending' ? 'att' : ['executing', 'verifying'].includes(statusOf(to)) ? 'flow' : ['completed', 'decided'].includes(statusOf(from)) ? '' : 'todo';
              return <path key={`${edge.from}:${edge.to}`} role="img" aria-label={`${t((from.type === 'gate' && from.kind === 'work-confirmation') || (to.type === 'gate' && to.kind === 'review') ? 'graphFlowLink' : 'graphDependency')}：${nodeTitle(from)} → ${nodeTitle(to)}`}
                className={`cg-edge ${tone} ${related && !(related.has(edge.from) && related.has(edge.to)) ? 'dim' : ''}`}
                d={`M${edge.points[0]!.x},${edge.points[0]!.y} C${edge.points.slice(1).map(point => `${point.x},${point.y}`).join(' ')}`} markerEnd={`url(#${marker})`} />;
            })}
          </svg>
          {positions.nodes.map(({ id, x, y }) => {
            const node = byId.get(id)!;
            const ordinal = nodes.filter(item => item.type === 'card').findIndex(item => item.id === node.id) + 1;
            const name = node.type === 'card' ? `${t('graphCard')} ${ordinal}：${nodeTitle(node)}` : `${t('graphGate')}：${nodeTitle(node)}`;
            return <button key={node.id} className={`cg-node ${node.type} ${statusOf(node)} ${selectedId === node.id ? 'selected' : ''} ${related && !related.has(node.id) ? 'dim' : ''}`}
              style={{ left: x, top: y, width: nodeWidth, height: nodeHeight }} aria-label={name} title={[name, node.type === 'card' ? `${node.agentId ?? t('graphNoAgent')} · ${t('graphStep')} ${node.currentStep}\n${node.latestStepSummary ?? t('graphNoSteps')} · Token ${formatUsage(node.usage, language)}` : gateDecision(node, t) || node.body].join('\n')} aria-pressed={selectedId === node.id}
              aria-describedby={`${marker}-${node.id}-state`}
              onClick={() => select(node.id)} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setFocused(node.id)} onBlur={() => setFocused(null)}>
              <span className="cg-node-name">{node.type === 'card' ? <AgentMark driver={agents.find(agent => agent.id === (dispatches.find(dispatch => dispatch.id === node.latestDispatchId)?.agentId ?? node.agentId))?.driver} /> : <span className={`spark ${nodeRingTone[node.status] ?? ''}`} aria-hidden="true">✦</span>}<span>{node.type === 'card' && `${ordinal} · `}{nodeTitle(node)}</span></span>
              <span className="cg-node-state" id={`${marker}-${node.id}-state`}><NodeStatus node={node} status={statusOf(node)} />{node.type === 'card' && <WorkspaceBadge workspace={node.workspace ?? 'copy'} />}{node.type === 'card' && node.aggregate && <AggregateBadge />}
                {node.type === 'gate' && node.status === 'pending' && <time dateTime={node.createdAt}>{elapsed(node.createdAt, now)}</time>}
                {node.type === 'card' && node.status !== 'skipped' && <time>{elapsed(new Date(0).toISOString(), dispatchDuration(dispatches.filter(dispatch => dispatch.cardId === node.id), now))}</time>}
                {Boolean(sendBacks.get(node.id)) && <span className="cg-rework" aria-label={`${t('graphSendBacks')}: ${sendBacks.get(node.id)}`}>↺ {sendBacks.get(node.id)}</span>}
              </span>
            </button>;
          })}
        </div>
      </div>}
    </div>
    <div className="cg-tools" role="group" aria-label={t('graphControls')}>
      <button className="btn sm" aria-label={t('graphZoomOut')} disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .15))}>−</button>
      <output aria-label={t('graphZoom')} className="mono">{percent}</output>
      <button className="btn sm" aria-label={t('graphZoomIn')} disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .15))}>＋</button>
      <button className="btn sm" onClick={fit}>{t('graphFit')}</button>
    </div>
    </div>
    <div className="cg-legend">
      {nodes.some(node => node.status === 'skipped') && <span><span className="cg-skip-chip cg-skip-fill">{t('skipped')}</span>{t('graphLegendSkipped')}</span>}
      {nodes.some(node => node.type === 'card' && node.aggregate) && <span><AggregateBadge />{t('graphLegendAggregate')}</span>}
      {sendBacks.size > 0 && <span><span className="cg-rework">↺</span>{t('graphSendBacks')}</span>}
    </div>
  </section>;
}
