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
import type { DesignGenome } from '../ai/genome';
import type {
  GeometryReport,
  EvaluationOutcome,
  NudgeCandidate,
  EvalResultEntry,
  ChatMessage,
  SceneObject,
  PerformanceLogEntry,
  AgentSlot,
  GraphTimelineEntry,
} from './types';
import { DEFAULT_GUIDELINES } from './guidelines';
import { isSystemError } from '../utils/errors';

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

// Persistence helper to dry up fetch calls
async function persistData(endpoint: string, payload: any, isText = false) {
  try {
    await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json' },
      body: isText ? payload : JSON.stringify(payload),
    });
  } catch (e) {
    console.error(`Failed to save data to ${endpoint}:`, e);
  }
}

// Scratch evaluations (isolated single-node repros for the agent's diagnosis
// loop) — routed by id, never touching scene state.
const scratchWaiters = new Map<string, (outcome: EvaluationOutcome) => void>();

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
  evaluateScratch: (nodes: any[]) => Promise<EvaluationOutcome>;
  clearGraph: () => void;
  lastEvaluationError: string | null;
  clearLastEvaluationError: () => void;
  triggerFitCount: number;
  zoomToFit: () => void;
  // Node-graph zoom-to-fit trigger (mirrors the 3D viewport's zoomToFit):
  // bumped after every AI graph application so the whole graph stays in view.
  graphFitCount: number;
  zoomGraphToFit: () => void;

  // Graph timeline: per-turn history of the graph for session exports.
  graphTimeline: GraphTimelineEntry[];
  recordGraphSnapshot: (trigger: string, label: string, details?: string[]) => void;

  // Agent Guidelines (Continuous Knowledge Base)
  agentGuidelines: string;
  setAgentGuidelines: (guidelines: string) => void;
  initializeGuidelines: () => Promise<void>;

  // Geometry report from the last evaluation (percepts for the agent)
  lastGeometryReport: GeometryReport | null;
  hasRetriedDeleted: boolean;

  // Episode tracking (prompts + plan of the current design, for the success library)
  episodePrompts: string[];
  episodePlan: string;
  episodeRatios: { param: string; formula: string }[];
  episodeDrivers: string[];
  episodeGenome: DesignGenome | null;
  addEpisodePrompt: (p: string) => void;
  setEpisodePlan: (p: string) => void;
  setEpisodeRatios: (ratios: { param: string; formula: string }[]) => void;
  setEpisodeDrivers: (drivers: string[]) => void;
  setEpisodeGenome: (g: DesignGenome | null) => void;
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
        const { type, result, error, report, id } = e.data;
        if (type === 'SCRATCH_DONE') {
          const waiter = scratchWaiters.get(id);
          if (waiter) {
            scratchWaiters.delete(id);
            waiter({ error: error || null, report: report || null });
          }
          return;
        }
        if (type === 'EVALUATE_DONE') {
          // A3: poisoned-kernel detection. Per-node kernel-class failures never
          // reach EVALUATE_ERROR (the evaluation "succeeds"), so a corrupted
          // WASM instance would otherwise keep serving failing evals while the
          // agent burned its repair budget on graph edits (see
          // docs/stadium_transcript_analysis.md). Respawn + replay once.
          const kernelSuspect = !!(report && ((report as any).kernelSuspect || (report as any).kernelHealth === 'failed'));
          if (kernelSuspect && !get().hasRetriedDeleted) {
            console.warn('Kernel-class node failures detected — respawning worker and replaying evaluation once...');
            set({ hasRetriedDeleted: true });
            try { worker.terminate(); } catch (err) { /* noop */ }
            worker = createGeometryWorker();
            bindWorker(worker);
            const { nodes, edges, macros } = get();
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: id || generateUUID(),
              payload: { nodes, edges, macros, disablePerturbation: true }
            });
            return;
          }
          // A4: the fresh worker ran a Box canary at init. If even that fails
          // after a respawn, no graph edit can help — surface an honest system
          // error instead of a repairable-looking report.
          if (report && (report as any).kernelHealth === 'failed') {
            const errStr = 'OpenCascade kernel canary failed after worker restart — engine restart required; graph edits will not help. Reload the app if this persists.';
            get().addPerformanceLog({
              model: 'System',
              request: 'Graph Evaluation (Kernel Canary Failed)',
              success: false,
              responseTimeMs: 0,
              nodeCount: get().nodes.length,
              edgeCount: get().edges.length,
              error: errStr
            });
            set({ isEvaluating: false, lastEvaluationError: errStr, lastGeometryReport: report || null, hasRetriedDeleted: false });
            resolveEvalWaiters({ error: errStr, report: report || null });
            return;
          }
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
          set({ sceneObjects: newObjects, isEvaluating: false, lastEvaluationError: evaluationError, lastGeometryReport: report || null, hasRetriedDeleted: false });

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
        } else if (type === 'PERTURBATION_REPORT') {
          set((state) => {
            if (state.lastGeometryReport) {
              return {
                lastGeometryReport: {
                  ...state.lastGeometryReport,
                  perturbationIssues: report.perturbationIssues,
                  proportionalIntegrity: report.proportionalIntegrity
                }
              };
            }
            return {};
          });
        } else if (type === 'EVALUATE_ERROR') {
          const errStr = String(error || 'Unknown error during graph evaluation');
          if (isSystemError(errStr) && !get().hasRetriedDeleted) {
            console.warn("Detected system/kernel deletion error. Respawning worker and retrying evaluation once...", errStr);
            set({ hasRetriedDeleted: true });
            try { worker.terminate(); } catch (err) {}
            worker = createGeometryWorker();
            bindWorker(worker);
            
            // Re-post message to restart the evaluation
            const { nodes, edges, macros } = get();
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: id || generateUUID(),
              payload: { nodes, edges, macros, disablePerturbation: true }
            });
            return;
          }

          console.error('Graph Evaluation Error:', error);
          get().addPerformanceLog({
            model: 'System',
            request: 'Graph Evaluation (Crash)',
            success: false,
            responseTimeMs: 0,
            nodeCount: get().nodes.length,
            edgeCount: get().edges.length,
            error: errStr
          });
          set({
            isEvaluating: false,
            lastEvaluationError: errStr,
            hasRetriedDeleted: false
          });
          if ((window as any)._pendingEvaluation) {
            (window as any)._pendingEvaluation = false;
            get().evaluateGraph();
          } else {
            resolveEvalWaiters({ error: errStr, report: null });
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
            performanceLogs: [newEntry, ...state.performanceLogs].slice(0, 50)
          }));
          persistData('/api/log', newEntry);
        },

        // Chat
        messages: [],
        addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
        removeMessage: (id) => set((state) => ({ messages: state.messages.filter(m => m.id !== id) })),
        // A cleared conversation starts a fresh trace: timeline entries refer
        // to conversation turns, so they reset together.
        clearMessages: () => set({ messages: [], graphTimeline: [] }),

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
            get().recordGraphSnapshot('user-edit', 'manual node removal');
          }
        },
        onEdgesChange: (changes) => {
          set({
            edges: applyEdgeChanges(changes, get().edges),
          });
          const hasRemove = changes.some(c => c.type === 'remove');
          if (hasRemove) {
            get().evaluateGraph();
            get().recordGraphSnapshot('user-edit', 'manual edge removal');
          }
        },
        onConnect: (connection) => {
          set({
            edges: addEdge(connection, get().edges),
          });
          get().evaluateGraph();
          get().recordGraphSnapshot('user-edit', 'manual connect');
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
        graphFitCount: 0,
        zoomGraphToFit: () => set((state) => ({ graphFitCount: state.graphFitCount + 1 })),

        // Graph timeline. Structural-diff based: identical consecutive states
        // are not recorded twice (unless they carry details), so this can be
        // called liberally from the agent loop and manual-edit handlers.
        graphTimeline: [],
        recordGraphSnapshot: (trigger, label, details) => {
          const s = get();
          const prev = s.graphTimeline[s.graphTimeline.length - 1];
          const nodes = s.nodes as any[];
          const edges = s.edges as any[];
          const nodeSig = (n: any) => `${n.type}|${JSON.stringify(n.data || {})}`;
          const edgeKey = (e: any) =>
            `${e.source}.${e.sourceHandle ?? ''}->${e.target}.${e.targetHandle ?? ''}`;
          const currNodes = new Map(nodes.map(n => [String(n.id), nodeSig(n)]));
          const currEdges = new Set(edges.map(edgeKey));
          const prevNodes = new Map<string, string>(
            ((prev?.nodes || []) as any[]).map(n => [String(n.id), nodeSig(n)])
          );
          const prevEdges = new Set(((prev?.edges || []) as any[]).map(edgeKey));

          const addedNodes = [...currNodes.keys()].filter(id => !prevNodes.has(id));
          const removedNodes = [...prevNodes.keys()].filter(id => !currNodes.has(id));
          const changedNodes = [...currNodes.keys()].filter(
            id => prevNodes.has(id) && prevNodes.get(id) !== currNodes.get(id)
          );
          const addedEdges = [...currEdges].filter(k => !prevEdges.has(k)).length;
          const removedEdges = [...prevEdges].filter(k => !currEdges.has(k)).length;

          const unchanged = !!prev && addedNodes.length === 0 && removedNodes.length === 0 &&
            changedNodes.length === 0 && addedEdges === 0 && removedEdges === 0;
          if (unchanged && !(details && details.length)) return;

          const wired = new Set<string>();
          edges.forEach(e => { wired.add(String(e.source)); wired.add(String(e.target)); });
          const isolatedCount = nodes.filter(n => !wired.has(String(n.id))).length;

          const entry: GraphTimelineEntry = {
            at: new Date().toISOString(),
            turn: s.messages.filter(m => m.role === 'user').length,
            trigger,
            label: String(label || '').slice(0, 300),
            nodeCount: nodes.length,
            edgeCount: edges.length,
            isolatedCount,
            diff: {
              addedNodes: addedNodes.slice(0, 100),
              removedNodes: removedNodes.slice(0, 100),
              changedNodes: changedNodes.slice(0, 100),
              addedEdges,
              removedEdges,
            },
            details: details && details.length
              ? details.slice(0, 25).map(d => String(d).slice(0, 300))
              : undefined,
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
          };
          // Cap the in-memory history; exports rarely need more than this and
          // the timeline is intentionally NOT persisted to localStorage.
          set({ graphTimeline: [...s.graphTimeline, entry].slice(-200) });
        },
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
        evaluateScratch: (nodes: any[]) => {
          // A8: evaluate a tiny synthetic graph in the worker without touching
          // the user's scene — used for harness-side minimal repros.
          return new Promise<EvaluationOutcome>((resolve) => {
            const id = generateUUID();
            const timer = setTimeout(() => {
              scratchWaiters.delete(id);
              resolve({ error: 'Scratch evaluation timed out', report: null });
            }, 15000);
            scratchWaiters.set(id, (outcome) => {
              clearTimeout(timer);
              resolve(outcome);
            });
            try {
              worker.postMessage({ type: 'EVALUATE_SCRATCH', id, payload: { nodes, edges: [], macros: [] } });
            } catch (e: any) {
              scratchWaiters.delete(id);
              clearTimeout(timer);
              resolve({ error: String(e?.message || e), report: null });
            }
          });
        },
        clearGraph: () => {
          set({ nodes: [], edges: [], sceneObjects: [], lastEvaluationError: null, lastGeometryReport: null });
          // A5: a clean slate gets a fresh kernel. "Try from a clean graph" is
          // the instinctive recovery move (users and models both reach for it)
          // — it must actually reset the engine, not just the node list.
          if (!get().isEvaluating) {
            try { worker.terminate(); } catch (e) { /* noop */ }
            worker = createGeometryWorker();
            bindWorker(worker);
          } else {
            try {
              worker.postMessage({ type: 'CLEAR_CACHE' });
            } catch (e) { /* noop */ }
          }
        },
        lastEvaluationError: null,
        clearLastEvaluationError: () => set({ lastEvaluationError: null }),
        hasRetriedDeleted: false,
        
        // Agent Guidelines
        agentGuidelines: DEFAULT_GUIDELINES,
        setAgentGuidelines: (agentGuidelines) => {
          set({ agentGuidelines });
          persistData('/api/guidelines', agentGuidelines, true);
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
        episodeRatios: [],
        episodeDrivers: [],
        episodeGenome: null,
        addEpisodePrompt: (p: string) => set((state) => ({ episodePrompts: [...state.episodePrompts, p] })),
        setEpisodePlan: (p: string) => set({ episodePlan: p }),
        setEpisodeRatios: (ratios) => set({ episodeRatios: ratios }),
        setEpisodeDrivers: (drivers) => set({ episodeDrivers: drivers }),
        setEpisodeGenome: (g) => set({ episodeGenome: g }),
        resetEpisode: () => set({ episodePrompts: [], episodePlan: '', episodeRatios: [], episodeDrivers: [], episodeGenome: null, lastAIGraph: null }),
        lastAIGraph: null,
        setLastAIGraph: (g) => set({ lastAIGraph: g }),

        // Success library
        successExamples: [],
        addSuccessExample: (ex: SuccessExample) => {
          set((state) => {
            // C5: stamp capability provenance — retrieval shows the stamp so a
            // stale success can't masquerade as current-environment truth.
            const stamped = { ...ex, verifiedOnBuild: ex.verifiedOnBuild || new Date().toISOString().slice(0, 10) };
            const successExamples = [stamped, ...state.successExamples];
            persistData('/api/examples', successExamples);
            return { successExamples };
          });
        },
        removeSuccessExample: (id: string) => {
          set((state) => {
            const successExamples = state.successExamples.filter(e => e.id !== id);
            persistData('/api/examples', successExamples);
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
            persistData('/api/macros', macros);
            return { macros };
          });
        },
        removeMacro: (id: string) => {
          set((state) => {
            const macros = state.macros.filter(m => m.id !== id);
            persistData('/api/macros', macros);
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
        openSaveModal: (candidate = null) => {
          if (isSystemError(get().lastEvaluationError)) {
            console.warn("Save blocked due to active system/kernel error.");
            return;
          }
          set({ saveModalOpen: true, saveModalCandidate: candidate });
        },
        closeSaveModal: () => set({ saveModalOpen: false, saveModalCandidate: null }),
        nudgeCandidate: null,
        setNudgeCandidate: (c) => set({ nudgeCandidate: c }),

        // Eval harness results
        evalResults: [],
        addEvalResult: (r: EvalResultEntry) => {
          set((state) => ({ evalResults: [r, ...state.evalResults] }));
          persistData('/api/eval-results', r);
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
        // Keep the newest 200 runs (evalResults is newest-first). Graph snapshots
        // are large, so persist them only for the newest 30 — enough to click in
        // and re-load recent designs without blowing the localStorage quota.
        evalResults: state.evalResults.slice(0, 200).map((r, i) =>
          i < 30 ? r : { ...r, graphSnapshot: undefined }
        ),
      }),
    }
  )
);

export type {
  LeafReport,
  GeometryReport,
  EvaluationOutcome,
  NudgeCandidate,
  EvalResultEntry,
  ChatMessage,
  SceneObject,
  PerformanceLogEntry,
  AgentSlot,
  GraphTimelineEntry,
} from './types';
