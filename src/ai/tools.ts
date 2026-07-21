// Tool definitions + executor for the agentic build loop.
// The model acts on the graph exclusively through these tools; positions are
// assigned by auto-layout, never by the model.

import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { MacroDefinition } from '../nodes/NodeDefinitions';
import type { ToolDef } from './api';
import { validateAndNormalizeNodeData } from './agent';
import { validateGenome, formatGenomeSummary } from './genome';
import type { DesignGenome } from './genome';

export interface WorkingGraph {
  nodes: any[];
  edges: any[];
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'set_plan',
    description: 'Record your design plan BEFORE building: SKELETON first (named driving curves/points and what derives from each), then named parts, their roles, attachment relationships, and governing proportions/ratios. Call this first for any new design.',
    parameters: {
      type: 'object',
      properties: {
        plan: { type: 'string', description: 'Short structured plan: parts, relationships, ratios.' },
        ratios: {
          type: 'array',
          description: 'Optional structured proportions/ratios to enforce. Example: [{"param": "abdomen.radiusX", "formula": "bodyLength*0.28"}]',
          items: {
            type: 'object',
            properties: {
              param: { type: 'string', description: 'Node ID + parameter name, e.g. "abdomen.radiusX"' },
              formula: { type: 'string', description: 'Formula expression referencing driver sliders, e.g. "bodyLength*0.28"' }
            },
            required: ['param', 'formula']
          }
        },
        drivers: {
          type: 'array',
          description: 'Optional list of driver sliders/parameters.',
          items: { type: 'string' }
        },
        skeleton: {
          type: 'array',
          description: 'Datum construction geometry FIRST: named driving points/curves and what derives from each. Example: [{"name":"bowlRail","kind":"curve","drives":["seating bowl loft","column ring"]}]',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              kind: { type: 'string', description: '"point" or "curve"' },
              drives: { type: 'array', items: { type: 'string' } }
            },
            required: ['name', 'kind']
          }
        },
        genome: {
          type: 'object',
          description: 'The DESIGN GENOME — the compact "genotype" of what you are building, captured before geometry. Lets the system preserve your intended detail even if the graph is later simplified. Example: {"archetype":"radial-bloom-flower","detailBudget":"high","parts":[{"id":"stem","role":"support"},{"id":"bloom","role":"focal","on":"stem"},{"id":"petals","role":"repeated","of":"petal","count":"petalCount","on":"bloom"},{"id":"leaves","role":"repeated","count":2,"on":"stem"}]}',
          properties: {
            archetype: { type: 'string', description: 'concept/archetype, e.g. "radial-bloom-flower", "four-leg-table"' },
            detailBudget: { type: 'string', description: '"low" | "medium" | "high" — how much detail this design should carry' },
            parts: {
              type: 'array',
              description: 'the parts and how many. count may be a number or a slider label. of = instances of another part; on = attached to another part.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  role: { type: 'string', description: 'support | focal | repeated | detail | shell | ...' },
                  count: { type: 'string', description: 'a number or a slider label (e.g. "petalCount")' },
                  of: { type: 'string' },
                  on: { type: 'string' }
                },
                required: ['id']
              }
            }
          }
        }
      },
      required: ['plan'],
    },
  },
  {
    name: 'add_nodes',
    description: 'Add nodes to the graph. Each node needs a unique id, a type from the node library (or "Macro" with data.macroId), and data with parameter values. Do NOT include positions — layout is automatic.',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string' },
              data: { type: 'object', description: 'Parameter name → value. For Macro nodes include macroId.' },
            },
            required: ['id', 'type'],
          },
        },
      },
      required: ['nodes'],
    },
  },
  {
    name: 'update_nodes',
    description: 'Update parameter values of existing nodes (merged into their data). To change a node\'s TYPE, pass "type": the old params are then CLEARED (label/color kept) and data is validated against the new type — supply all params the new type needs.',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              type: { type: 'string', description: 'Optional new node type. Changing type RESETS the node\'s params.' },
              data: { type: 'object' },
            },
            required: ['id', 'data'],
          },
        },
      },
      required: ['nodes'],
    },
  },
  {
    name: 'remove_nodes',
    description: 'Remove nodes (and their connected edges) from the graph.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } } },
      required: ['ids'],
    },
  },
  {
    name: 'connect',
    description: 'Connect node outputs to node inputs. You may OMIT sourceHandle/targetHandle — they are inferred. sourceHandle is inferred from the source node\'s output (Point→point, VectorXYZ→vector, CircleCurve/Line/Spline→curve, DivideCurve→points, primitives/transforms→solid, sliders→value), so you almost never need to pass it; only the few multi-output nodes (DeconstructPoint, BoundingBox, Endpoints, EvaluateCurve) need an explicit sourceHandle. targetHandle: single-input targets default to their input, and multi-input targets auto-fill their first UNCONNECTED input in declared order (Boolean: target then tool; Align: shape then reference; Loft: profile1..4; PlaceOnSurface: surface then shape) — so connect the main/first input before the secondary one, or pass targetHandle explicitly. Param-driving edges always need explicit targetHandle "param:<paramName>" (e.g. "param:radius").',
    parameters: {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              sourceHandle: { type: 'string', description: 'Optional; inferred from the source node\'s output (only needed for multi-output nodes like DeconstructPoint/BoundingBox).' },
              target: { type: 'string' },
              targetHandle: { type: 'string', description: 'Optional for single-solid-input targets (defaults to "solid"); required otherwise.' },
            },
            required: ['source', 'target'],
          },
        },
      },
      required: ['edges'],
    },
  },
  {
    name: 'disconnect',
    description: 'Remove connections. Identify each by source, target and targetHandle.',
    parameters: {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              target: { type: 'string' },
              targetHandle: { type: 'string' },
            },
            required: ['source', 'target'],
          },
        },
      },
      required: ['edges'],
    },
  },
  {
    name: 'clear_graph',
    description: 'Wipe the whole graph. Use when the user asks for a completely NEW object, so old geometry does not overlap the new design.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'ask_user',
    description: 'Ask the user clarifying questions when the request is genuinely ambiguous. Ends your turn.',
    parameters: {
      type: 'object',
      properties: { questions: { type: 'array', items: { type: 'string' } } },
      required: ['questions'],
    },
  },
  {
    name: 'finish',
    description: 'Declare the build complete with a one-paragraph summary of what was built and which sliders the user can play with. Call this when the geometry report looks correct.',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  },
];

