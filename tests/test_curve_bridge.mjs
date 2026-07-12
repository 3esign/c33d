import assert from 'assert';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// ---------- Part 1: pure logic replicas (source of truth: executors.ts) ----------

// InstanceOnPoints selection + scale grading
function selectInstances(pts, everyNth, maxCount) {
  return pts.filter((_, i) => i % everyNth === 0).slice(0, maxCount);
}
function gradeScale(s0, s1, i, n) {
  const f = n > 1 ? i / (n - 1) : 0;
  return s0 + (s1 - s0) * f;
}

const pts24 = Array.from({ length: 24 }, (_, i) => ({ type: 'Point', x: i, y: 0, z: 0, index: i }));
assert.strictEqual(selectInstances(pts24, 1, 100).length, 24);
assert.strictEqual(selectInstances(pts24, 2, 100).length, 12);
assert.strictEqual(selectInstances(pts24, 1, 10).length, 10);
assert.strictEqual(gradeScale(1, 1, 5, 24), 1);
assert.strictEqual(gradeScale(0.5, 1.5, 0, 3), 0.5);
assert.strictEqual(gradeScale(0.5, 1.5, 2, 3), 1.5);
assert.strictEqual(gradeScale(0.5, 1.5, 1, 3), 1.0);

// Tangent → Z rotation angle (alignToTangent)
function tangentAngleDeg(t) { return Math.atan2(t[1] || 0, t[0] || 0) * 180 / Math.PI; }
assert.strictEqual(Math.round(tangentAngleDeg([1, 0, 0])), 0);
assert.strictEqual(Math.round(tangentAngleDeg([0, 1, 0])), 90);
assert.strictEqual(Math.round(tangentAngleDeg([-1, 0, 0])), 180);

// DivideCurve channel shape (t, index, optional tangent)
function divideChannels(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    out.push({ type: 'Point', x: t * 10, y: 0, z: 0, t, index: i, tangent: [1, 0, 0] });
  }
  return out;
}
const div = divideChannels(5);
assert.strictEqual(div.length, 5);
assert.strictEqual(div[0].t, 0);
assert.strictEqual(div[4].t, 1);
assert.strictEqual(div[3].index, 3);
assert.ok(Array.isArray(div[2].tangent));

// curveToWire normalization decision table (replica of executors.ts logic)
function curveToWireDecision(v) {
  if (!v) return null;
  if (typeof v.sketchOnPlane === 'function') return 'drawing→sketch→wire';
  if (typeof v.wires === 'function') return 'sketch→wire';
  return 'edge/wire as-is';
}
assert.strictEqual(curveToWireDecision({ sketchOnPlane: () => ({}) }), 'drawing→sketch→wire');
assert.strictEqual(curveToWireDecision({ wires: () => [{}] }), 'sketch→wire');
assert.strictEqual(curveToWireDecision({ wrapped: {} }), 'edge/wire as-is');
assert.strictEqual(curveToWireDecision(null), null);

console.log('test_curve_bridge: pure-logic assertions passed');

// ---------- Part 2: WASM constructor audit (guarded) ----------
// The new executors rely on these opencascade.js bindings. If the kernel can't
// load in this environment (e.g. cloud-only node_modules), skip with a notice —
// the audit still runs on dev machines via `npm run test`.
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

try {
  const mod = await import('replicad-opencascadejs');
  const init = mod.default?.default || mod.default || mod;
  const OC = await init();
  const needed = [
    'BRepOffsetAPI_MakePipe_1',      // Pipe / SweepAlongCurve
    'BRepOffsetAPI_ThruSections',    // LoftCurves (this build has no _1 suffix)
    'BRepBuilderAPI_MakeFace',       // curveToFace (via replicad makeFace)
    'BRepPrimAPI_MakeBox_2',         // kernel canary (replicad makeBox)
  ];
  const missing = needed.filter(n => typeof OC[n] !== 'function' && typeof OC[n.replace(/_\d+$/, '')] !== 'function' && typeof OC[n + '_1'] !== 'function');
  if (missing.length > 0) {
    console.error('test_curve_bridge: MISSING OC bindings:', missing.join(', '));
    process.exit(1);
  }
  console.log('test_curve_bridge: WASM constructor audit passed');

  // End-to-end: the exact operations the bridge executors perform, against the
  // real kernel. Volumes are checked against analytic expectations.
  const replicad = await import('replicad');
  const R = replicad.default || replicad;
  R.setOC(OC);
  const wireOf = (drawing, z) => {
    const sk = drawing.sketchOnPlane('XY');
    const raw = typeof sk.wires === 'function' ? sk.wires() : sk.wire;
    const w = Array.isArray(raw) ? raw[0] : raw;
    return z ? w.translate([0, 0, z]) : w;
  };

  // Curve wires expose the API the toolkit needs (the old Drawing payloads did not)
  const wA = wireOf(R.drawEllipse(10, 6), 0);
  assert.strictEqual(typeof wA.pointAt, 'function', 'wire.pointAt');
  assert.strictEqual(typeof wA.tangentAt, 'function', 'wire.tangentAt');
  assert.strictEqual(typeof wA.offset2D, 'function', 'wire.offset2D');

  // LoftCurves: two ellipse rails -> solid
  const wB = wireOf(R.drawEllipse(12, 8), 10);
  const Ctor = OC.BRepOffsetAPI_ThruSections_1 ?? OC.BRepOffsetAPI_ThruSections;
  const mk = new Ctor(true, false, 1e-6);
  mk.AddWire(wA.wrapped); mk.AddWire(wB.wrapped);
  try { mk.Build(new OC.Message_ProgressRange_1()); } catch { try { mk.Build(); } catch { /* lazy */ } }
  const loft = R.cast(mk.Shape()); mk.delete();
  const loftVol = R.measureVolume(loft);
  assert.ok(loftVol > 1885 && loftVol < 3016, `loft volume ${loftVol} within analytic bounds`);

  // PipeOnCurve: plane-oriented circular profile swept along the ellipse wire
  const p0 = wA.pointAt(0), t0 = wA.tangentAt(0);
  const plane = new R.Plane(p0, undefined, t0);
  const prof = R.drawCircle(0.8).sketchOnPlane(plane).face();
  const pm = new OC.BRepOffsetAPI_MakePipe_1(wA.wrapped, prof.wrapped);
  const pipe = R.cast(pm.Shape()); pm.delete();
  assert.ok(R.measureVolume(pipe) > 50, 'pipe volume');

  // ExtrudeCurve: closed ellipse -> prism, volume = PI*rx*ry*h
  const ex = R.drawEllipse(10, 6).sketchOnPlane('XY').extrude(5);
  const exVol = R.measureVolume(ex);
  assert.ok(Math.abs(exVol - Math.PI * 10 * 6 * 5) < 5, `extrude volume ${exVol} ≈ analytic`);

  // OffsetCurve: wire offset keeps the curve API
  const off = wA.offset2D(2);
  assert.strictEqual(typeof off.pointAt, 'function', 'offset wire keeps pointAt');

  console.log('test_curve_bridge: END-TO-END kernel assertions passed (loft/pipe/extrude/offset)');
} catch (e) {
  if (String(e?.code) === 'ERR_MODULE_NOT_FOUND' || /Cannot find|ENOENT|fetch/.test(String(e?.message))) {
    console.log('test_curve_bridge: SKIPPED WASM audit (kernel not loadable in this environment): ' + String(e.message || e).slice(0, 120));
  } else {
    console.error('test_curve_bridge: WASM section FAILED:', String(e?.message || e).slice(0, 300));
    process.exit(1);
  }
}
