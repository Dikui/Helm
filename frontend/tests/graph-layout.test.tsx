import { expect, test } from 'vitest';
import { arrange, initialGraphView, nodeHeight, nodeWidth } from '../src/pages/work/card-graph/graph-layout.js';

const nodes = [{ id: 'confirm', dependencies: [] }, ...Array.from({ length: 9 }, (_, index) => ({ id: `card-${index}`, dependencies: [{ id: 'confirm', type: 'gate' as const }] })),
  { id: 'join', dependencies: Array.from({ length: 9 }, (_, index) => ({ id: `card-${index}`, type: 'card' as const })) }];

test.each([290, 506, 980])('依赖图在 %d px 内纵向排布，保留全部节点和依赖，不重叠', width => {
  const before = JSON.stringify(nodes);
  const result = arrange(nodes, width);
  expect(result.width).toBeLessThanOrEqual(width);
  expect(new Set(result.nodes.map(node => node.id))).toEqual(new Set(nodes.map(node => node.id)));
  expect(result.edges).toHaveLength(18);
  for (const node of result.nodes) {
    expect(node.x).toBeGreaterThanOrEqual(0);
    expect(node.x + nodeWidth).toBeLessThanOrEqual(result.width);
    expect(node.y + nodeHeight).toBeLessThanOrEqual(result.height);
    for (const other of result.nodes) if (node !== other) expect(node.x + nodeWidth <= other.x || other.x + nodeWidth <= node.x || node.y + nodeHeight <= other.y || other.y + nodeHeight <= node.y).toBe(true);
  }
  for (const edge of result.edges) {
    expect(nodes.find(node => node.id === edge.to)?.dependencies.some(dependency => dependency.id === edge.from)).toBe(true);
    const from = result.nodes.find(node => node.id === edge.from)!;
    const to = result.nodes.find(node => node.id === edge.to)!;
    expect(from.y + nodeHeight).toBeLessThan(to.y);
  }
  expect(JSON.stringify(nodes)).toBe(before);
});

test('初始视野适应整图，超长图不低于可读缩放并在两轴居中', () => {
  expect(initialGraphView({ width: 400, height: 300 }, 500, 450)).toEqual({ zoom: 1, left: 0, top: 0 });
  const view = initialGraphView({ width: 1200, height: 1600 }, 500, 400);
  expect(view.zoom).toBe(.85);
  expect(view.left).toBe((1200 * view.zoom - 500) / 2);
  expect(view.top).toBe((1600 * view.zoom - 400) / 2);
  expect(arrange([], 500).nodes).toEqual([]);
});
