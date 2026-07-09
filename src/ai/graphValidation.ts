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
  const geoHandles = def.inputs.filter(i => i.type !== 'number').map(i => i.name);
  if (geoHandles.length === 0) return null; // primitives, number nodes
  if (type === 'Loft') return { handles: geoHandles, minConnected: 2 };
  if (type === 'Compound') return { handles: geoHandles, minConnected: 1 };
  // Align: "shape" is required; "reference" is optional (mode "ground" needs none).
  if (type === 'Align') return { handles: ['shape'], minConnected: 1 };
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

export function validateGraphStructure(nodes: GNode[], edges: GEdge[]): StructuralIssue[] {
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

  // 0b. Parametric interconnection analysis. The whole point of the graph is
  //     that a few sliders drive the entire model through shared formulas —
  //     a hard-coded dimension breaks rescaling, and a slider nothing
  //     references is dead weight. Both are reported as (non-gating) warnings
  //     so the model rewires them before finishing.
  {
    const sliderNodes = nodes.filter(n => n.type === 'NumberSlider');
    const numericLiteral = /^[-+]?[0-9]*\.?[0-9]+(e[-+]?[0-9]+)?$/i;
    if (sliderNodes.length > 0) {
      const refNames = new Set<string>(); // slider labels/ids referenced by any formula
      let formulaCount = 0;
      let literalCount = 0;
      const literalExamples: string[] = [];
      for (const node of nodes) {
        const def = NODE_LIBRARY[node.type];
        if (!def || def.category === 'math') continue; // sliders/expressions/series aren't "dimensions"
        for (const p of def.params) {
          if (p.type !== 'number') continue;
          const v = node.data?.[p.name];
          if (v === undefined || v === null) continue; // default in use — not an authored dimension
          if (typeof v === 'string' && v.trim() !== '' && !numericLiteral.test(v.trim())) {
            formulaCount++;
            (v.toLowerCase().match(/[a-z_][a-z0-9_]*/g) || []).forEach(x => refNames.add(x));
          } else {
            literalCount++;
            if (literalExamples.length < 8) literalExamples.push(`${node.id}.${p.name}=${v}`);
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
      if (literalCount >= 4 && literalCount > formulaCount) {
        issues.push({
          nodeId: sliderNodes[0].id,
          severity: 'warning',
          message: `PARAMETRIC COVERAGE IS LOW: ${literalCount} dimensions are hard-coded literals vs ${formulaCount} slider-driven formulas, so the model will NOT rescale coherently when sliders move. Rewrite the literals as formulas of your sliders (shared ratios interconnect the design). Hard-coded examples: ${literalExamples.join(', ')}.`,
        });
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
    //    collapse that pushes the whole model to the origin.
    if (node.type === 'Expression') {
      const formula = String(node.data?.formula ?? '');
      const used = referencedVars(formula);
      const connectedVars = new Set(
        ins.filter(e => ['a', 'b', 'c', 'd'].includes(String(e.targetHandle)))
          .map(e => String(e.targetHandle))
      );
      const missingVars = used.filter(v => !connectedVars.has(v));
      if (missingVars.length > 0) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `Expression "${node.id}" uses ${missingVars.map(v => `"${v}"`).join(', ')} in formula "${formula}" but ${missingVars.length > 1 ? 'those inputs are' : 'that input is'} not connected — it will evaluate as 0 and collapse dependent positions. Connect a value into ${missingVars.map(v => `"${v}"`).join(', ')}.`,
        });
      }
    }

    // 3. Edges into non-existent handles (silent mis-wiring).
    const def = NODE_LIBRARY[node.type];
    if (def && node.type !== 'Macro') {
      const validGeo = new Set(def.inputs.map(i => i.name));
      const validParams = new Set(def.params.filter(p => p.type === 'number').map(p => p.name));
      for (const e of geoEdges) {
        const th = String(e.targetHandle || 'solid');
        if (!validGeo.has(th)) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `Edge into "${node.id}" targets handle "${th}", which ${node.type} does not have. Valid inputs: ${def.inputs.map(i => i.name).join(', ') || '(none)'}.`,
          });
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