export interface ToolExecutionResult {
  message: string;          // fed back to the model
  mutatedGraph: boolean;    // triggers evaluation + layout
  askedUser?: string[];     // questions for the user
  finished?: string;        // finish summary
  clearedGraph?: boolean;
  plan?: string;
  ratios?: any[];
  drivers?: string[];
  genome?: DesignGenome | null;
}

// Some providers (or schema sanitization for Gemini) deliver nested objects as
// JSON strings. Coerce tolerantly.
function coerce(v: any): any {
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.parse(t); } catch (e) { return v; }
    }
  }
  return v;
}

const NUMBER_OUTPUT_TYPES = new Set(['NumberSlider', 'Expression', 'Series', 'Range', 'ListItem', 'ListLength']);

// Geometry (non-number) input handles of a node type.
export function geoInputHandles(type: string): string[] {
  const def = NODE_LIBRARY[type];
  if (!def) return [];
  return def.inputs.filter(i => i.type !== 'number').map(i => i.name);
}

// NUMBER-typed input handles (list/per-element sockets: Expression a/b/c/d,
// PointsFromLists x/y/z/scale, Point x/y/z, EvaluateCurve t, …).
export function numberInputHandles(type: string): string[] {
  const def = NODE_LIBRARY[type];
  if (!def) return [];
  return def.inputs.filter(i => i.type === 'number').map(i => i.name);
}

// EVERY declared input handle of a node type — the wireability whitelist.
//
// THE NUMBER-INPUT WIRING WALL (root cause of the Jul-21 simple-task failures):
// both AI edge paths validated targetHandle against geoInputHandles(), which
// deliberately EXCLUDES number-typed inputs. Expression a/b/c/d and
// PointsFromLists x/y/z/scale therefore "did not exist" to the validator —
// every Series→Expression.a / Expression→PointsFromLists.x edge the model (or
// the IR compiler!) emitted was dropped as "no input handle", while structural
// validation simultaneously demanded exactly those edges. Edge acceptance must
// check ALL declared inputs; geoInputHandles remains for geometry-only logic
// (auto-pick fallbacks, minConnected counting).
export function allInputHandles(type: string): string[] {
  const def = NODE_LIBRARY[type];
  if (!def) return [];
  return def.inputs.map(i => i.name);
}

