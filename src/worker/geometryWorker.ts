import opencascade from 'replicad-opencascadejs';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import * as replicad from 'replicad';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';

// Turns a generic "no geometry" leaf into an actionable trace: is an input
// missing, did an upstream node fail (cascade), or are the params to blame?
function explainNullGeometry(
  nodeId: string,
  nodeList: any[],
  edgeList: any[],
  cache: Record<string, any>,
): string {
  const node = nodeList.find(n => n.id === nodeId);
  if (!node) return 'Node produced no geometry (node not found).';
  const def = NODE_LIBRARY[node.type];
  const geoHandles = def ? def.inputs.filter(i => i.type !== 'number').map(i => i.name) : [];
  if (geoHandles.length === 0) {
    return `Node "${nodeId}" (${node.type}) produced no geometry — check its parameters are valid numbers within range.`;
  }
  const incoming = edgeList.filter(e => e.target === nodeId && !String(e.targetHandle || '').startsWith('param:'));
  const connected = new Set(incoming.map(e => String(e.targetHandle || 'solid')));
  const missing = geoHandles.filter(h => !connected.has(h));
  if (missing.length > 0) {
    return `Node "${nodeId}" (${node.type}) has no connection on input ${missing.map(h => `"${h}"`).join(', ')} — connect an upstream solid there.`;
  }
  // All required inputs connected: is an upstream input itself null? (cascade)
  const nullSources = incoming
    .map(e => String(e.source))
    .filter(src => cache[src] === null || cache[src] === undefined);
  if (nullSources.length > 0) {
    return `Node "${nodeId}" (${node.type}) is null because its input(s) came from failed upstream node(s): ${[...new Set(nullSources)].join(', ')}. Fix the upstream node first.`;
  }
  return `Node "${nodeId}" (${node.type}) produced no geometry despite connected inputs — likely invalid parameters (e.g. zero/negative size, self-intersecting fillet).`;
}

// Names the expression evaluator resolves on its own (functions + constants).
const EXPR_BUILTINS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sqrt', 'abs', 'min', 'max',
  'floor', 'ceil', 'round', 'pow', 'log', 'exp', 'clamp', 'lerp', 'pi', 'e',
]);

