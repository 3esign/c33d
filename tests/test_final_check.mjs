import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);
import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

function dist3(a,b){ return Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2]); }
function mid3(a,b){ return [(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2]; }
function bisectTriangle(p1, p2, p3, maxEdge, depth, out) {
  const d12 = dist3(p1,p2), d23 = dist3(p2,p3), d31 = dist3(p3,p1);
  const m = Math.max(d12, d23, d31);
  if (depth <= 0 || m <= maxEdge) { out.push([p1,p2,p3]); return; }
  if (m === d12) { const mm = mid3(p1,p2); bisectTriangle(p1,mm,p3,maxEdge,depth-1,out); bisectTriangle(mm,p2,p3,maxEdge,depth-1,out); }
  else if (m === d23) { const mm = mid3(p2,p3); bisectTriangle(p1,p2,mm,maxEdge,depth-1,out); bisectTriangle(p1,mm,p3,maxEdge,depth-1,out); }
  else { const mm = mid3(p3,p1); bisectTriangle(p1,p2,mm,maxEdge,depth-1,out); bisectTriangle(mm,p2,p3,maxEdge,depth-1,out); }
}
function solidFromDeformedMesh(shape, deform, tolerance = 0.15, maxEdgeLength = 0, maxDepth = 8) {
  const OC = replicad.getOC();
  const { vertices, triangles } = shape.mesh({ tolerance, angularTolerance: 20 });
  const triCountOrig = triangles.length / 3;
  const triList = [];
  for (let t = 0; t < triCountOrig; t++) {
    const ia = triangles[t*3], ib = triangles[t*3+1], ic = triangles[t*3+2];
    const p1 = [vertices[ia*3], vertices[ia*3+1], vertices[ia*3+2]];
    const p2 = [vertices[ib*3], vertices[ib*3+1], vertices[ib*3+2]];
    const p3 = [vertices[ic*3], vertices[ic*3+1], vertices[ic*3+2]];
    if (maxEdgeLength > 0) bisectTriangle(p1, p2, p3, maxEdgeLength, maxDepth, triList);
    else triList.push([p1, p2, p3]);
  }
  const sewing = new OC.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
  let builtFaces = 0;
  for (const [p1, p2, p3] of triList) {
    const d1 = deform(p1[0],p1[1],p1[2]), d2 = deform(p2[0],p2[1],p2[2]), d3 = deform(p3[0],p3[1],p3[2]);
    const pa = new OC.gp_Pnt_3(d1[0],d1[1],d1[2]);
    const pb = new OC.gp_Pnt_3(d2[0],d2[1],d2[2]);
    const pc = new OC.gp_Pnt_3(d3[0],d3[1],d3[2]);
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
  return replicad.cast(solidShape);
}
function curveSegments(totalAngleDeg, perDeg, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(Math.abs(totalAngleDeg) / perDeg))); }
function bendShape(shape, axisName, angleDeg) {
  const angleRad = angleDeg * Math.PI / 180;
  const bounds = shape.boundingBox.bounds;
  const center = shape.boundingBox.center;
  const axisIdx = axisName === 'Y' ? 1 : axisName === 'Z' ? 2 : 0;
  const curlIdx = axisName === 'Z' ? 0 : 2;
  const half = (bounds[1][axisIdx] - bounds[0][axisIdx]) / 2;
  const R = half / (angleRad / 2);
  const diag = Math.hypot(bounds[1][0]-bounds[0][0], bounds[1][1]-bounds[0][1], bounds[1][2]-bounds[0][2]);
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  const segs = curveSegments(angleDeg, 10, 4, 18);
  const maxEdgeLength = Math.max(tolerance, (2*half) / segs);
  return solidFromDeformedMesh(shape, (x, y, z) => {
    const p = [x, y, z];
    const u = p[axisIdx] - center[axisIdx];
    const w = p[curlIdx] - center[curlIdx];
    const theta = (u / half) * (angleRad / 2);
    const rho = R - w;
    const out = [x, y, z];
    out[axisIdx] = center[axisIdx] + rho * Math.sin(theta);
    out[curlIdx] = center[curlIdx] + (R - rho * Math.cos(theta));
    return out;
  }, tolerance, maxEdgeLength);
}

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  console.log('=== REALISTIC: petal (ellipsoid-derived) bent 35deg ===');
  const petalBase = replicad.makeSphere(3);
  const petal = solidFromDeformedMesh(petalBase, (x,y,z) => [x, y*2.2, z*0.25], 0.1);
  const preBendVol = replicad.measureVolume(petal); const petalMoved = petal.translate([0, 6.6, 0]);
  const t1 = Date.now();
  const bent = bendShape(petalMoved, 'Y', 35);
  console.log('bend time:', Date.now()-t1, 'ms');
  console.log('pre-bend volume:', preBendVol.toFixed(2));
  console.log('post-bend volume:', replicad.measureVolume(bent).toFixed(2), '(should be reasonably close, not collapsed)');
  console.log('post-bend bbox:', JSON.stringify(bent.boundingBox.bounds));

  console.log('');
  console.log('=== REALISTIC: horn (cone) twisted 180deg ===');
  const hornCyl = replicad.makeCylinder(1.5, 15, [0,0,0]);
  const t2 = Date.now();
  const twisted = bendShape(hornCyl, 'Z', 30); // slight bend for realism
  console.log('cone-bend time:', Date.now()-t2, 'ms, volume:', replicad.measureVolume(twisted).toFixed(2), '(orig ~', (Math.PI*1.5*1.5*15).toFixed(1),')');

  console.log('');
  console.log('total elapsed:', Date.now()-t0, 'ms');
}
run().catch(e => console.error('FAILED:', e.stack || e));