// One honest sentence describing what CAN be wired into a node type — used by
// every edge-rejection message so the model learns the real socket inventory
// instead of "Valid inputs: (none)".
export function describeWireableInputs(type: string): string {
  const def = NODE_LIBRARY[type];
  if (!def) return 'unknown node type';
  const geo = geoInputHandles(type);
  const num = numberInputHandles(type);
  const params = def.params.filter(p => p.type === 'number').map(p => p.name);
  const parts: string[] = [];
  if (geo.length) parts.push(`geometry inputs: ${geo.join(', ')}`);
  if (num.length) parts.push(`number/list inputs: ${num.join(', ')}`);
  if (params.length) parts.push(`numeric params (targetHandle "param:<name>"): ${params.join(', ')}`);
  return parts.length ? parts.join('; ') : 'no inputs — it is a pure source node';
}

// Default sourceHandle for an edge leaving a node of the given type.
//
// The model is actively encouraged (tool/protocol docs) to OMIT sourceHandle to
// save tokens, so this default MUST be the node's real output — otherwise every
// skeleton edge (Point→'point', VectorXYZ→'vector', CircleCurve→'curve',
// DivideCurve→'points', Line/Spline→'curve', …) got silently stamped 'solid',
// a handle those nodes do not have, and the structural validator rejected it.
// That single wrong default produced the recurring "validator defaulted to
// 'solid'" repair loops AND the "spheres in the centre" cascade (the dropped
// DivideCurve→InstanceOnPoints.points edge left the instancer with no points).
//
// Number/list nodes keep the 'value' alias (their executors expect it). Every
// single-output node resolves to its actual output. Only genuinely multi-output
// decomposition nodes (DeconstructPoint, BoundingBox, Endpoints, EvaluateCurve)
// fall back to 'solid' and should be given an explicit handle by the caller.
export function defaultSourceHandle(sourceType: string | undefined): string {
  // Prefer the DECLARED output name: the structural validator only accepts
  // declared names, and the old 'value' alias mis-stamped Series/Range edges
  // (declared output "values") into a validation error. All single-output
  // nodes — including every number/list node — resolve to their real handle.
  const def = sourceType ? NODE_LIBRARY[sourceType] : undefined;
  if (def && def.outputs.length === 1) return def.outputs[0].name;
  if (sourceType && NUMBER_OUTPUT_TYPES.has(sourceType)) return 'value';
  return 'solid';
}

// S2 (Jul-20 geometric sockets): TYPE-AWARE auto-fill for an omitted
// targetHandle. With center/pivot/axis sockets on primitives and Rotate,
// "first unconnected input in declaration order" is no longer enough — a
// VectorXYZ wired into a Cone must land on "axis" (Vector), not "center"
// (Point), and a Point wired into Translate must land on "target", not "solid".
//
// Returns:
//   string    — the handle to use (first UNCONNECTED input whose declared type
//               matches the source output's type)
//   null      — the source output type is KNOWN and the target declares NO
//               input of that type: reject the edge with an honest error
//               instead of silently wiring nonsense
//   undefined — source type unknown (Macro, etc.) or all typed matches taken:
//               caller falls back to legacy declaration-order behavior
export function pickTargetHandle(
  sourceType: string | undefined,
  sourceHandle: string | undefined,
  targetType: string,
  takenHandles: Set<string>
): string | null | undefined {
  const targetDef = NODE_LIBRARY[targetType];
  if (!targetDef || targetType === 'Macro') return undefined;
  const srcDef = sourceType ? NODE_LIBRARY[sourceType] : undefined;
  const shName = sourceHandle || defaultSourceHandle(sourceType);
  const srcOutType = srcDef?.outputs.find(o => o.name === shName)?.type;
  if (!srcOutType) return undefined;
  if (srcOutType === 'number') {
    // Number/list source with an omitted targetHandle: land on the first FREE
    // number-typed input in declaration order (Expression a→b→c→d,
    // PointsFromLists x→y→z→scale). Previously this returned undefined, fell
    // through to the geometry-only legacy fallback, got stamped 'solid' and was
    // rejected — the model could not wire the list layer at all without an
    // explicit handle. Declaration order matches the UI's port order; models
    // that need a specific channel still pass targetHandle explicitly.
    const numHandles = targetDef.inputs.filter(i => i.type === 'number').map(i => i.name);
    if (numHandles.length === 0) return undefined; // let legacy geometry fallback run
    return numHandles.find(h => !takenHandles.has(h)) ?? undefined;
  }
  const typedHandles = targetDef.inputs.filter(i => i.type === srcOutType).map(i => i.name);
  if (typedHandles.length === 0) return null;
  return typedHandles.find(h => !takenHandles.has(h)) ?? undefined;
}

