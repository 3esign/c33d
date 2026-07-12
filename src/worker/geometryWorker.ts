import opencascade from 'replicad-opencascadejs';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import * as replicad from 'replicad';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import { evaluateExpression as evaluateExpressionSafe, normalizeVarName } from '../utils/expression';
import { EXECUTORS, ensureText3DFont } from './executors';
import { classifyNodeError, isKernelClass } from './errorClass';

const TRANSFORM_TYPES = new Set([
  'Translate', 'Rotate', 'Scale', 'ScaleXYZ', 'Bend', 'Twist', 'Align',
  'PlaceOnSurface', 'ScatterOnSurface', 'PlaceOnVertices', 'Fillet', 'Chamfer',
  'Extrude', 'Mirror', 'Shell', 'Loft', 'Revolve', 'LinearPattern',
  'CircularPattern', 'SubdivideSurface', 'FilterFaces'
]);

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

// Resolves a source value, supporting multi-output `{ __multi: true, values }` records.
export function resolveSourceValue(
  sourceId: string,
  sourceHandle: string | undefined,
  nodeCache: Record<string, any>,
  numberCache: Record<string, any>
): any {
  const val = nodeCache[sourceId] !== undefined ? nodeCache[sourceId] : numberCache[sourceId];
  if (val === undefined) return undefined;
  
  if (val && typeof val === 'object' && val.__multi) {
    if (sourceHandle) {
      return val.values[sourceHandle];
    }
    return undefined;
  }
  return val;
}

// Recursively walks objects/arrays to collect all actual replicad shapes for safe eviction.
export function collectShapes(val: any, out = new Set<any>()): Set<any> {
  if (!val) return out;
  if (val.wrapped && typeof val.delete === 'function') {
    out.add(val);
    return out;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectShapes(item, out);
  } else if (typeof val === 'object') {
    for (const key of Object.keys(val)) collectShapes(val[key], out);
  }
  return out;
}

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
    kernelHealth = runKernelCanary();
    postMessage({ type: 'INIT_DONE', kernelHealth });
  } catch (err: any) {
    console.error('Failed to initialize OpenCascade:', err);
    postMessage({ type: 'INIT_ERROR', error: err.message || 'Unknown initialization error' });
    throw err;
  }
}

// Deformation and transformation helpers have been moved to deformation.ts

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
      // Text3D needs a font registered before its executor runs (executors are
      // synchronous). Macros may hide Text3D nodes, so check their JSON too.
      const needsFont =
        (payload.nodes || []).some((n: any) => n.type === 'Text3D') ||
        JSON.stringify(payload.macros || []).includes('"Text3D"');
      if (needsFont) await ensureText3DFont();

      const { meshes, report, runPerturbation } = await evaluateGraph(payload.nodes, payload.edges, payload.macros || [], payload.disablePerturbation);
      postMessage({ type: 'EVALUATE_DONE', id, result: meshes, report });
      if (runPerturbation) {
        runPerturbation(id).catch(err => console.warn("Perturbation failed:", err));
      }
    } catch (err: any) {
      postMessage({ type: 'EVALUATE_ERROR', id, error: err.message || 'Unknown error during graph evaluation' });
    }
  } else if (type === 'CLEAR_CACHE') {
    shapeCache.clear();
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
const WORKER_RECYCLE_HINT = 50; // after this many evals, suggest recycle to main thread.
// Shape deletion is disabled (see the eviction mitigation below), so WASM heap
// growth is contained ONLY by recycling — 400 was calibrated for nothing.

// ---------- Kernel health (canary + poisoned-instance detection) ----------
// Node types that produced a real shape at least once in this worker's
// lifetime. If such a type later fails with a kernel-class error, the WASM
// instance has regressed (heap corruption / OOM), not the graph.
const succeededTypesThisWorker = new Set<string>();

let kernelHealth: 'ok' | 'failed' | 'unknown' = 'unknown';

// Evaluates a hardcoded Box completely outside the user graph. If THIS fails,
// no graph edit can succeed — the report says so explicitly, which removes the
// entire "which primitive still works" search space from the model.
function runKernelCanary(): 'ok' | 'failed' {
  try {
    const box = (EXECUTORS as any).Box({ width: 10, length: 10, height: 10 }, [], () => {}, {});
    if (!box) return 'failed';
    try {
      box.mesh({ tolerance: 0.5, angularTolerance: 30 });
    } catch {
      return 'failed';
    }
    return 'ok';
  } catch {
    return 'failed';
  }
}

function stableHash(obj: any): string {
  // Order-stable JSON for plain param objects
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj !== 'object') return String(obj);
  if (Array.isArray(obj)) return '[' + obj.map(stableHash).join(',') + ']';
  return '{' + Object.keys(obj).sort().map(k => k + ':' + stableHash(obj[k])).join(',') + '}';
}

