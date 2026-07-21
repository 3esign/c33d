// Pure, kernel-free structural validation of a node graph.
//
// This runs BEFORE (and independently of) OpenCascade evaluation. It catches the
// two failure classes that dominated the rocket/horse generation log — missing
// "solid" input edges into transforms, and Expression nodes whose formula
// references a variable (a/b/c/d) that was never connected — at their source,
// with a precise message, instead of letting them surface downstream as the
// generic and confusing "Node produced no geometry (null result)".
//
// It has no dependency on replicad, so it is trivially unit-testable in Node.

import { NODE_LIBRARY } from '../nodes/NodeDefinitions';

export interface StructuralIssue {
  nodeId: string;
  message: string;
  severity: 'error' | 'warning';
}

interface GNode { id: string; type: string; data?: Record<string, any> }
interface GEdge { source: string; target: string; sourceHandle?: string; targetHandle?: string }

// The geometry input handles a node type must have connected to evaluate.
// Derived from NODE_LIBRARY, with a few multi-input rules that can't be inferred
// from arity alone (Loft needs >=2 of its 4 profiles; Compound needs >=1 of 4).
function requiredGeoInputs(type: string): { handles: string[]; minConnected: number } | null {
  const def = NODE_LIBRARY[type];
  if (!def) return null;
  // S2 (Jul-20 geometric sockets): "center" (primitives), "pivot"/"axis"
  // (Rotate, rotational primitives) are optional placement overrides — the
  // executors default to origin/+Z. Requiring them would repeat the Jul-18
  // CircleCurve mistake (stricter than the engine, costing repair rounds).
  // NOTE: "target" is NOT here — it is required on Boolean; Translate's
  // optional "target" is covered by its explicit case below.
  const OPTIONAL_GEO_SOCKETS = new Set(['center', 'pivot', 'axis']);
  const geoHandles = def.inputs
    .filter(i => i.type !== 'number' && !OPTIONAL_GEO_SOCKETS.has(i.name))
    .map(i => i.name);
  if (geoHandles.length === 0) return null; // primitives, number nodes
  if (type === 'Loft') return { handles: geoHandles, minConnected: 2 };
  if (type === 'LoftCurves') return { handles: geoHandles, minConnected: 2 };
  if (type === 'Compound') return { handles: geoHandles, minConnected: 1 };
  // Pipe: the Curve input is optional — pathSvg param is the fallback.
  if (type === 'Pipe') return null;
  // Translate: "target" Point is an optional geometric-socket override.
  if (type === 'Translate') return { handles: ['solid'], minConnected: 1 };
  // Align: "shape" is required; "reference" is optional (mode "ground" needs none).
  if (type === 'Align') return { handles: ['shape'], minConnected: 1 };
  // Fillet, Chamfer, Shell: selection is optional, solid is required.
  if (type === 'Fillet' || type === 'Chamfer' || type === 'Shell') return { handles: ['solid'], minConnected: 1 };
  // CircleCurve / EllipseCurve: center and normal are OPTIONAL — the executor
  // defaults them to the origin / +Z (orientAndPlaceWire). Hard-requiring them
  // here was stricter than the engine and cost real repair rounds across models
  // in the Jul-18 flower session ("missing required inputs: center, normal" on a
  // circle that would have built fine). Radius drives the geometry; placement is
  // an optional override.
  if (type === 'CircleCurve' || type === 'EllipseCurve') return null;
  // Everything else (Translate, Rotate, Boolean, PlaceOnSurface, …) needs every
  // one of its geometry input handles connected.
  return { handles: geoHandles, minConnected: geoHandles.length };
}

// Which single-letter variables an Expression formula actually references.
function referencedVars(formula: string): string[] {
  const out: string[] = [];
  for (const v of ['a', 'b', 'c', 'd']) {
    // word-boundary match so "abs(" / "max(" don't count as a/b/c/d
    if (new RegExp(`(^|[^a-zA-Z0-9_])${v}([^a-zA-Z0-9_]|$)`).test(formula)) out.push(v);
  }
  return out;
}

// ---- Naming-convention dataflow inference (edge-completion) --------------------
// The Jul-21 transcripts showed models emit rich node sets with correct formulas
// but omit the dataflow EDGES — the angles→coord-Expression→PointsFromLists→
// InstanceOnPoints backbone ships as disconnected islands, so the generative
// subsystem silently collapses to a few hand-wired singletons. Models name those
// islands consistently (angles1 → x1_expr → points1 → …), so a conservative,
// convention-driven inference reconnects the unambiguous cases deterministically.

