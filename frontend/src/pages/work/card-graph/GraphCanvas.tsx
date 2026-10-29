import { formatUsage } from '../../../shared/token-usage.js';
import type { Usage } from '../../../shared/types.js';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { graphlib, layout, type Point } from '@dagrejs/dagre';
import { formatTokens, useI18n } from '../../../shared/i18n.js';
import { gateDecision, nodeTitle, NodeStatus, nodeRingTone, AggregateBadge } from './labels.js';
import { elapsed, useClock } from '../../../shared/clock.js';
import { displayTopology, dispatchDuration } from './presentation.js';
import type { Dispatch, GraphNode } from './types.js';

const nodeWidth = 140;
const nodeHeight = 84;
function arrange(nodes: Pick<GraphNode, 'id' | 'dependencies'>[]) {
  const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 20, ranksep: 48, marginx: 24, marginy: 24 });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  for (const node of nodes) for (const dependency of node.dependencies) {
    if (graph.hasNode(dependency.id)) graph.setEdge(dependency.id, node.id);
  }
  layout(graph);
  return {
    width: Math.max(1, graph.graph().width ?? 1), height: Math.max(1, graph.graph().height ?? 1),
    nodes: nodes.map(node => ({ id: node.id, x: graph.node(node.id).x - nodeWidth / 2, y: graph.node(node.id).y - nodeHeight / 2 })),
    edges: graph.edges().map(edge => ({ from: edge.v, to: edge.w, points: graph.edge(edge).points as Point[] })),
  };
}
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

