import React, { Suspense, useMemo, useEffect, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Bounds, useBounds } from '@react-three/drei';
import * as THREE from 'three';
import { Maximize, Star, Download } from 'lucide-react';
import { Outliner } from './Outliner';
import { useStore } from '../store/useStore';
import type { SceneObject } from '../store/useStore';
import { registerViewportCanvas } from '../utils/snapshot';
import { isSystemError } from '../utils/errors';
import { downloadSessionExport } from '../utils/exportSession';

const BoundsController: React.FC = () => {
  const bounds = useBounds();
  const triggerFitCount = useStore(state => state.triggerFitCount);
  const sceneObjectsCount = useStore(state => state.sceneObjects.filter(obj => obj.visible && obj.geometryData).length);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (triggerFitCount > 0) {
      bounds.refresh().fit();
    }
  }, [triggerFitCount, bounds]);

  useEffect(() => {
    if (prevCountRef.current === 0 && sceneObjectsCount > 0) {
      const timer = setTimeout(() => {
        bounds.refresh().fit();
      }, 100);
      return () => clearTimeout(timer);
    }
    prevCountRef.current = sceneObjectsCount;
  }, [sceneObjectsCount, bounds]);

  return null;
};

const GeometryMesh: React.FC<{ object: SceneObject }> = ({ object }) => {
  const geometry = useMemo(() => {
    if (!object.geometryData) return null;
    const { vertices, indices, normals } = object.geometryData;
    
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3));
    if (normals) {
      geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normals), 3));
    } else {
      geo.computeVertexNormals();
    }
    if (indices) {
      geo.setIndex(indices);
    }
    return geo;
  }, [object.geometryData]);

  if (!geometry) return null;

  const objectColor = object.color || "#3b82f6";
  const geoType = (object.geometryData as any).type || 'Mesh';

  if (geoType === 'Line' || geoType === 'Point') {
    return (
      <lineSegments geometry={geometry}>
        <lineBasicMaterial color={objectColor === "#3b82f6" ? "#facc15" : objectColor} linewidth={geoType === 'Point' ? 2 : 3} />
      </lineSegments>
    );
  }

  return (
    <mesh geometry={geometry} castShadow receiveShadow>
      <meshStandardMaterial color={objectColor} roughness={0.4} metalness={0.1} />
      {/* Optional: Add wireframe or edge rendering for CAD feel */}
      <lineSegments>
        <edgesGeometry args={[geometry]} />
        <lineBasicMaterial color="#1e293b" linewidth={2} />
      </lineSegments>
    </mesh>
  );
};

export const Viewport3D: React.FC = () => {
  const { sceneObjects, zoomToFit, openSaveModal, nodes, lastEvaluationError } = useStore();
  const [showExport, setShowExport] = useState(false);
  const [exportComment, setExportComment] = useState('');

  const doExport = () => {
    downloadSessionExport(exportComment);
    setShowExport(false);
    setExportComment('');
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (
        activeEl.tagName === 'INPUT' || 
        activeEl.tagName === 'TEXTAREA' || 
        activeEl.hasAttribute('contenteditable')
      );
      if (isInput) return;

      if (e.key.toLowerCase() === 'f') {
        zoomToFit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [zoomToFit]);

  return (
    <div className="relative w-full h-full bg-slate-900 border-b border-slate-700">
      <Canvas
        camera={{ position: [20, 20, 20], fov: 50, near: 0.1, far: 5000 }}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ preserveDrawingBuffer: true }}
        onCreated={({ gl }) => registerViewportCanvas(gl.domElement)}
      >
        <color attach="background" args={['#0f172a']} />
        
        <ambientLight intensity={0.6} />
        <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
        <directionalLight position={[-10, 10, -10]} intensity={0.5} />
        
        <Suspense fallback={null}>
          {sceneObjects.some(obj => obj.visible && obj.geometryData) ? (
            <Bounds margin={1.2}>
              <BoundsController />
              <group position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
                {sceneObjects.map(obj => (
                  obj.visible && obj.geometryData && (
                    <GeometryMesh key={obj.id} object={obj} />
                  )
                ))}
              </group>
            </Bounds>
          ) : (
            <group position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]} />
          )}
        </Suspense>

        <axesHelper args={[15]} />

        <Grid 
          infiniteGrid 
          fadeDistance={100} 
          sectionColor="#334155" 
          cellColor="#1e293b" 
          sectionSize={10} 
          cellSize={2} 
        />
        <OrbitControls makeDefault />
      </Canvas>

      {/* Floating Action Buttons */}
      <div className="absolute top-4 left-4 flex items-center gap-2 z-50 pointer-events-auto">
        <button
          onClick={zoomToFit}
          className="bg-slate-800/90 hover:bg-slate-750 text-slate-200 font-medium px-3 py-1.5 rounded-lg border border-slate-700 shadow-lg flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
          title="Zoom to Fit (F)"
        >
          <Maximize size={14} />
          Zoom to Fit
        </button>

        <button
          onClick={() => setShowExport(true)}
          className="bg-slate-800/90 hover:bg-slate-750 text-slate-200 font-medium px-3 py-1.5 rounded-lg border border-slate-700 shadow-lg flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
          title="Export the graph, conversation, plan/genome and geometry report as one JSON file"
        >
          <Download size={14} />
          Export JSON
        </button>

        {nodes.length > 0 && !isSystemError(lastEvaluationError) && (
          <button
            onClick={() => openSaveModal(null)}
            className="bg-emerald-700/90 hover:bg-emerald-600 text-white font-medium px-3 py-1.5 rounded-lg border border-emerald-600 shadow-lg flex items-center gap-1.5 text-xs transition-colors cursor-pointer"
            title="Save this design (graph + prompts + comment) as a verified successful example — it becomes AI knowledge"
          >
            <Star size={14} />
            Save as Successful
          </button>
        )}
      </div>

      {showExport && (
        <div
          className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 pointer-events-auto"
          onClick={() => setShowExport(false)}
        >
          <div
            className="bg-slate-800 border border-slate-700 rounded-xl p-5 w-[26rem] shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-slate-100 flex items-center gap-1.5 mb-1">
              <Download size={15} className="text-blue-400" /> Export graph JSON
            </h3>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3">
              Bundles the current graph (nodes + edges), the full conversation, the plan/genome
              and the last geometry report into one JSON file.
            </p>
            <label className="text-[11px] font-medium text-slate-300">Comment (optional)</label>
            <textarea
              value={exportComment}
              onChange={e => setExportComment(e.target.value)}
              placeholder="Notes about this graph — what worked, what's wrong, what to look at…"
              rows={3}
              autoFocus
              className="mt-1 w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
            />
            <div className="flex items-center justify-end gap-2 mt-4">
              <button
                onClick={() => setShowExport(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-750"
              >
                Cancel
              </button>
              <button
                onClick={doExport}
                className="text-xs px-3 py-1.5 rounded-lg bg-blue-700 hover:bg-blue-600 text-white font-medium flex items-center gap-1.5"
              >
                <Download size={13} /> Download JSON
              </button>
            </div>
          </div>
        </div>
      )}

      <Outliner />
    </div>
  );
};
