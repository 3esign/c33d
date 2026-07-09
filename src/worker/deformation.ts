import * as replicad from 'replicad';

export function dist3(a: number[], b: number[]) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function mid3(a: number[], b: number[]): number[] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}

// Longest-edge bisection, run on the ORIGINAL (pre-deform) triangle so the
// resulting facets sample the true deformed surface instead of chording across it.
export function bisectTriangle(
  p1: number[],
  p2: number[],
  p3: number[],
  maxEdge: number,
  depth: number,
  out: number[][][],
) {
  const d12 = dist3(p1, p2), d23 = dist3(p2, p3), d31 = dist3(p3, p1);
  const m = Math.max(d12, d23, d31);
  if (depth <= 0 || m <= maxEdge) {
    out.push([p1, p2, p3]);
    return;
  }
  if (m === d12) {
    const mm = mid3(p1, p2);
    bisectTriangle(p1, mm, p3, maxEdge, depth - 1, out);
    bisectTriangle(mm, p2, p3, maxEdge, depth - 1, out);
  } else if (m === d23) {
    const mm = mid3(p2, p3);
    bisectTriangle(p1, p2, mm, maxEdge, depth - 1, out);
    bisectTriangle(p1, mm, p3, maxEdge, depth - 1, out);
  } else {
    const mm = mid3(p3, p1);
    bisectTriangle(p1, p2, mm, maxEdge, depth - 1, out);
    bisectTriangle(mm, p2, p3, maxEdge, depth - 1, out);
  }
}

export function solidFromDeformedMesh(
  shape: any,
  deform: (x: number, y: number, z: number) => [number, number, number],
  tolerance = 0.15,
  maxEdgeLength = 0,
  maxDepth = 8,
): any {
  const OC = (replicad as any).getOC();
  const { vertices, triangles } = shape.mesh({ tolerance, angularTolerance: 20 });
  const triCountOrig = triangles.length / 3;
  const triList: number[][][] = [];
  for (let t = 0; t < triCountOrig; t++) {
    const ia = triangles[t * 3], ib = triangles[t * 3 + 1], ic = triangles[t * 3 + 2];
    const p1 = [vertices[ia * 3], vertices[ia * 3 + 1], vertices[ia * 3 + 2]];
    const p2 = [vertices[ib * 3], vertices[ib * 3 + 1], vertices[ib * 3 + 2]];
    const p3 = [vertices[ic * 3], vertices[ic * 3 + 1], vertices[ic * 3 + 2]];
    if (maxEdgeLength > 0) bisectTriangle(p1, p2, p3, maxEdgeLength, maxDepth, triList);
    else triList.push([p1, p2, p3]);
  }

  const sewing = new OC.BRepBuilderAPI_Sewing(1e-4, true, true, true, false);
  let builtFaces = 0;
  for (const [p1, p2, p3] of triList) {
    const d1 = deform(p1[0], p1[1], p1[2]), d2 = deform(p2[0], p2[1], p2[2]), d3 = deform(p3[0], p3[1], p3[2]);
    const pa = new OC.gp_Pnt_3(d1[0], d1[1], d1[2]);
    const pb = new OC.gp_Pnt_3(d2[0], d2[1], d2[2]);
    const pc = new OC.gp_Pnt_3(d3[0], d3[1], d3[2]);
    const dab = Math.hypot(pa.X() - pb.X(), pa.Y() - pb.Y(), pa.Z() - pb.Z());
    const dbc = Math.hypot(pb.X() - pc.X(), pb.Y() - pc.Y(), pb.Z() - pc.Z());
    const dca = Math.hypot(pc.X() - pa.X(), pc.Y() - pa.Y(), pc.Z() - pa.Z());
    if (dab < 1e-7 || dbc < 1e-7 || dca < 1e-7) {
      pa.delete();
      pb.delete();
      pc.delete();
      continue;
    }

    const e1m = new OC.BRepBuilderAPI_MakeEdge_3(pa, pb);
    const e2m = new OC.BRepBuilderAPI_MakeEdge_3(pb, pc);
    const e3m = new OC.BRepBuilderAPI_MakeEdge_3(pc, pa);
    const wm = new OC.BRepBuilderAPI_MakeWire_4(e1m.Edge(), e2m.Edge(), e3m.Edge());
    if (wm.IsDone()) {
      const fm = new OC.BRepBuilderAPI_MakeFace_15(wm.Wire(), true);
      if (fm.IsDone()) {
        sewing.Add(fm.Face());
        builtFaces++;
      }
      fm.delete();
    }
    wm.delete();
    e1m.delete();
    e2m.delete();
    e3m.delete();
    pa.delete();
    pb.delete();
    pc.delete();
  }
  if (builtFaces === 0) throw new Error('deform produced zero valid faces (degenerate mesh)');

  sewing.Perform(new OC.Message_ProgressRange_1());
  const sewn = sewing.SewedShape();

  let solidShape: any = null;
  const ex = new OC.TopExp_Explorer_2(sewn, OC.TopAbs_ShapeEnum.TopAbs_SHELL, OC.TopAbs_ShapeEnum.TopAbs_SHAPE);
  while (ex.More()) {
    const shell = OC.TopoDS.Shell_1(ex.Current());
    const sm = new OC.BRepBuilderAPI_MakeSolid_3(shell);
    solidShape = sm.Solid();
    sm.delete();
    ex.Next();
  }
  ex.delete();
  if (!solidShape) throw new Error('sewing did not close into a shell (mesh may be non-manifold)');
  return replicad.cast(solidShape);
}