// Inline parametric expressions: any numeric parameter may be given as a FORMULA
// STRING that references NumberSlider labels by name (e.g. height "bodyRadius*0.2").
// This removes the need for Expression nodes + "param:" edges for scalar math —
// the dominant thing every model failed to wire. Mutates `params` in place.
function resolveInlineNumericParams(
  nodeType: string,
  params: Record<string, any>,
  scope: Record<string, number>,
  nodeId: string,
  errors: { id: string; error: string }[],
): void {
  const def = NODE_LIBRARY[nodeType];
  if (!def) return;
  for (const p of def.params) {
    if (p.type !== 'number') continue;
    const raw = params[p.name];
    if (typeof raw !== 'string') continue;
    const s = raw.trim();
    if (s === '') continue;
    // Plain numeric string → just coerce.
    if (/^[-+]?[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?$/i.test(s)) { params[p.name] = parseFloat(s); continue; }
    // Formula: warn on identifiers that are neither builtins nor known sliders.
    const idents = (s.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []).filter(x => !EXPR_BUILTINS.has(x));
    const unknown = [...new Set(idents)].filter(x => !(x in scope));
    if (unknown.length) {
      errors.push({ id: nodeId, error: `param "${p.name}" formula "${raw}" references unknown slider(s): ${unknown.join(', ')}. Available sliders: ${Object.keys(scope).join(', ') || '(none)'}. Give a NumberSlider that label, or use a literal number.` });
    }
    try {
      params[p.name] = evaluateExpressionSafe(s, scope);
    } catch (err: any) {
      errors.push({ id: nodeId, error: `param "${p.name}" formula "${raw}" error: ${err.message}` });
    }
  }
}

async function initReplicad() {
  try {
    const OC = await (opencascade as any)({
      locateFile: () => opencascadeWasm,
    });
    replicad.setOC(OC);
    postMessage({ type: 'INIT_DONE' });
  } catch (err: any) {
    console.error('Failed to initialize OpenCascade:', err);
    postMessage({ type: 'INIT_ERROR', error: err.message || 'Unknown initialization error' });
    throw err;
  }
}

function safeTranslate(shape: any, vector: [number, number, number]) {
  const transform = new replicad.Transformation();
  transform.translate(vector);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

function safeRotate(shape: any, angle: number, position: [number, number, number] = [0, 0, 0], direction: [number, number, number] = [0, 0, 1]) {
  const transform = new replicad.Transformation();
  transform.rotate(angle, position, direction);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

// Rebuild a shape from a deformed triangulation. This is the general escape
// hatch for any per-vertex deformation (non-uniform scale today; bend/twist/
// taper are the same shape of problem and can reuse this unchanged) that has
// no direct OpenCascade primitive in this WASM build. Tessellates the input,
// runs `deform` over every vertex, and re-sews the result into a genuine solid
// via low-level BRepBuilderAPI calls (point -> edge -> wire -> planar face ->
// sewing -> solid). The result is a real, valid TopoDS_Solid: booleans,
// fillets, further transforms, bounding box and volume queries all work
// normally on it downstream. The trade-off is that curvature becomes faceted
// (a scaled sphere becomes a polyhedron, not a smooth NURBS ellipsoid) — at
// typical render tessellation density this is visually indistinguishable, and
// it is a strict improvement over the previous behaviour, which silently
// passed shapes through UNSCALED.
function dist3(a: number[], b: number[]) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
function mid3(a: number[], b: number[]): number[] { return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]; }

// Longest-edge bisection, run on the ORIGINAL (pre-deform) triangle so the
// resulting facets sample the true deformed surface instead of chording across
// it. Needed for curvature-introducing deforms (Bend, Twist) — NOT needed for
// linear ones (non-uniform scale), where a flat input face stays flat, so
// nonUniformScale below does not pass maxEdgeLength. Splits only the longest
// edge each step, which is far cheaper than uniform quad-split for the long
// thin triangles typical of box/cylinder side faces.
function bisectTriangle(p1: number[], p2: number[], p3: number[], maxEdge: number, depth: number, out: number[][][]) {
  const d12 = dist3(p1, p2), d23 = dist3(p2, p3), d31 = dist3(p3, p1);
  const m = Math.max(d12, d23, d31);
  if (depth <= 0 || m <= maxEdge) { out.push([p1, p2, p3]); return; }
  if (m === d12) { const mm = mid3(p1, p2); bisectTriangle(p1, mm, p3, maxEdge, depth - 1, out); bisectTriangle(mm, p2, p3, maxEdge, depth - 1, out); }
  else if (m === d23) { const mm = mid3(p2, p3); bisectTriangle(p1, p2, mm, maxEdge, depth - 1, out); bisectTriangle(p1, mm, p3, maxEdge, depth - 1, out); }
  else { const mm = mid3(p3, p1); bisectTriangle(p1, p2, mm, maxEdge, depth - 1, out); bisectTriangle(mm, p2, p3, maxEdge, depth - 1, out); }
}

function solidFromDeformedMesh(
  shape: any,
  deform: (x: number, y: number, z: number) => [number, number, number],
  tolerance = 0.15,
  maxEdgeLength = 0, // >0 enables pre-deform subdivision (see bisectTriangle) — set for curvature-introducing deforms
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
    // Skip degenerate triangles (collapsed edges at poles/seams of the source mesh).
    const dab = Math.hypot(pa.X() - pb.X(), pa.Y() - pb.Y(), pa.Z() - pb.Z());
    const dbc = Math.hypot(pb.X() - pc.X(), pb.Y() - pc.Y(), pb.Z() - pc.Z());
    const dca = Math.hypot(pc.X() - pa.X(), pc.Y() - pa.Y(), pc.Z() - pa.Z());
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

// Segment count for a curvature deform: roughly one segment per `perDeg`
// degrees of total sweep, clamped so tiny bends stay cheap and huge ones
// (360°+ twists) stay bounded rather than exploding the triangle budget.
function curveSegments(totalAngleDeg: number, perDeg: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(Math.abs(totalAngleDeg) / perDeg)));
}

// Non-uniform scale. NOTE: OpenCascade's BRepBuilderAPI_GTransform class —
// the "correct" way to do this — is NOT compiled into replicad's WASM bundle
// (confirmed empirically: `typeof OC.BRepBuilderAPI_GTransform_2 === 'undefined'`
// at runtime even though the upstream .d.ts declares it; only 888 of the full
// OpenCascade class surface are bound here). There is no direct binding for
// this operation in this build, so we go through solidFromDeformedMesh instead
// of a native kernel call. Scales around `center` (defaults to world origin;
// callers pass the shape's own bbox center for "isLocal" scaling).
function nonUniformScale(shape: any, fx: number, fy: number, fz: number, center: [number, number, number] = [0, 0, 0]) {
  const bounds = shape?.boundingBox?.bounds;
  const diag = bounds
    ? Math.hypot(bounds[1][0] - bounds[0][0], bounds[1][1] - bounds[0][1], bounds[1][2] - bounds[0][2])
    : 10;
  // Coarser tolerance for bigger shapes keeps evaluation time reasonable; finer
  // for small parts (petals, details) keeps them from looking faceted.
  const tolerance = Math.min(1.5, Math.max(0.03, diag * 0.012));
  return solidFromDeformedMesh(shape, (x, y, z) => [
    (x - center[0]) * fx + center[0],
    (y - center[1]) * fy + center[1],
    (z - center[2]) * fz + center[2],
  ], tolerance);
}

// Bend a shape's extent along `axisName` through `angleDeg` total, curving it
// like a banana. 'X'/'Y' bend that axis's span and curl it into Z (petals,
// leaves, wings, banners curving upward); 'Z' bends a vertical span sideways
// into X (stems, horns, vines curving as they rise). Always bends around the
// shape's own local bbox center (symmetric ±angle/2 from the middle), matching
// the isLocal convention used elsewhere (Scale, Rotate). Unlike non-uniform
// scale, bending introduces real curvature into what may have been flat faces
// (a plain Box's side faces), so — unlike nonUniformScale — this pre-subdivides
// the mesh (bisectTriangle) before deforming, or a coarse input like a 2-triangle
// box face would chord straight across the bend and lose significant volume.
function bendShape(shape: any, axisName: string, angleDeg: number) {
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

// Twist a shape around `axisName` by `angleDeg` total, linearly ramped from 0
// at one end of the shape's local extent along that axis to `angleDeg` at the
// other (drill bits, spiral columns, horns, flames). Same subdivision
// rationale as bendShape: twisting turns flat side faces into ruled/helical
// surfaces that a coarse mesh would chord across.
function twistShape(shape: any, axisName: string, angleDeg: number) {
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

function safeScale(shape: any, scaleFactor: number, center: [number, number, number] = [0, 0, 0]) {
  const transform = new replicad.Transformation();
  transform.scale(center, scaleFactor);
  const rawShape = (transform as any).transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

const initPromise = initReplicad();

self.onmessage = async (e) => {
  // Wait for initialization to complete before processing any messages
  try {
    await initPromise;
  } catch (err: any) {
    postMessage({
      type: 'EVALUATE_ERROR',
      id: e.data.id,
      error: 'OpenCascade kernel failed to initialize: ' + (err.message || '')
    });
    return;
  }

  const { type, payload, id } = e.data;

  if (type === 'EVALUATE_GRAPH') {
    try {
      const { meshes, report } = await evaluateGraph(payload.nodes, payload.edges, payload.macros || []);
      postMessage({ type: 'EVALUATE_DONE', id, result: meshes, report });
    } catch (err: any) {
      postMessage({ type: 'EVALUATE_ERROR', id, error: err.message || 'Unknown error during graph evaluation' });
    }
  }
};

// ---------- Macro expansion ----------
// Replaces every Macro node with its (prefixed) inner subgraph, applying
// exposed param overrides from the macro node's data.
function expandMacros(nodes: any[], edges: any[], macros: any[]): { nodes: any[]; edges: any[]; aliasMap: Record<string, string> } {
  const macroById: Record<string, any> = {};
  macros.forEach(m => { macroById[m.id] = m; });

  const outNodes: any[] = [];
  const outEdges: any[] = [...edges];
  // aliasMap: macro node id -> inner output node id (prefixed), so edges from the
  // macro node and the report can be rewired/attributed.
  const aliasMap: Record<string, string> = {};

  for (const node of nodes) {
    if (node.type !== 'Macro') { outNodes.push(node); continue; }
    const def = macroById[node.data?.macroId];
    if (!def) {
      // Unknown macro: drop it (report will show missing output downstream)
      console.warn(`Macro definition not found: ${node.data?.macroId}`);
      continue;
    }
    const prefix = `${node.id}__`;
    const paramOverrides: Record<string, Record<string, any>> = {};
    (def.exposedParams || []).forEach((ep: any) => {
      const v = node.data?.[ep.name];
      if (v !== undefined) {
        (paramOverrides[ep.nodeId] = paramOverrides[ep.nodeId] || {})[ep.param] = v;
      }
    });
    for (const inner of def.nodes || []) {
      outNodes.push({
        ...inner,
        id: prefix + inner.id,
        data: { ...(inner.data || {}), ...(paramOverrides[inner.id] || {}) },
      });
    }
    for (const innerEdge of def.edges || []) {
      outEdges.push({
        ...innerEdge,
        id: prefix + innerEdge.id,
        source: prefix + innerEdge.source,
        target: prefix + innerEdge.target,
      });
    }
    aliasMap[node.id] = prefix + def.outputNodeId;
  }

  // Rewire edges that referenced macro nodes to the inner output node
  for (const edge of outEdges) {
    if (aliasMap[edge.source]) edge.source = aliasMap[edge.source];
  }
  // Inner output node must not be treated as a leaf-suppressor: edges FROM it
  // exist only if the outer graph had edges from the macro node.
  return { nodes: outNodes, edges: outEdges, aliasMap };
}

// ---------- Memoization cache (persists across evaluations) ----------
const shapeCache: Map<string, { hash: string; shape: any; mesh: any | null }> = new Map();
let evalCounter = 0;
const WORKER_RECYCLE_HINT = 400; // after this many evals, suggest recycle to main thread

function stableHash(obj: any): string {
  // Order-stable JSON for plain param objects
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableHash).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => k + ':' + stableHash(obj[k])).join(',') + '}';
}

async function evaluateGraph(rawNodes: any[], rawEdges: any[], macros: any[]) {
  const { nodes: allNodes, edges, aliasMap } = expandMacros(rawNodes, rawEdges, macros);
  // Group container nodes are visual only
  const nodes = allNodes.filter(n => n.type !== 'group');

  const nodeCache: Record<string, any> = {};
  const numberCache: Record<string, number | number[]> = {};
  const nodeErrors: { id: string; error: string }[] = [];

  // Scope for inline parametric formulas: slider values keyed by (lowercased)
  // label AND id, so a param like "bodyRadius*0.2" resolves without any edges.
  const sliderScope: Record<string, number> = {};
  for (const n of nodes) {
    if (n.type !== 'NumberSlider') continue;
    const v = parseFloat((n.data || {}).value);
    if (!isFinite(v)) continue;
    const label = String((n.data || {}).label ?? '').trim().toLowerCase();
    if (label) sliderScope[label] = v;
    sliderScope[String(n.id).toLowerCase()] = v;
  }

  // Build dependency graph
  const inDegree: Record<string, number> = {};
  const adjList: Record<string, string[]> = {};

  nodes.forEach(n => {
    inDegree[n.id] = 0;
    adjList[n.id] = [];
  });

  edges.forEach(e => {
    if (inDegree[e.target] === undefined) return;
    inDegree[e.target] = (inDegree[e.target] || 0) + 1;
    if (!adjList[e.source]) adjList[e.source] = [];
    adjList[e.source].push(e.target);
  });

  const queue: string[] = Object.keys(inDegree).filter(id => inDegree[id] === 0);
  const sortedNodes: any[] = [];

  while(queue.length > 0) {
    const curr = queue.shift()!;
    const nodeObj = nodes.find(n => n.id === curr);
    if (nodeObj) {
      sortedNodes.push(nodeObj);
    }

    (adjList[curr] || []).forEach(neighbor => {
      inDegree[neighbor]--;
      if (inDegree[neighbor] === 0) {
        queue.push(neighbor);
      }
    });
  }

  const nodeHashes: Record<string, string> = {};

  // Execute nodes in topological order
  for (const node of sortedNodes) {
    const incoming = edges.filter(e => e.target === node.id);

    // 1. Merge driven numeric params (edges with targetHandle "param:<name>")
    const effectiveParams: Record<string, any> = { ...(node.data || {}) };
    for (const e of incoming) {
      if (typeof e.targetHandle === 'string' && e.targetHandle.startsWith('param:')) {
        const pName = e.targetHandle.slice(6);
        const v = numberCache[e.source];
        if (v !== undefined) effectiveParams[pName] = v;
      }
    }

    // 1b. Inline parametric formulas: resolve any numeric param given as a
    // formula string (referencing slider names) into a concrete number. Runs
    // before hashing so slider changes correctly invalidate the shape cache.
    if (node.type !== 'NumberSlider') {
      resolveInlineNumericParams(node.type, effectiveParams, sliderScope, node.id, nodeErrors);
    }

    // 2. Number/List nodes: resolve to plain numbers/arrays, no geometry
    if (node.type === 'NumberSlider') {
      const v = parseFloat(effectiveParams.value);
      numberCache[node.id] = isFinite(v) ? v : 0;
      continue;
    }
    if (node.type === 'Expression') {
      const vars: Record<string, number | number[]> = {};
      for (const e of incoming) {
        if (e.targetHandle && !String(e.targetHandle).startsWith('param:')) {
          const v = numberCache[e.source];
          if (v !== undefined) vars[String(e.targetHandle)] = v;
        }
      }
      try {
        numberCache[node.id] = evaluateExpressionWithLists(String(effectiveParams.formula ?? '0'), vars);
      } catch (err: any) {
        numberCache[node.id] = 0;
        nodeErrors.push({ id: node.id, error: `Expression error: ${err.message}` });
      }
      continue;
    }
    if (node.type === 'Series') {
      const getVal = (pName: string, fallback: number) => {
        const edge = incoming.find(e => e.targetHandle === pName);
        if (edge) {
          const v = numberCache[edge.source];
          if (v !== undefined) return Array.isArray(v) ? (v[0] ?? fallback) : v;
        }
        const parsed = parseFloat(effectiveParams[pName]);
        return isFinite(parsed) ? parsed : fallback;
      };
      const start = getVal('start', 0);
      const step = getVal('step', 1);
      const count = Math.max(1, Math.round(getVal('count', 5)));
      
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(start + i * step);
      }
      numberCache[node.id] = values;
      continue;
    }
    if (node.type === 'Range') {
      const getVal = (pName: string, fallback: number) => {
        const edge = incoming.find(e => e.targetHandle === pName);
        if (edge) {
          const v = numberCache[edge.source];
          if (v !== undefined) return Array.isArray(v) ? (v[0] ?? fallback) : v;
        }
        const parsed = parseFloat(effectiveParams[pName]);
        return isFinite(parsed) ? parsed : fallback;
      };
      const min = getVal('min', 0);
      const max = getVal('max', 10);
      const steps = Math.max(1, Math.round(getVal('steps', 5)));
      
      const values: number[] = [];
      for (let i = 0; i <= steps; i++) {
        values.push(min + (i / steps) * (max - min));
      }
      numberCache[node.id] = values;
      continue;
    }
    if (node.type === 'ListItem') {
      const getVal = (pName: string, fallback: number) => {
        const edge = incoming.find(e => e.targetHandle === pName);
        if (edge) {
          const v = numberCache[edge.source];
          if (v !== undefined) return Array.isArray(v) ? (v[0] ?? fallback) : v;
        }
        const parsed = parseFloat(effectiveParams[pName]);
        return isFinite(parsed) ? parsed : fallback;
      };
      let listVal: number[] = [];
      const listEdge = incoming.find(e => e.targetHandle === 'list');
      if (listEdge) {
        const v = numberCache[listEdge.source];
        if (v !== undefined) {
          listVal = Array.isArray(v) ? v : [v];
        }
      }
      const index = Math.round(getVal('index', 0));
      if (listVal.length === 0) {
        numberCache[node.id] = 0;
      } else {
        const idx = Math.max(0, Math.min(listVal.length - 1, index));
        numberCache[node.id] = listVal[idx];
      }
      continue;
    }
    if (node.type === 'ListLength') {
      let listVal: number[] = [];
      const listEdge = incoming.find(e => e.targetHandle === 'list');
      if (listEdge) {
        const v = numberCache[listEdge.source];
        if (v !== undefined) {
          listVal = Array.isArray(v) ? v : [v];
        }
      }
      numberCache[node.id] = listVal.length;
      continue;
    }

    // 3. Geometry nodes: memoized execution
    const geoInputs = incoming.filter(e => !String(e.targetHandle || '').startsWith('param:'));
    const inputHashPart = geoInputs
      .map(e => `${e.targetHandle}=${nodeHashes[e.source] || 'missing'}`)
      .sort()
      .join('|');
    const hash = `${node.type}#${stableHash(effectiveParams)}#${inputHashPart}`;
    nodeHashes[node.id] = hash;

    const cached = shapeCache.get(node.id);
    if (cached && cached.hash === hash && cached.shape) {
      nodeCache[node.id] = cached.shape;
      continue;
    }

    const nodeInputs = geoInputs.map(e => ({
      targetHandle: e.targetHandle,
      value: nodeCache[e.source]
    }));

    try {
      nodeCache[node.id] = executeNode(
        { ...node, data: effectiveParams },
        nodeInputs,
        (msg: string) => nodeErrors.push({ id: node.id, error: msg })
      );
    } catch (err: any) {
      nodeCache[node.id] = null;
      nodeErrors.push({ id: node.id, error: String(err.message || err) });
    }
    shapeCache.set(node.id, { hash, shape: nodeCache[node.id], mesh: null });
  }

  // ---------- Cache eviction (identity-safe) ----------
  const liveIds = new Set(sortedNodes.map(n => n.id));
  const retainedShapes = new Set<any>();
  for (const [id, entry] of shapeCache) {
    if (liveIds.has(id) && entry.hash === nodeHashes[id]) retainedShapes.add(entry.shape);
  }
  for (const [id, entry] of Array.from(shapeCache.entries())) {
    const stale = !liveIds.has(id) || entry.hash !== nodeHashes[id];
    if (stale) {
      if (entry.shape && !retainedShapes.has(entry.shape)) {
        try { entry.shape.delete?.(); } catch (e) { /* already freed */ }
      }
      shapeCache.delete(id);
    }
  }

  // ---------- Mesh leaf nodes + geometry report ----------
  // Edges into an Align "reference" input do NOT consume the source part: a
  // part used only as a positioning reference still renders as its own colored
  // leaf. Param edges likewise never consume.
  const sourceNodeIds = new Set(
    edges
      .filter(e => {
        const th = String(e.targetHandle || '');
        return !th.startsWith('param:') && th !== 'reference';
      })
      .map(e => e.source)
  );
  const finalMeshes: any[] = [];
  const leafReports: any[] = [];

  // reverse alias map for attributing macro leaves back to the outer macro node id
  const reverseAlias: Record<string, string> = {};
  Object.entries(aliasMap).forEach(([outer, inner]) => { reverseAlias[inner] = outer; });

  for (const [id, value] of Object.entries(nodeCache)) {
    if (sourceNodeIds.has(id)) continue; // skip intermediate nodes
    const reportId = reverseAlias[id] || id;

    if (value && typeof value.mesh === 'function') {
      const entry = shapeCache.get(id);
      let meshData = entry?.mesh || null;
      let meshError: string | null = null;
      if (!meshData) {
        try {
          const mesh = value.mesh({ tolerance: 0.1, angularTolerance: 30 });
          meshData = { vertices: mesh.vertices, indices: mesh.triangles, normals: mesh.normals };
          if (entry) entry.mesh = meshData;
        } catch (err: any) {
          meshError = String(err.message || err);
          console.warn(`Failed to mesh node ${id}:`, err);
        }
      }
      if (meshData) {
        // include the shape+param hash so the main thread can skip rebuilding
        // (and re-uploading) three.js buffers for parts that did not change
        finalMeshes.push({ id: reportId, hash: entry?.hash, ...meshData });
      }

      // Metrics
      let bbox: any = null;
      let volume: number | undefined = undefined;
      try {
        const bb = value.boundingBox;
        if (bb && bb.bounds) {
          const [mn, mx] = bb.bounds;
          bbox = {
            min: mn, max: mx,
            center: bb.center,
            size: [mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]],
          };
        }
      } catch (e) { /* no bbox */ }
      try {
        // Shape3D has no `.volume` property (that was always undefined here —
        // replicad only exposes volume via the measureVolume() helper, which
        // computes it through BRepGProp.VolumeProperties under the hood).
        const v = (replicad as any).measureVolume(value);
        if (typeof v === 'number' && isFinite(v)) volume = v;
      } catch (e) { /* volume unsupported for faces/compounds/open shells */ }

      leafReports.push({
        id: reportId,
        bbox,
        volume,
        meshOk: !!meshData,
        vertexCount: meshData ? meshData.vertices.length / 3 : 0,
        error: meshError,
      });
    } else if (nodes.find(n => n.id === id)) {
      const n = nodes.find(nd => nd.id === id);
      if (n && n.type !== 'NumberSlider' && n.type !== 'Expression') {
        leafReports.push({ id: reportId, bbox: null, volume: undefined, meshOk: false, vertexCount: 0, error: explainNullGeometry(id, nodes, edges, nodeCache) });
      }
    }
  }

  // Scene extents
  let sceneMin = [Infinity, Infinity, Infinity];
  let sceneMax = [-Infinity, -Infinity, -Infinity];
  leafReports.forEach(l => {
    if (l.bbox) {
      for (let k = 0; k < 3; k++) {
        sceneMin[k] = Math.min(sceneMin[k], l.bbox.min[k]);
        sceneMax[k] = Math.max(sceneMax[k], l.bbox.max[k]);
      }
    }
  });
  const hasScene = isFinite(sceneMin[0]);

  // Slider inventory (label → value) for the report
  const sliderInventory: Record<string, number> = {};
  for (const n of nodes) {
    if (n.type !== 'NumberSlider') continue;
    const v = parseFloat((n.data || {}).value);
    if (!isFinite(v)) continue;
    const label = String((n.data || {}).label ?? '').trim();
    sliderInventory[label || n.id] = v;
  }

  evalCounter++;
  const report = {
    leaves: leafReports,
    nodeErrors,
    numbers: numberCache,
    sliders: sliderInventory,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    scene: hasScene ? {
      min: sceneMin, max: sceneMax,
      size: [sceneMax[0] - sceneMin[0], sceneMax[1] - sceneMin[1], sceneMax[2] - sceneMin[2]],
    } : null,
    meshedLeafCount: finalMeshes.length,
    evalCount: evalCounter,
    recycleRecommended: evalCounter >= WORKER_RECYCLE_HINT,
  };

  return { meshes: finalMeshes, report };
}