async function evaluateGraphInternal(
  rawNodes: any[],
  rawEdges: any[],
  macros: any[],
  sliderScopeOverride: Record<string, number> | null = null,
  customShapeCache: Map<string, { hash: string; shape: any; mesh: any | null }> = shapeCache,
  skipMeshing = false
) {
  const { nodes: allNodes, edges, aliasMap } = expandMacros(rawNodes, rawEdges, macros);
  // Group container nodes are visual only
  const nodes = allNodes.filter(n => n.type !== 'group');

  const nodeCache: Record<string, any> = {};
  const numberCache: Record<string, number | number[]> = {};
  const nodeErrors: { id: string; error: string; cls?: string }[] = [];
  let kernelFaultCount = 0;
  let kernelRegression = false;

  // Scope for inline parametric formulas: slider values keyed by (normalized)
  // label AND id, so a param like "bodyRadius*0.2" resolves without any edges.
  const sliderScope: Record<string, number> = {};
  const normalizedLabelsSeen: Record<string, { original: string; id: string }> = {};

  for (const n of nodes) {
    if (n.type !== 'NumberSlider') continue;
    const defaultVal = parseFloat((n.data || {}).value);
    const normId = normalizeVarName(n.id);
    const rawIdOverride = sliderScopeOverride
      ? (sliderScopeOverride[normId] ?? sliderScopeOverride[n.id.toLowerCase()] ?? sliderScopeOverride[n.id])
      : undefined;
    const v = (rawIdOverride !== undefined) ? rawIdOverride : (isFinite(defaultVal) ? defaultVal : 0);

    const label = String((n.data || {}).label ?? '').trim();
    if (label) {
      const normLabel = normalizeVarName(label);
      if (normalizedLabelsSeen[normLabel]) {
        nodeErrors.push({
          id: n.id,
          error: `Slider label "${label}" normalizes to "${normLabel}", which collides with slider "${normalizedLabelsSeen[normLabel].original}" (ID: ${normalizedLabelsSeen[normLabel].id}). Labels must normalize to unique alphanumeric identifiers.`
        });
      } else {
        normalizedLabelsSeen[normLabel] = { original: label, id: n.id };
      }
      const rawLabelOverride = sliderScopeOverride
        ? (sliderScopeOverride[normLabel] ?? sliderScopeOverride[label.toLowerCase()] ?? sliderScopeOverride[label])
        : undefined;
      sliderScope[normLabel] = (rawLabelOverride !== undefined) ? rawLabelOverride : v;
    }
    sliderScope[normId] = v;
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
        const v = resolveSourceValue(e.source, e.sourceHandle, nodeCache, numberCache);
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
      const defaultVal = parseFloat(effectiveParams.value);
      const normId = normalizeVarName(node.id);
      const rawOverride = sliderScopeOverride
        ? (sliderScopeOverride[normId] ?? sliderScopeOverride[node.id.toLowerCase()] ?? sliderScopeOverride[node.id])
        : undefined;
      const v = (rawOverride !== undefined) ? rawOverride : (isFinite(defaultVal) ? defaultVal : 0);
      numberCache[node.id] = v;
      continue;
    }
    if (node.type === 'Expression') {
      const vars: Record<string, number | number[]> = {};
      for (const e of incoming) {
        if (e.targetHandle && !String(e.targetHandle).startsWith('param:')) {
          const v = resolveSourceValue(e.source, e.sourceHandle, nodeCache, numberCache);
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
      const start = getNumericInputOrParam('start', 0, incoming, effectiveParams, numberCache, nodeCache);
      const step = getNumericInputOrParam('step', 1, incoming, effectiveParams, numberCache, nodeCache);
      const count = Math.max(1, Math.round(getNumericInputOrParam('count', 5, incoming, effectiveParams, numberCache, nodeCache)));
      
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(start + i * step);
      }
      numberCache[node.id] = values;
      continue;
    }
    if (node.type === 'Range') {
      const min = getNumericInputOrParam('min', 0, incoming, effectiveParams, numberCache, nodeCache);
      const max = getNumericInputOrParam('max', 10, incoming, effectiveParams, numberCache, nodeCache);
      const steps = Math.max(1, Math.round(getNumericInputOrParam('steps', 5, incoming, effectiveParams, numberCache, nodeCache)));
      
      const values: number[] = [];
      for (let i = 0; i <= steps; i++) {
        values.push(min + (i / steps) * (max - min));
      }
      numberCache[node.id] = values;
      continue;
    }
    if (node.type === 'ListItem') {
      let listVal: number[] = [];
      const listEdge = incoming.find(e => e.targetHandle === 'list');
      if (listEdge) {
        const v = resolveSourceValue(listEdge.source, listEdge.sourceHandle, nodeCache, numberCache);
        if (v !== undefined) {
          listVal = Array.isArray(v) ? v : [v];
        }
      }
      const index = Math.round(getNumericInputOrParam('index', 0, incoming, effectiveParams, numberCache, nodeCache));
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
        const v = resolveSourceValue(listEdge.source, listEdge.sourceHandle, nodeCache, numberCache);
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

    const cached = customShapeCache.get(node.id);
    if (cached && cached.hash === hash && cached.shape) {
      nodeCache[node.id] = cached.shape;
      continue;
    }

    const nodeInputs = geoInputs.map(e => ({
      targetHandle: e.targetHandle,
      value: resolveSourceValue(e.source, e.sourceHandle, nodeCache, numberCache)
    }));

    try {
      const val = executeNode(
        { ...node, data: effectiveParams },
        nodeInputs,
        (msg: string) => nodeErrors.push({ id: node.id, error: msg }),
        sliderScope
      );
      nodeCache[node.id] = val;
      if (val) succeededTypesThisWorker.add(node.type);
      if (val && typeof val === 'object') {
        val.sourceNodeId = node.id;
        const ancestors = new Set<string>();
        for (const input of nodeInputs) {
          if (input.value && typeof input.value === 'object') {
            if (input.value.sourceNodeId) ancestors.add(input.value.sourceNodeId);
            if (input.value.ancestorNodeIds) {
              input.value.ancestorNodeIds.forEach((id: string) => ancestors.add(id));
            }
          }
        }
        val.ancestorNodeIds = Array.from(ancestors);
      }
    } catch (err: any) {
      nodeCache[node.id] = null;
      // A1: classify at the catch site — Emscripten throws raw numbers
      // (exception pointers) that would otherwise surface as opaque "24".
      const { cls, msg } = classifyNodeError(err);
      if (isKernelClass(cls)) {
        kernelFaultCount++;
        if (succeededTypesThisWorker.has(node.type)) kernelRegression = true;
      }
      nodeErrors.push({ id: node.id, error: `[${cls}] ${msg}`, cls });
    }
    customShapeCache.set(node.id, { hash, shape: nodeCache[node.id], mesh: null });
  }

  // ---------- Cache eviction (identity-safe) ----------
  const liveIds = new Set(sortedNodes.map(n => n.id));
  const retainedShapes = new Set<any>();
  for (const [id, entry] of customShapeCache) {
    if (liveIds.has(id) && entry.hash === nodeHashes[id]) collectShapes(entry.shape, retainedShapes);
  }
  for (const [id, entry] of Array.from(customShapeCache.entries())) {
    const stale = !liveIds.has(id) || entry.hash !== nodeHashes[id];
    if (stale) {
      if (entry.shape) {
        const toDelete = collectShapes(entry.shape);
        for (const s of toDelete) {
          if (!retainedShapes.has(s)) {
            // Mitigated: stop deleting to prevent TopoDS_Shape pointer corruption
            // try { s.delete?.(); } catch (e) {}
          }
        }
      }
      customShapeCache.delete(id);
    }
  }

  // ---------- Mesh leaf nodes + geometry report ----------
  const sourceNodeIds = new Set(
    edges.filter(e => !String(e.targetHandle || '').startsWith('param:') && String(e.targetHandle || '') !== 'reference')
      .map(e => e.source)
  );

  const finalMeshes: any[] = [];
  const leafReports: any[] = [];

  let sceneMin = [Infinity, Infinity, Infinity];
  let sceneMax = [-Infinity, -Infinity, -Infinity];
  for (const [_id, value] of Object.entries(nodeCache)) {
    if (!value || value.type === 'Point' || value.type === 'Vector' || value.type === 'Plane' || value.type === 'Curve' || value.type === 'Selection') continue;
    try {
      const bb = value.boundingBox;
      if (bb && bb.bounds) {
        sceneMin[0] = Math.min(sceneMin[0], bb.bounds[0][0]);
        sceneMax[0] = Math.max(sceneMax[0], bb.bounds[1][0]);
        sceneMin[1] = Math.min(sceneMin[1], bb.bounds[0][1]);
        sceneMax[1] = Math.max(sceneMax[1], bb.bounds[1][1]);
        sceneMin[2] = Math.min(sceneMin[2], bb.bounds[0][2]);
        sceneMax[2] = Math.max(sceneMax[2], bb.bounds[1][2]);
      }
    } catch(e) {}
  }
  let diag = 0;
  if (isFinite(sceneMin[0])) {
    const dx = sceneMax[0] - sceneMin[0];
    const dy = sceneMax[1] - sceneMin[1];
    const dz = sceneMax[2] - sceneMin[2];
    diag = Math.sqrt(dx*dx + dy*dy + dz*dz);
  }
  const helperSize = diag > 0 ? Math.max(0.1, diag * 0.01) : 0.25;

  for (const [id, value] of Object.entries(nodeCache)) {
    const reportId = aliasMap[id] || id;
    const node = nodes.find(n => n.id === id);
    if (!node) continue;
    if (node.type === 'NumberSlider' || node.type === 'Expression') continue;

    const isHelper = node.type === 'Point' || node.type === 'Vector' || node.type === 'Plane' || node.type === 'Curve' || node.type === 'Selection';

    if (!value) {
      if (!isHelper) {
        leafReports.push({
          id: reportId,
          bbox: null,
          volume: undefined,
          meshOk: false,
          vertexCount: 0,
          error: explainNullGeometry(id, nodes, edges, nodeCache)
        });
      }
      continue;
    }

    if (!sourceNodeIds.has(id)) {
      const entry = customShapeCache.get(id);
      let meshData = entry?.mesh || null;
      let meshError: string | null = null;
      if (!skipMeshing && !meshData) {
        try {
          if (value && value.type === 'Point') {
            const sz = helperSize;
            meshData = {
              type: 'Point',
              vertices: [
                value.x - sz, value.y, value.z,
                value.x + sz, value.y, value.z,
                value.x, value.y - sz, value.z,
                value.x, value.y + sz, value.z,
                value.x, value.y, value.z - sz,
                value.x, value.y, value.z + sz
              ],
              indices: [0, 1, 2, 3, 4, 5],
              normals: []
            };
          } else if (value && value.type === 'Curve') {
            const steps = 50;
            const vertices = [];
            const indices = [];
            for (let i = 0; i <= steps; i++) {
              const pt = value.value.pointAt(i / steps);
              vertices.push(pt[0], pt[1], pt[2]);
              if (i < steps) {
                indices.push(i, i + 1);
              }
            }
            meshData = { type: 'Line', vertices, indices, normals: [] };
          } else if (isHelper) {
            meshData = null;
          } else {
            const mesh = value.mesh({ tolerance: 0.1, angularTolerance: 30 });
            meshData = { type: 'Mesh', vertices: mesh.vertices, indices: mesh.triangles, normals: mesh.normals };
          }
          if (entry) entry.mesh = meshData;
        } catch (err: any) {
          const meshCls = classifyNodeError(err);
          if (isKernelClass(meshCls.cls)) kernelFaultCount++;
          meshError = `[${meshCls.cls}] ${meshCls.msg}`;
          console.warn(`Failed to mesh node ${id}:`, err);
        }
      }
      if (meshData) {
        finalMeshes.push({ id: reportId, hash: entry?.hash, ...meshData });
      }

      if (!isHelper) {
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
          const v = (replicad as any).measureVolume(value);
          if (typeof v === 'number' && isFinite(v)) volume = v;
        } catch (e) { /* volume unsupported */ }
  
        leafReports.push({
          id: reportId,
          bbox,
          volume,
          meshOk: skipMeshing ? true : !!meshData,
          vertexCount: meshData ? meshData.vertices.length / 3 : 0,
          error: meshError,
        });
      }
    }
  }

  // Scene extents
  sceneMin = [Infinity, Infinity, Infinity];
  sceneMax = [-Infinity, -Infinity, -Infinity];
  leafReports.forEach(l => {
    if (l.bbox) {
      for (let k = 0; k < 3; k++) {
        sceneMin[k] = Math.min(sceneMin[k], l.bbox.min[k]);
        sceneMax[k] = Math.max(sceneMax[k], l.bbox.max[k]);
      }
    }
  });
  const hasScene = isFinite(sceneMin[0]);

  // Slider inventory
  const sliderInventory: Record<string, number> = {};
  for (const n of nodes) {
    if (n.type !== 'NumberSlider') continue;
    const defaultVal = parseFloat((n.data || {}).value);
    const normId = normalizeVarName(n.id);
    const rawOverride = sliderScopeOverride
      ? (sliderScopeOverride[normId] ?? sliderScopeOverride[n.id.toLowerCase()] ?? sliderScopeOverride[n.id])
      : undefined;
    const v = (rawOverride !== undefined) ? rawOverride : (isFinite(defaultVal) ? defaultVal : 0);
    const label = String((n.data || {}).label ?? '').trim();
    sliderInventory[label || n.id] = v;
  }

  // Selections inventory for percepts
  const selections: Record<string, any> = {};
  for (const n of nodes) {
    if (n.type === 'SelectFaces' || n.type === 'SelectEdges' || n.type === 'SelectionCombine') {
      const val = nodeCache[n.id];
      if (val && val.type === 'Selection') {
        const reportId = aliasMap[n.id] || n.id;
        let warning: string | undefined = undefined;
        if (val.matchedCount === 0) {
          warning = `Selection query matched 0 elements. Under downstream modifiers, this will do nothing.`;
        } else {
          const edge = edges.find(e => e.target === n.id && (e.targetHandle === 'solid' || e.targetHandle === 'selection1'));
          if (edge) {
            const inputVal = nodeCache[edge.source];
            if (inputVal) {
              const totalElements = val.domain === 'faces' ? (inputVal.faces?.length || 0) : (inputVal.edges?.length || 0);
              if (totalElements > 0 && val.matchedCount === totalElements) {
                warning = `Selection query matched ALL ${totalElements} elements. If you wanted to filter specific features, refine the query.`;
              }
            }
          }
        }
        selections[reportId] = {
          matchedCount: val.matchedCount,
          elements: val.elements || [],
          warning
        };
      }
    }
  }

  const helpers: Record<string, any> = {};
  for (const [id, value] of Object.entries(nodeCache)) {
    if (value && (value.type === 'Point' || value.type === 'Vector' || value.type === 'Plane')) {
      const reportId = aliasMap[id] || id;
      helpers[reportId] = value;
    }
  }

  const transformCount = nodes.filter(n => TRANSFORM_TYPES.has(n.type)).length;
  const leafCount = leafReports.length;
  const nodesPerLeafRatio = leafCount > 0 ? nodes.length / leafCount : 0;
  const nodeEconomyWarning = leafCount > 0 && transformCount > 2 * leafCount;

  const report = {
    leaves: leafReports,
    nodeErrors,
    numbers: numberCache,
    sliders: sliderInventory,
    selections,
    helpers,
    nodeCount: nodes.length,
    edgeCount: edges.length,
    transformCount,
    nodesPerLeafRatio,
    nodeEconomyWarning,
    scene: hasScene ? {
      min: sceneMin, max: sceneMax,
      size: [sceneMax[0] - sceneMin[0], sceneMax[1] - sceneMin[1], sceneMax[2] - sceneMin[2]],
    } : null,
    meshedLeafCount: finalMeshes.length,
    // A3/A4: poisoned-instance signal + canary state. kernelSuspect triggers a
    // worker respawn + replay on the main thread (never the repair budget).
    kernelFaultCount,
    kernelSuspect: kernelFaultCount >= 2 || kernelRegression,
    kernelHealth,
  };

  return { meshes: finalMeshes, report };
}

