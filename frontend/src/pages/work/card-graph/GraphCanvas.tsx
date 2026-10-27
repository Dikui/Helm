import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { graphlib, layout, type Point } from '@dagrejs/dagre';
import { useI18n } from '../../../shared/i18n.js';
import { gateDecision, nodeTitle, NodeStatus } from './labels.js';
import type { GraphNode } from './types.js';

const nodeWidth = 224;
const nodeHeight = 134;
function arrange(nodes: Pick<GraphNode, 'id' | 'dependencies'>[]) {
  const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: 32, ranksep: 60, marginx: 24, marginy: 24 });
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
const ringTone: Record<string, string> = { executing: 'run busy', verifying: 'run busy', completed: 'ok', decided: 'ok', pending: 'att', cancelled: 'cut', withdrawn: 'cut' };
export function GraphCanvas({ nodes, selectedId, sendBacks, select }: {
  nodes: GraphNode[]; selectedId: string | null; sendBacks: Map<string, number>; select: (id: string) => void;
}) {
  const { t, language } = useI18n();
  const marker = useId();
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  // Step events change labels, but only topology changes need a new layout.
  const topology = JSON.stringify(nodes.map(({ id, dependencies }) => ({ id, dependencies })));
  const positions = useMemo(() => arrange(JSON.parse(topology)), [topology]);
  const byId = new Map(nodes.map(node => [node.id, node]));
  const related = relatedNodes(nodes, hovered ?? focused);
  const fit = useCallback(() => {
    const element = viewport.current;
    if (!element?.clientWidth || !element.clientHeight) return;
    setZoom(Math.max(.25, Math.min(1, element.clientWidth / positions.width, element.clientHeight / positions.height)));
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
    <div className="cg-tools">
      <span className="muted">{t('graphParallel')}</span>
      <div className="row">
        <button className="btn sm" aria-label={t('graphZoomOut')} disabled={zoom <= .25} onClick={() => setZoom(value => Math.max(.25, value - .15))}>−</button>
        <output aria-label={t('graphZoom')} className="mono">{percent}</output>
        <button className="btn sm" aria-label={t('graphZoomIn')} disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + .15))}>＋</button>
        <button className="btn sm" onClick={fit}>{t('graphFit')}</button>
      </div>
    </div>
    <div className="cg-viewport" ref={viewport} tabIndex={0} aria-label={t('graphPanHelp')}
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
              const tone = [from.status, to.status].includes('cancelled') || from.status === 'withdrawn' ? 'cut'
                : from.status === 'pending' ? 'att' : ['executing', 'verifying'].includes(to.status) ? 'flow' : '';
              return <path key={`${edge.from}:${edge.to}`} role="img" aria-label={`${t('graphDependency')}：${nodeTitle(from)} → ${nodeTitle(to)}`}
                className={`cg-edge ${tone} ${related && !(related.has(edge.from) && related.has(edge.to)) ? 'dim' : ''}`}
                d={edge.points.map((point, index) => `${index ? 'L' : 'M'}${point.x},${point.y}`).join(' ')} markerEnd={`url(#${marker})`} />;
            })}
          </svg>
          {positions.nodes.map(({ id, x, y }) => {
            const node = byId.get(id)!;
            const ordinal = nodes.filter(item => item.type === 'card').findIndex(item => item.id === node.id) + 1;
            const name = node.type === 'card' ? `${t('graphCard')} ${ordinal}：${nodeTitle(node)}` : `${t('graphGate')}：${nodeTitle(node)}`;
            return <button key={node.id} className={`cg-node ${node.type} ${node.status} ${selectedId === node.id ? 'selected' : ''} ${related && !related.has(node.id) ? 'dim' : ''}`}
              style={{ left: x, top: y, width: nodeWidth, height: nodeHeight }} aria-label={name} title={nodeTitle(node)} aria-pressed={selectedId === node.id}
              aria-describedby={`${marker}-${node.id}-state ${marker}-${node.id}-summary${node.type === 'card' ? ` ${marker}-${node.id}-meta` : ''}`}
              onClick={() => select(node.id)} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} onFocus={() => setFocused(node.id)} onBlur={() => setFocused(null)}>
              <span className="cg-node-name"><span className={`spark ${ringTone[node.status] ?? ''}`} aria-hidden="true">{node.type === 'gate' ? '▲' : '✦'}</span>{node.type === 'card' && `${ordinal} · `}{nodeTitle(node)}</span>
              <span className="cg-node-state" id={`${marker}-${node.id}-state`}><NodeStatus node={node} />{Boolean(sendBacks.get(node.id)) && <span className="cg-rework" aria-label={`${t('graphSendBacks')}: ${sendBacks.get(node.id)}`}>↺ {sendBacks.get(node.id)}</span>}</span>
              {node.type === 'card' && <>
                <span className="cg-node-meta" id={`${marker}-${node.id}-meta`}>{node.agentId ?? t('graphNoAgent')}{node.currentStep > 0 && ` · ${t('graphStep')} ${node.currentStep}`}</span>
                <span className="cg-node-summary" id={`${marker}-${node.id}-summary`}>{node.latestStepSummary || t('graphNoSteps')}</span>
              </>}
              {node.type === 'gate' && <span className="cg-node-summary" id={`${marker}-${node.id}-summary`}>{gateDecision(node, t) || node.body}</span>}
            </button>;
          })}
        </div>
      </div>}
    </div>
    <p className="cg-legend">{t('graphLegend')}</p>
  </section>;
}
