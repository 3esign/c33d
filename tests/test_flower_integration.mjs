// Flower assembly integration test — drives the REAL src/worker/deformation.ts
// (safeRotate / safeTranslate / nonUniformScale, the helpers the executors
// use), replacing a "verbatim copy" that had already drifted from source (the
// shipped nonUniformScale subdivides; the copy did not).
//
// The result log goes to scratch/ for eyeballing, but scratch/ is gitignored:
// the directory is created on demand and the test must pass on a fresh clone.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';
import fs from 'fs';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

// ---- resolve hook: let Node follow the app's extensionless .ts imports ------
const hookDir = mkdtempSync(join(tmpdir(), 'c33d-ts-'));
const hookPath = join(hookDir, 'ts-resolve.mjs');
fs.writeFileSync(hookPath, `
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
export function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\\.[a-z]+$/i.test(specifier)) {
    for (const ext of ['.ts', '.tsx']) {
      try {
        const r = new URL(specifier + ext, context.parentURL);
        if (existsSync(fileURLToPath(r))) return { url: r.href, shortCircuit: true };
      } catch { /* fall through */ }
    }
  }
  return nextResolve(specifier, context);
}
`);
register(pathToFileURL(hookPath));

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';
const { safeRotate, safeTranslate, nonUniformScale } = await import('../src/worker/deformation.ts');

const log = [];
function say(...a) { log.push(a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' ')); console.log(...a); }
function writeLog() {
  try {
    const dir = join(projectRoot, 'scratch');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(join(dir, 'flower_integration_result.txt'), log.join('\n'));
  } catch (e) {
    console.warn('could not write scratch log (non-fatal):', e?.message);
  }
}

// Same shape the Ellipsoid executor builds: a sphere pushed through the
// real deformed-mesh scale.
function makeEllipsoid(rx, ry, rz) {
  const base = replicad.makeSphere(rx);
  if (Math.abs(ry-rx) < 1e-9 && Math.abs(rz-rx) < 1e-9) return base;
  return nonUniformScale(base, 1, ry/rx, rz/rx);
}

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  const bloomRadius = 10, stemHeight = 30, petalCount = 8;
  const parts = [];

  say('Building stem (Cylinder)...');
  const stem = replicad.makeCylinder(0.9, stemHeight, [0,0,0]);
  parts.push({ name: 'stem', shape: stem });

  say('Building center (Sphere)...');
  const center = replicad.makeSphere(bloomRadius*0.2).translate([0,0,stemHeight]);
  parts.push({ name: 'center', shape: center });

  say('Building', petalCount, 'outer petals (Ellipsoid + CircularPattern, tilted)...');
  const outerPetalBase = makeEllipsoid(bloomRadius*0.12, bloomRadius*0.32, bloomRadius*0.05);
  const tilted = safeRotate(outerPetalBase, 70, outerPetalBase.boundingBox.center, [1,0,0]);
  const lifted = safeTranslate(tilted, [0, bloomRadius*0.28, stemHeight]);
  const outerCopies = [];
  for (let i = 0; i < petalCount; i++) {
    const angle = (360/petalCount)*i;
    const rotated = safeRotate(lifted, angle, [0,0,stemHeight], [0,0,1]);
    outerCopies.push(rotated);
  }
  parts.push({ name: 'outerPetals', shape: replicad.makeCompound(outerCopies) });

  say('Building', petalCount, 'sepal ring (smaller, green, phase offset)...');
  const sepalBase = makeEllipsoid(bloomRadius*0.10, bloomRadius*0.26, bloomRadius*0.04);
  const sepalTilted = safeRotate(sepalBase, 80, sepalBase.boundingBox.center, [1,0,0]);
  const sepalLifted = safeTranslate(sepalTilted, [0, bloomRadius*0.24, stemHeight - bloomRadius*0.02]);
  const sepalCopies = [];
  const phase = 180 / petalCount;
  for (let i = 0; i < petalCount; i++) {
    const angle = (360/petalCount)*i + phase;
    sepalCopies.push(safeRotate(sepalLifted, angle, [0,0,stemHeight], [0,0,1]));
  }
  parts.push({ name: 'sepals', shape: replicad.makeCompound(sepalCopies) });

  say('Building stamens (small spheres ring)...');
  const stamenBase = replicad.makeSphere(bloomRadius*0.045).translate([0, bloomRadius*0.1, stemHeight + bloomRadius*0.22]);
  const stamenCopies = [];
  for (let i = 0; i < 10; i++) {
    stamenCopies.push(safeRotate(stamenBase, (360/10)*i, [0,0,stemHeight], [0,0,1]));
  }
  parts.push({ name: 'stamens', shape: replicad.makeCompound(stamenCopies) });

  const elapsed = Date.now() - t0;
  say('');
  say('=== RESULTS (total build time: ' + elapsed + 'ms) ===');
  let sceneMin = [Infinity,Infinity,Infinity], sceneMax = [-Infinity,-Infinity,-Infinity];
  const failedParts = [];
  for (const p of parts) {
    try {
      const vol = replicad.measureVolume(p.shape);
      const bb = p.shape.boundingBox.bounds;
      for (let k=0;k<3;k++){ sceneMin[k]=Math.min(sceneMin[k],bb[0][k]); sceneMax[k]=Math.max(sceneMax[k],bb[1][k]); }
      say(p.name, ': volume=' + vol.toFixed(2), ' bbox=' + JSON.stringify(bb));
      assert.ok(Number.isFinite(vol) && vol > 0, `${p.name} must have positive finite volume, got ${vol}`);
    } catch (e) {
      say(p.name, ': FAILED -', e.message);
      failedParts.push(`${p.name}: ${e.message}`);
    }
  }
  assert.strictEqual(failedParts.length, 0,
    `every part must build and measure: ${failedParts.join(' | ')}`);

  const expectedHeight = stemHeight + bloomRadius*0.5;
  say('scene bbox min=' + JSON.stringify(sceneMin) + ' max=' + JSON.stringify(sceneMax));
  say('scene height (should be ~' + expectedHeight.toFixed(1) + '): ' + sceneMax[2].toFixed(1));
  // The bloom sits on top of the stem: petals/stamens must land ABOVE the stem
  // top, roughly half a bloom radius up — the assembly must not collapse to
  // the origin or explode.
  assert.ok(Math.abs(sceneMax[2] - expectedHeight) < bloomRadius * 0.3,
    `scene top should be ~${expectedHeight.toFixed(1)}, got ${sceneMax[2].toFixed(1)}`);
  assert.ok(sceneMin[2] > -1e-6 - 0.001, `scene must sit on the ground plane, min Z ${sceneMin[2]}`);
  // The petal rings spread radially well beyond the stem (r=0.9) and the
  // bloom center sphere (r=2).
  assert.ok(sceneMax[0] > bloomRadius * 0.3 && sceneMax[1] > bloomRadius * 0.3,
    `petal rings must spread radially, got max X ${sceneMax[0].toFixed(1)} / Y ${sceneMax[1].toFixed(1)}`);

  say('');
  say('All flower integration assertions passed.');
  writeLog();
}
run().catch(e => {
  log.push('FATAL: ' + (e.stack||e));
  writeLog();
  console.error(e);
  process.exitCode = 1;
});