// Inlined safe expression evaluator (workers can import, but keep self-contained
// against bundler worker-scope quirks). Mirrors src/utils/expression.ts.
function evaluateExpressionSafe(formula: string, vars: Record<string, number>): number {
  const FUNCS: Record<string, (...args: number[]) => number> = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
    atan: Math.atan, atan2: Math.atan2, sqrt: Math.sqrt, abs: Math.abs, min: Math.min,
    max: Math.max, floor: Math.floor, ceil: Math.ceil, round: Math.round, pow: Math.pow,
    log: Math.log, exp: Math.exp,
    clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
    lerp: (a, b, t) => a + (b - a) * t,
  };
  const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
  const toks: { kind: string; value: string }[] = [];
  {
    let i = 0;
    while (i < formula.length) {
      const c = formula[i];
      if (/\s/.test(c)) { i++; continue; }
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < formula.length && /[0-9.eE]/.test(formula[j])) {
          if ((formula[j] === 'e' || formula[j] === 'E') && (formula[j + 1] === '-' || formula[j + 1] === '+')) j++;
          j++;
        }
        toks.push({ kind: 'num', value: formula.slice(i, j) }); i = j;
      } else if (/[a-zA-Z_]/.test(c)) {
        let j = i;
        while (j < formula.length && /[a-zA-Z_0-9]/.test(formula[j])) j++;
        toks.push({ kind: 'id', value: formula.slice(i, j).toLowerCase() }); i = j;
      } else if ('+-*/%^'.includes(c)) { toks.push({ kind: 'op', value: c }); i++; }
      else if (c === '(') { toks.push({ kind: 'lparen', value: c }); i++; }
      else if (c === ')') { toks.push({ kind: 'rparen', value: c }); i++; }
      else if (c === ',') { toks.push({ kind: 'comma', value: c }); i++; }
      else throw new Error(`Unexpected character '${c}'`);
    }
  }
  let pos = 0;
  const peek = () => toks[pos];
  const next = () => toks[pos++];
  function parseExpr(): number {
    let left = parseMul();
    while (peek() && peek().kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value; const r = parseMul(); left = op === '+' ? left + r : left - r;
    }
    return left;
  }
  function parseMul(): number {
    let left = parsePow();
    while (peek() && peek().kind === 'op' && '*/%'.includes(peek().value)) {
      const op = next().value; const r = parsePow();
      if (op === '*') left *= r; else if (op === '/') left = r === 0 ? 0 : left / r; else left = r === 0 ? 0 : left % r;
    }
    return left;
  }
  function parsePow(): number {
    const b = parseUnary();
    if (peek() && peek().kind === 'op' && peek().value === '^') { next(); return Math.pow(b, parsePow()); }
    return b;
  }
  function parseUnary(): number {
    if (peek() && peek().kind === 'op' && peek().value === '-') { next(); return -parseUnary(); }
    if (peek() && peek().kind === 'op' && peek().value === '+') { next(); return parseUnary(); }
    return parseAtom();
  }
  function parseAtom(): number {
    const t = next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'num') return parseFloat(t.value);
    if (t.kind === 'lparen') {
      const v = parseExpr();
      if (!peek() || next().kind !== 'rparen') throw new Error('Missing )');
      return v;
    }
    if (t.kind === 'id') {
      if (peek() && peek().kind === 'lparen') {
        next();
        const args: number[] = [];
        if (peek() && peek().kind !== 'rparen') {
          args.push(parseExpr());
          while (peek() && peek().kind === 'comma') { next(); args.push(parseExpr()); }
        }
        if (!peek() || next().kind !== 'rparen') throw new Error(`Missing ) after ${t.value}()`);
        const fn = FUNCS[t.value];
        if (!fn) throw new Error(`Unknown function '${t.value}'`);
        return fn(...args);
      }
      if (t.value in vars && isFinite(vars[t.value])) return vars[t.value];
      if (t.value in CONSTS) return CONSTS[t.value];
      return 0;
    }
    throw new Error(`Unexpected token '${t.value}'`);
  }
  const result = parseExpr();
  if (pos < toks.length) throw new Error('Trailing input in expression');
  return isFinite(result) && !isNaN(result) ? result : 0;
}