function normalizeArgs(args: any): any {
  const out = { ...(coerce(args) || {}) };
  for (const k of ['nodes', 'edges', 'ids', 'questions']) {
    if (k in out) out[k] = coerce(out[k]);
  }
  if (Array.isArray(out.nodes)) {
    out.nodes = out.nodes.map((n: any) => {
      const node = coerce(n);
      if (node && typeof node === 'object' && 'data' in node) node.data = coerce(node.data) || {};
      return node;
    });
  }
  if (Array.isArray(out.edges)) out.edges = out.edges.map(coerce);
  return out;
}

export function executeTool(
  name: string,
  rawArgs: any,
  graph: WorkingGraph,
  macros: MacroDefinition[],
): ToolExecutionResult {
  const args = normalizeArgs(rawArgs);
  const macroIds = new Set(macros.map(m => m.id));

  switch (name) {
    case 'set_plan': {
      // C3: fold the skeleton into the recorded plan so the Reasoning tab and
      // saved examples carry the derivation structure, not just the parts list.
      const skeletonTxt = Array.isArray(args.skeleton) && args.skeleton.length
        ? '\nSKELETON: ' + args.skeleton.map((s: any) => `${s.kind || 'curve'} "${s.name}"${Array.isArray(s.drives) && s.drives.length ? ` drives [${s.drives.join(', ')}]` : ''}`).join('; ')
        : '';
      // Pillar 1: parse + fold the design genome into the plan so intent is
      // preserved and measurable (scoreIntentRealization) even after repairs.
      const { genome } = validateGenome(args.genome);
      const genomeTxt = genome ? '\n' + formatGenomeSummary(genome) : '';
      return {
        message: 'Plan recorded.',
        mutatedGraph: false,
        plan: String(args.plan || '') + skeletonTxt + genomeTxt,
        ratios: args.ratios,
        drivers: args.drivers,
        genome,
      };
    }

    case 'add_nodes': {
      const errors: string[] = [];
      const warnings: string[] = [];
      let added = 0;
      for (const n of args.nodes || []) {
        if (!n.id || !n.type) { errors.push(`Node missing id or type: ${JSON.stringify(n).slice(0, 80)}`); continue; }
        const id = String(n.id);
        if (n.type !== 'group' && !NODE_LIBRARY[n.type]) {
          errors.push(`Unknown node type "${n.type}" (node ${id}). Valid types: ${Object.keys(NODE_LIBRARY).join(', ')}`);
          continue;
        }
        if (n.type === 'Macro') {
          if (!n.data?.macroId || !macroIds.has(n.data.macroId)) {
            errors.push(`Macro node ${id} references unknown macroId "${n.data?.macroId}". Available: ${macros.map(m => `${m.id} (${m.name})`).join(', ') || 'none'}`);
            continue;
          }
        }
        const { warnings: nodeWarns, errors: nodeErrs, validatedData } = validateAndNormalizeNodeData(id, n.type, n.data, macros);
        if (nodeErrs.length > 0) {
          errors.push(...nodeErrs);
          continue;
        }
        warnings.push(...nodeWarns);
        graph.nodes = graph.nodes.filter(existing => existing.id !== id);
        graph.nodes.push({ id, type: n.type, position: { x: 0, y: 0 }, data: validatedData });
        added++;
      }
      return {
        message: `${added} node(s) added.${warnings.length ? ' Warnings: ' + warnings.join(' | ') : ''}${errors.length ? ' ERRORS: ' + errors.join(' | ') : ''}`,
        mutatedGraph: added > 0,
      };
    }

    case 'update_nodes': {
      const errors: string[] = [];
      const warnings: string[] = [];
      let updated = 0;
      for (const n of args.nodes || []) {
        const id = String(n.id);
        const existing = graph.nodes.find(x => x.id === id);
        if (!existing) { errors.push(`Node "${id}" not found.`); continue; }
        // Optional type change: validate against the NEW type and RESET the
        // node's data (label/color kept). Merging params across a type change
        // leaves ghost params from the old type in the node, which crashes the
        // kernel and desyncs the model's view of the graph.
        const requestedType = n.type !== undefined && n.type !== null ? String(n.type) : '';
        const isTypeChange = !!requestedType && requestedType !== existing.type;
        if (isTypeChange && !NODE_LIBRARY[requestedType]) {
          errors.push(`Node "${id}": unknown type "${requestedType}" — node left unchanged.`);
          continue;
        }
        const effectiveType = isTypeChange ? requestedType : existing.type;
        const { warnings: nodeWarns, errors: nodeErrs, validatedData } = validateAndNormalizeNodeData(id, effectiveType, n.data, macros);
        if (nodeErrs.length > 0) {
          errors.push(...nodeErrs);
          continue;
        }
        warnings.push(...nodeWarns);
        if (isTypeChange) {
          const kept: Record<string, any> = {};
          if (existing.data && existing.data.label !== undefined) kept.label = existing.data.label;
          if (existing.data && existing.data.color !== undefined) kept.color = existing.data.color;
          existing.type = effectiveType;
          existing.data = { ...kept, ...validatedData };
          warnings.push(`node "${id}" type changed to ${effectiveType}; old params were CLEARED (label/color kept) — supply all needed ${effectiveType} params`);
        } else {
          existing.data = { ...existing.data, ...validatedData };
        }
        updated++;
      }
      return {
        message: `${updated} node(s) updated.${warnings.length ? ' Warnings: ' + warnings.join(' | ') : ''}${errors.length ? ' ERRORS: ' + errors.join(' | ') : ''}`,
        mutatedGraph: updated > 0,
      };
    }

    case 'remove_nodes': {
      const ids = (args.ids || []).map(String);
      const before = graph.nodes.length;
      graph.nodes = graph.nodes.filter(n => !ids.includes(n.id));
      graph.edges = graph.edges.filter(e => !ids.includes(e.source) && !ids.includes(e.target));
      const removed = before - graph.nodes.length;
      return { message: `${removed} node(s) removed.`, mutatedGraph: removed > 0 };
    }

    case 'connect': {
      const skipped: string[] = [];
      const madeDesc: string[] = [];
      let added = 0;
      const nodeById: Record<string, any> = {};
      graph.nodes.forEach(n => { nodeById[n.id] = n; });
      for (const e of args.edges || []) {
        const source = String(e.source);
        const target = String(e.target);
        if (!nodeById[source]) { skipped.push(`${source}→${target}: source node "${source}" does not exist.`); continue; }
        if (!nodeById[target]) { skipped.push(`${source}→${target}: target node "${target}" does not exist.`); continue; }
        const targetType = nodeById[target].type;
        const targetDef = NODE_LIBRARY[targetType];
        const geoHandles = geoInputHandles(targetType);

        // Resolve targetHandle. Default to "solid" ONLY when the target has a
        // single solid input; otherwise require it explicitly.
        let th = e.targetHandle !== undefined && e.targetHandle !== null ? String(e.targetHandle) : '';
        let autoNote = '';
        if (!th) {
          // S2: type-aware first — a Point lands on a Point input (center/
          // target), a Vector on a Vector input (axis), a Solid on a Solid one.
          const taken = new Set(graph.edges.filter(x => x.target === target).map(x => String(x.targetHandle)));
          const picked = pickTargetHandle(nodeById[source].type, e.sourceHandle ? String(e.sourceHandle) : undefined, targetType, taken);
          if (typeof picked === 'string') {
            th = picked;
            if (geoHandles.length > 1) autoNote = ` (auto-assigned to input "${picked}" by type — pass targetHandle to choose a different input)`;
          } else if (picked === null) {
            skipped.push(`${source}→${target}: "${targetType}" has no input accepting what "${source}" outputs. It accepts — ${describeWireableInputs(targetType)}.`);
            continue;
          } else if (geoHandles.length === 1) {
            th = geoHandles[0];
          } else if (geoHandles.length === 0 && targetType === 'Macro') {
            th = 'solid';
          } else {
            // Legacy fallback: auto-assign the first geometry input
            // (declaration order) that is not already connected.
            const free = geoHandles.find(h => !taken.has(h));
            if (free) {
              th = free;
              autoNote = ` (auto-assigned to input "${free}" — pass targetHandle to choose a different input)`;
            } else {
              skipped.push(`${source}→${target}: all inputs of "${targetType}" (${geoHandles.join(', ')}) are already connected; specify targetHandle to replace one.`);
              continue;
            }
          }
        }

        // Validate the handle actually exists (param, geometry, or number input).
        if (th.startsWith('param:')) {
          const pName = th.slice(6);
          if (targetDef && targetType !== 'Macro' && !targetDef.params.some(p => p.name === pName && p.type === 'number')) {
            // Common confusion: number INPUTS (a/b/c/d, x/y/z/scale) are wired
            // with the bare handle name, not the "param:" prefix.
            const bare = numberInputHandles(targetType);
            const hint = bare.includes(pName)
              ? ` "${pName}" IS a number input on "${targetType}" — use targetHandle "${pName}" (no "param:" prefix).`
              : '';
            skipped.push(`${source}→${target}: "${targetType}" has no numeric param "${pName}".${hint} It accepts — ${describeWireableInputs(targetType)}.`);
            continue;
          }
        } else if (targetDef && targetType !== 'Macro' && !allInputHandles(targetType).includes(th)) {
          skipped.push(`${source}→${target}: "${targetType}" has no input handle "${th}". It accepts — ${describeWireableInputs(targetType)}.`);
          continue;
        }

        const sh = e.sourceHandle !== undefined && e.sourceHandle !== null && String(e.sourceHandle)
          ? String(e.sourceHandle)
          : defaultSourceHandle(nodeById[source].type);

        const id = `e_${source}_${target}_${th}`.replace(/[^a-zA-Z0-9_:-]/g, '');
        graph.edges = graph.edges.filter(x => x.id !== id && !(x.target === target && x.targetHandle === th));
        graph.edges.push({ id, source, sourceHandle: sh, target, targetHandle: th });
        madeDesc.push(`${source}.${sh}→${target}.${th}${autoNote}`);
        added++;
      }
      const parts = [`${added} connection(s) made${added ? ': ' + madeDesc.join(', ') : ''}.`];
      if (skipped.length) parts.push(`SKIPPED (fix and retry): ${skipped.join(' | ')}`);
      return { message: parts.join(' '), mutatedGraph: added > 0 };
    }

    case 'disconnect': {
      let removed = 0;
      const noMatch: string[] = [];
      for (const e of args.edges || []) {
        const before = graph.edges.length;
        graph.edges = graph.edges.filter(x =>
          !(x.source === String(e.source) && x.target === String(e.target) &&
            (e.targetHandle === undefined || x.targetHandle === String(e.targetHandle))));
        const n = before - graph.edges.length;
        if (n === 0) noMatch.push(`${e.source}→${e.target}${e.targetHandle !== undefined ? '.' + e.targetHandle : ''}`);
        removed += n;
      }
      return {
        message: `${removed} connection(s) removed.${noMatch.length ? ` NO MATCH (nothing removed) for: ${noMatch.join(', ')} — check the current edges in the graph state.` : ''}`,
        mutatedGraph: removed > 0,
      };
    }

    case 'clear_graph': {
      const had = graph.nodes.length > 0;
      graph.nodes = [];
      graph.edges = [];
      return { message: 'Graph cleared.', mutatedGraph: had, clearedGraph: true };
    }

    case 'ask_user': {
      return { message: 'Questions sent to user.', mutatedGraph: false, askedUser: (args.questions || []).map(String) };
    }

    case 'finish': {
      return { message: 'Build finished.', mutatedGraph: false, finished: String(args.summary || 'Done.') };
    }

    default:
      return { message: `Unknown tool "${name}".`, mutatedGraph: false };
  }
}
