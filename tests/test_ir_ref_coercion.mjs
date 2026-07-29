// Contract test for the Jul-25 REFERENCE-ARGUMENT COERCIONS, N-ARY ASSEMBLY
// and MULTI-ERROR REPORTING (src/ai/ir/compile.ts + skills.ts).
//
// Unlike the older mirror-style tests, this one drives the REAL compiler — a
// 12-line resolve hook lets Node load the extensionless TypeScript imports, so
// the test cannot drift from the source it is asserting about.
//
// Motivation (77-session audit, 22-25 July 2026): 11 of 22 terminal compile
// deaths were a correct design intent in a rejected spelling. Every literal
// below is copied verbatim from a session that died on it:
//   "vector(0, 0, 1)"                     (Jul 22 11:36, Jul 23 09:13:23)
//   "point(0, 0, -balloonRadius*0.75)"    (Jul 23 18:16:35, hot air balloon)
//   ["$roofP1","$roofP2","$roofP3"]       (Jul 23 09:13:42, greek temple)
//   [{"x":"-(templeWidth+…)/2","y":0,…}]  (Jul 23 09:14:04)
//   {"point":{"x":0,"y":0,"z":"totalHeight - envelopeRadius"}}  (Jul 23 18:16:00)
//   compound has no argument "e"          (Jul 23 19:14:37, 73-step skeleton)

import assert from 'assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

const { compileIr } = await import('../src/ai/ir/compile.ts');