// NaN-safe numeric param read. NOTE: `parseFloat(x) ?? d` is a bug — parseFloat
// returns NaN (never null/undefined), so ?? never applies the fallback and NaN
// flows into the kernel, killing the node with an opaque error.
function num(v: any, d: number): number {
  const p = parseFloat(v);
  return isFinite(p) ? p : d;
}

function executeNode(node: any, inputs: any[], warn: (msg: string) => void = () => {}) {
  const params = node.data || {};
  const { makeCylinder, makeSphere, makeBox, drawRectangle, drawCircle, makeCompound, sketchText } = replicad;

  switch(node.type) {
    case 'Box': {
      const w = parseFloat(params.width) || 10;
      const l = parseFloat(params.length) || 10;
      const h = parseFloat(params.height) || 10;
      return makeBox([-w/2, -l/2, -h/2], [w/2, l/2, h/2]);
    }
    case 'Sphere': {
      const r = parseFloat(params.radius) || 5;
      return makeSphere(r);
    }
    case 'Cylinder': {
      const r = parseFloat(params.radius) || 5;
      const h = parseFloat(params.height) || 10;
      return makeCylinder(r, h, [0, 0, -h/2]);
    }
    case 'Cone': {
      const r1 = Math.max(num(params.radius1, 5), 0.001);
      const r2 = Math.max(num(params.radius2, 2), 0.001);
      const h = Math.max(num(params.height, 10), 0.001);
      // Equal radii → a cone is a cylinder (MakeCone rejects r1 === r2).
      if (Math.abs(r1 - r2) < 1e-6) {
        return makeCylinder(r1, h, [0, 0, -h/2]);
      }
      // Primary: native OpenCascade cone primitive — robust, no lofting.
      try {
        const OC = (replicad as any).getOC();
        const maker = new OC.BRepPrimAPI_MakeCone_1(r1, r2, h);
        const shape = replicad.cast(maker.Shape());
        maker.delete();
        return (shape as any).translate([0, 0, -h/2]);
      } catch (e1: any) {
        // Fallback: loft two circle SKETCHES. (The old code called .face()
        // first — Face has no loftWith, which broke every Cone: the
        // "p1.loftWith is not a function" error from the benchmark logs.)
        try {
          const s1 = drawCircle(r1).sketchOnPlane("XY") as any;
          const s2 = drawCircle(r2).sketchOnPlane("XY", h) as any;
          return s1.loftWith(s2).translate([0, 0, -h/2]);
        } catch (err: any) {
          console.warn("Cone generation failed:", err);
          warn(`Cone failed with radius1=${r1}, radius2=${r2}, height=${h}: ${String(err?.message || err)} (native cone also failed: ${String(e1?.message || e1).slice(0, 120)})`);
          return null;
        }
      }
    }
    case 'Plane': {
      const w = parseFloat(params.width) || 10;
      const l = parseFloat(params.length) || 10;
      return (drawRectangle(w, l).sketchOnPlane("XY") as any).face().translate([-w/2, -l/2, 0]);
    }
    case 'Ellipsoid': {
      const rx = Math.max(num(params.radiusX, 5), 0.001);
      const ry = Math.max(num(params.radiusY, 3), 0.001);
      const rz = Math.max(num(params.radiusZ, 2), 0.001);
      try {
        const base = makeSphere(rx);
        if (Math.abs(ry - rx) < 1e-9 && Math.abs(rz - rx) < 1e-9) return base;
        const out = nonUniformScale(base, 1, ry / rx, rz / rx);
        try { (base as any).delete?.(); } catch (e) { /* ok */ }
        return out;
      } catch (err: any) {
        warn(`Ellipsoid failed (rx=${rx}, ry=${ry}, rz=${rz}): ${String(err?.message || err)}`);
        return makeSphere(rx); // degrade gracefully to a sphere
      }
    }
    case 'Torus': {
      const R = Math.max(num(params.majorRadius, 8), 0.001);
      const r = Math.max(Math.min(num(params.minorRadius, 2), R * 0.99), 0.001);
      try {
        const OC = (replicad as any).getOC();
        const maker = new OC.BRepPrimAPI_MakeTorus_1(R, r);
        const shape = replicad.cast(maker.Shape());
        maker.delete();
        return shape;
      } catch (err: any) {
        warn(`Torus failed (majorRadius=${R}, minorRadius=${r}): ${String(err?.message || err)}`);
        return null;
      }
    }
    case 'ScaleXYZ': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const fx = Math.max(0.01, num(params.factorX, 1));
      const fy = Math.max(0.01, num(params.factorY, 1));
      const fz = Math.max(0.01, num(params.factorZ, 1));
      if (Math.abs(fx - 1) < 1e-9 && Math.abs(fy - 1) < 1e-9 && Math.abs(fz - 1) < 1e-9) return solidInput.clone();
      const isLocal = params.isLocal !== false && params.isLocal !== 'false'; // default true
      const center: [number, number, number] = isLocal && solidInput.boundingBox
        ? solidInput.boundingBox.center as [number, number, number]
        : [0, 0, 0];
      try {
        return nonUniformScale(solidInput, fx, fy, fz, center);
      } catch (err: any) {
        warn(`ScaleXYZ failed (${fx}, ${fy}, ${fz}): ${String(err?.message || err)} — passed the solid through UNSCALED.`);
        return solidInput.clone();
      }
    }
    case 'Bend': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const axisName = String(params.axis || 'X').toUpperCase();
      const angle = num(params.angle, 45);
      if (Math.abs(angle) < 1e-6) return solidInput.clone();
      try {
        return bendShape(solidInput, axisName, angle);
      } catch (err: any) {
        warn(`Bend failed (axis ${axisName}, angle ${angle}): ${String(err?.message || err)} — passed the solid through UNBENT.`);
        return solidInput.clone();
      }
    }
    case 'Twist': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const axisName = String(params.axis || 'Z').toUpperCase();
      const angle = num(params.angle, 90);
      if (Math.abs(angle) < 1e-6) return solidInput.clone();
      try {
        return twistShape(solidInput, axisName, angle);
      } catch (err: any) {
        warn(`Twist failed (axis ${axisName}, angle ${angle}): ${String(err?.message || err)} — passed the solid through UNTWISTED.`);
        return solidInput.clone();
      }
    }
    case 'PlaceOnSurface': {
      const surfaceInput = inputs.find(i => i.targetHandle === 'surface')?.value;
      const shapeInput = inputs.find(i => i.targetHandle === 'shape')?.value;
      if (!surfaceInput || !shapeInput) return null;
      const u = parseFloat(params.u) || 0;
      const v = parseFloat(params.v) || 0;
      
      const face = surfaceInput.faces ? surfaceInput.faces[0] : (typeof surfaceInput.face === 'function' ? surfaceInput.face() : surfaceInput);
      if (face && face.pointOnSurface) {
        const pt = face.pointOnSurface(u, v);
        let center = [0, 0, 0];
        if (shapeInput.boundingBox) {
          center = shapeInput.boundingBox.center;
        }
        return shapeInput.translate([pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]]);
      }
      return shapeInput ? shapeInput.clone() : null;
    }
    case 'ScatterOnSurface': {
      const surface = inputs.find(i => i.targetHandle === 'surface')?.value;
      const shape = inputs.find(i => i.targetHandle === 'shape')?.value;
      if (!surface || !shape) return shape ? shape.clone() : null;

      const count = parseInt(params.count) || 10;
      const seed = num(params.seed, 1);
      const scaleMin = num(params.scaleMin, 1);
      const scaleMax = num(params.scaleMax, 1);
      const includeBase = params.includeBase !== false && params.includeBase !== 'false';

      let s = seed;
      const random = () => {
        const x = Math.sin(s++) * 10000;
        return x - Math.floor(x);
      };

      // Select the largest face by area (for a cylinder, this is the curved tube side)
      const faces = surface.faces || [];
      let face = faces[0] || surface;
      if (faces.length > 1) {
        const sorted = [...faces].sort((a, b) => {
          const areaA = typeof a.area === 'number' ? a.area : 0;
          const areaB = typeof b.area === 'number' ? b.area : 0;
          return areaB - areaA;
        });
        face = sorted[0];
      }

      const shapeArray = [];
      if (includeBase) {
        shapeArray.push(surface.clone());
      }

      for (let i = 0; i < count; i++) {
        const u = random();
        const v = random();
        
        let x = 0, y = 0, z = 0;
        if (face && typeof face.pointOnSurface === 'function') {
          try {
            const pt = face.pointOnSurface(u, v);
            x = pt[0];
            y = pt[1];
            z = pt[2];
          } catch (e) {
            const bbox = surface.boundingBox;
            const [minPt, maxPt] = bbox.bounds;
            x = minPt[0] + u * (maxPt[0] - minPt[0]);
            y = minPt[1] + v * (maxPt[1] - minPt[1]);
            z = minPt[2] + u * (maxPt[2] - minPt[2]);
          }
        } else {
          const bbox = surface.boundingBox;
          const [minPt, maxPt] = bbox.bounds;
          x = minPt[0] + u * (maxPt[0] - minPt[0]);
          y = minPt[1] + v * (maxPt[1] - minPt[1]);
          z = minPt[2] + u * (maxPt[2] - minPt[2]);
        }

        const scaleVal = scaleMin + random() * (scaleMax - scaleMin);
        const scaled = scaleVal !== 1 ? safeScale(shape, scaleVal) : null;
        const targetShape = scaled || shape;

        let center = [0, 0, 0];
        if (targetShape.boundingBox) {
          center = targetShape.boundingBox.center;
        }

        const translated = safeTranslate(targetShape, [x - center[0], y - center[1], z - center[2]]);
        shapeArray.push(translated);
        if (scaled) {
          try { scaled.delete(); } catch(e) {}
        }
      }
      return makeCompound(shapeArray);
    }
    case 'Align': {
      const shapeInput = inputs.find(i => i.targetHandle === 'shape')?.value;
      if (!shapeInput) return null;
      const refInput = inputs.find(i => i.targetHandle === 'reference')?.value;
      const mode = String(params.mode || 'above').toLowerCase();
      const ox = parseFloat(params.offsetX) || 0;
      const oy = parseFloat(params.offsetY) || 0;
      const oz = parseFloat(params.offsetZ) || 0;

      const sb = shapeInput.boundingBox;
      if (!sb || !sb.bounds) return shapeInput.clone();
      const [smin, smax] = sb.bounds;
      const sc = sb.center;

      let dx = ox, dy = oy, dz = oz;
      if (mode === 'ground' || !refInput) {
        // Sit the shape's bottom on Z=0 (plus offsets); XY unchanged.
        dz += -smin[2];
      } else {
        const rb = refInput.boundingBox;
        if (!rb || !rb.bounds) return shapeInput.clone();
        const [rmin, rmax] = rb.bounds;
        const rc = rb.center;
        switch (mode) {
          case 'below':
            dx += rc[0] - sc[0]; dy += rc[1] - sc[1]; dz += rmin[2] - smax[2]; break;
          case 'right': // +X side of the reference
            dx += rmax[0] - smin[0]; dy += rc[1] - sc[1]; dz += rc[2] - sc[2]; break;
          case 'left': // -X side
            dx += rmin[0] - smax[0]; dy += rc[1] - sc[1]; dz += rc[2] - sc[2]; break;
          case 'back': // +Y side
            dx += rc[0] - sc[0]; dy += rmax[1] - smin[1]; dz += rc[2] - sc[2]; break;
          case 'front': // -Y side
            dx += rc[0] - sc[0]; dy += rmin[1] - smax[1]; dz += rc[2] - sc[2]; break;
          case 'center':
            dx += rc[0] - sc[0]; dy += rc[1] - sc[1]; dz += rc[2] - sc[2]; break;
          case 'above':
          default:
            dx += rc[0] - sc[0]; dy += rc[1] - sc[1]; dz += rmax[2] - smin[2]; break;
        }
      }
      return safeTranslate(shapeInput, [dx, dy, dz]);
    }
    case 'Translate': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;

      const xVal = parseParamToNumberOrList(params.x, 0);
      const yVal = parseParamToNumberOrList(params.y, 0);
      const zVal = parseParamToNumberOrList(params.z, 0);
      
      const isArray = Array.isArray(xVal) || Array.isArray(yVal) || Array.isArray(zVal);
      if (!isArray) {
        return safeTranslate(solidInput, [xVal as number, yVal as number, zVal as number]);
      }
      
      const xArr = Array.isArray(xVal) ? xVal : [xVal];
      const yArr = Array.isArray(yVal) ? yVal : [yVal];
      const zArr = Array.isArray(zVal) ? zVal : [zVal];
      const maxLen = Math.max(xArr.length, yArr.length, zArr.length);
      
      const shapes = [];
      for (let i = 0; i < maxLen; i++) {
        const x = xArr[Math.min(i, xArr.length - 1)];
        const y = yArr[Math.min(i, yArr.length - 1)];
        const z = zArr[Math.min(i, zArr.length - 1)];
        shapes.push(safeTranslate(solidInput, [x, y, z]));
      }
      return makeCompound(shapes);
    }
    case 'Rotate': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      
      const angleVal = parseParamToNumberOrList(params.angle, 0);
      const axVal = parseParamToNumberOrList(params.axisX, 0);
      const ayVal = parseParamToNumberOrList(params.axisY, 0);
      const azVal = parseParamToNumberOrList(params.axisZ, 1);
      
      const isLocal = params.isLocal === true || params.isLocal === 'true';
      let center = [0, 0, 0];
      if (isLocal && solidInput.boundingBox) {
        center = solidInput.boundingBox.center;
      }
      
      const isArray = Array.isArray(angleVal) || Array.isArray(axVal) || Array.isArray(ayVal) || Array.isArray(azVal);
      if (!isArray) {
        const axis = [axVal as number, ayVal as number, azVal as number];
        const axisDir: [number, number, number] = (axis[0] === 0 && axis[1] === 0 && axis[2] === 0) ? [0, 0, 1] : axis as [number, number, number];
        return safeRotate(solidInput, angleVal as number, center as [number, number, number], axisDir);
      }
      
      const angleArr = Array.isArray(angleVal) ? angleVal : [angleVal];
      const axArr = Array.isArray(axVal) ? axVal : [axVal];
      const ayArr = Array.isArray(ayVal) ? ayVal : [ayVal];
      const azArr = Array.isArray(azVal) ? azVal : [azVal];
      const maxLen = Math.max(angleArr.length, axArr.length, ayArr.length, azArr.length);
      
      const shapes = [];
      for (let i = 0; i < maxLen; i++) {
        const angle = angleArr[Math.min(i, angleArr.length - 1)];
        const ax = axArr[Math.min(i, axArr.length - 1)];
        const ay = ayArr[Math.min(i, ayArr.length - 1)];
        const az = azArr[Math.min(i, azArr.length - 1)];
        const axis = [ax, ay, az];
        const axisDir: [number, number, number] = (axis[0] === 0 && axis[1] === 0 && axis[2] === 0) ? [0, 0, 1] : axis as [number, number, number];
        shapes.push(safeRotate(solidInput, angle, center as [number, number, number], axisDir));
      }
      return makeCompound(shapes);
    }
    case 'Scale': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      
      const factorVal = parseParamToNumberOrList(params.factor, 1);
      const isLocal = params.isLocal === true || params.isLocal === 'true';
      let center = [0, 0, 0];
      if (isLocal && solidInput.boundingBox) {
        center = solidInput.boundingBox.center;
      }
      
      if (!Array.isArray(factorVal)) {
        const factor = Math.max(0.01, factorVal);
        return safeScale(solidInput, factor, center as [number, number, number]);
      }
      
      const shapes = [];
      for (let i = 0; i < factorVal.length; i++) {
        const factor = Math.max(0.01, factorVal[i]);
        shapes.push(safeScale(solidInput, factor, center as [number, number, number]));
      }
      return makeCompound(shapes);
    }
    case 'Fillet': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const r = parseFloat(params.radius) || 1;
      try {
        return solidInput.fillet(r);
      } catch (err) {
        console.warn("Fillet failed:", err);
        warn(`Fillet radius ${r} failed (likely larger than an adjacent edge/thickness) — passed the solid through UNFILLETED. Reduce the radius if rounding matters.`);
        return solidInput.clone();
      }
    }
    case 'Chamfer': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const r = parseFloat(params.radius) || 1;
      try {
        return solidInput.chamfer(r);
      } catch (err) {
        console.warn("Chamfer failed:", err);
        warn(`Chamfer distance ${r} failed (likely too large for the solid) — passed the solid through UNCHAMFERED. Reduce it if the bevel matters.`);
        return solidInput.clone();
      }
    }
    case 'Extrude': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const h = parseFloat(params.height) || 10;
      // Taper/twist ride along on replicad's own extrude() options (extrusionProfile,
      // twistAngle) — no extra kernel work, just exposing what was already there.
      const endFactor = Math.max(0.02, num(params.taperEndFactor, 1));
      const profileName = params.taperProfile === 'sCurve' ? 's-curve' : 'linear';
      const twist = num(params.twistAngle, 0);
      const hasTaper = Math.abs(endFactor - 1) > 1e-6;
      const hasTwist = Math.abs(twist) > 1e-6;
      try {
        if (hasTaper || hasTwist) {
          const opts: any = {};
          if (hasTaper) opts.extrusionProfile = { profile: profileName, endFactor };
          if (hasTwist) opts.twistAngle = twist;
          return solidInput.extrude(h, opts);
        }
        return solidInput.extrude(h);
      } catch (err) {
        console.warn("Extrude failed:", err);
        warn(`Extrude failed (input is probably already a 3D solid, not a 2D face/sketch) — passed the input through UNCHANGED.`);
        return solidInput.clone();
      }
    }
    case 'Mirror': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const plane = params.plane || 'YZ';
      try {
        return solidInput.mirror(plane);
      } catch (err) {
        console.warn("Mirror failed:", err);
        warn(`Mirror across "${plane}" failed — passed the solid through UNMIRRORED.`);
        return solidInput.clone();
      }
    }
    case 'Sketch': {
      const svgPath = params.svgPath || 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
      try {
        return parseSVGPath(svgPath);
      } catch (err: any) {
        console.warn("Sketch failed:", err);
        warn(`Sketch failed: ${String(err?.message || err)}. Check the svgPath string (supported: M L H V C Q Z).`);
        return null;
      }
    }
    case 'Pipe': {
      const pathSvg = String(params.pathSvg || 'M 0 0 C 5 10 15 10 20 0');
      const radius = Math.max(0.02, num(params.radius, 1));
      try {
        // Path: same M/L/C/Q parser as Sketch, just without a closing Z (open wire).
        const pathSketch = parseSVGPath(pathSvg);
        const wiresRaw = (pathSketch as any).wires();
        const wireObj = Array.isArray(wiresRaw) ? wiresRaw[0] : wiresRaw;
        if (!wireObj) { warn(`Pipe failed: path produced no wire (check pathSvg).`); return null; }
        const wire = wireObj.wrapped;

        // Orient the circular profile to the path's own initial tangent
        // (drawCircle().sketchOnPlane('YZ') faces +X by default) and move it
        // to the path's start point, so the sweep isn't degenerate/edge-on for
        // paths that don't happen to start out heading along +X.
        const pts = extractFirstTwoPathPoints(pathSvg);
        let angleDeg = 0;
        if (pts.length >= 2) {
          const dx = pts[1][0] - pts[0][0], dy = pts[1][1] - pts[0][1];
          if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) angleDeg = Math.atan2(dy, dx) * 180 / Math.PI;
        }
        let profile = (replicad.drawCircle(radius).sketchOnPlane('YZ') as any).face();
        if (Math.abs(angleDeg) > 1e-9) profile = safeRotate(profile, angleDeg, [0, 0, 0], [0, 0, 1]);
        const start = pts[0] || [0, 0];
        if (Math.abs(start[0]) > 1e-9 || Math.abs(start[1]) > 1e-9) profile = safeTranslate(profile, [start[0], start[1], 0]);

        const OC = (replicad as any).getOC();
        const maker = new OC.BRepOffsetAPI_MakePipe_1(wire, profile.wrapped);
        return replicad.cast(maker.Shape());
      } catch (err: any) {
        console.warn("Pipe failed:", err);
        warn(`Pipe failed: ${String(err?.message || err)}. Check the pathSvg string (M L C Q, no closing Z) and that radius is reasonable relative to the path's curvature.`);
        return null;
      }
    }
    case 'Compound': {
      const shapes = inputs
        .filter(i => i.targetHandle.startsWith('solid'))
        .map(i => i.value)
        .filter(Boolean);
      if (shapes.length === 0) return null;
      
      const uniqueShapes = [];
      const seen = new Set();
      for (const s of shapes) {
        if (!seen.has(s)) {
          seen.add(s);
          uniqueShapes.push(s);
        }
      }
      
      if (uniqueShapes.length === 1) return uniqueShapes[0].clone();
      try {
        return replicad.makeCompound(uniqueShapes);
      } catch (err: any) {
        console.warn("Compound failed:", err);
        warn(`Compound failed: ${String(err?.message || err)}.`);
        return null;
      }
    }
    case 'Text3D': {
      const txt = params.text || "C3D";
      const size = parseFloat(params.size) || 10;
      const h = parseFloat(params.height) || 2;
      try {
        return sketchText(txt, { fontSize: size }).extrude(h);
      } catch (err: any) {
        console.warn("Text3D failed:", err);
        warn(`Text3D failed: ${String(err?.message || err)}.`);
        return null;
      }
    }
    case 'Shell': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const thickness = parseFloat(params.thickness) || 1;
      const removeBottom = params.removeBottomFace === true || params.removeBottomFace === 'true';
      try {
        if (removeBottom) {
          return solidInput.shell(thickness, (f: any) => f.inPlane("XY", 0));
        }
        return solidInput.shell(thickness);
      } catch (err) {
        console.warn("Shell failed:", err);
        warn(`Shell (thickness ${thickness}) failed (too thick for the solid, or unsupported topology) — passed the solid through UNSHELLED/solid.`);
        return solidInput.clone();
      }
    }
    case 'Loft': {
      const profiles = ['profile1', 'profile2', 'profile3', 'profile4']
        .map(h => inputs.find(i => i.targetHandle === h)?.value)
        .filter(Boolean);
      if (profiles.length < 2) return null;
      try {
        // loftWith accepts a single face or an array of subsequent faces
        return profiles[0].loftWith(profiles.slice(1).length === 1 ? profiles[1] : profiles.slice(1));
      } catch (err: any) {
        console.warn("Loft failed:", err);
        warn(`Loft failed: ${String(err?.message || err)}. Profiles must be 2D faces/sketches (Plane, Sketch, drawn circles), not 3D solids.`);
        return null;
      }
    }
    case 'Revolve': {
      const profile = inputs.find(i => i.targetHandle === 'profile')?.value;
      if (!profile) return null;
      const angleDeg = Math.max(1, Math.min(360, parseFloat(params.angle) || 360));
      const axisName = (params.axis || 'Z').toUpperCase();
      const axis: [number, number, number] = axisName === 'X' ? [1, 0, 0] : axisName === 'Y' ? [0, 1, 0] : [0, 0, 1];
      try {
        // replicad face.revolve(direction?, origin?, angleConfig?)
        if (angleDeg >= 360) {
          return (profile as any).revolve(axis);
        }
        return (profile as any).revolve(axis, [0, 0, 0], { angle: angleDeg });
      } catch (err: any) {
        console.warn("Revolve failed:", err);
        warn(`Revolve failed: ${String(err?.message || err)}. The profile must be a 2D face/sketch, and it must not cross the revolve axis.`);
        return null;
      }
    }
    case 'LinearPattern': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const count = parseInt(params.count) || 3;
      const dx = parseFloat(params.directionX) || 15;
      const dy = parseFloat(params.directionY) || 0;
      const dz = parseFloat(params.directionZ) || 0;
      const copies = [];
      for (let i = 0; i < count; i++) {
        copies.push(safeTranslate(solidInput, [i * dx, i * dy, i * dz]));
      }
      return makeCompound(copies);
    }
    case 'CircularPattern': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      const count = parseInt(params.count) || 4;
      const r = num(params.radius, 20);
      const totalAngle = num(params.angle, 360);
      const startAngle = num(params.startAngle, 0);
      const rise = num(params.rise, 0);              // z lift per copy → spirals
      const scaleStart = Math.max(0.01, num(params.scaleStart, 1));
      const scaleEnd = Math.max(0.01, num(params.scaleEnd, 1));
      const copies = [];
      const angleStep = totalAngle / count;
      for (let i = 0; i < count; i++) {
        const t = count > 1 ? i / (count - 1) : 0;
        const s = scaleStart + (scaleEnd - scaleStart) * t;
        // Scale each instance around its own center so the graded copies stay
        // in place instead of drifting toward/away from the origin.
        let inst = solidInput;
        let scaled: any = null;
        if (Math.abs(s - 1) > 1e-9) {
          const c = solidInput.boundingBox ? solidInput.boundingBox.center : [0, 0, 0];
          scaled = safeScale(solidInput, s, c as [number, number, number]);
          inst = scaled;
        }
        const deg = startAngle + i * angleStep;
        const a = (deg * Math.PI) / 180;
        const x = r * Math.cos(a);
        const y = r * Math.sin(a);
        const translated = safeTranslate(inst, [x, y, i * rise]);
        const copy = safeRotate(translated, deg, [x, y, i * rise], [0, 0, 1]);
        copies.push(copy);
        try { translated.delete(); } catch(e) {}
        if (scaled) { try { scaled.delete(); } catch(e) {} }
      }
      return makeCompound(copies);
    }
    case 'PlaceOnVertices': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      const shapeInput = inputs.find(i => i.targetHandle === 'shape')?.value;
      if (!solidInput || !shapeInput) return null;
      
      const scaleMin = num(params.scaleMin, 1);
      const scaleMax = num(params.scaleMax, 1);
      const includeBase = params.includeBase !== false && params.includeBase !== 'false';

      try {
        const ocVertices = (solidInput as any)._listTopo("vertex");
        if (!ocVertices || ocVertices.length === 0) return null;

        const placedShapes = ocVertices.map((ocV: any, idx: number) => {
          const v = new (replicad as any).Vertex(ocV);
          const [x, y, z] = v.asTuple();
          
          const r = (Math.sin(idx + 5.67) * 10000) % 1;
          const scaleVal = scaleMin + Math.abs(r) * (scaleMax - scaleMin);
          
          const scaled = scaleVal !== 1 ? safeScale(shapeInput, scaleVal) : null;
          const targetShape = scaled || shapeInput;

          let center = [0, 0, 0];
          if (targetShape.boundingBox) {
            center = targetShape.boundingBox.center;
          }
          const translated = safeTranslate(targetShape, [x - center[0], y - center[1], z - center[2]]);
          if (scaled) {
            try { scaled.delete(); } catch(e) {}
          }
          return translated;
        });

        if (includeBase) {
          placedShapes.unshift(solidInput.clone());
        }

        return makeCompound(placedShapes);
      } catch (err: any) {
        console.warn("PlaceOnVertices failed:", err);
        warn(`PlaceOnVertices failed: ${String(err?.message || err)}.`);
        return null;
      }
    }
    case 'Boolean': {
      const target = inputs.find(i => i.targetHandle === 'target')?.value;
      const tool = inputs.find(i => i.targetHandle === 'tool')?.value;
      if (!target || !tool) return target ? target.clone() : (tool ? tool.clone() : null);
      
      const op = params.operation || 'union';
      if (op === 'union') return target.fuse(tool);
      if (op === 'difference') return target.cut(tool);
      if (op === 'intersect') return target.intersect(tool);
      return target.clone();
    }
    case 'SubdivideSurface': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      
      const uDivs = Math.max(1, parseInt(params.uDivisions) || 3);
      const vDivs = Math.max(1, parseInt(params.vDivisions) || 3);
      const inset = Math.max(0, Math.min(0.99, num(params.inset, 0)));
      const extrudeMin = num(params.extrudeMin, 0.5);
      const extrudeMax = num(params.extrudeMax, 0.5);
      const seed = num(params.seed, 1);
      const includeBase = params.includeBase === true || params.includeBase === 'true';
      const fiParsed = parseInt(params.faceIndex);
      const faceIndex = isFinite(fiParsed) ? fiParsed : -1;
      
      const OC = (replicad as any).getOC();
      
      const faces = solidInput.faces || [];
      if (faces.length === 0) return solidInput;
      
      let s = seed;
      const random = () => {
        const x = Math.sin(s++) * 10000;
        return x - Math.floor(x);
      };
      
      const cellSolids: any[] = [];
      
      const processFace = (face: any) => {
        for (let i = 0; i < uDivs; i++) {
          for (let j = 0; j < vDivs; j++) {
            let u1 = i / uDivs;
            let u2 = (i + 1) / uDivs;
            let v1 = j / vDivs;
            let v2 = (j + 1) / vDivs;
            
            if (inset > 0) {
              const uMid = (u1 + u2) / 2;
              const vMid = (v1 + v2) / 2;
              const uHalf = (u2 - u1) / 2 * (1 - inset);
              const vHalf = (v2 - v1) / 2 * (1 - inset);
              u1 = uMid - uHalf;
              u2 = uMid + uHalf;
              v1 = vMid - vHalf;
              v2 = vMid + vHalf;
            }
            
            try {
              const A = face.pointOnSurface(u1, v1);
              const B = face.pointOnSurface(u2, v1);
              const C = face.pointOnSurface(u2, v2);
              const D = face.pointOnSurface(u1, v2);
              
              // Compute normal
              const v1x = C[0] - A[0];
              const v1y = C[1] - A[1];
              const v1z = C[2] - A[2];
              
              const v2x = D[0] - B[0];
              const v2y = D[1] - B[1];
              const v2z = D[2] - B[2];
              
              let nx = v1y * v2z - v1z * v2y;
              let ny = v1z * v2x - v1x * v2z;
              let nz = v1x * v2y - v1y * v2x;
              
              const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
              if (len > 0) {
                nx /= len;
                ny /= len;
                nz /= len;
              } else {
                nz = 1;
              }
              
              const gp_PntA = new OC.gp_Pnt(A[0], A[1], A[2]);
              const gp_PntB = new OC.gp_Pnt(B[0], B[1], B[2]);
              const gp_PntC = new OC.gp_Pnt(C[0], C[1], C[2]);
              const gp_PntD = new OC.gp_Pnt(D[0], D[1], D[2]);
              
              const edge1 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntA, gp_PntB);
              const edge2 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntB, gp_PntC);
              const edge3 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntC, gp_PntD);
              const edge4 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntD, gp_PntA);
              
              const makeWire = new OC.BRepBuilderAPI_MakeWire();
              makeWire.Add_1(edge1.Edge());
              makeWire.Add_1(edge2.Edge());
              makeWire.Add_1(edge3.Edge());
              makeWire.Add_1(edge4.Edge());
              const wire = makeWire.Wire();
              
              const makeFace = new OC.BRepBuilderAPI_MakeFace_1(wire, true);
              const faceShape = makeFace.Shape();
              const cellFace = replicad.cast(faceShape);
              
              const h = extrudeMin + random() * (extrudeMax - extrudeMin);
              if (h > 0.01) {
                const cellExtruded = (cellFace as any).extrude(h, [nx, ny, nz]);
                cellSolids.push(cellExtruded);
              } else {
                cellSolids.push(cellFace);
              }
              
              gp_PntA.delete();
              gp_PntB.delete();
              gp_PntC.delete();
              gp_PntD.delete();
              edge1.delete();
              edge2.delete();
              edge3.delete();
              edge4.delete();
              makeWire.delete();
              makeFace.delete();
            } catch (err) {
              console.warn(`Subdivision cell failed:`, err);
            }
          }
        }
      };

      if (faceIndex === -1) {
        faces.forEach(processFace);
      } else {
        const fIdx = Math.max(0, Math.min(faces.length - 1, faceIndex));
        processFace(faces[fIdx]);
      }
      
      if (includeBase) {
        cellSolids.push(solidInput.clone());
      }
      
      return replicad.makeCompound(cellSolids);
    }
    case 'FilterFaces': {
      const solidInput = inputs.find(i => i.targetHandle === 'solid')?.value;
      if (!solidInput) return null;
      
      const faces = solidInput.faces || [];
      if (faces.length === 0) return solidInput.clone();
      
      const filterType = params.axisFilter || 'maxZ';
      const direction = params.direction || 'Z';
      const index = parseInt(params.index) || 0;
      const tol = parseFloat(params.tolerance) || 0.1;
      
      let matchedFaces: any[] = [];
      
      const getCenter = (face: any): [number, number, number] => {
        if (face.boundingBox) {
          return face.boundingBox.center;
        }
        return [0, 0, 0];
      };
      
      const getNormal = (face: any): [number, number, number] => {
        try {
          const A = face.pointOnSurface(0, 0);
          const B = face.pointOnSurface(1, 0);
          const C = face.pointOnSurface(1, 1);
          const D = face.pointOnSurface(0, 1);
          const v1x = C[0] - A[0];
          const v1y = C[1] - A[1];
          const v1z = C[2] - A[2];
          const v2x = D[0] - B[0];
          const v2y = D[1] - B[1];
          const v2z = D[2] - B[2];
          let nx = v1y * v2z - v1z * v2y;
          let ny = v1z * v2x - v1x * v2z;
          let nz = v1x * v2y - v1y * v2x;
          const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
          return len > 0 ? [nx/len, ny/len, nz/len] : [0, 0, 1];
        } catch (e) {
          return [0, 0, 1];
        }
      };
      
      if (filterType === 'index') {
        const idx = Math.max(0, Math.min(faces.length - 1, index));
        matchedFaces.push(faces[idx].clone());
      } else if (filterType === 'direction') {
        faces.forEach((face: any) => {
          const [nx, ny, nz] = getNormal(face);
          if (direction === 'Z' && Math.abs(nz) > 1 - tol) {
            matchedFaces.push(face.clone());
          } else if (direction === 'X' && Math.abs(nx) > 1 - tol) {
            matchedFaces.push(face.clone());
          } else if (direction === 'Y' && Math.abs(ny) > 1 - tol) {
            matchedFaces.push(face.clone());
          }
        });
      } else {
        // Find max/min coordinates
        let bestFace = faces[0];
        let bestVal = (filterType === 'minZ' || filterType === 'minX' || filterType === 'minY') ? Infinity : -Infinity;
        
        faces.forEach((face: any) => {
          const center = getCenter(face);
          let val = 0;
          if (filterType === 'maxZ' || filterType === 'minZ') val = center[2];
          if (filterType === 'maxX' || filterType === 'minX') val = center[0];
          if (filterType === 'maxY' || filterType === 'minY') val = center[1];
          
          if (filterType === 'maxZ' || filterType === 'maxX' || filterType === 'maxY') {
            if (val > bestVal) {
              bestVal = val;
              bestFace = face;
            }
          } else {
            if (val < bestVal) {
              bestVal = val;
              bestFace = face;
            }
          }
        });
        
        matchedFaces.push(bestFace.clone());
      }
      
      if (matchedFaces.length === 0) return null;
      if (matchedFaces.length === 1) return matchedFaces[0];
      return replicad.makeCompound(matchedFaces);
    }
    default:
      return null;
  }
}

