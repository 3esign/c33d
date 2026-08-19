import React, { useEffect, useState } from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import type { NodeParamDef } from '../nodes/NodeDefinitions';
import { useStore } from '../store/useStore';

// Numeric field with local draft state: partial entries like "-", "" or "1e-"
// stay local while typing, and the store (and thus a re-evaluation) is only
// touched on blur/Enter with a finite number. This makes negative values
// typeable and stops the per-keystroke eval storm.
const NumberField: React.FC<{
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onCommit: (v: number) => void;
}> = ({ value, min, max, step, disabled, onCommit }) => {
  const [text, setText] = useState<string>(String(value));
  const [editing, setEditing] = useState(false);

  // Reflect external changes (slider drags, AI edits) while not being edited.
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(text);
    if (Number.isFinite(parsed)) {
      if (parsed !== value) onCommit(parsed);
    } else {
      setText(String(value)); // revert an unparseable draft
    }
  };

  return (
    <input
      type="number"
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      className={`nodrag nopan bg-slate-900 text-slate-200 text-[10px] p-0.5 rounded border border-slate-650 w-10 text-center font-mono ${disabled ? 'opacity-40' : ''}`}
      value={editing ? text : String(value)}
      onChange={e => { setEditing(true); setText(e.target.value); }}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          commit();
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
};

