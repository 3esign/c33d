import React, { useState, useEffect } from 'react';
import { useStore, generateUUID } from '../store/useStore';
import { Settings, Send, MessageSquare, BarChart2, BookOpen, Star, FlaskConical, Library, X, Brain } from 'lucide-react';
import { processUserIntent } from '../ai/agent';
import { LibraryPanel } from './LibraryPanel';
import { EvalPanel } from './EvalPanel';

export const ChatPanel: React.FC = () => {
  const {
    messages = [],
    addMessage,
    agentSlots = [],
    activeAgentId = null,
    addAgentSlot,
    removeAgentSlot,
    updateAgentSlot,
    setActiveAgentId,
    restoreDefaultAgents,
    clearGraph,
    clearMessages,
    performanceLogs = [],
    agentGuidelines,
    setAgentGuidelines,
    nudgeCandidate,
    setNudgeCandidate,
    openSaveModal,
    episodePlan,
    episodeRatios,
    episodeDrivers,
  } = useStore();

  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<'chat' | 'reasoning' | 'logs' | 'guidelines' | 'library' | 'evals'>('chat');
  const [isLoading, setIsLoading] = useState(false);

  const [ollamaModels, setOllamaModels] = useState<Record<string, string[]>>({});
  const [loadingOllama, setLoadingOllama] = useState<Record<string, boolean>>({});
  const [editManual, setEditManual] = useState<Record<string, boolean>>({});

  const fetchModelsForSlot = async (slotId: string, rawUrl: string) => {
    const url = (rawUrl || 'http://localhost:11434').trim().replace(/\/$/, '');
    if (!url) return;
    
    setLoadingOllama(prev => ({ ...prev, [slotId]: true }));
    try {
      const response = await fetch(`${url}/api/tags`);
      if (!response.ok) throw new Error('Failed to fetch tags');
      const data = await response.json();
      const names = Array.isArray(data.models) ? data.models.map((m: any) => m.name) : [];
      setOllamaModels(prev => ({ ...prev, [slotId]: names }));
    } catch (err) {
      console.error('Error fetching Ollama models for slot:', slotId, err);
      setOllamaModels(prev => ({ ...prev, [slotId]: [] }));
    } finally {
      setLoadingOllama(prev => ({ ...prev, [slotId]: false }));
    }
  };

  useEffect(() => {
    if (!showSettings) return;
    
    agentSlots.forEach(slot => {
      if (slot.provider === 'ollama') {
        const currentUrl = slot.apiKey || 'http://localhost:11434';
        if (ollamaModels[slot.id] === undefined && !loadingOllama[slot.id]) {
          fetchModelsForSlot(slot.id, currentUrl);
        }
      }
    });
  }, [showSettings, agentSlots, ollamaModels, loadingOllama]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    setIsLoading(true);
    try {
      addMessage({
        id: generateUUID(),
        role: 'user',
        content: input,
      });
      
      const userText = input;
      setInput('');
      
      await processUserIntent(userText);
    } catch (err: any) {
      console.error("Agent execution failed:", err);
      addMessage({
        id: generateUUID(),
        role: 'system',
        content: `Error running agent: ${err.message || err}`
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-slate-800 border-r border-slate-700">
      {/* Header */}
      <div className="flex justify-between items-center p-4 border-b border-slate-700">
        <div>
          <h2 className="text-lg font-bold text-slate-100 tracking-wide">C33D</h2>
          <p className="text-[10px] text-slate-500 leading-tight">by <a href="mailto:poturaksemir@gmail.com" className="hover:text-slate-300 transition-colors">PhD Semir Poturak</a></p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              clearGraph();
              clearMessages();
              addMessage({
                id: generateUUID(),
                role: 'system',
                content: 'Workspace cleared.'
              });
            }}
            className="text-[10px] bg-slate-700 hover:bg-red-950/40 hover:text-red-400 hover:border-red-900/40 text-slate-300 border border-slate-650 px-2 py-1 rounded transition-colors font-medium"
            title="Clear Graph and Scene"
          >
            Clear
          </button>
          <button 
            onClick={() => setShowSettings(!showSettings)}
            className="p-1.5 hover:bg-slate-700 rounded-md transition-colors"
            title="Configure API Settings"
          >
            <Settings size={18} className={showSettings ? "text-blue-400" : "text-slate-400"} />
          </button>
        </div>
      </div>

      {/* Active Agent Dropdown Selector */}
      <div className="p-3 border-b border-slate-700 bg-slate-850 flex items-center justify-between gap-2 shadow-inner overflow-hidden">
        <label className="text-[10px] text-slate-400 font-bold uppercase tracking-wider shrink-0">Active Agent:</label>
        <select
          value={activeAgentId || ''}
          onChange={(e) => setActiveAgentId(e.target.value)}
          className="flex-1 min-w-0 max-w-full truncate bg-slate-900 border border-slate-700 text-slate-200 rounded px-2 py-1 text-xs font-semibold focus:outline-none focus:border-blue-500"
          style={{ textOverflow: 'ellipsis', whiteSpace: 'nowrap', overflow: 'hidden' }}
        >
          {agentSlots.length === 0 ? (
            <option value="">No Agents Available</option>
          ) : (
            agentSlots.map((slot) => (
              <option key={slot.id} value={slot.id}>
                {slot.name} ({slot.model})
              </option>
            ))
          )}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 bg-slate-850">
        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'chat' 
              ? 'border-blue-500 text-blue-400 bg-slate-800/50' 
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <MessageSquare size={13} />
          Chat
        </button>
        <button
          onClick={() => setActiveTab('reasoning')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'reasoning'
              ? 'border-blue-500 text-blue-400 bg-slate-800/50'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <Brain size={13} />
          Reasoning
        </button>
        <button
          onClick={() => setActiveTab('guidelines')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'guidelines' 
              ? 'border-blue-500 text-blue-400 bg-slate-800/50' 
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <BookOpen size={13} />
          Knowledge
        </button>
        <button
          onClick={() => setActiveTab('library')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'library'
              ? 'border-emerald-500 text-emerald-400 bg-slate-800/50'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <Library size={13} />
          Library
        </button>
        <button
          onClick={() => setActiveTab('evals')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'evals'
              ? 'border-purple-500 text-purple-400 bg-slate-800/50'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <FlaskConical size={13} />
          Evals
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex-1 min-w-0 flex items-center justify-center gap-1 py-2 px-0.5 text-[11px] font-semibold border-b-2 transition-colors overflow-hidden whitespace-nowrap ${
            activeTab === 'logs'
              ? 'border-blue-500 text-blue-400 bg-slate-800/50'
              : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
          }`}
        >
          <BarChart2 size={13} />
          Logs
        </button>
      </div>

      {/* Settings Panel */}
      {showSettings && (
        <div className="p-4 bg-slate-750 border-b border-slate-700 space-y-4 max-h-[60%] overflow-y-auto">
          <div className="flex justify-between items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200">Agent Slots</h3>
            <div className="flex gap-2">
              <button
                onClick={() => restoreDefaultAgents()}
                className="text-[10px] bg-slate-700 hover:bg-slate-650 text-slate-300 px-2 py-1 rounded transition-colors font-medium border border-slate-650"
              >
                Reset Default
              </button>
              <button
                onClick={() => {
                  addAgentSlot({
                    name: 'New Custom Agent',
                    provider: 'gemini',
                    apiKey: '',
                    model: 'gemini-1.5-flash'
                  });
                }}
                className="text-[10px] bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded transition-colors font-medium"
              >
                + Add Slot
              </button>
            </div>
          </div>
          
          <div className="space-y-4">
            {agentSlots.map((slot) => (
              <div key={slot.id} className="bg-slate-800 p-3 rounded border border-slate-700 relative space-y-2.5 shadow-sm">
                {/* Delete button */}
                <button
                  onClick={() => removeAgentSlot(slot.id)}
                  className="absolute top-2.5 right-2.5 text-[10px] bg-red-950/40 text-red-400 border border-red-900/30 hover:bg-red-900/40 px-1.5 py-0.5 rounded transition-colors"
                  disabled={agentSlots.length <= 1}
                  title="Remove Agent Slot"
                >
                  Delete
                </button>
                
                {/* Name & Provider */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] text-slate-400 mb-1">Agent Name</label>
                    <input
                      type="text"
                      value={slot.name}
                      onChange={(e) => updateAgentSlot(slot.id, { name: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-650 rounded px-2 py-1 text-xs text-slate-200"
                    />
                  </div>
                  <div>
                    <label className="block text-[9px] text-slate-400 mb-1">Provider</label>
                    <select
                      value={slot.provider}
                      onChange={(e) => {
                        const newProvider = e.target.value as any;
                        let defaultModel = '';
                        let defaultKey = '';
                        let defaultName = '';
                        
                        if (newProvider === 'gemini') {
                          defaultModel = 'gemini-1.5-flash';
                          defaultName = 'Google Gemini';
                        } else if (newProvider === 'ollama') {
                          defaultKey = 'http://localhost:11434';
                          defaultModel = 'llama3';
                          defaultName = 'Ollama (Local)';
                          fetchModelsForSlot(slot.id, defaultKey);
                        } else if (newProvider === 'openai') {
                          defaultModel = 'gpt-4o';
                          defaultName = 'OpenAI';
                        } else if (newProvider === 'openrouter') {
                          defaultModel = 'anthropic/claude-3.5-sonnet';
                          defaultName = 'OpenRouter';
                        }
                        
                        updateAgentSlot(slot.id, { 
                          provider: newProvider, 
                          model: defaultModel,
                          apiKey: defaultKey,
                          name: defaultName
                        });
                      }}
                      className="w-full bg-slate-900 border border-slate-650 rounded px-2 py-1 text-xs text-slate-200"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="ollama">Ollama (Local)</option>
                      <option value="openai">OpenAI</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                </div>

                {/* API Key/URL & Model */}
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[9px] text-slate-400 mb-1">
                      {slot.provider === 'ollama' ? 'Local URL' : 'API Key'}
                    </label>
                    <input
                      type="password"
                      value={slot.apiKey}
                      onChange={(e) => {
                        const newUrl = e.target.value;
                        updateAgentSlot(slot.id, { apiKey: newUrl });
                        if (slot.provider === 'ollama') {
                          fetchModelsForSlot(slot.id, newUrl);
                        }
                      }}
                      className="w-full bg-slate-900 border border-slate-650 rounded px-2 py-1 text-xs text-slate-200"
                      placeholder={slot.provider === 'ollama' ? 'http://localhost:11434' : 'Key...'}
                    />
                  </div>
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-[9px] text-slate-400">Model Name</label>
                      {slot.provider === 'ollama' && (ollamaModels[slot.id] || []).length > 0 && (
                        <button
                          type="button"
                          onClick={() => setEditManual(prev => ({ ...prev, [slot.id]: !prev[slot.id] }))}
                          className="text-[9px] text-blue-400 hover:text-blue-300 font-medium transition-colors cursor-pointer select-none"
                        >
                          {editManual[slot.id] ? 'Select list' : 'Type custom'}
                        </button>
                      )}
                    </div>
                    {slot.provider === 'ollama' && !editManual[slot.id] && (ollamaModels[slot.id] || []).length > 0 ? (
                      <select
                        value={slot.model}
                        onChange={(e) => updateAgentSlot(slot.id, { model: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-650 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                      >
                        {(() => {
                          const list = ollamaModels[slot.id] || [];
                          const hasSelected = list.includes(slot.model);
                          return (
                            <>
                              {!hasSelected && slot.model && (
                                <option value={slot.model}>{slot.model}</option>
                              )}
                              {list.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </>
                          );
                        })()}
                      </select>
                    ) : (
                      <div className="relative">
                        <input
                          type="text"
                          value={slot.model}
                          onChange={(e) => updateAgentSlot(slot.id, { model: e.target.value })}
                          className="w-full bg-slate-900 border border-slate-650 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-blue-500"
                          placeholder="e.g. llama3"
                        />
                        {slot.provider === 'ollama' && loadingOllama[slot.id] && (
                          <span className="absolute right-2 top-1.5 text-[9px] text-slate-500 animate-pulse">
                            loading...
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {/* Behavior checkboxes */}
                <div className="space-y-1.5 pt-2 border-t border-slate-700/50 mt-1">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`opt-small-${slot.id}`}
                      checked={slot.optimizeForSmallModels ?? false}
                      onChange={(e) => updateAgentSlot(slot.id, { optimizeForSmallModels: e.target.checked })}
                      className="w-3.5 h-3.5 bg-slate-900 border border-slate-650 rounded accent-blue-500 cursor-pointer focus:ring-0"
                    />
                    <label htmlFor={`opt-small-${slot.id}`} className="text-[10px] text-slate-400 cursor-pointer select-none hover:text-slate-300 font-medium">
                      Optimize for weaker/smaller models (single-shot JSON, no tool loop)
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`opt-vision-${slot.id}`}
                      checked={slot.enableVisionVerification ?? false}
                      onChange={(e) => updateAgentSlot(slot.id, { enableVisionVerification: e.target.checked })}
                      className="w-3.5 h-3.5 bg-slate-900 border border-slate-650 rounded accent-blue-500 cursor-pointer focus:ring-0"
                    />
                    <label htmlFor={`opt-vision-${slot.id}`} className="text-[10px] text-slate-400 cursor-pointer select-none hover:text-slate-300 font-medium">
                      Vision verification (snapshot review by the model; extra tokens)
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id={`opt-notools-${slot.id}`}
                      checked={slot.disableToolCalling ?? false}
                      onChange={(e) => updateAgentSlot(slot.id, { disableToolCalling: e.target.checked })}
                      className="w-3.5 h-3.5 bg-slate-900 border border-slate-650 rounded accent-blue-500 cursor-pointer focus:ring-0"
                    />
                    <label htmlFor={`opt-notools-${slot.id}`} className="text-[10px] text-slate-400 cursor-pointer select-none hover:text-slate-300 font-medium">
                      Disable native tool-calling (force JSON fallback)
                    </label>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {activeTab === 'chat' ? (
          // Chat Tab
          messages.length === 0 ? (
            <div className="text-center text-slate-500 mt-10">
              <p>Start designing by describing your intent.</p>
              <p className="text-xs mt-2">Example: "Design a stadium with 40k capacity and a box shape base"</p>
            </div>
          ) : (
            [...messages].reverse().map((msg) => {
              if (msg.role === 'system') {
                return (
                  <div key={msg.id} className="w-full flex justify-center my-1.5">
                    <div className="bg-slate-800/80 border border-slate-700/60 text-slate-400 rounded-md px-3 py-1.5 text-[10.5px] font-mono max-w-[95%] whitespace-pre-wrap leading-relaxed shadow-sm">
                      <span className="text-slate-500 font-bold uppercase tracking-wider mr-1.5">[System]</span>
                      {msg.content}
                    </div>
                  </div>
                );
              }
              return (
                <div 
                  key={msg.id} 
                  className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} my-1`}
                >
                  <div 
                    className={`max-w-[85%] rounded-lg p-3 text-sm shadow-sm whitespace-pre-wrap
                      ${msg.role === 'user' 
                        ? 'bg-blue-600 text-white rounded-br-none' 
                        : 'bg-slate-700 text-slate-200 rounded-bl-none'
                      }`}
                  >
                    {msg.role === 'assistant' && (
                      <div className="text-[10px] text-blue-400 font-bold mb-1 uppercase tracking-wider">
                        AI Response
                      </div>
                    )}
                    {msg.content}
                  </div>
                </div>
              );
            })
          )
        ) : activeTab === 'reasoning' ? (
          // Reasoning Tab
          <div className="flex flex-col space-y-4 h-full min-h-[300px] text-xs">
            <div>
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-1.5 mb-1.5">
                <Brain size={14} className="text-blue-400" /> Active Design Plan
              </h3>
              {episodePlan ? (
                <div className="bg-slate-900 border border-slate-700/60 rounded-lg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-slate-300 max-h-[160px] overflow-y-auto shadow-inner">
                  {episodePlan}
                </div>
              ) : (
                <div className="text-slate-500 italic py-2">No active plan recorded. Try generating a design in the chat.</div>
              )}
            </div>

            {episodeRatios && episodeRatios.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Governing Proportional Ratios</h4>
                <div className="bg-slate-900 border border-slate-700/60 rounded-lg overflow-hidden shadow-inner">
                  <table className="w-full text-left font-mono text-[10.5px]">
                    <thead>
                      <tr className="bg-slate-800/50 border-b border-slate-700 text-slate-400">
                        <th className="p-2 font-semibold">Parameter</th>
                        <th className="p-2 font-semibold">Formula / Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {episodeRatios.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-800/30">
                          <td className="p-2 text-blue-300 font-semibold">{r.param}</td>
                          <td className="p-2">{r.formula}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {episodeDrivers && episodeDrivers.length > 0 && (
              <div>
                <h4 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">Driver Sliders</h4>
                <div className="flex flex-wrap gap-1.5 py-1">
                  {episodeDrivers.map((d, i) => (
                    <span key={i} className="bg-blue-950/40 border border-blue-900/60 text-blue-400 rounded-full px-2 py-0.5 text-[10px] font-mono font-medium">
                      {d}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="flex-1 flex flex-col min-h-[180px]">
              <h3 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Execution & Repair Logs</h3>
              <div className="flex-1 bg-black/60 border border-slate-800 rounded-lg p-3 font-mono text-[10px] leading-relaxed text-slate-400 overflow-y-auto max-h-[300px] shadow-inner select-text">
                {messages.filter(m => m.role === 'system').length === 0 ? (
                  <div className="text-slate-600 italic">No system execution logs yet. Logs from the geometry kernel and repair loop will show up here.</div>
                ) : (
                  [...messages]
                    .filter(m => m.role === 'system')
                    .map((m, idx) => (
                      <div key={m.id} className="mb-2 last:mb-0 border-b border-slate-900/60 pb-2 last:border-b-0">
                        <span className="text-slate-650 font-bold mr-1.5">[LOG #{idx + 1}]</span>
                        <span className="text-slate-300 whitespace-pre-wrap">{m.content}</span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        ) : activeTab === 'guidelines' ? (
          // Guidelines Tab (static rules; the dynamic self-voted rules were retired
          // in favor of the verified success library — see Library tab)
          <div className="flex flex-col space-y-2 h-full min-h-[300px]">
            <h3 className="text-sm font-semibold text-slate-200">Core System Guidelines (AGENTS.md)</h3>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              Static architecture rules. Edit manually or type <code className="bg-slate-900 px-1 py-0.5 rounded text-blue-400 font-mono">/learn [rule]</code> in chat.
              Long-term learned knowledge now lives in the <span className="text-emerald-400">Library</span> tab (verified examples + macros).
            </p>
            <textarea
              value={agentGuidelines}
              onChange={(e) => setAgentGuidelines(e.target.value)}
              className="flex-1 bg-slate-900 border border-slate-700 text-slate-200 p-3 rounded-lg text-xs font-mono leading-relaxed focus:outline-none focus:border-blue-500 resize-none"
              placeholder="Type core design rules or constraints here..."
            />
          </div>
        ) : activeTab === 'library' ? (
          <LibraryPanel />
        ) : activeTab === 'evals' ? (
          <EvalPanel />
        ) : (
          // Performance Logs Tab
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-300">Model Performance (intelligence_log.json)</h3>
            {performanceLogs.length === 0 ? (
              <div className="text-center text-slate-500 py-10 text-xs">
                No logs recorded yet. Run a prompt in Chat to generate metrics.
              </div>
            ) : (
              performanceLogs.map((log, idx) => (
                <div key={idx} className="bg-slate-900/60 p-3 rounded-lg border border-slate-750 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-blue-400 truncate max-w-[150px]">{log.model}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      log.success ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
                    }`}>
                      {log.success ? 'SUCCESS' : 'FAILED'}
                    </span>
                  </div>
                  <div className="text-slate-400 italic">"{log.request}"</div>
                  <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800 text-[10px] text-slate-500">
                    <div>Latency: <span className="text-slate-300">{log.responseTimeMs}ms</span></div>
                    <div>Nodes: <span className="text-slate-300">{log.nodeCount}</span></div>
                    <div>Edges: <span className="text-slate-300">{log.edgeCount}</span></div>
                  </div>
                  {log.error && (
                    <div className="text-[10px] text-red-400 bg-red-950/20 p-1.5 rounded mt-1 border border-red-900/20 font-mono break-all">
                      {log.error}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Save nudge banner */}
      {nudgeCandidate && activeTab === 'chat' && (
        <div className="mx-3 mb-2 p-2.5 bg-emerald-950/50 border border-emerald-800/50 rounded-lg flex items-center gap-2">
          <Star size={14} className="text-emerald-400 shrink-0" />
          <div className="flex-1 text-[10px] text-emerald-200 leading-snug">
            Save the previous design ("{(nudgeCandidate.prompts[0] || '').slice(0, 40)}…") as a successful example?
          </div>
          <button
            onClick={() => openSaveModal(nudgeCandidate)}
            className="text-[10px] bg-emerald-700 hover:bg-emerald-600 text-white px-2 py-1 rounded font-medium shrink-0"
          >
            Save
          </button>
          <button
            onClick={() => setNudgeCandidate(null)}
            className="text-emerald-500 hover:text-emerald-300 shrink-0"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* Input Area (Only for Chat Tab) */}
      {activeTab === 'chat' && (
        <div className="p-4 border-t border-slate-700">
          <div className="flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSend()}
              placeholder={isLoading ? "AI is reasoning..." : "Type your design intent..."}
              disabled={isLoading}
              className="flex-1 bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <button 
              onClick={handleSend}
              disabled={isLoading}
              className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-lg transition-colors flex items-center justify-center w-10 disabled:bg-slate-700 disabled:text-slate-400 disabled:cursor-not-allowed"
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
