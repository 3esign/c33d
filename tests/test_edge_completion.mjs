import assert from 'assert';

// Contract test for the Jul-21 edge-completion work
// (src/ai/graphValidation.ts::inferMissingEdges + the PointsFromLists/orphan
// structural checks). Self-contained mirror per repo convention — keep in
// lockstep with the source rules.
//
// Motivation: the Jul-21 transcripts showed models emit a full generative
// subsystem (angles → coord Expression → PointsFromLists → InstanceOnPoints)
// but omit the dataflow EDGES, leaving it a disconnected island that collapses
// to nothing. inferMissingEdges reconnects the unambiguous links; it only ever
// fills EMPTY handles, and only when a single source is unambiguous.

const SEQUENCE_TYPES = new Set(['Series', 'Range']);
const LIST_PRODUCER_TYPES = new Set(['Series', 'Range', 'ListConstant', 'RepeatEach', 'Tile']);
const NUMBER_PRODUCER_TYPES = new Set(['Expression', 'ListItem', 'ListLength', 'NumberSlider']);
const defaultNumberOut = (type) => (LIST_PRODUCER_TYPES.has(type) ? 'values' : 'value');

function idParts(id) {
  const m = /^([a-zA-Z]+?)_?(\d+)(?:[_-].*)?$/.exec(id);
  return m ? { role: m[1].toLowerCase(), group: m[2] } : null;
}
const groupOf = (id) => (idParts(id) ? idParts(id).group : null);
const peersInGroup = (nodes, selfId, group) => nodes.filter(n => n.id !== selfId && groupOf(n.id) === group);
function referencedVars(formula) {
  const out = [];
  for (const v of ['a', 'b', 'c', 'd']) {
    if (new RegExp(`(^|[^a-zA-Z0-9_])${v}([^a-zA-Z0-9_]|$)`).test(formula)) out.push(v);
  }
  return out;
}

function inferMissingEdges(nodes, edges) {
  const inferred = [];
  const occupied = (target, handle) =>
    edges.some(e => e.target === target && String(e.targetHandle ?? '') === handle) ||
    inferred.some(e => e.target === target && e.targetHandle === handle);
  const add = (src, target, handle, reason) => {
    if (src.id === target || occupied(target, handle)) return;
    inferred.push({ id: `${src.id}__to__${target}__${handle}`, source: src.id, sourceHandle: defaultNumberOut(src.type), target, targetHandle: handle, reason });
  };
  const allSequences = nodes.filter(p => SEQUENCE_TYPES.has(p.type));
  const bareRole = (id) => {
    const m = /^([a-z]+)/.exec(id.startsWith('$') ? id.slice(1) : id);
    return m ? m[1] : null;
  };
  for (const n of nodes) {
    if (n.type !== 'Expression') continue;
    const g = groupOf(n.id);
    let seq;
    if (g) {
      const seqs = peersInGroup(nodes, n.id, g).filter(p => SEQUENCE_TYPES.has(p.type));
      if (seqs.length === 1) seq = seqs[0];
    }
    if (!seq && allSequences.length === 1 && allSequences[0].id !== n.id) seq = allSequences[0]; // A2
    if (!seq) continue;
    for (const v of referencedVars(String((n.data && n.data.formula) ?? ''))) add(seq, n.id, v, 'ruleA');
  }
  const allPfl = nodes.filter(p => p.type === 'PointsFromLists');
  for (const n of nodes) {
    if (n.type !== 'PointsFromLists') continue;
    const g = groupOf(n.id);
    for (const ch of ['x', 'y', 'z', 'scale']) {
      if (occupied(n.id, ch)) continue;
      let src;
      if (g) {
        const matches = peersInGroup(nodes, n.id, g).filter(p => idParts(p.id)?.role === ch && (LIST_PRODUCER_TYPES.has(p.type) || NUMBER_PRODUCER_TYPES.has(p.type)));
        if (matches.length === 1) src = matches[0];
      }
      if (!src && allPfl.length === 1) {
        const matches = nodes.filter(p => p.id !== n.id && bareRole(p.id) === ch && (LIST_PRODUCER_TYPES.has(p.type) || NUMBER_PRODUCER_TYPES.has(p.type)));
        if (matches.length === 1) src = matches[0]; // B2
      }
      if (!src) continue;
      add(src, n.id, ch, 'ruleB');
    }
  }
  return inferred;
}

