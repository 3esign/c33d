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

export const ENGINEERING_EXECUTORS: Record<string, (params: any, inputs: any[], warn: WarnFn) => any> = {
  InvoluteGear: (params, _inputs, warn) => {
    const teeth = Math.max(6, Math.min(100, Math.round(num(params.teeth, 20))));
    const module = Math.max(0.1, num(params.module, 1.0));
    const faceWidth = Math.max(0.5, num(params.faceWidth, 5.0));
    const bore = Math.max(0, num(params.boreDiameter, 4.0));

    const pitchDiameter = teeth * module;
    const pitchRadius = pitchDiameter / 2;
    const addendum = module;
    const dedendum = 1.25 * module;
    const outerRadius = pitchRadius + addendum;
    const rootRadius = Math.max(0.2, pitchRadius - dedendum);

    try {
      const pts: [number, number][] = [];
      const anglePerTooth = (2 * Math.PI) / teeth;
      for (let t = 0; t < teeth; t++) {
        const baseA = t * anglePerTooth;
        const halfTooth = anglePerTooth * 0.25;

        const a1 = baseA - anglePerTooth * 0.45;
        const a2 = baseA - halfTooth;
        const a3 = baseA - halfTooth * 0.4;
        const a4 = baseA + halfTooth * 0.4;
        const a5 = baseA + halfTooth;
        const a6 = baseA + anglePerTooth * 0.45;

        pts.push([rootRadius * Math.cos(a1), rootRadius * Math.sin(a1)]);
        pts.push([pitchRadius * Math.cos(a2), pitchRadius * Math.sin(a2)]);
        pts.push([outerRadius * Math.cos(a3), outerRadius * Math.sin(a3)]);
        pts.push([outerRadius * Math.cos(a4), outerRadius * Math.sin(a4)]);
        pts.push([pitchRadius * Math.cos(a5), pitchRadius * Math.sin(a5)]);
        pts.push([rootRadius * Math.cos(a6), rootRadius * Math.sin(a6)]);
      }

      let sketch = rc.draw();
      sketch = sketch.move(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        sketch = sketch.lineTo(pts[i]);
      }
      sketch = sketch.close();

      let solid = sketch.sketchOnPlane('XY').extrude(faceWidth);
      if (bore > 0.1) {
        const hole = rc.makeCylinder(bore / 2, faceWidth * 1.5);
        solid = solid.cut(safeTranslate(hole, [0, 0, faceWidth / 2]));
      }
      return solid;
    } catch (err: any) {
      warn(`InvoluteGear failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  BevelGear: (params, _inputs, warn) => {
    const teeth = Math.max(8, Math.min(80, Math.round(num(params.teeth, 18))));
    const module = Math.max(0.1, num(params.module, 1.2));
    const faceWidth = Math.max(0.5, num(params.faceWidth, 4.0));
    const bore = Math.max(0, num(params.boreDiameter, 4.0));

    const pitchRadius = (teeth * module) / 2;

    try {
      const cone = rc.makeCone(pitchRadius * 1.1, pitchRadius * 0.5, faceWidth);
      let solid = cone;
      if (bore > 0.1) {
        const hole = rc.makeCylinder(bore / 2, faceWidth * 1.5);
        solid = solid.cut(safeTranslate(hole, [0, 0, faceWidth / 2]));
      }
      return solid;
    } catch (err: any) {
      warn(`BevelGear failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  RackAndPinion: (params, _inputs, warn) => {
    const length = Math.max(2, num(params.length, 30));
    const module = Math.max(0.1, num(params.module, 1.0));
    const height = Math.max(1, num(params.height, 8.0));
    const width = Math.max(0.5, num(params.width, 5.0));

    const pitch = Math.PI * module;
    const toothCount = clampCount(Math.floor(length / pitch), 150, warn, 'Rack teeth');

    try {
      const baseRack = rc.makeBox(length, width, height);
      const parts: any[] = [safeTranslate(baseRack, [0, 0, height / 2])];

      const startX = -length / 2 + pitch / 2;
      for (let i = 0; i < toothCount; i++) {
        const x = startX + i * pitch;
        const tooth = rc.makeBox(pitch * 0.5, width, module * 1.2);
        parts.push(safeTranslate(tooth, [x, 0, height + module * 0.6]));
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`RackAndPinion failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Sprocket: (params, _inputs, warn) => {
    const teeth = Math.max(8, Math.min(80, Math.round(num(params.teeth, 16))));
    const pitch = Math.max(0.5, num(params.pitch, 6.35));
    const rollerDia = Math.max(0.2, num(params.rollerDiameter, 3.3));
    const thickness = Math.max(0.2, num(params.thickness, 2.5));
    const bore = Math.max(0, num(params.boreDiameter, 5.0));

    const pitchRadius = (pitch / (2 * Math.sin(Math.PI / teeth)));
    const outerRadius = pitchRadius + rollerDia * 0.6;

    try {
      const disc = rc.makeCylinder(outerRadius, thickness);
      let solid = safeTranslate(disc, [0, 0, thickness / 2]);

      const cuts: any[] = [];
      for (let i = 0; i < teeth; i++) {
        const a = (i * 2 * Math.PI) / teeth;
        const rx = pitchRadius * Math.cos(a);
        const ry = pitchRadius * Math.sin(a);
        const roller = rc.makeCylinder(rollerDia / 2, thickness * 1.5);
        cuts.push(safeTranslate(roller, [rx, ry, thickness / 2]));
      }
      solid = solid.cut(rc.makeCompound(cuts));

      if (bore > 0.1) {
        const hole = rc.makeCylinder(bore / 2, thickness * 2);
        solid = solid.cut(safeTranslate(hole, [0, 0, thickness / 2]));
      }
      return solid;
    } catch (err: any) {
      warn(`Sprocket failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  TimingPulley: (params, _inputs, warn) => {
    const teeth = Math.max(10, Math.min(100, Math.round(num(params.teeth, 24))));
    const pitch = Math.max(0.5, num(params.pitch, 2.0)); // GT2 standard = 2mm
    const width = Math.max(1, num(params.width, 7.0));
    const bore = Math.max(0, num(params.boreDiameter, 5.0));
    const flangeH = Math.max(0, num(params.flangeHeight, 1.2));

    const pitchRadius = (teeth * pitch) / (2 * Math.PI);
    const outerRadius = pitchRadius - 0.254; // GT2 tooth subtract

    try {
      const body = rc.makeCylinder(outerRadius, width);
      let solid = safeTranslate(body, [0, 0, width / 2]);

      // Flanges
      if (flangeH > 0.1) {
        const flg1 = rc.makeCylinder(outerRadius + flangeH, 0.8);
        const flg2 = rc.makeCylinder(outerRadius + flangeH, 0.8);
        const flgComp = rc.makeCompound([
          safeTranslate(flg1, [0, 0, 0.4]),
          safeTranslate(flg2, [0, 0, width - 0.4])
        ]);
        solid = solid.fuse(flgComp);
      }

      if (bore > 0.1) {
        const hole = rc.makeCylinder(bore / 2, width * 1.5);
        solid = solid.cut(safeTranslate(hole, [0, 0, width / 2]));
      }
      return solid;
    } catch (err: any) {
      warn(`TimingPulley failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  HexNutBolt: (params, _inputs, warn) => {
    const d = Math.max(1, num(params.boltDiameter, 6.0)); // M6 = 6mm
    const length = Math.max(2, num(params.length, 25.0));
    const headHeight = d * 0.7;
    const hexAcrossFlats = d * 1.732;

    try {
      const parts: any[] = [];
      // Hex head
      const hexR = hexAcrossFlats / 1.732;
      const pts: [number, number][] = [];
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        pts.push([hexR * Math.cos(a), hexR * Math.sin(a)]);
      }
      let sk = rc.draw().move(pts[0]);
      for (let i = 1; i < 6; i++) sk = sk.lineTo(pts[i]);
      sk = sk.close();
      const head = sk.sketchOnPlane('XY').extrude(headHeight);
      parts.push(head);

      // Thread shank
      const shank = rc.makeCylinder(d / 2, length);
      parts.push(safeTranslate(shank, [0, 0, -length / 2]));

      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`HexNutBolt failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  SnapFitJoint: (params, _inputs, warn) => {
    const beamLength = Math.max(2, num(params.beamLength, 12));
    const beamWidth = Math.max(0.5, num(params.beamWidth, 4));
    const beamThickness = Math.max(0.2, num(params.beamThickness, 1.2));
    const hookDepth = Math.max(0.2, num(params.hookDepth, 1.0));

    try {
      const beam = rc.makeBox(beamWidth, beamLength, beamThickness);
      const placedBeam = safeTranslate(beam, [0, beamLength / 2, beamThickness / 2]);

      const hook = rc.makeBox(beamWidth, hookDepth * 1.5, beamThickness + hookDepth);
      const placedHook = safeTranslate(hook, [0, beamLength - hookDepth * 0.5, (beamThickness + hookDepth) / 2]);

      return placedBeam.fuse(placedHook);
    } catch (err: any) {
      warn(`SnapFitJoint failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  OringGroove: (params, _inputs, warn) => {
    const shaftDia = Math.max(2, num(params.shaftDiameter, 20));
    const width = Math.max(0.5, num(params.grooveWidth, 2.5));
    const depth = Math.max(0.2, num(params.grooveDepth, 1.5));
    const length = Math.max(width * 2, num(params.shaftLength, 20));

    try {
      const shaft = rc.makeCylinder(shaftDia / 2, length);
      const placedShaft = safeTranslate(shaft, [0, 0, length / 2]);

      // Annular groove cutter
      const cutter = rc.makeCylinder(shaftDia / 2 + 0.5, width);
      const innerBoss = rc.makeCylinder(shaftDia / 2 - depth, width * 1.2);
      const annularCutter = safeTranslate(cutter, [0, 0, length / 2]).cut(safeTranslate(innerBoss, [0, 0, length / 2]));

      return placedShaft.cut(annularCutter);
    } catch (err: any) {
      warn(`OringGroove failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  HeatSink: (params, _inputs, warn) => {
    const baseW = Math.max(2, num(params.baseWidth, 30));
    const baseL = Math.max(2, num(params.baseLength, 40));
    const baseThick = Math.max(0.5, num(params.baseThickness, 3));
    const fins = Math.max(2, Math.min(40, Math.round(num(params.finCount, 12))));
    const finH = Math.max(1, num(params.finHeight, 15));
    const finThick = Math.max(0.2, num(params.finThickness, 1.0));

    try {
      const parts: any[] = [];
      const base = rc.makeBox(baseW, baseL, baseThick);
      parts.push(safeTranslate(base, [0, 0, baseThick / 2]));

      const spacing = baseW / (fins + 1);
      const startX = -baseW / 2 + spacing;
      for (let i = 0; i < fins; i++) {
        const fin = rc.makeBox(finThick, baseL, finH);
        parts.push(safeTranslate(fin, [startX + i * spacing, 0, baseThick + finH / 2]));
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`HeatSink failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  FlangeConnection: (params, _inputs, warn) => {
    const pipeDia = Math.max(1, num(params.pipeDiameter, 15));
    const outerDia = Math.max(pipeDia + 2, num(params.outerDiameter, 30));
    const thick = Math.max(0.5, num(params.flangeThickness, 4));
    const boltCount = Math.max(3, Math.min(24, Math.round(num(params.boltCount, 6))));
    const boltHoleDia = Math.max(0.5, num(params.boltHoleDiameter, 3.5));
    const pcd = num(params.pcd, (pipeDia + outerDia) / 2);

    try {
      const disc = rc.makeCylinder(outerDia / 2, thick);
      let solid = safeTranslate(disc, [0, 0, thick / 2]);

      // Center pipe bore
      const centerHole = rc.makeCylinder(pipeDia / 2, thick * 2);
      solid = solid.cut(safeTranslate(centerHole, [0, 0, thick / 2]));

      // Bolt holes
      const holeCutters: any[] = [];
      const pcdRadius = pcd / 2;
      for (let i = 0; i < boltCount; i++) {
        const a = (i * 2 * Math.PI) / boltCount;
        const bx = pcdRadius * Math.cos(a);
        const by = pcdRadius * Math.sin(a);
        const hole = rc.makeCylinder(boltHoleDia / 2, thick * 2);
        holeCutters.push(safeTranslate(hole, [bx, by, thick / 2]));
      }
      return solid.cut(rc.makeCompound(holeCutters));
    } catch (err: any) {
      warn(`FlangeConnection failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  KeywayShaft: (params, _inputs, warn) => {
    const dia = Math.max(2, num(params.diameter, 16));
    const len = Math.max(4, num(params.length, 40));
    const kwW = Math.max(0.5, num(params.keywayWidth, 5));
    const kwDepth = Math.max(0.2, num(params.keywayDepth, 3));
    const kwLen = Math.max(1, num(params.keywayLength, 20));

    try {
      const shaft = rc.makeCylinder(dia / 2, len);
      const placedShaft = safeTranslate(shaft, [0, 0, len / 2]);

      const keySlot = rc.makeBox(kwW, kwDepth * 2, kwLen);
      const slotPlaced = safeTranslate(keySlot, [0, dia / 2, len / 2]);

      return placedShaft.cut(slotPlaced);
    } catch (err: any) {
      warn(`KeywayShaft failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  }
};
