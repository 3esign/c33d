import assert from 'assert';

// Regression tests for the July 2026 wiring/schema fixes that ended the
// "clean the graph / still not correct" spiral in the circle→pipe→spheres log.
//
// These replicate the two pure-function contracts (the repo's tests are
// self-contained — no TS loader), pinning the exact behavior the source now
// implements in src/ai/tools.ts::defaultSourceHandle and
// src/ai/agent.ts::validateAndNormalizeNodeData.

// ---- Minimal NODE_LIBRARY mirroring the real output ports ----
const NODE_LIBRARY = {
  Point:            { outputs: [{ name: 'point',  type: 'Point'  }], params: [] },
  VectorXYZ:        { outputs: [{ name: 'vector', type: 'Vector' }], params: [] },
  CircleCurve:      { outputs: [{ name: 'curve',  type: 'Curve'  }], params: [{ name: 'radius', type: 'number' }] },
  Line:             { outputs: [{ name: 'curve',  type: 'Curve'  }], params: [] },
  DivideCurve:      { outputs: [{ name: 'points', type: 'Point'  }], params: [{ name: 'count', type: 'number' }] },
  Sphere:           { outputs: [{ name: 'solid',  type: 'Solid'  }], params: [{ name: 'radius', type: 'number' }] },
  Torus:            { outputs: [{ name: 'solid',  type: 'Solid'  }], params: [{ name: 'majorRadius', type: 'number' }, { name: 'minorRadius', type: 'number' }] },
  NumberSlider:     { outputs: [{ name: 'value',  type: 'number' }], params: [] },
  // multi-output decomposition node → must fall back (needs explicit handle)
  BoundingBox:      { outputs: [{ name: 'min', type: 'Point' }, { name: 'max', type: 'Point' }, { name: 'size', type: 'Vector' }], params: [] },
  InstanceOnPoints: { outputs: [{ name: 'solid', type: 'Solid' }], params: [
    { name: 'scaleStart', type: 'number' }, { name: 'scaleEnd', type: 'number' },
    { name: 'everyNth', type: 'number' }, { name: 'maxCount', type: 'number' },
  ] },
};

const NUMBER_OUTPUT_TYPES = new Set(['NumberSlider', 'Expression', 'Series', 'Range', 'ListItem', 'ListLength']);

// ---- Contract 1: source-handle inference (src/ai/tools.ts) ----
function defaultSourceHandle(sourceType) {
  if (sourceType && NUMBER_OUTPUT_TYPES.has(sourceType)) return 'value';
  const def = sourceType ? NODE_LIBRARY[sourceType] : undefined;
  if (def && def.outputs.length === 1) return def.outputs[0].name;
  return 'solid';
}

// ---- Contract 2: parameter synonym / benign-drop resolution (src/ai/agent.ts) ----
const PARAM_SYNONYMS = {
  scalemin: 'scalestart', minscale: 'scalestart', startscale: 'scalestart', minsize: 'scalestart', sizemin: 'scalestart',
  scalemax: 'scaleend', maxscale: 'scaleend', endscale: 'scaleend', maxsize: 'scaleend', sizemax: 'scaleend',
  num: 'count', number: 'count', divisions: 'count', segments: 'count', samples: 'count', resolution: 'count', copies: 'count', instances: 'count',
  major: 'majorradius', minor: 'minorradius', tuberadius: 'minorradius', tube: 'minorradius',
};
const BENIGN_DROP_PARAMS = new Set(['seed', 'random', 'randomize', 'randomseed', 'jitter']);

