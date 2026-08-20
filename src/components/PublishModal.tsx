import React, { useState } from 'react';
import { Globe, Download, Copy, Check, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import type { C3dProject } from '../store/types';

export const PublishModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const nodes = useStore(state => state.nodes);
  const edges = useStore(state => state.edges);
  const geometryReport = useStore(state => state.lastGeometryReport);

  const [name, setName] = useState('Parametric Model');
  const [description, setDescription] = useState('');
  const [author, setAuthor] = useState('');
  const [tagsInput, setTagsInput] = useState('cad, parametric, 3d');
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const buildProjectData = (): C3dProject => {
    const tags = tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const sliders: Record<string, number> = {};
    nodes.filter(n => n.type === 'NumberSlider').forEach(s => {
      const k = (s.data as any)?.label || s.id;
      if (typeof (s.data as any)?.value === 'number') sliders[k] = (s.data as any).value;
    });

    return {
      version: '1.0.0',
      name: name.trim() || 'Untitled CAD Model',
      description: description.trim(),
      author: author.trim() || 'Anonymous',
      tags,
      createdAt: new Date().toISOString(),
      nodes,
      edges,
      sliders,
    };
  };

  const handleDownload = () => {
    const project = buildProjectData();
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name.trim() || 'model').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.c3d.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    onClose();
  };

  const handleCopy = () => {
    const project = buildProjectData();
    navigator.clipboard.writeText(JSON.stringify(project, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-emerald-400" />
            <h3 className="text-sm font-semibold text-slate-100">Publish & Export .c3d.json</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">Model Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Flanged Hydraulic Cylinder"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-slate-300 block mb-1">Description</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the parametric relationships, intended materials, or design principles..."
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">Author</label>
              <input
                type="text"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                placeholder="Your Name or @handle"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-slate-300 block mb-1">Tags (comma-separated)</label>
              <input
                type="text"
                value={tagsInput}
                onChange={e => setTagsInput(e.target.value)}
                placeholder="gear, architectural, bloom"
                className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <div className="p-3 bg-slate-900/60 border border-slate-700/60 rounded-xl text-xs text-slate-400 space-y-1">
            <p className="font-semibold text-slate-300">Bundle Summary:</p>
            <p>• {nodes.length} Nodes ({nodes.filter(n => n.type === 'group').length} intention groups)</p>
            <p>• {edges.length} Connections</p>
            <p>• {geometryReport?.leaves?.length || 0} Evaluated solids / meshes</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-700">
          <button
            onClick={handleCopy}
            className="px-3.5 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-700 text-xs font-medium flex items-center gap-1.5"
          >
            {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            {copied ? 'Copied JSON!' : 'Copy JSON'}
          </button>
          <button
            onClick={handleDownload}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5"
          >
            <Download size={13} />
            Download .c3d.json
          </button>
        </div>
      </div>
    </div>
  );
};