let checks = 0;
const ok = (label, cond, extra) => {
  assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`);
  checks++;
};
const compile = (body, emit, params) =>
  compileIr({ params: params ?? [{ name: 'r', value: 2 }], body, emit: emit ?? [{ ref: `$${body[body.length - 1].let}` }] });
const msgs = (r) => r.issues.map(i => `${i.where}: ${i.message}`).join(' | ');
const typesOf = (r) => (r.graph?.nodes ?? []).map(n => n.type);

// ---------------------------------------------------------------------------
// 1. Constructor-call syntax in a reference position
// ---------------------------------------------------------------------------
{
  const r = compile([
    { let: 'skirt', op: 'cone', args: { radius1: 3, radius2: 1, height: 2, center: 'point(0, 0, -r*0.75)' } },
  ]);
  ok('call-syntax point() compiles', r.graph !== null, msgs(r));
  ok('call-syntax point() built a Point node', typesOf(r).includes('Point'));
  ok('call-syntax carries the formula through', JSON.stringify(r.graph.nodes).includes('-r*0.75'));
}
{
  const r = compile([
    { let: 'col', op: 'cylinder', args: { radius: 1, height: 5, axis: 'vector(0, 0, 1)' } },
  ]);
  ok('call-syntax vector() compiles', r.graph !== null, msgs(r));
  ok('call-syntax vector() built a VectorXYZ node', typesOf(r).some(t => /Vector/.test(t)), typesOf(r).join(','));
}
{
  // Named-argument form must work too: point(x: 1, z: 4)
  const r = compile([
    { let: 'b', op: 'box', args: { width: 1, length: 1, height: 1, center: 'point(x: 1, z: 4)' } },
  ]);
  ok('named-argument call syntax compiles', r.graph !== null, msgs(r));
}
{
  // REGRESSION GUARD: a formula that merely LOOKS like a call must stay a
  // formula — `sin` is not a skill, so parseCallSyntax must decline it.
  const r = compile([
    { let: 's', op: 'sphere', args: { radius: 'sin(r) * 2 + 3' } },
  ]);
  ok('formula with sin() is not mistaken for a constructor', r.graph !== null, msgs(r));
  ok('formula survived verbatim', JSON.stringify(r.graph.nodes).includes('sin(r) * 2 + 3'));
}

// ---------------------------------------------------------------------------
// 2. Lists of references / literals where a point list is expected
// ---------------------------------------------------------------------------
{
  const r = compile([
    { let: 'p1', op: 'point', args: { x: 0, y: 0, z: 0 } },
    { let: 'p2', op: 'point', args: { x: 5, y: 0, z: 0 } },
    { let: 'p3', op: 'point', args: { x: 2.5, y: 0, z: 3 } },
    { let: 'roof', op: 'polyline', args: { points: ['$p1', '$p2', '$p3'], closed: true } },
    { let: 'roofSolid', op: 'extrude', args: { curve: '$roof', height: 1 } },
  ]);
  ok('list of point refs compiles', r.graph !== null, msgs(r));
  ok('list of point refs built a MergePoints node', typesOf(r).includes('MergePoints'), typesOf(r).join(','));
  const merge = r.graph.nodes.find(n => n.type === 'MergePoints');
  const wired = r.graph.edges.filter(e => e.target === merge.id);
  ok('all three points wired into the merge', wired.length === 3, `got ${wired.length}`);
  ok('merge uses p1..p3 handles', wired.map(e => e.targetHandle).sort().join(',') === 'p1,p2,p3');
}
{
  const r = compile([
    { let: 'ped', op: 'polyline', args: { points: [
      { x: '-(r + 1)/2', y: 0, z: 0 },
      { x: '(r + 1)/2', y: 0, z: 0 },
      { x: 0, y: 0, z: 'r * 0.6' },
    ], closed: true } },
    { let: 'pedSolid', op: 'extrude', args: { curve: '$ped', height: 1 } },
  ]);
  ok('list of {x,y,z} literals compiles', r.graph !== null, msgs(r));
  ok('literal list produced three Point nodes', typesOf(r).filter(t => t === 'Point').length === 3, typesOf(r).join(','));
}
{
  // >8 entries must chain rather than fail.
  const body = [];
  for (let i = 0; i < 11; i++) body.push({ let: `q${i}`, op: 'point', args: { x: i, y: 0, z: 0 } });
  body.push({ let: 'path', op: 'polyline', args: { points: body.map(b => `$${b.let}`) } });
  body.push({ let: 'sweptSolid', op: 'extrude', args: { curve: '$path', height: 1 } });
  const r = compile(body);
  ok('11-point list compiles (chained merge)', r.graph !== null, msgs(r));
  ok('11-point list chained MergePoints nodes', typesOf(r).filter(t => t === 'MergePoints').length >= 2,
    `merges=${typesOf(r).filter(t => t === 'MergePoints').length}`);
}

// ---------------------------------------------------------------------------
// 3. One redundant wrapper object
// ---------------------------------------------------------------------------
{
  const r = compile([
    { let: 'env', op: 'sphere', args: { radius: 4, center: { point: { x: 0, y: 0, z: 'r - 1' } } } },
  ]);
  ok('{"point": {...}} wrapper is unwrapped', r.graph !== null, msgs(r));
  ok('unwrap left a teaching note', r.notes.some(n => /unwrapped/i.test(n)), r.notes.join(' | '));
}

// ---------------------------------------------------------------------------
// 4. N-ary assembly — the 73-step-skeleton killer
// ---------------------------------------------------------------------------
{
  const body = [];
  const names = [];
  for (let i = 0; i < 12; i++) {
    body.push({ let: `bone${i}`, op: 'box', args: { width: 1, length: 1, height: 1 } });
    names.push(`$bone${i}`);
  }
  body.push({ let: 'skeleton', op: 'compound', args: { parts: names } });
  const r = compile(body);
  ok('compound of 12 parts compiles', r.graph !== null, msgs(r));
  ok('compound of 12 parts chained Compound nodes', typesOf(r).filter(t => t === 'Compound').length >= 2,
    `compounds=${typesOf(r).filter(t => t === 'Compound').length}`);
}
{
  // The old spelling that died: named args past "d".
  const body = [];
  const args = {};
  ['a', 'b', 'c', 'd', 'e', 'f'].forEach((k, i) => {
    body.push({ let: `s${i}`, op: 'box', args: { width: 1, length: 1, height: 1 } });
    args[k] = `$s${i}`;
  });
  body.push({ let: 'grp', op: 'compound', args });
  const r = compile(body);
  ok('compound with named args a..f compiles', r.graph !== null, msgs(r));
}
{
  const body = [
    { let: 'x1', op: 'box', args: { width: 2, length: 2, height: 2 } },
    { let: 'x2', op: 'sphere', args: { radius: 1.2 } },
    { let: 'x3', op: 'cylinder', args: { radius: 0.5, height: 4 } },
    { let: 'fused', op: 'union', args: { parts: ['$x1', '$x2', '$x3'] } },
  ];
  const r = compile(body);
  ok('union of 3 parts compiles', r.graph !== null, msgs(r));
  const booleans = r.graph.nodes.filter(n => n.type === 'Boolean');
  ok('union of 3 parts chained 2 Boolean nodes', booleans.length === 2, `booleans=${booleans.length}`);
}
{
  const r = compile([
    { let: 'a1', op: 'box', args: { width: 1, length: 1, height: 1 } },
    { let: 'b1', op: 'sphere', args: { radius: 1 } },
    { let: 'u', op: 'union', args: { a: '$a1', b: '$b1' } },
  ]);
  ok('binary union still works', r.graph !== null, msgs(r));
}

// ---------------------------------------------------------------------------
// 5. Multi-error reporting and poison suppression
// ---------------------------------------------------------------------------
{
  // Three INDEPENDENT mistakes. Before Jul 25 this reported exactly one and the
  // model burned an attempt per error; the audit showed the failing index moved
  // every attempt (10→12→9) until the budget ran out.
  const r = compile([
    { let: 'good', op: 'box', args: { width: 1, length: 1, height: 1 } },
    { let: 'bad1', op: 'sphere', args: { radius: 1, nonsense: 3 } },
    { let: 'bad2', op: 'nosuchop', args: {} },
    { let: 'bad3', op: 'cylinder', args: { radius: 1, height: 2, axis: 42 } },
  ], [{ ref: '$good' }]);
  ok('compile failed as expected', r.graph === null);
  const bodyIssues = r.issues.filter(i => i.where.startsWith('body['));
  ok('all three independent errors reported at once', bodyIssues.length === 3,
    `got ${bodyIssues.length}: ${msgs(r)}`);
  ok('errors name their own op', bodyIssues.some(i => i.where.includes('bad1')) &&
    bodyIssues.some(i => i.where.includes('bad2')) && bodyIssues.some(i => i.where.includes('bad3')), msgs(r));
}
{
  // One root cause, three consumers — must stay ONE error, not four.
  const r = compile([
    { let: 'root', op: 'nosuchop', args: {} },
    { let: 'c1', op: 'translate', args: { shape: '$root', z: 1 } },
    { let: 'c2', op: 'scale', args: { shape: '$c1', factor: 2 } },
    { let: 'c3', op: 'compound', args: { parts: ['$c2', '$root'] } },
  ], [{ ref: '$c3' }]);
  const bodyIssues = r.issues.filter(i => i.where.startsWith('body['));
  ok('cascade suppressed to the single root cause', bodyIssues.length === 1,
    `got ${bodyIssues.length}: ${msgs(r)}`);
  ok('the reported error is the root op', bodyIssues[0].where.includes('root'), msgs(r));
  ok('poisoned emit produced no extra noise', !msgs(r).includes('does not match any binding'), msgs(r));
}
{
  // Report cap: many errors must not produce a wall of text.
  const body = [];
  for (let i = 0; i < 15; i++) body.push({ let: `e${i}`, op: 'nosuchop', args: {} });
  const r = compile(body, [{ ref: '$e0' }]);
  const bodyIssues = r.issues.filter(i => i.where.startsWith('body['));
  ok('reported errors are capped', bodyIssues.length <= 8, `got ${bodyIssues.length}`);
  ok('cap is announced to the model', r.issues.some(i => /not reported/i.test(i.message)), msgs(r));
}

// ---------------------------------------------------------------------------
// 6. Objects with no "op" get a message that names what was written
// ---------------------------------------------------------------------------
{
  // Verbatim shape of two audit blackouts: an object with no "op" landing in a
  // NUMBER slot (Jul 23 09:13:09 `scale.factor`, Jul 24 19:19:15 `point.z`).
  const r = compile([
    { let: 'bad', op: 'sphere', args: { radius: { lower: 1, upper: 2 } } },
  ], [{ ref: '$bad' }]);
  ok('missing-op object fails', r.graph === null);
  ok('message names the keys it actually saw', /keys \{lower, upper\}/.test(msgs(r)), msgs(r));
  ok('message no longer says inline op "" is unknown', !/inline op "" is unknown/.test(msgs(r)), msgs(r));
}
{
  const r = compile([
    { let: 'p', op: 'sphere', args: { radius: { x: 1, y: 2, z: 3 } } },
  ], [{ ref: '$p' }]);
  ok('missing-op {x,y,z} suggests point()', /"op": "point"/.test(msgs(r)), msgs(r));
}
{
  const r = compile([
    { let: 'p', op: 'sphere', args: { radius: { formula: 'r * 2' } } },
  ], [{ ref: '$p' }]);
  ok('missing-op {formula} suggests expr()', /"op": "expr"/.test(msgs(r)), msgs(r));
}

// ---------------------------------------------------------------------------
// 7. Regression: canonical programs are untouched
// ---------------------------------------------------------------------------
{
  const r = compile([
    { let: 'ctr', op: 'point', args: { x: 0, y: 0, z: 0 } },
    { let: 'ring', op: 'on_circle', args: { radius: 5, count: 8 } },
    { let: 'col', op: 'cylinder', args: { radius: 0.4, height: 3, center: '$ctr' } },
    { let: 'cols', op: 'instances', args: { shape: '$col', points: '$ring' } },
  ]);
  ok('canonical program still compiles', r.graph !== null, msgs(r));
  ok('canonical program adds no coercion notes', !r.notes.some(n => /combined|unwrapped|treated/.test(n)),
    r.notes.join(' | '));
}

console.log(`test_ir_ref_coercion: all ${checks} contracts PASS`);
