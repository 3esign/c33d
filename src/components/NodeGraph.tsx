import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
} from '@xyflow/react';
import type { ReactFlowInstance } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Package, Maximize, Layers } from 'lucide-react';
import { useStore, generateUUID } from '../store/useStore';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { MacroExposedParam } from '../nodes/NodeDefinitions';
import type { GroupIntention } from '../store/types';
import { ParametricNode } from './ParametricNode';
import { GroupNode } from './GroupNode';
import { INTENTION_CONFIG } from '../utils/groupConfig';
import { TimelinePanel } from './TimelinePanel';

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
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const addMacro = useStore(state => state.addMacro);
  const addMessage = useStore(state => state.addMessage);
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

const GroupDialog: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const nodes = useStore(state => state.nodes);
  const setNodes = useStore(state => state.setNodes);
  const evaluateGraph = useStore(state => state.evaluateGraph);
  const selected = nodes.filter(n => (n as any).selected && n.type !== 'group');
  const selectedIds = new Set(selected.map(n => n.id));

  const [name, setName] = useState('');
  const [intention, setIntention] = useState<GroupIntention>('part');

  const createGroup = () => {
    if (!name.trim() || selected.length < 2) return;
    const groupId = `group_${generateUUID().slice(0, 8)}`;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of selected) {
      const nx = n.position.x;
      const ny = n.position.y;
      const nw = (n.style?.width as number) || (n as any).width || 180;
      const nh = (n.style?.height as number) || (n as any).height || 180;
      minX = Math.min(minX, nx);
      minY = Math.min(minY, ny);
      maxX = Math.max(maxX, nx + nw);
      maxY = Math.max(maxY, ny + nh);
    }
    const pad = 30;
    const groupX = minX - pad;
    const groupY = minY - pad - 35;
    const groupW = Math.max(260, (maxX - minX) + pad * 2);
    const groupH = Math.max(180, (maxY - minY) + pad * 2 + 35);

    const groupNode = {
      id: groupId,
      type: 'group',
      position: { x: groupX, y: groupY },
      style: { width: groupW, height: groupH },
      data: {
        label: name.trim(),
        intention,
        collapsed: false,
        expandedWidth: groupW,
        expandedHeight: groupH,
      },
    };

    const updatedNodes = nodes.map(n => {
      if (selectedIds.has(n.id)) {
        return {
          ...n,
          parentId: groupId,
          position: {
            x: n.position.x - groupX,
            y: n.position.y - groupY,
          },
          selected: false,
        };
      }
      return n;
    });

    setNodes([groupNode, ...updatedNodes]);
    evaluateGraph();
    onClose();
  };

  const intentionTypes: GroupIntention[] = ['part', 'assembly', 'idea', 'skeleton', 'driver'];

  return (
    <div className="absolute inset-0 z-50 bg-slate-950/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-xl p-5 w-[22rem] space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5">
          <Layers size={16} className="text-blue-400" /> Group Selected Nodes ({selected.length})
        </h3>
        
        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1">Group Name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Petal Bloom, Chassis Assembly"
            autoFocus
            className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="text-[11px] font-medium text-slate-300 block mb-1.5">Semantic Intention</label>
          <div className="grid grid-cols-2 gap-1.5">
            {intentionTypes.map(t => {
              const cfg = INTENTION_CONFIG[t];
              const Icon = cfg.icon;
              const isSelected = intention === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setIntention(t)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                    isSelected ? 'bg-blue-600 border-blue-400 text-white' : 'bg-slate-900/60 border-slate-700 text-slate-300 hover:border-slate-500'
                  }`}
                >
                  <Icon size={12} />
                  <span>{cfg.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-700">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-lg bg-slate-700 text-slate-300 hover:bg-slate-650">Cancel</button>
          <button
            onClick={createGroup}
            disabled={!name.trim()}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-40"
          >
            Create Group
          </button>
        </div>
      </div>
    </div>
  );
};

export const NodeGraph: React.FC = () => {
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const onNodesChange = useStore(state => state.onNodesChange);
  const onEdgesChange = useStore(state => state.onEdgesChange);
  const onConnect = useStore(state => state.onConnect);
  const graphFitCount = useStore(state => state.graphFitCount);
  const [macroDialogOpen, setMacroDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const selectedCount = useMemo(() => nodes.filter(n => (n as any).selected && n.type !== 'group').length, [nodes]);

  // Zoom-to-fit for the NODE GRAPH (Jul 22): big AI-generated graphs used to be
  // impossible to see whole — React Flow's default minZoom (0.5) blocked
  // zooming out far enough. minZoom is lowered, a Fit button + "G" shortcut
  // added, and the agent bumps graphFitCount after every application so the
  // whole graph stays in view as it grows.
  const rfInstance = useRef<ReactFlowInstance | null>(null);
  const fitGraph = useCallback(() => {
    rfInstance.current?.fitView({ padding: 0.15, duration: 300 });
  }, []);

  useEffect(() => {
    if (graphFitCount > 0) {
      // Small delay lets auto-layout positions land before measuring.
      const t = setTimeout(fitGraph, 120);
      return () => clearTimeout(t);
    }
  }, [graphFitCount, fitGraph]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.hasAttribute('contenteditable')
      );
      if (isInput) return;
      if (e.key.toLowerCase() === 'g') fitGraph();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fitGraph]);

  return (
    <div className="w-full h-full bg-slate-900 relative">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onInit={(instance) => { rfInstance.current = instance; }}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.03}
        maxZoom={2.5}
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

      <button
        onClick={fitGraph}
        className="absolute top-3 left-3 z-40 bg-slate-800/90 hover:bg-slate-700 text-slate-200 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-700 shadow-lg flex items-center gap-1.5"
        title="Zoom out to fit the whole node graph (G)"
      >
        <Maximize size={13} />
        Fit Graph
      </button>

      {selectedCount >= 2 && (
        <div className="absolute top-3 right-3 z-40 flex items-center gap-2">
          <button
            onClick={() => setGroupDialogOpen(true)}
            className="bg-blue-600/90 hover:bg-blue-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5 border border-blue-500"
            title="Group the selected nodes with semantic intention"
          >
            <Layers size={13} />
            Group Selection ({selectedCount})
          </button>

          <button
            onClick={() => setMacroDialogOpen(true)}
            className="bg-amber-600/90 hover:bg-amber-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg shadow-lg flex items-center gap-1.5"
            title="Collapse the selected nodes into a reusable macro"
          >
            <Package size={13} />
            Collapse to Macro ({selectedCount})
          </button>
        </div>
      )}

      {groupDialogOpen && <GroupDialog onClose={() => setGroupDialogOpen(false)} />}
      {macroDialogOpen && <MacroDialog onClose={() => setMacroDialogOpen(false)} />}
      <TimelinePanel />
    </div>
  );
};