// Grabs just the first two anchor points of an SVG-style path (M's start point,
// then the endpoint of the next L/C/Q command) — enough to compute the path's
// initial tangent direction for orienting a Pipe's profile. Ignores curve
// control points deliberately (only need the start->end chord of the first
// segment, not its exact curvature).
function extractFirstTwoPathPoints(pathStr: string): [number, number][] {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g) || [];
  const pts: [number, number][] = [];
  let i = 0;
  while (i < tokens.length && pts.length < 2) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l') {
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else if (cmd === 'C' || cmd === 'c') {
      i += 4; // skip both control points
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else if (cmd === 'Q' || cmd === 'q') {
      i += 2; // skip control point
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else {
      break;
    }
  }
  return pts;
}

// Basic SVG Path string parser for AI generated paths
function parseSVGPath(pathStr: string) {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g);
  if (!tokens || tokens.length === 0) return new replicad.Sketcher("XY").done();

  let sketch = new replicad.Sketcher("XY");
  let i = 0;
  let currentPos: [number, number] = [0, 0];

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/[MmLlHhVvCcQqZzAa]/.test(cmd)) {
      i++;
      const isRel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';
      
      switch (cmd.toUpperCase()) {
        case 'M': {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.movePointerTo(currentPos);
          break;
        }
        case 'L': {
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.lineTo(currentPos);
          break;
        }
        case 'H': {
          const x = parseFloat(tokens[i++]);
          currentPos[0] = isRel ? currentPos[0] + x : x;
          sketch.lineTo(currentPos);
          break;
        }
        case 'V': {
          const y = parseFloat(tokens[i++]);
          currentPos[1] = isRel ? currentPos[1] + y : y;
          sketch.lineTo(currentPos);
          break;
        }
        case 'C': {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x2 = parseFloat(tokens[i++]);
          const y2 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          
          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          const cp2: [number, number] = isRel ? [currentPos[0] + x2, currentPos[1] + y2] : [x2, y2];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          
          sketch.cubicBezierCurveTo(currentPos, cp1, cp2);
          break;
        }
        case 'Q': {
          const x1 = parseFloat(tokens[i++]);
          const y1 = parseFloat(tokens[i++]);
          const x = parseFloat(tokens[i++]);
          const y = parseFloat(tokens[i++]);
          
          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          
          sketch.quadraticBezierCurveTo(currentPos, cp1);
          break;
        }
        case 'Z':
        case 'z': {
          sketch.close();
          break;
        }
        default: {
          // Unhandled or skip (like A for arcs which is complex)
          break;
        }
      }
    } else {
      i++; // Skip unknown
    }
  }

  return sketch.done();
}

function parseParamToNumberOrList(val: any, fallback = 0): number | number[] {
  if (Array.isArray(val)) return val;
  if (val === undefined || val === null) return fallback;
  const parsed = parseFloat(val);
  return isFinite(parsed) ? parsed : fallback;
}

function evaluateExpressionWithLists(formula: string, vars: Record<string, number | number[]>): number | number[] {
  let isArray = false;
  let maxLen = 1;
  for (const val of Object.values(vars)) {
    if (Array.isArray(val)) {
      isArray = true;
      maxLen = Math.max(maxLen, val.length);
    }
  }

  if (!isArray) {
    return evaluateExpressionSafe(formula, vars as Record<string, number>);
  }

  const result: number[] = [];
  for (let i = 0; i < maxLen; i++) {
    const localVars: Record<string, number> = {};
    for (const [k, val] of Object.entries(vars)) {
      if (Array.isArray(val)) {
        localVars[k] = val[Math.min(i, val.length - 1)];
      } else {
        localVars[k] = val;
      }
    }
    try {
      result.push(evaluateExpressionSafe(formula, localVars));
    } catch (e) {
      result.push(0);
    }
  }
  return result;
}
