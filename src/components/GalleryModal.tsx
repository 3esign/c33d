import React, { useState } from 'react';
import { Sparkles, X, ArrowRight } from 'lucide-react';
import { useStore, generateUUID } from '../store/useStore';

interface GalleryItem {
  id: string;
  title: string;
  category: 'Architectural' | 'Organic' | 'Engineering' | 'Generative';
  description: string;
  tags: string[];
  nodesCount: number;
  data: any;
}

const CURATED_GALLERY: GalleryItem[] = [
  {
    id: 'flanged-cylinder',
    title: 'Point-First Flanged Cylinder',
    category: 'Engineering',
    description: 'Precision hydraulic flanged cylinder constructed point-first from concentric curve profiles with instanced 6-hole bolt cutter subtraction.',
    tags: ['flange', 'cylinder', 'point-first', 'mechanical'],
    nodesCount: 13,
    data: {
      nodes: [
        { id: 'r_shaft', type: 'NumberSlider', position: { x: 50, y: 50 }, data: { label: 'shaftRadius', value: 6, min: 2, max: 20 } },
        { id: 'h_tot', type: 'NumberSlider', position: { x: 50, y: 150 }, data: { label: 'totalHeight', value: 35, min: 10, max: 100 } },
        { id: 'r_flange', type: 'NumberSlider', position: { x: 50, y: 250 }, data: { label: 'flangeRadius', value: 14, min: 8, max: 40 } },
        { id: 'c_shaft', type: 'CircleCurve', position: { x: 260, y: 50 }, data: { radius: 'shaftRadius' } },
        { id: 'ext_shaft', type: 'ExtrudeCurve', position: { x: 460, y: 50 }, data: { height: 'totalHeight' } },
        { id: 'c_flange', type: 'CircleCurve', position: { x: 260, y: 250 }, data: { radius: 'flangeRadius' } },
        { id: 'ext_flange', type: 'ExtrudeCurve', position: { x: 460, y: 250 }, data: { height: 4 } },
        { id: 'c_bolt', type: 'CircleCurve', position: { x: 260, y: 380 }, data: { radius: 10 } },
        { id: 'div_bolt', type: 'DivideCurve', position: { x: 460, y: 380 }, data: { count: 6 } },
        { id: 'cyl_bolt', type: 'Cylinder', position: { x: 460, y: 500 }, data: { radius: 1.2, height: 6 } },
        { id: 'inst_bolt', type: 'InstanceOnPoints', position: { x: 680, y: 380 }, data: {} },
        { id: 'diff_flange', type: 'Boolean', position: { x: 880, y: 250 }, data: { operation: 'difference' } },
        { id: 'union_all', type: 'Boolean', position: { x: 1080, y: 150 }, data: { operation: 'union', color: '#64748b' } },
      ],
      edges: [
        { source: 'c_shaft', target: 'ext_shaft', sourceHandle: 'curve', targetHandle: 'curve' },
        { source: 'c_flange', target: 'ext_flange', sourceHandle: 'curve', targetHandle: 'curve' },
        { source: 'c_bolt', target: 'div_bolt', sourceHandle: 'curve', targetHandle: 'curve' },
        { source: 'div_bolt', target: 'inst_bolt', sourceHandle: 'points', targetHandle: 'points' },
        { source: 'cyl_bolt', target: 'inst_bolt', sourceHandle: 'solid', targetHandle: 'shape' },
        { source: 'ext_flange', target: 'diff_flange', sourceHandle: 'solid', targetHandle: 'target' },
        { source: 'inst_bolt', target: 'diff_flange', sourceHandle: 'solid', targetHandle: 'tool' },
        { source: 'diff_flange', target: 'union_all', sourceHandle: 'solid', targetHandle: 'target' },
        { source: 'ext_shaft', target: 'union_all', sourceHandle: 'solid', targetHandle: 'tool' },
      ],
    },
  },
  {
    id: 'solar-system',
    title: 'Proportional Solar System',
    category: 'Generative',
    description: 'All 8 planetary bodies and scaled orbit guide rings remapped from real astronomical data onto a single driving system radius slider.',
    tags: ['space', 'astronomy', 'orbits', 'instancing'],
    nodesCount: 8,
    data: {
      nodes: [
        { id: 'sys_rad', type: 'NumberSlider', position: { x: 50, y: 100 }, data: { label: 'systemRadius', value: 50, min: 20, max: 150 } },
        { id: 'sun', type: 'Sphere', position: { x: 260, y: 50 }, data: { radius: 'systemRadius * 0.12', color: '#fbbf24' } },
        { id: 'orbit1', type: 'Torus', position: { x: 260, y: 180 }, data: { majorRadius: 'systemRadius * 0.3', minorRadius: 0.15, color: '#38bdf8' } },
        { id: 'orbit2', type: 'Torus', position: { x: 260, y: 300 }, data: { majorRadius: 'systemRadius * 0.5', minorRadius: 0.18, color: '#38bdf8' } },
        { id: 'orbit3', type: 'Torus', position: { x: 260, y: 420 }, data: { majorRadius: 'systemRadius * 0.8', minorRadius: 0.2, color: '#38bdf8' } },
        { id: 'planet1', type: 'Sphere', position: { x: 480, y: 180 }, data: { radius: 'systemRadius * 0.02', center: { x: 'systemRadius * 0.3', y: 0, z: 0 }, color: '#f97316' } },
        { id: 'planet2', type: 'Sphere', position: { x: 480, y: 300 }, data: { radius: 'systemRadius * 0.035', center: { x: 0, y: 'systemRadius * 0.5', z: 0 }, color: '#3b82f6' } },
        { id: 'planet3', type: 'Sphere', position: { x: 480, y: 420 }, data: { radius: 'systemRadius * 0.06', center: { x: '-systemRadius * 0.8', y: 0, z: 0 }, color: '#a855f7' } },
      ],
      edges: [],
    },
  },
  {
    id: 'parametric-bloom',
    title: 'Parametric Botanical Bloom',
    category: 'Organic',
    description: 'Multi-tiered floral blossom with central tapered stem, pollen stamen cluster, and dual interleaved radial petal rings.',
    tags: ['flower', 'botanical', 'radial', 'phyllotaxis'],
    nodesCount: 7,
    data: {
      nodes: [
        { id: 'stem_h', type: 'NumberSlider', position: { x: 50, y: 50 }, data: { label: 'stemHeight', value: 30, min: 10, max: 60 } },
        { id: 'stem', type: 'Cone', position: { x: 260, y: 50 }, data: { radius1: 1.2, radius2: 0.8, height: 'stemHeight', color: '#16a34a' } },
        { id: 'receptacle', type: 'Sphere', position: { x: 480, y: 50 }, data: { radius: 2.2, center: { x: 0, y: 0, z: 'stemHeight' }, color: '#eab308' } },
        { id: 'petal_ell', type: 'Ellipsoid', position: { x: 260, y: 220 }, data: { radiusX: 1.2, radiusY: 4.5, radiusZ: 0.3 } },
        { id: 'petal_tilt', type: 'Rotate', position: { x: 480, y: 220 }, data: { angle: 30, axisX: 1, axisY: 0, axisZ: 0 } },
        { id: 'petal_pos', type: 'Translate', position: { x: 700, y: 220 }, data: { y: 2.5, z: 'stemHeight' } },
        { id: 'petal_ring', type: 'CircularPattern', position: { x: 920, y: 220 }, data: { count: 8, angle: 360, color: '#ec4899' } },
      ],
      edges: [
        { source: 'petal_ell', target: 'petal_tilt', sourceHandle: 'solid', targetHandle: 'solid' },
        { source: 'petal_tilt', target: 'petal_pos', sourceHandle: 'solid', targetHandle: 'solid' },
        { source: 'petal_pos', target: 'petal_ring', sourceHandle: 'solid', targetHandle: 'solid' },
      ],
    },
  },
];

