import assert from 'assert';

// Contract test for the Jul-20 S2 type-aware targetHandle inference
// (src/ai/tools.ts::pickTargetHandle). Self-contained mirror per repo
// convention.
//
// With geometric sockets on primitives (center:Point, axis:Vector),
// "first unconnected input in declaration order" is wrong: a VectorXYZ wired
// into a Cone must land on "axis", not "center"; a Point into Translate must
// land on "target", not "solid".

const NODE_LIBRARY = {
  Point: { inputs: [], outputs: [{ name: 'point', type: 'Point' }] },
  VectorXYZ: { inputs: [], outputs: [{ name: 'vector', type: 'Vector' }] },
  Centroid: { inputs: [{ name: 'solid', type: 'Solid' }], outputs: [{ name: 'centroid', type: 'Point' }] },
  NumberSlider: { inputs: [], outputs: [{ name: 'value', type: 'number' }] },
  Sphere: { inputs: [{ name: 'center', type: 'Point' }], outputs: [{ name: 'solid', type: 'Solid' }] },
  Cone: {
    inputs: [{ name: 'center', type: 'Point' }, { name: 'axis', type: 'Vector' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
  },
  Rotate: {
    inputs: [{ name: 'solid', type: 'Solid' }, { name: 'pivot', type: 'Point' }, { name: 'axis', type: 'Vector' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
  },
  Translate: {
    inputs: [{ name: 'solid', type: 'Solid' }, { name: 'target', type: 'Point' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
  },
  Boolean: {
    inputs: [{ name: 'target', type: 'Solid' }, { name: 'tool', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
  },
};
const NUMBER_OUTPUT_TYPES = new Set(['NumberSlider', 'Expression', 'Series', 'Range', 'ListItem', 'ListLength']);

function defaultSourceHandle(sourceType) {
  const def = sourceType ? NODE_LIBRARY[sourceType] : undefined;
  if (def && def.outputs.length === 1) return def.outputs[0].name;
  if (sourceType && NUMBER_OUTPUT_TYPES.has(sourceType)) return 'value';
  return 'solid';
}

function pickTargetHandle(sourceType, sourceHandle, targetType, takenHandles) {
  const targetDef = NODE_LIBRARY[targetType];
  if (!targetDef || targetType === 'Macro') return undefined;
  const srcDef = sourceType ? NODE_LIBRARY[sourceType] : undefined;
  const shName = sourceHandle || defaultSourceHandle(sourceType);
  const srcOutType = srcDef?.outputs.find(o => o.name === shName)?.type;
  if (!srcOutType || srcOutType === 'number') return undefined;
  const typedHandles = targetDef.inputs.filter(i => i.type === srcOutType).map(i => i.name);
  if (typedHandles.length === 0) return null;
  return typedHandles.find(h => !takenHandles.has(h)) ?? undefined;
}

const none = new Set();

// Point → Sphere lands on "center".
assert.strictEqual(pickTargetHandle('Point', undefined, 'Sphere', none), 'center');
// Vector → Cone lands on "axis" (NOT "center", the first declared input).
assert.strictEqual(pickTargetHandle('VectorXYZ', undefined, 'Cone', none), 'axis');
// Point → Cone lands on "center".
assert.strictEqual(pickTargetHandle('Point', undefined, 'Cone', none), 'center');
// Centroid (Point output) → Translate lands on "target", not "solid".
assert.strictEqual(pickTargetHandle('Centroid', undefined, 'Translate', none), 'target');
// Solid → Rotate lands on "solid" even though pivot/axis exist.
assert.strictEqual(pickTargetHandle('Sphere', undefined, 'Rotate', none), 'solid');
// Point → Rotate lands on "pivot".
assert.strictEqual(pickTargetHandle('Point', undefined, 'Rotate', none), 'pivot');
// Second Solid → Boolean fills "tool" once "target" is taken.
assert.strictEqual(pickTargetHandle('Sphere', undefined, 'Boolean', new Set(['target'])), 'tool');
// Solid → Sphere: KNOWN mismatch → null (honest rejection, not silent nonsense).
assert.strictEqual(pickTargetHandle('Sphere', undefined, 'Sphere', none), null);
// Number source → undefined (legacy fallback path decides).
assert.strictEqual(pickTargetHandle('NumberSlider', undefined, 'Sphere', none), undefined);
// Unknown source type → undefined (legacy fallback).
assert.strictEqual(pickTargetHandle('Macro', undefined, 'Sphere', none), undefined);
// All typed matches taken → undefined (legacy replace semantics decide).
assert.strictEqual(pickTargetHandle('Point', undefined, 'Sphere', new Set(['center'])), undefined);

console.log('test_typed_handle_inference: all 11 contracts PASS');
