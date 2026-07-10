import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';

// Setup compatibility environment
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';

async function main() {
  const init = opencascade.default || opencascade;
  const OC = await init();
  const classes = [
    'BRepAlgoAPI_Splitter',
    'BRepFeat_SplitShape',
    'BRepFeat_MakePrism',
    'BRepAlgoAPI_Section',
    'BRepAlgoAPI_BooleanOperation'
  ];

  console.log("=== WASM Bundle Audit ===");
  for (const cls of classes) {
    console.log(`${cls}:`, typeof OC[cls] !== 'undefined');
  }
}

main().catch(console.error);
