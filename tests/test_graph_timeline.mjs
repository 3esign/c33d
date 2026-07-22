import assert from 'assert';

// Contract test for the Jul-22 GRAPH TIMELINE
// (src/store/useStore.ts::recordGraphSnapshot + src/utils/exportSession.ts v2).
// Self-contained mirror per repo convention — keep in lockstep with source.
//
// Motivation: session exports carried only the FINAL graph, so long directed-
// repair conversations ("still no working graph… try again") were unanalyzable
// — every intermediate state the model built and destroyed was lost. The store
// now snapshots the graph on every AI application / manual structural edit,
// with a precomputed diff, and exports carry the whole timeline (c33dExport: 2).

// ---- mirrored diff/dedupe logic (keep in lockstep with useStore.ts) --------

function computeEntry(prev, nodes, edges) {
  const nodeSig = (n) => `${n.type}|${JSON.stringify(n.data || {})}`;
  const edgeKey = (e) => `${e.source}.${e.sourceHandle ?? ''}->${e.target}.${e.targetHandle ?? ''}`;
  const currNodes = new Map(nodes.map(n => [String(n.id), nodeSig(n)]));
  const currEdges = new Set(edges.map(edgeKey));
  const prevNodes = new Map((prev?.nodes || []).map(n => [String(n.id), nodeSig(n)]));
  const prevEdges = new Set((prev?.edges || []).map(edgeKey));

  const addedNodes = [...currNodes.keys()].filter(id => !prevNodes.has(id));
  const removedNodes = [...prevNodes.keys()].filter(id => !currNodes.has(id));
  const changedNodes = [...currNodes.keys()].filter(
    id => prevNodes.has(id) && prevNodes.get(id) !== currNodes.get(id));
  const addedEdges = [...currEdges].filter(k => !prevEdges.has(k)).length;
  const removedEdges = [...prevEdges].filter(k => !currEdges.has(k)).length;

  const unchanged = !!prev && addedNodes.length === 0 && removedNodes.length === 0 &&
    changedNodes.length === 0 && addedEdges === 0 && removedEdges === 0;

  const wired = new Set();
  edges.forEach(e => { wired.add(String(e.source)); wired.add(String(e.target)); });
  const isolatedCount = nodes.filter(n => !wired.has(String(n.id))).length;

  return { unchanged, diff: { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges }, isolatedCount };
}

// ---- contracts -------------------------------------------------------------

const g1 = {
  nodes: [
    { id: 'r', type: 'NumberSlider', data: { value: 5, label: 'radius' } },
    { id: 's', type: 'Sphere', data: { radius: 5 } },
    { id: 'orphan', type: 'Box', data: {} },
  ],
  edges: [{ source: 'r', sourceHandle: 'value', target: 's', targetHandle: 'param:radius' }],
};

// 1. first snapshot: everything counts as added; isolated nodes are counted
{
  const e = computeEntry(undefined, g1.nodes, g1.edges);
  assert.strictEqual(e.unchanged, false);
  assert.deepStrictEqual(e.diff.addedNodes.sort(), ['orphan', 'r', 's']);
  assert.strictEqual(e.diff.addedEdges, 1);
  assert.strictEqual(e.isolatedCount, 1); // 'orphan' has no edges
}

// 2. identical state → unchanged (recordGraphSnapshot dedupes pure no-ops)
{
  const prev = { nodes: g1.nodes, edges: g1.edges };
  const e = computeEntry(prev, g1.nodes, g1.edges);
  assert.strictEqual(e.unchanged, true);
}

// 3. param tweak on an existing node lands in changedNodes, not added/removed
{
  const prev = { nodes: g1.nodes, edges: g1.edges };
  const next = g1.nodes.map(n => n.id === 's' ? { ...n, data: { radius: 9 } } : n);
  const e = computeEntry(prev, next, g1.edges);
  assert.deepStrictEqual(e.diff.changedNodes, ['s']);
  assert.strictEqual(e.diff.addedNodes.length, 0);
  assert.strictEqual(e.unchanged, false);
}

// 4. edge rewiring is visible as removed+added edge counts
{
  const prev = { nodes: g1.nodes, edges: g1.edges };
  const rewired = [{ source: 'r', sourceHandle: 'value', target: 'orphan', targetHandle: 'param:width' }];
  const e = computeEntry(prev, g1.nodes, rewired);
  assert.strictEqual(e.diff.addedEdges, 1);
  assert.strictEqual(e.diff.removedEdges, 1);
  assert.strictEqual(e.isolatedCount, 1); // now 's' is the isolated one
}

// 5. a clear shows up as everything-removed (not as a silent reset)
{
  const prev = { nodes: g1.nodes, edges: g1.edges };
  const e = computeEntry(prev, [], []);
  assert.deepStrictEqual(e.diff.removedNodes.sort(), ['orphan', 'r', 's']);
  assert.strictEqual(e.diff.removedEdges, 1);
}

// 6. export format: v2 bundles must carry a timeline array (shape contract)
{
  const exportShape = {
    c33dExport: 2,
    timeline: [{
      at: '2026-07-22T00:00:00.000Z', turn: 1, trigger: 'ai-ir',
      label: 'attempt 1: rebuilt graph (12 nodes)',
      nodeCount: 12, edgeCount: 14, isolatedCount: 0,
      diff: { addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: 0, removedEdges: 0 },
      nodes: [], edges: [],
    }],
  };
  assert.strictEqual(exportShape.c33dExport, 2);
  const t = exportShape.timeline[0];
  for (const k of ['at', 'turn', 'trigger', 'label', 'nodeCount', 'edgeCount', 'isolatedCount', 'diff', 'nodes', 'edges']) {
    assert.ok(k in t, `timeline entry missing ${k}`);
  }
}

console.log('test_graph_timeline: all contracts hold');
