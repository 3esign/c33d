import React, { useMemo, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Package } from 'lucide-react';
import { useStore, generateUUID } from '../store/useStore';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { MacroExposedParam } from '../nodes/NodeDefinitions';
import { ParametricNode } from './ParametricNode';
import { GroupNode } from './GroupNode';

// Register every library node type + the group container
const nodeTypes: Record<string, any> = Object.fromEntries(
  Object.keys(NODE_LIBRARY).map(t => [t, ParametricNode])
);
nodeTypes.group = GroupNode;

interface ParamCandidate {
  nodeId: string;
  param: string;
  label: string;
  def: { type: 'number'; default: any; min?: number; max?: number; step?: number };
  checked: boolean;
}

const MacroDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { nodes, edges, addMacro, addMessage } = useStore();
  const selected = nodes.filter(n => (n as any).selected && n.type !== 'group');
  const selectedIds = new Set(selected.map(n => n.id));
  const internalEdges = edges.filter(e => selectedIds.has(e.source) && selectedIds.has(e.target));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [candidates, setCandidates] = useState<ParamCandidate[]>(() => {
    const out: ParamCandidate[] = [];
    for (const n of selected) {
      const def = NODE_LIBRARY[n.type as string];
      if (!def) continue;
      for (const p of def.params) {
        if (p.type !== 'number') continue;
        out.push({
          nodeId: n.id,
          param: p.name,
          label: `${n.id}.${p.name}`,
          def: { type: 'number', default: (n.data as any)?.[p.name] ?? p.default, min: p.min, max: p.max, step: p.step },
          checked: n.type === 'NumberSlider' && p.name === 'value',
        });
      }
    }
    return out;
  });

  const outputCandidates = selected.filter(n => !internalEdges.some(e => e.source === n.id));
  const [outputNodeId, setOutputNodeId] = useState(outputCandidates[0]?.id || selected[0]?.id || '');

  const create = () => {
    if (!name.trim() || selected.length === 0 || !outputNodeId) return;
    const exposedParams: MacroExposedParam[] = candidates.filter(c => c.checked).map(c => ({
      name: c.label.replace(/[^a-zA-Z0-9_]/g, '_'),
      nodeId: c.nodeId,
      param: c.param,
      type: 'number',
      default: c.def.default,
      min: c.def.min,
      max: c.def.max,
      step: c.def.step,
    }));
    addMacro({
      id: `macro_${generateUUID().slice(0, 8)}`,
      name: name.trim(),
      description: description.trim() || name.trim(),
      createdAt: new Date().toISOString(),
      nodes: JSON.parse(JSON.stringify(selected.map(n => ({ ...n, selected: false })))),
      edges: JSON.parse(JSON.stringify(internalEdges)),
      outputNodeId,
      exposedParams,
    });
    addMessage({
      id: generateUUID(),
      role: 'system',
      content: `Macro "${name.trim()}" created with ${selected.length} nodes and ${exposedParams.length} exposed param(s). It is now available to the AI and in the Library tab.`,
    });
    onClose();
  };

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-96 max-h-[90%] overflow-y-auto space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-100">Collapse selection into a Macro</h3>
        {selected.length < 2 ? (
          <p className="text-xs text-amber-400">Select at least 2 nodes on the canvas first (drag-select or shift-click).</p>
        ) : (
          <>
            <p className="text-[10px] text-slate-400">{selected.length} nodes, {internalEdges.length} internal connections.</p>
            <input
              value={name} onChange={e => setName(e.target.value)} placeholder="Macro name (e.g. Dome)"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200"
            />
            <textarea
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Description for the AI: what it builds, when to use it"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 h-16 resize-none"
            />
            <div>
              <label className="text-[10px] text-slate-400 block mb-1">Output node (the macro's result)</label>
              <select value={outputNodeId} onChange={e => setOutputNodeId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200">
                {selected.map(n => <option key={n.id} value={n.id}>{n.id} ({n.type})</option>)}
              </select>
            </div>
            {candidates.length > 0 && (
              <div>
                <label className="text-[10px] text-slate-400 block mb-1">Exposed parameters (become the macro's sliders)</label>
                <div className="max-h-40 overflow-y-auto space-y-1 bg-slate-900/60 rounded p-2 border border-slate-700">
                  {candidates.map((c, i) => (
                    <label key={c.label} className="flex items-center gap-2 text-[10px] text-slate-300 cursor-pointer">
                      <input type="checkbox" checked={c.checked} className="accent-blue-500"
                        onChange={e => setCandidates(cs => cs.map((x, j) => j === i ? { ...x, checked: e.target.checked } : x))} />
                      {c.label} <span className="text-slate-500">= {String(c.def.default)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={onClose} className="text-xs px-3 py-1.5 rounded bg-slate-700 text-slate-300 hover:bg-slate-650">Cancel</button>
              <button onClick={create} disabled={!name.trim()}
                className="text-xs px-3 py-1.5 rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-40">Create Macro</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export const NodeGraph: React.FC = () => {
  const { nodes, edges, onNodesChange, onEdgesChange, onConnect } = useStore();
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);
  const selectedCount = useMemo(() => nodes.filter(n => (n as any).selected).length, [nodes]);

  return (
    <div className="w-full h-full bg-slate-900 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        fitView
        className="touch-none"
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="bg-slate-800 border-slate-700 fill-slate-200 text-slate-200" />
        <MiniMap
          nodeColor="#3b82f6"
          maskColor="rgba(15, 23, 42, 0.7)"
          className="bg-slate-800"
        />
        <Background variant={BackgroundVariant.Dots} gap={12} size={1} color="#334155" />
      </ReactFlow>

      {selectedCount >= 2 && (
        <button
          onClick={() => setMacroDialogOpen(true)}
          className="absolute top-3 right-3 z-40 bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5"
          title="Collapse the selected nodes into a reusable macro"
        >
          <Package size={13} />
          Collapse to Macro ({selectedCount})
        </button>
      )}

      {macroDialogOpen && <MacroDialog onClose={() => setMacroDialogOpen(false)} />}
    </div>
  );
};
