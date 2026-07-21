import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';
import assert from 'assert';

// WASM test for the Jul-20 S2 geometric sockets
// (src/worker/executors.ts::socketXYZ / orientAndPlace, Rotate pivot).
// The repo's tests are self-contained: the executor helpers are mirrored here
// against the real kernel, pinning the math the executors now implement.

function safeTranslate(shape, v) { return shape.translate(v); }
function safeRotate(shape, angleDeg, origin, axis) { return shape.rotate(angleDeg, origin, axis); }

function socketXYZ(inputs, handle) {
  const raw = inputs?.find((i) => i.targetHandle === handle)?.value;
  const v = Array.isArray(raw) ? raw.find((e) => e && (e.type === 'Point' || e.type === 'Vector')) : raw;
  if (!v || (v.type !== 'Point' && v.type !== 'Vector')) return null;
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

function orientAndPlace(shape, inputs) {
  if (!shape || !inputs || inputs.length === 0) return shape;
  let out = shape;
  const axis = socketXYZ(inputs, 'axis');
  if (axis) {
    const len = Math.hypot(axis.x, axis.y, axis.z);
    if (len > 1e-12) {
      const dz = axis.z / len;
      const angleDeg = (Math.acos(Math.max(-1, Math.min(1, dz))) * 180) / Math.PI;
      if (angleDeg > 1e-9) {
        let rx = -axis.y / len, ry = axis.x / len;
        if (Math.hypot(rx, ry) < 1e-12) { rx = 1; ry = 0; }
        out = safeRotate(out, angleDeg, [0, 0, 0], [rx, ry, 0]);
      }
    }
  }
  const c = socketXYZ(inputs, 'center');
  if (c && (c.x || c.y || c.z)) out = safeTranslate(out, [c.x, c.y, c.z]);
  return out;
}

const near = (a, b, tol = 1e-4) => Math.abs(a - b) < tol;

async function main() {
  const OC = await opencascade();
  replicad.setOC(OC);

  // ---- 1. Sphere with a "center" Point lands centered there.
  {
    const s = orientAndPlace(replicad.makeSphere(2), [
      { targetHandle: 'center', value: { type: 'Point', x: 10, y: -4, z: 5 } },
    ]);
    const c = s.boundingBox.center;
    assert.ok(near(c[0], 10) && near(c[1], -4) && near(c[2], 5), `sphere center ${c}`);
  }

  // ---- 2. Cylinder with axis +X lies along X (bbox long in X, height 20).
  {
    const cyl = orientAndPlace(replicad.makeCylinder(1, 20, [0, 0, -10]), [
      { targetHandle: 'axis', value: { type: 'Vector', x: 1, y: 0, z: 0 } },
    ]);
    const [mn, mx] = cyl.boundingBox.bounds;
    assert.ok(near(mx[0] - mn[0], 20, 1e-2), `cylinder X extent ${mx[0] - mn[0]}`);
    assert.ok(near(mx[2] - mn[2], 2, 1e-2), `cylinder Z extent ${mx[2] - mn[2]}`);
  }

  // ---- 3. axis ∥ -Z (degenerate 180°) must not crash; still Z-aligned.
  {
    const cyl = orientAndPlace(replicad.makeCylinder(1, 8, [0, 0, -4]), [
      { targetHandle: 'axis', value: { type: 'Vector', x: 0, y: 0, z: -1 } },
    ]);
    const [mn, mx] = cyl.boundingBox.bounds;
    assert.ok(near(mx[2] - mn[2], 8, 1e-2), `flipped cylinder Z extent ${mx[2] - mn[2]}`);
  }

  // ---- 4. axis + center compose: orient first, then place.
  {
    const cyl = orientAndPlace(replicad.makeCylinder(1, 10, [0, 0, -5]), [
      { targetHandle: 'axis', value: { type: 'Vector', x: 0, y: 1, z: 0 } },
      { targetHandle: 'center', value: { type: 'Point', x: 0, y: 0, z: 7 } },
    ]);
    const c = cyl.boundingBox.center;
    const [mn, mx] = cyl.boundingBox.bounds;
    assert.ok(near(c[2], 7, 1e-2), `composed center z ${c[2]}`);
    assert.ok(near(mx[1] - mn[1], 10, 1e-2), `composed Y extent ${mx[1] - mn[1]}`);
  }

  // ---- 5. Rotate about a pivot: box at x=10 rotated 180° around Z through
  // pivot (10,0,0) stays put; around origin it would flip to x=-10.
  {
    const box = replicad.makeBox([9, -1, -1], [11, 1, 1]);
    const rotated = safeRotate(box, 180, [10, 0, 0], [0, 0, 1]);
    const c = rotated.boundingBox.center;
    assert.ok(near(c[0], 10, 1e-3), `pivot rotate keeps center at x=10, got ${c[0]}`);
  }

  // ---- 6. socketXYZ ignores non-Point/Vector garbage (a Solid wired into
  // "center" must not throw and must not move the shape).
  {
    const s = orientAndPlace(replicad.makeSphere(3), [
      { targetHandle: 'center', value: { some: 'solid-like-object' } },
    ]);
    const c = s.boundingBox.center;
    assert.ok(near(c[0], 0) && near(c[1], 0) && near(c[2], 0), 'garbage center ignored');
  }

  console.log('test_geometric_sockets: all 6 kernel contracts PASS');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
