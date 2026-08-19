import * as replicad from 'replicad';

const SUPPORTED_CMDS = 'M L H V C S Q T A Z (plus lowercase relative forms)';

// Elliptical arc (SVG A command) → cubic Béziers. Standard endpoint→center
// parameterization (SVG spec B.2.4), then each ≤90° slice is approximated by
// one cubic with the classic k = 4/3·tan(δ/4) control distance. Errors stay
// far below kernel tolerance for slices this small.
function arcToCubics(
  x1: number, y1: number,
  rx: number, ry: number,
  xRotDeg: number,
  largeArc: boolean, sweep: boolean,
  x2: number, y2: number,
): { cp1: [number, number]; cp2: [number, number]; end: [number, number] }[] {
  // Degenerate radii → the spec says draw a straight line (handled by caller).
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-12 || ry < 1e-12) return [];
  const phi = (xRotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);

  // (x1', y1'): midpoint vector in the ellipse frame
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Scale radii up if they cannot span the endpoints
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s; ry *= s;
  }

  // Center in the ellipse frame
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc !== sweep ? 1 : -1) * Math.sqrt(Math.max(0, num / den));
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * (-(ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const angleOf = (ux: number, uy: number, vx: number, vy: number) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.max(-1, Math.min(1, dot / (len || 1))));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angleOf(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angleOf((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

  // Split into ≤90° slices
  const segCount = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2)));
  const delta = dTheta / segCount;
  const k = (4 / 3) * Math.tan(delta / 4);

  const pointAt = (t: number): [number, number] => [
    cx + rx * Math.cos(t) * cosPhi - ry * Math.sin(t) * sinPhi,
    cy + rx * Math.cos(t) * sinPhi + ry * Math.sin(t) * cosPhi,
  ];
  const derivAt = (t: number): [number, number] => [
    -rx * Math.sin(t) * cosPhi - ry * Math.cos(t) * sinPhi,
    -rx * Math.sin(t) * sinPhi + ry * Math.cos(t) * cosPhi,
  ];

  const out: { cp1: [number, number]; cp2: [number, number]; end: [number, number] }[] = [];
  for (let s = 0; s < segCount; s++) {
    const t0 = theta1 + s * delta;
    const t1 = t0 + delta;
    const p0 = pointAt(t0), p1 = pointAt(t1);
    const d0 = derivAt(t0), d1 = derivAt(t1);
    out.push({
      cp1: [p0[0] + k * d0[0], p0[1] + k * d0[1]],
      cp2: [p1[0] - k * d1[0], p1[1] - k * d1[1]],
      end: p1,
    });
  }
  return out;
}

