import assert from 'assert';

// Contract test for the Jul-20 S1 placement-provenance probe
// (src/worker/geometryWorker.ts::computePlacementProvenance).
//
// Motivation: the Jul-20 spaceship export placed all 9 leaves with literal
// Translate offsets — zero Align, zero derived placement — and the geometry
// report stayed silent. Rule 5 ("placement: RELATIVE, never arithmetic") was
// unmeasured prose. This test pins the classifier's contract; the repo's tests
// are self-contained (no TS loader), so the implementation is mirrored here.

const ANCHORED_PLACEMENT_TYPES = new Set([
  'Align', 'PlaceOnSurface', 'PlaceOnVertices', 'ScatterOnSurface',
  'InstanceOnPoints', 'LinearPattern', 'CircularPattern', 'Mirror',
  'ExtrudeCurve', 'LoftCurves', 'SweepAlongCurve', 'RevolveCurve', 'Pipe',
  'Loft',
]);
const GEO_SOCKET_HANDLES = new Set(['center', 'pivot', 'target', 'axis']);

function computePlacementProvenance(nodeList, edgeList, leafIds) {
  const byId = {};
  nodeList.forEach(n => { byId[n.id] = n; });
  const incoming = {};
  edgeList.forEach(e => { (incoming[e.target] = incoming[e.target] || []).push(e); });
  const nonZero = (v) => {
    if (v === undefined || v === null || v === '' || v === false) return false;
    const n = parseFloat(v);
    if (typeof v === 'string' && String(n) !== v.trim()) return true;
    return isFinite(n) && Math.abs(n) > 1e-9;
  };
  const anchored = [], literal = [], origin = [];
  const literalNodes = new Set();
  for (const leafId of leafIds) {
    const seen = new Set();
    const stack = [leafId];
    let isAnchored = false;
    const leafLiterals = [];
    while (stack.length > 0) {
      const id = stack.pop();
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId[id];
      if (!n) continue;
      const ins = (incoming[id] || []).filter(e => !String(e.targetHandle || '').startsWith('param:'));
      if (ANCHORED_PLACEMENT_TYPES.has(n.type)) isAnchored = true;
      if (ins.some(e => GEO_SOCKET_HANDLES.has(String(e.targetHandle || '')))) isAnchored = true;
      if (n.type === 'Translate' && !ins.some(e => String(e.targetHandle || '') === 'target')) {
        const d = n.data || {};
        if (nonZero(d.x) || nonZero(d.y) || nonZero(d.z)) leafLiterals.push(id);
      }
      for (const e of ins) stack.push(String(e.source));
    }
    if (isAnchored) anchored.push(leafId);
    else if (leafLiterals.length > 0) { literal.push(leafId); leafLiterals.forEach(id => literalNodes.add(id)); }
    else origin.push(leafId);
  }
  const placed = anchored.length + literal.length;
  return { anchored, literal, origin, literalNodeIds: [...literalNodes], ratio: placed > 0 ? anchored.length / placed : 1 };
}

// ---- Case 1: the Jul-20 spaceship pattern (primitive→Rotate→Translate with
// formula offsets) must classify as LITERAL — this is the graph the probe was
// built to catch.
{
  const nodes = [
    { id: 'wing', type: 'Box', data: { width: 'L*0.38' } },
    { id: 'wingRot', type: 'Rotate', data: { angle: 12 } },
    { id: 'wingPos', type: 'Translate', data: { x: '-L*0.05', y: 'W*0.6', z: '-W*0.08' } },
    { id: 'eng', type: 'Cylinder', data: {} },
    { id: 'engX', type: 'Rotate', data: { angle: 90 } },
    { id: 'engR', type: 'Translate', data: { x: '-L*0.36', y: 'W*0.3', z: '-W*0.1' } },
  ];
  const edges = [
    { source: 'wing', target: 'wingRot', targetHandle: 'solid' },
    { source: 'wingRot', target: 'wingPos', targetHandle: 'solid' },
    { source: 'eng', target: 'engX', targetHandle: 'solid' },
    { source: 'engX', target: 'engR', targetHandle: 'solid' },
  ];
  const r = computePlacementProvenance(nodes, edges, ['wingPos', 'engR']);
  assert.deepStrictEqual(r.anchored, [], 'spaceship pattern: nothing is anchored');
  assert.deepStrictEqual(r.literal.sort(), ['engR', 'wingPos'], 'both leaves literal');
  assert.strictEqual(r.ratio, 0, 'ratio 0 — the report must fire');
  assert.ok(r.literalNodeIds.includes('wingPos') && r.literalNodeIds.includes('engR'));
}

