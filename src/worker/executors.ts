import * as replicad from 'replicad';
import {
  safeTranslate,
  safeRotate,
  safeScale,
  nonUniformScale,
  bendShape,
  twistShape
} from './deformation';
import { parseSVGPath } from './svgPath';

// NaN-safe numeric param read.
function num(v: any, d: number): number {
  const p = parseFloat(v);
  return isFinite(p) ? p : d;
}

function parseParamToNumberOrList(val: any, fallback = 0): number | number[] {
  if (Array.isArray(val)) return val;
  if (val === undefined || val === null) return fallback;
  const parsed = parseFloat(val);
  return isFinite(parsed) ? parsed : fallback;
}

// Grabs first two points of an SVG path to calculate initial tangent chord for Pipe
function extractFirstTwoPathPoints(pathStr: string): [number, number][] {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g) || [];
  const pts: [number, number][] = [];
  let i = 0;
  while (i < tokens.length && pts.length < 2) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm' || cmd === 'L' || cmd === 'l') {
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else if (cmd === 'C' || cmd === 'c') {
      i += 4;
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else if (cmd === 'Q' || cmd === 'q') {
      i += 2;
      pts.push([parseFloat(tokens[i++]), parseFloat(tokens[i++])]);
    } else {
      break;
    }
  }
  return pts;
}

export const EXECUTORS: Record<
  string,
  (params: any, inputs: any[], warn: (msg: string) => void) => any