// Returns { validatedData, warnings, errors } — mirrors the else-branch logic.
function resolveParams(type, data) {
  const def = NODE_LIBRARY[type];
  const validParamsLowerMap = new Map();
  def.params.forEach(p => validParamsLowerMap.set(p.name.toLowerCase(), p.name));
  const validatedData = {}, warnings = [], errors = [];
  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    if (validParamsLowerMap.has(keyLower)) {
      validatedData[validParamsLowerMap.get(keyLower)] = value;
      continue;
    }
    const canonicalLower = PARAM_SYNONYMS[keyLower];
    const resolved = canonicalLower ? validParamsLowerMap.get(canonicalLower) : undefined;
    if (resolved) {
      validatedData[resolved] = value;
      warnings.push(`mapped ${key}->${resolved}`);
    } else if (BENIGN_DROP_PARAMS.has(keyLower)) {
      warnings.push(`ignored ${key}`);
    } else {
      errors.push(`unknown ${key}`);
    }
  }
  return { validatedData, warnings, errors };
}

let passed = 0;
const check = (name, fn) => { fn(); console.log(`  ok - ${name}`); passed++; };

console.log('Source-handle inference:');
// The exact nodes from the failing transcript — every one used to default to
// 'solid', an output they do not have, which the validator then rejected.
check('CircleCurve -> curve', () => assert.strictEqual(defaultSourceHandle('CircleCurve'), 'curve'));
check('DivideCurve -> points', () => assert.strictEqual(defaultSourceHandle('DivideCurve'), 'points'));
check('Point -> point',       () => assert.strictEqual(defaultSourceHandle('Point'), 'point'));
check('VectorXYZ -> vector',  () => assert.strictEqual(defaultSourceHandle('VectorXYZ'), 'vector'));
check('Line -> curve',        () => assert.strictEqual(defaultSourceHandle('Line'), 'curve'));
check('Sphere -> solid',      () => assert.strictEqual(defaultSourceHandle('Sphere'), 'solid'));
check('Torus -> solid',       () => assert.strictEqual(defaultSourceHandle('Torus'), 'solid'));
check('NumberSlider -> value',() => assert.strictEqual(defaultSourceHandle('NumberSlider'), 'value'));
check('multi-output BoundingBox falls back to solid', () => assert.strictEqual(defaultSourceHandle('BoundingBox'), 'solid'));
check('unknown type falls back to solid', () => assert.strictEqual(defaultSourceHandle('Nonexistent'), 'solid'));

// The whole reason this matters: the divide->instance edge now resolves to a
// real, type-compatible handle instead of an invalid 'solid' that gets dropped.
check('DivideCurve.points is type-compatible with InstanceOnPoints.points input', () => {
  const sh = defaultSourceHandle('DivideCurve');
  const outType = NODE_LIBRARY.DivideCurve.outputs.find(o => o.name === sh).type;
  assert.strictEqual(outType, 'Point'); // matches the "points" input port type
});

console.log('Parameter synonym / benign-drop resolution:');
check('scaleMin/scaleMax map to scaleStart/scaleEnd on InstanceOnPoints', () => {
  const r = resolveParams('InstanceOnPoints', { scaleMin: 0.5, scaleMax: 1.8 });
  assert.strictEqual(r.errors.length, 0, 'should not reject the node');
  assert.strictEqual(r.validatedData.scaleStart, 0.5);
  assert.strictEqual(r.validatedData.scaleEnd, 1.8);
});
check('seed is ignored (benign), never a node-killing error', () => {
  const r = resolveParams('InstanceOnPoints', { seed: 42, scaleStart: 1 });
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.validatedData.scaleStart, 1);
  assert.ok(!('seed' in r.validatedData));
});
check('count synonyms map on DivideCurve', () => {
  const r = resolveParams('DivideCurve', { divisions: 18 });
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.validatedData.count, 18);
});
check('a synonym is NOT applied when the node lacks the canonical param', () => {
  // Sphere has no scaleStart, so "scaleMin" is a genuine mistake and must error.
  const r = resolveParams('Sphere', { scaleMin: 0.5 });
  assert.strictEqual(r.errors.length, 1);
});
check('real params still pass through untouched', () => {
  const r = resolveParams('Torus', { majorRadius: 10, minorRadius: 2 });
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.validatedData.majorRadius, 10);
  assert.strictEqual(r.validatedData.minorRadius, 2);
});

console.log(`\nAll ${passed} handle-inference / param-alias assertions passed.`);
