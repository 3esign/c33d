import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);
import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

function safeTranslate(shape, vector) {
  const transform = new replicad.Transformation();
  transform.translate(vector);
  const rawShape = transform.transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}
function safeRotate(shape, angle, position = [0,0,0], direction = [0,0,1]) {
  const transform = new replicad.Transformation();
  transform.rotate(angle, position, direction);
  const rawShape = transform.transform(shape.wrapped);
  transform.delete();
  return replicad.cast(rawShape);
}

// Minimal path-points extractor: enough to get the first two anchor points
// for initial-tangent computation (M start, then first L/C/Q endpoint).
function extractFirstTwoPoints(pathStr) {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g) || [];
  const pts = [];
  let i = 0, cur = [0,0];
  while (i < tokens.length && pts.length < 2) {
    const cmd = tokens[i++];
    if (cmd === 'M' || cmd === 'm') { cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; pts.push([...cur]); }
    else if (cmd === 'L' || cmd === 'l') { cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; pts.push([...cur]); }
    else if (cmd === 'C' || cmd === 'c') { i += 4; cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; pts.push([...cur]); }
    else if (cmd === 'Q' || cmd === 'q') { i += 2; cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; pts.push([...cur]); }
    else break;
  }
  return pts;
}

function parseSVGPath(pathStr) {
  const tokens = pathStr.match(/[a-zA-Z]+|[-+]?[0-9]*\.?[0-9]+/g);
  if (!tokens) return new replicad.Sketcher("XY").done();
  let sketch = new replicad.Sketcher("XY");
  let i = 0, cur = [0,0];
  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') { cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; sketch.movePointerTo(cur); }
    else if (cmd === 'L') { cur = [parseFloat(tokens[i++]), parseFloat(tokens[i++])]; sketch.lineTo(cur); }
    else if (cmd === 'C') {
      const cp1=[parseFloat(tokens[i++]),parseFloat(tokens[i++])], cp2=[parseFloat(tokens[i++]),parseFloat(tokens[i++])];
      cur=[parseFloat(tokens[i++]),parseFloat(tokens[i++])];
      sketch.cubicBezierCurveTo(cur, cp1, cp2);
    }
    else if (cmd === 'Q') {
      const cp1=[parseFloat(tokens[i++]),parseFloat(tokens[i++])];
      cur=[parseFloat(tokens[i++]),parseFloat(tokens[i++])];
      sketch.quadraticBezierCurveTo(cur, cp1);
    }
    else if (cmd === 'Z' || cmd === 'z') { sketch.close(); }
    else break;
  }
  return sketch.done();
}

function buildPipe(pathSvg, radius) {
  const pathSketch = parseSVGPath(pathSvg);
  const wires = pathSketch.wires();
  const wireObj = Array.isArray(wires) ? wires[0] : wires;
  const wire = wireObj.wrapped;

  const pts = extractFirstTwoPoints(pathSvg);
  let angle = 0;
  if (pts.length >= 2) {
    const dx = pts[1][0]-pts[0][0], dy = pts[1][1]-pts[0][1];
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) angle = Math.atan2(dy, dx) * 180 / Math.PI;
  }
  let profileFace = replicad.drawCircle(radius).sketchOnPlane('YZ').face();
  if (Math.abs(angle) > 1e-9) profileFace = safeRotate(profileFace, angle, [0,0,0], [0,0,1]);
  const start = pts[0] || [0,0];
  if (Math.abs(start[0]) > 1e-9 || Math.abs(start[1]) > 1e-9) profileFace = safeTranslate(profileFace, [start[0], start[1], 0]);

  const OC = replicad.getOC();
  const maker = new OC.BRepOffsetAPI_MakePipe_1(wire, profileFace.wrapped);
  const shape = maker.Shape();
  return replicad.cast(shape);
}

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);

  console.log('=== Pipe 1: S-curve stem, starts at origin trending +X ===');
  const p1 = buildPipe('M 0 0 C 5 10 15 -10 20 0', 0.8);
  console.log('volume:', replicad.measureVolume(p1).toFixed(2), 'bbox:', JSON.stringify(p1.boundingBox.bounds));

  console.log('=== Pipe 2: vine trending mostly +Y, NOT starting at origin ===');
  const p2 = buildPipe('M 10 10 Q 15 20 10 30', 0.5);
  console.log('volume:', replicad.measureVolume(p2).toFixed(2), 'bbox:', JSON.stringify(p2.boundingBox.bounds));

  console.log('=== Pipe 3: tentacle curling backward (tests non-trivial tangent) ===');
  const p3 = buildPipe('M 0 0 C -10 5 -15 15 -5 20', 0.4);
  console.log('volume:', replicad.measureVolume(p3).toFixed(2), 'bbox:', JSON.stringify(p3.boundingBox.bounds));
}
run().catch(e => console.error('FATAL:', e.stack || e));
