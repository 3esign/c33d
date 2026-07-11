import * as replicad from 'replicad';
import {
  safeTranslate,
  safeRotate,
  safeScale,
  nonUniformScale,
  bendShape,
  twistShape
} from './deformation.ts';
import { parseSVGPath } from './svgPath.ts';
import { evaluateSelectionQuery } from './selectionQuery.ts';

// ---------- Text3D font loading ----------
// replicad.sketchText requires a font registered via loadFont(); without it
// every Text3D call dies with "Cannot read properties of undefined (reading
// 'getPath')". The worker calls ensureText3DFont() before evaluating any graph
// that contains a Text3D node. DejaVuSans.ttf is served from public/fonts/.
let text3dFontReady = false;
let text3dFontPromise: Promise<boolean> | null = null;

export function ensureText3DFont(): Promise<boolean> {
  if (text3dFontReady) return Promise.resolve(true);
  if (!text3dFontPromise) {
    const url = new URL('/fonts/DejaVuSans.ttf', (self as any).location?.origin || 'http://localhost').href;
    text3dFontPromise = replicad
      .loadFont(url)
      .then(() => {
        text3dFontReady = true;
        return true;
      })
      .catch((err: any) => {
        console.warn('Text3D font failed to load:', err);
        text3dFontPromise = null; // allow a later retry
        return false;
      });
  }
  return text3dFontPromise;
}

