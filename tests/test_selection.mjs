import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// Setup node module resolution compatibility
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';
import * as replicad from 'replicad';
import assert from 'assert';

// Import executors
import { EXECUTORS } from '../src/worker/executors.ts';

async function run() {
  const OC = await opencascade();
  replicad.setOC(OC);

  console.log('=== Test 1: SplitLoop along X and Y ===');
  // Create a centered 12x12x12 Box
  const cubeCentered = replicad.makeBox([-6, -6, -6], [6, 6, 6]);

  console.log('Initial cube volume:', replicad.measureVolume(cubeCentered).toFixed(2));
  console.log('Initial face count:', cubeCentered.faces.length);
  assert.strictEqual(cubeCentered.faces.length, 6);

  // Split X at 1/3 (at = 0.333) and 2/3 (at = 0.667)
  const warn = (msg) => console.log('WARN:', msg);
  const inputs1 = [{ targetHandle: 'solid', value: cubeCentered }];
  const split1 = EXECUTORS.SplitLoop({ axis: 'X', at: 0.333 }, inputs1, warn);
  
  const inputs2 = [{ targetHandle: 'solid', value: split1 }];
  const split2 = EXECUTORS.SplitLoop({ axis: 'X', at: 0.667 }, inputs2, warn);

  // Split Y at 1/3 and 2/3
  const inputs3 = [{ targetHandle: 'solid', value: split2 }];
  const split3 = EXECUTORS.SplitLoop({ axis: 'Y', at: 0.333 }, inputs3, warn);

  const inputs4 = [{ targetHandle: 'solid', value: split3 }];
  const split4 = EXECUTORS.SplitLoop({ axis: 'Y', at: 0.667 }, inputs4, warn);

  console.log('Split cube face count:', split4.faces.length);
  assert.ok(split4.faces.length > 6, 'Face count should increase after splits');

  console.log('=== Test 2: SelectFaces Query matching Center Top Face ===');
  // Top center face has normal Z near +1 (normal ~ +Z), center.x in [-2, 2], center.y in [-2, 2]
  split4.sourceNodeId = 'split4';
  
  const selectionInputs = [{ targetHandle: 'solid', value: split4 }];
  const selectionParams = {
    predicate: 'normal ~ +Z and center.x > -2 and center.x < 2 and center.y > -2 and center.y < 2',
    tolerance: 0.1
  };
  const selectionDescriptor = EXECUTORS.SelectFaces(selectionParams, selectionInputs, warn, { size: 12 });
  
  console.log('Selection Descriptor:', selectionDescriptor);
  assert.strictEqual(selectionDescriptor.type, 'Selection');
  assert.strictEqual(selectionDescriptor.domain, 'faces');

  console.log('=== Test 3: ExtrudeFace of selected Center Top Face ===');
  const extrudeInputs = [
    { targetHandle: 'solid', value: split4 },
    { targetHandle: 'selection', value: selectionDescriptor }
  ];
  const extrudeParams = { height: 4 };
  const finalSolid = EXECUTORS.ExtrudeFace(extrudeParams, extrudeInputs, warn, { size: 12 });

  const finalVolume = replicad.measureVolume(finalSolid);
  console.log('Final extruded volume:', finalVolume.toFixed(2));
  
  // The original cube volume is 12^3 = 1728.
  // The center face is 4x4 = 16.
  // Extruding it by 4 adds 16 * 4 = 64 units of volume.
  // So the final volume should be exactly 1728 + 64 = 1792.
  console.log('Expected final volume: 1792');
  assert.ok(Math.abs(finalVolume - 1792) < 1.0, `Volume should be close to 1792, got ${finalVolume}`);
  
  console.log('All Selection & Modifier tests PASSED!');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