const has = (list, source, target, handle) => list.some(e => e.source === source && e.target === target && e.targetHandle === handle);

// --- idParts ---------------------------------------------------------------
assert.deepStrictEqual(idParts('x1_expr'), { role: 'x', group: '1' });
assert.deepStrictEqual(idParts('angles1'), { role: 'angles', group: '1' });
assert.deepStrictEqual(idParts('scale1_expr'), { role: 'scale', group: '1' });
assert.deepStrictEqual(idParts('points2'), { role: 'points', group: '2' });
assert.strictEqual(idParts('spire'), null); // no group number → never guessed across

// --- the megapolis ring island reconnects ---------------------------------
const ring = {
  nodes: [
    { id: 'angles1', type: 'Series', data: {} },
    { id: 'x1_expr', type: 'Expression', data: { formula: '(r*0.3)*cos(a)' } },
    { id: 'y1_expr', type: 'Expression', data: { formula: '(r*0.3)*sin(a)' } },
    { id: 'scale1_expr', type: 'Expression', data: { formula: '1 + 0.2*sin(a*3)' } },
    { id: 'points1', type: 'PointsFromLists', data: {} },
    { id: 'jitter1', type: 'Jitter', data: {} },
    { id: 'shapeA', type: 'Box', data: {} },
    { id: 'buildings1', type: 'InstanceOnPoints', data: {} },
  ],
  edges: [
    { source: 'points1', target: 'jitter1', targetHandle: 'points' },
    { source: 'jitter1', target: 'buildings1', targetHandle: 'points' },
    { source: 'shapeA', target: 'buildings1', targetHandle: 'shape' },
  ],
};
const got = inferMissingEdges(ring.nodes, ring.edges);
// Rule A: the one Series feeds every Expression's 'a'.
assert.ok(has(got, 'angles1', 'x1_expr', 'a'), 'angles1 → x1_expr:a');
assert.ok(has(got, 'angles1', 'y1_expr', 'a'), 'angles1 → y1_expr:a');
assert.ok(has(got, 'angles1', 'scale1_expr', 'a'), 'angles1 → scale1_expr:a');
// Rule B: role-matched siblings feed the point channels.
assert.ok(has(got, 'x1_expr', 'points1', 'x'), 'x1_expr → points1:x');
assert.ok(has(got, 'y1_expr', 'points1', 'y'), 'y1_expr → points1:y');
assert.ok(has(got, 'scale1_expr', 'points1', 'scale'), 'scale1_expr → points1:scale');
// No z sibling exists → z stays unwired (PointsFromLists defaults z=0). No over-wiring.
assert.ok(!got.some(e => e.target === 'points1' && e.targetHandle === 'z'), 'no phantom z wire');
// Source handles are correct (Series→values, Expression→value).
assert.strictEqual(got.find(e => e.target === 'x1_expr').sourceHandle, 'values');
assert.strictEqual(got.find(e => e.target === 'points1' && e.targetHandle === 'x').sourceHandle, 'value');

// --- only EMPTY handles are filled (never overrides explicit wiring) -------
const preWired = {
  nodes: ring.nodes,
  edges: [...ring.edges, { source: 'someOtherList', target: 'x1_expr', targetHandle: 'a' }],
};
assert.ok(!inferMissingEdges(preWired.nodes, preWired.edges).some(e => e.target === 'x1_expr' && e.targetHandle === 'a'),
  'does not re-wire an already-connected a handle');

// --- ambiguity is refused (two sequences in a group → no Rule A guess) -----
const ambiguous = {
  nodes: [
    { id: 'angles1', type: 'Series', data: {} },
    { id: 'radii1', type: 'Range', data: {} },
    { id: 'x1_expr', type: 'Expression', data: { formula: 'a*cos(b)' } },
  ],
  edges: [],
};
assert.strictEqual(inferMissingEdges(ambiguous.nodes, ambiguous.edges).length, 0, 'two sequences in group → no guess');

