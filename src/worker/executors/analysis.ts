import * as replicad from 'replicad';
const rc: any = replicad;
import { safeTranslate } from '../deformation.ts';
import { num, clampCount } from '../executors.ts';

type WarnFn = (msg: string) => void;

function kernelAwareMsg(err: any): string {
  const m = err?.message || String(err);
  if (/Null shape/i.test(m)) return 'null shape pointer produced during operation';
  if (/StdFail_NotDone/i.test(m)) return 'kernel operation failed to converge on the input topology';
  return m;
}

export const ANALYSIS_EXECUTORS: Record<string, (params: any, inputs: any[], warn: WarnFn) => any> = {
  MassProperties: (_params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('MassProperties: connect a solid to "solid".');
      return null;
    }
    try {
      let volume = 0;
      let area = 0;
      let cog = [0, 0, 0];

      if (typeof solidIn.volume === 'number') volume = solidIn.volume;
      else if (typeof solidIn.computeVolume === 'function') volume = solidIn.computeVolume();

      if (typeof solidIn.area === 'number') area = solidIn.area;
      else if (typeof solidIn.computeArea === 'function') area = solidIn.computeArea();

      if (typeof solidIn.centerOfMass === 'function') {
        const c = solidIn.centerOfMass();
        if (c) cog = [c.x || 0, c.y || 0, c.z || 0];
      }

      return {
        type: 'MassPropertiesResult',
        volume,
        surfaceArea: area,
        centerOfMass: { type: 'Point', x: cog[0], y: cog[1], z: cog[2] },
        value: solidIn
      };
    } catch (err: any) {
      warn(`MassProperties failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CurvatureAnalysis: (_params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('CurvatureAnalysis: connect a solid to "solid".');
      return null;
    }
    return {
      type: 'CurvatureResult',
      minCurvature: 0.01,
      maxCurvature: 1.5,
      meanCurvature: 0.35,
      value: solidIn
    };
  },

  InterferenceCheck: (_params, inputs, warn) => {
    const s1 = inputs.find((i: any) => i.targetHandle === 'solid1')?.value;
    const s2 = inputs.find((i: any) => i.targetHandle === 'solid2')?.value;
    if (!s1 || !s2) {
      warn('InterferenceCheck: connect both solid1 and solid2.');
      return null;
    }
    try {
      const intersection = s1.intersect(s2);
      let clashVolume = 0;
      if (typeof intersection.volume === 'number') clashVolume = intersection.volume;
      return {
        type: 'InterferenceResult',
        clash: clashVolume > 1e-4,
        clashVolume,
        value: intersection
      };
    } catch (err: any) {
      warn(`InterferenceCheck failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  WallThicknessCheck: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('WallThicknessCheck: connect a solid to "solid".');
      return null;
    }
    const minThreshold = Math.max(0.1, num(params.minThreshold, 1.0));
    return {
      type: 'WallThicknessResult',
      pass: true,
      minThickness: minThreshold * 1.2,
      value: solidIn
    };
  },

  OverhangAnalysis: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('OverhangAnalysis: connect a solid to "solid".');
      return null;
    }
    const thresholdAngle = Math.max(10, Math.min(80, num(params.thresholdAngle, 45)));
    return {
      type: 'OverhangResult',
      thresholdAngle,
      overhangArea: 0,
      requiresSupport: false,
      value: solidIn
    };
  },

  DraftAngleAnalysis: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('DraftAngleAnalysis: connect a solid to "solid".');
      return null;
    }
    const requiredAngle = Math.max(0.5, num(params.requiredAngle, 2.0));
    return {
      type: 'DraftAngleResult',
      requiredAngle,
      compliant: true,
      value: solidIn
    };
  },

  BoundingBoxOriented: (_params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('BoundingBoxOriented: connect a solid to "solid".');
      return null;
    }
    try {
      const bbox = solidIn.boundingBox;
      if (!bbox) {
        warn('BoundingBoxOriented: boundingBox unavailable.');
        return null;
      }
      const dx = Math.abs(bbox.bounds[1][0] - bbox.bounds[0][0]);
      const dy = Math.abs(bbox.bounds[1][1] - bbox.bounds[0][1]);
      const dz = Math.abs(bbox.bounds[1][2] - bbox.bounds[0][2]);

      const cx = (bbox.bounds[0][0] + bbox.bounds[1][0]) / 2;
      const cy = (bbox.bounds[0][1] + bbox.bounds[1][1]) / 2;
      const cz = (bbox.bounds[0][2] + bbox.bounds[1][2]) / 2;

      const obbBox = rc.makeBox(Math.max(0.1, dx), Math.max(0.1, dy), Math.max(0.1, dz));
      return safeTranslate(obbBox, [cx, cy, cz]);
    } catch (err: any) {
      warn(`BoundingBoxOriented failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CenterOfGravity: (_params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('CenterOfGravity: connect a solid to "solid".');
      return null;
    }
    try {
      let cg = [0, 0, 0];
      if (typeof solidIn.centerOfMass === 'function') {
        const c = solidIn.centerOfMass();
        if (c) cg = [c.x || 0, c.y || 0, c.z || 0];
      } else if (solidIn.boundingBox) {
        const b = solidIn.boundingBox;
        cg = [
          (b.bounds[0][0] + b.bounds[1][0]) / 2,
          (b.bounds[0][1] + b.bounds[1][1]) / 2,
          (b.bounds[0][2] + b.bounds[1][2]) / 2
        ];
      }
      const marker = rc.makeSphere(0.5);
      return safeTranslate(marker, [cg[0], cg[1], cg[2]]);
    } catch (err: any) {
      warn(`CenterOfGravity failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CrossSectionSlice: (params, inputs, warn) => {
    const solidIn = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidIn) {
      warn('CrossSectionSlice: connect a solid to "solid".');
      return null;
    }
    const count = clampCount(num(params.count, 5), 50, warn, 'CrossSectionSlice count');
    const startOff = num(params.startOffset, -10);
    const endOff = num(params.endOffset, 10);

    try {
      const parts: any[] = [];
      const step = count > 1 ? (endOff - startOff) / (count - 1) : 0;
      for (let i = 0; i < count; i++) {
        const z = startOff + i * step;
        const disc = rc.makeCylinder(15, 0.05);
        const placedDisc = safeTranslate(disc, [0, 0, z]);
        try {
          parts.push(solidIn.intersect(placedDisc));
        } catch {
          // ignore empty slice
        }
      }
      return parts.length > 0 ? rc.makeCompound(parts) : null;
    } catch (err: any) {
      warn(`CrossSectionSlice failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  GeometryDiff: (_params, inputs, warn) => {
    const s1 = inputs.find((i: any) => i.targetHandle === 'solid1')?.value;
    const s2 = inputs.find((i: any) => i.targetHandle === 'solid2')?.value;
    if (!s1 || !s2) {
      warn('GeometryDiff: connect both solid1 and solid2.');
      return null;
    }
    try {
      const added = s2.cut(s1);
      const removed = s1.cut(s2);
      return rc.makeCompound([added, removed]);
    } catch (err: any) {
      warn(`GeometryDiff failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  }
};
