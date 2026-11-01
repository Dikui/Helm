import { graphlib, layout } from '@dagrejs/dagre';
import type { GraphNode } from './types.js';

export const nodeWidth = 148;
export const nodeHeight = 48;
const gap = 20;
const rowGap = 36;
const margin = 12;

export function arrange(nodes: Pick<GraphNode, 'id' | 'dependencies'>[], availableWidth: number) {
  const graph = new graphlib.Graph().setGraph({ rankdir: 'TB', nodesep: gap, ranksep: rowGap, marginx: margin, marginy: margin });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const node of nodes) graph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
  for (const node of nodes) for (const dependency of node.dependencies) {
    if (graph.hasNode(dependency.id)) graph.setEdge(dependency.id, node.id);
  }
  layout(graph);
  let width = Math.max(1, graph.graph().width ?? 1);
  let height = Math.max(1, graph.graph().height ?? 1);
  const positions = nodes.map(node => ({ id: node.id, x: graph.node(node.id).x - nodeWidth / 2, y: graph.node(node.id).y - nodeHeight / 2 }));
  if (width > availableWidth) {
    // Wrap wide dependency levels into vertical bands; display order never adds dependencies.
    const columns = Math.max(1, Math.min(3, Math.floor((availableWidth - 2 * margin + gap) / (nodeWidth + gap))));
    width = columns * nodeWidth + (columns - 1) * gap + 2 * margin;
    const levels = [...new Set(positions.map(node => node.y))].sort((a, b) => a - b)
      .map(level => positions.filter(node => node.y === level).sort((a, b) => a.x - b.x));
    let row = 0;
    for (const members of levels) {
      for (let start = 0; start < members.length; start += columns) {
        const batch = members.slice(start, start + columns);
        const offset = (width - batch.length * nodeWidth - (batch.length - 1) * gap) / 2;
        batch.forEach((node, index) => { node.x = offset + index * (nodeWidth + gap); node.y = margin + row * (nodeHeight + rowGap); });
        row++;
      }
    }
    height = row ? 2 * margin + row * (nodeHeight + rowGap) - rowGap : 1;
  }
  const byId = new Map(positions.map(node => [node.id, node]));
  return { width, height, nodes: positions, edges: graph.edges().map(edge => {
    const from = byId.get(edge.v)!; const to = byId.get(edge.w)!;
    const start = { x: from.x + nodeWidth / 2, y: from.y + nodeHeight };
    const end = { x: to.x + nodeWidth / 2, y: to.y };
    const middle = (start.y + end.y) / 2;
    return { from: edge.v, to: edge.w, points: [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end] };
  }) };
}

export function initialGraphView(size: { width: number; height: number }, width: number, height: number) {
  const zoom = Math.max(.85, Math.min(1, width / size.width, height / size.height));
  return { zoom, left: Math.max(0, (size.width * zoom - width) / 2), top: Math.max(0, (size.height * zoom - height) / 2) };
}
