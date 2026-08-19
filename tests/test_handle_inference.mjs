import assert from 'assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Regression tests for the July 2026 wiring/schema fixes that ended the
// "clean the graph / still not correct" spiral in the circle→pipe→spheres log.
//
// The source-handle contract drives the REAL src/ai/tools.ts (and through it
// the real NODE_LIBRARY) via the same strip-types resolve hook as
// test_ir_ref_coercion — the previous local replica of defaultSourceHandle had
// already drifted from source (it checked the number-alias before the
// single-output rule; the shipped code checks the declared output first).
//
// The parameter-synonym half below still mirrors the agent.ts fragment
// (validateAndNormalizeNodeData's else-branch): that function lives mid-file
// in the agent loop and has no importable seam yet.

// ---- resolve hook: let Node follow the app's extensionless .ts imports ------
const hookDir = mkdtempSync(join(tmpdir(), 'c33d-ts-'));
const hookPath = join(hookDir, 'ts-resolve.mjs');
writeFileSync(hookPath, `
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) {
    for (const ext of ['.ts', '.tsx']) {
      try {
        const r = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(r))) return { url: r.href, shortCircuit: true };
      } catch { /* fall through */ }
    }
  }
  return nextResolve(specifier, context);
}
`);
register(pathToFileURL(hookPath));

// tools.ts pulls in agent.ts → useStore.ts, which touch browser globals at
// module scope. Stub just enough for the module graph to load under Node.
globalThis.Worker = class {
  postMessage() {}
  terminate() {}
  addEventListener() {}
  removeEventListener() {}
};
globalThis.localStorage = globalThis.localStorage ?? {
  getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0,
};

const { defaultSourceHandle } = await import('../src/ai/tools.ts');
const { NODE_LIBRARY } = await import('../src/nodes/NodeDefinitions.ts');

// ---- Contract 2 mirror: parameter synonym / benign-drop resolution ----------
// (src/ai/agent.ts::validateAndNormalizeNodeData else-branch — keep in
// lockstep with source; uses the REAL NODE_LIBRARY for the param lists.)
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

console.log('Source-handle inference (REAL defaultSourceHandle + NODE_LIBRARY):');
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
check('multi-output node falls back to solid', () => {
  // Pick a genuinely multi-output decomposition node from the REAL library so
  // this contract cannot silently rot if outputs change.
  const multi = Object.entries(NODE_LIBRARY).find(([, def]) => (def.outputs?.length ?? 0) > 1);
  assert.ok(multi, 'library should contain at least one multi-output node');
  assert.strictEqual(defaultSourceHandle(multi[0]), 'solid');
});
check('unknown type falls back to solid', () => assert.strictEqual(defaultSourceHandle('Nonexistent'), 'solid'));

// The whole reason this matters: the divide->instance edge now resolves to a
// real, type-compatible handle instead of an invalid 'solid' that gets dropped.
check('DivideCurve.points is type-compatible with InstanceOnPoints.points input', () => {
  const sh = defaultSourceHandle('DivideCurve');
  const outType = NODE_LIBRARY.DivideCurve.outputs.find(o => o.name === sh).type;
  const inType = NODE_LIBRARY.InstanceOnPoints.inputs.find(i => i.name === 'points').type;
  assert.strictEqual(outType, inType);
});

console.log('Parameter synonym / benign-drop resolution (mirror, real param lists):');
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