> = {
  Box: (params) => {
    const w = parseFloat(params.width) || 10;
    const l = parseFloat(params.length) || 10;
    const h = parseFloat(params.height) || 10;
    return replicad.makeBox([-w / 2, -l / 2, -h / 2], [w / 2, l / 2, h / 2]);
  },

  Sphere: (params) => {
    const r = parseFloat(params.radius) || 5;
    return replicad.makeSphere(r);
  },

  Cylinder: (params) => {
    const r = parseFloat(params.radius) || 5;
    const h = parseFloat(params.height) || 10;
    return replicad.makeCylinder(r, h, [0, 0, -h / 2]);
  },

  Cone: (params, _inputs, warn) => {
    const r1 = Math.max(num(params.radius1, 5), 0.001);
    const r2 = Math.max(num(params.radius2, 2), 0.001);
    const h = Math.max(num(params.height, 10), 0.001);
    if (Math.abs(r1 - r2) < 1e-6) {
      return replicad.makeCylinder(r1, h, [0, 0, -h / 2]);
    }
    try {
      const OC = (replicad as any).getOC();
      const maker = new OC.BRepPrimAPI_MakeCone_1(r1, r2, h);
      const shape = replicad.cast(maker.Shape());
      maker.delete();
      return (shape as any).translate([0, 0, -h / 2]);
    } catch (e1: any) {
      try {
        const s1 = replicad.drawCircle(r1).sketchOnPlane("XY") as any;
        const s2 = replicad.drawCircle(r2).sketchOnPlane("XY", h) as any;
        return s1.loftWith(s2).translate([0, 0, -h / 2]);
      } catch (err: any) {
        console.warn("Cone generation failed:", err);
        warn(
          `Cone failed with radius1=${r1}, radius2=${r2}, height=${h}: ${String(
            err?.message || err
          )} (native cone also failed: ${String(e1?.message || e1).slice(0, 120)})`
        );
        return null;
      }
    }
  },

  Plane: (params) => {
    const w = parseFloat(params.width) || 10;
    const l = parseFloat(params.length) || 10;
    return (replicad.drawRectangle(w, l).sketchOnPlane("XY") as any)
      .face()
      .translate([-w / 2, -l / 2, 0]);
  },

  Ellipsoid: (params, _inputs, warn) => {
    const rx = Math.max(num(params.radiusX, 5), 0.001);
    const ry = Math.max(num(params.radiusY, 3), 0.001);
    const rz = Math.max(num(params.radiusZ, 2), 0.001);
    try {
      const base = replicad.makeSphere(rx);
      if (Math.abs(ry - rx) < 1e-9 && Math.abs(rz - rx) < 1e-9) return base;
      const out = nonUniformScale(base, 1, ry / rx, rz / rx);
      try {
        (base as any).delete?.();
      } catch (e) {
        /* ok */
      }
      return out;
    } catch (err: any) {
      warn(`Ellipsoid failed (rx=${rx}, ry=${ry}, rz=${rz}): ${String(err?.message || err)}`);
      return replicad.makeSphere(rx);
    }
  },

  Torus: (params, _inputs, warn) => {
    const R = Math.max(num(params.majorRadius, 8), 0.001);
    const r = Math.max(Math.min(num(params.minorRadius, 2), R * 0.99), 0.001);
    try {
      const OC = (replicad as any).getOC();
      const maker = new OC.BRepPrimAPI_MakeTorus_1(R, r);
      const shape = replicad.cast(maker.Shape());
      maker.delete();
      return shape;
    } catch (err: any) {
      warn(`Torus failed (majorRadius=${R}, minorRadius=${r}): ${String(err?.message || err)}`);
      return null;
    }
  },

  ScaleXYZ: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const fx = Math.max(0.01, num(params.factorX, 1));
    const fy = Math.max(0.01, num(params.factorY, 1));
    const fz = Math.max(0.01, num(params.factorZ, 1));
    if (Math.abs(fx - 1) < 1e-9 && Math.abs(fy - 1) < 1e-9 && Math.abs(fz - 1) < 1e-9) {
      return solidInput.clone();
    }
    const isLocal = params.isLocal !== false && params.isLocal !== 'false';
    const center: [number, number, number] =
      isLocal && solidInput.boundingBox
        ? (solidInput.boundingBox.center as [number, number, number])
        : [0, 0, 0];
    try {
      return nonUniformScale(solidInput, fx, fy, fz, center);
    } catch (err: any) {
      warn(
        `ScaleXYZ failed (${fx}, ${fy}, ${fz}): ${String(
          err?.message || err
        )} — passed the solid through UNSCALED.`
      );
      return solidInput.clone();
    }
  },

  Bend: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const axisName = String(params.axis || 'X').toUpperCase();
    const angle = num(params.angle, 45);
    if (Math.abs(angle) < 1e-6) return solidInput.clone();
    try {
      return bendShape(solidInput, axisName, angle);
    } catch (err: any) {
      warn(
        `Bend failed (axis ${axisName}, angle ${angle}): ${String(
          err?.message || err
        )} — passed the solid through UNBENT.`
      );
      return solidInput.clone();
    }
  },

  Twist: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const axisName = String(params.axis || 'Z').toUpperCase();
    const angle = num(params.angle, 90);
    if (Math.abs(angle) < 1e-6) return solidInput.clone();
    try {
      return twistShape(solidInput, axisName, angle);
    } catch (err: any) {
      warn(
        `Twist failed (axis ${axisName}, angle ${angle}): ${String(
          err?.message || err
        )} — passed the solid through UNTWISTED.`
      );
      return solidInput.clone();
    }
  },

  PlaceOnSurface: (params, inputs) => {
    const surfaceInput = inputs.find((i) => i.targetHandle === 'surface')?.value;
    const shapeInput = inputs.find((i) => i.targetHandle === 'shape')?.value;
    if (!surfaceInput || !shapeInput) return null;
    const u = parseFloat(params.u) || 0;
    const v = parseFloat(params.v) || 0;

    const face = surfaceInput.faces
      ? surfaceInput.faces[0]
      : typeof surfaceInput.face === 'function'
      ? surfaceInput.face()
      : surfaceInput;
    if (face && face.pointOnSurface) {
      const pt = face.pointOnSurface(u, v);
      let center = [0, 0, 0];
      if (shapeInput.boundingBox) {
        center = shapeInput.boundingBox.center;
      }
      return shapeInput.translate([pt[0] - center[0], pt[1] - center[1], pt[2] - center[2]]);
    }
    return shapeInput ? shapeInput.clone() : null;
  },

  ScatterOnSurface: (params, inputs) => {
    const surface = inputs.find((i) => i.targetHandle === 'surface')?.value;
    const shape = inputs.find((i) => i.targetHandle === 'shape')?.value;
    if (!surface || !shape) return shape ? shape.clone() : null;

    const count = parseInt(params.count) || 10;
    const seed = num(params.seed, 1);
    const scaleMin = num(params.scaleMin, 1);
    const scaleMax = num(params.scaleMax, 1);
    const includeBase = params.includeBase !== false && params.includeBase !== 'false';

    let s = seed;
    const random = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };

    const faces = surface.faces || [];
    let face = faces[0] || surface;
    if (faces.length > 1) {
      const sorted = [...faces].sort((a, b) => {
        const areaA = typeof a.area === 'number' ? a.area : 0;
        const areaB = typeof b.area === 'number' ? b.area : 0;
        return areaB - areaA;
      });
      face = sorted[0];
    }

    const shapeArray = [];
    if (includeBase) {
      shapeArray.push(surface.clone());
    }

    for (let i = 0; i < count; i++) {
      const u = random();
      const v = random();

      let x = 0,
        y = 0,
        z = 0;
      if (face && typeof face.pointOnSurface === 'function') {
        try {
          const pt = face.pointOnSurface(u, v);
          x = pt[0];
          y = pt[1];
          z = pt[2];
        } catch (e) {
          const bbox = surface.boundingBox;
          const [minPt, maxPt] = bbox.bounds;
          x = minPt[0] + u * (maxPt[0] - minPt[0]);
          y = minPt[1] + v * (maxPt[1] - minPt[1]);
          z = minPt[2] + u * (maxPt[2] - minPt[2]);
        }
      } else {
        const bbox = surface.boundingBox;
        const [minPt, maxPt] = bbox.bounds;
        x = minPt[0] + u * (maxPt[0] - minPt[0]);
        y = minPt[1] + v * (maxPt[1] - minPt[1]);
        z = minPt[2] + u * (maxPt[2] - minPt[2]);
      }

      const scaleVal = scaleMin + random() * (scaleMax - scaleMin);
      const scaled = scaleVal !== 1 ? safeScale(shape, scaleVal) : null;
      const targetShape = scaled || shape;

      let center = [0, 0, 0];
      if (targetShape.boundingBox) {
        center = targetShape.boundingBox.center;
      }

      const translated = safeTranslate(targetShape, [
        x - center[0],
        y - center[1],
        z - center[2]
      ]);
      shapeArray.push(translated);
      if (scaled) {
        try {
          scaled.delete();
        } catch (e) {}
      }
    }
    return replicad.makeCompound(shapeArray);
  },

  Align: (params, inputs) => {
    const shapeInput = inputs.find((i) => i.targetHandle === 'shape')?.value;
    if (!shapeInput) return null;
    const refInput = inputs.find((i) => i.targetHandle === 'reference')?.value;
    const mode = String(params.mode || 'above').toLowerCase();
    const ox = parseFloat(params.offsetX) || 0;
    const oy = parseFloat(params.offsetY) || 0;
    const oz = parseFloat(params.offsetZ) || 0;

    const sb = shapeInput.boundingBox;
    if (!sb || !sb.bounds) return shapeInput.clone();
    const [smin, smax] = sb.bounds;
    const sc = sb.center;

    let dx = ox,
      dy = oy,
      dz = oz;
    if (mode === 'ground' || !refInput) {
      dz += -smin[2];
    } else {
      const rb = refInput.boundingBox;
      if (!rb || !rb.bounds) return shapeInput.clone();
      const [rmin, rmax] = rb.bounds;
      const rc = rb.center;
      switch (mode) {
        case 'below':
          dx += rc[0] - sc[0];
          dy += rc[1] - sc[1];
          dz += rmin[2] - smax[2];
          break;
        case 'right':
          dx += rmax[0] - smin[0];
          dy += rc[1] - sc[1];
          dz += rc[2] - sc[2];
          break;
        case 'left':
          dx += rmin[0] - smax[0];
          dy += rc[1] - sc[1];
          dz += rc[2] - sc[2];
          break;
        case 'back':
          dx += rc[0] - sc[0];
          dy += rmax[1] - smin[1];
          dz += rc[2] - sc[2];
          break;
        case 'front':
          dx += rc[0] - sc[0];
          dy += rmin[1] - smax[1];
          dz += rc[2] - sc[2];
          break;
        case 'center':
          dx += rc[0] - sc[0];
          dy += rc[1] - sc[1];
          dz += rc[2] - sc[2];
          break;
        case 'above':
        default:
          dx += rc[0] - sc[0];
          dy += rc[1] - sc[1];
          dz += rmax[2] - smin[2];
          break;
      }
    }
    return safeTranslate(shapeInput, [dx, dy, dz]);
  },

  Translate: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;

    const xVal = parseParamToNumberOrList(params.x, 0);
    const yVal = parseParamToNumberOrList(params.y, 0);
    const zVal = parseParamToNumberOrList(params.z, 0);

    const isArray = Array.isArray(xVal) || Array.isArray(yVal) || Array.isArray(zVal);
    if (!isArray) {
      return safeTranslate(solidInput, [xVal as number, yVal as number, zVal as number]);
    }

    const xArr = Array.isArray(xVal) ? xVal : [xVal];
    const yArr = Array.isArray(yVal) ? yVal : [yVal];
    const zArr = Array.isArray(zVal) ? zVal : [zVal];
    const maxLen = Math.max(xArr.length, yArr.length, zArr.length);

    const shapes = [];
    for (let i = 0; i < maxLen; i++) {
      const x = xArr[Math.min(i, xArr.length - 1)];
      const y = yArr[Math.min(i, yArr.length - 1)];
      const z = zArr[Math.min(i, zArr.length - 1)];
      shapes.push(safeTranslate(solidInput, [x, y, z]));
    }
    return replicad.makeCompound(shapes);
  },

  Rotate: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;

    const angleVal = parseParamToNumberOrList(params.angle, 0);
    const axVal = parseParamToNumberOrList(params.axisX, 0);
    const ayVal = parseParamToNumberOrList(params.axisY, 0);
    const azVal = parseParamToNumberOrList(params.axisZ, 1);

    const isLocal = params.isLocal === true || params.isLocal === 'true';
    let center = [0, 0, 0];
    if (isLocal && solidInput.boundingBox) {
      center = solidInput.boundingBox.center;
    }

    const isArray =
      Array.isArray(angleVal) ||
      Array.isArray(axVal) ||
      Array.isArray(ayVal) ||
      Array.isArray(azVal);
    if (!isArray) {
      const axis = [axVal as number, ayVal as number, azVal as number];
      const axisDir: [number, number, number] =
        axis[0] === 0 && axis[1] === 0 && axis[2] === 0
          ? [0, 0, 1]
          : (axis as [number, number, number]);
      return safeRotate(
        solidInput,
        angleVal as number,
        center as [number, number, number],
        axisDir
      );
    }

    const angleArr = Array.isArray(angleVal) ? angleVal : [angleVal];
    const axArr = Array.isArray(axVal) ? axVal : [axVal];
    const ayArr = Array.isArray(ayVal) ? ayVal : [ayVal];
    const azArr = Array.isArray(azVal) ? azVal : [azVal];
    const maxLen = Math.max(
      angleArr.length,
      axArr.length,
      ayArr.length,
      azArr.length
    );

    const shapes = [];
    for (let i = 0; i < maxLen; i++) {
      const angle = angleArr[Math.min(i, angleArr.length - 1)];
      const ax = axArr[Math.min(i, axArr.length - 1)];
      const ay = ayArr[Math.min(i, ayArr.length - 1)];
      const az = azArr[Math.min(i, azArr.length - 1)];
      const axis = [ax, ay, az];
      const axisDir: [number, number, number] =
        axis[0] === 0 && axis[1] === 0 && axis[2] === 0
          ? [0, 0, 1]
          : (axis as [number, number, number]);
      shapes.push(
        safeRotate(solidInput, angle, center as [number, number, number], axisDir)
      );
    }
    return replicad.makeCompound(shapes);
  },

  Scale: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;

    const factorVal = parseParamToNumberOrList(params.factor, 1);
    const isLocal = params.isLocal === true || params.isLocal === 'true';
    let center = [0, 0, 0];
    if (isLocal && solidInput.boundingBox) {
      center = solidInput.boundingBox.center;
    }

    if (!Array.isArray(factorVal)) {
      const factor = Math.max(0.01, factorVal);
      return safeScale(solidInput, factor, center as [number, number, number]);
    }

    const shapes = [];
    for (let i = 0; i < factorVal.length; i++) {
      const factor = Math.max(0.01, factorVal[i]);
      shapes.push(safeScale(solidInput, factor, center as [number, number, number]));
    }
    return replicad.makeCompound(shapes);
  },

  Fillet: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const r = parseFloat(params.radius) || 1;
    try {
      return solidInput.fillet(r);
    } catch (err) {
      console.warn("Fillet failed:", err);
      warn(
        `Fillet radius ${r} failed (likely larger than an adjacent edge/thickness) — passed the solid through UNFILLETED. Reduce the radius if rounding matters.`
      );
      return solidInput.clone();
    }
  },

  Chamfer: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const r = parseFloat(params.radius) || 1;
    try {
      return solidInput.chamfer(r);
    } catch (err) {
      console.warn("Chamfer failed:", err);
      warn(
        `Chamfer distance ${r} failed (likely too large for the solid) — passed the solid through UNCHAMFERED. Reduce it if the bevel matters.`
      );
      return solidInput.clone();
    }
  },

  Extrude: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const h = parseFloat(params.height) || 10;
    const endFactor = Math.max(0.02, num(params.taperEndFactor, 1));
    const profileName = params.taperProfile === 'sCurve' ? 's-curve' : 'linear';
    const twist = num(params.twistAngle, 0);
    const hasTaper = Math.abs(endFactor - 1) > 1e-6;
    const hasTwist = Math.abs(twist) > 1e-6;
    try {
      if (hasTaper || hasTwist) {
        const opts: any = {};
        if (hasTaper) opts.extrusionProfile = { profile: profileName, endFactor };
        if (hasTwist) opts.twistAngle = twist;
        return solidInput.extrude(h, opts);
      }
      return solidInput.extrude(h);
    } catch (err) {
      console.warn("Extrude failed:", err);
      warn(
        `Extrude failed (input is probably already a 3D solid, not a 2D face/sketch) — passed the input through UNCHANGED.`
      );
      return solidInput.clone();
    }
  },

  Mirror: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const plane = params.plane || 'YZ';
    try {
      return solidInput.mirror(plane);
    } catch (err) {
      console.warn("Mirror failed:", err);
      warn(`Mirror across "${plane}" failed — passed the solid through UNMIRRORED.`);
      return solidInput.clone();
    }
  },

  Sketch: (params, _inputs, warn) => {
    const svgPath = params.svgPath || 'M 0 0 L 10 0 L 10 10 L 0 10 Z';
    try {
      return parseSVGPath(svgPath);
    } catch (err: any) {
      console.warn("Sketch failed:", err);
      warn(
        `Sketch failed: ${String(
          err?.message || err
        )}. Check the svgPath string (supported: M L H V C Q Z).`
      );
      return null;
    }
  },

  Pipe: (params, _inputs, warn) => {
    const pathSvg = String(params.pathSvg || 'M 0 0 C 5 10 15 10 20 0');
    const radius = Math.max(0.02, num(params.radius, 1));
    try {
      const pathSketch = parseSVGPath(pathSvg);
      const wiresRaw = (pathSketch as any).wires();
      const wireObj = Array.isArray(wiresRaw) ? wiresRaw[0] : wiresRaw;
      if (!wireObj) {
        warn(`Pipe failed: path produced no wire (check pathSvg).`);
        return null;
      }
      const wire = wireObj.wrapped;

      const pts = extractFirstTwoPathPoints(pathSvg);
      let angleDeg = 0;
      if (pts.length >= 2) {
        const dx = pts[1][0] - pts[0][0],
          dy = pts[1][1] - pts[0][1];
        if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
          angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        }
      }
      let profile = (
        replicad.drawCircle(radius).sketchOnPlane('YZ') as any
      ).face();
      if (Math.abs(angleDeg) > 1e-9) {
        profile = safeRotate(profile, angleDeg, [0, 0, 0], [0, 0, 1]);
      }
      const start = pts[0] || [0, 0];
      if (Math.abs(start[0]) > 1e-9 || Math.abs(start[1]) > 1e-9) {
        profile = safeTranslate(profile, [start[0], start[1], 0]);
      }

      const OC = (replicad as any).getOC();
      const maker = new OC.BRepOffsetAPI_MakePipe_1(wire, profile.wrapped);
      const shape = replicad.cast(maker.Shape());
      maker.delete();
      return shape;
    } catch (err: any) {
      console.warn("Pipe failed:", err);
      warn(
        `Pipe failed: ${String(
          err?.message || err
        )}. Check the pathSvg string (M L C Q, no closing Z) and that radius is reasonable relative to the path's curvature.`
      );
      return null;
    }
  },

  Compound: (_params, inputs, warn) => {
    const shapes = inputs
      .filter((i) => i.targetHandle.startsWith('solid'))
      .map((i) => i.value)
      .filter(Boolean);
    if (shapes.length === 0) return null;

    const uniqueShapes = [];
    const seen = new Set();
    for (const s of shapes) {
      if (!seen.has(s)) {
        seen.add(s);
        uniqueShapes.push(s);
      }
    }

    if (uniqueShapes.length === 1) return uniqueShapes[0].clone();
    try {
      return replicad.makeCompound(uniqueShapes);
    } catch (err: any) {
      console.warn("Compound failed:", err);
      warn(`Compound failed: ${String(err?.message || err)}.`);
      return null;
    }
  },

  Text3D: (params, _inputs, warn) => {
    const txt = params.text || "C3D";
    const size = parseFloat(params.size) || 10;
    const h = parseFloat(params.height) || 2;
    try {
      return replicad.sketchText(txt, { fontSize: size }).extrude(h);
    } catch (err: any) {
      console.warn("Text3D failed:", err);
      warn(`Text3D failed: ${String(err?.message || err)}.`);
      return null;
    }
  },

  Shell: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const thickness = parseFloat(params.thickness) || 1;
    const removeBottom =
      params.removeBottomFace === true || params.removeBottomFace === 'true';
    try {
      if (removeBottom) {
        return solidInput.shell(thickness, (f: any) => f.inPlane("XY", 0));
      }
      return solidInput.shell(thickness);
    } catch (err) {
      console.warn("Shell failed:", err);
      warn(
        `Shell (thickness ${thickness}) failed (too thick for the solid, or unsupported topology) — passed the solid through UNSHELLED/solid.`
      );
      return solidInput.clone();
    }
  },

  Loft: (_params, inputs, warn) => {
    const profiles = ['profile1', 'profile2', 'profile3', 'profile4']
      .map((h) => inputs.find((i) => i.targetHandle === h)?.value)
      .filter(Boolean);
    if (profiles.length < 2) return null;
    try {
      return profiles[0].loftWith(
        profiles.slice(1).length === 1 ? profiles[1] : profiles.slice(1)
      );
    } catch (err: any) {
      console.warn("Loft failed:", err);
      warn(
        `Loft failed: ${String(
          err?.message || err
        )}. Profiles must be 2D faces/sketches (Plane, Sketch, drawn circles), not 3D solids.`
      );
      return null;
    }
  },

  Revolve: (params, inputs, warn) => {
    const profile = inputs.find((i) => i.targetHandle === 'profile')?.value;
    if (!profile) return null;
    const angleDeg = Math.max(1, Math.min(360, parseFloat(params.angle) || 360));
    const axisName = (params.axis || 'Z').toUpperCase();
    const axis: [number, number, number] =
      axisName === 'X' ? [1, 0, 0] : axisName === 'Y' ? [0, 1, 0] : [0, 0, 1];
    try {
      if (angleDeg >= 360) {
        return (profile as any).revolve(axis);
      }
      return (profile as any).revolve(axis, [0, 0, 0], { angle: angleDeg });
    } catch (err: any) {
      console.warn("Revolve failed:", err);
      warn(
        `Revolve failed: ${String(
          err?.message || err
        )}. The profile must be a 2D face/sketch, and it must not cross the revolve axis.`
      );
      return null;
    }
  },

  LinearPattern: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const count = parseInt(params.count) || 3;
    const dx = parseFloat(params.directionX) || 15;
    const dy = parseFloat(params.directionY) || 0;
    const dz = parseFloat(params.directionZ) || 0;
    const copies = [];
    for (let i = 0; i < count; i++) {
      copies.push(safeTranslate(solidInput, [i * dx, i * dy, i * dz]));
    }
    return replicad.makeCompound(copies);
  },

  CircularPattern: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const count = parseInt(params.count) || 4;
    const r = num(params.radius, 20);
    const totalAngle = num(params.angle, 360);
    const startAngle = num(params.startAngle, 0);
    const rise = num(params.rise, 0);
    const scaleStart = Math.max(0.01, num(params.scaleStart, 1));
    const scaleEnd = Math.max(0.01, num(params.scaleEnd, 1));
    const copies = [];
    const angleStep = totalAngle / count;
    for (let i = 0; i < count; i++) {
      const t = count > 1 ? i / (count - 1) : 0;
      const s = scaleStart + (scaleEnd - scaleStart) * t;
      let inst = solidInput;
      let scaled: any = null;
      if (Math.abs(s - 1) > 1e-9) {
        const c = solidInput.boundingBox
          ? solidInput.boundingBox.center
          : [0, 0, 0];
        scaled = safeScale(solidInput, s, c as [number, number, number]);
        inst = scaled;
      }
      const deg = startAngle + i * angleStep;
      const a = (deg * Math.PI) / 180;
      const x = r * Math.cos(a);
      const y = r * Math.sin(a);
      const translated = safeTranslate(inst, [x, y, i * rise]);
      const copy = safeRotate(translated, deg, [x, y, i * rise], [0, 0, 1]);
      copies.push(copy);
      try {
        translated.delete();
      } catch (e) {}
      if (scaled) {
        try {
          scaled.delete();
        } catch (e) {}
      }
    }
    return replicad.makeCompound(copies);
  },

  PlaceOnVertices: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    const shapeInput = inputs.find((i) => i.targetHandle === 'shape')?.value;
    if (!solidInput || !shapeInput) return null;

    const scaleMin = num(params.scaleMin, 1);
    const scaleMax = num(params.scaleMax, 1);
    const includeBase =
      params.includeBase !== false && params.includeBase !== 'false';

    try {
      const ocVertices = (solidInput as any)._listTopo("vertex");
      if (!ocVertices || ocVertices.length === 0) return null;

      const placedShapes = ocVertices.map((ocV: any, idx: number) => {
        const v = new (replicad as any).Vertex(ocV);
        const [x, y, z] = v.asTuple();

        const r = (Math.sin(idx + 5.67) * 10000) % 1;
        const scaleVal = scaleMin + Math.abs(r) * (scaleMax - scaleMin);

        const scaled = scaleVal !== 1 ? safeScale(shapeInput, scaleVal) : null;
        const targetShape = scaled || shapeInput;

        let center = [0, 0, 0];
        if (targetShape.boundingBox) {
          center = targetShape.boundingBox.center;
        }
        const translated = safeTranslate(targetShape, [
          x - center[0],
          y - center[1],
          z - center[2]
        ]);
        if (scaled) {
          try {
            scaled.delete();
          } catch (e) {}
        }
        return translated;
      });

      if (includeBase) {
        placedShapes.unshift(solidInput.clone());
      }

      return replicad.makeCompound(placedShapes);
    } catch (err: any) {
      console.warn("PlaceOnVertices failed:", err);
      warn(`PlaceOnVertices failed: ${String(err?.message || err)}.`);
      return null;
    }
  },

  Boolean: (params, inputs) => {
    const target = inputs.find((i) => i.targetHandle === 'target')?.value;
    const tool = inputs.find((i) => i.targetHandle === 'tool')?.value;
    if (!target || !tool) {
      return target ? target.clone() : tool ? tool.clone() : null;
    }

    const op = params.operation || 'union';
    if (op === 'union') return target.fuse(tool);
    if (op === 'difference') return target.cut(tool);
    if (op === 'intersect') return target.intersect(tool);
    return target.clone();
  },

  SubdivideSurface: (params, inputs, _warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;

    const uDivs = Math.max(1, parseInt(params.uDivisions) || 3);
    const vDivs = Math.max(1, parseInt(params.vDivisions) || 3);
    const inset = Math.max(0, Math.min(0.99, num(params.inset, 0)));
    const extrudeMin = num(params.extrudeMin, 0.5);
    const extrudeMax = num(params.extrudeMax, 0.5);
    const seed = num(params.seed, 1);
    const includeBase =
      params.includeBase === true || params.includeBase === 'true';
    const fiParsed = parseInt(params.faceIndex);
    const faceIndex = isFinite(fiParsed) ? fiParsed : -1;

    const OC = (replicad as any).getOC();

    const faces = solidInput.faces || [];
    if (faces.length === 0) return solidInput;

    let s = seed;
    const random = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };

    const cellSolids: any[] = [];

    const processFace = (face: any) => {
      for (let i = 0; i < uDivs; i++) {
        for (let j = 0; j < vDivs; j++) {
          let u1 = i / uDivs;
          let u2 = (i + 1) / uDivs;
          let v1 = j / vDivs;
          let v2 = (j + 1) / vDivs;

          if (inset > 0) {
            const uMid = (u1 + u2) / 2;
            const vMid = (v1 + v2) / 2;
            const uHalf = ((u2 - u1) / 2) * (1 - inset);
            const vHalf = ((v2 - v1) / 2) * (1 - inset);
            u1 = uMid - uHalf;
            u2 = uMid + uHalf;
            v1 = vMid - vHalf;
            v2 = vMid + vHalf;
          }

          try {
            const A = face.pointOnSurface(u1, v1);
            const B = face.pointOnSurface(u2, v1);
            const C = face.pointOnSurface(u2, v2);
            const D = face.pointOnSurface(u1, v2);

            const v1x = C[0] - A[0];
            const v1y = C[1] - A[1];
            const v1z = C[2] - A[2];

            const v2x = D[0] - B[0];
            const v2y = D[1] - B[1];
            const v2z = D[2] - B[2];

            let nx = v1y * v2z - v1z * v2y;
            let ny = v1z * v2x - v1x * v2z;
            let nz = v1x * v2y - v1y * v2x;

            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 0) {
              nx /= len;
              ny /= len;
              nz /= len;
            } else {
              nz = 1;
            }

            const gp_PntA = new OC.gp_Pnt(A[0], A[1], A[2]);
            const gp_PntB = new OC.gp_Pnt(B[0], B[1], B[2]);
            const gp_PntC = new OC.gp_Pnt(C[0], C[1], C[2]);
            const gp_PntD = new OC.gp_Pnt(D[0], D[1], D[2]);

            const edge1 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntA, gp_PntB);
            const edge2 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntB, gp_PntC);
            const edge3 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntC, gp_PntD);
            const edge4 = new OC.BRepBuilderAPI_MakeEdge_3(gp_PntD, gp_PntA);

            const makeWire = new OC.BRepBuilderAPI_MakeWire();
            makeWire.Add_1(edge1.Edge());
            makeWire.Add_1(edge2.Edge());
            makeWire.Add_1(edge3.Edge());
            makeWire.Add_1(edge4.Edge());
            const wire = makeWire.Wire();

            const makeFace = new OC.BRepBuilderAPI_MakeFace_1(wire, true);
            const faceShape = makeFace.Shape();
            const cellFace = replicad.cast(faceShape);

            const h = extrudeMin + random() * (extrudeMax - extrudeMin);
            if (h > 0.01) {
              const cellExtruded = (cellFace as any).extrude(h, [nx, ny, nz]);
              cellSolids.push(cellExtruded);
            } else {
              cellSolids.push(cellFace);
            }

            gp_PntA.delete();
            gp_PntB.delete();
            gp_PntC.delete();
            gp_PntD.delete();
            edge1.delete();
            edge2.delete();
            edge3.delete();
            edge4.delete();
            makeWire.delete();
            makeFace.delete();
          } catch (err) {
            console.warn(`Subdivision cell failed:`, err);
          }
        }
      }
    };

    if (faceIndex === -1) {
      faces.forEach(processFace);
    } else {
      const fIdx = Math.max(0, Math.min(faces.length - 1, faceIndex));
      processFace(faces[fIdx]);
    }

    if (includeBase) {
      cellSolids.push(solidInput.clone());
    }

    return replicad.makeCompound(cellSolids);
  },

  FilterFaces: (params, inputs) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;

    const faces = solidInput.faces || [];
    if (faces.length === 0) return solidInput.clone();

    const filterType = params.axisFilter || 'maxZ';
    const direction = params.direction || 'Z';
    const index = parseInt(params.index) || 0;
    const tol = parseFloat(params.tolerance) || 0.1;

    const matchedFaces: any[] = [];

    const getCenter = (face: any): [number, number, number] => {
      if (face.boundingBox) {
        return face.boundingBox.center;
      }
      return [0, 0, 0];
    };

    const getNormal = (face: any): [number, number, number] => {
      try {
        const A = face.pointOnSurface(0, 0);
        const B = face.pointOnSurface(1, 0);
        const C = face.pointOnSurface(1, 1);
        const D = face.pointOnSurface(0, 1);
        const v1x = C[0] - A[0];
        const v1y = C[1] - A[1];
        const v1z = C[2] - A[2];
        const v2x = D[0] - B[0];
        const v2y = D[1] - B[1];
        const v2z = D[2] - B[2];
        let nx = v1y * v2z - v1z * v2y;
        let ny = v1z * v2x - v1x * v2z;
        let nz = v1x * v2y - v1y * v2x;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
      } catch (e) {
        return [0, 0, 1];
      }
    };

    if (filterType === 'index') {
      const idx = Math.max(0, Math.min(faces.length - 1, index));
      matchedFaces.push(faces[idx].clone());
    } else if (filterType === 'direction') {
      faces.forEach((face: any) => {
        const [nx, ny, nz] = getNormal(face);
        if (direction === 'Z' && Math.abs(nz) > 1 - tol) {
          matchedFaces.push(face.clone());
        } else if (direction === 'X' && Math.abs(nx) > 1 - tol) {
          matchedFaces.push(face.clone());
        } else if (direction === 'Y' && Math.abs(ny) > 1 - tol) {
          matchedFaces.push(face.clone());
        }
      });
    } else {
      let bestFace = faces[0];
      let bestVal =
        filterType === 'minZ' || filterType === 'minX' || filterType === 'minY'
          ? Infinity
          : -Infinity;

      faces.forEach((face: any) => {
        const center = getCenter(face);
        let val = 0;
        if (filterType === 'maxZ' || filterType === 'minZ') val = center[2];
        if (filterType === 'maxX' || filterType === 'minX') val = center[0];
        if (filterType === 'maxY' || filterType === 'minY') val = center[1];

        if (
          filterType === 'maxZ' ||
          filterType === 'maxX' ||
          filterType === 'maxY'
        ) {
          if (val > bestVal) {
            bestVal = val;
            bestFace = face;
          }
        } else {
          if (val < bestVal) {
            bestVal = val;
            bestFace = face;
          }
        }
      });

      matchedFaces.push(bestFace.clone());
    }

    if (matchedFaces.length === 0) return null;
    if (matchedFaces.length === 1) return matchedFaces[0];
    return replicad.makeCompound(matchedFaces);
  },

  Helix: (params) => {
    const pitch = Math.max(0.01, num(params.pitch, 5));
    const height = Math.max(0.01, num(params.height, 20));
    const radius = Math.max(0.01, num(params.radius, 10));
    const radialChange = num(params.radialChange, 0);

    const turns = height / pitch;
    const segmentsPerTurn = 36;
    const totalSegments = Math.round(turns * segmentsPerTurn);
    const points = [];

    for (let i = 0; i <= totalSegments; i++) {
      const theta = (i / segmentsPerTurn) * 2 * Math.PI;
      const z = (i / totalSegments) * height - height / 2;
      const r = Math.max(0.001, radius + (radialChange * (i / totalSegments)));
      const x = r * Math.cos(theta);
      const y = r * Math.sin(theta);
      points.push([x, y, z]);
    }

    const OC = (replicad as any).getOC();
    const makePolygon = new OC.BRepBuilderAPI_MakePolygon();
    points.forEach((p) => {
      const gpPt = new OC.gp_Pnt(p[0], p[1], p[2]);
      makePolygon.Add(gpPt);
      gpPt.delete();
    });
    const shape = replicad.cast(makePolygon.Shape());
    makePolygon.delete();
    return shape;
  },

  Sweep: (_params, inputs, warn) => {
    const profile = inputs.find((i) => i.targetHandle === 'profile')?.value;
    const path = inputs.find((i) => i.targetHandle === 'path')?.value;
    if (!profile || !path) return null;

    try {
      const OC = (replicad as any).getOC();
      const wireObj = path.wires ? (path.wires()[0] || path) : path;
      const maker = new OC.BRepOffsetAPI_MakePipe_1(
        wireObj.wrapped || wireObj,
        profile.wrapped || profile
      );
      const shape = replicad.cast(maker.Shape());
      maker.delete();
      return shape;
    } catch (err: any) {
      console.warn("Sweep failed:", err);
      warn(`Sweep failed: ${String(err?.message || err)}.`);
      return null;
    }
  },

  VariableFillet: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const radius = parseFloat(params.radius) || 1.0;
    const filterAxis = String(params.filterAxis || 'all').toUpperCase();
    const edgeIndex = parseInt(params.edgeIndex) ?? -1;

    try {
      return solidInput.fillet(radius, (edge: any) => {
        if (edgeIndex !== -1) {
          const edges = solidInput.edges || [];
          const idx = edges.findIndex((e: any) => e.hashCode() === edge.hashCode());
          if (idx !== edgeIndex) return false;
        }
        if (filterAxis !== 'ALL') {
          try {
            const dir = edge.direction;
            if (!dir) return false;
            const [dx, dy, dz] = dir;
            if (filterAxis === 'X' && Math.abs(dx) < 0.95) return false;
            if (filterAxis === 'Y' && Math.abs(dy) < 0.95) return false;
            if (filterAxis === 'Z' && Math.abs(dz) < 0.95) return false;
          } catch (e) {
            return false;
          }
        }
        return true;
      });
    } catch (err) {
      console.warn("VariableFillet failed:", err);
      warn(`VariableFillet failed — passed solid through unfilleted.`);
      return solidInput.clone();
    }
  }
};
