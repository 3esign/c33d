import { useEffect, useState } from 'react';
import { ChatPanel } from './components/ChatPanel';
import { NodeGraph } from './components/NodeGraph';
import { Viewport3D } from './components/Viewport3D';
import { SaveExampleModal } from './components/SaveExampleModal';
import { useStore } from './store/useStore';

function App() {
  const initializeGuidelines = useStore(state => state.initializeGuidelines);
  const initializeExamples = useStore(state => state.initializeExamples);
  const initializeMacros = useStore(state => state.initializeMacros);

  // Resizable panels state
  const [topHeight, setTopHeight] = useState<number>(() => window.innerHeight * 0.55);
  const [leftWidth, setLeftWidth] = useState<number>(320);
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingLeft, setIsDraggingLeft] = useState(false);

  useEffect(() => {
    // We explicitly clear the error on mount to avoid stuck errors across reloads
    useStore.getState().clearLastEvaluationError();

    // Load knowledge stores from server
    initializeGuidelines();
    initializeExamples();
    initializeMacros();
  }, [initializeGuidelines, initializeExamples, initializeMacros]);

  const startResizeTop = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingTop(true);
  };

  const startResizeLeft = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDraggingLeft(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingTop) {
        const newHeight = e.clientY;
        if (newHeight > 100 && newHeight < window.innerHeight - 100) {
          setTopHeight(newHeight);
        }
      } else if (isDraggingLeft) {
        const newWidth = e.clientX;
        if (newWidth > 200 && newWidth < window.innerWidth - 300) {
          setLeftWidth(newWidth);
        }
      }
    };

    const handleMouseUp = () => {
      setIsDraggingTop(false);
      setIsDraggingLeft(false);
    };

    if (isDraggingTop || isDraggingLeft) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = isDraggingTop ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
    } else {
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isDraggingTop, isDraggingLeft]);

  return (
    <div className="w-screen h-screen flex overflow-hidden bg-slate-900 text-slate-100">
      {/* Left Panel: Chat Interface */}
      <div style={{ width: leftWidth }} className="flex-shrink-0 z-10">
        <ChatPanel />
      </div>

      {/* Resize Divider Splitter (Vertical) */}
      <div
        onMouseDown={startResizeLeft}
        className={`w-2 h-full bg-slate-950 hover:bg-blue-500 cursor-col-resize flex flex-col items-center justify-center transition-colors relative z-20 select-none ${
          isDraggingLeft ? 'bg-blue-600' : ''
        }`}
        title="Drag to resize chat panel"
      >
        <div className="h-16 w-1 bg-slate-800 rounded-full hover:bg-slate-350 transition-colors" />
      </div>
      
      {/* Right Column: 3D Viewport and Node Graph */}
      <div className="flex-1 flex flex-col h-full relative min-w-0 overflow-hidden">
        <div style={{ height: topHeight }} className="w-full relative z-0">
          <Viewport3D />
        </div>
        
        {/* Resize Divider Splitter (Horizontal) */}
        <div
          onMouseDown={startResizeTop}
          className={`h-2 w-full bg-slate-950 hover:bg-blue-500 cursor-row-resize flex items-center justify-center transition-colors relative z-20 select-none ${
            isDraggingTop ? 'bg-blue-600' : ''
          }`}
          title="Drag to resize viewport and node graph"
        >
          <div className="w-16 h-1 bg-slate-800 rounded-full hover:bg-slate-350 transition-colors" />
        </div>

        <div className="flex-1 w-full relative z-0">
          <NodeGraph />
        </div>
      </div>

      <SaveExampleModal />
    </div>
  );
}

export default App;
