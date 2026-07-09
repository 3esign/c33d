import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from '@xyflow/react';
import type {
  Connection,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
} from '@xyflow/react';
import type { MacroDefinition, SuccessExample } from '../nodes/NodeDefinitions';

// Web worker lifecycle (recreatable — OCCT WASM leaks are contained by recycling)
const createGeometryWorker = () =>
  new Worker(new URL('../worker/geometryWorker.ts', import.meta.url), {
    type: 'module',
  });
let worker = createGeometryWorker();

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
};

// ---- Geometry report types (mirrors worker output) ----
export type LeafReport = {
  id: string;
  bbox: { min: number[]; max: number[]; center: number[]; size: number[] } | null;
  volume?: number;
  meshOk: boolean;
  vertexCount: number;
  error?: string | null;
};
export type GeometryReport = {
  leaves: LeafReport[];
  nodeErrors: { id: string; error: string }[];
  numbers: Record<string, number | number[]>;
  scene: { min: number[]; max: number[]; size: number[] } | null;
  meshedLeafCount: number;
  evalCount: number;
  recycleRecommended: boolean;
  // Design-parameter inventory (slider label → value) so the model always sees
  // which names inline formulas can reference.
  sliders?: Record<string, number>;
  // Graph size — lets the model (and the human) spot node-count ballooning
  // across repair rounds.
  nodeCount?: number;
  edgeCount?: number;
};

export type EvaluationOutcome = { error: string | null; report: GeometryReport | null };

// Waiters allow the agent to await the outcome of the next evaluation
let evalWaiters: ((outcome: EvaluationOutcome) => void)[] = [];
const resolveEvalWaiters = (outcome: EvaluationOutcome) => {
  const ws = evalWaiters;
  evalWaiters = [];
  ws.forEach(w => { try { w(outcome); } catch (e) { /* noop */ } });
};
export const waitForEvaluation = (timeoutMs = 30000): Promise<EvaluationOutcome> => {
  const state = useStore.getState();
  if (!state.isEvaluating && !(window as any)._evalDebounceTimer && !state.nodes.length) {
    return Promise.resolve({ error: null, report: null });
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: 'Evaluation timed out after 30s', report: null }), timeoutMs);
    evalWaiters.push((outcome) => { clearTimeout(timer); resolve(outcome); });
  });
};

export type NudgeCandidate = {
  prompts: string[];
  plan: string;
  graphFinal: { nodes: any[]; edges: any[] };
  graphOriginal: { nodes: any[]; edges: any[] } | null;
  model: string;
};

export type EvalResultEntry = {
  timestamp: string;
  model: string;
  promptId: string;
  level: number;
  prompt: string;
  parsedOk: boolean;
  evaluatedOk: boolean;
  geometrySane: boolean;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  visionScore?: number;
  error?: string;
};


