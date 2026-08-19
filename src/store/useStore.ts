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

// ---------------------------------------------------------------------------
// SPEC-1: evaluation protocol ids. Every EVALUATE_GRAPH post carries a fresh
// id; DONE/ERROR/PERTURBATION messages are applied only when their id matches
// the eval we last posted. Stale results from a superseded or cleared graph
// are dropped instead of resurrecting deleted geometry or stamping old
// perturbation issues onto a new report.
// ---------------------------------------------------------------------------
let evalSeq = 0;
let currentEvalId: string | null = null;
const nextEvalId = () => { currentEvalId = String(++evalSeq); return currentEvalId; };

// SPEC-2: watchdog. A wedged evaluation (infinite tokenizer loop, runaway
// count) never posts DONE or ERROR — the timer is the only way out.
const EVAL_WATCHDOG_MS = 120_000;
let evalWatchdogTimer: ReturnType<typeof setTimeout> | null = null;
const clearEvalWatchdog = () => {
  if (evalWatchdogTimer) {
    clearTimeout(evalWatchdogTimer);
    evalWatchdogTimer = null;
  }
};

export const generateUUID = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
};

// ---------------------------------------------------------------------------
// SESSION IDENTITY (Jul 29)
//
// One id per browser tab per design. It is NOT persisted: a reload or a
// cleared workspace starts a new session, which is what "session" means here.
// Because each dev-server port is its own browser origin, five parallel
// instances naturally produce five distinct sessions writing to one database.
// ---------------------------------------------------------------------------
let currentSessionId = generateUUID();
export const getSessionId = () => currentSessionId;
export const newSessionId = () => { currentSessionId = generateUUID(); return currentSessionId; };

/**
 * Send a record to the session store. Deliberately fire-and-forget and
 * deliberately silent: capturing history must never slow the app down, and a
 * store that is unavailable (production build, no dev server) must never
 * surface an error to the user.
 */
