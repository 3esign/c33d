import React from 'react';
import type { NodeProps } from '@xyflow/react';

export const GroupNode: React.FC<NodeProps> = ({ data }) => {
  return (
    <div className="w-full h-full bg-slate-950/15 backdrop-blur-[2px] border-2 border-dashed border-slate-500/35 rounded-xl p-3 relative flex flex-col justify-between transition-colors hover:border-slate-500/50">
      {/* Title */}
      <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mb-2 select-none pointer-events-none">
        {(data as any).label || 'Group'}
      </div>
    </div>
  );
};