// ---- Case 2: Align anywhere in the leaf subgraph → anchored (even with a
// nudge Translate downstream, which rule 5 explicitly allows).
{
  const nodes = [
    { id: 'base', type: 'Box', data: {} },
    { id: 'top', type: 'Cylinder', data: {} },
    { id: 'stack', type: 'Align', data: { mode: 'above' } },
    { id: 'nudge', type: 'Translate', data: { x: 0, y: 0, z: 'h*0.02' } },
  ];
  const edges = [
    { source: 'top', target: 'stack', targetHandle: 'shape' },
    { source: 'base', target: 'stack', targetHandle: 'reference' },
    { source: 'stack', target: 'nudge', targetHandle: 'solid' },
  ];
  const r = computePlacementProvenance(nodes, edges, ['nudge']);
  assert.deepStrictEqual(r.anchored, ['nudge'], 'Align in subgraph → anchored');
  assert.strictEqual(r.ratio, 1);
}

// ---- Case 3: S2 geometric sockets — a Point wired into a primitive's
// "center" (or Rotate "pivot" / Translate "target") → anchored.
{
  const nodes = [
    { id: 'anchor', type: 'Centroid', data: {} },
    { id: 'body', type: 'Box', data: {} },
    { id: 'orb', type: 'Sphere', data: {} },
  ];
  const edges = [
    { source: 'body', target: 'anchor', targetHandle: 'solid' },
    { source: 'anchor', target: 'orb', targetHandle: 'center' },
  ];
  const r = computePlacementProvenance(nodes, edges, ['orb', 'body']);
  assert.deepStrictEqual(r.anchored, ['orb'], 'center socket → anchored');
  assert.deepStrictEqual(r.origin, ['body'], 'unplaced part → origin, not literal');
}

// ---- Case 4: curve-driven placement (DivideCurve→InstanceOnPoints) → anchored.
{
  const nodes = [
    { id: 'rim', type: 'CircleCurve', data: { radius: 10 } },
    { id: 'pts', type: 'DivideCurve', data: { count: 8 } },
    { id: 'post', type: 'Cylinder', data: {} },
    { id: 'posts', type: 'InstanceOnPoints', data: {} },
  ];
  const edges = [
    { source: 'rim', target: 'pts', targetHandle: 'curve' },
    { source: 'post', target: 'posts', targetHandle: 'shape' },
    { source: 'pts', target: 'posts', targetHandle: 'points' },
  ];
  const r = computePlacementProvenance(nodes, edges, ['posts']);
  assert.deepStrictEqual(r.anchored, ['posts'], 'instancer → anchored');
}

// ---- Case 5: zero-offset Translate (all zeros / empty) is NOT literal;
// param: edges are ignored in the walk.
{
  const nodes = [
    { id: 'a', type: 'Box', data: {} },
    { id: 't', type: 'Translate', data: { x: 0, y: '0', z: '' } },
    { id: 's', type: 'NumberSlider', data: { value: 5 } },
  ];
  const edges = [
    { source: 'a', target: 't', targetHandle: 'solid' },
    { source: 's', target: 't', targetHandle: 'param:x' },
  ];
  const r = computePlacementProvenance(nodes, edges, ['t']);
  assert.deepStrictEqual(r.origin, ['t'], 'zero offsets → origin');
  assert.strictEqual(r.ratio, 1, 'no placed leaves → ratio 1 (no false alarm)');
}

console.log('test_placement_provenance: all 5 contracts PASS');