function record(endpoint: string, payload: any): void {
  try {
    void fetch(`/api/store/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: currentSessionId, ...payload }),
    }).catch(() => { /* store is optional */ });
  } catch { /* store is optional */ }
}

/**
 * Save YOUR note/verdict on the current session and report whether it landed.
 *
 * Unlike record() this one is awaited, because the person is standing there
 * waiting to see that their note was kept. It still cannot throw: a missing
 * store resolves false and the UI says so plainly instead of erroring.
 */
export async function saveSessionNote(
  body: string,
  verdict: 'OK' | 'WEAK' | 'FAIL' | null,
): Promise<boolean> {
  try {
    const res = await fetch('/api/store/comment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: currentSessionId,
        body: body || `verdict: ${verdict}`,
        tag: verdict ?? 'note',
      }),
    });
    const json = await res.json().catch(() => ({ ok: false }));
    return json?.ok !== false;
  } catch {
    return false;
  }
}

// Persistence helper to dry up fetch calls. Returns whether the save actually
// landed: a 404, or an SPA fallback that rewrites /api/* to index.html
// (content-type text/html), is a MISS — not a success (SPEC-8).
async function persistData(endpoint: string, payload: any, isText = false): Promise<boolean> {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json' },
      body: isText ? payload : JSON.stringify(payload),
    });
    if (!res.ok) return false;
    if ((res.headers.get('content-type') || '').includes('text/html')) return false;
    return true;
  } catch (e) {
    console.error(`Failed to save data to ${endpoint}:`, e);
    return false;
  }
}

// One honest notice per data kind per session when the store backend is
// unreachable (production static build) — instead of announcing durable saves
// that a reload would erase.
const persistFailureNotified = new Set<string>();

// Scratch evaluations (isolated single-node repros for the agent's diagnosis
// loop) — routed by id, never touching scene state.
const scratchWaiters = new Map<string, (outcome: EvaluationOutcome) => void>();

// Waiters allow the agent to await the outcome of the next evaluation
let evalWaiters: ((outcome: EvaluationOutcome) => void)[] = [];
const resolveEvalWaiters = (outcome: EvaluationOutcome) => {
  const ws = evalWaiters;
  evalWaiters = [];
  ws.forEach(w => { try { w(outcome); } catch { /* noop */ } });
};
export const waitForEvaluation = (timeoutMs = 30000): Promise<EvaluationOutcome> => {
  const state = useStore.getState();
  // Nothing in flight and nothing scheduled: the store already holds the
  // settled outcome — resolve with it immediately instead of waiting 30s for
  // an evaluation that will never come.
  if (!state.isEvaluating && !(window as any)._evalDebounceTimer) {
    return Promise.resolve({ error: state.lastEvaluationError ?? null, report: state.lastGeometryReport ?? null });
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
        // SPEC-1: drop results from a superseded or cleared evaluation. Their
        // meshes/reports describe a graph that no longer exists.
        if (
          (type === 'EVALUATE_DONE' || type === 'EVALUATE_ERROR' || type === 'PERTURBATION_REPORT') &&
          id != null && id !== currentEvalId
        ) {
          return;
        }
        if (type === 'EVALUATE_DONE') {
          clearEvalWatchdog();
          // A3: poisoned-kernel detection. Per-node kernel-class failures never
          // reach EVALUATE_ERROR (the evaluation "succeeds"), so a corrupted
          // WASM instance would otherwise keep serving failing evals while the
          // agent burned its repair budget on graph edits (see
          // docs/stadium_transcript_analysis.md). Respawn + replay once.
          const kernelSuspect = !!(report && ((report as any).kernelSuspect || (report as any).kernelHealth === 'failed'));
          if (kernelSuspect && !get().hasRetriedDeleted) {
            console.warn('Kernel-class node failures detected — respawning worker and replaying evaluation once...');
            set({ hasRetriedDeleted: true });
            try { worker.terminate(); } catch { /* noop */ }
            worker = createGeometryWorker();
            bindWorker(worker);
            const { nodes, edges, macros } = get();
            const replayId = nextEvalId();
            armEvalWatchdog(replayId);
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: replayId,
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
            const stampedErrReport = report ? { ...report, evalId: id ?? currentEvalId } : null;
            set({ isEvaluating: false, lastEvaluationError: errStr, lastGeometryReport: stampedErrReport, hasRetriedDeleted: false });
            resolveEvalWaiters({ error: errStr, report: stampedErrReport });
            return;
          }
          const currentObjects = get().sceneObjects;

          // Ancestor-color lookup, memoized per message with a cycle guard —
          // the old per-leaf recursion re-walked the whole upstream graph for
          // every leaf (exponential on diamond graphs, unbounded on cycles).
          const nodeById = new Map(get().nodes.map(n => [n.id, n]));
          const sourcesByTarget = new Map<string, string[]>();
          get().edges.forEach(e => {
            const list = sourcesByTarget.get(e.target);
            if (list) list.push(e.source); else sourcesByTarget.set(e.target, [e.source]);
          });
          const colorMemo = new Map<string, string | undefined>();
          const findColor = (nodeId: string, visited: Set<string>): string | undefined => {
            if (colorMemo.has(nodeId)) return colorMemo.get(nodeId);
            if (visited.has(nodeId)) return undefined;
            visited.add(nodeId);
            const node = nodeById.get(nodeId);
            let color: string | undefined;
            if (node) {
              if (node.data && (node.data as any).color) {
                color = (node.data as any).color;
              } else {
                for (const src of sourcesByTarget.get(nodeId) || []) {
                  color = findColor(src, visited);
                  if (color) break;
                }
              }
            }
            colorMemo.set(nodeId, color);
            return color;
          };

          const newObjects = result.map((res: any) => {
            const existing = currentObjects.find(o => o.id === res.id);
            // SPEC-9: preserve the worker's mesh kind (Mesh | Line | Point) so
            // the viewport can pick the right render primitive.
            const resType = res.type || 'Mesh';

            // Reuse the previous geometryData object reference when this part's
            // geometry is unchanged (same worker hash). The viewport memoizes
            // its BufferGeometry (and expensive edge lines) on geometryData
            // identity, so this avoids re-tessellating and re-uploading every
            // untouched part on each slider tick — only the driven part rebuilds.
            const unchanged = existing && res.hash && existing.meshHash === res.hash && existing.geometryData;
            return {
              id: res.id,
              name: existing ? existing.name : `Node_${res.id}`,
              type: resType,
              visible: existing ? existing.visible : true,
              color: findColor(res.id, new Set()),
              meshHash: res.hash,
              geometryData: unchanged ? existing.geometryData : {
                type: resType,
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
          set({ sceneObjects: newObjects, isEvaluating: false, lastEvaluationError: evaluationError, lastGeometryReport: report ? { ...report, evalId: id ?? currentEvalId } : null, hasRetriedDeleted: false });

          // Recycle the worker periodically to contain OCCT WASM memory growth
          if (report?.recycleRecommended && !(window as any)._pendingEvaluation) {
            try { worker.terminate(); } catch { /* noop */ }
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
          clearEvalWatchdog();
          const errStr = String(error || 'Unknown error during graph evaluation');
          if (isSystemError(errStr) && !get().hasRetriedDeleted) {
            console.warn("Detected system/kernel deletion error. Respawning worker and retrying evaluation once...", errStr);
            set({ hasRetriedDeleted: true });
            try { worker.terminate(); } catch {}
            worker = createGeometryWorker();
            bindWorker(worker);

            // Re-post message to restart the evaluation
            const { nodes, edges, macros } = get();
            const replayId = nextEvalId();
            armEvalWatchdog(replayId);
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: replayId,
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

      // Catch worker loading/runtime errors and log them to performanceLogs.
      // SPEC-2: an errored worker may be wedged — respawn it and drop any
      // queued re-evaluation so the pipeline can't deadlock on a dead worker.
      w.onerror = (err) => {
        console.error('Worker error:', err);
        if (w !== worker) return; // an already-replaced worker; nothing to recover
        clearEvalWatchdog();
        currentEvalId = null;
        (window as any)._pendingEvaluation = false;
        try { worker.terminate(); } catch { /* noop */ }
        worker = createGeometryWorker();
        bindWorker(worker);
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

      // SPEC-2: per-eval watchdog. Armed on every EVALUATE_GRAPH post, cleared
      // on DONE/ERROR. On fire the worker is presumed wedged: kill it, respawn,
      // and surface an honest error instead of hanging forever.
      const armEvalWatchdog = (evalId: string) => {
        clearEvalWatchdog();
        evalWatchdogTimer = setTimeout(() => {
          evalWatchdogTimer = null;
          if (evalId !== currentEvalId) return; // superseded meanwhile
          currentEvalId = null;
          (window as any)._pendingEvaluation = false;
          try { worker.terminate(); } catch { /* noop */ }
          worker = createGeometryWorker();
          bindWorker(worker);
          const errStr = 'Evaluation exceeded 120s and was terminated — likely an infinite loop or runaway count. The graph was NOT evaluated.';
          get().addPerformanceLog({
            model: 'System',
            request: 'Graph Evaluation (Watchdog Timeout)',
            success: false,
            responseTimeMs: EVAL_WATCHDOG_MS,
            nodeCount: get().nodes.length,
            edgeCount: get().edges.length,
            error: errStr
          });
          set({ isEvaluating: false, lastEvaluationError: errStr, hasRetriedDeleted: false });
          resolveEvalWaiters({ error: errStr, report: null });
        }, EVAL_WATCHDOG_MS);
      };

      // Persistence honesty (SPEC-8): tell the user, once per data kind, when a
      // "durable" save only landed in this browser's localStorage.
      const notifyPersistFailure = (what: string) => {
        if (persistFailureNotified.has(what)) return;
        persistFailureNotified.add(what);
        get().addMessage({
          id: generateUUID(),
          role: 'system',
          content: `${what} saved in this browser only — no store backend reachable. It will not sync to the shared knowledge store.`,
        });
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
            apiKey: 'http://127.0.0.1:11434',
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
                apiKey: 'http://127.0.0.1:11434',
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
          void persistData('/api/log', { ...newEntry, sessionId: currentSessionId });
        },

        // Chat
        messages: [],
        addMessage: (msg) => {
          set((state) => ({ messages: [...state.messages, msg] }));
          // System messages carry the compiler's feedback — the most
          // analytically valuable rows in the store. Keep all of them.
          const seq = get().messages.length;
          record('message', { seq, role: msg.role, content: msg.content, at: new Date().toISOString() });
        },
        removeMessage: (id) => set((state) => ({ messages: state.messages.filter(m => m.id !== id) })),
        // A cleared conversation starts a fresh trace: timeline entries refer
        // to conversation turns, so they reset together.
        clearMessages: () => {
          newSessionId();          // a cleared conversation is a new session
          set({ messages: [], graphTimeline: [] });
        },

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

          // ...but it IS written to the store, immediately. This is what makes
          // a run that blacks out still leave evidence behind: the in-memory
          // timeline dies with the tab, the stored one does not.
          const agent = s.agentSlots.find(a => a.id === s.activeAgentId);
          record('turn', {
            ...entry,
            model: agent?.model ?? null,
            provider: agent?.provider ?? null,
          });
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
              // Deleting the last node empties the scene. Invalidate any
              // in-flight eval (SPEC-1 — its result would resurrect the
              // deleted geometry) and clear the stale evaluation error: an
              // empty graph has no failure to report.
              evalSeq++;
              currentEvalId = null;
              clearEvalWatchdog();
              (window as any)._pendingEvaluation = false;
              set({ sceneObjects: [], lastGeometryReport: null, lastEvaluationError: null, isEvaluating: false });
              resolveEvalWaiters({ error: null, report: null });
              return;
            }

            if (get().isEvaluating) {
              (window as any)._pendingEvaluation = true;
              return;
            }

            set({ isEvaluating: true });
            const evalId = nextEvalId();
            armEvalWatchdog(evalId);
            worker.postMessage({
              type: 'EVALUATE_GRAPH',
              id: evalId,
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
          // SPEC-1: bump the eval sequence so any in-flight result is stale by
          // definition — a cleared canvas must stay cleared, even if the old
          // graph's evaluation finishes a second later.
          evalSeq++;
          currentEvalId = null;
          clearEvalWatchdog();
          (window as any)._pendingEvaluation = false;
          set({ nodes: [], edges: [], sceneObjects: [], lastEvaluationError: null, lastGeometryReport: null, isEvaluating: false });
          // A5: a clean slate gets a fresh kernel. "Try from a clean graph" is
          // the instinctive recovery move (users and models both reach for it)
          // — it must actually reset the engine, not just the node list. An
          // in-flight evaluation is terminated with the worker: its result is
          // invalidated above, so letting it finish would only burn CPU.
          try { worker.terminate(); } catch { /* noop */ }
          worker = createGeometryWorker();
          bindWorker(worker);
          resolveEvalWaiters({ error: null, report: null });
        },
        lastEvaluationError: null,
        clearLastEvaluationError: () => set({ lastEvaluationError: null }),
        hasRetriedDeleted: false,
        
        // Agent Guidelines
        agentGuidelines: DEFAULT_GUIDELINES,
        setAgentGuidelines: (agentGuidelines) => {
          set({ agentGuidelines });
          void persistData('/api/guidelines', agentGuidelines, true).then(ok => {
            if (!ok) notifyPersistFailure('Guidelines');
          });
        },
        initializeGuidelines: async () => {
          try {
            const res = await fetch('/api/guidelines');
            // SPA-rewrite guard: a static host serves index.html for unknown
            // routes — that page must never become the agent's guidelines.
            if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
              const text = await res.text();
              if (text && text.trim() && !/^\s*<(!doctype|html)/i.test(text)) {
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
          // C5: stamp capability provenance — retrieval shows the stamp so a
          // stale success can't masquerade as current-environment truth.
          const stamped = { ...ex, verifiedOnBuild: ex.verifiedOnBuild || new Date().toISOString().slice(0, 10) };
          const successExamples = [stamped, ...get().successExamples];
          set({ successExamples });
          void persistData('/api/examples', successExamples).then(ok => {
            if (!ok) notifyPersistFailure('Example');
          });
        },
        removeSuccessExample: (id: string) => {
          const successExamples = get().successExamples.filter(e => e.id !== id);
          set({ successExamples });
          void persistData('/api/examples', successExamples).then(ok => {
            if (!ok) notifyPersistFailure('Example');
          });
        },
        initializeExamples: async () => {
          try {
            const res = await fetch('/api/examples');
            // Reject SPA-rewritten HTML bodies and drop obviously-malformed
            // entries so one bad row can't crash the Library UI or retrieval.
            if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
              const data = await res.json();
              if (Array.isArray(data)) {
                const valid = data.filter((ex: any) =>
                  ex && typeof ex === 'object' && ex.id &&
                  ex.graphFinal && Array.isArray(ex.graphFinal.nodes) && Array.isArray(ex.graphFinal.edges));
                set({ successExamples: valid });
              }
            }
          } catch (e) {
            console.error('Failed to load examples from server:', e);
          }
        },

        // Macro library
        macros: [],
        addMacro: (m: MacroDefinition) => {
          const macros = [m, ...get().macros];
          set({ macros });
          void persistData('/api/macros', macros).then(ok => {
            if (!ok) notifyPersistFailure('Macro');
          });
        },
        removeMacro: (id: string) => {
          const macros = get().macros.filter(m => m.id !== id);
          set({ macros });
          void persistData('/api/macros', macros).then(ok => {
            if (!ok) notifyPersistFailure('Macro');
          });
        },
        initializeMacros: async () => {
          try {
            const res = await fetch('/api/macros');
            if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) {
              const data = await res.json();
              if (Array.isArray(data)) {
                set({ macros: data.filter((m: any) => m && m.id && Array.isArray(m.nodes)) });
              }
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
          // Stamp a stable id: result rows are keyed/expanded by it in the UI.
          const entry = r.id ? r : { ...r, id: generateUUID() };
          set((state) => ({ evalResults: [entry, ...state.evalResults] }));
          void persistData('/api/eval-results', entry);
        },
        isRunningEvals: false,
        setIsRunningEvals: (v: boolean) => set({ isRunningEvals: v }),
      };
    },
    {
      name: 'ai-cad-storage',
      // v2: retired dynamicKnowledge (replaced by the success library)
      // v3 (SPEC-8): persist successExamples + macros (the app's only long-term
      // knowledge no longer evaporates on reload in production); stop persisting
      // the disableToolCalling ratchet; add a migrate that preserves old state.
      version: 3,
      migrate: (persisted: any) => {
        // Older versions (0/1/2) differ only in retired keys — preserve
        // everything compatible (keys, slots, history, messages) instead of
        // silently discarding the user's state.
        if (!persisted || typeof persisted !== 'object') return persisted;
        const state = { ...persisted };
        delete state.dynamicKnowledge; // retired in v2
        if (Array.isArray(state.agentSlots)) {
          // The persisted disableToolCalling ratchet permanently degraded a
          // slot after one transient error — clear it; the checkbox still
          // works per-session.
          state.agentSlots = state.agentSlots.map((s: any) => ({ ...s, disableToolCalling: undefined }));
        }
        return state;
      },
      partialize: (state) => ({
        messages: state.messages.slice(-50),
        // Strip the disableToolCalling ratchet from persisted slots (SPEC-8):
        // one transient "tool" error must not degrade a slot across reloads.
        agentSlots: state.agentSlots.map(s => ({ ...s, disableToolCalling: undefined })),
        activeAgentId: state.activeAgentId,
        performanceLogs: state.performanceLogs.slice(-50),
        agentGuidelines: state.agentGuidelines,
        // The verified knowledge library and macros are newest-first; keep the
        // newest 50 examples (thumbnails + graphs are the heavy part) and all
        // macros so "Save to library" survives a reload even without a backend.
        successExamples: state.successExamples.slice(0, 50),
        macros: state.macros,
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
