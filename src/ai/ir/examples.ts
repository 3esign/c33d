// ---------------------------------------------------------------------------
// IR exemplars — used as few-shot context AND as compiler test fixtures.
//
// SOLAR_SYSTEM_IR is the exact task from the failure transcripts, expressed the
// way the user described it: sort the real data, remap it proportionally, build
// a skeleton of points, then generate everything from ONE sphere and ONE torus.
// 13 ops instead of the ~45 hand-wired nodes the model kept failing to emit.
// ---------------------------------------------------------------------------

import type { IrProgram } from './types';

export const SOLAR_SYSTEM_IR: IrProgram = {
  intent: 'Proportional solar system: one source sphere instanced per planet, one source torus instanced per orbit, all sizes remapped from real data; one slider controls overall size.',
  params: [{ name: 'systemRadius', value: 40, min: 10, max: 200 }],
  body: [
    // Real data, already sorted by orbital distance (AU / km).
    { let: 'orbitAU', op: 'list', args: { values: [0.39, 0.72, 1.0, 1.52, 5.2, 9.54, 19.19, 30.07] } },
    { let: 'sizeKm', op: 'list', args: { values: [4879, 12104, 12756, 6792, 142984, 120536, 51118, 49528] } },
    // Proportional remaps: orbits into 0.2R..R, planet radii into believable display sizes.
    { let: 'orbitR', op: 'remap', args: { values: '$orbitAU', inMin: 0.39, inMax: 30.07, outMin: 'systemRadius*0.2', outMax: 'systemRadius' } },
    { let: 'planetR', op: 'remap', args: { values: '$sizeKm', inMin: 4879, inMax: 142984, outMin: 'systemRadius*0.012', outMax: 'systemRadius*0.055' } },
    // Skeleton: planet angles spread around, positions derived per element.
    { let: 'angles', op: 'series', args: { start: 0, step: 2.4, count: 8 } },
    { let: 'px', op: 'expr', args: { formula: 'a*cos(b)', a: '$orbitR', b: '$angles' } },
    { let: 'py', op: 'expr', args: { formula: 'a*sin(b)', a: '$orbitR', b: '$angles' } },
    { let: 'pz', op: 'expr', args: { formula: 'a*0.04', a: '$orbitR' } },
    { let: 'planetPts', op: 'points', args: { x: '$px', y: '$py', z: '$pz', scale: '$planetR' } },
    // Orbit rings: unit torus instanced at the center, scaled per orbit radius —
    // tube thickness stays proportional automatically (uniform scaling).
    { let: 'ringPts', op: 'points', args: { z: '$pz', scale: '$orbitR' } },
    { let: 'unitRing', op: 'ring', args: { radius: 1, thickness: 0.015 } },
    { let: 'orbits', op: 'instances', args: { shape: '$unitRing', points: '$ringPts' } },
    // One source sphere for every planet; per-point scale channel sizes each one.
    { let: 'unitBall', op: 'sphere', args: { radius: 1 } },
    { let: 'planets', op: 'instances', args: { shape: '$unitBall', points: '$planetPts' } },
    { let: 'sun', op: 'sphere', args: { radius: 'systemRadius*0.09' } },
  ],
  emit: [
    { ref: '$planets', color: '#f59e0b' },
    { ref: '$orbits', color: '#3b82f6' },
    { ref: '$sun', color: '#fbbf24' },
  ],
};

