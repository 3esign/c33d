import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import assert from 'assert';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';

// Simple mock/replica of collectShapes and eviction from geometryWorker.ts (WITH THE FIXED MITIGATION)
function collectShapes(val, out = new Set()) {
  if (!val) return out;
  if (val.wrapped && typeof val.delete === 'function') {
    out.add(val);
    return out;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectShapes(item, out);
  } else if (typeof val === 'object') {
    for (const key of Object.keys(val)) collectShapes(val[key], out);
  }
  return out;
}

async function main() {
  const init = opencascade.default || opencascade;
  const OC = await init();
  replicad.setOC(OC);

  console.log("=== Running Repro 1 (FIXED): Box -> Oversized Fillet -> Parameter Change ===");

  const customShapeCache = new Map();

  // Helper for simulating one evaluation round
  function evaluate(nodes, nodeHashes) {
    const liveIds = new Set(nodes.map(n => n.id));
    const nodeCache = {};

    // 1. Execute nodes
    for (const node of nodes) {
      // Check if cache has it and hash matches
      const cached = customShapeCache.get(node.id);
      if (cached && cached.hash === nodeHashes[node.id]) {
        nodeCache[node.id] = cached.shape;
        console.log(`Reused cached node: ${node.id}`);
        continue;
      }

      if (node.type === 'Box') {
        const s = node.size;
        nodeCache[node.id] = replicad.makeBox([-s/2, -s/2, -s/2], [s/2, s/2, s/2]);
        console.log(`Evaluated node: ${node.id}, pointer:`, nodeCache[node.id].wrapped?.$$.ptr);
      } else if (node.type === 'Fillet') {
        const input = nodeCache[node.inputId];
        // Simulate fillet failure and clone pass-through
        nodeCache[node.id] = input.clone();
        console.log(`Evaluated node: ${node.id}, pointer:`, nodeCache[node.id].wrapped?.$$.ptr);
      }
      customShapeCache.set(node.id, { hash: nodeHashes[node.id], shape: nodeCache[node.id] });
    }

    // 2. Eviction
    const retainedShapes = new Set();
    for (const [id, entry] of customShapeCache) {
      if (liveIds.has(id) && entry.hash === nodeHashes[id]) {
        collectShapes(entry.shape, retainedShapes);
      }
    }
    console.log("Retained shape pointers:", Array.from(retainedShapes).map(s => s.wrapped?.$$.ptr));

    for (const [id, entry] of Array.from(customShapeCache.entries())) {
      const stale = !liveIds.has(id) || entry.hash !== nodeHashes[id];
      if (stale) {
        console.log(`Evicting stale node: ${id}`);
        if (entry.shape) {
          const toDelete = collectShapes(entry.shape);
          for (const s of toDelete) {
            console.log("Stale shape pointer:", s.wrapped?.$$.ptr, "is retained:", retainedShapes.has(s));
            if (!retainedShapes.has(s)) {
              // FIXED MITIGATION: we do not call delete()
              console.log("Skipping delete() on pointer:", s.wrapped?.$$.ptr, "to prevent corruption.");
              // try { s.delete(); } catch (e) {}
            }
          }
        }
        customShapeCache.delete(id);
      }
    }

    return nodeCache;
  }

  // --- ROUND 1 ---
  const nodes1 = [
    { id: 'box', type: 'Box', size: 10 },
    { id: 'fillet', type: 'Fillet', radius: 20, inputId: 'box' }
  ];
  const hashes1 = { box: 'h_box_10', fillet: 'h_fillet_20_box_10' };

  console.log("Evaluating Round 1...");
  const cache1 = evaluate(nodes1, hashes1);

  // Verify meshes work
  assert.ok(cache1.box.mesh());
  assert.ok(cache1.fillet.mesh());
  console.log("Round 1 mesh OK.");

  // --- ROUND 2: Change only fillet radius ---
  const nodes2 = [
    { id: 'box', type: 'Box', size: 10 }, // box remains 10 (reused from cache)
    { id: 'fillet', type: 'Fillet', radius: 25, inputId: 'box' } // fillet radius changed to 25
  ];
  const hashes2 = { box: 'h_box_10', fillet: 'h_fillet_25_box_10' };

  console.log("Evaluating Round 2...");
  const cache2 = evaluate(nodes2, hashes2);

  // Verify meshes work
  console.log("Checking if Round 2 shapes are deleted...");
  try {
    const boxMesh = cache2.box.mesh();
    const filletMesh = cache2.fillet.mesh();
    console.log("SUCCESS: Round 2 shapes were NOT deleted and mesh succeeded! Vertices:", boxMesh.vertices.length, filletMesh.vertices.length);
  } catch (e) {
    console.log("Repro 1 CRASHED unexpectedly:", e.message);
    process.exit(1);
  }

  console.log("\n=== Running Repro 2: Build -> Clear-All -> Rebuild same ids ===");
  const cache3 = new Map();
  
  // Build
  const boxShape = replicad.makeBox([-5, -5, -5], [5, 5, 5]);
  cache3.set('hull', { hash: 'h_hull_10', shape: boxShape });
  
  // Clear-all simulation (fixed to not delete)
  for (const id of Array.from(cache3.keys())) {
    cache3.delete(id);
  }
  
  // Rebuild same id
  const boxShapeNew = replicad.makeBox([-5, -5, -5], [5, 5, 5]);
  cache3.set('hull', { hash: 'h_hull_10', shape: boxShapeNew });
  
  try {
    const mesh = boxShapeNew.mesh();
    console.log("Repro 2 success! Vertices:", mesh.vertices.length);
  } catch (e) {
    console.log("Repro 2 CRASHED:", e.message);
    process.exit(1);
  }
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
