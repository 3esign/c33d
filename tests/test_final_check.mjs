// Realistic deformation scenarios against the REAL src/worker/deformation.ts
// (subdivided bend path — the shipped Bend node), replacing a hand-copied
// replica that could neither fail nor drift-detect.
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
const { bendShape, solidFromDeformedMesh } = await import('../src/worker/deformation.ts');

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);
  const t0 = Date.now();

  console.log('=== REALISTIC: petal (ellipsoid-derived) bent 35deg ===');
  const petalBase = replicad.makeSphere(3);
  const petal = solidFromDeformedMesh(petalBase, (x,y,z) => [x, y*2.2, z*0.25], 0.1);
  const preBendVol = replicad.measureVolume(petal); const petalMoved = petal.translate([0, 6.6, 0]);
  const t1 = Date.now();
  const bent = bendShape(petalMoved, 'Y', 35);
  const postBendVol = replicad.measureVolume(bent);
  console.log('bend time:', Date.now()-t1, 'ms');
  console.log('pre-bend volume:', preBendVol.toFixed(2));
  console.log('post-bend volume:', postBendVol.toFixed(2), '(should be reasonably close, not collapsed)');
  console.log('post-bend bbox:', JSON.stringify(bent.boundingBox.bounds));
  assert.ok(preBendVol > 0, 'pre-bend petal must have positive volume');
  assert.ok(Math.abs(postBendVol - preBendVol) / preBendVol < 0.10,
    `bend must roughly preserve volume: pre ${preBendVol.toFixed(2)} vs post ${postBendVol.toFixed(2)}`);

  console.log('');
  console.log('=== REALISTIC: horn (cylinder) bent 30deg ===');
  const hornCyl = replicad.makeCylinder(1.5, 15, [0,0,0]);
  const expectedHorn = Math.PI * 1.5 * 1.5 * 15;
  const t2 = Date.now();
  const horn = bendShape(hornCyl, 'Z', 30); // slight bend for realism
  const hornVol = replicad.measureVolume(horn);
  console.log('cylinder-bend time:', Date.now()-t2, 'ms, volume:', hornVol.toFixed(2), '(orig ~', expectedHorn.toFixed(1), ')');
  assert.ok(Math.abs(hornVol - expectedHorn) / expectedHorn < 0.15,
    `bent horn volume should stay within 15% of the cylinder's ${expectedHorn.toFixed(1)}, got ${hornVol.toFixed(2)}`);

  console.log('');
  console.log('total elapsed:', Date.now()-t0, 'ms');
  console.log('All final-check assertions passed.');
}
run().catch(e => { console.error('FAILED:', e.stack || e); process.exitCode = 1; });
