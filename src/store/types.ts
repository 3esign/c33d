
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
  sliders?: Record<string, number>;
  nodeCount?: number;
  edgeCount?: number;
};

export type EvaluationOutcome = { error: string | null; report: GeometryReport | null };

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
