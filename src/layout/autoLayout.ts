// Deterministic layered (Sugiyama-lite) auto-layout for the node graph.
// The AI no longer emits positions; topology in, clean left-to-right layout out.

import { NODE_LIBRARY } from '../nodes/NodeDefinitions';

interface LayoutNode { id: string; position: { x: number; y: number }; parentId?: string; [k: string]: any }
interface LayoutEdge { id: string; source: string; target: string; [k: string]: any }

const COL_WIDTH = 230;
const MIN_ROW_HEIGHT = 190;
const ROW_GAP = 40;
const MARGIN_X = 40;
const MARGIN_Y = 40;

// Estimate a node's rendered height from its definition: header + handle rows
// + one row per parameter (number params render label + slider + field, the
// tallest kind). A fixed 190px row height made param-heavy nodes (NumberSlider
// is ~300px tall) overlap their column neighbours. Deterministic on purpose.
function estimateNodeHeight(node: LayoutNode): number {
  const def = NODE_LIBRARY[(node as any).type as string];
  if (!def) return MIN_ROW_HEIGHT;
  const numberParams = def.params.filter(p => p.type === 'number').length;
  const otherParams = def.params.length - numberParams;
  return 54 + def.inputs.length * 28 + def.outputs.length * 28 + numberParams * 48 + otherParams * 40;
}

export function autoLayout<N extends LayoutNode, E extends LayoutEdge>(nodes: N[], edges: E[]): N[] {
  if (nodes.length === 0) return nodes;

  // Ignore group containers for ranking; lay out all non-group nodes globally.
  const layoutable = nodes.filter(n => (n as any).type !== 'group' && !n.parentId);
  const ids = new Set(layoutable.map(n => n.id));
  const validEdges = edges.filter(e => ids.has(e.source) && ids.has(e.target));

  // Longest-path ranking from sources
  const rank: Record<string, number> = {};
  const inEdges: Record<string, string[]> = {};
  const outEdges: Record<string, string[]> = {};
  layoutable.forEach(n => { rank[n.id] = 0; inEdges[n.id] = []; outEdges[n.id] = []; });
  validEdges.forEach(e => { inEdges[e.target].push(e.source); outEdges[e.source].push(e.target); });

  // Kahn topological order
  const indeg: Record<string, number> = {};
  layoutable.forEach(n => { indeg[n.id] = inEdges[n.id].length; });
  const queue = layoutable.filter(n => indeg[n.id] === 0).map(n => n.id);
  const topo: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    topo.push(id);
    for (const t of outEdges[id]) {
      rank[t] = Math.max(rank[t], rank[id] + 1);
      if (--indeg[t] === 0) queue.push(t);
    }
  }
  // Cycle fallback: any node not in topo keeps rank 0
  // Group by rank
  const columns: Record<number, string[]> = {};
  layoutable.forEach(n => {
    const r = rank[n.id] || 0;
    (columns[r] = columns[r] || []).push(n.id);
  });

  // Order within column by average predecessor row (barycenter), then stable by id
  const row: Record<string, number> = {};
  const sortedRanks = Object.keys(columns).map(Number).sort((a, b) => a - b);
  for (const r of sortedRanks) {
    const col = columns[r];
    const scored = col.map(id => {
      const preds = inEdges[id].filter(p => row[p] !== undefined);
      const bary = preds.length ? preds.reduce((s, p) => s + row[p], 0) / preds.length : Number.MAX_SAFE_INTEGER;
      return { id, bary };
    });
    scored.sort((a, b) => a.bary - b.bary || a.id.localeCompare(b.id));
    scored.forEach((s, i) => { row[s.id] = i; });
  }

  // Row pitch per rank: the tallest node in a column sets that column's
  // vertical spacing, so tall (param-heavy) nodes never overlap.
  const rowHeightByRank: Record<number, number> = {};
  const heightById = new Map(layoutable.map(n => [n.id, estimateNodeHeight(n)]));
  layoutable.forEach(n => {
    const r = rank[n.id] || 0;
    rowHeightByRank[r] = Math.max(
      rowHeightByRank[r] || MIN_ROW_HEIGHT,
      (heightById.get(n.id) || MIN_ROW_HEIGHT) + ROW_GAP
    );
  });

  const positioned: Record<string, { x: number; y: number }> = {};
  layoutable.forEach(n => {
    const r = rank[n.id] || 0;
    positioned[n.id] = {
      x: MARGIN_X + r * COL_WIDTH,
      y: MARGIN_Y + (row[n.id] || 0) * rowHeightByRank[r],
    };
  });

  return nodes.map(n => positioned[n.id] ? { ...n, position: positioned[n.id] } : n);
}
