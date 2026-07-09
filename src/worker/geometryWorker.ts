import opencascade from 'replicad-opencascadejs';
import opencascadeWasm from 'replicad-opencascadejs/src/replicad_single.wasm?url';
import * as replicad from 'replicad';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import { evaluateExpression as evaluateExpressionSafe } from '../utils/expression';
import { EXECUTORS } from './executors';

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
      const start = getNumericInputOrParam('start', 0, incoming, effectiveParams, numberCache);
      const step = getNumericInputOrParam('step', 1, incoming, effectiveParams, numberCache);
      const count = Math.max(1, Math.round(getNumericInputOrParam('count', 5, incoming, effectiveParams, numberCache)));
      
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        values.push(start + i * step);
      }
      numberCache[node.id] = values;
      continue;
    }
    if (node.type === 'Range') {
      const min = getNumericInputOrParam('min', 0, incoming, effectiveParams, numberCache);
      const max = getNumericInputOrParam('max', 10, incoming, effectiveParams, numberCache);
      const steps = Math.max(1, Math.round(getNumericInputOrParam('steps', 5, incoming, effectiveParams, numberCache)));
      
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
        const v = numberCache[listEdge.source];
        if (v !== undefined) {
          listVal = Array.isArray(v) ? v : [v];
        }
      }
      const index = Math.round(getNumericInputOrParam('index', 0, incoming, effectiveParams, numberCache));
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

// evaluateExpressionSafe is now imported from src/utils/expression.ts

// Helper functions are now imported or defined in executors.ts

function getNumericInputOrParam(
  pName: string,
  fallback: number,
  incomingEdges: any[],
  effectiveParams: any,
  numberCache: Record<string, number | number[]>,
): number {
  const edge = incomingEdges.find(e => e.targetHandle === pName);
  if (edge) {
    const v = numberCache[edge.source];
    if (v !== undefined) return Array.isArray(v) ? (v[0] ?? fallback) : v;
  }
  const parsed = parseFloat(effectiveParams[pName]);
  return isFinite(parsed) ? parsed : fallback;
}

function executeNode(node: any, inputs: any[], warn: (msg: string) => void = () => {}) {
  const params = node.data || {};
  const executor = EXECUTORS[node.type];
  if (executor) {
    return executor(params, inputs, warn);
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