export const GalleryModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const setNodes = useStore(state => state.setNodes);
  const setEdges = useStore(state => state.setEdges);
  const evaluateGraph = useStore(state => state.evaluateGraph);
  const addMessage = useStore(state => state.addMessage);

  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const categories = ['All', 'Engineering', 'Organic', 'Generative', 'Architectural'];

  if (!isOpen) return null;

  const handleLoadItem = (item: GalleryItem) => {
    setNodes(item.data.nodes || []);
    setEdges(item.data.edges || []);
    evaluateGraph();

    addMessage({
      id: generateUUID(),
      role: 'system',
      content: `Loaded gallery model "${item.title}" into the workspace.`,
    });

    onClose();
  };

  const filteredItems = selectedCategory === 'All'
    ? CURATED_GALLERY
    : CURATED_GALLERY.filter(item => item.category === selectedCategory);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div 
        className="bg-slate-800 border border-slate-700 rounded-2xl p-6 w-full max-w-3xl shadow-2xl space-y-4 max-h-[90vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-700 pb-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-400" />
            <h3 className="text-sm font-semibold text-slate-100">Community & Curated Gallery</h3>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-lg">
            <X size={16} />
          </button>
        </div>

        {/* Category Pills */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {categories.map(c => (
            <button
              key={c}
              onClick={() => setSelectedCategory(c)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                selectedCategory === c
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-900 border border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        {/* Gallery Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 overflow-y-auto pr-1 flex-1">
          {filteredItems.map(item => (
            <div
              key={item.id}
              className="bg-slate-900/70 border border-slate-700/80 hover:border-purple-500/80 rounded-xl p-4 flex flex-col justify-between space-y-3 transition-all hover:shadow-xl group"
            >
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30 uppercase tracking-wider">
                    {item.category}
                  </span>
                  <span className="text-[10px] text-slate-500">{item.nodesCount} nodes</span>
                </div>
                <h4 className="text-sm font-semibold text-slate-100 group-hover:text-purple-300 transition-colors">
                  {item.title}
                </h4>
                <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">
                  {item.description}
                </p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <div className="flex flex-wrap gap-1">
                  {item.tags.slice(0, 3).map(t => (
                    <span key={t} className="text-[9px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                      #{t}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => handleLoadItem(item)}
                  className="px-3 py-1.5 bg-purple-600/90 hover:bg-purple-600 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors"
                >
                  <span>Open Model</span>
                  <ArrowRight size={12} />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};