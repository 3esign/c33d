import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

async function main() {
  const init = opencascade.default || opencascade;
  const OC = await init();
  replicad.setOC(OC);

  console.log("1. Slicing box...");
  const box = replicad.makeBox([-5, -5, -5], [5, 5, 5]);
  const splitZ = -2;

  const b1 = replicad.makeBox([-6, -6, -6], [6, 6, splitZ]);
  const b2 = replicad.makeBox([-6, -6, -2], [6, 6, 6]);

  const bottomHalf = box.intersect(b1);
  const topHalf = box.intersect(b2);
  const compound = replicad.makeCompound([bottomHalf, topHalf]);

  console.log("2. Sliced compound created. Selecting a side face...");
  // Let's find a side face on the bottom half.
  const targetFace = compound.faces.find(f => {
    const norm = f.normalAt().toTuple();
    const isNormalX = Math.abs(norm[0] - 1) < 1e-3;
    const isBelowSplit = f.center.toTuple()[2] < splitZ;
    return isNormalX && isBelowSplit;
  });

  if (!targetFace) {
    throw new Error("Could not find the target split face!");
  }

  const centroid = targetFace.center.toTuple();
  const normal = targetFace.normalAt().toTuple();
  console.log("3. Target face found. Centroid:", centroid, "Normal:", normal);

  console.log("4. Creating Sketch from outerWire() and extruding...");
  const wire = targetFace.outerWire();
  const sketch = new replicad.Sketch(wire);
  const prism = sketch.extrude(3.0, { extrusionDirection: normal });
  const prismVol = replicad.measureVolume(prism);
  console.log("Prism created. Volume:", prismVol.toFixed(3));
  // The selected face is 10 (y) x 3 (z) = 30, extruded 3.0 outward -> 90.
  assert.ok(Math.abs(prismVol - 90) / 90 < 0.01,
    `prism volume should be ~90 (10x3 face extruded 3), got ${prismVol.toFixed(3)}`);

  console.log("5. Fusing prism back onto the compound solid...");
  const fused = compound.fuse(prism);
  const fusedVol = replicad.measureVolume(fused);
  console.log("6. Fused solid created successfully! Volume:", fusedVol.toFixed(3));
  // Original 10x10x10 box (1000) + the outward prism (90), no overlap -> 1090.
  assert.ok(Math.abs(fusedVol - 1090) / 1090 < 0.01,
    `fused volume should be ~1090 (1000 box + 90 prism), got ${fusedVol.toFixed(3)}`);
  console.log("7. Done!");
}

main().catch(err => {
  console.error("FATAL ERROR IN TEST:", err);
  process.exitCode = 1;
});