const DEFAULT_GUIDELINES = `# AI Parametric CAD Architect Agent Guidelines

This document outlines the core architecture, constraints, coordinate systems, and design conventions for the AI Architect graph editor application. All AI coding assistants and graph generation agents working on this project must adhere strictly to these rules.

## 1. Node Library & Handles
The graph engine supports the following nodes:
- **Primitives**: \`Box\`, \`Sphere\`, \`Cylinder\`, \`Plane\`, \`Text3D\`, \`Sketch\`.
  - Primitives only have output handles named \`"solid"\`.
  - \`Plane\` represents a true 2D flat surface. Do NOT use a thin \`Box\` to simulate a flat plane.
  - \`Text3D\` generates 3D extruded text from a string parameter.
  - \`Sketch\` takes an SVG path parameter (e.g. 'M 0 0 L 10 0 L 10 10 L 0 10 Z') and outputs a flat 2D shape.
- **Transforms**: \`Translate\`, \`Rotate\`, \`Scale\`, \`PlaceOnSurface\`, \`ScatterOnSurface\`, \`PlaceOnVertices\`, \`Fillet\`, \`Chamfer\`, \`Extrude\`, \`Mirror\`, \`Shell\`, \`Loft\`, \`LinearPattern\`, \`CircularPattern\`.
  - Transforms take a \`"solid"\` input handle (or specific inputs like \`"profile1"\`/\`"profile2"\` for \`Loft\`) and yield a \`"solid"\` output handle.
  - \`PlaceOnSurface\` takes \`"surface"\` and \`"shape"\`. It places a shape at a specific UV coordinate (\`u\`, \`v\`) on the surface.
  - \`ScatterOnSurface\` takes \`"surface"\` and \`"shape"\`. It places a configured \`"count"\` of the shape at pseudo-random UV positions on the surface. Supports random instanced sizing via \`scaleMin\` and \`scaleMax\` parameters. Note: This node only outputs the scattered shapes; to render the base surface as well, merge them using a Boolean (union) or Compound node.
  - \`PlaceOnVertices\` takes \`"solid"\` and \`"shape"\`. It duplicates the shape and places a copy centered on every single vertex (point/corner) of the primary solid. Supports random instanced sizing via \`scaleMin\` and \`scaleMax\` parameters. Note: This node only outputs the duplicated shapes; to render the base solid as well, merge them using a Boolean (union) or Compound node.
  - \`Loft\` takes \`"profile1"\` and \`"profile2"\`. It lofts a solid skin between their boundary wires.
  - \`LinearPattern\` repeats a solid in a straight line.
  - \`CircularPattern\` repeats a solid in a circle around the Z-axis.
  - You must always connect the output of a shape or transform to the downstream nodes.
- **Booleans**: \`Boolean\` (operations: 'union', 'difference', 'intersect').
- **Group**: \`Compound\` node groups up to 4 shapes (inputs: \`solid1\`, \`solid2\`, \`solid3\`, \`solid4\`) into a compound shape without using expensive boolean merges.
- **Math & Lists (driven parameters)**: \`NumberSlider\`, \`Expression\`, \`Series\`, \`Range\`, \`ListItem\`, \`ListLength\`.
  - \`NumberSlider\` outputs a single value.
  - \`Expression\` evaluates a formula like 'a * 2 + b'.
  - \`Series\` generates a list of numbers starting at \`start\`, stepping by \`step\`, with a given \`count\`.
  - \`Range\` generates a list of numbers from \`min\` to \`max\` in a given number of \`steps\`.
  - \`ListItem\` retrieves an item from a list at the specified \`index\`.
  - \`ListLength\` returns the size of the list.

## 2. Coordinate System Mapping (Z-up vs Y-up)
- **CAD Engine**: Replicad/OpenCascade uses **Z-up** coordinates:
  - \`XY\` plane is the ground plane (where \`Z = 0\`).
  - \`Z\` is the height axis.
- **3D Viewport**: Three.js uses **Y-up** coordinates.
- **Mapping Fix**: The 3D viewport applies a \`-90\` degree rotation around the X-axis (\`[-Math.PI / 2, 0, 0]\`) to align the systems.
  - Consequently, building a shape on the \`XY\` plane in the CAD node graph will correctly render flat on the ground grid in the 3D viewport.
  - Do not apply ad-hoc rotations to make elements face "up" in the viewport; they are naturally Z-up.

## 3. Dynamic Slider Parameter Ranges
All numerical sliders rendered in the UI adapt to custom limits configured in the node library:
- **Translate offsets**: \`-100\` to \`100\`
- **Rotational Angles**: \`-360\` to \`360\`
- **Scaling Factors**: \`0.01\` to \`10\`
- **Geometric Dimensions (Radius, Width, etc.)**: \`0.1\` to \`200\`
- **UV Coordinates (u, v)**: \`0\` to \`1\`
Ensure you specify numerical values in \`node.data\` that fall within these logical ranges.

## 4. List Processing & Loop Approximations (Parametric Loops)
- The graph engine supports implicit looping via list mapping.
- **Series & Range:** Use \`Series\` or \`Range\` nodes to generate lists of numbers.
- **Implicit Mapping on Transforms:** If you connect a list of numbers (from \`Series\`, \`Range\`, or list-mapped \`Expression\`) to a numeric input parameter of a transform node (\`Translate\`, \`Rotate\`, \`Scale\`), the transform is automatically repeated for each value in the list, producing a \`Compound\` solid containing all the individual instances. For example, connecting a \`Series\` to a \`Translate\` node's \`z\` parameter creates a vertical stack of shifted solids.
- **List Expressions:** If any inputs (\`a\`, \`b\`, \`c\`, \`d\`) to an \`Expression\` node are lists, the formula is evaluated element-by-element, returning a list of numbers.
- **Scatter/Place fallback:** If a specific point on a surface is required, use **\`PlaceOnSurface\`** with \`"u"\` and \`"v"\` values between \`0\` and \`1\`. To create a cluster of multiple shapes scattered across a surface, you can still use the **\`ScatterOnSurface\`** node.

## 5. Standard Geometric Recipes
- **Dome**:
  To build a dome of radius R:
  1. Create a \`Sphere\` node (radius = R).
  2. Create a \`Box\` node (width = 2*R + 10, length = 2*R + 10, height = R).
  3. Create a \`Translate\` node with offsets \`x = 0, y = 0, z = -R/2\` and connect \`Box.solid\` -> \`Translate.solid\`.
  4. Create a \`Boolean\` node with \`operation = "difference"\`.
  5. Connect \`Sphere.solid\` -> \`Boolean.target\` and \`Translate.solid\` -> \`Boolean.tool\`. This subtracts the bottom hemisphere to yield a clean dome.

- **Tapered Column / Stem**:
  To build a tapering stem or pillar of height H:
  1. Create a base \`Cylinder\` node (e.g., radius = 2) at the base.
  2. Create a top \`Cylinder\` node (e.g., radius = 0.5) at the top.
  3. Create a \`Translate\` node with offsets \`x = 0, y = 0, z = H\` and connect the top \`Cylinder.solid\` -> \`Translate.solid\`.
  4. Connect the base \`Cylinder.solid\` to \`Loft.profile1\` and \`Translate.solid\` to \`Loft.profile2\` to skin a smooth tapering pillar.

- **Parametric Flower**:
  To construct a beautiful parametric flower at height H:
  1. **Stem**: Create a tapered pillar using the loft recipe above (from \`z = 0\` to \`z = H\`).
  2. **Receptacle/Center**: Create a \`Sphere\` node (radius = R) and translate it to \`z = H\` using a \`Translate\` node.
  3. **Petal Profile**: Create a \`Sketch\` node with a teardrop SVG path (e.g. \`svgPath = "M 0 0 C -2 2 -4 6 0 10 C 4 6 2 2 0 0 Z"\`).
  4. **Thickness**: Connect the sketch to \`Extrude\` (height = 0.2).
  5. **Pitch/Orientation**: Connect \`Extrude\` to a \`Rotate\` node with \`isLocal: true\` (e.g., \`angle = 75\`, \`axisX = 1\`, \`axisY = 0\`, \`axisZ = 0\`) to tilt the petal outward.
  6. **Radial Placement**: Connect the rotated petal to a \`Translate\` node to offset it from the center (e.g., \`y = 3\`) and lift it to the top of the stem (\`z = H\`).
  7. **Bloom Array**: Connect the translated petal to a \`CircularPattern\` node (e.g., \`count = 8\`, \`angle = 360\`) to create a radial bloom.
  8. **Group**: Connect the stem loft, center sphere translation, and circular pattern of petals into a \`Compound\` node.

## 6. Visual Node Grouping (Structuring graphs)
- You can group related nodes visually using parent container nodes of type \`"group"\`.
- To create a group:
  1. Add a node with \`"type": "group"\`, and specify a label in its data (e.g. \`data: { label: "Stem Group" }\`).
  2. Set its boundary size using the style property, e.g. \`"style": { "width": 300, "height": 250 }\`.
  3. For any nodes inside the group, add the property \`"parentId": "group_node_id"\` and set their \`"position"\` relative to the group's top-left corner \`[0, 0]\` instead of global coordinates.
- This is highly recommended when creating multiple components (e.g. Stem, Bloom, Leaves) to keep graphs clean and organized!
`;

