import React, { Suspense, useMemo, useEffect, useRef } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Grid, Bounds, useBounds } from '@react-three/drei';
import * as THREE from 'three';
import { Maximize, Star } from 'lucide-react';
import { Outliner } from './Outliner';
import { useStore } from '../store/useStore';
import type { SceneObject } from '../store/useStore';
import { registerViewportCanvas } from '../utils/snapshot';

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
  const { sceneObjects, zoomToFit, openSaveModal, nodes } = useStore();

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
        shadows
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
      <button
        onClick={zoomToFit}
        className="absolute top-4 left-4 bg-slate-800/90 hover:bg-slate-750 text-slate-200 font-medium px-3 py-1.5 rounded-lg border border-slate-700 shadow-lg flex items-center gap-1.5 text-xs transition-colors z-50 pointer-events-auto cursor-pointer"
        title="Zoom to Fit (F)"
      >
        <Maximize size={14} />
        Zoom to Fit
      </button>

      {nodes.length > 0 && (
        <button
          onClick={() => openSaveModal(null)}
          className="absolute top-4 left-36 bg-emerald-700/90 hover:bg-emerald-600 text-white font-medium px-3 py-1.5 rounded-lg border border-emerald-600 shadow-lg flex items-center gap-1.5 text-xs transition-colors z-50 pointer-events-auto cursor-pointer"
          title="Save this design (graph + prompts + comment) as a verified successful example — it becomes AI knowledge"
        >
          <Star size={14} />
          Save as Successful
        </button>
      )}

      <Outliner />
    </div>
  );
};
