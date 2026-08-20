import React, { useState } from 'react';
import { Upload, Link, FileText, AlertCircle, X } from 'lucide-react';
import { useStore, generateUUID } from '../store/useStore';

export const ImportDialog: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const setNodes = useStore(state => state.setNodes);
  const setEdges = useStore(state => state.setEdges);
  const evaluateGraph = useStore(state => state.evaluateGraph);
  const addMessage = useStore(state => state.addMessage);

  const [activeTab, setActiveTab] = useState<'file' | 'url' | 'paste'>('file');
  const [urlInput, setUrlInput] = useState('');
  const [pasteInput, setPasteInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const loadParsedData = (data: any, sourceName: string) => {
    try {
      const nodes = Array.isArray(data.nodes) ? data.nodes : (data.graph?.nodes || []);
      const edges = Array.isArray(data.edges) ? data.edges : (data.graph?.edges || []);

      if (nodes.length === 0) {
        throw new Error('Project contains no valid nodes.');
      }

      setNodes(nodes);
      setEdges(edges);
      evaluateGraph();

      addMessage({
        id: generateUUID(),
        role: 'system',
        content: `Successfully imported "${data.name || sourceName}" with ${nodes.length} nodes and ${edges.length} edges.`,
      });

      onClose();
    } catch (err: any) {
      setError(`Failed to load project: ${err.message}`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        loadParsedData(parsed, file.name);
      } catch (err: any) {
        setError(`Invalid JSON file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  };

  const handleUrlImport = async () => {
    if (!urlInput.trim()) return;
    setError(null);
    setLoading(true);

    try {
      let targetUrl = urlInput.trim();
      if (targetUrl.includes('github.com') && targetUrl.includes('/blob/')) {
        targetUrl = targetUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
      }

      const res = await fetch(targetUrl);
      if (!res.ok) throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
      const data = await res.json();
      loadParsedData(data, targetUrl);
    } catch (err: any) {
      setError(`Failed to fetch from URL: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const handlePasteImport = () => {
    if (!pasteInput.trim()) return;
    setError(null);
    try {
      const parsed = JSON.parse(pasteInput.trim());
      loadParsedData(parsed, 'Pasted Project');
    } catch (err: any) {
      setError(`Invalid JSON text: ${err.message}`);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-lg shadow-2xl space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 pb-3">
          <div className="flex items-center gap-2">
            <Upload size={18} className="text-blue-400" />
            <h3 className="text-sm font-semibold text-slate-100">Import .c3d.json Project</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Tab Selector */}
        <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-700/60">
          <button
            onClick={() => { setActiveTab('file'); setError(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'file' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Upload size={13} /> File Upload
          </button>
          <button
            onClick={() => { setActiveTab('url'); setError(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'url' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Link size={13} /> From URL
          </button>
          <button
            onClick={() => { setActiveTab('paste'); setError(null); }}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg flex items-center justify-center gap-1.5 transition-colors ${
              activeTab === 'paste' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText size={13} /> Paste JSON
          </button>
        </div>

        {error && (
          <div className="p-3 bg-rose-950/40 border border-rose-800/80 rounded-xl text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle size={15} className="flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'file' && (
          <div className="border-2 border-dashed border-slate-700 hover:border-blue-500 rounded-xl p-8 text-center transition-colors">
            <Upload size={32} className="mx-auto text-slate-500 mb-2" />
            <p className="text-xs font-medium text-slate-300 mb-1">Click to select or drag a file here</p>
            <p className="text-[10px] text-slate-500 mb-4">Supports .c3d.json and exported JSON graph files</p>
            <input
              type="file"
              accept=".json,.c3d.json"
              onChange={handleFileUpload}
              className="hidden"
              id="c3d-file-input"
            />
            <label
              htmlFor="c3d-file-input"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg cursor-pointer transition-colors"
            >
              Browse File
            </label>
          </div>
        )}

        {activeTab === 'url' && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-300 block">Project URL (Raw JSON or GitHub link)</label>
            <input
              type="url"
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="https://raw.githubusercontent.com/.../model.c3d.json"
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
            />
            <div className="flex justify-end pt-2">
              <button
                onClick={handleUrlImport}
                disabled={loading || !urlInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg disabled:opacity-40 flex items-center gap-1.5"
              >
                {loading ? 'Fetching...' : 'Import from URL'}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'paste' && (
          <div className="space-y-3">
            <label className="text-xs font-medium text-slate-300 block">Paste Raw Project JSON</label>
            <textarea
              value={pasteInput}
              onChange={e => setPasteInput(e.target.value)}
              placeholder='{ "nodes": [...], "edges": [...] }'
              rows={8}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 font-mono focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex justify-end pt-2">
              <button
                onClick={handlePasteImport}
                disabled={!pasteInput.trim()}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg disabled:opacity-40"
              >
                Load Pasted Graph
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};