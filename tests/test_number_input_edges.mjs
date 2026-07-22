import assert from 'assert';

// Contract test for the Jul-21 NUMBER-INPUT WIRING WALL fix
// (src/ai/tools.ts::allInputHandles/pickTargetHandle + the edge-acceptance
// checks in tools.ts::connect and agent.ts::validateAndResolveEdge).
// Self-contained mirror per repo convention — keep in lockstep with source.
//
// Motivation (12 exports, Jul 21 evening): models emitted semantically correct
// list-layer wiring — Series→Expression:a, Expression→PointsFromLists:x/y/z/
// scale — and BOTH AI edge paths rejected every such edge, because acceptance
// was validated against geoInputHandles() which EXCLUDES number-typed inputs.
// Meanwhile validateGraphStructure demanded exactly those edges. The system
// asked for an edge it refused to accept; simple tasks (divide a curve, place
// spheres with random radii) became unsolvable regardless of model quality.
// The IR compiler's own correct edges were stripped by the same whitelist on
// the apply path.

// Minimal NODE_LIBRARY extract (keep in lockstep with NodeDefinitions.ts).
const LIB = {
  Expression: {
    inputs: [
      { name: 'a', type: 'number' }, { name: 'b', type: 'number' },
      { name: 'c', type: 'number' }, { name: 'd', type: 'number' },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    params: [{ name: 'formula', type: 'string' }],
  },
  Series: {
    inputs: [
      { name: 'start', type: 'number' }, { name: 'step', type: 'number' },
      { name: 'count', type: 'number' },
    ],
    outputs: [{ name: 'values', type: 'number' }],
    params: [],
  },
  PointsFromLists: {
    inputs: [
      { name: 'x', type: 'number' }, { name: 'y', type: 'number' },
      { name: 'z', type: 'number' }, { name: 'scale', type: 'number' },
      { name: 'group', type: 'number' },
    ],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [],
  },
  SplineCurve: {
    inputs: [{ name: 'points', type: 'Point' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [],
  },
  Pipe: {
    inputs: [{ name: 'path', type: 'Curve' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [{ name: 'radius', type: 'number' }],
  },
  PointOnCurve: {
    inputs: [{ name: 'curve', type: 'Curve' }, { name: 't', type: 'number' }],
    outputs: [{ name: 'point', type: 'Point' }],
    params: [],
  },
};

// ---- mirrors of the handle helpers ----------------------------------------
const allInputHandles = (t) => (LIB[t] ? LIB[t].inputs.map(i => i.name) : []);
const defaultSourceHandle = (t) => (LIB[t] && LIB[t].outputs.length === 1 ? LIB[t].outputs[0].name : 'solid');

function pickTargetHandle(sourceType, sourceHandle, targetType, taken) {
  const targetDef = LIB[targetType];
  if (!targetDef || targetType === 'Macro') return undefined;
  const srcDef = sourceType ? LIB[sourceType] : undefined;
  const shName = sourceHandle || defaultSourceHandle(sourceType);
  const srcOutType = srcDef?.outputs.find(o => o.name === shName)?.type;
  if (!srcOutType) return undefined;
  if (srcOutType === 'number') {
    const numHandles = targetDef.inputs.filter(i => i.type === 'number').map(i => i.name);
    if (numHandles.length === 0) return undefined;
    return numHandles.find(h => !taken.has(h)) ?? undefined;
  }
  const typedHandles = targetDef.inputs.filter(i => i.type === srcOutType).map(i => i.name);
  if (typedHandles.length === 0) return null;
  return typedHandles.find(h => !taken.has(h)) ?? undefined;
}

// Mirror of the shared edge-acceptance rule (post-fix): a targetHandle is
// valid iff it is "param:<numeric param>" OR any declared input handle.
function acceptsHandle(targetType, th) {
  const def = LIB[targetType];
  if (!def) return true;
  if (th.startsWith('param:')) {
    const p = th.slice(6);
    return def.params.some(pp => pp.name === p && pp.type === 'number');
  }
  return allInputHandles(targetType).includes(th);
}

// ---- the wall is down ------------------------------------------------------
// Every edge of the canonical simple-task graph must be accepted.
assert.ok(acceptsHandle('Expression', 'a'), 'Series→Expression:a accepted');
assert.ok(acceptsHandle('Expression', 'b'), 'Expression:b accepted');
assert.ok(acceptsHandle('PointsFromLists', 'x'), 'PointsFromLists:x accepted');
assert.ok(acceptsHandle('PointsFromLists', 'y'), 'PointsFromLists:y accepted');
assert.ok(acceptsHandle('PointsFromLists', 'z'), 'PointsFromLists:z accepted');
assert.ok(acceptsHandle('PointsFromLists', 'scale'), 'PointsFromLists:scale accepted');
assert.ok(acceptsHandle('Series', 'count'), 'slider→Series:count accepted');
assert.ok(acceptsHandle('PointOnCurve', 't'), 'Expression→PointOnCurve:t accepted');

// Geometry handles unchanged.
assert.ok(acceptsHandle('SplineCurve', 'points'), 'PFL→SplineCurve:points accepted');
assert.ok(acceptsHandle('Pipe', 'path'), 'curve→Pipe:path accepted');

// Nonsense is still rejected — the whitelist is declared inputs, not "anything".
assert.ok(!acceptsHandle('Expression', 'solid'), 'Expression:solid still rejected');
assert.ok(!acceptsHandle('PointsFromLists', 'w'), 'PFL:w still rejected');
assert.ok(!acceptsHandle('Expression', 'param:a'), 'param:a is NOT a numeric param of Expression');
assert.ok(acceptsHandle('Pipe', 'param:radius'), 'param:radius on Pipe still works');

// ---- number-source auto-pick (omitted targetHandle) ------------------------
// Series→Expression with no targetHandle lands on 'a' (first free number input).
assert.strictEqual(pickTargetHandle('Series', undefined, 'Expression', new Set()), 'a');
// With 'a' taken, the next free is 'b'.
assert.strictEqual(pickTargetHandle('Series', undefined, 'Expression', new Set(['a'])), 'b');
// Expression→PointsFromLists omitted lands on 'x', then 'y'.
assert.strictEqual(pickTargetHandle('Expression', undefined, 'PointsFromLists', new Set()), 'x');
assert.strictEqual(pickTargetHandle('Expression', undefined, 'PointsFromLists', new Set(['x'])), 'y');
// A number source into a target with NO number inputs falls back to legacy
// (undefined), it does not invent a geometry handle.
assert.strictEqual(pickTargetHandle('Expression', undefined, 'SplineCurve', new Set()), undefined);
// Typed geometry matching is unchanged: PFL points → SplineCurve:points.
assert.strictEqual(pickTargetHandle('PointsFromLists', undefined, 'SplineCurve', new Set()), 'points');
// Known geometry mismatch still honestly rejects (null).
assert.strictEqual(pickTargetHandle('Pipe', undefined, 'PointsFromLists', new Set()), null);

// ---- the deadlock scenario end-to-end (glm-5.2 divide-curve export) --------
// 12 nodes, 12 intended edges; pre-fix the 8 number-input edges were dropped
// and the 4 geometry edges survived — exactly the exported graph. Post-fix all
// 12 must be accepted.
const intended = [
  ['t', 'values', 'x', 'a'], ['t', 'values', 'y', 'a'],
  ['t', 'values', 'z', 'a'], ['t', 'values', 'radii', 'a'],
  ['x', 'value', 'pts', 'x'], ['y', 'value', 'pts', 'y'],
  ['z', 'value', 'pts', 'z'], ['radii', 'value', 'pts', 'scale'],
  ['pts', 'points', 'curve', 'points'], ['curve', 'curve', 'pipe', 'path'],
  ['sphere', 'solid', 'spheres', 'shape'], ['pts', 'points', 'spheres', 'points'],
];
const typeOf = { t: 'Series', x: 'Expression', y: 'Expression', z: 'Expression', radii: 'Expression', pts: 'PointsFromLists', curve: 'SplineCurve', pipe: 'Pipe' };
let accepted = 0;
for (const [, , target, th] of intended) {
  const tt = typeOf[target];
  if (!tt || acceptsHandle(tt, th)) accepted++;
}
assert.strictEqual(accepted, intended.length, `all ${intended.length} intended edges accepted (got ${accepted})`);

console.log('test_number_input_edges: all contracts PASS');
