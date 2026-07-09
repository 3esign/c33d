import React from 'react';
import { useStore } from '../store/useStore';
import { Layers, Eye, EyeOff } from 'lucide-react';

export const Outliner: React.FC = () => {
  const { sceneObjects, toggleObjectVisibility } = useStore();

  return (
    <div className="absolute top-4 right-4 w-64 bg-slate-800/90 backdrop-blur-md border border-slate-700 rounded-lg shadow-xl overflow-hidden pointer-events-auto">
      <div className="flex items-center gap-2 p-3 border-b border-slate-700 bg-slate-800">
        <Layers size={18} className="text-slate-400" />
        <h3 className="text-sm font-semibold text-slate-200">Scene Layers</h3>
      </div>
      
      <div className="max-h-64 overflow-y-auto p-2 space-y-1">
        {sceneObjects.length === 0 ? (
          <div className="p-3 text-xs text-center text-slate-500">
            No objects in scene
          </div>
        ) : (
          sceneObjects.map((obj) => (
            <div 
              key={obj.id} 
              className="flex items-center justify-between p-2 hover:bg-slate-700 rounded text-sm transition-colors group"
            >
              <span className="text-slate-300 truncate pr-2" title={obj.name}>
                {obj.name}
              </span>
              <button 
                onClick={() => toggleObjectVisibility(obj.id)}
                className="text-slate-500 hover:text-slate-300 transition-colors"
              >
                {obj.visible ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