function bboxesOverlap(boxA: any, boxB: any, tolerance = 0.1): boolean {
  if (!boxA || !boxB) return false;
  return (
    boxA.min[0] - tolerance <= boxB.max[0] && boxA.max[0] + tolerance >= boxB.min[0] &&
    boxA.min[1] - tolerance <= boxB.max[1] && boxA.max[1] + tolerance >= boxB.min[1] &&
    boxA.min[2] - tolerance <= boxB.max[2] && boxA.max[2] + tolerance >= boxB.min[2]
  );
}

function bboxContains(boxParent: any, boxChild: any, tolerance = 0.1): boolean {
  if (!boxParent || !boxChild) return false;
  return (
    boxParent.min[0] - tolerance <= boxChild.min[0] && boxParent.max[0] + tolerance >= boxChild.max[0] &&
    boxParent.min[1] - tolerance <= boxChild.min[1] && boxParent.max[1] + tolerance >= boxChild.max[1] &&
    boxParent.min[2] - tolerance <= boxChild.min[2] && boxParent.max[2] + tolerance >= boxChild.max[2]
  );
}

interface LeafRelationSignature {
  overlaps: string[];
  containments: string[];
  normCenters: Record<string, number[]>;
}

function getRelationSignature(leaves: any[], sceneBbox: any): LeafRelationSignature {
  const overlaps: string[] = [];
  const containments: string[] = [];
  const normCenters: Record<string, number[]> = {};

  const size = sceneBbox ? sceneBbox.size : [1, 1, 1];
  const center = sceneBbox ? [
    (sceneBbox.min[0] + sceneBbox.max[0]) / 2,
    (sceneBbox.min[1] + sceneBbox.max[1]) / 2,
    (sceneBbox.min[2] + sceneBbox.max[2]) / 2,
  ] : [0, 0, 0];

  for (let i = 0; i < leaves.length; i++) {
    const lA = leaves[i];
    if (!lA.bbox) continue;

    const lCenter = lA.bbox.center || [0, 0, 0];
    normCenters[lA.id] = [
      (lCenter[0] - center[0]) / (size[0] || 1),
      (lCenter[1] - center[1]) / (size[1] || 1),
      (lCenter[2] - center[2]) / (size[2] || 1),
    ];

    for (let j = i + 1; j < leaves.length; j++) {
      const lB = leaves[j];
      if (!lB.bbox) continue;

      if (bboxesOverlap(lA.bbox, lB.bbox)) {
        overlaps.push(`${lA.id}-${lB.id}`);
      }

      if (bboxContains(lA.bbox, lB.bbox)) {
        containments.push(`${lB.id}_in_${lA.id}`);
      } else if (bboxContains(lB.bbox, lA.bbox)) {
        containments.push(`${lA.id}_in_${lB.id}`);
      }
    }
  }

  return { overlaps, containments, normCenters };
}

