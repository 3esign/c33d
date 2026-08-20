import * as replicad from 'replicad';
const rc: any = replicad;
import { safeTranslate, safeRotate, safeScale, bendShape } from '../deformation.ts';
import { num, clampCount } from '../executors.ts';

type WarnFn = (msg: string) => void;

function kernelAwareMsg(err: any): string {
  const m = err?.message || String(err);
  if (/Null shape/i.test(m)) return 'null shape pointer produced during operation';
  if (/StdFail_NotDone/i.test(m)) return 'kernel operation failed to converge on the input topology';
  return m;
}

export const ORGANIC_EXECUTORS: Record<string, (params: any, inputs: any[], warn: WarnFn) => any> = {
  Phyllotaxis: (params, _inputs, warn) => {
    const count = clampCount(num(params.count, 34), 500, warn, 'Phyllotaxis count');
    const spread = Math.max(0.01, num(params.spread, 2.0));
    const divAngle = num(params.divergenceAngle, 137.5077);
    const pitchZ = num(params.pitchZ, 0.2);
    const domeR = Math.max(0, num(params.domeRadius, 0));

    const points: any[] = [];
    const rotations: any[] = [];
    const radii: number[] = [];

    const radPerDeg = Math.PI / 180;
    for (let n = 0; n < count; n++) {
      const theta = n * divAngle * radPerDeg;
      const r = spread * Math.sqrt(n);
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      let z = n * pitchZ;
      if (domeR > 0.001) {
        z -= (r * r) / (2 * domeR);
      }
      points.push({ type: 'Point', x, y, z });
      const tilt = (theta * 180) / Math.PI;
      rotations.push({ type: 'Vector', x: 0, y: 0, z: tilt });
      radii.push(r);
    }
    return {
      type: 'PhyllotaxisResult',
      points,
      rotations,
      radii,
      value: points
    };
  },

  AirfoilCurve: (params, _inputs, warn) => {
    const chord = Math.max(0.1, num(params.chord, 10));
    const code = String(params.nacaCode || '0012').padStart(4, '0').slice(-4);
    const numPoints = Math.max(10, Math.min(200, Math.round(num(params.numPoints, 40))));

    // NACA 4-digit formula
    const m = parseInt(code[0], 10) / 100; // max camber
    const p = parseInt(code[1], 10) / 10;  // position of max camber
    const t = parseInt(code.slice(2), 10) / 100; // thickness

    try {
      const upper: [number, number][] = [];
      const lower: [number, number][] = [];

      for (let i = 0; i <= numPoints; i++) {
        // Cosine spacing for high density near leading edge
        const beta = (i * Math.PI) / numPoints;
        const xc = (1 - Math.cos(beta)) / 2; // 0 to 1
        const x = xc * chord;

        // Thickness distribution
        const yt = 5 * t * chord * (
          0.2969 * Math.sqrt(Math.max(0, xc)) -
          0.1260 * xc -
          0.3516 * Math.pow(xc, 2) +
          0.2843 * Math.pow(xc, 3) -
          0.1015 * Math.pow(xc, 4)
        );

        // Camber line
        let yc = 0;
        let dyc_dx = 0;
        if (p > 0 && m > 0) {
          if (xc < p) {
            yc = (m / (p * p)) * (2 * p * xc - xc * xc) * chord;
            dyc_dx = ((2 * m) / (p * p)) * (p - xc);
          } else {
            yc = (m / ((1 - p) * (1 - p))) * ((1 - 2 * p) + 2 * p * xc - xc * xc) * chord;
            dyc_dx = ((2 * m) / ((1 - p) * (1 - p))) * (p - xc);
          }
        }
        const theta = Math.atan(dyc_dx);

        upper.push([x - yt * Math.sin(theta), yc + yt * Math.cos(theta)]);
        if (i > 0 && i < numPoints) {
          lower.push([x + yt * Math.sin(theta), yc - yt * Math.cos(theta)]);
        }
      }

      let sketch = rc.draw();
      sketch = sketch.move(upper[0]);
      for (let i = 1; i < upper.length; i++) {
        sketch = sketch.lineTo(upper[i]);
      }
      for (let i = lower.length - 1; i >= 0; i--) {
        sketch = sketch.lineTo(lower[i]);
      }
      sketch = sketch.close();

      const wire = sketch.sketchOnPlane('XY').wire;
      return { type: 'Curve', value: wire };
    } catch (err: any) {
      warn(`AirfoilCurve failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Superellipse: (params, _inputs, warn) => {
    const rx = Math.max(0.1, num(params.radiusX, 6));
    const ry = Math.max(0.1, num(params.radiusY, 4));
    const exponent = Math.max(0.2, Math.min(10, num(params.exponent, 2.5)));
    const numPoints = Math.max(12, Math.min(180, Math.round(num(params.numPoints, 48))));

    try {
      const pts: [number, number][] = [];
      const step = (2 * Math.PI) / numPoints;
      for (let i = 0; i < numPoints; i++) {
        const t = i * step;
        const cosT = Math.cos(t);
        const sinT = Math.sin(t);
        const x = rx * Math.sign(cosT) * Math.pow(Math.abs(cosT), 2 / exponent);
        const y = ry * Math.sign(sinT) * Math.pow(Math.abs(sinT), 2 / exponent);
        pts.push([x, y]);
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
      warn(`Superellipse failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  OrganicRib: (params, _inputs, warn) => {
    const length = Math.max(1, num(params.length, 10));
    const baseR = Math.max(0.1, num(params.baseRadius, 0.8));
    const tipR = Math.max(0.05, num(params.tipRadius, 0.2));
    const archH = Math.max(0, num(params.archHeight, 2.5));

    try {
      // Build curved skeleton rib by lofting cross-sections along arc
      const segments = 8;
      const wires: any[] = [];
      for (let i = 0; i <= segments; i++) {
        const f = i / segments;
        const r = baseR + (tipR - baseR) * f;
        const x = f * length;
        const z = archH * Math.sin(f * Math.PI);

        const circle = rc.drawCircle(r);
        const w = circle.sketchOnPlane('YZ').wire;
        wires.push(safeTranslate(w, [x, 0, z]));
      }
      if (wires[0] && typeof wires[0].loftWith === 'function') {
        return wires[0].loftWith(wires.slice(1).length === 1 ? wires[1] : wires.slice(1));
      }
      if (typeof (rc as any).loft === 'function') {
        return (rc as any).loft(wires);
      }
      return null;
    } catch (err: any) {
      warn(`OrganicRib failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  BranchingSystem: (params, _inputs, warn) => {
    const levels = Math.max(1, Math.min(4, Math.round(num(params.levels, 2))));
    const trunkR = Math.max(0.2, num(params.trunkRadius, 0.8));
    const trunkH = Math.max(1, num(params.trunkHeight, 6));
    const angle = Math.max(10, Math.min(60, num(params.branchAngle, 30)));
    const decay = Math.max(0.4, Math.min(0.85, num(params.radiusDecay, 0.65)));

    try {
      const parts: any[] = [];
      // Trunk
      const trunk = rc.makeCone(trunkR, trunkR * decay, trunkH);
      parts.push(safeTranslate(trunk, [0, 0, trunkH / 2]));

      function spawnBranches(x: number, y: number, z: number, r: number, h: number, level: number) {
        if (level > levels) return;
        const subCount = 2;
        for (let i = 0; i < subCount; i++) {
          const yaw = (i * 180 + (level * 45));
          const subCone = rc.makeCone(r, r * decay, h);
          let b = safeTranslate(subCone, [0, 0, h / 2]);
          b = safeRotate(b, angle, [0, 0, 0], [0, 1, 0]);
          b = safeRotate(b, yaw, [0, 0, 0], [0, 0, 1]);
          b = safeTranslate(b, [x, y, z]);
          parts.push(b);

          const radYaw = (yaw * Math.PI) / 180;
          const radPitch = (angle * Math.PI) / 180;
          const nx = x + h * Math.sin(radPitch) * Math.cos(radYaw);
          const ny = y + h * Math.sin(radPitch) * Math.sin(radYaw);
          const nz = z + h * Math.cos(radPitch);
          spawnBranches(nx, ny, nz, r * decay, h * 0.75, level + 1);
        }
      }

      spawnBranches(0, 0, trunkH, trunkR * decay, trunkH * 0.7, 2);
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`BranchingSystem failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  Tendon: (params, _inputs, warn) => {
    const radius = Math.max(0.05, num(params.radius, 0.3));
    const length = Math.max(1, num(params.length, 10));
    const sag = Math.max(0, num(params.sag, 1.0));

    try {
      const p1: [number, number, number] = [0, 0, 0];
      const p2: [number, number, number] = [length / 2, 0, -sag];
      const p3: [number, number, number] = [length, 0, 0];

      const arc = (rc.makeThreePointArc || rc.genericSweep)(p1, p2, p3);
      if (typeof rc.makePipe === 'function') {
        return rc.makePipe(arc, radius);
      }
      const cyl = rc.makeCylinder(radius, length);
      return safeRotate(cyl, 90, [0, 0, 0], [0, 1, 0]);
    } catch (err: any) {
      warn(`Tendon failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  PetalMorph: (params, _inputs, warn) => {
    const length = Math.max(1, num(params.length, 10));
    const width = Math.max(0.5, num(params.width, 5));
    const cup = num(params.cupDepth, 1.5);
    const wave = num(params.edgeWaviness, 0.4);
    const thickness = Math.max(0.1, num(params.thickness, 0.3));

    try {
      let pen = rc.draw();
      const p0: [number, number] = [0, 0];
      const p1: [number, number] = [width * 0.5, length * 0.4 + wave];
      const p2: [number, number] = [0, length];
      const p3: [number, number] = [-width * 0.5, length * 0.4 - wave];

      pen = pen.move(p0).smoothSplineTo(p1).smoothSplineTo(p2).smoothSplineTo(p3).close();
      let solid = pen.sketchOnPlane('XY').extrude(thickness);

      if (Math.abs(cup) > 0.1) {
        const bbox = [[-width, 0, 0], [width, length, thickness]] as [[number, number, number], [number, number, number]];
        solid = bendShape(solid, 'X', cup * 20, bbox);
      }
      return solid;
    } catch (err: any) {
      warn(`PetalMorph failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  SpineLoft: (params, _inputs, warn) => {
    const length = Math.max(1, num(params.spineLength, 12));
    const rStart = Math.max(0.1, num(params.radiusStart, 1.5));
    const rMid = Math.max(0.1, num(params.radiusMid, 3.0));
    const rEnd = Math.max(0.05, num(params.radiusEnd, 0.4));
    const segments = Math.max(3, Math.min(30, Math.round(num(params.segments, 8))));

    try {
      const wires: any[] = [];
      for (let i = 0; i <= segments; i++) {
        const f = i / segments;
        // Quadratic bezier interpolation for radius
        const r = (1 - f) * (1 - f) * rStart + 2 * (1 - f) * f * rMid + f * f * rEnd;
        const z = f * length;
        const xOffset = Math.sin(f * Math.PI) * (length * 0.15);

        const circ = rc.drawCircle(r);
        const w = circ.sketchOnPlane('XY').wire;
        wires.push(safeTranslate(w, [xOffset, 0, z]));
      }
      if (wires[0] && typeof wires[0].loftWith === 'function') {
        return wires[0].loftWith(wires.slice(1).length === 1 ? wires[1] : wires.slice(1));
      }
      if (typeof (rc as any).loft === 'function') {
        return (rc as any).loft(wires);
      }
      return null;
    } catch (err: any) {
      warn(`SpineLoft failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  SegmentedBody: (params, _inputs, warn) => {
    const segments = Math.max(2, Math.min(20, Math.round(num(params.segments, 6))));
    const baseR = Math.max(0.2, num(params.baseRadius, 1.2));
    const maxR = Math.max(baseR, num(params.maxRadius, 2.5));
    const length = Math.max(1, num(params.length, 12));
    const gap = Math.max(0, num(params.segmentGap, 0.15));

    try {
      const parts: any[] = [];
      const segLen = (length - (segments - 1) * gap) / segments;
      for (let i = 0; i < segments; i++) {
        const f = (i + 0.5) / segments;
        const curR = baseR + (maxR - baseR) * Math.sin(f * Math.PI);
        const sphere = rc.makeSphere(curR);
        // Squash into disc / pod
        let pod = safeScale(sphere, 1);
        pod = safeTranslate(pod, [0, 0, i * (segLen + gap) + segLen / 2]);
        parts.push(pod);
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`SegmentedBody failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  },

  MetaballCluster: (params, _inputs, warn) => {
    const count = clampCount(num(params.count, 5), 20, warn, 'MetaballCluster count');
    const radius = Math.max(0.5, num(params.radius, 2.0));
    const spread = Math.max(0.5, num(params.spread, 3.0));

    try {
      const parts: any[] = [];
      for (let i = 0; i < count; i++) {
        const a = (i * 2 * Math.PI) / count;
        const r = radius * (0.6 + 0.4 * Math.sin(i * 1.5));
        const sph = rc.makeSphere(r);
        const dist = (i === 0) ? 0 : spread;
        const placed = safeTranslate(sph, [dist * Math.cos(a), dist * Math.sin(a), (i % 2) * 0.5]);
        parts.push(placed);
      }
      return rc.makeCompound(parts);
    } catch (err: any) {
      warn(`MetaballCluster failed: ${kernelAwareMsg(err)}`);
      return null;
    }
  }
};
