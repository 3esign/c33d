// WASM bundle audit — driven by what the worker ACTUALLY uses.
//
// The old version printed true/false for a hand-picked list of classes and
// exited 0 regardless; during the Aug-18 audit it reported three missing
// bindings and still went green. Now the test scans src/worker/*.ts for every
// `OC.<name>` the code references and FAILS (exit 1) if a used binding is
// absent from the shipped kernel — that absence means a node executor throws
// at runtime. Names on the exploratory watchlist that the worker does NOT use
// are still reported, but informationally only.
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { readdirSync, readFileSync } from 'fs';

// Setup compatibility environment
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import opencascade from 'replicad-opencascadejs';

// Bindings the source knowingly treats as optional, with a tested fallback
// path. Their absence is reported but is not a failure.
const KNOWN_GUARDED = new Map([
  ['BRepPrimAPI_MakeCone_1',
    'executors.ts Cone wraps it in try/catch and falls back to a circle loft'],
]);

// Exploratory watchlist: not used by the worker today; presence is useful to
// know when planning features (split/boolean work), so report it — nothing more.
const WATCHLIST = [
  'BRepAlgoAPI_Splitter',
  'BRepFeat_SplitShape',
  'BRepFeat_MakePrism',
  'BRepAlgoAPI_Section',
  'BRepAlgoAPI_BooleanOperation',
];

function scanWorkerSources() {
  const dir = join(projectRoot, 'src', 'worker');
  const used = new Map();       // name -> Set of "file:line"
  const fallbackChains = [];    // [nameA, nameB] from `OC.A ?? OC.B`
  for (const f of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const src = readFileSync(join(dir, f), 'utf8');
    const lines = src.split('\n');
    lines.forEach((line, i) => {
      for (const m of line.matchAll(/\bOC\.([A-Za-z_$][\w$]*)/g)) {
        if (!used.has(m[1])) used.set(m[1], new Set());
        used.get(m[1]).add(`${f}:${i + 1}`);
      }
      for (const m of line.matchAll(/\bOC\.([A-Za-z_$][\w$]*)\s*\?\?\s*OC\.([A-Za-z_$][\w$]*)/g)) {
        fallbackChains.push([m[1], m[2]]);
      }
    });
  }
  return { used, fallbackChains };
}

async function main() {
  const { used, fallbackChains } = scanWorkerSources();
  if (used.size === 0) {
    console.error('Scan found no OC.* references in src/worker — the scanner is broken, refusing to pass vacuously.');
    process.exitCode = 1;
    return;
  }

  const init = opencascade.default || opencascade;
  const OC = await init();
  const has = (name) => typeof OC[name] !== 'undefined';

  // A name that appears in an `OC.A ?? OC.B` chain is satisfied if any member
  // of its chain exists.
  const chainSatisfied = new Map();
  for (const chain of fallbackChains) {
    const okAny = chain.some(has);
    for (const name of chain) {
      chainSatisfied.set(name, (chainSatisfied.get(name) ?? false) || okAny);
    }
  }

  console.log('=== WASM Bundle Audit ===');
  console.log(`${used.size} distinct OC.* bindings referenced by src/worker/*.ts\n`);

  const missing = [];
  const guardedMissing = [];
  for (const name of [...used.keys()].sort()) {
    if (has(name)) continue;
    if (chainSatisfied.get(name)) {
      console.log(`  optional ${name}: absent, but its \`??\` fallback binding exists`);
      continue;
    }
    if (KNOWN_GUARDED.has(name)) {
      guardedMissing.push(name);
      console.log(`  optional ${name}: absent — ${KNOWN_GUARDED.get(name)}`);
      continue;
    }
    missing.push(name);
    console.log(`  MISSING  ${name}  (used at ${[...used.get(name)].slice(0, 3).join(', ')})`);
  }
  if (missing.length === 0) {
    console.log('  all required bindings present' +
      (guardedMissing.length ? ` (${guardedMissing.length} optional absent, fallbacks in place)` : ''));
  }

  console.log('\n--- Watchlist (not used by the worker; informational only) ---');
  for (const name of WATCHLIST) {
    if (used.has(name)) continue; // already covered above with real stakes
    console.log(`  ${name}: ${has(name)}`);
  }

  if (missing.length > 0) {
    console.error(`\nFAIL: ${missing.length} binding(s) used by the worker are missing from the WASM kernel.`);
    console.error('Geometry nodes that reach them will throw at runtime.');
    process.exitCode = 1;
  } else {
    console.log('\nPASS: every binding the worker uses is present.');
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
