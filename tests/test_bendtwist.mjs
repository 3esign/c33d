import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);
import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

function solidFromDeformedMesh(shape, deform, tolerance = 0.15) {
  const OC = replicad.getOC();
  const { vertices, triangles } = shape.mesh({ tolerance, angularTolerance: 20 });
  const vertCount = vertices.length / 3;
  const out = new Float64Array(vertices.length);
  for (let i = 0; i < vertCount; i++) {
    const [x, y, z] = deform(vertices[i*3], vertices[i*3+1], vertices[i*3+2]);
    out[i*3] = x; out[i*3+1] = y; out[i*3+2] = z;
  }
  const sewing = new OC.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
  const triCount = triangles.length / 3;
  let builtFaces = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = triangles[t*3], ib = triangles[t*3+1], ic = triangles[t*3+2];
    const pa = new OC.gp_Pnt_3(out[ia*3], out[ia*3+1], out[ia*3+2]);
    const pb = new OC.gp_Pnt_3(out[ib*3], out[ib*3+1], out[ib*3+2]);
    const pc = new OC.gp_Pnt_3(out[ic*3], out[ic*3+1], out[ic*3+2]);
    const dab = Math.hypot(pa.X()-pb.X(), pa.Y()-pb.Y(), pa.Z()-pb.Z());
    const dbc = Math.hypot(pb.X()-pc.X(), pb.Y()-pc.Y(), pb.Z()-pc.Z());
    const dca = Math.hypot(pc.X()-pa.X(), pc.Y()-pa.Y(), pc.Z()-pa.Z());
    if (dab < 1e-7 || dbc < 1e-7 || dca < 1e-7) { pa.delete(); pb.delete(); pc.delete(); continue; }
    const e1m = new OC.BRepBuilderAPI_MakeEdge_3(pa, pb);
    const e2m = new OC.BRepBuilderAPI_MakeEdge_3(pb, pc);
    const e3m = new OC.BRepBuilderAPI_MakeEdge_3(pc, pa);
    const wm = new OC.BRepBuilderAPI_MakeWire_4(e1m.Edge(), e2m.Edge(), e3m.Edge());
    if (wm.IsDone()) {
      const fm = new OC.BRepBuilderAPI_MakeFace_15(wm.Wire(), true);
      if (fm.IsDone()) { sewing.Add(fm.Face()); builtFaces++; }
      fm.delete();
    }
    wm.delete(); e1m.delete(); e2m.delete(); e3m.delete();
    pa.delete(); pb.delete(); pc.delete();
  }
  if (builtFaces === 0) throw new Error('deform produced zero valid faces');
  sewing.Perform(new OC.Message_ProgressRange_1());
  const sewn = sewing.SewedShape();
  let solidShape = null;
  const ex = new OC.TopExp_Explorer_2(sewn, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (ex.More()) {
    const shell = OC.TopoDS.Shell_1(ex.Current());
    const sm = new OC.BRepBuilderAPI_MakeSolid_3(shell);
    solidShape = sm.Solid();
    sm.delete();
    ex.Next();
  }
  ex.delete();
  if (!solidShape) throw new Error('sewing did not close into a shell');
  return replicad.cast(solidShape);
}

// ---- Bend ----
function bendShape(shape, axisName, angleDeg) {
  const angleRad = angleDeg * Math.PI / 180;
  if (Math.abs(angleRad) < 1e-6) return shape.clone();
  const bounds = shape.boundingBox.bounds;
  const center = shape.boundingBox.center;
  const axisIdx = axisName === 'Y' ? 1 : axisName === 'Z' ? 2 : 0;
  const curlIdx = axisName === 'Z' ? 0 : 2; // Z-axis bend curls into X; X/Y bend curls into Z
  const half = (bounds[1][axisIdx] - bounds[0][axisIdx]) / 2;
  if (half < 1e-6) return shape.clone();
  const R = half / (angleRad / 2);
  const diag = Math.hypot(bounds[1][0]-bounds[0][0], bounds[1][1]-bounds[0][1], bounds[1][2]-bounds[0][2]);
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  return solidFromDeformedMesh(shape, (x, y, z) => {
    const p = [x, y, z];
    const u = p[axisIdx] - center[axisIdx];
    const w = p[curlIdx] - center[curlIdx];
    const theta = (u / half) * (angleRad / 2);
    const rho = R - w;
    const newU = rho * Math.sin(theta);
    const newW = R - rho * Math.cos(theta);
    const out = [x, y, z];
    out[axisIdx] = center[axisIdx] + newU;
    out[curlIdx] = center[curlIdx] + newW;
    return out;
  }, tolerance);
}

