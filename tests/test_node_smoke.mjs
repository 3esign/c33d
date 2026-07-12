import assert from 'assert';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// C5: capability truth, not citations. Every node type the model is offered
// (NODE_LIBRARY -> condensedNodeLibrary -> system prompt) must have a real
// executor — "defined but not implemented" is exactly the class of capability
// lie that sent the stadium-transcript model chasing phantom node types.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const defs = readFileSync(join(root, 'src/nodes/NodeDefinitions.ts'), 'utf8');
const execs = readFileSync(join(root, 'src/worker/executors.ts'), 'utf8');
const worker = readFileSync(join(root, 'src/worker/geometryWorker.ts'), 'utf8');

const defTypes = [...defs.matchAll(/^\s{4}type: '([A-Za-z0-9]+)',$/gm)].map(m => m[1]);
assert.ok(defTypes.length > 60, `expected >60 node types in NODE_LIBRARY, found ${defTypes.length}`);

// Node types evaluated inline by the worker rather than via EXECUTORS
const inlineHandled = new Set(['NumberSlider', 'Expression', 'Series', 'Range', 'ListItem', 'ListLength', 'Macro']);

const missing = defTypes.filter(t =>
  !inlineHandled.has(t) &&
  !new RegExp(`^  ${t}: \\(`, 'm').test(execs)
);
assert.deepStrictEqual(missing, [], `node types WITHOUT an executor (capability lie): ${missing.join(', ')}`);

// Inline-handled types really are handled inline
for (const t of ['Series', 'Range', 'ListItem', 'ListLength']) {
  assert.ok(new RegExp(`node\\.type === '${t}'`).test(worker), `worker handles ${t} inline`);
}

// The bridge wave is present end to end (definition + executor)
for (const t of ['ExtrudeCurve', 'LoftCurves', 'SweepAlongCurve', 'RevolveCurve', 'InstanceOnPoints', 'TransformCurve', 'OffsetCurve']) {
  assert.ok(defTypes.includes(t), `${t} defined`);
  assert.ok(new RegExp(`^  ${t}: \\(`, 'm').test(execs), `${t} implemented`);
}

console.log(`test_node_smoke: ${defTypes.length} node types, all implemented (${missing.length} missing)`);

// ---------- Derivation metrics logic (replica of verification.ts) ----------
const MATH_TYPES = new Set(['NumberSlider', 'Expression', 'Series', 'Range', 'ListItem', 'ListLength', 'group']);
function derivationRatio(nodes, edges) {
  const geo = nodes.filter(n => !MATH_TYPES.has(n.type));
  const valueEdges = edges.filter(e => !String(e.targetHandle || '').startsWith('param:'));
  const withInput = new Set(valueEdges.map(e => e.target));
  return geo.length ? geo.filter(n => withInput.has(n.id)).length / geo.length : 0;
}

// Primitive collage: 4 disconnected primitives -> ratio 0
const collage = { nodes: [{ id: 'a', type: 'Box' }, { id: 'b', type: 'Sphere' }, { id: 'c', type: 'Cylinder' }, { id: 'd', type: 'Torus' }], edges: [] };
assert.strictEqual(derivationRatio(collage.nodes, collage.edges), 0);

// Derivation chain: ellipse -> transform -> loft; ellipse -> divide -> instance
const chain = {
  nodes: [
    { id: 'ell', type: 'EllipseCurve' }, { id: 'tr', type: 'TransformCurve' },
    { id: 'loft', type: 'LoftCurves' }, { id: 'div', type: 'DivideCurve' },
    { id: 'col', type: 'Cylinder' }, { id: 'inst', type: 'InstanceOnPoints' },
  ],
  edges: [
    { source: 'ell', target: 'tr', targetHandle: 'curve' },
    { source: 'ell', target: 'loft', targetHandle: 'curve1' },
    { source: 'tr', target: 'loft', targetHandle: 'curve2' },
    { source: 'ell', target: 'div', targetHandle: 'curve' },
    { source: 'div', target: 'inst', targetHandle: 'points' },
    { source: 'col', target: 'inst', targetHandle: 'shape' },
  ],
};
const r = derivationRatio(chain.nodes, chain.edges);
assert.ok(r >= 0.6, `derivation chain ratio ${r} should be >= 0.6`);

console.log('test_node_smoke: derivation-metric logic assertions passed');
