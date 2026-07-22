import assert from 'assert';

// Contract test for the Jul-22 IR ERGONOMIC COERCIONS
// (src/ai/ir/compile.ts::makeCtx — liftInlineOp / resolveFormula / bare-name
// coercion in numOpt/refOpt/list). Self-contained mirror per repo convention —
// keep in lockstep with source.
//
// Motivation (Jul-22 exports, qwen3.5 building session — 40 compile-error
// system messages in ONE conversation): models repeatedly emitted four forms
// the compiler hard-rejected, then burned every repair attempt on syntax
// instead of design:
//   1. inline op literals:      points: {"op":"points","args":{...}}
//   2. arithmetic on refs:      start: "$podiumH+0.5"
//   3. bare {x,y,z} literals:   pivot: {"x":0,"y":0,"z":0}
//   4. bare binding names:      center: "plinthCenter"   (no "$")
// plus formulas naming COMPUTED bindings ("plinthH + chamberH*0.5"), which
// compiled fine but died at runtime with "unknown slider".
// The compiler now lifts/coerces all five deterministically, with a note
// teaching the canonical form. Honest failures remain for genuinely unknown
// ops/bindings.

// ---- mirrored decision logic (keep in lockstep with compile.ts) ------------

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const KNOWN_FUNCS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'min', 'max', 'floor', 'ceil', 'round', 'trunc',
  'pow', 'exp', 'log', 'log2', 'log10', 'mod', 'clamp', 'random',
  'pi', 'PI', 'e', 'E', 'tau', 'TAU',
]);

// env: Map<name, {type, slider}> — mirrors bindings; slider=true for params.
function classifyRefArg(raw, env, acceptsPointOrVector) {
  // mirrors refOpt precedence: $ref > inline-op object > {x,y,z} literal >
  // bare binding name > hard fail
  if (typeof raw === 'string' && raw.startsWith('$')) return 'ref';
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof raw.op === 'string') return 'lift-inline-op';
  if (raw && typeof raw === 'object' && !Array.isArray(raw) &&
      ('x' in raw || 'y' in raw || 'z' in raw) && acceptsPointOrVector) return 'lift-xyz-literal';
  if (typeof raw === 'string' && env.has(raw)) return 'coerce-bare-name';
  return 'fail';
}

function classifyNumFormula(formulaRaw, env) {
  // mirrors resolveFormula: strip "$", find identifier tokens, then:
  //  - non-number binding named        → fail
  //  - only sliders/unknowns/functions → inline formula
  //  - ≤ free letters computed bindings → auto-wire via expr()
  //  - more                            → fail (split into expr steps)
  const formula = formulaRaw.replace(/\$/g, '');
  const ids = [...new Set([...formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0]))];
  const nonSlider = [];
  for (const t of ids) {
    if (KNOWN_FUNCS.has(t)) continue;
    const r = env.get(t);
    if (!r) continue;
    if (r.type !== 'number' && r.type !== 'number[]') return 'fail-non-number';
    if (!r.slider) nonSlider.push(t);
  }
  if (nonSlider.length === 0) return 'inline';
  const letters = ['a', 'b', 'c', 'd'].filter(L => !ids.includes(L));
  return nonSlider.length <= letters.length ? 'lift-expr' : 'fail-too-many';
}

// ---- contracts -------------------------------------------------------------

const env = new Map([
  ['podiumH', { type: 'number', slider: false }],   // expr binding
  ['chamberH', { type: 'number', slider: false }],  // expr binding
  ['totalHeight', { type: 'number', slider: true }],// param → NumberSlider
  ['plinthCenter', { type: 'point', slider: false }],
  ['profile', { type: 'curve', slider: false }],
]);

// 1. inline op literal is lifted, not rejected
assert.strictEqual(classifyRefArg({ op: 'points', args: {} }, env, true), 'lift-inline-op');
assert.strictEqual(classifyRefArg({ op: 'point', args: { x: 1 } }, env, false), 'lift-inline-op');

// 2. bare {x,y,z} literal lifts ONLY where a point/vector is accepted
assert.strictEqual(classifyRefArg({ x: 0, y: 0, z: 0 }, env, true), 'lift-xyz-literal');
assert.strictEqual(classifyRefArg({ x: 0, y: 0, z: 0 }, env, false), 'fail');

// 3. bare binding name coerces to the binding; unknown names still fail
assert.strictEqual(classifyRefArg('plinthCenter', env, true), 'coerce-bare-name');
assert.strictEqual(classifyRefArg('neverBound', env, true), 'fail');

// 4. canonical "$ref" still classified as a plain ref (no behavior change)
assert.strictEqual(classifyRefArg('$profile', env, true), 'ref');

// 5. arithmetic on refs → formula path; computed bindings auto-wired via expr()
assert.strictEqual(classifyNumFormula('$podiumH+0.5', env), 'lift-expr');
assert.strictEqual(classifyNumFormula('plinthH + chamberH * 0.5',
  new Map([...env, ['plinthH', { type: 'number', slider: false }]])), 'lift-expr');

// 6. slider-only formulas stay INLINE — no pointless Expression nodes
assert.strictEqual(classifyNumFormula('totalHeight/2', env), 'inline');
assert.strictEqual(classifyNumFormula('sin(totalHeight)*3', env), 'inline');

// 7. unknown identifiers are left to the runtime scope (slider labels, a–d)
assert.strictEqual(classifyNumFormula('someRuntimeVar*2', env), 'inline');

// 8. a formula naming a NON-number binding is an honest failure
assert.strictEqual(classifyNumFormula('profile + 1', env), 'fail-non-number');

// 9. more computed bindings than free letters → honest "split it" failure
const bigEnv = new Map(env);
['q1', 'q2', 'q3', 'q4', 'q5'].forEach(n => bigEnv.set(n, { type: 'number', slider: false }));
assert.strictEqual(classifyNumFormula('q1+q2+q3+q4+q5', bigEnv), 'fail-too-many');

// 10. free-letter selection avoids collisions: if the formula already uses "a",
// the substitute letter must not be "a"
{
  const ids = ['a', 'q1'];
  const letters = ['a', 'b', 'c', 'd'].filter(L => !ids.includes(L));
  assert.deepStrictEqual(letters, ['b', 'c', 'd']);
}

console.log('test_ir_ergonomics: all contracts hold');