// Number/list producers and their default output handle.
const SEQUENCE_TYPES = new Set(['Series', 'Range']);            // true iteration domains
const LIST_PRODUCER_TYPES = new Set(['Series', 'Range', 'ListConstant', 'RepeatEach', 'Tile']);
const NUMBER_PRODUCER_TYPES = new Set(['Expression', 'ListItem', 'ListLength', 'NumberSlider']);
function defaultNumberOut(type: string): string {
  return LIST_PRODUCER_TYPES.has(type) ? 'values' : 'value';
}

// Split an id into a role prefix + numeric group token: "x1_expr" → {role:"x",
// group:"1"}, "angles1" → {role:"angles", group:"1"}. null when there is no
// trailing group number to key on (so we never guess across ungrouped ids).
function idParts(id: string): { role: string; group: string } | null {
  const m = /^([a-zA-Z]+?)_?(\d+)(?:[_-].*)?$/.exec(id);
  if (!m) return null;
  return { role: m[1].toLowerCase(), group: m[2] };
}
function groupOf(id: string): string | null {
  const p = idParts(id);
  return p ? p.group : null;
}
function peersInGroup(nodes: GNode[], selfId: string, group: string): GNode[] {
  return nodes.filter(n => n.id !== selfId && groupOf(n.id) === group);
}

export interface InferredEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
  reason: string;
}

// Pure, deterministic inference of high-confidence MISSING dataflow edges.
// Only ever fills EMPTY handles, only when a single unambiguous source exists —
// it can never override the model's explicit wiring. Returns the edges to add
// (each with a human reason for the [Autofix] log).
export function inferMissingEdges(nodes: GNode[], edges: GEdge[]): InferredEdge[] {
  const inferred: InferredEdge[] = [];
  const occupied = (target: string, handle: string): boolean =>
    edges.some(e => e.target === target && String(e.targetHandle ?? '') === handle) ||
    inferred.some(e => e.target === target && e.targetHandle === handle);
  const add = (src: GNode, target: string, handle: string, reason: string) => {
    if (src.id === target || occupied(target, handle)) return;
    inferred.push({
      id: `${src.id}__to__${target}__${handle}`,
      source: src.id,
      sourceHandle: defaultNumberOut(src.type),
      target,
      targetHandle: handle,
      reason,
    });
  };

  // Graph-wide uniqueness fallbacks (Rules A2/B2): the Jul-21 simple-task
  // graphs used BARE ids for a single generative group (t, x, y, z, radii,
  // pts) — no trailing group number, so the grouped rules never fired. With
  // exactly ONE sequence node (or one role-matched producer) in the WHOLE
  // graph there is nothing to disambiguate; refusing to wire it was pure loss.
  const allSequences = nodes.filter(p => SEQUENCE_TYPES.has(p.type));
  // Role of a bare id: leading alpha run up to a camelCase/underscore/digit
  // boundary — "xCoords"→"x", "y_vals"→"y", "scaleList"→"scale", "t"→"t".
  const bareRole = (id: string): string | null => {
    const m = /^([a-z]+)/.exec(id.startsWith('$') ? id.slice(1) : id);
    if (!m) return null;
    return m[1];
  };

  // Rule A — an Expression's per-element variable a/b/c/d ← the one Series/Range
  // in its id-group (the iteration domain the model forgot to wire), or — A2 —
  // the one Series/Range in the entire graph.
  for (const n of nodes) {
    if (n.type !== 'Expression') continue;
    const g = groupOf(n.id);
    let seq: GNode | undefined;
    let why = '';
    if (g) {
      const seqs = peersInGroup(nodes, n.id, g).filter(p => SEQUENCE_TYPES.has(p.type));
      if (seqs.length === 1) {
        seq = seqs[0];
        why = `"${seqs[0].id}" is the only sequence in group ${g}`;
      }
    }
    if (!seq && allSequences.length === 1 && allSequences[0].id !== n.id) {
      seq = allSequences[0]; // A2: unambiguous graph-wide
      why = `"${allSequences[0].id}" is the only Series/Range in the graph`;
    }
    if (!seq) continue; // ambiguous → leave it to the validation nudge
    for (const v of referencedVars(String(n.data?.formula ?? ''))) {
      add(seq, n.id, v, `"${n.id}" uses '${v}' but nothing was wired to it; ${why}`);
    }
  }

  // Rule B — PointsFromLists x/y/z/scale ← the sibling node whose role matches the
  // channel (x1_expr → points1:x) when exactly one such sibling exists in-group,
  // or — B2 — the unique role-named producer graph-wide when this is the only
  // PointsFromLists in the graph (xCoords→x, y_vals→y, z→z).
  const allPfl = nodes.filter(p => p.type === 'PointsFromLists');
  for (const n of nodes) {
    if (n.type !== 'PointsFromLists') continue;
    const g = groupOf(n.id);
    for (const ch of ['x', 'y', 'z', 'scale']) {
      if (occupied(n.id, ch)) continue;
      let src: GNode | undefined;
      let why = '';
      if (g) {
        const matches = peersInGroup(nodes, n.id, g).filter(
          p => idParts(p.id)?.role === ch && (LIST_PRODUCER_TYPES.has(p.type) || NUMBER_PRODUCER_TYPES.has(p.type))
        );
        if (matches.length === 1) {
          src = matches[0];
          why = `role '${ch}', group ${g}`;
        }
      }
      if (!src && allPfl.length === 1) {
        const matches = nodes.filter(
          p => p.id !== n.id && bareRole(p.id) === ch && (LIST_PRODUCER_TYPES.has(p.type) || NUMBER_PRODUCER_TYPES.has(p.type))
        );
        if (matches.length === 1) {
          src = matches[0]; // B2: unambiguous graph-wide
          why = `"${matches[0].id}" is the only '${ch}'-named number producer and "${n.id}" the only PointsFromLists`;
        }
      }
      if (!src) continue;
      add(src, n.id, ch, `PointsFromLists "${n.id}" channel '${ch}' had no list; wired "${src.id}" (${why})`);
    }
  }

  return inferred;
}

