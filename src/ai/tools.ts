// Tool definitions + executor for the agentic build loop.
// The model acts on the graph exclusively through these tools; positions are
// assigned by auto-layout, never by the model.

import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { MacroDefinition } from '../nodes/NodeDefinitions';
import type { ToolDef } from './api';

export interface WorkingGraph {
  nodes: any[];
  edges: any[];
}

export const AGENT_TOOLS: ToolDef[] = [
  {
    name: 'set_plan',
    description: 'Record your design plan BEFORE building: named parts, their roles, attachment relationships, and governing proportions/ratios. Call this first for any new design.',
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
    description: 'Update parameter values of existing nodes (merged into their data).',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: { id: { type: 'string' }, data: { type: 'object' } },
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
    description: 'Connect node outputs to node inputs. You may OMIT sourceHandle/targetHandle: single-input targets default to their input, and multi-input targets auto-fill their first UNCONNECTED input in declared order (Boolean: target then tool; Align: shape then reference; Loft: profile1..4; PlaceOnSurface: surface then shape) — so connect the main/first input before the secondary one, or pass targetHandle explicitly to be safe. Param-driving edges always need explicit targetHandle "param:<paramName>" (e.g. "param:radius"). sourceHandle defaults to "value" for number/expression nodes.',
    parameters: {
      type: 'object',
      properties: {
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              source: { type: 'string' },
              sourceHandle: { type: 'string', description: 'Optional; defaults to "solid" (or "value" for number nodes).' },
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

// Default sourceHandle for an edge leaving a node of the given type.
function defaultSourceHandle(sourceType: string | undefined): string {
  return sourceType && NUMBER_OUTPUT_TYPES.has(sourceType) ? 'value' : 'solid';
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
      return {
        message: 'Plan recorded.',
        mutatedGraph: false,
        plan: String(args.plan || ''),
        ratios: args.ratios,
        drivers: args.drivers
      };
    }

    case 'add_nodes': {
      const errors: string[] = [];
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
        graph.nodes = graph.nodes.filter(existing => existing.id !== id);
        graph.nodes.push({ id, type: n.type, position: { x: 0, y: 0 }, data: { ...(n.data || {}) } });
        added++;
      }
      return {
        message: `${added} node(s) added.${errors.length ? ' ERRORS: ' + errors.join(' | ') : ''}`,
        mutatedGraph: added > 0,
      };
    }

    case 'update_nodes': {
      const errors: string[] = [];
      let updated = 0;
      for (const n of args.nodes || []) {
        const id = String(n.id);
        const existing = graph.nodes.find(x => x.id === id);
        if (!existing) { errors.push(`Node "${id}" not found.`); continue; }
        existing.data = { ...existing.data, ...(n.data || {}) };
        updated++;
      }
      return {
        message: `${updated} node(s) updated.${errors.length ? ' ERRORS: ' + errors.join(' | ') : ''}`,
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
          if (geoHandles.length === 1) {
            th = geoHandles[0];
          } else if (geoHandles.length === 0 && targetType === 'Macro') {
            th = 'solid';
          } else {
            // Multi-input node with the handle omitted: auto-assign the first
            // geometry input (declaration order) that is not already connected,
            // instead of skipping. Connecting twice to a Boolean therefore
            // fills "target" then "tool"; Align fills "shape" then "reference".
            const taken = new Set(graph.edges.filter(x => x.target === target).map(x => String(x.targetHandle)));
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

        // Validate the handle actually exists (param or geometry).
        if (th.startsWith('param:')) {
          const pName = th.slice(6);
          if (targetDef && targetType !== 'Macro' && !targetDef.params.some(p => p.name === pName && p.type === 'number')) {
            skipped.push(`${source}→${target}: "${targetType}" has no numeric param "${pName}". Numeric params: ${targetDef.params.filter(p => p.type === 'number').map(p => p.name).join(', ') || '(none)'}.`);
            continue;
          }
        } else if (targetDef && targetType !== 'Macro' && !geoHandles.includes(th)) {
          skipped.push(`${source}→${target}: "${targetType}" has no input handle "${th}". Valid inputs: ${geoHandles.join(', ') || '(none)'}.`);
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
      for (const e of args.edges || []) {
        const before = graph.edges.length;
        graph.edges = graph.edges.filter(x =>
          !(x.source === String(e.source) && x.target === String(e.target) &&
            (e.targetHandle === undefined || x.targetHandle === String(e.targetHandle))));
        removed += before - graph.edges.length;
      }
      return { message: `${removed} connection(s) removed.`, mutatedGraph: removed > 0 };
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