function compareSignatures(
  defaultSig: LeafRelationSignature,
  perturbedSig: LeafRelationSignature,
  sliderLabel: string,
  factor: number,
  leaves: any[]
): string[] {
  const issues: string[] = [];

  for (const overlap of defaultSig.overlaps) {
    if (!perturbedSig.overlaps.includes(overlap)) {
      const [idA, idB] = overlap.split('-');
      const nameA = leaves.find(l => l.id === idA)?.id || idA;
      const nameB = leaves.find(l => l.id === idB)?.id || idB;
      issues.push(`At ${sliderLabel} ${factor > 1 ? 'increase' : 'decrease'} (${factor}x), "${nameA}" detaches from "${nameB}". Check that their positions are driven by formulas or Align rather than absolute coordinates.`);
    }
  }

  for (const containment of perturbedSig.containments) {
    if (!defaultSig.containments.includes(containment)) {
      const [childId, parentId] = containment.split('_in_');
      const childName = leaves.find(l => l.id === childId)?.id || childId;
      const parentName = leaves.find(l => l.id === parentId)?.id || parentId;
      issues.push(`At ${sliderLabel} ${factor > 1 ? 'increase' : 'decrease'} (${factor}x), "${childName}" becomes fully buried inside "${parentName}".`);
    }
  }

  for (const id of Object.keys(defaultSig.normCenters)) {
    const cDef = defaultSig.normCenters[id];
    const cPert = perturbedSig.normCenters[id];
    if (cPert) {
      const dx = cPert[0] - cDef[0];
      const dy = cPert[1] - cDef[1];
      const dz = cPert[2] - cDef[2];
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (dist > 0.08) {
        const name = leaves.find(l => l.id === id)?.id || id;
        issues.push(`At ${sliderLabel} ${factor > 1 ? 'increase' : 'decrease'} (${factor}x), "${name}" shifts non-proportionally relative to the assembly center (deviation ${Math.round(dist * 100)}%). Derive its position from the driver sliders or use Align.`);
      }
    }
  }

  return issues;
}

