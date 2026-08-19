import React, { useMemo, useState } from 'react';
import { Star, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, generateUUID } from '../store/useStore';
import { captureViewportSnapshot } from '../utils/snapshot';
import { tryEmbed } from '../ai/api';
import { exampleSearchText } from '../ai/retrieval';
import { calculateParametricCoverage } from '../ai/graphValidation';
import type { SuccessExample } from '../nodes/NodeDefinitions';

// Outer shell: subscribes ONLY to the open flag. All heavy work (deep graph
// clones, coverage analysis, snapshot capture) lives in the inner component,
// which is mounted only while the modal is open — nothing runs while closed.
export const SaveExampleModal: React.FC = () => {
  const saveModalOpen = useStore(state => state.saveModalOpen);
  if (!saveModalOpen) return null;
  return <SaveExampleModalInner />;
};

const SaveExampleModalInner: React.FC = () => {
  const saveModalCandidate = useStore(state => state.saveModalCandidate);
  const episodePrompts = useStore(state => state.episodePrompts);
  const episodePlan = useStore(state => state.episodePlan);
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const lastAIGraph = useStore(state => state.lastAIGraph);
  const agentSlots = useStore(state => state.agentSlots);
  const activeAgentId = useStore(state => state.activeAgentId);
  const { closeSaveModal, addSuccessExample, addMessage, setNudgeCandidate } = useStore(
    useShallow(state => ({
      closeSaveModal: state.closeSaveModal,
      addSuccessExample: state.addSuccessExample,
      addMessage: state.addMessage,
      setNudgeCandidate: state.setNudgeCandidate,
    }))
  );

  const [comment, setComment] = useState('');
  const [tags, setTags] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const candidate = saveModalCandidate;
  const prompts = candidate ? candidate.prompts : episodePrompts;
  const plan = candidate ? candidate.plan : episodePlan;
  const graphFinal = useMemo(() => {
    return candidate
      ? candidate.graphFinal
      : { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
  }, [candidate, nodes, edges]);
  const graphOriginal = useMemo(() => {
    return candidate ? candidate.graphOriginal : (lastAIGraph ? JSON.parse(JSON.stringify(lastAIGraph)) : null);
  }, [candidate, lastAIGraph]);

  const { coverage, total } = useMemo(() => {
    return calculateParametricCoverage(graphFinal.nodes, graphFinal.edges);
  }, [graphFinal]);

  const coverageBlocked = total > 0 && coverage < 0.40;

  // Captured once, when the modal opens (= when this component mounts).
  // For a nudge candidate the old design is already replaced on screen; the
  // snapshot may show the new design. Still capture — better than nothing —
  // but prefer live saves (button) for accurate thumbnails.
  const [thumbnail] = useState(() => captureViewportSnapshot(256) || '');

  const modelName = (() => {
    if (candidate) return candidate.model;
    const a = agentSlots.find(s => s.id === activeAgentId);
    return a ? `${a.name} (${a.model})` : 'Unknown';
  })();

  const save = async () => {
    if (coverageBlocked || isSaving) return;
    setIsSaving(true);
    try {
      const example: SuccessExample = {
        id: generateUUID(),
        createdAt: new Date().toISOString(),
        prompts: prompts.length > 0 ? prompts : ['(manually built)'],
        plan: plan || '',
        comment: comment.trim(),
        graphOriginal,
        graphFinal,
        thumbnail,
        model: modelName,
        tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      };
      // Best-effort embedding for retrieval (provider-dependent; lexical fallback exists)
      const emb = await tryEmbed(exampleSearchText(example));
      if (emb) example.embedding = emb;

      addSuccessExample(example);
      addMessage({
        id: generateUUID(),
        role: 'system',
        content: `Saved as successful example (${example.graphFinal.nodes.length} nodes). It is now part of the AI's verified knowledge and will be retrieved for similar future requests.`,
      });
      setComment('');
      setTags('');
      setNudgeCandidate(null);
      closeSaveModal();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950/70 flex items-center justify-center p-4" onClick={closeSaveModal}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-[420px] max-h-[90vh] overflow-y-auto space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
            <Star size={15} className="text-emerald-400" />
            Save as successful example
          </h3>
          <button onClick={closeSaveModal} className="text-slate-400 hover:text-slate-200"><X size={16} /></button>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          This is the verification gate: only designs you save here become long-term AI knowledge.
          The final graph (with your manual edits), the original AI graph, all prompts, and your comment are stored.
        </p>

        {thumbnail && (
          <img src={thumbnail} alt="snapshot" className="w-full rounded border border-slate-700" />
        )}

        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Prompts in this episode ({prompts.length})</label>
          <div className="bg-slate-900/60 rounded p-2 border border-slate-700 max-h-24 overflow-y-auto space-y-1">
            {prompts.length === 0
              ? <div className="text-[10px] text-slate-500">None recorded (manually built graph).</div>
              : prompts.map((p, i) => <div key={i} className="text-[10px] text-slate-300 truncate">• {p}</div>)}
          </div>
        </div>

        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Your comment (what makes this good? what did you fix?)</label>
          <textarea
            value={comment} onChange={e => setComment(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 h-16 resize-none"
            placeholder='e.g. "Great proportions; I widened the base by 20% manually."'
          />
        </div>

        <div>
          <label className="text-[10px] text-slate-400 block mb-1">Tags (comma-separated)</label>
          <input
            value={tags} onChange={e => setTags(e.target.value)}
            className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
            placeholder="furniture, chair, organic"
          />
        </div>

        {coverageBlocked && (
          <div className="bg-red-950/40 border border-red-800 text-red-350 rounded p-2.5 text-[10px] leading-relaxed">
            <strong>Saving Blocked:</strong> Low parametric coverage ({Math.round(coverage * 100)}%). At least 40% of the dimensions must be driven by sliders/formulas to ensure parametric scalability. Fix the literals in your graph first.
          </div>
        )}

        <div className="text-[10px] text-slate-500">
          Graph: {graphFinal.nodes.length} nodes / {graphFinal.edges.length} edges
          {graphOriginal ? ` · AI original kept (${graphOriginal.nodes.length} nodes)` : ' · no AI original recorded'}
          {' · '}model: {modelName}
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={closeSaveModal} className="text-xs px-3 py-1.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-650">Cancel</button>
          <button
            onClick={save}
            disabled={coverageBlocked || isSaving}
            className={`text-xs px-3 py-1.5 rounded flex items-center gap-1.5 font-medium transition-colors ${
              coverageBlocked || isSaving
                ? 'bg-slate-700 text-slate-500 cursor-not-allowed border border-slate-650'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            <Star size={12} /> {isSaving ? 'Saving…' : 'Save to library'}
          </button>
        </div>
      </div>
    </div>
  );
};
