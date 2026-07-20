// Export the current session as a single, self-contained JSON file: the graph
// (nodes + edges), the full conversation, the plan/genome, the last geometry
// report, an optional user comment, and metadata. This makes any run a shareable,
// analyzable artifact (R5.3) — a graph without its conversation and intent is
// half the story, so the bundle carries all of it.

import { useStore } from '../store/useStore';

export interface SessionExport {
  c33dExport: number;
  exportedAt: string;
  comment: string;
  agent: { name: string; provider: string; model: string } | null;
  graph: { nodes: any[]; edges: any[] };
  conversation: { role: string; content: string }[];
  plan: string;
  genome: unknown | null;
  geometryReport: unknown | null;
}

export function buildSessionExport(comment: string): SessionExport {
  const s = useStore.getState();
  const agent = s.agentSlots.find(a => a.id === s.activeAgentId);
  const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
  return {
    c33dExport: 1,
    exportedAt: new Date().toISOString(),
    comment: comment || '',
    agent: agent ? { name: agent.name, provider: agent.provider, model: agent.model } : null,
    graph: {
      nodes: clone(s.nodes),
      edges: clone(s.edges),
    },
    conversation: s.messages.map(m => ({ role: m.role, content: m.content })),
    plan: s.episodePlan || '',
    genome: s.episodeGenome ? clone(s.episodeGenome) : null,
    geometryReport: s.lastGeometryReport ? clone(s.lastGeometryReport) : null,
  };
}

// Trigger a browser download of the session export. Runs in the app (browser),
// not the sandbox.
export function downloadSessionExport(comment: string): void {
  const data = buildSessionExport(comment);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `c33d-graph-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
