// Bend/Twist deformation contracts — driving the REAL src/worker/deformation.ts
// (the module the Bend and Twist nodes execute), not a local copy.
//
// The previous version of this file replicated a pre-subdivision draft of the
// deform code and could not fail (.catch(console.error), no assertions). Its
// own printed expectations were false for the replica — "expect ~320" measured
// 203.7 — because deforming only a coarse box mesh's corner vertices shears
// instead of bending. The shipped module bisects triangles to a curvature-
// driven edge length first, and hits the analytic volumes to within a few
// percent; the assertions below hold it to that.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

// ---- resolve hook: let Node follow the app's extensionless .ts imports ------
const hookDir = mkdtempSync(join(tmpdir(), 'c33d-ts-'));
const hookPath = join(hookDir, 'ts-resolve.mjs');
writeFileSync(hookPath, `
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
const { bendShape, twistShape, solidFromDeformedMesh } = await import('../src/worker/deformation.ts');

let checks = 0;
const near = (label, got, want, relTol) => {
  const rel = Math.abs(got - want) / Math.abs(want);
  assert.ok(rel <= relTol, `${label}: got ${got.toFixed(2)}, want ~${want} (off by ${(rel * 100).toFixed(1)}%, tolerance ${relTol * 100}%)`);
  checks++;
};
const ok = (label, cond, extra) => { assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); checks++; };

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  console.log('=== BEND test: box 4x4x20 bent 90deg around X (should curl into Z, like an L) ===');
  const box = replicad.makeBox([-2,-2,0],[2,2,20]);
  const bent = bendShape(box, 'X', 90);
  const bentVol = replicad.measureVolume(bent);
  console.log('bent volume (expect ~320, small tessellation loss):', bentVol.toFixed(2));
  console.log('bent bbox:', JSON.stringify(bent.boundingBox.bounds));
  near('bent volume preserves the box volume', bentVol, 320, 0.10);
  {
    // A tall thin bar bent 90deg must now span sideways too: the chord of a
    // 90deg arc of half-length 10 reaches well past the original ±2 in X.
    const bb = bent.boundingBox.bounds;
    ok('bend curls the bar into X', bb[1][0] - bb[0][0] > 10, `X span ${(bb[1][0] - bb[0][0]).toFixed(2)}`);
    ok('bend keeps Z within the original height', bb[1][2] <= 20.5, `Z max ${bb[1][2].toFixed(2)}`);
  }

  console.log('');
  console.log('=== TWIST test: box 10x2x2 (long along X) twisted 180deg around X ===');
  const box2 = replicad.makeBox([0,-1,-1],[10,1,1]);
  const twisted = twistShape(box2, 'X', 180);
  const twistVol = replicad.measureVolume(twisted);
  console.log('twisted volume (expect ~40):', twistVol.toFixed(2));
  console.log('twisted bbox:', JSON.stringify(twisted.boundingBox.bounds));
  near('twist preserves the box volume', twistVol, 40, 0.10);
  console.log('twisted faces:', twisted.faces.length, ' (should be >> 6: flat sides become a triangulated helical surface)');
  ok('twist tessellates the side faces', twisted.faces.length > 100, `${twisted.faces.length} faces`);

  console.log('');
  console.log('=== TWIST test 2: box with RECTANGULAR (non-square) cross-section, 90deg twist -> bbox should grow ===');
  const box3 = replicad.makeBox([0,-3,-1],[10,3,1]); // 6 wide x 2 thick cross-section
  const twisted2 = twistShape(box3, 'X', 90);
  const twist2Vol = replicad.measureVolume(twisted2);
  const bb2 = twisted2.boundingBox.bounds;
  console.log('twisted2 bbox (Y/Z should both grow toward ~3.16 = the cross-section half-diagonal):', JSON.stringify(bb2));
  console.log('twisted2 volume (expect ~120):', twist2Vol.toFixed(2));
  near('rect-twist preserves the box volume', twist2Vol, 120, 0.10);
  // sqrt(3^2 + 1^2) = 3.1623: mid-twist the corners sweep the half-diagonal.
  near('rect-twist grows the Y extent to the half-diagonal', bb2[1][1], 3.1623, 0.05);
  near('rect-twist grows the Z extent to the half-diagonal', bb2[1][2], 3.1623, 0.05);

  console.log('');
  console.log('total time:', Date.now()-t0, 'ms');

  console.log('');
  console.log('=== Petal-like test: Ellipsoid bent (realistic use case) ===');
  const petalBase = replicad.makeSphere(3);
  // ellipsoid via the same deformed-mesh path the Ellipsoid node uses
  const petal = solidFromDeformedMesh(petalBase, (x,y,z) => [x, y*2.5, z*0.3], 0.08);
  const petalVol = replicad.measureVolume(petal);
  console.log('petal (pre-bend) bbox:', JSON.stringify(petal.boundingBox.bounds), 'volume:', petalVol.toFixed(2));
  const petalMoved = petal.translate([0, 7.5, 0]); // move so its base is near origin
  const petalBent = bendShape(petalMoved, 'Y', -40);
  const petalBentVol = replicad.measureVolume(petalBent);
  console.log('petal bent bbox:', JSON.stringify(petalBent.boundingBox.bounds), 'volume:', petalBentVol.toFixed(2));
  near('petal bend preserves volume', petalBentVol, petalVol, 0.10);

  console.log(`\nAll ${checks} bend/twist assertions passed.`);
}
run().catch(e => { console.error('FAILED:', e.stack || e); process.exitCode = 1; });
