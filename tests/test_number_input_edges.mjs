import assert from 'assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Contract test for the Jul-21 NUMBER-INPUT WIRING WALL fix
// (src/ai/tools.ts::allInputHandles/pickTargetHandle + the edge-acceptance
// checks in tools.ts::connect and agent.ts::validateAndResolveEdge).
//
// Drives the REAL tools.ts helpers and the REAL NODE_LIBRARY via the same
// strip-types resolve hook as test_ir_ref_coercion — the previous local
// mirrors of defaultSourceHandle/pickTargetHandle had drifted from source.
// Only acceptsHandle below remains a mirror: the acceptance rule is inline in
// connect()/validateAndResolveEdge and has no importable seam; it now at
// least reads the REAL library instead of a hand-copied one.
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

const { defaultSourceHandle, pickTargetHandle, allInputHandles } = await import('../src/ai/tools.ts');
const { NODE_LIBRARY } = await import('../src/nodes/NodeDefinitions.ts');

// Mirror of the shared edge-acceptance rule (post-fix), reading the REAL
// library: a targetHandle is valid iff it is "param:<numeric param>" OR any
// declared input handle.
function acceptsHandle(targetType, th) {
  const def = NODE_LIBRARY[targetType];
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

// ---- number-source auto-pick (omitted targetHandle), REAL pickTargetHandle --
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
// And the source-handle default that feeds pickTargetHandle is the real one.
assert.strictEqual(defaultSourceHandle('Series'), NODE_LIBRARY.Series.outputs[0].name);

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

console.log('test_number_input_edges: all contracts PASS (real tools.ts + real NODE_LIBRARY)');
