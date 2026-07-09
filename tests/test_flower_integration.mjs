import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import fs from 'fs';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

const log = [];
function say(...a) { log.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ')); console.log(...a); }

// ---- verbatim from the fixed geometryWorker.ts ----
function safeTranslate(shape, vector) {
  const transform = new replicad.Transformation();
  transform.translate(vector);
  const rawShape = transform.transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}
function safeRotate(shape, angle, position = [0,0,0], direction = [0,0,1]) {
  const transform = new replicad.Transformation();
  transform.rotate(angle, position, direction);
  const rawShape = transform.transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}
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
function nonUniformScale(shape, fx, fy, fz, center = [0,0,0]) {
  const bounds = shape?.boundingBox?.bounds;
  const diag = bounds ? Math.hypot(bounds[1][0]-bounds[0][0], bounds[1][1]-bounds[0][1], bounds[1][2]-bounds[0][2]) : 10;
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  return solidFromDeformedMesh(shape, (x,y,z) => [
    (x-center[0])*fx+center[0], (y-center[1])*fy+center[1], (z-center[2])*fz+center[2],
  ], tolerance);
}
function makeEllipsoid(rx, ry, rz) {
  const base = replicad.makeSphere(rx);
  if (Math.abs(ry-rx) < 1e-9 && Math.abs(rz-rx) < 1e-9) return base;
  const out = nonUniformScale(base, 1, ry/rx, rz/rx);
  try { base.delete?.(); } catch(e) {}
  return out;
}
// ---- end verbatim ----

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  const bloomRadius = 10, stemHeight = 30, petalCount = 8;
  const parts = [];

  say('Building stem (Cone)...');
  const stem = replicad.makeCylinder(0.9, stemHeight, [0,0,0]);
  parts.push({ name: 'stem', shape: stem });

  say('Building center (Sphere)...');
  const center = replicad.makeSphere(bloomRadius*0.2).translate([0,0,stemHeight]);
  parts.push({ name: 'center', shape: center });

  say('Building', petalCount, 'outer petals (Ellipsoid + CircularPattern, tilted)...');
  const outerPetalBase = makeEllipsoid(bloomRadius*0.12, bloomRadius*0.32, bloomRadius*0.05);
  const tilted = safeRotate(outerPetalBase, 70, outerPetalBase.boundingBox.center, [1,0,0]);
  const lifted = safeTranslate(tilted, [0, bloomRadius*0.28, stemHeight]);
  const outerCopies = [];
  for (let i = 0; i < petalCount; i++) {
    const angle = (360/petalCount)*i;
    const rotated = safeRotate(lifted, angle, [0,0,stemHeight], [0,0,1]);
    outerCopies.push(rotated);
  }
  parts.push({ name: 'outerPetals', shape: replicad.makeCompound(outerCopies) });

  say('Building', petalCount, 'sepal ring (smaller, green, phase offset)...');
  const sepalBase = makeEllipsoid(bloomRadius*0.10, bloomRadius*0.26, bloomRadius*0.04);
  const sepalTilted = safeRotate(sepalBase, 80, sepalBase.boundingBox.center, [1,0,0]);
  const sepalLifted = safeTranslate(sepalTilted, [0, bloomRadius*0.24, stemHeight - bloomRadius*0.02]);
  const sepalCopies = [];
  const phase = 180 / petalCount;
  for (let i = 0; i < petalCount; i++) {
    const angle = (360/petalCount)*i + phase;
    sepalCopies.push(safeRotate(sepalLifted, angle, [0,0,stemHeight], [0,0,1]));
  }
  parts.push({ name: 'sepals', shape: replicad.makeCompound(sepalCopies) });

  say('Building stamens (small spheres ring)...');
  const stamenBase = replicad.makeSphere(bloomRadius*0.045).translate([0, bloomRadius*0.1, stemHeight + bloomRadius*0.22]);
  const stamenCopies = [];
  for (let i = 0; i < 10; i++) {
    stamenCopies.push(safeRotate(stamenBase, (360/10)*i, [0,0,stemHeight], [0,0,1]));
  }
  parts.push({ name: 'stamens', shape: replicad.makeCompound(stamenCopies) });

  const elapsed = Date.now() - t0;
  say('');
  say('=== RESULTS (total build time: ' + elapsed + 'ms) ===');
  let sceneMin = [Infinity,Infinity,Infinity], sceneMax = [-Infinity,-Infinity,-Infinity];
  for (const p of parts) {
    try {
      const vol = replicad.measureVolume(p.shape);
      const bb = p.shape.boundingBox.bounds;
      for (let k=0;k<3;k++){ sceneMin[k]=Math.min(sceneMin[k],bb[0][k]); sceneMax[k]=Math.max(sceneMax[k],bb[1][k]); }
      say(p.name, ': volume=' + vol.toFixed(2), ' bbox=' + JSON.stringify(bb));
    } catch (e) {
      say(p.name, ': FAILED -', e.message);
    }
  }
  say('scene bbox min=' + JSON.stringify(sceneMin) + ' max=' + JSON.stringify(sceneMax));
  say('scene height (should be ~' + (stemHeight + bloomRadius*0.5).toFixed(1) + '): ' + (sceneMax[2]-0).toFixed(1));

  fs.writeFileSync(join(projectRoot,'scratch','flower_integration_result.txt'), log.join('\n'));
}
run().catch(e => { log.push('FATAL: ' + (e.stack||e)); fs.writeFileSync(join(projectRoot,'scratch','flower_integration_result.txt'), log.join('\n')); console.error(e); });