export const ParametricNode: React.FC<NodeProps> = ({ id, type, data, isConnectable }) => {
  const definition = NODE_LIBRARY[type];
  const updateNodeData = useStore(state => state.updateNodeData);
  // Subscribe only to the handles that drive THIS node's params — a shallow-
  // compared string array, so unrelated edge changes don't re-render the node.
  const drivenHandles = useStore(useShallow(state =>
    state.edges
      .filter(e => e.target === id && typeof e.targetHandle === 'string' && e.targetHandle.startsWith('param:'))
      .map(e => e.targetHandle as string)
  ));
  const macroDefFromStore = useStore(state =>
    type === 'Macro' ? state.macros.find(m => m.id === (data as any).macroId) ?? null : null
  );

  if (!definition) return <div className="bg-red-500 text-white p-2">Unknown Node</div>;

  const handleChange = (paramName: string, value: any) => {
    updateNodeData(id, { [paramName]: value });
  };

  // Macro nodes derive their params from the macro definition
  const macroDef = macroDefFromStore;
  const params: NodeParamDef[] = macroDef
    ? macroDef.exposedParams.map(ep => ({ name: ep.name, type: ep.type, default: ep.default, min: ep.min, max: ep.max, step: ep.step }))
    : definition.params;

  const isNumberNode = type === 'NumberSlider' || type === 'Expression' || type === 'Series' || type === 'Range' || type === 'ListItem' || type === 'ListLength' || type === 'ListConstant' || type === 'PointsFromLists' || type === 'RepeatEach' || type === 'Tile';
  const headerLabel = macroDef ? `★ ${macroDef.name}` : definition.label;
  const headerClass = macroDef
    ? 'bg-amber-900/60 text-amber-200'
    : isNumberNode
      ? 'bg-emerald-900/60 text-emerald-200'
      : 'bg-slate-700 text-slate-200';

  const isDriven = (paramName: string) => drivenHandles.includes(`param:${paramName}`);

  return (
    <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-lg min-w-[150px] font-sans text-sm">
      {/* Header */}
      <div className={`px-3 py-1 rounded-t-lg border-b border-slate-600 font-semibold ${headerClass}`}>
        {headerLabel}
      </div>

      {/* Body */}
      <div className="p-3 space-y-3">
        {/* Input Handles */}
        {definition.inputs.map((input, idx) => (
          <div key={`in-${idx}`} className="relative flex items-center h-5">
            <Handle
              type="target"
              position={Position.Left}
              id={input.name}
              isConnectable={isConnectable}
              className={`w-3 h-3 border-none -ml-4 ${input.type === 'number' ? 'bg-emerald-500' : 'bg-blue-500'}`}
            />
            <span className="text-slate-300 text-xs ml-1">{input.name}</span>
          </div>
        ))}

        {/* Parameters */}
        {params.length > 0 && (
          <div className="space-y-2 pt-1">
            {params.map(param => {
              const driven = param.type === 'number' && isDriven(param.name);
              return (
                <div key={param.name} className="relative flex flex-col gap-1">
                  {/* Param-driving handle (numeric params accept a number connection) */}
                  {param.type === 'number' && !(type === 'NumberSlider' && param.name === 'value') && (
                    <Handle
                      type="target"
                      position={Position.Left}
                      id={`param:${param.name}`}
                      isConnectable={isConnectable}
                      className="w-2.5 h-2.5 bg-emerald-500 border border-emerald-300 -ml-4"
                      style={{ top: '14px' }}
                      title={`Drive "${param.name}" with a number`}
                    />
                  )}
                  <label className={`text-xs capitalize ${driven ? 'text-emerald-400' : 'text-slate-400'}`}>
                    {param.name}{driven ? ' (driven)' : ''}
                  </label>
                  {param.type === 'number' ? (
                    <div className="flex items-center gap-1.5 w-full">
                      {(() => {
                        // NumberSlider: the value slider range comes from its own min/max/step params
                        const isSliderValue = type === 'NumberSlider' && param.name === 'value';
                        const minVal = isSliderValue
                          ? Number((data as any).min ?? 0)
                          : (data as any)[`${param.name}__min`] !== undefined ? Number((data as any)[`${param.name}__min`]) : (param.min ?? 0.1);
                        const maxVal = isSliderValue
                          ? Number((data as any).max ?? 100)
                          : (data as any)[`${param.name}__max`] !== undefined ? Number((data as any)[`${param.name}__max`]) : (param.max ?? 100);
                        const stepVal = isSliderValue
                          ? Number((data as any).step ?? 0.1)
                          : (data as any)[`${param.name}__step`] !== undefined ? Number((data as any)[`${param.name}__step`]) : (param.step ?? 0.1);
                        const currentVal = (data as any)[param.name] !== undefined ? Number((data as any)[param.name]) : param.default;

                        return (
                          <>
                            <input
                              type="range"
                              min={minVal}
                              max={maxVal}
                              step={stepVal}
                              disabled={driven}
                              className={`nodrag nopan flex-1 accent-blue-500 bg-slate-900 rounded-lg appearance-none h-1.5 ${driven ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
                              value={currentVal}
                              onChange={e => handleChange(param.name, parseFloat(e.target.value))}
                            />
                            <NumberField
                              min={minVal}
                              max={maxVal}
                              step={stepVal}
                              disabled={driven}
                              value={Number(currentVal)}
                              onCommit={v => handleChange(param.name, v)}
                            />
                          </>
                        );
                      })()}
                    </div>
                  ) : param.type === 'string' ? (
                    <input
                      type="text"
                      className="nodrag nopan bg-slate-900 text-slate-200 text-xs p-1 rounded border border-slate-600 w-full"
                      value={(data as any)[param.name] ?? param.default}
                      onChange={e => handleChange(param.name, e.target.value)}
                    />
                  ) : param.type === 'boolean' ? (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="nodrag nopan w-4 h-4 bg-slate-900 border-slate-600 rounded text-blue-600 accent-blue-500 focus:ring-0 cursor-pointer"
                        checked={(data as any)[param.name] ?? param.default}
                        onChange={e => handleChange(param.name, e.target.checked)}
                      />
                      <span className="text-[10px] text-slate-400">Enable</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Output Handles */}
        {definition.outputs.map((output, idx) => (
          <div key={`out-${idx}`} className="relative flex items-center justify-end h-5 mt-2">
            <span className="text-slate-300 text-xs mr-1">{output.name}</span>
            <Handle
              type="source"
              position={Position.Right}
              id={output.name}
              isConnectable={isConnectable}
              className={`w-3 h-3 border-none -mr-4 ${output.type === 'number' ? 'bg-emerald-500' : 'bg-green-500'}`}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