export function GraphCanvas({ nodes, dispatches, selectedId, sendBacks, select, coordinator }: {
  coordinator?: { count?: number; usage: Usage; selected: boolean; select: () => void };
  nodes: GraphNode[]; dispatches: Dispatch[]; selectedId: string | null; sendBacks: Map<string, number>; select: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const marker = useId();
  const now = useClock();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Step events change labels, but only topology changes need a new layout.
  const topology = JSON.stringify(displayTopology(nodes));
  const positions = useMemo(() => arrange(JSON.parse(topology)), [topology]);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const related = relatedNodes(nodes.map(node => ({ ...node, dependencies: positions.edges.filter(edge => edge.to === node.id).map(edge => ({ type: byId.get(edge.from)!.type, id: edge.from })) })), hovered ?? focused);
  const fit = useCallback(() => {
    const element = viewport.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    setZoom(Math.max(.25, Math.min(1, Math.max(1, element.clientWidth - 48) / positions.width, Math.max(1, element.clientHeight - 48) / positions.height)));
    element.scrollLeft = 0; element.scrollTop = 0;
  }, [positions]);
  useEffect(() => {
    fit();
    if (typeof ResizeObserver === 'undefined' || !viewport.current) return;
    const observer = new ResizeObserver(fit);
    // Observe the panel, so scrollbars appearing during zoom do not reset it.
    observer.observe(viewport.current.parentElement!);
    return () => observer.disconnect();
  }, [fit]);
  const percent = new Intl.NumberFormat(language === 'zh' ? 'zh-CN' : 'en', { style: 'percent', maximumFractionDigits: 0 }).format(zoom);
  return <section className="cg-graph" aria-label={t('graphTitle')}>
    {coordinator && <button className={`cg-coordinator-node ${coordinator.selected ? 'selected' : ''}`} aria-label={t('tokenCoordinator')} aria-pressed={coordinator.selected} onClick={coordinator.select}>
      <span className="cg-node-name">{t('structureCoordinator')} · {coordinator.count ?? '—'} {t('structureRounds')}</span>
      <span className="cg-node-meta">Token {formatUsage(coordinator.usage, language)} · {t('tokenByRound')}</span>
    </button>}
    <div className="cg-canvas-wrap"><div className="cg-viewport" ref={viewport} tabIndex={0} aria-label={t('graphPanHelp')}
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
              const tone = [from.status, to.status].some(status => ['cancelled', 'withdrawn', 'skipped'].includes(status)) ? 'cut'
                : from.status === 'pending' ? 'att' : ['executing', 'verifying'].includes(to.status) ? 'flow' : ['completed', 'decided'].includes(from.status) ? '' : 'todo';
              return <path key={`${edge.from}:${edge.to}`} role="img" aria-label={`${t((from.type === 'gate' && from.kind === 'work-confirmation') || (to.type === 'gate' && to.kind === 'review') ? 'graphFlowLink' : 'graphDependency')}：${nodeTitle(from)} → ${nodeTitle(to)}`}
                className={`cg-edge ${tone} ${related && !(related.has(edge.from) && related.has(edge.to)) ? 'dim' : ''}`}
                d={edge.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')} markerEnd={`url(#${marker})`} />;
            })}
          </svg>
          {positions.nodes.map(({ id, x, y }) => {
            const node = byId.get(id)!;
            const ordinal = nodes.filter(item => item.type === 'card').findIndex(item => item.id === node.id) + 1;
            const name = node.type === 'card' ? `${t('graphCard')} ${ordinal}：${nodeTitle(node)}` : `${t('graphGate')}：${nodeTitle(node)}`;
            return <button key={node.id} className={`cg-node ${node.type} ${node.status} ${selectedId === node.id ? 'selected' : ''} ${related && !related.has(node.id) ? 'dim' : ''}`}
              style={{ left: x, top: y, width: nodeWidth, height: nodeHeight }} aria-label={name} title={[name, node.type === 'card' ? `${node.agentId ?? t('graphNoAgent')} · ${t('graphStep')} ${node.currentStep}\n${node.latestStepSummary ?? t('graphNoSteps')}` : gateDecision(node, t) || node.body].join('\n')} aria-pressed={selectedId === node.id}
              aria-describedby={`${marker}-${node.id}-state`}
              onClick={() => select(node.id)} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setFocused(node.id)} onBlur={() => setFocused(null)}>
              <span className="cg-node-name"><span className={`spark ${nodeRingTone[node.status] ?? ''}`} aria-hidden="true">✦</span><span>{node.type === 'card' && `${ordinal} · `}{nodeTitle(node)}</span></span>
              <span className="cg-node-state" id={`${marker}-${node.id}-state`}><NodeStatus node={node} />{node.type === 'card' && node.aggregate && <AggregateBadge />}
                {node.type === 'gate' && node.status === 'pending' && <time dateTime={node.createdAt}>{elapsed(node.createdAt, now)}</time>}
                {node.type === 'card' && node.status !== 'skipped' && <time>{elapsed(new Date(0).toISOString(), dispatchDuration(dispatches.filter(dispatch => dispatch.cardId === node.id), now))}</time>}
                {Boolean(sendBacks.get(node.id)) && <span className="cg-rework" aria-label={`${t('graphSendBacks')}: ${sendBacks.get(node.id)}`}>↺ {sendBacks.get(node.id)}</span>}
              </span>
              {node.type === 'card' && <span className="cg-node-meta">Token {formatUsage(node.usage, language)}</span>}
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
      {(['met', 'flow', 'todo', 'att', 'cut'] as const).map(tone => <span key={tone}><svg viewBox="0 0 22 6" aria-hidden="true"><path className={`cg-edge ${tone}`} d="M0 3 H22" /></svg>{t(({ met: 'graphLegendMet', flow: 'graphLegendFlow', todo: 'graphLegendWaiting', att: 'graphLegendAttention', cut: 'graphLegendCut' } as const)[tone])}</span>)}
      <span><span className="cg-skip-chip cg-skip-fill">{t('skipped')}</span>{t('graphLegendSkipped')}</span>
      <span><AggregateBadge />{t('graphLegendAggregate')}</span>
      <span><span className="cg-rework">↺</span>{t('graphSendBacks')}</span><span>{t('graphParallel')}</span>
    </div>
  </section>;
}
