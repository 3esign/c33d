import React, { useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { 
  ChevronDown, 
  ChevronUp, 
  Ungroup,
  Edit2,
  Check
} from 'lucide-react';
import { useStore } from '../store/useStore';
import type { GroupIntention } from '../store/types';
import { INTENTION_CONFIG } from '../utils/groupConfig';

export const GroupNode: React.FC<NodeProps> = ({ id, data, selected }) => {
  const nodes = useStore(state => state.nodes);
  const updateNodeData = useStore(state => state.updateNodeData);
  const setNodes = useStore(state => state.setNodes);
  const evaluateGraph = useStore(state => state.evaluateGraph);

  const rawIntention = (data as any)?.intention as GroupIntention | undefined;
  const intention: GroupIntention = (rawIntention && INTENTION_CONFIG[rawIntention]) ? rawIntention : 'part';
  const config = INTENTION_CONFIG[intention];
  const Icon = config.icon;

  const [isEditing, setIsEditing] = useState(false);
  const [labelInput, setLabelInput] = useState((data as any)?.label || 'Group');
  const isCollapsed = Boolean((data as any)?.collapsed);

  // Count member nodes whose parentId is this group id
  const memberNodes = nodes.filter(n => (n as any).parentId === id);
  const memberCount = memberNodes.length;

  const handleSaveLabel = () => {
    setIsEditing(false);
    updateNodeData(id, { label: labelInput.trim() || 'Group' });
  };

  const toggleCollapse = (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextCollapsed = !isCollapsed;
    updateNodeData(id, { collapsed: nextCollapsed });

    // Update child nodes visibility / hidden state in React Flow
    setNodes(nodes.map(n => {
      if (n.id === id) {
        return {
          ...n,
          data: { ...n.data, collapsed: nextCollapsed },
          style: nextCollapsed
            ? { ...n.style, width: 220, height: 80 }
            : { ...n.style, width: (n.data as any)?.expandedWidth || 360, height: (n.data as any)?.expandedHeight || 280 }
        };
      }
      if ((n as any).parentId === id) {
        return {
          ...n,
          hidden: nextCollapsed,
        };
      }
      return n;
    }));
  };

  const handleDissolve = (e: React.MouseEvent) => {
    e.stopPropagation();
    const groupNode = nodes.find(n => n.id === id);
    const groupPos = groupNode?.position || { x: 0, y: 0 };

    // Un-parent child nodes and convert their positions to global coordinates
    const updatedNodes = nodes
      .filter(n => n.id !== id)
      .map(n => {
        if ((n as any).parentId === id) {
          const next = { ...n };
          delete (next as any).parentId;
          next.position = {
            x: groupPos.x + n.position.x,
            y: groupPos.y + n.position.y,
          };
          return next;
        }
        return n;
      });

    setNodes(updatedNodes);
    evaluateGraph();
  };

  const changeIntention = (newIntention: GroupIntention) => {
    updateNodeData(id, { intention: newIntention });
  };

  return (
    <div
      className={`w-full h-full ${config.bgGradient} backdrop-blur-sm border-2 rounded-xl p-3 relative flex flex-col justify-between transition-all ${
        selected ? 'ring-2 ring-blue-400 border-blue-400' : config.borderColor
      } ${isCollapsed ? 'shadow-lg' : ''}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-700/50 pb-2 mb-2 select-none">
        <div className="flex items-center gap-2 min-w-0">
          {/* Intention badge */}
          <div className="relative group/badge">
            <button
              onClick={(e) => {
                e.stopPropagation();
                const types: GroupIntention[] = ['part', 'assembly', 'idea', 'skeleton', 'driver'];
                const next = types[(types.indexOf(intention) + 1) % types.length];
                changeIntention(next);
              }}
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider flex items-center gap-1 cursor-pointer transition-colors ${config.badgeBg}`}
              title={`Click to cycle intention: ${config.description}`}
            >
              <Icon size={10} />
              <span>{config.label}</span>
            </button>
          </div>

          {/* Editable Title */}
          {isEditing ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={labelInput}
                onChange={e => setLabelInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveLabel(); }}
                className="bg-slate-900 border border-blue-500 rounded px-1.5 py-0.5 text-xs text-slate-100 font-semibold focus:outline-none w-32"
                autoFocus
              />
              <button
                onClick={handleSaveLabel}
                className="p-1 hover:bg-slate-700 rounded text-emerald-400"
              >
                <Check size={12} />
              </button>
            </div>
          ) : (
            <div 
              onDoubleClick={() => setIsEditing(true)}
              className="text-xs font-semibold text-slate-200 truncate cursor-pointer hover:text-white flex items-center gap-1 group/title"
              title="Double-click to rename group"
            >
              <span>{(data as any).label || 'Group'}</span>
              <Edit2 size={10} className="text-slate-500 opacity-0 group-hover/title:opacity-100 transition-opacity" />
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] font-medium text-slate-400 mr-1">
            {memberCount} {memberCount === 1 ? 'node' : 'nodes'}
          </span>

          <button
            onClick={toggleCollapse}
            className="p-1 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded transition-colors"
            title={isCollapsed ? 'Expand group' : 'Collapse group'}
          >
            {isCollapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>

          <button
            onClick={handleDissolve}
            className="p-1 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded transition-colors"
            title="Dissolve group (ungroup all nodes)"
          >
            <Ungroup size={13} />
          </button>
        </div>
      </div>

      {/* Collapsed State Summary */}
      {isCollapsed && (
        <div className="flex-1 flex items-center justify-center text-center p-2 text-slate-400 text-xs">
          <span className="text-slate-500 italic">Collapsed ({memberCount} inner nodes)</span>
        </div>
      )}
    </div>
  );
};