// ---- Twist ----
function twistShape(shape, axisName, angleDeg) {
  const angleRad = angleDeg * Math.PI / 180;
  if (Math.abs(angleRad) < 1e-6) return shape.clone();
  const bounds = shape.boundingBox.bounds;
  const center = shape.boundingBox.center;
  const axisIdx = axisName === 'X' ? 0 : axisName === 'Y' ? 1 : 2;
  const [i1, i2] = axisIdx === 2 ? [0, 1] : axisIdx === 0 ? [1, 2] : [0, 2];
  const lo = bounds[0][axisIdx], hi = bounds[1][axisIdx];
  const span = hi - lo;
  const diag = Math.hypot(bounds[1][0]-bounds[0][0], bounds[1][1]-bounds[0][1], bounds[1][2]-bounds[0][2]);
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  if (span < 1e-6) return shape.clone();
  return solidFromDeformedMesh(shape, (x, y, z) => {
    const p = [x, y, z];
    const t = (p[axisIdx] - lo) / span;
    const theta = t * angleRad;
    const a = p[i1] - center[i1], b = p[i2] - center[i2];
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const out = [x, y, z];
    out[i1] = center[i1] + a * cosT - b * sinT;
    out[i2] = center[i2] + a * sinT + b * cosT;
    return out;
  }, tolerance);
}

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  console.log('=== BEND test: box 4x4x20 bent 90deg around X (should curl into Z, like an L) ===');
  const box = replicad.makeBox([-2,-2,0],[2,2,20]);
  const bent = bendShape(box, 'X', 90);
  console.log('bent volume (expect ~320, some tessellation loss):', replicad.measureVolume(bent).toFixed(2));
  console.log('bent bbox:', JSON.stringify(bent.boundingBox.bounds));
  console.log('(original was a tall thin box along Z; a 90deg X-bend should now span in both X and Z)');

  console.log('');
  console.log('=== TWIST test: box 10x2x2 (long along X) twisted 180deg around X ===');
  const box2 = replicad.makeBox([0,-1,-1],[10,1,1]);
  const twisted = twistShape(box2, 'X', 180);
  console.log('twisted volume (expect ~40):', replicad.measureVolume(twisted).toFixed(2));
  console.log('twisted bbox:', JSON.stringify(twisted.boundingBox.bounds));
  console.log('(a 180deg twist of a square cross-section should look the same bbox-wise, since square rotated 180 = same square, but geometry should be twisted -- check faces)');
  console.log('twisted faces:', twisted.faces.length, ' (should be >> 6, since twisting turns flat side faces into a helical ruled surface approximated by triangles)');

  console.log('');
  console.log('=== TWIST test 2: box with RECTANGULAR (non-square) cross-section, 90deg twist -> bbox should grow ===');
  const box3 = replicad.makeBox([0,-3,-1],[10,3,1]); // 6 wide x 2 thick cross-section
  const twisted2 = twistShape(box3, 'X', 90);
  console.log('twisted2 bbox (Y/Z should both grow toward ~3.16 since a 6x2 rect rotated 45deg mid-twist sweeps a bigger footprint):', JSON.stringify(twisted2.boundingBox.bounds));
  console.log('twisted2 volume (expect ~120):', replicad.measureVolume(twisted2).toFixed(2));

  console.log('');
  console.log('total time:', Date.now()-t0, 'ms');

  console.log('');
  console.log('=== Petal-like test: Ellipsoid bent + twisted (realistic use case) ===');
  const petalBase = replicad.makeSphere(3);
  // fake an ellipsoid via the already-proven nonUniformScale path (reuse solidFromDeformedMesh directly)
  const centerP = [0,0,0];
  const petal = solidFromDeformedMesh(petalBase, (x,y,z) => [x, y*2.5, z*0.3], 0.08);
  console.log('petal (pre-bend) bbox:', JSON.stringify(petal.boundingBox.bounds));
  const petalMoved = petal.translate([0, 7.5, 0]); // move so its base is near origin
  const petalBent = bendShape(petalMoved, 'Y', -40);
  console.log('petal bent bbox:', JSON.stringify(petalBent.boundingBox.bounds), 'volume:', replicad.measureVolume(petalBent).toFixed(2));
}
run().catch(e => console.error('FAILED:', e.stack || e));