export function parseSVGPath(pathStr: string) {
  // Command letters are matched ONE at a time and 'e'/'E' is excluded so
  // exponent notation ("1.5e-2") tokenizes as a single number instead of
  // splitting into 1.5 / e / -2.
  const tokens = pathStr.match(/[a-df-zA-DF-Z]|[-+]?(?:[0-9]*\.[0-9]+|[0-9]+\.?)(?:[eE][-+]?[0-9]+)?/g);
  if (!tokens || tokens.length === 0) return new replicad.Sketcher("XY").done();

  let sketch = new replicad.Sketcher("XY");
  let i = 0;
  let currentPos: [number, number] = [0, 0];
  // Reflection state for S/s and T/t (SVG spec: reflect the previous control
  // point only when the previous command was of the same curve family).
  let prevCmd = '';
  let prevCubicCp2: [number, number] | null = null;
  let prevQuadCp: [number, number] | null = null;

  const readNum = (cmd: string): number => {
    const t = tokens[i++];
    const v = t === undefined ? NaN : parseFloat(t);
    if (!isFinite(v)) throw new Error(`SVG path command "${cmd}" is missing a numeric argument`);
    return v;
  };

  while (i < tokens.length) {
    const cmd = tokens[i];
    if (/^[a-zA-Z]$/.test(cmd)) {
      i++;
      const isRel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';

      switch (cmd.toUpperCase()) {
        case 'M': {
          const x = readNum(cmd);
          const y = readNum(cmd);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.movePointerTo(currentPos);
          break;
        }
        case 'L': {
          const x = readNum(cmd);
          const y = readNum(cmd);
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          sketch.lineTo(currentPos);
          break;
        }
        case 'H': {
          const x = readNum(cmd);
          currentPos[0] = isRel ? currentPos[0] + x : x;
          sketch.lineTo(currentPos);
          break;
        }
        case 'V': {
          const y = readNum(cmd);
          currentPos[1] = isRel ? currentPos[1] + y : y;
          sketch.lineTo(currentPos);
          break;
        }
        case 'C': {
          const x1 = readNum(cmd);
          const y1 = readNum(cmd);
          const x2 = readNum(cmd);
          const y2 = readNum(cmd);
          const x = readNum(cmd);
          const y = readNum(cmd);

          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          const cp2: [number, number] = isRel ? [currentPos[0] + x2, currentPos[1] + y2] : [x2, y2];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];

          sketch.cubicBezierCurveTo(currentPos, cp1, cp2);
          prevCubicCp2 = cp2;
          break;
        }
        case 'S': {
          // Smooth cubic: cp1 = reflection of the previous cp2 about the
          // current point (or the current point if the previous command was
          // not a cubic).
          const x2 = readNum(cmd);
          const y2 = readNum(cmd);
          const x = readNum(cmd);
          const y = readNum(cmd);

          const reflect = (prevCmd === 'C' || prevCmd === 'S') && prevCubicCp2;
          const cp1: [number, number] = reflect
            ? [2 * currentPos[0] - prevCubicCp2![0], 2 * currentPos[1] - prevCubicCp2![1]]
            : [currentPos[0], currentPos[1]];
          const cp2: [number, number] = isRel ? [currentPos[0] + x2, currentPos[1] + y2] : [x2, y2];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];

          sketch.cubicBezierCurveTo(currentPos, cp1, cp2);
          prevCubicCp2 = cp2;
          break;
        }
        case 'Q': {
          const x1 = readNum(cmd);
          const y1 = readNum(cmd);
          const x = readNum(cmd);
          const y = readNum(cmd);

          const cp1: [number, number] = isRel ? [currentPos[0] + x1, currentPos[1] + y1] : [x1, y1];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];

          sketch.quadraticBezierCurveTo(currentPos, cp1);
          prevQuadCp = cp1;
          break;
        }
        case 'T': {
          // Smooth quadratic: control point = reflection of the previous
          // quadratic control point (or the current point).
          const x = readNum(cmd);
          const y = readNum(cmd);

          const reflect = (prevCmd === 'Q' || prevCmd === 'T') && prevQuadCp;
          const cp1: [number, number] = reflect
            ? [2 * currentPos[0] - prevQuadCp![0], 2 * currentPos[1] - prevQuadCp![1]]
            : [currentPos[0], currentPos[1]];
          currentPos = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];

          sketch.quadraticBezierCurveTo(currentPos, cp1);
          prevQuadCp = cp1;
          break;
        }
        case 'A': {
          const rx = readNum(cmd);
          const ry = readNum(cmd);
          const xRot = readNum(cmd);
          const largeArc = readNum(cmd) !== 0;
          const sweep = readNum(cmd) !== 0;
          const x = readNum(cmd);
          const y = readNum(cmd);

          const end: [number, number] = isRel ? [currentPos[0] + x, currentPos[1] + y] : [x, y];
          const same = Math.abs(end[0] - currentPos[0]) < 1e-12 && Math.abs(end[1] - currentPos[1]) < 1e-12;
          if (!same) {
            const segs = arcToCubics(currentPos[0], currentPos[1], rx, ry, xRot, largeArc, sweep, end[0], end[1]);
            if (segs.length === 0) {
              sketch.lineTo(end); // zero radius: spec says straight line
            } else {
              for (const seg of segs) sketch.cubicBezierCurveTo(seg.end, seg.cp1, seg.cp2);
            }
            currentPos = end;
          }
          break;
        }
        case 'Z': {
          sketch.close();
          break;
        }
        default: {
          throw new Error(`Unsupported SVG path command "${cmd}" — supported: ${SUPPORTED_CMDS}`);
        }
      }
      prevCmd = cmd.toUpperCase();
    } else {
      i++;
    }
  }

  return sketch.done();
}