// --- A2: bare ids + a UNIQUE sequence graph-wide ARE wired ------------------
// (Jul-21 update: the simple-task graphs — t, x, y, z, radii, pts — used no
// group numbers at all; with one Series in the whole graph there is nothing to
// disambiguate, so refusing to wire was pure loss.)
const bare = {
  nodes: [
    { id: 't', type: 'Series', data: {} },
    { id: 'x', type: 'Expression', data: { formula: 'curveLength * a' } },
    { id: 'y', type: 'Expression', data: { formula: 'sin(a * 6.283)' } },
    { id: 'radii', type: 'Expression', data: { formula: 'lerp(1, 2, abs(sin(a)))' } },
    { id: 'pts', type: 'PointsFromLists', data: {} },
  ],
  edges: [],
};
const bareGot = inferMissingEdges(bare.nodes, bare.edges);
assert.ok(has(bareGot, 't', 'x', 'a'), 't → x:a (A2 unique sequence graph-wide)');
assert.ok(has(bareGot, 't', 'y', 'a'), 't → y:a');
assert.ok(has(bareGot, 't', 'radii', 'a'), 't → radii:a');
// B2: unique PointsFromLists + role-named producers wire by bare role.
assert.ok(has(bareGot, 'x', 'pts', 'x'), 'x → pts:x (B2)');
assert.ok(has(bareGot, 'y', 'pts', 'y'), 'y → pts:y (B2)');
assert.ok(!bareGot.some(e => e.target === 'pts' && e.targetHandle === 'scale'), 'radii does not guess into scale');

// --- A2 refuses when TWO sequences exist graph-wide and none share a group --
const twoSeqs = {
  nodes: [
    { id: 'angles', type: 'Series', data: {} },
    { id: 'steps', type: 'Range', data: {} },
    { id: 'xExpr', type: 'Expression', data: { formula: 'cos(a)' } },
  ],
  edges: [],
};
assert.strictEqual(inferMissingEdges(twoSeqs.nodes, twoSeqs.edges).length, 0, 'two graph-wide sequences → no guess');

// --- B2 camel/underscore roles resolve (xCoords → x, y_vals → y) ------------
const camel = {
  nodes: [
    { id: 'angles', type: 'Series', data: {} },
    { id: 'xCoords', type: 'Expression', data: { formula: 'cos(a)' } },
    { id: 'y_vals', type: 'Expression', data: { formula: 'sin(a)' } },
    { id: 'points', type: 'PointsFromLists', data: {} },
  ],
  edges: [],
};
const camelGot = inferMissingEdges(camel.nodes, camel.edges);
assert.ok(has(camelGot, 'xCoords', 'points', 'x'), 'xCoords → points:x');
assert.ok(has(camelGot, 'y_vals', 'points', 'y'), 'y_vals → points:y');

// --- structural predicates (mirror of the 2b / 2c checks) ------------------
const pointsHasNoCoord = (node, edges) => {
  if (node.type !== 'PointsFromLists') return false;
  const handles = new Set(edges.filter(e => e.target === node.id).map(e => String(e.targetHandle ?? '')));
  return !['x', 'y', 'z', 'scale'].some(h => handles.has(h));
};
assert.ok(pointsHasNoCoord({ id: 'points1', type: 'PointsFromLists' }, []), 'bare PointsFromLists flagged');
assert.ok(!pointsHasNoCoord({ id: 'points1', type: 'PointsFromLists' }, [{ source: 'x1_expr', target: 'points1', targetHandle: 'x' }]), 'wired PointsFromLists ok');

const isOrphanCompute = (node, edges) =>
  (NUMBER_PRODUCER_TYPES.has(node.type) || LIST_PRODUCER_TYPES.has(node.type)) &&
  node.type !== 'NumberSlider' &&
  !edges.some(e => e.source === node.id);
assert.ok(isOrphanCompute({ id: 'angles1', type: 'Series' }, []), 'orphan Series flagged');
assert.ok(!isOrphanCompute({ id: 'angles1', type: 'Series' }, [{ source: 'angles1', target: 'x1_expr', targetHandle: 'a' }]), 'consumed Series ok');
assert.ok(!isOrphanCompute({ id: 'w', type: 'NumberSlider' }, []), 'dead sliders handled elsewhere, not here');

console.log('test_edge_completion: all contracts PASS');