// "Only one sphere node": planets are big instances of the unit sphere, orbits
// are rings of TINY instances of the SAME unit sphere (dotted orbits). The
// on_circle skill builds the radius×angle cross product (repeat_each + tile)
// and carries per-circle z/scale/group channels.
export const SOLAR_DOTS_IR: IrProgram = {
  intent: 'Solar system from a single source sphere: proportional planets plus dotted orbit rings made of tiny spheres on circles.',
  params: [{ name: 'systemRadius', value: 40, min: 10, max: 200 }],
  body: [
    { let: 'orbitAU', op: 'list', args: { values: [0.39, 0.72, 1.0, 1.52, 5.2, 9.54, 19.19, 30.07] } },
    { let: 'sizeKm', op: 'list', args: { values: [4879, 12104, 12756, 6792, 142984, 120536, 51118, 49528] } },
    { let: 'orbitR', op: 'remap', args: { values: '$orbitAU', inMin: 0.39, inMax: 30.07, outMin: 'systemRadius*0.2', outMax: 'systemRadius' } },
    { let: 'planetR', op: 'remap', args: { values: '$sizeKm', inMin: 4879, inMax: 142984, outMin: 'systemRadius*0.012', outMax: 'systemRadius*0.055' } },
    { let: 'angles', op: 'series', args: { start: 0, step: 2.4, count: 8 } },
    { let: 'px', op: 'expr', args: { formula: 'a*cos(b)', a: '$orbitR', b: '$angles' } },
    { let: 'py', op: 'expr', args: { formula: 'a*sin(b)', a: '$orbitR', b: '$angles' } },
    { let: 'planetPts', op: 'points', args: { x: '$px', y: '$py', scale: '$planetR' } },
    // Dot size proportional to each orbit's radius (a per-circle list).
    { let: 'dotR', op: 'expr', args: { formula: 'a*0.012', a: '$orbitR' } },
    { let: 'orbitPts', op: 'on_circle', args: { radius: '$orbitR', count: 60, scale: '$dotR' } },
    { let: 'ball', op: 'sphere', args: { radius: 1 } },
    { let: 'planets', op: 'instances', args: { shape: '$ball', points: '$planetPts' } },
    { let: 'orbitDots', op: 'instances', args: { shape: '$ball', points: '$orbitPts', maxCount: 500 } },
    { let: 'sun', op: 'sphere', args: { radius: 'systemRadius*0.09' } },
  ],
  emit: [
    { ref: '$planets', color: '#f59e0b' },
    { ref: '$orbitDots', color: '#94a3b8' },
    { ref: '$sun', color: '#fbbf24' },
  ],
};

// The derivation chain "data → points → curves → volume at the very end":
// number lists build a wavy grid of points carrying a row group channel;
// spline(groupBy) interpolates ONE CURVE PER ROW; loft skins them — a curtain.
export const CURTAIN_IR: IrProgram = {
  intent: 'Wavy curtain: interpolate splines through rows of a point grid, then loft the splines into a surface.',
  params: [
    { name: 'width', value: 30, min: 5, max: 100 },
    { name: 'height', value: 20, min: 5, max: 100 },
    { name: 'waveDepth', value: 2, min: 0, max: 10 },
  ],
  body: [
    { let: 'uBase', op: 'series', args: { start: 0, step: 1, count: 12 } },
    { let: 'vBase', op: 'series', args: { start: 0, step: 1, count: 5 } },
    { let: 'u', op: 'tile', args: { values: '$uBase', count: 5 } },
    { let: 'v', op: 'repeat_each', args: { values: '$vBase', count: 12 } },
    { let: 'x', op: 'expr', args: { formula: 'a/11*width', a: '$u' } },
    { let: 'y', op: 'expr', args: { formula: 'sin(a*0.9 + b*0.7)*waveDepth', a: '$u', b: '$v' } },
    { let: 'z', op: 'expr', args: { formula: 'a/4*height', a: '$v' } },
    { let: 'gridPts', op: 'points', args: { x: '$x', y: '$y', z: '$z', group: '$v' } },
    { let: 'rails', op: 'spline', args: { points: '$gridPts', groupBy: 'group' } },
    { let: 'curtain', op: 'loft', args: { curve1: '$rails' } },
  ],
  emit: [{ ref: '$curtain', color: '#38bdf8' }],
};

// The other transcript task: circle divided into points, torus "pipe" on the
// circle, spheres with varied sizes instanced on the division points.
export const RING_OF_SPHERES_IR: IrProgram = {
  intent: 'Big circle divided into points; torus pipe along the circle; spheres with varied sizes on the points.',
  params: [
    { name: 'circleRadius', value: 10, min: 1, max: 50 },
    { name: 'sphereCount', value: 10, min: 3, max: 40, step: 1 },
  ],
  body: [
    { let: 'orbit', op: 'circle', args: { radius: 'circleRadius' } },
    { let: 'pts', op: 'divide', args: { curve: '$orbit', count: 'sphereCount' } },
    { let: 'tube', op: 'ring', args: { radius: 'circleRadius', thickness: 'circleRadius*0.04' } },
    { let: 'ball', op: 'sphere', args: { radius: 'circleRadius*0.12' } },
    { let: 'balls', op: 'instances', args: { shape: '$ball', points: '$pts', scaleStart: 0.5, scaleEnd: 1.5 } },
  ],
  emit: [
    { ref: '$tube', color: '#3b82f6' },
    { ref: '$balls', color: '#f59e0b' },
  ],
};