export const isText3DFontReady = () => text3dFontReady;

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
  (params: any, inputs: any[], warn: (msg: string) => void, scope?: Record<string, number>) => any
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

  Fillet: (params, inputs, warn, scope) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const selection = inputs.find((i) => i.targetHandle === 'selection')?.value;
    const r = parseFloat(params.radius) || 1;
    try {
      if (selection && selection.query) {
        const descends = solidInput.sourceNodeId === selection.sourceNodeId || 
                         (solidInput.ancestorNodeIds && solidInput.ancestorNodeIds.includes(selection.sourceNodeId));
        if (!descends) {
          warn(`Selection sourceNodeId "${selection.sourceNodeId}" is not an ancestor of solid "${solidInput.sourceNodeId}". Filtering all edges.`);
        }
        const resolved = evaluateSelectionQuery(selection.query, selection.domain, solidInput, scope || {}, 0.1);
        return solidInput.fillet(r, (edge: any) => {
          const h = typeof edge.hashCode === 'function' ? edge.hashCode() : edge.hashCode;
          return resolved.hashes.includes(h);
        });
      }
      return solidInput.fillet(r);
    } catch (err) {
      console.warn("Fillet failed:", err);
      warn(
        `Fillet radius ${r} failed (likely larger than an adjacent edge/thickness) — passed the solid through UNFILLETED. Reduce the radius if rounding matters.`
      );
      return solidInput.clone();
    }
  },

  Chamfer: (params, inputs, warn, scope) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const selection = inputs.find((i) => i.targetHandle === 'selection')?.value;
    const r = parseFloat(params.radius) || 1;
    try {
      if (selection && selection.query) {
        const descends = solidInput.sourceNodeId === selection.sourceNodeId || 
                         (solidInput.ancestorNodeIds && solidInput.ancestorNodeIds.includes(selection.sourceNodeId));
        if (!descends) {
          warn(`Selection sourceNodeId "${selection.sourceNodeId}" is not an ancestor of solid "${solidInput.sourceNodeId}". Filtering all edges.`);
        }
        const resolved = evaluateSelectionQuery(selection.query, selection.domain, solidInput, scope || {}, 0.1);
        return solidInput.chamfer(r, (edge: any) => {
          const h = typeof edge.hashCode === 'function' ? edge.hashCode() : edge.hashCode;
          return resolved.hashes.includes(h);
        });
      }
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
        uniqueShapes.push(s.clone()); // CLONE TO AVOID LIFETIME CRASHES ON CACHE EVICTION
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
    const txt = params.text || "C33D";
    const size = parseFloat(params.size) || 10;
    const h = parseFloat(params.height) || 2;
    if (!isText3DFontReady()) {
      warn(
        `Text3D unavailable: the text font could not be loaded (public/fonts/DejaVuSans.ttf missing or unreachable). Do not retry Text3D this session — build the label from primitives instead, or drop it.`
      );
      return null;
    }
    try {
      return replicad.sketchText(txt, { fontSize: size }).extrude(h);
    } catch (err: any) {
      console.warn("Text3D failed:", err);
      const msg = String(err?.message || err);
      warn(
        msg.includes('getPath')
          ? `Text3D failed: the font engine could not convert the text to outlines. Do not retry Text3D — build the label from primitives instead.`
          : `Text3D failed: ${msg}.`
      );
      return null;
    }
  },

  Shell: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const selection = inputs.find((i) => i.targetHandle === 'selection')?.value;
    const thickness = parseFloat(params.thickness) || 1;
    const removeBottom =
      params.removeBottomFace === true || params.removeBottomFace === 'true';
    try {
      if (selection && selection.hashes) {
        return solidInput.shell(thickness, (f: any) => {
          const h = typeof f.hashCode === 'function' ? f.hashCode() : f.hashCode;
          return selection.hashes.includes(h);
        });
      }
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
    const source = inputs.find((i) => i.targetHandle === 'solid')?.value;
    const shapeInput = inputs.find((i) => i.targetHandle === 'shape')?.value;
    if (!source || !shapeInput) return null;

    const scaleMin = num(params.scaleMin, 1);
    const scaleMax = num(params.scaleMax, 1);
    const includeBase = params.includeBase !== false && params.includeBase !== 'false';

    try {
      let coords: [number, number, number][] = [];
      if (source.type === 'Point') {
        coords.push([source.x, source.y, source.z]);
      } else if (Array.isArray(source)) {
        source.forEach(p => {
          if (p && p.type === 'Point') coords.push([p.x, p.y, p.z]);
        });
      } else if (source.type === 'Curve') {
        try {
           coords.push([...source.value.pointAt(0)] as [number, number, number]);
           coords.push([...source.value.pointAt(1)] as [number, number, number]);
        } catch(e) {}
      } else if (source.type === 'Plane' || source.type === 'Vector' || source.type === 'Selection') {
        warn(`Cannot place shapes on a ${source.type}. Connect a solid, point, list of points, or curve.`);
        return null;
      } else {
        const ocVertices = (source as any)._listTopo("vertex");
        if (ocVertices && ocVertices.length > 0) {
          ocVertices.forEach((ocV: any) => {
            const v = new (replicad as any).Vertex(ocV);
            coords.push(v.asTuple() as [number, number, number]);
          });
        }
      }

      if (coords.length === 0) return null;

      const placedShapes = coords.map((c, idx) => {
        const [x, y, z] = c;
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
          try { scaled.delete(); } catch (e) {}
        }
        return translated;
      });

      if (includeBase && typeof source.clone === 'function') {
        placedShapes.unshift(source.clone());
      }
      return replicad.makeCompound(placedShapes);
    } catch (e: any) {
      warn(`PlaceOnVertices failed: ${e.message}`);
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
    const ptsArray = new OC.TColgp_Array1OfPnt_2(1, points.length);
    points.forEach((p, idx) => {
      const gpPt = new OC.gp_Pnt_3(p[0], p[1], p[2]);
      ptsArray.SetValue(idx + 1, gpPt);
      gpPt.delete();
    });

    const continuity = OC.GeomAbs_Shape ? OC.GeomAbs_Shape.GeomAbs_C2 : 3;
    const builder = new OC.GeomAPI_PointsToBSpline_2(ptsArray, 3, 8, continuity, 1e-3);
    if (!builder.IsDone()) {
      ptsArray.delete();
      builder.delete();
      throw new Error('Helix spline interpolation failed');
    }
    const curve = builder.Curve();
    const makeEdge = new OC.BRepBuilderAPI_MakeEdge_24(curve);
    if (!makeEdge.IsDone()) {
      ptsArray.delete();
      builder.delete();
      makeEdge.delete();
      throw new Error('Helix edge creation failed');
    }
    const edge = makeEdge.Edge();
    const makeWire = new OC.BRepBuilderAPI_MakeWire_1(edge);
    if (!makeWire.IsDone()) {
      ptsArray.delete();
      builder.delete();
      makeEdge.delete();
      makeWire.delete();
      throw new Error('Helix wire creation failed');
    }
    const wire = makeWire.Wire();
    const shape = replicad.cast(wire);

    ptsArray.delete();
    builder.delete();
    makeEdge.delete();
    makeWire.delete();
    return shape;
  },

  Sweep: (params, inputs, warn) => {
    const profile = inputs.find((i) => i.targetHandle === 'profile')?.value;
    const path = inputs.find((i) => i.targetHandle === 'path')?.value;
    if (!profile || !path) return null;

    const transitionMode = String(params.transitionMode || 'right').toLowerCase();

    try {
      const wireObj = path.wires ? (path.wires()[0] || path) : path;
      const shape = (replicad as any).genericSweep(profile, wireObj, {
        transitionMode,
        forceProfileSpineOthogonality: true
      });
      return shape;
    } catch (err: any) {
      console.warn("Sweep failed:", err);
      warn(`Sweep failed: ${String(err?.message || err)}.`);
      return null;
    }
  },

  VariableFillet: (params, inputs, warn) => {
    warn(`VariableFillet is deprecated. Please use Fillet with a Selection node instead.`);
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const radius = parseFloat(params.radius) || 1.0;
    const filterAxis = String(params.filterAxis || 'all').toUpperCase();
    
    const parsedIndex = parseInt(params.edgeIndex);
    const edgeIndex = Number.isNaN(parsedIndex) ? -1 : parsedIndex;

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
  },

  SelectFaces: (params: any, inputs: any[], warn: (msg: string) => void, scope?: Record<string, number>) => {
    const solidInput = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const predicate = String(params.predicate || 'normal ~ +Z');
    const tol = parseFloat(params.tolerance) || 0.1;
    
    try {
      const res = evaluateSelectionQuery(predicate, 'faces', solidInput, scope || {}, tol);
      const totalCount = (solidInput.faces || []).length;
      
      if (res.hashes.length === 0) {
        warn(`Selection error: query "${predicate}" matched 0 faces on solid.`);
      } else if (res.hashes.length === totalCount) {
        warn(`Selection error: query "${predicate}" matched all ${totalCount} faces on solid (matched everything).`);
      } else {
        const centroids = res.elements.map(el => el.centroid.map(c => Number(c.toFixed(2))));
        const areas = res.elements.map(el => Number(el.areaOrLength.toFixed(2)));
        warn(`Selection info: matched ${res.hashes.length} faces, centroids: ${JSON.stringify(centroids)}, areas: ${JSON.stringify(areas)}`);
      }

      return {
        type: 'Selection',
        domain: 'faces',
        query: predicate,
        sourceNodeId: solidInput.sourceNodeId || ''
      };
    } catch (err: any) {
      warn(`SelectFaces failed: ${err.message || err}`);
      return { type: 'Selection', domain: 'faces', query: predicate, sourceNodeId: solidInput.sourceNodeId || '' };
    }
  },

  SelectEdges: (params: any, inputs: any[], warn: (msg: string) => void, scope?: Record<string, number>) => {
    const solidInput = inputs.find((i: any) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const predicate = String(params.predicate || 'parallel Z');
    const tol = parseFloat(params.tolerance) || 0.1;
    
    try {
      const res = evaluateSelectionQuery(predicate, 'edges', solidInput, scope || {}, tol);
      const totalCount = (solidInput.edges || []).length;
      
      if (res.hashes.length === 0) {
        warn(`Selection error: query "${predicate}" matched 0 edges on solid.`);
      } else if (res.hashes.length === totalCount) {
        warn(`Selection error: query "${predicate}" matched all ${totalCount} edges on solid (matched everything).`);
      } else {
        const centroids = res.elements.map(el => el.centroid.map(c => Number(c.toFixed(2))));
        const lengths = res.elements.map(el => Number(el.areaOrLength.toFixed(2)));
        warn(`Selection info: matched ${res.hashes.length} edges, centroids: ${JSON.stringify(centroids)}, lengths: ${JSON.stringify(lengths)}`);
      }

      return {
        type: 'Selection',
        domain: 'edges',
        query: predicate,
        sourceNodeId: solidInput.sourceNodeId || ''
      };
    } catch (err: any) {
      warn(`SelectEdges failed: ${err.message || err}`);
      return { type: 'Selection', domain: 'edges', query: predicate, sourceNodeId: solidInput.sourceNodeId || '' };
    }
  },

  SelectionCombine: (params: any, inputs: any[], _warn: (msg: string) => void) => {
    const s1 = inputs.find((i: any) => i.targetHandle === 'selection1')?.value;
    const s2 = inputs.find((i: any) => i.targetHandle === 'selection2')?.value;
    const op = String(params.operation || 'union').toLowerCase();
    
    if (!s1 && !s2) return { type: 'Selection', domain: 'faces', query: '', sourceNodeId: '' };
    if (!s1) return s2;
    if (!s2) return s1;
    
    let expr = '';
    if (op === 'union') {
      expr = `(${s1.query}) or (${s2.query})`;
    } else if (op === 'intersect') {
      expr = `(${s1.query}) and (${s2.query})`;
    } else if (op === 'subtract') {
      expr = `(${s1.query}) and (not (${s2.query}))`;
    }
    
    return {
      type: 'Selection',
      domain: s1.domain,
      query: expr,
      sourceNodeId: s1.sourceNodeId || s2.sourceNodeId || ''
    };
  },
  SplitLoop: (params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    if (!solidInput) return null;
    const axis = String(params.axis || 'Z');
    const at = num(params.at, 0.5);

    try {
      const bbox = solidInput.boundingBox;
      const bounds = bbox.bounds;
      let min = 0, max = 0;
      const axisLower = axis.toLowerCase();
      if (axisLower === 'x') {
        min = bounds[0][0];
        max = bounds[1][0];
      } else if (axisLower === 'y') {
        min = bounds[0][1];
        max = bounds[1][1];
      } else {
        min = bounds[0][2];
        max = bounds[1][2];
      }
      const splitVal = min + at * (max - min);

      const pad = 1000.0;
      const xMin = bounds[0][0] - pad;
      const xMax = bounds[1][0] + pad;
      const yMin = bounds[0][1] - pad;
      const yMax = bounds[1][1] + pad;
      const zMin = bounds[0][2] - pad;
      const zMax = bounds[1][2] + pad;

      let b1, b2;
      if (axisLower === 'x') {
        b1 = replicad.makeBox([xMin, yMin, zMin], [splitVal, yMax, zMax]);
        b2 = replicad.makeBox([splitVal, yMin, zMin], [xMax, yMax, zMax]);
      } else if (axisLower === 'y') {
        b1 = replicad.makeBox([xMin, yMin, zMin], [xMax, splitVal, zMax]);
        b2 = replicad.makeBox([xMin, splitVal, zMin], [xMax, yMax, zMax]);
      } else {
        b1 = replicad.makeBox([xMin, yMin, zMin], [xMax, yMax, splitVal]);
        b2 = replicad.makeBox([xMin, yMin, splitVal], [xMax, yMax, zMax]);
      }

      const half1 = solidInput.intersect(b1);
      const half2 = solidInput.intersect(b2);
      
      const out = replicad.makeCompound([half1, half2]);
      
      try {
        b1.delete?.();
        b2.delete?.();
        half1.delete?.();
        half2.delete?.();
      } catch (e) {}

      return out;
    } catch (err: any) {
      console.warn("SplitLoop failed:", err);
      warn(`SplitLoop failed: ${err.message || err}. Passed original solid.`);
      return solidInput.clone();
    }
  },

  SplitSolid: (_params, inputs, warn) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    const tool = inputs.find((i) => i.targetHandle === 'tool')?.value;
    if (!solidInput) return null;
    if (!tool) return solidInput.clone();

    try {
      const alignToPlane = (shape: any, planeFace: any) => {
        const center = planeFace.center.toTuple();
        const normalVec = planeFace.normalAt().toTuple();
        
        let res = shape.translate(center);
        
        const zDir = [0, 0, 1];
        const dot = zDir[0]*normalVec[0] + zDir[1]*normalVec[1] + zDir[2]*normalVec[2];
        const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
        
        if (angle > 1e-4) {
          const rx = zDir[1]*normalVec[2] - zDir[2]*normalVec[1];
          const ry = zDir[2]*normalVec[0] - zDir[0]*normalVec[2];
          const rz = zDir[0]*normalVec[1] - zDir[1]*normalVec[0];
          const len = Math.sqrt(rx*rx + ry*ry + rz*rz);
          if (len > 1e-9) {
            res = res.rotate(angle, center, [rx/len, ry/len, rz/len]);
          }
        }
        return res;
      };

      const pad = 1000.0;
      const b1_raw = replicad.makeBox([-pad, -pad, -pad], [pad, pad, 0]);
      const b2_raw = replicad.makeBox([-pad, -pad, 0], [pad, pad, pad]);
      
      const face = tool.faces ? (tool.faces[0] || tool) : tool;
      const b1 = alignToPlane(b1_raw, face);
      const b2 = alignToPlane(b2_raw, face);
      
      const half1 = solidInput.intersect(b1);
      const half2 = solidInput.intersect(b2);
      
      const out = replicad.makeCompound([half1, half2]);

      try {
        b1_raw.delete?.();
        b2_raw.delete?.();
        b1.delete?.();
        b2.delete?.();
        half1.delete?.();
        half2.delete?.();
      } catch (e) {}

      return out;
    } catch (err: any) {
      console.warn("SplitSolid failed:", err);
      warn(`SplitSolid failed: ${err.message || err}. Passed original solid.`);
      return solidInput.clone();
    }
  },

  ExtrudeFace: (params, inputs, warn, scope) => {
    const solidInput = inputs.find((i) => i.targetHandle === 'solid')?.value;
    const selection = inputs.find((i) => i.targetHandle === 'selection')?.value;
    if (!solidInput) return null;
    if (!selection) return solidInput.clone();
    const height = num(params.height, 5);

    if (Math.abs(height) < 1e-4) {
      return solidInput.clone();
    }

    try {
      const descends = solidInput.sourceNodeId === selection.sourceNodeId || 
                       (solidInput.ancestorNodeIds && solidInput.ancestorNodeIds.includes(selection.sourceNodeId));
      if (!descends) {
        warn(`Selection sourceNodeId "${selection.sourceNodeId}" is not an ancestor of solid "${solidInput.sourceNodeId}".`);
      }

      const resolved = evaluateSelectionQuery(selection.query, selection.domain, solidInput, scope || {}, 0.1);
      if (resolved.hashes.length === 0) {
        return solidInput.clone();
      }

      const facesToExtrude = (solidInput.faces || []).filter((f: any) => {
        const h = typeof f.hashCode === 'function' ? f.hashCode() : f.hashCode;
        return resolved.hashes.includes(h);
      });

      let out = solidInput;
      for (const f of facesToExtrude) {
        const normal = f.normalAt().toTuple();
        const wire = f.outerWire();
        const sketch = new replicad.Sketch(wire);
        const prism = sketch.extrude(Math.abs(height), { extrusionDirection: normal });
        
        if (height > 0) {
          out = out.fuse(prism);
        } else {
          out = out.cut(prism);
        }

        try {
          wire.delete?.();
          prism.delete?.();
        } catch (e) {}
      }

      return out;
    } catch (err: any) {
      console.warn("ExtrudeFace failed:", err);
      warn(`ExtrudeFace failed: ${err.message || err}. Passed original solid.`);
      return solidInput.clone();
    }
  },

  // ---------------------------------------------------------
  // POINT NODES
  // ---------------------------------------------------------
  Point: (params) => {
    return { type: 'Point', x: num(params.x, 0), y: num(params.y, 0), z: num(params.z, 0) };
  },
  DeconstructPoint: (_params, inputs) => {
    const pt = inputs.find(i => i.targetHandle === 'point')?.value || { x: 0, y: 0, z: 0 };
    return { __multi: true, values: { x: pt.x, y: pt.y, z: pt.z } };
  },
  Centroid: (_params, inputs) => {
    const shape = inputs.find(i => i.targetHandle === 'solid')?.value;
    if (!shape) return { type: 'Point', x: 0, y: 0, z: 0 };
    try {
      const bb = shape.boundingBox;
      return { type: 'Point', x: bb.center[0], y: bb.center[1], z: bb.center[2] };
    } catch {
      return { type: 'Point', x: 0, y: 0, z: 0 };
    }
  },
  Midpoint: (_params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'pointA')?.value || { x: 0, y: 0, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'pointB')?.value || { x: 0, y: 0, z: 0 };
    return { type: 'Point', x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2, z: (p1.z + p2.z) / 2 };
  },
  PointBetween: (params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'pointA')?.value || { x: 0, y: 0, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'pointB')?.value || { x: 0, y: 0, z: 0 };
    const t = num(params.t, 0.5);
    return { type: 'Point', x: p1.x + (p2.x - p1.x) * t, y: p1.y + (p2.y - p1.y) * t, z: p1.z + (p2.z - p1.z) * t };
  },
  Endpoints: (_params, inputs) => {
    const curve = inputs.find(i => i.targetHandle === 'curve')?.value;
    if (!curve || curve.type !== 'Curve') {
      const p = { type: 'Point', x: 0, y: 0, z: 0 };
      return { __multi: true, values: { start: p, end: p } };
    }
    try {
      const pt1 = curve.value.pointAt(0);
      const pt2 = curve.value.pointAt(1);
      return { __multi: true, values: {
        start: { type: 'Point', x: pt1[0], y: pt1[1], z: pt1[2] },
        end: { type: 'Point', x: pt2[0], y: pt2[1], z: pt2[2] }
      }};
    } catch {
      const p = { type: 'Point', x: 0, y: 0, z: 0 };
      return { __multi: true, values: { start: p, end: p } };
    }
  },

  // ---------------------------------------------------------
  // VECTOR NODES
  // ---------------------------------------------------------
  VectorXYZ: (params) => {
    return { type: 'Vector', x: num(params.x, 0), y: num(params.y, 0), z: num(params.z, 0) };
  },
  DeconstructVector: (_params, inputs) => {
    const v = inputs.find(i => i.targetHandle === 'vector')?.value || { x: 0, y: 0, z: 0 };
    return { __multi: true, values: { x: v.x, y: v.y, z: v.z } };
  },
  Vector2Pt: (_params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'from')?.value || { x: 0, y: 0, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'to')?.value || { x: 0, y: 0, z: 0 };
    return { type: 'Vector', x: p2.x - p1.x, y: p2.y - p1.y, z: p2.z - p1.z };
  },
  VectorMath: (params, inputs, warn) => {
    const v1 = inputs.find(i => i.targetHandle === 'vectorA')?.value || { x: 0, y: 0, z: 0 };
    const v2 = inputs.find(i => i.targetHandle === 'vectorB')?.value || { x: 0, y: 0, z: 0 };
    const op = params.operation || 'add';
    
    if (op === 'add') return { __multi: true, values: { vector: { type: 'Vector', x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z }, value: 0 } };
    if (op === 'subtract') return { __multi: true, values: { vector: { type: 'Vector', x: v1.x - v2.x, y: v1.y - v2.y, z: v1.z - v2.z }, value: 0 } };
    if (op === 'dot') return { __multi: true, values: { vector: { type: 'Vector', x:0, y:0, z:0 }, value: v1.x * v2.x + v1.y * v2.y + v1.z * v2.z } };
    if (op === 'cross') return { __multi: true, values: { vector: { type: 'Vector', x: v1.y * v2.z - v1.z * v2.y, y: v1.z * v2.x - v1.x * v2.z, z: v1.x * v2.y - v1.y * v2.x }, value: 0 } };
    if (op === 'normalize') {
      const len = Math.sqrt(v1.x*v1.x + v1.y*v1.y + v1.z*v1.z);
      if (len < 1e-6) { warn('Cannot normalize zero vector'); return { __multi: true, values: { vector: { type: 'Vector', x:0, y:0, z:0 }, value: 0 } }; }
      return { __multi: true, values: { vector: { type: 'Vector', x: v1.x/len, y: v1.y/len, z: v1.z/len }, value: len } };
    }
    if (op === 'length') return { __multi: true, values: { vector: { type: 'Vector', x:0, y:0, z:0 }, value: Math.sqrt(v1.x*v1.x + v1.y*v1.y + v1.z*v1.z) } };
    return { __multi: true, values: { vector: { type: 'Vector', x:0, y:0, z:0 }, value: 0 } };
  },

  // ---------------------------------------------------------
  // PLANE NODES
  // ---------------------------------------------------------
  ConstructPlane: (_params, inputs) => {
    const o = inputs.find(i => i.targetHandle === 'origin')?.value || { x: 0, y: 0, z: 0 };
    const n = inputs.find(i => i.targetHandle === 'normal')?.value || { x: 0, y: 0, z: 1 };
    return { type: 'Plane', origin: o, normal: n };
  },

  // ---------------------------------------------------------
  // CURVE NODES
  // ---------------------------------------------------------
  Line: (_params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'start')?.value || { x: 0, y: 0, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'end')?.value || { x: 10, y: 10, z: 10 };
    try {
      return { type: 'Curve', value: replicad.makeLine([p1.x, p1.y, p1.z], [p2.x, p2.y, p2.z]) };
    } catch { return null; }
  },
  Arc: (_params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'start')?.value || { x: -5, y: 0, z: 0 };
    const mid = inputs.find(i => i.targetHandle === 'mid')?.value || { x: 0, y: 5, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'end')?.value || { x: 5, y: 0, z: 0 };
    try {
      return { type: 'Curve', value: replicad.makeThreePointArc([p1.x, p1.y, p1.z], [mid.x, mid.y, mid.z], [p2.x, p2.y, p2.z]) };
    } catch { return null; }
  },
  CircleCurve: (params) => {
    const r = Math.max(0.001, num(params.radius, 5));
    try {
       const circle = replicad.drawCircle(r);
       return { type: 'Curve', value: circle };
    } catch { return null; }
  },
  EllipseCurve: (params) => {
    const rx = Math.max(0.001, num(params.radiusX, 5));
    const ry = Math.max(0.001, num(params.radiusY, 3));
    try { return { type: 'Curve', value: replicad.drawEllipse(rx, ry) }; } catch { return null; }
  },
  PolylineCurve: (_params, inputs) => {
    const pts = inputs.find(i => i.targetHandle === 'points')?.value;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    try {
       const coords = pts.map(p => [p.x||0, p.y||0, p.z||0] as [number, number, number]);
       const edges = [];
       for (let i = 0; i < coords.length - 1; i++) {
         edges.push(replicad.makeLine(coords[i], coords[i + 1]));
       }
       return { type: 'Curve', value: (replicad as any).assembleWire(edges) };
    } catch { return null; }
  },
  SplineCurve: (_params, inputs) => {
    const pts = inputs.find(i => i.targetHandle === 'points')?.value;
    if (!Array.isArray(pts) || pts.length < 2) return null;
    try {
       const coords = pts.map(p => [p.x||0, p.y||0, p.z||0] as [number, number, number]);
       return { type: 'Curve', value: (replicad as any).makeBSplineApproximation(coords) };
    } catch { return null; }
  },
  EdgesAsCurves: (_params, inputs) => {
    const s = inputs.find(i => i.targetHandle === 'shape')?.value;
    if (!s) return null;
    const edges = s.edges || [];
    if (edges.length === 0) return null;
    return edges.map((e: any) => ({ type: 'Curve', value: e }));
  },

  // ---------------------------------------------------------
  // MEASUREMENT NODES
  // ---------------------------------------------------------
  Measure: (_params, inputs) => {
    const shape = inputs.find(i => i.targetHandle === 'solid')?.value;
    let v = 0; let a = 0; let c = { type: 'Point', x: 0, y: 0, z: 0 };
    if (shape && typeof shape.boundingBox === 'object') {
      try { v = (replicad as any).measureVolume(shape) || 0; } catch {}
      try { a = (replicad as any).measureArea(shape) || 0; } catch {}
      try {
        const bb = shape.boundingBox;
        if (bb && bb.center) c = { type: 'Point', x: bb.center[0], y: bb.center[1], z: bb.center[2] };
      } catch {}
    }
    return { __multi: true, values: { volume: v, area: a, centroid: c } };
  },
  BoundingBox: (_params, inputs) => {
    const shape = inputs.find(i => i.targetHandle === 'solid')?.value;
    let min = { type: 'Point', x: 0, y: 0, z: 0 };
    let max = { type: 'Point', x: 0, y: 0, z: 0 };
    let sz = { type: 'Vector', x: 0, y: 0, z: 0 };
    let box = null;
    if (shape && typeof shape.boundingBox === 'object') {
      try {
        const bb = shape.boundingBox;
        if (bb && bb.bounds) {
          min = { type: 'Point', x: bb.bounds[0][0], y: bb.bounds[0][1], z: bb.bounds[0][2] };
          max = { type: 'Point', x: bb.bounds[1][0], y: bb.bounds[1][1], z: bb.bounds[1][2] };
          sz = { type: 'Vector', x: bb.bounds[1][0] - bb.bounds[0][0], y: bb.bounds[1][1] - bb.bounds[0][1], z: bb.bounds[1][2] - bb.bounds[0][2] };
          box = replicad.makeBox([min.x, min.y, min.z], [max.x, max.y, max.z]);
        }
      } catch {}
    }
    return { __multi: true, values: { box, min, max, size: sz } };
  },
  DistanceMeasure: (_params, inputs) => {
    const p1 = inputs.find(i => i.targetHandle === 'pointA')?.value || { x: 0, y: 0, z: 0 };
    const p2 = inputs.find(i => i.targetHandle === 'pointB')?.value || { x: 0, y: 0, z: 0 };
    const dx = p1.x - p2.x, dy = p1.y - p2.y, dz = p1.z - p2.z;
    return { __multi: true, values: { distance: Math.sqrt(dx*dx + dy*dy + dz*dz), pointA: p1, pointB: p2 } };
  },
  IsInside: (_params, inputs) => {
    const pt = inputs.find(i => i.targetHandle === 'point')?.value || { x: 0, y: 0, z: 0 };
    const shape = inputs.find(i => i.targetHandle === 'solid')?.value;
    let inside = 0;
    if (shape && typeof shape.intersect === 'function') {
      try {
         const s = replicad.makeSphere(0.001).translate([pt.x, pt.y, pt.z]);
         const cut = shape.intersect(s);
         const vol = (replicad as any).measureVolume(cut);
         if (vol && vol > 1e-10) inside = 1;
         cut.delete();
         s.delete();
      } catch {}
    }
    return { __multi: true, values: { isInside: inside } };
  },
  SelectionMeasure: (_params, inputs) => {
    const sel = inputs.find(i => i.targetHandle === 'selection')?.value;
    let v = 0;
    let cx = 0, cy = 0, cz = 0;
    let count = 0;
    if (sel && sel.elements && sel.elements.length > 0) {
      for (const e of sel.elements) {
        v += (sel.domain === 'faces' ? e.area : e.length) || 0;
        if (e.centroid) {
           cx += e.centroid[0]; cy += e.centroid[1]; cz += e.centroid[2];
           count++;
        }
      }
      if (count > 0) {
         cx /= count; cy /= count; cz /= count;
      }
    }
    return { __multi: true, values: { areaOrLength: v, centroid: { type: 'Point', x: cx, y: cy, z: cz } } };
  },
  CurveLength: (_params, inputs) => {
    const curve = inputs.find(i => i.targetHandle === 'curve')?.value;
    let L = 0;
    if (curve && curve.type === 'Curve') {
      try {
         L = curve.value.length;
      } catch {}
    }
    return { __multi: true, values: { length: L } };
  },
  PointOnCurve: (params, inputs) => {
    const curve = inputs.find(i => i.targetHandle === 'curve')?.value;
    let t = num(params.t, 0.5);
    let p = { type: 'Point', x: 0, y: 0, z: 0 };
    if (curve && curve.type === 'Curve') {
       try {
         const pt = curve.value.pointAt(Math.max(0, Math.min(1, t)));
         p = { type: 'Point', x: pt[0], y: pt[1], z: pt[2] };
       } catch {}
    }
    return p;
  },
  EvaluateCurve: (params, inputs) => {
    const curve = inputs.find(i => i.targetHandle === 'curve')?.value;
    let t = num(params.t, 0.5);
    let p = { type: 'Point', x: 0, y: 0, z: 0 };
    let v = { type: 'Vector', x: 1, y: 0, z: 0 };
    if (curve && curve.type === 'Curve') {
       try {
         t = Math.max(0, Math.min(1, t));
         const pt = curve.value.pointAt(t);
         const tan = curve.value.tangentAt(t);
         p = { type: 'Point', x: pt[0], y: pt[1], z: pt[2] };
         v = { type: 'Vector', x: tan[0], y: tan[1], z: tan[2] };
       } catch {}
    }
    return { __multi: true, values: { point: p, tangent: v } };
  },
  DivideCurve: (params, inputs) => {
    const curve = inputs.find(i => i.targetHandle === 'curve')?.value;
    const count = Math.max(2, Math.round(num(params.count, 10)));
    const pts = [];
    if (curve && curve.type === 'Curve') {
       try {
         for (let i = 0; i < count; i++) {
           const t = i / (count - 1);
           const pt = curve.value.pointAt(t);
           pts.push({ type: 'Point', x: pt[0], y: pt[1], z: pt[2] });
         }
       } catch {}
    }
    return { __multi: true, values: { points: pts } };
  },
  PointGrid: (params) => {
    const nx = Math.max(1, Math.round(num(params.countX, 5)));
    const ny = Math.max(1, Math.round(num(params.countY, 5)));
    const sx = num(params.spacingX, 2);
    const sy = num(params.spacingY, 2);
    const pts = [];
    const ox = -((nx - 1) * sx) / 2;
    const oy = -((ny - 1) * sy) / 2;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < ny; j++) {
        pts.push({ type: 'Point', x: ox + i * sx, y: oy + j * sy, z: 0 });
      }
    }
    return { __multi: true, values: { points: pts } };
  },
  Jitter: (params, inputs) => {
    const pts = inputs.find(i => i.targetHandle === 'points')?.value || [];
    const arr = Array.isArray(pts) ? pts : [pts];
    const amount = num(params.amount, 0.5);
    const seed = num(params.seed, 42);
    
    let s = seed;
    const rand = () => {
      s = Math.sin(s) * 10000;
      return s - Math.floor(s);
    };

    const jpts = arr.map(p => {
       if (p && p.type === 'Point') {
          return { type: 'Point', 
            x: p.x + (rand() * 2 - 1) * amount,
            y: p.y + (rand() * 2 - 1) * amount,
            z: p.z + (rand() * 2 - 1) * amount
          };
       }
       return p;
    });
    return { __multi: true, values: { points: jpts } };
  }
};
