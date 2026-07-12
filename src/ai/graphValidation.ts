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