// The single unambiguous source inferMissingEdges would wire into (target,handle),
// for naming it in a validation message. Kept in lockstep with the rules above.
function suggestSource(nodes: GNode[], edges: GEdge[], target: string, handle: string): string | null {
  const hit = inferMissingEdges(nodes, edges).find(e => e.target === target && e.targetHandle === handle);
  return hit ? hit.source : null;
}

export function validateGraphStructure(
  nodes: GNode[],
  edges: GEdge[],
  ratios?: { param: string; formula: string }[]
): StructuralIssue[] {
  const issues: StructuralIssue[] = [];
  const byId: Record<string, GNode> = {};
  nodes.forEach(n => { byId[n.id] = n; });

  // 0. Slider label hygiene. Inline formulas resolve sliders by (lowercased)
  //    label, so a missing label makes the slider unreferenceable and a
  //    duplicate label silently shadows another slider's value.
  const labelOwners: Record<string, string[]> = {};
  for (const n of nodes) {
    if (n.type !== 'NumberSlider') continue;
    const label = String(n.data?.label ?? '').trim().toLowerCase();
    if (!label || label === 'param') {
      issues.push({
        nodeId: n.id,
        severity: 'warning',
        message: `NumberSlider "${n.id}" has no meaningful label — formulas can only reference it by its id. Give it a descriptive label (e.g. "bodyRadius").`,
      });
      continue;
    }
    (labelOwners[label] = labelOwners[label] || []).push(n.id);
  }
  for (const [label, owners] of Object.entries(labelOwners)) {
    if (owners.length > 1) {
      issues.push({
        nodeId: owners[1],
        severity: 'error',
        message: `Multiple NumberSliders share the label "${label}" (${owners.join(', ')}) — formulas will silently use only one of them. Rename or remove the duplicates.`,
      });
    }
  }

  // 0b. Parametric interconnection analysis.
  {
    const sliderNodes = nodes.filter(n => n.type === 'NumberSlider');
    if (sliderNodes.length > 0) {
      const refNames = new Set<string>();
      for (const node of nodes) {
        const def = NODE_LIBRARY[node.type];
        if (!def || def.category === 'math') continue;
        for (const p of def.params) {
          if (p.type !== 'number') continue;
          const v = node.data?.[p.name];
          if (typeof v === 'string' && v.trim() !== '' && !/^[-+]?[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?$/i.test(v.trim())) {
            (v.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []).forEach(x => refNames.add(x));
          }
        }
      }
      const hasOutgoing = new Set(edges.map(e => e.source));
      const deadSliders = sliderNodes.filter(n => {
        const label = String(n.data?.label ?? '').trim().toLowerCase();
        return !refNames.has(label) && !refNames.has(n.id.toLowerCase()) && !hasOutgoing.has(n.id);
      });
      if (deadSliders.length > 0) {
        issues.push({
          nodeId: deadSliders[0].id,
          severity: 'warning',
          message: `Dead design parameter${deadSliders.length > 1 ? 's' : ''}: slider${deadSliders.length > 1 ? 's' : ''} ${deadSliders.map(s => `"${String(s.data?.label || s.id)}"`).join(', ')} ${deadSliders.length > 1 ? 'are' : 'is'} not referenced by any formula or edge — moving ${deadSliders.length > 1 ? 'them' : 'it'} changes nothing. Wire dimensions to ${deadSliders.length > 1 ? 'them' : 'it'} or remove ${deadSliders.length > 1 ? 'them' : 'it'}.`,
        });
      }

      const { coverage, drivenCount, total, literalExamples } = calculateParametricCoverage(nodes, edges);
      if (coverage < 0.60 && total > 0) {
        issues.push({
          nodeId: sliderNodes[0].id,
          severity: 'warning',
          message: `PARAMETRIC COVERAGE IS LOW (${Math.round(coverage * 100)}%): Only ${drivenCount} of ${total} dimensions are driven by slider-based formulas or edges. Hard-coded literals will break design scalability when sliders move. Please rewrite these bare literals as formulas of your sliders: ${literalExamples.join(', ')}.`,
        });
      }
    }
  }

  // 0c. Plan ratio contract check.
  if (ratios && ratios.length > 0) {
    for (const r of ratios) {
      if (!r || typeof r.param !== 'string') continue;
      const parts = r.param.split('.');
      if (parts.length !== 2) continue;
      const [nodeId, paramName] = parts;
      const targetNode = nodes.find(n => n.id === nodeId);
      if (!targetNode) continue;

      const actualVal = targetNode.data?.[paramName];
      const isEdgeDriven = edges.some(e => e.target === nodeId && e.targetHandle === `param:${paramName}`);
      const cleanFormula = (str: string) => String(str).replace(/\s+/g, '').toLowerCase();

      if (!isEdgeDriven) {
        if (actualVal === undefined || actualVal === null || String(actualVal).trim() === '') {
          issues.push({
            nodeId,
            severity: 'warning',
            message: `Plan ratio contract deviation: "${r.param}" is not set. Expected formula "${r.formula}".`
          });
        } else if (cleanFormula(String(actualVal)) !== cleanFormula(r.formula)) {
          issues.push({
            nodeId,
            severity: 'warning',
            message: `Plan ratio contract deviation: "${r.param}" is "${actualVal}" but plan declared it should be "${r.formula}". Please update the parameter to match the plan.`
          });
        }
      }
    }
  }

  // Incoming edges grouped by target, split into geometry vs param edges.
  const incoming: Record<string, GEdge[]> = {};
  for (const e of edges) {
    if (!incoming[e.target]) incoming[e.target] = [];
    incoming[e.target].push(e);
  }

  for (const node of nodes) {
    if (node.type === 'group') continue;
    const ins = (incoming[node.id] || []);
    const geoEdges = ins.filter(e => !String(e.targetHandle || '').startsWith('param:'));

    // 1. Missing required geometry inputs.
    const req = requiredGeoInputs(node.type);
    if (req) {
      const connectedHandles = new Set(geoEdges.map(e => String(e.targetHandle || 'solid')));
      if (req.minConnected === req.handles.length) {
        // every named handle must be present
        const missing = req.handles.filter(h => !connectedHandles.has(h));
        if (missing.length > 0) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `"${node.id}" (${node.type}) is missing required input${missing.length > 1 ? 's' : ''}: ${missing.map(h => `"${h}"`).join(', ')}. Connect an upstream solid to ${missing.length > 1 ? 'these handles' : `handle "${missing[0]}"`}, or the node produces no geometry.${node.type === 'Boolean' ? ' (Boolean: "target" = the solid being modified, "tool" = the cutter/adder.)' : ''}`,
          });
        }
      } else if (connectedHandles.size < req.minConnected) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `"${node.id}" (${node.type}) needs at least ${req.minConnected} connected input${req.minConnected > 1 ? 's' : ''} (has ${connectedHandles.size}). Connect its ${req.handles.join('/')} handles.`,
        });
      }
    }

    // 2. Expression variables referenced but not connected → the silent a=0
    //    collapse that pushes the whole model to the origin. a/b/c/d are
    //    per-element INPUT HANDLES, so the fix is an edge, not a formula edit —
    //    the old "connect a value into a" phrasing let models swap in a slider.
    if (node.type === 'Expression') {
      const formula = String(node.data?.formula ?? '');
      const used = referencedVars(formula);
      const connectedVars = new Set(
        ins.filter(e => ['a', 'b', 'c', 'd'].includes(String(e.targetHandle)))
          .map(e => String(e.targetHandle))
      );
      const missingVars = used.filter(v => !connectedVars.has(v));
      if (missingVars.length > 0) {
        const hint = missingVars
          .map(v => { const src = suggestSource(nodes, edges, node.id, v); return src ? `wire "${src}" → "${node.id}":${v}` : null; })
          .filter(Boolean)
          .join('; ');
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `Expression "${node.id}" uses ${missingVars.map(v => `"${v}"`).join(', ')} in formula "${formula}" but ${missingVars.length > 1 ? 'those per-element inputs are' : 'that per-element input is'} not connected — a/b/c/d are supplied by wiring a number list into the matching input handle, NOT by a slider. Add the edge${missingVars.length > 1 ? 's' : ''}${hint ? ` (${hint})` : `: connect a Series/Range/Expression list into ${missingVars.map(v => `"${v}"`).join(', ')}`}. Left unwired ${missingVars.length > 1 ? 'they' : 'it'} evaluate${missingVars.length > 1 ? '' : 's'} as 0 and collapse dependent positions.`,
        });
      }
    }

    // 2b. PointsFromLists with no coordinate list → produces no points, so any
    //     InstanceOnPoints downstream stays empty. NOT caught by requiredGeoInputs
    //     (all its handles are number-typed and filtered out there). This is the
    //     head of the collapse chain across the Jul-21 city/megapolis transcripts.
    if (node.type === 'PointsFromLists') {
      const listHandles = new Set(ins.map(e => String(e.targetHandle ?? '')));
      const hasCoord = ['x', 'y', 'z', 'scale'].some(h => listHandles.has(h));
      if (!hasCoord) {
        const hints = ['x', 'y', 'z', 'scale']
          .map(ch => { const s = suggestSource(nodes, edges, node.id, ch); return s ? `wire "${s}" → "${node.id}":${ch}` : null; })
          .filter(Boolean)
          .join('; ');
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `PointsFromLists "${node.id}" has no number list on x/y/z/scale — it produces no points, so anything instanced on it stays empty. Wire a Series/Range/Expression list into x, y and/or z${hints ? ` (${hints})` : ''}.`,
        });
      }
    }

    // 2c. A pure number/list producer wired to nothing renders no geometry and
    //     changes nothing — almost always a forgotten output edge (the
    //     disconnected compute island). Warning: it does not block evaluation.
    if ((NUMBER_PRODUCER_TYPES.has(node.type) || LIST_PRODUCER_TYPES.has(node.type)) && node.type !== 'NumberSlider') {
      const feedsSomething = edges.some(e => e.source === node.id);
      if (!feedsSomething) {
        const g = groupOf(node.id);
        const sink = g ? peersInGroup(nodes, node.id, g).find(p => p.type === 'PointsFromLists' || p.type === 'Expression') : undefined;
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          message: `"${node.id}" (${node.type}) computes a number/list wired to nothing — it renders no geometry and changes nothing. Wire its output into a consumer${sink ? ` (e.g. "${sink.id}")` : ' (PointsFromLists x/y/z, an Expression a/b/c/d input, or a param:)'} or remove it.`,
        });
      }
    }

    // 3. Edges into non-existent handles (silent mis-wiring) AND port type mismatches.
    const def = NODE_LIBRARY[node.type];
    if (def && node.type !== 'Macro') {
      const validGeo = new Map(def.inputs.map(i => [i.name, i.type]));
      const validParams = new Set(def.params.filter(p => p.type === 'number').map(p => p.name));
      for (const e of geoEdges) {
        const th = String(e.targetHandle || 'solid');
        const targetType = validGeo.get(th);
        if (!targetType) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `Edge into "${node.id}" targets handle "${th}", which ${node.type} does not have. Valid inputs: ${def.inputs.map(i => i.name).join(', ') || '(none)'}.`,
          });
        } else {
          // Check type compatibility if source node exists
          const sourceNode = byId[e.source];
          if (sourceNode) {
            const sourceDef = NODE_LIBRARY[sourceNode.type];
            if (sourceDef) {
              // Defaults for sourceHandle if undefined: solid for geometry, value for math
              let defaultOut = 'solid';
              if (sourceDef.outputs.length > 0 && sourceDef.outputs[0].name !== 'solid') {
                defaultOut = sourceDef.outputs[0].name;
              }
              const sh = String(e.sourceHandle || defaultOut);
              const outPort = sourceDef.outputs.find(o => o.name === sh);
              if (!outPort) {
                 issues.push({
                   nodeId: node.id,
                   severity: 'error',
                   message: `Edge from "${e.source}" targets output handle "${sh}", which ${sourceNode.type} does not output.`
                 });
              } else if (outPort.type !== targetType && outPort.type !== 'any' && targetType !== 'any') {
                 issues.push({
                   nodeId: node.id,
                   severity: 'error',
                   message: `Type mismatch: Cannot connect ${outPort.type} output "${outPort.name}" from "${e.source}" to ${targetType} input "${th}" on "${node.id}".`
                 });
              }
            }
          }
        }
      }
      for (const e of ins) {
        const th = String(e.targetHandle || '');
        if (th.startsWith('param:') && !validParams.has(th.slice(6))) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `Param edge into "${node.id}" drives "${th.slice(6)}", which is not a numeric parameter of ${node.type}. Numeric params: ${[...validParams].join(', ') || '(none)'}.`,
          });
        }
      }
    }

    // 4. Dangling edge endpoints.
    for (const e of ins) {
      if (!byId[e.source]) {
        issues.push({ nodeId: node.id, severity: 'error', message: `Edge into "${node.id}" comes from "${e.source}", which does not exist.` });
      }
    }
  }

  return issues;
}