async function evaluateGraph(rawNodes: any[], rawEdges: any[], macros: any[], disablePerturbation = false) {
  const mainResult = await evaluateGraphInternal(rawNodes, rawEdges, macros, null, shapeCache, false);
  const { meshes, report } = mainResult;

  evalCounter++;
  (report as any).evalCount = evalCounter;
  (report as any).recycleRecommended = evalCounter >= WORKER_RECYCLE_HINT;

  const sliderNodes = rawNodes.filter(n => n.type === 'NumberSlider');
  const shouldRunPerturb = !disablePerturbation && report.nodeErrors.length === 0 && report.leaves.length > 0 && sliderNodes.length > 0;

  const runPerturbation = shouldRunPerturb ? async (msgId: string) => {
    try {
      const defaultSig = getRelationSignature(report.leaves, report.scene);
      const perturbationIssues: string[] = [];
      let successfulRuns = 0;
      let totalRuns = 0;

      // Count slider references to test only the top 3 most-referenced sliders
      const sliderCounts: Record<string, number> = {};
      for (const n of sliderNodes) {
        sliderCounts[n.id] = 0;
        const label = String(n.data?.label ?? '').trim();
        if (label) {
          sliderCounts[label] = 0;
        }
      }

      for (const node of rawNodes) {
        const def = NODE_LIBRARY[node.type];
        if (!def || def.category === 'math') continue;
        for (const p of def.params) {
          if (p.type !== 'number') continue;
          const v = String(node.data?.[p.name] || '');
          if (v) {
            for (const key of Object.keys(sliderCounts)) {
              if (new RegExp(`(^|[^a-zA-Z0-9_])${key}([^a-zA-Z0-9_]|$)`, 'i').test(v)) {
                sliderCounts[key]++;
              }
            }
          }
        }
      }
      for (const edge of rawEdges) {
        if (sliderCounts[edge.source] !== undefined) {
          sliderCounts[edge.source]++;
        }
      }

      const sortedSliders = [...sliderNodes].sort((a, b) => {
        const countA = (sliderCounts[a.id] || 0) + (sliderCounts[String(a.data?.label || '').trim()] || 0);
        const countB = (sliderCounts[b.id] || 0) + (sliderCounts[String(b.data?.label || '').trim()] || 0);
        return countB - countA;
      });

      const testSliders = sortedSliders.slice(0, 3);

      for (const slider of testSliders) {
        const label = String(slider.data?.label ?? slider.id).trim();
        const defaultVal = parseFloat(slider.data?.value);
        if (!isFinite(defaultVal) || defaultVal === 0) continue;

        const factors = [0.6, 1.5];
        for (const f of factors) {
          totalRuns++;
          const overrideVal = defaultVal * f;
          const overrideScope = { [String(slider.id).toLowerCase()]: overrideVal };
          if (label) {
            overrideScope[label.toLowerCase()] = overrideVal;
          }

          try {
            const tempCache = new Map(shapeCache);
            const perturbedResult = await evaluateGraphInternal(
              rawNodes,
              rawEdges,
              macros,
              overrideScope,
              tempCache,
              true // skipMeshing = true
            );

            // Clean up newly created shapes in tempCache
            for (const [id, entry] of tempCache) {
              if (!shapeCache.has(id) || shapeCache.get(id)!.hash !== entry.hash) {
                // Mitigated: stop deleting to prevent TopoDS_Shape pointer corruption
              }
            }

            const perturbedSig = getRelationSignature(perturbedResult.report.leaves, perturbedResult.report.scene);
            const runIssues = compareSignatures(defaultSig, perturbedSig, label || slider.id, f, report.leaves);

            const perturbedSelections = (perturbedResult.report as any).selections || {};
            const defaultSelections = (report as any).selections || {};
            for (const [nodeId, defSel] of Object.entries(defaultSelections)) {
              const pertSel = perturbedSelections[nodeId];
              if (pertSel) {
                if ((defSel as any).matchedCount !== pertSel.matchedCount) {
                  runIssues.push(
                    `At ${label || slider.id} = ${f}x: selection "${nodeId}" matches ${pertSel.matchedCount} elements (expected ${(defSel as any).matchedCount}). The selection query is fragile under scaling.`
                  );
                }
              }
            }

            if (runIssues.length === 0) {
              successfulRuns++;
            } else {
              perturbationIssues.push(...runIssues);
            }
          } catch (err) {
            perturbationIssues.push(`At ${label || slider.id} = ${f}x: evaluation crashed: ${err}`);
          }
        }
      }

      postMessage({
        type: 'PERTURBATION_REPORT',
        id: msgId,
        report: {
          perturbationIssues,
          proportionalIntegrity: totalRuns > 0 ? successfulRuns / totalRuns : 1.0
        }
      });
    } catch (e) {
      console.warn("Perturbation test failed:", e);
    }
  } : null;

  return { meshes, report, runPerturbation };
}

function getNumericInputOrParam(
  pName: string,
  fallback: number,
  incomingEdges: any[],
  effectiveParams: any,
  numberCache: Record<string, number | number[]>,
  nodeCache: Record<string, any>
): number {
  const edge = incomingEdges.find(e => e.targetHandle === pName);
  if (edge) {
    const v = resolveSourceValue(edge.source, edge.sourceHandle, nodeCache, numberCache);
    if (v !== undefined) return Array.isArray(v) ? (v[0] ?? fallback) : v;
  }
  const parsed = parseFloat(effectiveParams[pName]);
  return isFinite(parsed) ? parsed : fallback;
}

function executeNode(node: any, inputs: any[], warn: (msg: string) => void = () => {}, scope?: Record<string, number>) {
  const params = node.data || {};
  const executor = EXECUTORS[node.type];
  if (executor) {
    return executor(params, inputs, warn, scope);
  }
  return null;
}

// SVG Path and parameter list helpers removed

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
