// Regression contracts for the SPEC-6/SPEC-7 numeric fixes — REAL modules
// (src/utils/expression.ts + src/worker/executors.ts), no replicas.
//
// Pins the audit's "silent wrong geometry" cluster:
//   - expression precedence (-2^2 === -4) and loud failure on div-by-zero /
//     malformed numerics / non-finite results (SPEC-7),
//   - num() semantics: 0 is a legal param value (LinearPattern directionX=0
//     used to become 15 via `|| 15` — a phantom X drift),
//   - clampCount() ceilings with a warn,
//   - Plane centering (drawRectangle is already centered — no double offset),
//   - Boolean operation aliases + loud unknown-op / missing-target errors.

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';

// Setup node module resolution compatibility
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';
import { evaluateExpression } from '../src/utils/expression.ts';
import { EXECUTORS, num, clampCount } from '../src/worker/executors.ts';

let checks = 0;
const ok = (label, cond, extra) => {
  assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`);
  checks++;
};
const eq = (label, actual, expected) => {
  assert.strictEqual(actual, expected, `${label} — got ${actual}, expected ${expected}`);
  checks++;
};
const throws = (label, fn, msgRe) => {
  try {
    fn();
  } catch (err) {
    if (msgRe) ok(label, msgRe.test(String(err.message)), `message was: ${err.message}`);
    else { checks++; }
    return;
  }
  assert.fail(`${label} — expected a throw, got none`);
};

// ---------------------------------------------------------------------------
// 1. Expression semantics (SPEC-7) — pure JS, no kernel needed
// ---------------------------------------------------------------------------
eq('-2^2 === -4 (unary minus applies to the power result)', evaluateExpression('-2^2', {}), -4);
eq('2^-3 === 0.125 (unary allowed in the exponent)', evaluateExpression('2^-3', {}), 0.125);
eq('2^3^2 stays right-associative', evaluateExpression('2^3^2', {}), 512);
eq('3--2 === 5 (unary after binary still works)', evaluateExpression('3--2', {}), 5);

throws('division by zero throws', () => evaluateExpression('1/0', {}), /division by zero/);
throws('modulo by zero throws', () => evaluateExpression('5%0', {}), /division by zero/);
throws('mod(5,0) throws', () => evaluateExpression('mod(5,0)', {}), /division by zero/);
throws("malformed numeric '1.2.3' throws", () => evaluateExpression('1.2.3', {}), /malformed number/);
throws('non-finite result throws (log(0))', () => evaluateExpression('log(0)', {}), /not a finite number/);
throws('non-finite variable names itself', () => evaluateExpression('x*2', { x: NaN }), /variable 'x' is not a finite number/);
throws('clamp arity is checked', () => evaluateExpression('clamp(1,2)', {}), /expects at least 3/);
throws('min() with no args is rejected', () => evaluateExpression('min()', {}), /expects at least 1/);

eq('mod(7,3) === 1', evaluateExpression('mod(7,3)', {}), 1);
eq('cbrt(27) === 3', evaluateExpression('cbrt(27)', {}), 3);
eq('sign(-5) === -1', evaluateExpression('sign(-5)', {}), -1);
eq('trunc(3.9) === 3', evaluateExpression('trunc(3.9)', {}), 3);
eq('log2(8) === 3', evaluateExpression('log2(8)', {}), 3);
eq('log10(1000) === 3', evaluateExpression('log10(1000)', {}), 3);
eq('sinh(0) === 0', evaluateExpression('sinh(0)', {}), 0);
eq('cosh(0) === 1', evaluateExpression('cosh(0)', {}), 1);
eq('tanh(0) === 0', evaluateExpression('tanh(0)', {}), 0);
ok('tau === 2*pi', Math.abs(evaluateExpression('tau', {}) - 2 * Math.PI) < 1e-12);

// ---------------------------------------------------------------------------
// 2. num() / clampCount() semantics — the `|| default` idiom killers
// ---------------------------------------------------------------------------
eq('num(0, 15) keeps 0', num(0, 15), 0);
eq("num('0', 15) keeps 0", num('0', 15), 0);
eq('num(undefined, 15) falls back', num(undefined, 15), 15);
eq("num('abc', 7) falls back", num('abc', 7), 7);
eq('num(-3, 1) keeps negatives', num(-3, 1), -3);

{
  const warns = [];
  const warn = (m) => warns.push(m);
  eq('clampCount passes sane counts through', clampCount(3, 2000, warn, 'X'), 3);
  eq('clampCount caps runaway counts', clampCount(5000, 2000, warn, 'X'), 2000);
  ok('clampCount announced the clamp', warns.some((m) => /clamped to 2000/.test(m)), warns.join(' | '));
  eq('clampCount floors at 1', clampCount(0, 2000, warn, 'X'), 1);
  eq('clampCount treats NaN as 1', clampCount('abc', 2000, warn, 'X'), 1);
  eq('clampCount rounds fractional counts', clampCount(2.6, 2000, warn, 'X'), 3);
}

// ---------------------------------------------------------------------------
// 3. Executor-level regressions (real kernel)
// ---------------------------------------------------------------------------
async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const warn = (msg) => console.log('WARN:', msg);

  console.log('=== LinearPattern: directionX 0 stays 0 ===');
  const box = replicad.makeBox([-5, -5, -5], [5, 5, 5]);
  const inputs = [{ targetHandle: 'solid', value: box }];
  const pattern = EXECUTORS.LinearPattern(
    { count: 2, directionX: 0, directionY: 0, directionZ: 10 },
    inputs,
    warn
  );
  const [mn, mx] = pattern.boundingBox.bounds;
  const sizeX = mx[0] - mn[0];
  const sizeZ = mx[2] - mn[2];
  ok(`no phantom X drift (x extent ${sizeX.toFixed(2)}, was 25 with the || 15 bug)`, Math.abs(sizeX - 10) < 0.5);
  ok(`pattern actually stacked along Z (z extent ${sizeZ.toFixed(2)})`, Math.abs(sizeZ - 20) < 0.5);

  console.log('=== Plane: centered on the origin ===');
  const plane = EXECUTORS.Plane({ width: 10, length: 10 });
  const pc = plane.boundingBox.center;
  ok(
    `plane center ≈ origin (got [${pc[0].toFixed(3)}, ${pc[1].toFixed(3)}])`,
    Math.abs(pc[0]) < 1e-6 && Math.abs(pc[1]) < 1e-6
  );

  console.log('=== Boolean: aliases + loud failures ===');
  const target = replicad.makeBox([-5, -5, -5], [5, 5, 5]);
  const tool = replicad.makeBox([0, -6, -6], [6, 6, 6]);
  const boolInputs = [
    { targetHandle: 'target', value: target },
    { targetHandle: 'tool', value: tool },
  ];
  const cut = EXECUTORS.Boolean({ operation: 'subtract' }, boolInputs, warn);
  const cutVol = replicad.measureVolume(cut);
  ok(`"subtract" aliases to difference (volume ${cutVol.toFixed(1)} ≈ 500)`, Math.abs(cutVol - 500) < 1.0);

  throws(
    'unknown Boolean operation throws with the valid list',
    () => EXECUTORS.Boolean({ operation: 'explode' }, boolInputs, warn),
    /unknown operation .*union, difference, intersect/
  );
  throws(
    'difference with a missing target throws (never returns the tool)',
    () => EXECUTORS.Boolean({ operation: 'difference' }, [{ targetHandle: 'tool', value: tool }], warn),
    /requires a "target"/
  );

  console.log(`\ntest_executor_regressions: all ${checks} contracts PASS`);
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