export function curveSegments(totalAngleDeg: number, perDeg: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Math.abs(totalAngleDeg) / perDeg)));
}

export function nonUniformScale(shape: any, fx: number, fy: number, fz: number, center: [number, number, number] = [0, 0, 0]) {
  const bounds = shape?.boundingBox?.bounds;
  const diag = bounds
    ? Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2])
    : 10;
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  return solidFromDeformedMesh(shape, (x, y, z) => [
    (x - center[0]) * fx + center[0],
    (y - center[1]) * fy + center[1],
    (z - center[2]) * fz + center[2],
  ], tolerance);
}

export function bendShape(shape: any, axisName: string, angleDeg: number) {
  const angleRad = angleDeg * Math.PI / 180;
  const bounds = shape?.boundingBox?.bounds;
  if (!bounds) throw new Error('Bend: input has no bounding box');
  const center = shape.boundingBox.center;
  const axisIdx = axisName === 'Y' ? 1 : axisName === 'Z' ? 2 : 0;
  const curlIdx = axisName === 'Z' ? 0 : 2;
  const half = (bounds[1][axisIdx] - bounds[0][axisIdx]) / 2;
  if (half < 1e-6) throw new Error('Bend: input has zero extent along the chosen axis');
  const R = half / (angleRad / 2);
  const diag = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]);
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  const segs = curveSegments(angleDeg, 10, 4, 18);
  const maxEdgeLength = Math.max(tolerance, (2 * half) / segs);
  return solidFromDeformedMesh(shape, (x, y, z) => {
    const p = [x, y, z];
    const u = p[axisIdx] - center[axisIdx];
    const w = p[curlIdx] - center[curlIdx];
    const theta = (u / half) * (angleRad / 2);
    const rho = R - w;
    const out: [number, number, number] = [x, y, z];
    out[axisIdx] = center[axisIdx] + rho * Math.sin(theta);
    out[curlIdx] = center[curlIdx] + (R - rho * Math.cos(theta));
    return out;
  }, tolerance, maxEdgeLength);
}

export function twistShape(shape: any, axisName: string, angleDeg: number) {
  const angleRad = angleDeg * Math.PI / 180;
  const bounds = shape?.boundingBox?.bounds;
  if (!bounds) throw new Error('Twist: input has no bounding box');
  const center = shape.boundingBox.center;
  const axisIdx = axisName === 'X' ? 0 : axisName === 'Y' ? 1 : 2;
  const i1 = axisIdx === 2 ? 0 : axisIdx === 0 ? 1 : 0;
  const i2 = axisIdx === 2 ? 1 : axisIdx === 0 ? 2 : 2;
  const lo = bounds[0][axisIdx], hi = bounds[1][axisIdx];
  const span = hi - lo;
  if (span < 1e-6) throw new Error('Twist: input has zero extent along the chosen axis');
  const diag = Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2]);
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  const segs = curveSegments(angleDeg, 10, 4, 18);
  const maxEdgeLength = Math.max(tolerance, span / segs);
  return solidFromDeformedMesh(shape, (x, y, z) => {
    const p = [x, y, z];
    const t = (p[axisIdx] - lo) / span;
    const theta = t * angleRad;
    const a = p[i1] - center[i1], b = p[i2] - center[i2];
    const cosT = Math.cos(theta), sinT = Math.sin(theta);
    const out: [number, number, number] = [x, y, z];
    out[i1] = center[i1] + a * cosT - b * sinT;
    out[i2] = center[i2] + a * sinT + b * cosT;
    return out;
  }, tolerance, maxEdgeLength);
}

export function safeTranslate(shape: any, vector: [number, number, number]) {
  const transform = new replicad.Transformation();
  transform.translate(vector);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

export function safeRotate(
  shape: any,
  angle: number,
  position: [number, number, number] = [0, 0, 0],
  direction: [number, number, number] = [0, 0, 1],
) {
  const transform = new replicad.Transformation();
  transform.rotate(angle, position, direction);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

export function safeScale(shape: any, scaleFactor: number, center: [number, number, number] = [0, 0, 0]) {
  const transform = new replicad.Transformation();
  transform.scale(center, scaleFactor);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}
