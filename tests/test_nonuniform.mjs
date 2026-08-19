import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';
import fs from 'fs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

const log = [];
function say(...args) { log.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : a).join(' ')); }
// scratch/ is gitignored — create it on demand so a fresh clone passes.
function writeLog() {
  try {
    const dir = join(projectRoot, 'scratch');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'nonuniform_result.txt'), log.join('\n'));
  } catch (e) {
    console.warn('could not write scratch log (non-fatal):', e?.message);
  }
}

function solidFromScaledMesh(OC, shape, fx, fy, fz, center) {
  const t0 = Date.now();
  const { vertices, triangles } = shape.mesh({ tolerance: 0.05, angularTolerance: 15 });
  const n = vertices.length / 3;
  const scaled = new Float64Array(vertices.length);
  for (let i = 0; i < n; i++) {
    const x = vertices[i * 3], y = vertices[i * 3 + 1], z = vertices[i * 3 + 2];
    scaled[i * 3] = (x - center[0]) * fx + center[0];
    scaled[i * 3 + 1] = (y - center[1]) * fy + center[1];
    scaled[i * 3 + 2] = (z - center[2]) * fz + center[2];
  }

  const sewing = new OC.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
  const triCount = triangles.length / 3;
  let builtFaces = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = triangles[t * 3], ib = triangles[t * 3 + 1], ic = triangles[t * 3 + 2];
    const pa = new OC.gp_Pnt_3(scaled[ia * 3], scaled[ia * 3 + 1], scaled[ia * 3 + 2]);
    const pb = new OC.gp_Pnt_3(scaled[ib * 3], scaled[ib * 3 + 1], scaled[ib * 3 + 2]);
    const pc = new OC.gp_Pnt_3(scaled[ic * 3], scaled[ic * 3 + 1], scaled[ic * 3 + 2]);

    const dab = Math.hypot(pa.X() - pb.X(), pa.Y() - pb.Y(), pa.Z() - pb.Z());
    const dbc = Math.hypot(pb.X() - pc.X(), pb.Y() - pc.Y(), pb.Z() - pc.Z());
    const dca = Math.hypot(pc.X() - pa.X(), pc.Y() - pa.Y(), pc.Z() - pa.Z());
    if (dab < 1e-7 || dbc < 1e-7 || dca < 1e-7) { pa.delete(); pb.delete(); pc.delete(); continue; }

    const e1m = new OC.BRepBuilderAPI_MakeEdge_3(pa, pb); const e1 = e1m.Edge();
    const e2m = new OC.BRepBuilderAPI_MakeEdge_3(pb, pc); const e2 = e2m.Edge();
    const e3m = new OC.BRepBuilderAPI_MakeEdge_3(pc, pa); const e3 = e3m.Edge();
    const wm = new OC.BRepBuilderAPI_MakeWire_4(e1, e2, e3);
    if (wm.IsDone()) {
      const wire = wm.Wire();
      const fm = new OC.BRepBuilderAPI_MakeFace_15(wire, true);
      if (fm.IsDone()) {
        sewing.Add(fm.Face());
        builtFaces++;
      }
      fm.delete();
    }
    wm.delete(); e1m.delete(); e2m.delete(); e3m.delete();
    pa.delete(); pb.delete(); pc.delete();
  }

  sewing.Perform(new OC.Message_ProgressRange_1());
  const sewn = sewing.SewedShape();
  const shapeTypeNum = sewn.ShapeType();
  const typeNames = ['COMPOUND', 'COMPSOLID', 'SOLID', 'SHELL', 'FACE', 'WIRE', 'EDGE', 'VERTEX', 'SHAPE'];
  const shapeTypeName = typeNames[shapeTypeNum] || ('unknown(' + shapeTypeNum + ')');

  let solidShape = null;
  let shellsFound = 0;
  let explorerError = null;
  try {
    const shellExplorer = new OC.TopExp_Explorer_2(sewn, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
    while (shellExplorer.More()) {
      shellsFound++;
      const shell = OC.TopoDS.Shell_1(shellExplorer.Current());
      const solidMaker = new OC.BRepBuilderAPI_MakeSolid_3(shell);
      solidShape = solidMaker.Solid();
      solidMaker.delete();
      shellExplorer.Next();
    }
    shellExplorer.delete();
  } catch (e) {
    explorerError = e.message;
  }

  let directShellError = null;
  if (!solidShape && shapeTypeNum === 3) {
    try {
      const shell = OC.TopoDS.Shell_1(sewn);
      const solidMaker = new OC.BRepBuilderAPI_MakeSolid_3(shell);
      solidShape = solidMaker.Solid();
      solidMaker.delete();
    } catch (e) {
      directShellError = e.message;
    }
  }

  const elapsed = Date.now() - t0;
  return { solidShape, builtFaces, triCount, elapsed, sewn, shapeTypeName, shellsFound, explorerError, directShellError };
}

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);

  say('=== TEST 1: sphere r=2 scaled (1, 1.5, 0.25) -> ellipsoid semi-axes (2, 3, 0.5) ===');
  const sphere = replicad.makeSphere(2);
  const expectedVolume = (4 / 3) * Math.PI * 2 * 3 * 0.5;
  say('expected volume ~', expectedVolume.toFixed(3));

  const r1 = solidFromScaledMesh(OC, sphere, 1, 1.5, 0.25, [0, 0, 0]);
  const { solidShape, builtFaces, triCount, elapsed } = r1;
  say('triangles in source mesh:', triCount, ' faces built:', builtFaces, ' elapsed ms:', elapsed);
  say('sewn shape type:', r1.shapeTypeName, ' shells found via explorer:', r1.shellsFound);
  if (r1.explorerError) say('explorer error:', r1.explorerError);
  if (r1.directShellError) say('direct shell error:', r1.directShellError);

  assert.ok(solidShape, 'TEST 1 must produce a solid from the scaled sphere mesh');
  {
    const wrapped = replicad.cast(solidShape);
    const vol = replicad.measureVolume(wrapped);
    const errPct = 100 * Math.abs(vol - expectedVolume) / expectedVolume;
    say('resulting volume:', vol.toFixed(3));
    say('resulting bbox:', JSON.stringify(wrapped.boundingBox.bounds));
    say('volume error %:', errPct.toFixed(2));
    // Tessellation at tolerance 0.05 loses a few percent — 10% is failure.
    assert.ok(errPct < 10,
      `ellipsoid volume should be within 10% of ${expectedVolume.toFixed(3)}, got ${vol.toFixed(3)} (${errPct.toFixed(2)}% off)`);
    const bb = wrapped.boundingBox.bounds;
    assert.ok(Math.abs(bb[1][1] - 3) < 0.15 && Math.abs(bb[1][2] - 0.5) < 0.1,
      `scaled semi-axes should be ~(2,3,0.5), bbox max ${JSON.stringify(bb[1])}`);

    try {
      const analyzer = new OC.BRepCheck_Analyzer(wrapped.wrapped, true, false);
      say('BRepCheck_Analyzer.IsValid():', analyzer.IsValid());
      analyzer.delete();
    } catch (e) {
      say('BRepCheck_Analyzer not available or failed:', e.message);
    }

    // The scaled solid must stay usable by downstream booleans.
    const box = replicad.makeBox([-0.5,-0.5,-0.5],[0.5,0.5,0.5]).translate([0, 0, 3]);
    const union = wrapped.fuse(box);
    const unionVol = replicad.measureVolume(union);
    say('fuse-with-box succeeded, union volume:', unionVol.toFixed(3));
    assert.ok(unionVol > vol, `union with a disjoint box must add volume: ${unionVol.toFixed(3)} vs ${vol.toFixed(3)}`);
  }

  say('');
  say('=== TEST 2: box 4x6x2 scaled (2, 0.5, 3) -> box 8x3x6 ===');
  const box2 = replicad.makeBox([-2, -3, -1], [2, 3, 1]);
  const expectedVol2 = 8 * 3 * 6;
  const r2 = solidFromScaledMesh(OC, box2, 2, 0.5, 3, [0, 0, 0]);
  say('sewn shape type:', r2.shapeTypeName, ' shells found:', r2.shellsFound, 'faces built:', r2.builtFaces, '/', r2.triCount);
  assert.ok(r2.solidShape,
    `TEST 2 must produce a solid. explorerError=${r2.explorerError} directShellError=${r2.directShellError}`);
  {
    const w2 = replicad.cast(r2.solidShape);
    const vol2 = replicad.measureVolume(w2);
    say('expected volume', expectedVol2, ' got', vol2.toFixed(3), ' bbox', JSON.stringify(w2.boundingBox.bounds));
    // A box mesh is exact — the scaled solid must match to within 2%.
    assert.ok(Math.abs(vol2 - expectedVol2) / expectedVol2 < 0.02,
      `scaled box volume should be ~${expectedVol2}, got ${vol2.toFixed(3)}`);
  }

  say('');
  say('All nonuniform-scale assertions passed.');
  writeLog();
  console.log('PASS, details in scratch/nonuniform_result.txt');
}

run().catch(err => {
  log.push('FATAL ERROR: ' + (err && err.stack || err));
  writeLog();
  console.error('FAILED:', err && err.message || err, '(details in scratch/nonuniform_result.txt)');
  process.exitCode = 1;
});
