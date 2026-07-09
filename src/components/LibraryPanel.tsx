import React from 'react';
import { Star, Trash2, Upload, Package } from 'lucide-react';
import { useStore, generateUUID } from '../store/useStore';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { MacroExposedParam, SuccessExample } from '../nodes/NodeDefinitions';
import { autoLayout } from '../layout/autoLayout';

export const LibraryPanel: React.FC = () => {
  const {
    successExamples, removeSuccessExample,
    macros, addMacro, removeMacro,
    setNodes, setEdges, addMessage, zoomToFit,
  } = useStore();

  const loadExample = (ex: SuccessExample) => {
    const laidOut = autoLayout(JSON.parse(JSON.stringify(ex.graphFinal.nodes)), ex.graphFinal.edges);
    setNodes(laidOut as any[]);
    setEdges(JSON.parse(JSON.stringify(ex.graphFinal.edges)));
    zoomToFit();
    addMessage({ id: generateUUID(), role: 'system', content: `Loaded example "${ex.comment || ex.prompts[0] || ex.id}" onto the canvas.` });
  };

  const convertToMacro = (ex: SuccessExample) => {
    const nodes = ex.graphFinal.nodes.filter((n: any) => n.type !== 'group');
    const edges = ex.graphFinal.edges.filter((e: any) =>
      nodes.some((n: any) => n.id === e.source) && nodes.some((n: any) => n.id === e.target));
    const leaf = nodes.find((n: any) =>
      !edges.some((e: any) => e.source === n.id) &&
      NODE_LIBRARY[n.type]?.outputs.some(o => o.type === 'Solid'));
    if (!leaf) {
      addMessage({ id: generateUUID(), role: 'system', content: 'Cannot convert: no geometry leaf node found in this example.' });
      return;
    }
    // Auto-expose NumberSlider values as the macro's public parameters
    const exposedParams: MacroExposedParam[] = nodes
      .filter((n: any) => n.type === 'NumberSlider')
      .map((n: any) => ({
        name: String(n.data?.label || n.id).replace(/[^a-zA-Z0-9_]/g, '_'),
        nodeId: n.id,
        param: 'value',
        type: 'number' as const,
        default: n.data?.value ?? 10,
        min: n.data?.min,
        max: n.data?.max,
        step: n.data?.step,
      }));
    const name = (ex.comment || ex.prompts[0] || 'Component').slice(0, 40);
    addMacro({
      id: `macro_${generateUUID().slice(0, 8)}`,
      name,
      description: `From verified example: ${ex.prompts.slice(0, 2).join(' | ').slice(0, 200)}`,
      createdAt: new Date().toISOString(),
      nodes: JSON.parse(JSON.stringify(nodes)),
      edges: JSON.parse(JSON.stringify(edges)),
      outputNodeId: leaf.id,
      exposedParams,
    });
    addMessage({ id: generateUUID(), role: 'system', content: `Macro "${name}" created from example (${exposedParams.length} exposed param(s): NumberSliders become macro sliders). The AI can now place it as a single node.` });
  };

  const placeMacro = (macroId: string) => {
    const macro = macros.find(m => m.id === macroId);
    if (!macro) return;
    const { nodes, edges } = useStore.getState();
    const newNode = {
      id: `macro_inst_${generateUUID().slice(0, 6)}`,
      type: 'Macro',
      position: { x: 40, y: 40 },
      data: Object.fromEntries([['macroId', macro.id], ...macro.exposedParams.map(p => [p.name, p.default])]),
    };
    const laidOut = autoLayout([...JSON.parse(JSON.stringify(nodes)), newNode], edges as any[]);
    setNodes(laidOut as any[]);
  };

  return (
    <div className="space-y-5">
      {/* Success examples */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 mb-1">
          <Star size={13} className="text-emerald-400" /> Verified Examples ({successExamples.length})
        </h3>
        <p className="text-[10px] text-slate-400 mb-2">
          The only long-term knowledge store. Saved designs are retrieved as few-shot exemplars for similar future requests, by every model.
        </p>
        {successExamples.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-xs bg-slate-900/50 rounded-lg border border-slate-800">
            Nothing saved yet. Build something good, then press “★ Save as Successful” in the viewport.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {successExamples.map(ex => (
              <div key={ex.id} className="bg-slate-900 border border-slate-700 rounded-lg overflow-hidden flex flex-col">
                {ex.thumbnail
                  ? <img src={ex.thumbnail} alt="" className="w-full h-20 object-cover" />
                  : <div className="w-full h-20 bg-slate-800 flex items-center justify-center text-slate-600 text-[10px]">no snapshot</div>}
                <div className="p-2 space-y-1 flex-1 flex flex-col">
                  <div className="text-[10px] text-slate-200 font-medium line-clamp-2">{ex.comment || ex.prompts[0] || '(no comment)'}</div>
                  <div className="text-[9px] text-slate-500">{ex.graphFinal.nodes.length} nodes · {new Date(ex.createdAt).toLocaleDateString()}</div>
                  {ex.tags.length > 0 && <div className="text-[9px] text-blue-400 truncate">{ex.tags.join(', ')}</div>}
                  <div className="flex gap-1 pt-1 mt-auto">
                    <button onClick={() => loadExample(ex)} title="Load graph onto canvas"
                      className="flex-1 text-[9px] bg-slate-700 hover:bg-slate-650 text-slate-200 px-1 py-1 rounded flex items-center justify-center gap-1"><Upload size={10} />Load</button>
                    <button onClick={() => convertToMacro(ex)} title="Convert into a reusable macro node"
                      className="flex-1 text-[9px] bg-amber-800/60 hover:bg-amber-700 text-amber-200 px-1 py-1 rounded flex items-center justify-center gap-1"><Package size={10} />Macro</button>
                    <button onClick={() => removeSuccessExample(ex.id)} title="Delete"
                      className="text-[9px] bg-red-950/40 hover:bg-red-900/50 text-red-400 px-1.5 py-1 rounded"><Trash2 size={10} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Macros */}
      <div>
        <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 mb-1">
          <Package size={13} className="text-amber-400" /> Macro Library ({macros.length})
        </h3>
        <p className="text-[10px] text-slate-400 mb-2">
          Reusable parameterized components. The AI sees these and can place them as single nodes — this is how vocabulary compounds.
        </p>
        {macros.length === 0 ? (
          <div className="text-center text-slate-500 py-6 text-xs bg-slate-900/50 rounded-lg border border-slate-800">
            No macros yet. Select nodes on the canvas → “Collapse to Macro”, or convert a saved example.
          </div>
        ) : (
          <div className="space-y-2">
            {macros.map(m => (
              <div key={m.id} className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-amber-200">★ {m.name}</span>
                  <div className="flex gap-1">
                    <button onClick={() => placeMacro(m.id)} title="Place an instance on the canvas"
                      className="text-[9px] bg-slate-700 hover:bg-slate-650 text-slate-200 px-2 py-0.5 rounded">Place</button>
                    <button onClick={() => removeMacro(m.id)} title="Delete macro"
                      className="text-[9px] bg-red-950/40 hover:bg-red-900/50 text-red-400 px-1.5 py-0.5 rounded"><Trash2 size={10} /></button>
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-1 line-clamp-2">{m.description}</div>
                <div className="text-[9px] text-slate-500 mt-1">
                  {m.nodes.length} inner nodes · params: {m.exposedParams.map(p => p.name).join(', ') || 'none'} · id: {m.id}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
