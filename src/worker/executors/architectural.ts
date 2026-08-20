import * as replicad from 'replicad';
const rc: any = replicad;
import { safeTranslate, safeRotate } from '../deformation.ts';
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

export const ARCHITECTURAL_EXECUTORS: Record<string, (params: any, inputs: any[], warn: WarnFn) => any> = {
  MultiLoft: (params, inputs, warn) => {
    const rawCurves: any[] = [];
    const curvesInput = inputs.find((i: any) => i.targetHandle === 'curves')?.value;
    if (Array.isArray(curvesInput)) {
      rawCurves.push(...curvesInput);
    } else if (curvesInput) {
      rawCurves.push(curvesInput);
    }
    for (let k = 1; k <= 8; k++) {
      const c = inputs.find((i: any) => i.targetHandle === `curve${k}`)?.value;
      if (c) rawCurves.push(c);
    }

    const unwrapped: any[] = [];
    for (const item of rawCurves) {
      const w = curveToWire(item);
      if (Array.isArray(w)) unwrapped.push(...w);
      else if (w) unwrapped.push(w);
    }

    if (unwrapped.length < 2) {
      warn('MultiLoft: provide at least 2 input curves (via "curves" or "curve1", "curve2", ...).');
      return null;
    }

    const ruled = params.ruled === true || params.ruled === 'true';
    try {
      if (unwrapped[0] && typeof unwrapped[0].loftWith === 'function') {
        return unwrapped[0].loftWith(unwrapped.slice(1).length === 1 ? unwrapped[1] : unwrapped.slice(1), { ruled, closed });
      }
      if (typeof (rc as any).loft === 'function') {
        return (rc as any).loft(unwrapped, { ruled, closed });
      }
      return null;
    } catch (err: any) {
      console.warn('MultiLoft failed:', err);
      warn(`MultiLoft failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  CurveOffset: (params, inputs, warn) => {
    const curveIn = inputs.find((i: any) => i.targetHandle === 'curve')?.value;
    if (!curveIn || curveIn.type !== 'Curve') {
      warn('CurveOffset: connect a Curve to "curve".');
      return null;
    }
    const distance = num(params.distance, 1.0);
    try {
      const wVal = curveToWire(curveIn);
      if (!wVal) {
        warn('CurveOffset: the curve produced no valid wire.');
        return null;
      }
      const wires = Array.isArray(wVal) ? wVal : [wVal];
      const offsetted = wires.map(w => {
        if (w && typeof w.offset === 'function') return w.offset(distance);
        if (w && typeof w.offset2D === 'function') return w.offset2D(distance);
        return null;
      }).filter(Boolean);
      if (offsetted.length === 0) {
        warn('CurveOffset: wire does not support 2D offset.');
        return null;
      }
      return { type: 'Curve', value: offsetted.length === 1 ? offsetted[0] : offsetted };
    } catch (err: any) {
      warn(`CurveOffset failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  RegularPolygon: (params, _inputs, warn) => {
    const sides = Math.max(3, Math.min(32, Math.round(num(params.sides, 6))));
    const radius = Math.max(0.1, num(params.radius, 10));
    const starRatio = Math.max(0.1, Math.min(1.0, num(params.starRatio, 1.0)));
    const fillet = Math.max(0, num(params.filletRadius, 0));

    try {
      const pts: [number, number][] = [];
      const totalPoints = starRatio < 0.999 ? sides * 2 : sides;
      const angleStep = (2 * Math.PI) / totalPoints;
      for (let i = 0; i < totalPoints; i++) {
        const a = i * angleStep - Math.PI / 2;
        const r = (starRatio < 0.999 && i % 2 === 1) ? radius * starRatio : radius;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }

      let sketch = rc.draw();
      sketch = sketch.move(pts[0]);
      for (let i = 1; i < pts.length; i++) {
        sketch = sketch.lineTo(pts[i]);
      }
      sketch = sketch.close();

      if (fillet > 0.001) {
        try {
          sketch = sketch.fillet(fillet);
        } catch {
          // ignore overly large fillet gracefully
        }
      }
      const wire = sketch.sketchOnPlane('XY').wire;
      return { type: 'Curve', value: wire };
    } catch (err: any) {
      warn(`RegularPolygon failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  FloorGrid: (params, _inputs, warn) => {
    const width = Math.max(1, num(params.width, 30));
    const length = Math.max(1, num(params.length, 40));
    const floors = Math.max(1, Math.min(50, Math.round(num(params.floors, 4))));
    const floorHeight = Math.max(1, num(params.floorHeight, 4));
    const slabThickness = Math.max(0.1, num(params.slabThickness, 0.4));
    const colRadius = Math.max(0.05, num(params.columnRadius, 0.35));
    const colSpacing = Math.max(2, num(params.columnSpacing, 8));

    try {
      const parts: any[] = [];
      // Slabs
      for (let f = 0; f <= floors; f++) {
        const slab = rc.makeBox(width, length, slabThickness);
        const placed = safeTranslate(slab, [0, 0, f * floorHeight - slabThickness / 2]);
        parts.push(placed);
      }
      // Structural columns
      const nx = Math.floor(width / colSpacing);
      const ny = Math.floor(length / colSpacing);
      const startX = -((nx * colSpacing) / 2);
      const startY = -((ny * colSpacing) / 2);

      const totalH = floors * floorHeight;
      for (let ix = 0; ix <= nx; ix++) {
        for (let iy = 0; iy <= ny; iy++) {
          const col = rc.makeCylinder(colRadius, totalH);
          const colPlaced = safeTranslate(col, [startX + ix * colSpacing, startY + iy * colSpacing, totalH / 2]);
          parts.push(colPlaced);
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`FloorGrid failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  FacadeDivider: (params, _inputs, warn) => {
    const width = Math.max(1, num(params.width, 20));
    const height = Math.max(1, num(params.height, 12));
    const uPanels = Math.max(1, Math.min(30, Math.round(num(params.uPanels, 5))));
    const vPanels = Math.max(1, Math.min(30, Math.round(num(params.vPanels, 3))));
    const frameThick = Math.max(0.05, num(params.frameThickness, 0.2));
    const glassDepth = Math.max(0.02, num(params.glassDepth, 0.05));
    const mullionW = Math.max(0.05, num(params.mullionWidth, 0.15));

    try {
      const parts: any[] = [];
      // Outer perimeter frame
      const frame = rc.makeBox(width, frameThick, height);
      parts.push(frame);

      // Glass panels inside
      const cellW = (width - mullionW * (uPanels + 1)) / uPanels;
      const cellH = (height - mullionW * (vPanels + 1)) / vPanels;

      for (let u = 0; u < uPanels; u++) {
        for (let v = 0; v < vPanels; v++) {
          if (cellW > 0.1 && cellH > 0.1) {
            const glass = rc.makeBox(cellW, glassDepth, cellH);
            const cx = -width / 2 + mullionW + u * (cellW + mullionW) + cellW / 2;
            const cz = -height / 2 + mullionW + v * (cellH + mullionW) + cellH / 2;
            parts.push(safeTranslate(glass, [cx, 0, cz]));
          }
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`FacadeDivider failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Stairs: (params, _inputs, warn) => {
    const type = String(params.type || 'straight').toLowerCase();
    const steps = Math.max(1, Math.min(100, Math.round(num(params.steps, 14))));
    const width = Math.max(0.5, num(params.width, 1.2));
    const totalHeight = Math.max(0.5, num(params.totalHeight, 2.8));
    const treadDepth = Math.max(0.1, num(params.treadDepth, 0.28));
    const innerRadius = Math.max(0.2, num(params.innerRadius, 0.6));

    const stepH = totalHeight / steps;
    try {
      const parts: any[] = [];
      if (type === 'spiral' || type === 'helical') {
        const totalAngle = Math.min(720, steps * 22.5);
        const angleStep = totalAngle / steps;
        // Central column
        const pole = rc.makeCylinder(innerRadius * 0.7, totalHeight + 0.2);
        parts.push(safeTranslate(pole, [0, 0, (totalHeight + 0.2) / 2]));

        for (let i = 0; i < steps; i++) {
          const tread = rc.makeBox(width, treadDepth, stepH * 0.9);
          let placed = safeTranslate(tread, [innerRadius + width / 2, 0, i * stepH + stepH / 2]);
          placed = safeRotate(placed, i * angleStep, [0, 0, 0], [0, 0, 1]);
          parts.push(placed);
        }
      } else {
        // Straight run
        for (let i = 0; i < steps; i++) {
          const tread = rc.makeBox(width, treadDepth, stepH);
          const placed = safeTranslate(tread, [0, i * treadDepth, i * stepH + stepH / 2]);
          parts.push(placed);
        }
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`Stairs failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  RoofProfile: (params, _inputs, warn) => {
    const type = String(params.type || 'gable').toLowerCase();
    const width = Math.max(1, num(params.width, 12));
    const length = Math.max(1, num(params.length, 16));
    const pitchAngle = Math.max(5, Math.min(80, num(params.pitchAngle, 30)));
    const thickness = Math.max(0.1, num(params.thickness, 0.3));

    const rad = (pitchAngle * Math.PI) / 180;
    const roofH = (width / 2) * Math.tan(rad);

    try {
      let sketch = rc.draw();
      if (type === 'shed') {
        sketch = sketch.move([0, 0])
          .lineTo([width, roofH])
          .lineTo([width, roofH + thickness])
          .lineTo([0, thickness])
          .close();
      } else if (type === 'mansard') {
        const midW = width * 0.35;
        const lowH = roofH * 0.75;
        sketch = sketch.move([-width / 2, 0])
          .lineTo([-midW, lowH])
          .lineTo([0, roofH])
          .lineTo([midW, lowH])
          .lineTo([width / 2, 0])
          .lineTo([width / 2, thickness])
          .lineTo([midW, lowH + thickness])
          .lineTo([0, roofH + thickness])
          .lineTo([-midW, lowH + thickness])
          .lineTo([-width / 2, thickness])
          .close();
      } else {
        // Default Gable
        sketch = sketch.move([-width / 2, 0])
          .lineTo([0, roofH])
          .lineTo([width / 2, 0])
          .lineTo([width / 2, thickness])
          .lineTo([0, roofH + thickness])
          .lineTo([-width / 2, thickness])
          .close();
      }
      const extruded = sketch.sketchOnPlane('XZ').extrude(length);
      return safeTranslate(extruded, [0, -length / 2, 0]);
    } catch (err: any) {
      warn(`RoofProfile failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Arch: (params, _inputs, warn) => {
    const type = String(params.type || 'roman').toLowerCase();
    const span = Math.max(0.5, num(params.span, 4));
    const height = Math.max(0.5, num(params.height, 5));
    const depth = Math.max(0.1, num(params.depth, 1.2));
    const wallThick = Math.max(0.1, num(params.wallThickness, 0.4));

    try {
      const halfSpan = span / 2;
      const springH = Math.max(0.2, height - halfSpan);

      // Construct outer block and subtract opening
      const outerW = span + wallThick * 2;
      const outerH = height + wallThick;
      const outer = rc.makeBox(outerW, depth, outerH);

      let openSketch = rc.draw();
      if (type === 'gothic') {
        openSketch = openSketch.move([-halfSpan, 0])
          .lineTo([-halfSpan, springH])
          .threePointsArcTo([0, height], [ -halfSpan * 0.3, springH + (height - springH) * 0.7 ])
          .threePointsArcTo([halfSpan, springH], [ halfSpan * 0.3, springH + (height - springH) * 0.7 ])
          .lineTo([halfSpan, 0])
          .close();
      } else {
        // Roman round arch
        openSketch = openSketch.move([-halfSpan, 0])
          .lineTo([-halfSpan, springH])
          .threePointsArcTo([halfSpan, springH], [0, springH + halfSpan])
          .lineTo([halfSpan, 0])
          .close();
      }
      const cutter = openSketch.sketchOnPlane('XZ').extrude(depth * 1.5);
      const shiftedCutter = safeTranslate(cutter, [0, -depth * 0.75, 0]);
      const archSolid = safeTranslate(outer, [0, 0, outerH / 2]);
      return archSolid.cut(shiftedCutter);
    } catch (err: any) {
      warn(`Arch failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Column: (params, _inputs, warn) => {
    const height = Math.max(1, num(params.height, 8));
    const baseR = Math.max(0.1, num(params.baseRadius, 0.6));
    const topR = Math.max(0.1, num(params.topRadius, 0.48));
    const flutes = Math.max(0, Math.min(32, Math.round(num(params.fluteCount, 16))));
    const baseH = Math.max(0.1, num(params.baseHeight, 0.8));
    const capH = Math.max(0.1, num(params.capitalHeight, 0.8));

    try {
      const parts: any[] = [];
      // Base pedestal
      const basePed = rc.makeBox(baseR * 2.6, baseR * 2.6, baseH);
      parts.push(safeTranslate(basePed, [0, 0, baseH / 2]));

      // Tapered shaft
      const shaftH = Math.max(0.5, height - baseH - capH);
      const shaft = rc.makeCone(baseR, topR, shaftH);
      let placedShaft = safeTranslate(shaft, [0, 0, baseH + shaftH / 2]);

      // Fluting cuts if requested
      if (flutes >= 4) {
        const fluteR = (2 * Math.PI * baseR) / (flutes * 3);
        const fluteCuts: any[] = [];
        for (let i = 0; i < flutes; i++) {
          const a = (i * 2 * Math.PI) / flutes;
          const fx = baseR * Math.cos(a);
          const fy = baseR * Math.sin(a);
          const cyl = rc.makeCylinder(fluteR, shaftH * 1.05);
          fluteCuts.push(safeTranslate(cyl, [fx, fy, baseH + shaftH / 2]));
        }
        try {
          placedShaft = placedShaft.cut(rc.makeCompound(fluteCuts));
        } catch {
          // ignore flute cut errors gracefully
        }
      }
      parts.push(placedShaft);

      // Capital
      const cap = rc.makeBox(topR * 2.4, topR * 2.4, capH);
      parts.push(safeTranslate(cap, [0, 0, height - capH / 2]));

      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`Column failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Truss: (params, _inputs, warn) => {
    const span = Math.max(2, num(params.span, 16));
    const height = Math.max(0.5, num(params.height, 2.5));
    const depth = Math.max(0.1, num(params.depth, 0.4));
    const panels = Math.max(2, Math.min(24, Math.round(num(params.panels, 6))));
    const barThick = Math.max(0.05, num(params.barThickness, 0.15));

    try {
      const parts: any[] = [];
      const panelW = span / panels;
      // Top and bottom chords
      const topChord = rc.makeBox(span, depth, barThick);
      parts.push(safeTranslate(topChord, [0, 0, height]));
      const botChord = rc.makeBox(span, depth, barThick);
      parts.push(safeTranslate(botChord, [0, 0, 0]));

      // Diagonal web bars (Warren truss)
      for (let p = 0; p < panels; p++) {
        const x1 = -span / 2 + p * panelW;
        const x2 = x1 + panelW;
        const diagLen = Math.hypot(panelW, height);
        const angle = (Math.atan2(height, panelW) * 180) / Math.PI;

        const diag = rc.makeBox(diagLen, depth * 0.8, barThick);
        const midX = (x1 + x2) / 2;
        let placedDiag = safeRotate(diag, p % 2 === 0 ? angle : -angle, [0, 0, 0], [0, 1, 0]);
        placedDiag = safeTranslate(placedDiag, [midX, 0, height / 2]);
        parts.push(placedDiag);
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`Truss failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Balustrade: (params, _inputs, warn) => {
    const length = Math.max(1, num(params.length, 10));
    const height = Math.max(0.4, num(params.height, 1.0));
    const spacing = Math.max(0.1, num(params.balusterSpacing, 0.2));
    const balusterR = Math.max(0.01, num(params.balusterRadius, 0.025));
    const railR = Math.max(0.02, num(params.railRadius, 0.04));

    try {
      const parts: any[] = [];
      // Top Handrail
      const handrail = rc.makeCylinder(railR, length);
      const rotRail = safeRotate(handrail, 90, [0, 0, 0], [0, 1, 0]);
      parts.push(safeTranslate(rotRail, [0, 0, height]));

      // Bottom rail
      const botRail = rc.makeCylinder(railR * 0.8, length);
      const rotBot = safeRotate(botRail, 90, [0, 0, 0], [0, 1, 0]);
      parts.push(safeTranslate(rotBot, [0, 0, railR * 1.5]));

      // Vertical Balusters
      const count = clampCount(Math.floor(length / spacing), 200, warn, 'Balustrade balusters');
      const startX = -((count * spacing) / 2);
      const balusterH = height - railR * 2;
      for (let i = 0; i <= count; i++) {
        const bal = rc.makeCylinder(balusterR, balusterH);
        parts.push(safeTranslate(bal, [startX + i * spacing, 0, balusterH / 2 + railR]));
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`Balustrade failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  WallWithOpenings: (params, _inputs, warn) => {
    const length = Math.max(1, num(params.length, 12));
    const height = Math.max(1, num(params.height, 3.2));
    const thickness = Math.max(0.1, num(params.thickness, 0.3));
    const opW = Math.max(0.4, num(params.openingWidth, 1.4));
    const opH = Math.max(0.4, num(params.openingHeight, 1.8));
    const opCount = Math.max(1, Math.min(10, Math.round(num(params.openingCount, 3))));
    const bottomOff = Math.max(0, num(params.openingBottomOffset, 0.8));

    try {
      const wall = rc.makeBox(length, thickness, height);
      const shiftedWall = safeTranslate(wall, [0, 0, height / 2]);

      const spacing = length / (opCount + 1);
      const startX = -length / 2 + spacing;
      const cutters: any[] = [];
      for (let i = 0; i < opCount; i++) {
        const opening = rc.makeBox(opW, thickness * 1.5, opH);
        cutters.push(safeTranslate(opening, [startX + i * spacing, 0, bottomOff + opH / 2]));
      }

      return shiftedWall.cut(rc.makeCompound(cutters));
    } catch (err: any) {
      warn(`WallWithOpenings failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  }
};
