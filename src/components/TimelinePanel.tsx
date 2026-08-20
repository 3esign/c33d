import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import {
  History,
  Play,
  SkipBack,
  SkipForward,
  GitBranch,
  Brain,
  Layers,
  ChevronUp,
  ChevronDown,
  Sparkles,
  AlertCircle
} from 'lucide-react';

export const TimelinePanel: React.FC = () => {
  const timeline = useStore(state => state.graphTimeline);
  const restoreGraphSnapshot = useStore(state => state.restoreGraphSnapshot);
  const forkGraphBranch = useStore(state => state.forkGraphBranch);
  const activeBranchId = useStore(state => state.activeBranchId || 'main');

  const [isOpen, setIsOpen] = useState(false);
  const [activeMode, setActiveMode] = useState<'replay' | 'reasoning' | 'branches'>('replay');
  const [selectedIndex, setSelectedIndex] = useState<number>(() => Math.max(0, timeline.length - 1));
  const [newBranchName, setNewBranchName] = useState('');

  // Keep selected index in sync when new entries arrive
  const effectiveIndex = Math.min(Math.max(0, selectedIndex), Math.max(0, timeline.length - 1));
  const currentEntry = timeline[effectiveIndex];

  const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const idx = parseInt(e.target.value, 10);
    setSelectedIndex(idx);
    restoreGraphSnapshot(idx);
  };

  const handleStepBack = () => {
    if (effectiveIndex > 0) {
      const nextIdx = effectiveIndex - 1;
      setSelectedIndex(nextIdx);
      restoreGraphSnapshot(nextIdx);
    }
  };

  const handleStepForward = () => {
    if (effectiveIndex < timeline.length - 1) {
      const nextIdx = effectiveIndex + 1;
      setSelectedIndex(nextIdx);
      restoreGraphSnapshot(nextIdx);
    }
  };

  const handleFork = () => {
    const name = newBranchName.trim() || `branch-${Date.now().toString(36)}`;
    forkGraphBranch(effectiveIndex, name);
    setNewBranchName('');
  };

  if (timeline.length === 0) {
    return null;
  }

  return (
    <div className="absolute bottom-2 left-2 right-2 z-30 transition-all">
      {/* Collapsed Header / Toggle Pill */}
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-slate-900/90 hover:bg-slate-800 text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-slate-700/80 shadow-xl backdrop-blur flex items-center gap-2 text-xs cursor-pointer font-medium"
        >
          <History size={14} className="text-blue-400" />
          <span>Timeline ({timeline.length} turns)</span>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700">
            {currentEntry?.label || 'Turn ' + (effectiveIndex + 1)}
          </span>
          <ChevronUp size={13} className="text-slate-400" />
        </button>
      ) : (
        <div className="bg-slate-900/95 border border-slate-700/90 rounded-xl shadow-2xl backdrop-blur overflow-hidden flex flex-col max-h-80">
          {/* Header Bar */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950/60">
            <div className="flex items-center gap-2">
              <History size={14} className="text-blue-400" />
              <span className="text-xs font-semibold text-slate-200">Graph Timeline</span>
              <span className="text-[10px] text-slate-500 font-mono">
                [{effectiveIndex + 1}/{timeline.length}]
              </span>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800">
              <button
                onClick={() => setActiveMode('replay')}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeMode === 'replay'
                    ? 'bg-blue-600/30 text-blue-300 font-medium border border-blue-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Play size={11} />
                Replay
              </button>
              <button
                onClick={() => setActiveMode('reasoning')}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeMode === 'reasoning'
                    ? 'bg-purple-600/30 text-purple-300 font-medium border border-purple-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Brain size={11} />
                Reasoning
              </button>
              <button
                onClick={() => setActiveMode('branches')}
                className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer transition-colors ${
                  activeMode === 'branches'
                    ? 'bg-emerald-600/30 text-emerald-300 font-medium border border-emerald-500/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <GitBranch size={11} />
                Branches ({activeBranchId})
              </button>
            </div>

            <button
              onClick={() => setIsOpen(false)}
              className="text-slate-400 hover:text-slate-200 p-1 rounded hover:bg-slate-800 cursor-pointer"
            >
              <ChevronDown size={14} />
            </button>
          </div>

          {/* Mode 1: Replay Mode */}
          {activeMode === 'replay' && (
            <div className="p-3 space-y-2 bg-slate-900/60">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleStepBack}
                  disabled={effectiveIndex <= 0}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer border border-slate-700"
                  title="Step Back"
                >
                  <SkipBack size={13} />
                </button>

                <input
                  type="range"
                  min={0}
                  max={Math.max(0, timeline.length - 1)}
                  value={effectiveIndex}
                  onChange={handleScrub}
                  className="flex-1 accent-blue-500 cursor-pointer h-1.5 bg-slate-700 rounded-lg"
                />

                <button
                  onClick={handleStepForward}
                  disabled={effectiveIndex >= timeline.length - 1}
                  className="p-1 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-slate-300 cursor-pointer border border-slate-700"
                  title="Step Forward"
                >
                  <SkipForward size={13} />
                </button>
              </div>

              {currentEntry && (
                <div className="flex items-center justify-between text-[11px] text-slate-400 bg-slate-950/40 px-2.5 py-1.5 rounded border border-slate-800/80">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-300">{currentEntry.label || currentEntry.trigger}</span>
                    <span className="text-[10px] text-slate-500 font-mono">
                      {new Date(currentEntry.at).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-blue-400">{currentEntry.nodeCount} nodes</span>
                    <span className="text-slate-600">•</span>
                    <span className="text-indigo-400">{currentEntry.edgeCount} edges</span>
                    {currentEntry.diff?.addedNodes?.length > 0 && (
                      <span className="text-emerald-400">+{currentEntry.diff.addedNodes.length} nodes</span>
                    )}
                    {currentEntry.diff?.removedNodes?.length > 0 && (
                      <span className="text-rose-400">-{currentEntry.diff.removedNodes.length} nodes</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Reasoning Mode */}
          {activeMode === 'reasoning' && (
            <div className="p-3 space-y-2 overflow-y-auto max-h-56 text-xs bg-slate-900/60">
              {currentEntry?.prompt && (
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <div className="text-[10px] text-slate-500 font-semibold uppercase mb-0.5 flex items-center gap-1">
                    <Sparkles size={11} className="text-blue-400" />
                    Prompt
                  </div>
                  <div className="text-slate-200 text-[11px]">{currentEntry.prompt}</div>
                </div>
              )}

              {currentEntry?.reasoning ? (
                <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
                  <div className="text-[10px] text-purple-400 font-semibold uppercase mb-0.5 flex items-center gap-1">
                    <Brain size={11} />
                    Chain of Thought
                  </div>
                  <div className="text-slate-300 text-[11px] whitespace-pre-wrap leading-relaxed">
                    {currentEntry.reasoning}
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-slate-500 italic p-2">
                  No explicit chain-of-thought logged for this snapshot ({currentEntry?.label || currentEntry?.trigger}).
                </div>
              )}

              {currentEntry?.details && currentEntry.details.length > 0 && (
                <div className="bg-amber-950/20 border border-amber-800/40 p-2 rounded">
                  <div className="text-[10px] text-amber-400 font-semibold mb-1 flex items-center gap-1">
                    <AlertCircle size={11} />
                    Applied Details & Warnings
                  </div>
                  <ul className="list-disc list-inside text-[10.5px] text-amber-200/80 space-y-0.5">
                    {currentEntry.details.map((d, i) => (
                      <li key={i}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Mode 3: Branches Mode */}
          {activeMode === 'branches' && (
            <div className="p-3 space-y-3 overflow-y-auto max-h-56 bg-slate-900/60">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  placeholder="New branch name..."
                  value={newBranchName}
                  onChange={e => setNewBranchName(e.target.value)}
                  className="flex-1 bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 font-mono"
                />
                <button
                  onClick={handleFork}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs px-3 py-1 rounded font-medium flex items-center gap-1 cursor-pointer transition-colors shadow"
                >
                  <GitBranch size={12} />
                  Fork from Step {effectiveIndex + 1}
                </button>
              </div>

              <div className="space-y-1">
                <div className="text-[10px] text-slate-500 font-semibold uppercase">Timeline Snapshots & Checkpoints</div>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {timeline.map((entry, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setSelectedIndex(idx);
                        restoreGraphSnapshot(idx);
                      }}
                      className={`flex items-center justify-between p-1.5 rounded text-[11px] cursor-pointer transition-colors ${
                        idx === effectiveIndex
                          ? 'bg-blue-600/30 border border-blue-500 text-white font-medium'
                          : 'bg-slate-950/40 border border-slate-800/80 text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        <Layers size={11} className={idx === effectiveIndex ? 'text-blue-400' : 'text-slate-500'} />
                        <span>#{idx + 1}: {entry.label || entry.trigger}</span>
                      </div>
                      <span className="text-[10px] font-mono text-slate-500">
                        {entry.nodeCount}N / {entry.edgeCount}E
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
