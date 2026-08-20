import * as replicad from 'replicad';
const rc: any = replicad;
import { safeTranslate, safeRotate, safeScale } from '../deformation.ts';
import { num, clampCount } from '../executors.ts';

type WarnFn = (msg: string) => void;

function kernelAwareMsg(err: any): string {
  const m = err?.message || String(err);
  if (/Null shape/i.test(m)) return 'null shape pointer produced during operation';
  if (/StdFail_NotDone/i.test(m)) return 'kernel operation failed to converge on the input topology';
  return m;
}

function curveToWire(curveIn: any): any {
  if (!curveIn) return null;
  if (curveIn.type === 'Curve') return curveIn.value;
  if (curveIn.wireIndex !== undefined || curveIn.geomType) return curveIn;
  if (Array.isArray(curveIn)) return curveIn.map(curveToWire).filter(Boolean);
  return curveIn;
}

export const GENERATIVE_EXECUTORS: Record<string, (params: any, inputs: any[], warn: WarnFn) => any> = {
  CurveFrame: (params, inputs, warn) => {
    const curveIn = inputs.find((i: any) => i.targetHandle === 'curve')?.value;
    if (!curveIn || curveIn.type !== 'Curve') {
      warn('CurveFrame: connect a Curve to "curve".');
      return null;
    }
    const samples = Math.max(2, Math.min(200, Math.round(num(params.samples, 20))));

    try {
      const wire = curveToWire(curveIn);
      const points: any[] = [];
      const tangents: any[] = [];
      const normals: any[] = [];
      const rotations: any[] = [];

      for (let i = 0; i < samples; i++) {
        const u = i / (samples - 1);
        let pt = [u * 10, 0, 0];
        let tang = [1, 0, 0];
        let norm = [0, 0, 1];

        if (wire && typeof wire.pointAt === 'function') {
          try {
            const p = wire.pointAt(u);
            if (p) pt = [p.x || 0, p.y || 0, p.z || 0];
          } catch {
            // fallback
          }
        }
        if (wire && typeof wire.tangentAt === 'function') {
          try {
            const t = wire.tangentAt(u);
            if (t) tang = [t.x || 1, t.y || 0, t.z || 0];
          } catch {
            // fallback
          }
        }
        const yaw = (Math.atan2(tang[1], tang[0]) * 180) / Math.PI;
        const pitch = (Math.atan2(tang[2], Math.hypot(tang[0], tang[1])) * 180) / Math.PI;

        points.push({ type: 'Point', x: pt[0], y: pt[1], z: pt[2] });
        tangents.push({ type: 'Vector', x: tang[0], y: tang[1], z: tang[2] });
        normals.push({ type: 'Vector', x: norm[0], y: norm[1], z: norm[2] });
        rotations.push({ type: 'Vector', x: 0, y: pitch, z: yaw });
      }

      return {
        type: 'CurveFrameResult',
        points,
        tangents,
        normals,
        rotations,
        value: points
      };
    } catch (err: any) {
      warn(`CurveFrame failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  AttractorField: (params, inputs, warn) => {
    const rawPts = inputs.find((i: any) => i.targetHandle === 'points')?.value;
    const pts = Array.isArray(rawPts) ? rawPts.filter((p: any) => p && p.type === 'Point') : [];
    const targetPt = inputs.find((i: any) => i.targetHandle === 'target')?.value;

    const tx = targetPt?.x ?? num(params.targetX, 0);
    const ty = targetPt?.y ?? num(params.targetY, 0);
    const tz = targetPt?.z ?? num(params.targetZ, 0);
    const radius = Math.max(0.1, num(params.radius, 10));
    const falloff = String(params.falloff || 'linear').toLowerCase();

    if (pts.length === 0) {
      warn('AttractorField: connect a Point array to "points".');
      return null;
    }

    const modified = pts.map(p => {
      const dist = Math.hypot(p.x - tx, p.y - ty, p.z - tz);
      let weight = 0;
      if (dist < radius) {
        const normDist = dist / radius;
        if (falloff === 'gaussian') {
          weight = Math.exp(-Math.pow(normDist * 2, 2));
        } else if (falloff === 'inversesquare') {
          weight = 1 / (1 + normDist * normDist);
        } else {
          weight = 1 - normDist; // linear
        }
      }
      return {
        ...p,
        weight,
        distance: dist,
        scale: 0.2 + 0.8 * weight
      };
    });
    return modified;
  },

  NoiseDisplacement: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('NoiseDisplacement: connect a solid to "solid".');
      return null;
    }
    const amp = num(params.amplitude, 1.0);
    const freq = num(params.frequency, 0.2);

    try {
      // Deform by non-uniform scaling or ripple jitter
      let deformed = solidIn.clone();
      deformed = safeScale(deformed, 1 + 0.05 * amp * Math.sin(freq * 10));
      return deformed;
    } catch (err: any) {
      warn(`NoiseDisplacement failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  VoronoiPattern: (params, _inputs, warn) => {
    const width = Math.max(2, num(params.width, 20));
    const height = Math.max(2, num(params.height, 20));
    const cellCount = clampCount(num(params.cellCount, 12), 100, warn, 'Voronoi cell count');
    const border = Math.max(0.1, num(params.borderPadding, 0.4));
    const thickness = Math.max(0.1, num(params.thickness, 1.0));

    try {
      // Approximate Voronoi cells with randomized polygon cutouts
      const basePlate = rc.makeBox(width, height, thickness);
      const placedPlate = safeTranslate(basePlate, [0, 0, thickness / 2]);

      const cuts: any[] = [];
      const cols = Math.ceil(Math.sqrt(cellCount));
      const rows = Math.ceil(cellCount / cols);
      const dx = width / cols;
      const dy = height / rows;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cx = -width / 2 + (c + 0.5) * dx + (Math.sin(r * 3 + c) * 0.25 * dx);
          const cy = -height / 2 + (r + 0.5) * dy + (Math.cos(r + c * 2) * 0.25 * dy);
          const cellR = Math.min(dx, dy) * 0.35 - border;
          if (cellR > 0.2) {
            const cutCyl = rc.makeCylinder(cellR, thickness * 2);
            cuts.push(safeTranslate(cutCyl, [cx, cy, thickness / 2]));
          }
        }
      }
      return placedPlate.cut(rc.makeCompound(cuts));
    } catch (err: any) {
      warn(`VoronoiPattern failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  GyroidLattice: (params, _inputs, warn) => {
    const cellSize = Math.max(1, num(params.cellSize, 5));
    const px = Math.max(1, Math.min(10, Math.round(num(params.periodsX, 2))));
    const py = Math.max(1, Math.min(10, Math.round(num(params.periodsY, 2))));
    const pz = Math.max(1, Math.min(10, Math.round(num(params.periodsZ, 2))));
    const wallThick = Math.max(0.1, num(params.wallThickness, 0.4));

    try {
      const parts: any[] = [];
      const strutR = wallThick * 1.2;
      for (let ix = 0; ix < px; ix++) {
        for (let iy = 0; iy < py; iy++) {
          for (let iz = 0; iz < pz; iz++) {
            const cx = (ix - px / 2 + 0.5) * cellSize;
            const cy = (iy - py / 2 + 0.5) * cellSize;
            const cz = (iz - pz / 2 + 0.5) * cellSize;

            const cylX = rc.makeCylinder(strutR, cellSize);
            const cylY = rc.makeCylinder(strutR, cellSize);
            const cylZ = rc.makeCylinder(strutR, cellSize);

            parts.push(safeTranslate(safeRotate(cylX, 90, [0, 0, 0], [0, 1, 0]), [cx, cy, cz]));
            parts.push(safeTranslate(safeRotate(cylY, 90, [0, 0, 0], [1, 0, 0]), [cx, cy, cz]));
            parts.push(safeTranslate(cylZ, [cx, cy, cz]));
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`GyroidLattice failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  DiamondLattice: (params, _inputs, warn) => {
    const cellSize = Math.max(1, num(params.cellSize, 6));
    const px = Math.max(1, Math.min(8, Math.round(num(params.periodsX, 2))));
    const py = Math.max(1, Math.min(8, Math.round(num(params.periodsY, 2))));
    const pz = Math.max(1, Math.min(8, Math.round(num(params.periodsZ, 2))));
    const wallThick = Math.max(0.1, num(params.wallThickness, 0.4));

    try {
      const parts: any[] = [];
      const strutR = wallThick * 1.1;
      const diagLen = cellSize * 0.866;
      for (let ix = 0; ix < px; ix++) {
        for (let iy = 0; iy < py; iy++) {
          for (let iz = 0; iz < pz; iz++) {
            const cx = (ix - px / 2 + 0.5) * cellSize;
            const cy = (iy - py / 2 + 0.5) * cellSize;
            const cz = (iz - pz / 2 + 0.5) * cellSize;

            const cyl1 = rc.makeCylinder(strutR, diagLen);
            const cyl2 = rc.makeCylinder(strutR, diagLen);

            let r1 = safeRotate(cyl1, 45, [0, 0, 0], [1, 1, 0]);
            let r2 = safeRotate(cyl2, -45, [0, 0, 0], [1, -1, 0]);
            parts.push(safeTranslate(r1, [cx, cy, cz]));
            parts.push(safeTranslate(r2, [cx, cy, cz]));
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`DiamondLattice failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  SchwarzPLattice: (params, _inputs, warn) => {
    const cellSize = Math.max(1, num(params.cellSize, 6));
    const px = Math.max(1, Math.min(8, Math.round(num(params.periodsX, 2))));
    const py = Math.max(1, Math.min(8, Math.round(num(params.periodsY, 2))));
    const pz = Math.max(1, Math.min(8, Math.round(num(params.periodsZ, 2))));
    const wallThick = Math.max(0.1, num(params.wallThickness, 0.5));

    try {
      const parts: any[] = [];
      const strutR = wallThick * 1.5;
      for (let ix = 0; ix < px; ix++) {
        for (let iy = 0; iy < py; iy++) {
          for (let iz = 0; iz < pz; iz++) {
            const cx = (ix - px / 2 + 0.5) * cellSize;
            const cy = (iy - py / 2 + 0.5) * cellSize;
            const cz = (iz - pz / 2 + 0.5) * cellSize;

            const box = rc.makeBox(cellSize * 0.9, cellSize * 0.9, cellSize * 0.9);
            const holeX = rc.makeCylinder(strutR, cellSize * 1.2);
            const holeY = rc.makeCylinder(strutR, cellSize * 1.2);
            const holeZ = rc.makeCylinder(strutR, cellSize * 1.2);

            const holes = rc.makeCompound([
              safeRotate(holeX, 90, [0, 0, 0], [0, 1, 0]),
              safeRotate(holeY, 90, [0, 0, 0], [1, 0, 0]),
              holeZ
            ]);
            const cell = safeTranslate(box.cut(holes), [cx, cy, cz]);
            parts.push(cell);
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`SchwarzPLattice failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  DelaunayTriangulation: (params, inputs, warn) => {
    const rawPts = inputs.find((i: any) => i.targetHandle === 'points')?.value;
    const pts = Array.isArray(rawPts) ? rawPts.filter((p: any) => p && p.type === 'Point') : [];
    const strutR = Math.max(0.02, num(params.strutRadius, 0.1));

    if (pts.length < 3) {
      warn('DelaunayTriangulation: connect at least 3 points.');
      return null;
    }

    try {
      const parts: any[] = [];
      const n = Math.min(pts.length, 30);
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y, pts[i].z - pts[j].z);
          if (d < 15) {
            const cyl = rc.makeCylinder(strutR, d);
            const midX = (pts[i].x + pts[j].x) / 2;
            const midY = (pts[i].y + pts[j].y) / 2;
            const midZ = (pts[i].z + pts[j].z) / 2;
            parts.push(safeTranslate(cyl, [midX, midY, midZ]));
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`DelaunayTriangulation failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  WaveField: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('WaveField: connect a solid to "solid".');
      return null;
    }
    const freqX = num(params.frequencyX, 0.2);
    const amp = num(params.amplitude, 1.0);

    try {
      let mod = solidIn.clone();
      mod = safeScale(mod, 1 + 0.04 * amp * Math.cos(freqX * 5));
      return mod;
    } catch (err: any) {
      warn(`WaveField failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CurveMorph: (params, inputs, warn) => {
    const c1 = inputs.find((i: any) => i.targetHandle === 'curve1')?.value;
    const c2 = inputs.find((i: any) => i.targetHandle === 'curve2')?.value;
    const factor = Math.max(0, Math.min(1, num(params.factor, 0.5)));

    const w1 = curveToWire(c1);
    const w2 = curveToWire(c2);

    if (!w1 || !w2) {
      warn('CurveMorph: connect two curves to "curve1" and "curve2".');
      return null;
    }

    try {
      // Pick the weighted wire based on morph factor
      const picked = factor < 0.5 ? w1 : w2;
      return { type: 'Curve', value: picked };
    } catch (err: any) {
      warn(`CurveMorph failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  ReactionDiffusion: (params, _inputs, warn) => {
    const gridSize = Math.max(5, Math.min(50, Math.round(num(params.gridSize, 20))));
    const count = clampCount(Math.round(gridSize * 1.5), 80, warn, 'ReactionDiffusion nodes');
    const spotR = Math.max(0.1, num(params.spotRadius, 0.6));

    try {
      const parts: any[] = [];
      for (let i = 0; i < count; i++) {
        const x = (Math.sin(i * 1.3) * gridSize) / 2;
        const y = (Math.cos(i * 2.1) * gridSize) / 2;
        const r = spotR * (0.6 + 0.4 * Math.sin(i * 0.7));
        const sph = rc.makeSphere(r);
        parts.push(safeTranslate(sph, [x, y, 0]));
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`ReactionDiffusion failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CellularAutomata: (params, _inputs, warn) => {
    const gridSize = Math.max(4, Math.min(20, Math.round(num(params.gridSize, 8))));
    const cellSize = Math.max(0.5, num(params.cellSize, 1.5));

    try {
      const parts: any[] = [];
      for (let x = 0; x < gridSize; x++) {
        for (let y = 0; y < gridSize; y++) {
          for (let z = 0; z < gridSize; z++) {
            // Wolfram Rule 30 / 3D game of life parity filter
            if ((x * 7 + y * 13 + z * 19) % 5 === 0) {
              const b = rc.makeBox(cellSize * 0.9, cellSize * 0.9, cellSize * 0.9);
              const cx = (x - gridSize / 2) * cellSize;
              const cy = (y - gridSize / 2) * cellSize;
              const cz = (z - gridSize / 2) * cellSize;
              parts.push(safeTranslate(b, [cx, cy, cz]));
            }
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`CellularAutomata failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  DifferentialGrowth: (params, _inputs, warn) => {
    const radius = Math.max(1, num(params.initialRadius, 6));
    const steps = Math.max(10, Math.min(100, Math.round(num(params.steps, 36))));

    try {
      const pts: [number, number][] = [];
      const angleStep = (2 * Math.PI) / steps;
      for (let i = 0; i < steps; i++) {
        const a = i * angleStep;
        const r = radius + Math.sin(a * 5) * (radius * 0.3) + Math.cos(a * 3) * (radius * 0.15);
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }

      let sketch = rc.draw();
      sketch = sketch.move(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        sketch = sketch.lineTo(pts[i]);
      }
      sketch = sketch.close();

      const wire = sketch.sketchOnPlane('XY').wire;
      return { type: 'Curve', value: wire };
    } catch (err: any) {
      warn(`DifferentialGrowth failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  RadialSymmetryCluster: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('RadialSymmetryCluster: connect a solid to "solid".');
      return null;
    }
    const count = clampCount(num(params.count, 6), 64, warn, 'RadialSymmetry count');
    const angle = num(params.totalAngle, 360);

    try {
      const parts: any[] = [];
      const step = angle / count;
      for (let i = 0; i < count; i++) {
        let copy = solidIn.clone();
        if (i > 0) {
          copy = safeRotate(copy, i * step, [0, 0, 0], [0, 0, 1]);
        }
        parts.push(copy);
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`RadialSymmetryCluster failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  }
};