export type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export type SceneObject = {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  color?: string;
  geometryData?: any; // Will store the mesh vertices/indices from replicad
  meshHash?: string;  // worker's shape+param hash; lets us reuse GPU buffers when unchanged
};

export type PerformanceLogEntry = {
  timestamp: string;
  model: string;
  request: string;
  success: boolean;
  responseTimeMs: number;
  nodeCount: number;
  edgeCount: number;
  error?: string;
};

export type AgentSlot = {
  id: string;
  name: string;
  provider: 'gemini' | 'ollama' | 'openai' | 'openrouter';
  apiKey: string; // API Key or URL for Ollama
  model: string;
  optimizeForSmallModels?: boolean;
  enableVisionVerification?: boolean; // send viewport snapshots to vision models for a verification pass
  disableToolCalling?: boolean;       // force the legacy single-shot JSON protocol
};

type AppState = {
  // Agent Configuration Slots
  agentSlots: AgentSlot[];
  activeAgentId: string | null;
  addAgentSlot: (slot: Omit<AgentSlot, 'id'>) => void;
  removeAgentSlot: (id: string) => void;
  updateAgentSlot: (id: string, updates: Partial<AgentSlot>) => void;
  setActiveAgentId: (id: string | null) => void;
  restoreDefaultAgents: () => void;

  // Performance Logging
  performanceLogs: PerformanceLogEntry[];
  addPerformanceLog: (entry: Omit<PerformanceLogEntry, 'timestamp'>) => void;

  // Chat
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  removeMessage: (id: string) => void;
  clearMessages: () => void;

  // Node Graph
  nodes: Node[];
  edges: Edge[];
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  updateNodeData: (id: string, data: any) => void;

  // Scene & Evaluation
  sceneObjects: SceneObject[];
  setSceneObjects: (objects: SceneObject[]) => void;
  toggleObjectVisibility: (id: string) => void;
  isEvaluating: boolean;
  evaluateGraph: () => void;
  clearGraph: () => void;
  lastEvaluationError: string | null;
  clearLastEvaluationError: () => void;
  triggerFitCount: number;
  zoomToFit: () => void;

  // Agent Guidelines (Continuous Knowledge Base)
  agentGuidelines: string;
  setAgentGuidelines: (guidelines: string) => void;
  initializeGuidelines: () => Promise<void>;

  // Geometry report from the last evaluation (percepts for the agent)
  lastGeometryReport: GeometryReport | null;

  // Episode tracking (prompts + plan of the current design, for the success library)
  episodePrompts: string[];
  episodePlan: string;
  addEpisodePrompt: (p: string) => void;
  setEpisodePlan: (p: string) => void;
  resetEpisode: () => void;
  lastAIGraph: { nodes: any[]; edges: any[] } | null;
  setLastAIGraph: (g: { nodes: any[]; edges: any[] } | null) => void;

  // Success library (the verification gate — the ONLY long-term knowledge store)
  successExamples: SuccessExample[];
  addSuccessExample: (ex: SuccessExample) => void;
  removeSuccessExample: (id: string) => void;
  initializeExamples: () => Promise<void>;

  // Macro library (reusable, verified subgraphs)
  macros: MacroDefinition[];
  addMacro: (m: MacroDefinition) => void;
  removeMacro: (id: string) => void;
  initializeMacros: () => Promise<void>;

  // Save-example modal + nudge
  saveModalOpen: boolean;
  saveModalCandidate: NudgeCandidate | null; // null = save the live graph
  openSaveModal: (candidate?: NudgeCandidate | null) => void;
  closeSaveModal: () => void;
  nudgeCandidate: NudgeCandidate | null;
  setNudgeCandidate: (c: NudgeCandidate | null) => void;

  // Eval harness results
  evalResults: EvalResultEntry[];
  addEvalResult: (r: EvalResultEntry) => void;
  isRunningEvals: boolean;
  setIsRunningEvals: (v: boolean) => void;
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => {
      // Listen for worker messages (bindable so the worker can be recycled)
      const bindWorker = (w: Worker) => {
      w.onmessage = (e) => {
        const { type, result, error, report } = e.data;
        if (type === 'EVALUATE_DONE') {
          const currentObjects = get().sceneObjects;
          const newObjects = result.map((res: any) => {
            const existing = currentObjects.find(o => o.id === res.id);
            
            // Helper to recursively find color of this node or its ancestor nodes in the graph
            const findColor = (nodeId: string): string | undefined => {
              const node = get().nodes.find(n => n.id === nodeId);
              if (!node) return undefined;
              if (node.data && (node.data as any).color) return (node.data as any).color;
              
              // Walk backwards along edges
              const incomingEdges = get().edges.filter(e => e.target === nodeId);
              for (const edge of incomingEdges) {
                const colorVal = findColor(edge.source);
                if (colorVal) return colorVal;
              }
              return undefined;
            };

            // Reuse the previous geometryData object reference when this part's
            // geometry is unchanged (same worker hash). The viewport memoizes
            // its BufferGeometry (and expensive edge lines) on geometryData
            // identity, so this avoids re-tessellating and re-uploading every
            // untouched part on each slider tick — only the driven part rebuilds.
            const unchanged = existing && res.hash && existing.meshHash === res.hash && existing.geometryData;
            return {
              id: res.id,
              name: existing ? existing.name : `Node_${res.id}`,
              type: 'Mesh',
              visible: existing ? existing.visible : true,
              color: findColor(res.id),
              meshHash: res.hash,
              geometryData: unchanged ? existing.geometryData : {
                vertices: res.vertices,
                indices: res.indices,
                normals: res.normals
              }
            };
          });
          const hasGeometryNodes = get().nodes.some(n => n.type !== 'NumberSlider' && n.type !== 'Expression' && n.type !== 'group');
          let evaluationError = null;
          if (hasGeometryNodes && newObjects.length === 0) {
            evaluationError = "The graph evaluated successfully but produced no visible 3D shapes. Please verify that at least one geometry shape node (Primitive, Boolean, Compound, or Pattern) is a leaf node (has no outgoing edges) and evaluates successfully with correct inputs.";
            get().addPerformanceLog({
              model: 'System',
              request: 'Graph Evaluation (Empty Viewport)',
              success: false,
              responseTimeMs: 0,
              nodeCount: get().nodes.length,
              edgeCount: get().edges.length,
              error: evaluationError
            });
          }
          set({ sceneObjects: newObjects, isEvaluating: false, lastEvaluationError: evaluationError, lastGeometryReport: report || null });

          // Recycle the worker periodically to contain OCCT WASM memory growth
          if (report?.recycleRecommended && !(window as any)._pendingEvaluation) {
            try { worker.terminate(); } catch (err) { /* noop */ }
            worker = createGeometryWorker();
            bindWorker(worker);
          }

          if ((window as any)._pendingEvaluation) {
            (window as any)._pendingEvaluation = false;
            get().evaluateGraph();
          } else {
            resolveEvalWaiters({ error: evaluationError, report: report || null });
          }
        } else if (type === 'EVALUATE_ERROR') {
          console.error('Graph Evaluation Error:', error);
          get().addPerformanceLog({
            model: 'System',
            request: 'Graph Evaluation (Crash)',
            success: false,
            responseTimeMs: 0,
            nodeCount: get().nodes.length,
            edgeCount: get().edges.length,
            error: String(error)
          });
          set({
            isEvaluating: false,
            lastEvaluationError: String(error)
          });
          if ((window as any)._pendingEvaluation) {
            (window as any)._pendingEvaluation = false;
            get().evaluateGraph();
          } else {
            resolveEvalWaiters({ error: String(error), report: null });
          }
        }
      };

      // Catch worker loading/runtime errors and log them to performanceLogs
      w.onerror = (err) => {
        console.error('Worker error:', err);
        const currentLogs = get().performanceLogs;
        set({
          performanceLogs: [
            ...currentLogs,
            {
              timestamp: new Date().toISOString(),
              model: 'System',
              request: 'Worker Error',
              success: false,
              responseTimeMs: 0,
              nodeCount: 0,
              edgeCount: 0,
              error: err.message || 'Worker Error'
            }
          ],
          isEvaluating: false,
          lastEvaluationError: err.message || 'Worker Error'
        });
        resolveEvalWaiters({ error: err.message || 'Worker Error', report: null });
      };
      };
      bindWorker(worker);

      return {
        // Agent Slots Configuration
        agentSlots: [
          {
            id: 'default-gemini',
            name: 'Google Gemini',
            provider: 'gemini',
            apiKey: '',
            model: 'gemini-1.5-flash',
            optimizeForSmallModels: false,
          },
          {
            id: 'default-ollama',
            name: 'Ollama (Local)',
            provider: 'ollama',
            apiKey: 'http://localhost:11434',
            model: 'llama3',
            optimizeForSmallModels: false,
          },
          {
            id: 'default-openai',
            name: 'OpenAI',
            provider: 'openai',
            apiKey: '',
            model: 'gpt-4o',
            optimizeForSmallModels: false,
          },
          {
            id: 'default-openrouter',
            name: 'OpenRouter',
            provider: 'openrouter',
            apiKey: '',
            model: 'anthropic/claude-3.5-sonnet',
            optimizeForSmallModels: false,
          }
        ],
        activeAgentId: 'default-gemini',
        
        addAgentSlot: (slot) => {
          const newSlot = { ...slot, id: generateUUID() };
          set((state) => ({
            agentSlots: [...state.agentSlots, newSlot],
            activeAgentId: state.activeAgentId || newSlot.id
          }));
        },
        removeAgentSlot: (id) => {
          set((state) => {
            const nextSlots = state.agentSlots.filter(s => s.id !== id);
            let nextActive = state.activeAgentId;
            if (state.activeAgentId === id) {
              nextActive = nextSlots.length > 0 ? nextSlots[0].id : null;
            }
            return {
              agentSlots: nextSlots,
              activeAgentId: nextActive
            };
          });
        },
        updateAgentSlot: (id, updates) => {
          set((state) => ({
            agentSlots: state.agentSlots.map(s => s.id === id ? { ...s, ...updates } : s)
          }));
        },
        setActiveAgentId: (id) => {
          set({ activeAgentId: id });
        },
        restoreDefaultAgents: () => {
          set({
            agentSlots: [
              {
                id: 'default-gemini',
                name: 'Google Gemini',
                provider: 'gemini',
                apiKey: '',
                model: 'gemini-1.5-flash',
                optimizeForSmallModels: false,
              },
              {
                id: 'default-ollama',
                name: 'Ollama (Local)',
                provider: 'ollama',
                apiKey: 'http://localhost:11434',
                model: 'llama3',
                optimizeForSmallModels: false,
              },
              {
                id: 'default-openai',
                name: 'OpenAI',
                provider: 'openai',
                apiKey: '',
                model: 'gpt-4o',
                optimizeForSmallModels: false,
              },
              {
                id: 'default-openrouter',
                name: 'OpenRouter',
                provider: 'openrouter',
                apiKey: '',
                model: 'anthropic/claude-3.5-sonnet',
                optimizeForSmallModels: false,
              }
            ],
            activeAgentId: 'default-gemini'
          });
        },

        // Performance Logging
        performanceLogs: [],
        addPerformanceLog: (entry) => {
          const newEntry: PerformanceLogEntry = {
            ...entry,
            timestamp: new Date().toISOString()
          };
          set((state) => ({
            performanceLogs: [newEntry, ...state.performanceLogs]
          }));
          // Send to the server log endpoint to save in intelligence_log.json
          fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newEntry)
          }).catch(err => console.error('Failed to log on server:', err));
        },

        // Chat
        messages: [],
        addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
        removeMessage: (id) => set((state) => ({ messages: state.messages.filter(m => m.id !== id) })),
        clearMessages: () => set({ messages: [] }),

        // Node Graph — starts empty. Do not seed a default demo graph here:
        // nodes/edges are intentionally excluded from persist() partialize
        // (see bottom of this file), so whatever is hardcoded as the initial
        // value is what every fresh load / restart shows. A baked-in demo
        // model here means the app never actually starts clean.
        nodes: [],
        edges: [],
        onNodesChange: (changes) => {
          set({
            nodes: applyNodeChanges(changes, get().nodes),
          });
          const hasRemove = changes.some(c => c.type === 'remove');
          if (hasRemove) {
            get().evaluateGraph();
          }
        },
        onEdgesChange: (changes) => {
          set({
            edges: applyEdgeChanges(changes, get().edges),
          });
          const hasRemove = changes.some(c => c.type === 'remove');
          if (hasRemove) {
            get().evaluateGraph();
          }
        },
        onConnect: (connection) => {
          set({
            edges: addEdge(connection, get().edges),
          });
          get().evaluateGraph();
        },
        setNodes: (nodes) => {
          set({ nodes });
          get().evaluateGraph();
        },
        setEdges: (edges) => {
          set({ edges });
          get().evaluateGraph();
        },
        updateNodeData: (id, data) => {
          set({
            nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...data } } : n)
          });
          get().evaluateGraph();
        },

        // Scene & Evaluation
        sceneObjects: [],
        setSceneObjects: (sceneObjects) => set({ sceneObjects }),
        toggleObjectVisibility: (id) =>
          set((state) => ({
            sceneObjects: state.sceneObjects.map((obj) =>
              obj.id === id ? { ...obj, visible: !obj.visible } : obj
            ),
          })),
        
        isEvaluating: false,
        triggerFitCount: 0,
        zoomToFit: () => set((state) => ({ triggerFitCount: state.triggerFitCount + 1 })),
        evaluateGraph: () => {
          // Debounce rapid re-evaluations (slider drags): trailing edge.
          // Kept short (50ms) for responsiveness — the worker is never
          // overrun because in-flight evals coalesce via _pendingEvaluation,
          // and unchanged parts are no longer re-uploaded (see EVALUATE_DONE).
          if ((window as any)._evalDebounceTimer) {
            clearTimeout((window as any)._evalDebounceTimer);
          }
          (window as any)._evalDebounceTimer = setTimeout(() => {
            (window as any)._evalDebounceTimer = null;
            const { nodes, edges, macros } = get();
            if (nodes.length === 0) {
              set({ sceneObjects: [], lastGeometryReport: null });
              resolveEvalWaiters({ error: null, report: null });
              return;
            }

            if (get().isEvaluating) {
              (window as any)._pendingEvaluation = true;
              return;
            }

            set({ isEvaluating: true });
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: generateUUID(),
              payload: { nodes, edges, macros }
            });
          }, 50);
        },
        clearGraph: () => {
          set({ nodes: [], edges: [], sceneObjects: [], lastEvaluationError: null, lastGeometryReport: null });
        },
        lastEvaluationError: null,
        clearLastEvaluationError: () => set({ lastEvaluationError: null }),
        
        // Agent Guidelines
        agentGuidelines: DEFAULT_GUIDELINES,
        setAgentGuidelines: (agentGuidelines) => {
          set({ agentGuidelines });
          fetch('/api/guidelines', {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
            body: agentGuidelines
          }).catch(err => console.error('Failed to save guidelines on server:', err));
        },
        initializeGuidelines: async () => {
          try {
            const res = await fetch('/api/guidelines');
            if (res.ok) {
              const text = await res.text();
              if (text && text.trim()) {
                set({ agentGuidelines: text });
              }
            }
          } catch (e) {
            console.error('Failed to load guidelines from server:', e);
          }
        },

        // Geometry report
        lastGeometryReport: null,

        // Episode tracking
        episodePrompts: [],
        episodePlan: '',
        addEpisodePrompt: (p: string) => set((state) => ({ episodePrompts: [...state.episodePrompts, p] })),
        setEpisodePlan: (p: string) => set({ episodePlan: p }),
        resetEpisode: () => set({ episodePrompts: [], episodePlan: '', lastAIGraph: null }),
        lastAIGraph: null,
        setLastAIGraph: (g) => set({ lastAIGraph: g }),

        // Success library
        successExamples: [],
        addSuccessExample: (ex: SuccessExample) => {
          set((state) => {
            const successExamples = [ex, ...state.successExamples];
            fetch('/api/examples', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(successExamples)
            }).catch(e => console.error('Failed to save examples', e));
            return { successExamples };
          });
        },
        removeSuccessExample: (id: string) => {
          set((state) => {
            const successExamples = state.successExamples.filter(e => e.id !== id);
            fetch('/api/examples', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(successExamples)
            }).catch(e => console.error('Failed to save examples', e));
            return { successExamples };
          });
        },
        initializeExamples: async () => {
          try {
            const res = await fetch('/api/examples');
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data)) set({ successExamples: data });
            }
          } catch (e) {
            console.error('Failed to load examples from server:', e);
          }
        },

        // Macro library
        macros: [],
        addMacro: (m: MacroDefinition) => {
          set((state) => {
            const macros = [m, ...state.macros];
            fetch('/api/macros', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(macros)
            }).catch(e => console.error('Failed to save macros', e));
            return { macros };
          });
        },
        removeMacro: (id: string) => {
          set((state) => {
            const macros = state.macros.filter(m => m.id !== id);
            fetch('/api/macros', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(macros)
            }).catch(e => console.error('Failed to save macros', e));
            return { macros };
          });
        },
        initializeMacros: async () => {
          try {
            const res = await fetch('/api/macros');
            if (res.ok) {
              const data = await res.json();
              if (Array.isArray(data)) set({ macros: data });
            }
          } catch (e) {
            console.error('Failed to load macros from server:', e);
          }
        },

        // Save modal + nudge
        saveModalOpen: false,
        saveModalCandidate: null,
        openSaveModal: (candidate = null) => set({ saveModalOpen: true, saveModalCandidate: candidate }),
        closeSaveModal: () => set({ saveModalOpen: false, saveModalCandidate: null }),
        nudgeCandidate: null,
        setNudgeCandidate: (c) => set({ nudgeCandidate: c }),

        // Eval harness results
        evalResults: [],
        addEvalResult: (r: EvalResultEntry) => {
          set((state) => ({ evalResults: [r, ...state.evalResults] }));
          fetch('/api/eval-results', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(r)
          }).catch(e => console.error('Failed to save eval result', e));
        },
        isRunningEvals: false,
        setIsRunningEvals: (v: boolean) => set({ isRunningEvals: v }),
      };
    },
    {
      name: 'ai-cad-storage',
      version: 2, // v2: retired dynamicKnowledge (replaced by the success library)
      partialize: (state) => ({
        messages: state.messages.slice(-50),
        agentSlots: state.agentSlots,
        activeAgentId: state.activeAgentId,
        performanceLogs: state.performanceLogs.slice(-50),
        agentGuidelines: state.agentGuidelines,
        evalResults: state.evalResults.slice(-200),
      }),
    }
  )
);
