import React, { useMemo, useState } from 'react';
import { Play, FlaskConical, Square, Download, ChevronRight } from 'lucide-react';
import { useStore } from '../store/useStore';
import { runEvalSuite, stopEvalSuite, EVAL_PROMPTS } from '../ai/evalHarness';

export const EvalPanel: React.FC = () => {
  const { evalResults, isRunningEvals } = useStore();
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  // Load a stored eval graph back onto the canvas — this is what makes each run
  // a re-usable experience rather than a throwaway score. Fresh kernel first.
  const loadSnapshot = (snap?: { nodes: any[]; edges: any[] }) => {
    if (!snap) return;
    const st = useStore.getState();
    if (st.nodes.length > 0 && !window.confirm('Replace the current graph with this stored eval design?')) return;
    st.clearGraph();
    st.setNodes(JSON.parse(JSON.stringify(snap.nodes)));
    st.setEdges(JSON.parse(JSON.stringify(snap.edges)));
    st.zoomToFit();
  };

  const summary = useMemo(() => {
    // Group latest results by model + level
    const byModel: Record<string, Record<number, { total: number; sane: number; evaluated: number; avgMs: number }>> = {};
    for (const r of evalResults) {
      const levels = (byModel[r.model] = byModel[r.model] || {});
      const l = (levels[r.level] = levels[r.level] || { total: 0, sane: 0, evaluated: 0, avgMs: 0 });
      l.total++;
      if (r.geometrySane) l.sane++;
      if (r.evaluatedOk) l.evaluated++;
      l.avgMs += r.durationMs;
    }
    Object.values(byModel).forEach(levels => Object.values(levels).forEach(l => { l.avgMs = Math.round(l.avgMs / l.total); }));
    return byModel;
  }, [evalResults]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5">
          <FlaskConical size={14} className="text-purple-400" /> Eval Harness
        </h3>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => runEvalSuite((done, total, current) => setProgress({ done, total, current }))}
            disabled={isRunningEvals}
            className="text-[10px] bg-purple-700 hover:bg-purple-600 disabled:bg-slate-700 disabled:text-slate-500 text-white px-3 py-1.5 rounded flex items-center gap-1.5 font-medium"
          >
            <Play size={11} />
            {isRunningEvals ? `Running ${progress ? `${progress.done}/${progress.total} (${progress.current})` : '…'}` : `Run ${EVAL_PROMPTS.length} evals`}
          </button>
          {isRunningEvals && (
            <button
              onClick={() => stopEvalSuite()}
              className="text-[10px] bg-red-800 hover:bg-red-700 text-white px-3 py-1.5 rounded flex items-center gap-1.5 font-medium"
              title="Stop after the current prompt finishes"
            >
              <Square size={10} />
              Stop
            </button>
          )}
        </div>
      </div>
      <p className="text-[10px] text-slate-400 leading-relaxed">
        Runs a fixed {EVAL_PROMPTS.length}-prompt suite (4 complexity levels) through the active agent and scores each run:
        parsed → evaluated → geometry sane. Run before/after changing prompts, nodes or models to see if the system actually improved.
        Uses API tokens; your current graph is restored afterwards.
      </p>

      {/* Per-model per-level summary */}
      {Object.keys(summary).length > 0 && (
        <div className="space-y-2">
          {Object.entries(summary).map(([model, levels]) => (
            <div key={model} className="bg-slate-900/60 border border-slate-750 rounded-lg p-2">
              <div className="text-[10px] font-semibold text-blue-400 mb-1 truncate">{model}</div>
              <div className="grid grid-cols-4 gap-1 text-[9px] text-slate-400">
                {[1, 2, 3, 4].map(lv => {
                  const l = levels[lv];
                  return (
                    <div key={lv} className="bg-slate-950/60 rounded p-1.5 text-center">
                      <div className="text-slate-500">L{lv}</div>
                      {l ? (
                        <>
                          <div className={`font-bold ${l.sane / l.total >= 0.7 ? 'text-green-400' : l.sane / l.total >= 0.4 ? 'text-amber-400' : 'text-red-400'}`}>
                            {Math.round((l.sane / l.total) * 100)}%
                          </div>
                          <div className="text-slate-600">{l.total} runs · {l.avgMs}ms</div>
                        </>
                      ) : <div className="text-slate-700">—</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent results — click a row to inspect and re-load its graph */}
      <div className="space-y-1.5">
        {evalResults.slice(0, 40).map((r, i) => {
          const isOpen = expanded === i;
          const badge = r.geometrySane ? 'SANE' : r.evaluatedOk ? 'EVAL' : r.parsedOk ? 'PARSE' : 'FAIL';
          return (
            <div key={i} className="bg-slate-900/60 border border-slate-800 rounded text-[10px] overflow-hidden">
              <button
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full p-2 flex items-center gap-2 text-left hover:bg-slate-800/50"
              >
                <ChevronRight size={11} className={`shrink-0 text-slate-500 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                <span className={`shrink-0 font-bold px-1.5 py-0.5 rounded text-[9px] ${
                  r.geometrySane ? 'bg-green-900/40 text-green-400' : r.evaluatedOk ? 'bg-amber-900/40 text-amber-400' : 'bg-red-900/40 text-red-400'
                }`}>
                  {badge}
                </span>
                <span className="text-slate-500 shrink-0">{r.promptId}</span>
                <span className="text-slate-300 truncate flex-1">{r.prompt}</span>
                <span className="text-slate-600 shrink-0">
                  {r.nodeCount}n · {Math.round(r.durationMs / 100) / 10}s
                  {typeof r.repairRounds === 'number' && r.repairRounds > 0 ? ` · ↻${r.repairRounds}` : ''}
                  {r.visionScore ? ` · 👁${r.visionScore}` : ''}
                </span>
              </button>

              {isOpen && (
                <div className="border-t border-slate-800 bg-slate-950/50 p-2.5 space-y-2">
                  <div className="text-slate-400 leading-relaxed">{r.prompt}</div>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[9px] text-slate-500">
                    <span>Model: <span className="text-slate-300">{r.model}</span></span>
                    <span>Provider: <span className="text-slate-300">{r.provider ?? '—'}</span></span>
                    <span>Nodes/Edges: <span className="text-slate-300">{r.nodeCount}/{r.edgeCount}</span></span>
                    <span>Repairs: <span className="text-slate-300">{r.repairRounds ?? '—'}</span></span>
                    <span>Derivation: <span className="text-slate-300">{r.derivationRatio != null ? r.derivationRatio.toFixed(2) : '—'}</span></span>
                    <span>Magic #s: <span className="text-slate-300">{r.magicNumberCount ?? '—'}</span></span>
                    <span>Proportional: <span className="text-slate-300">{r.proportionalIntegrity != null ? r.proportionalIntegrity.toFixed(2) : '—'}</span></span>
                    <span>Vision: <span className="text-slate-300">{r.visionScore ?? '—'}</span></span>
                    <span>Realization: <span className={r.realizationScore != null && r.realizationScore < 1 ? 'text-amber-400' : 'text-slate-300'}>{r.realizationScore != null ? r.realizationScore.toFixed(2) : '—'}</span></span>
                    <span>Archetype: <span className="text-slate-300">{r.genome?.archetype ?? '—'}</span></span>
                  </div>
                  {r.genome && r.genome.parts?.length > 0 && (
                    <div className="text-[9px] text-slate-500">
                      Genome parts: <span className="text-slate-400">{r.genome.parts.map(p => `${p.id}${p.count != null ? `×${p.count}` : ''}`).join(', ')}</span>
                    </div>
                  )}
                  {r.deferredDetail && r.deferredDetail.length > 0 && (
                    <div className="text-[9px] text-amber-400/90 bg-amber-950/20 border border-amber-900/40 rounded p-1.5 space-y-0.5">
                      <div className="font-semibold">Intent gap (planned detail not fully realized):</div>
                      {r.deferredDetail.map((d, k) => <div key={k}>• {d}</div>)}
                    </div>
                  )}
                  {r.error && (
                    <div className="text-[9px] text-red-400/90 bg-red-950/30 border border-red-900/40 rounded p-1.5 break-words max-h-24 overflow-auto">
                      {r.error}
                    </div>
                  )}
                  {r.graphSnapshot ? (
                    <button
                      onClick={() => loadSnapshot(r.graphSnapshot)}
                      className="text-[10px] bg-blue-700 hover:bg-blue-600 text-white px-2.5 py-1 rounded flex items-center gap-1.5 font-medium"
                    >
                      <Download size={11} /> Load this graph onto the canvas
                    </button>
                  ) : (
                    <div className="text-[9px] text-slate-600 italic">Graph snapshot not stored for this run (older than the last 30).</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        {evalResults.length === 0 && (
          <div className="text-center text-slate-500 py-6 text-xs bg-slate-900/50 rounded-lg border border-slate-800">
            No eval runs yet.
          </div>
        )}
      </div>
    </div>
  );
};