export function calculateParametricCoverage(nodes: any[], edges: any[]): {
  coverage: number;
  drivenCount: number;
  significantLiteralCount: number;
  total: number;
  literalExamples: string[];
} {
  const sliderNodes = nodes.filter(n => n.type === 'NumberSlider');
  if (sliderNodes.length === 0) {
    return { coverage: 1.0, drivenCount: 0, significantLiteralCount: 0, total: 0, literalExamples: [] };
  }

  const numericLiteral = /^[-+]?[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?$/i;
  const refNames = new Set<string>();
  let drivenCount = 0;
  let significantLiteralCount = 0;
  const literalExamples: string[] = [];

  for (const node of nodes) {
    const def = NODE_LIBRARY[node.type];
    if (!def || def.category === 'math') continue;
    for (const p of def.params) {
      if (p.type !== 'number') continue;
      const v = node.data?.[p.name];
      if (v === undefined || v === null || String(v).trim() === '') continue;

      const isEdgeDriven = edges.some(e => e.target === node.id && e.targetHandle === `param:${p.name}`);
      const isFormula = typeof v === 'string' && v.trim() !== '' && !numericLiteral.test(v.trim());

      if (isEdgeDriven || isFormula) {
        drivenCount++;
        if (isFormula) {
          (v.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []).forEach(x => refNames.add(x));
        }
      } else {
        const val = parseFloat(v);
        const isSmallOrCount = 
          p.name.toLowerCase().includes('count') ||
          p.name.toLowerCase().includes('segments') ||
          p.name.toLowerCase().includes('divisions') ||
          p.name.toLowerCase().includes('index') ||
          p.name.toLowerCase().includes('tolerance') ||
          p.name === 'axisX' || p.name === 'axisY' || p.name === 'axisZ' ||
          (p.name.toLowerCase().includes('angle') && Math.abs(val) <= 15) ||
          val === 0 || val === 1 || val === -1;

        if (!isSmallOrCount) {
          significantLiteralCount++;
          if (literalExamples.length < 8) {
            literalExamples.push(`${node.id}.${p.name}=${v}`);
          }
        }
      }
    }
  }

  const total = drivenCount + significantLiteralCount;
  const coverage = total > 0 ? drivenCount / total : 1.0;
  return { coverage, drivenCount, significantLiteralCount, total, literalExamples };
}
