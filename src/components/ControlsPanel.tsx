import React, { useState } from 'react';
import { Sliders, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../store/useStore';
import { INTENTION_CONFIG } from '../utils/groupConfig';
import type { GroupIntention } from '../store/types';

export const ControlsPanel: React.FC = () => {
  const nodes = useStore(state => state.nodes);
  const updateNodeData = useStore(state => state.updateNodeData);
  const isEvaluating = useStore(state => state.isEvaluating);
  const [isOpen, setIsOpen] = useState(true);

  // Discover all NumberSlider nodes in the graph
  const sliderNodes = nodes.filter(n => n.type === 'NumberSlider');
  if (sliderNodes.length === 0) return null;

  // Group sliders by parent group or top-level category
  const groupsById = new Map<string, any>();
  nodes.filter(n => n.type === 'group').forEach(g => groupsById.set(g.id, g));

  const categorizedSliders = sliderNodes.map(slider => {
    const parentId = (slider as any).parentId;
    const parentGroup = parentId ? groupsById.get(parentId) : null;
    const groupName = parentGroup?.data?.label || 'Global Parameters';
    const intention: GroupIntention = parentGroup?.data?.intention || 'driver';
    return {
      slider,
      groupName,
      intention,
    };
  });

  const handleSliderChange = (nodeId: string, value: number) => {
    updateNodeData(nodeId, { value });
  };

  return (
    <div className="absolute top-4 right-4 z-40 w-72 bg-slate-900/90 backdrop-blur-md border border-slate-700/80 rounded-xl shadow-2xl overflow-hidden transition-all pointer-events-auto">
      {/* Header */}
      <div 
        onClick={() => setIsOpen(!isOpen)}
        className="px-3.5 py-2.5 bg-slate-800/80 hover:bg-slate-800 border-b border-slate-700/60 flex items-center justify-between cursor-pointer select-none"
      >
        <div className="flex items-center gap-2">
          <Sliders size={14} className="text-rose-400" />
          <span className="text-xs font-semibold text-slate-100 tracking-wide">Controls</span>
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
            {sliderNodes.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          {isEvaluating && (
            <span className="inline-block w-2 h-2 rounded-full bg-blue-400 animate-pulse mr-1" title="Evaluating..." />
          )}
          <button className="text-slate-400 hover:text-slate-200 p-0.5">
            {isOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
        </div>
      </div>

      {/* Sliders Body */}
      {isOpen && (
        <div className="p-3 max-h-80 overflow-y-auto space-y-3">
          {categorizedSliders.map(({ slider, groupName, intention }) => {
            const data = (slider.data || {}) as Record<string, any>;
            const label: string = typeof data.label === 'string' ? data.label : slider.id;
            const val = typeof data.value === 'number' ? data.value : 10;
            const min = typeof data.min === 'number' ? data.min : (typeof data.value__min === 'number' ? data.value__min : 0);
            const max = typeof data.max === 'number' ? data.max : (typeof data.value__max === 'number' ? data.value__max : Math.max(100, val * 2));
            const step = typeof data.step === 'number' ? data.step : (typeof data.value__step === 'number' ? data.value__step : 1);
            const intentionCfg = INTENTION_CONFIG[intention] || INTENTION_CONFIG.driver;

            return (
              <div key={slider.id} className="bg-slate-950/40 border border-slate-800 rounded-lg p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="font-semibold text-slate-200 truncate" title={label}>{label}</span>
                    <span className={`text-[8px] px-1 py-0.2 rounded border font-mono ${intentionCfg.badgeBg}`}>
                      {groupName}
                    </span>
                  </div>
                  <span className="font-mono text-[11px] font-bold text-rose-300 ml-2">
                    {Math.round(val * 100) / 100}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) => handleSliderChange(slider.id, parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-rose-500 hover:accent-rose-400 transition-all"
                  />
                </div>

                <div className="flex justify-between text-[9px] text-slate-500 font-mono">
                  <span>{min}</span>
                  <span>{max}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};