// Contract test for the selection-query tokenizer/parser
// (src/worker/selectionQuery.ts) — the REAL module, imported directly.
//
// Motivation (audit §1.6): the tokenizer's delimiter set contained a stray
// 's', so any query containing that letter outside [...]/point(...) —
// "spherical", "smallest", "size > 5", even "faces" — emitted an empty token
// without advancing and spun the worker at 100% CPU forever. The tokenization
// pass below runs in a SUBPROCESS with a hard timeout so a regression FAILS
// the suite instead of hanging it.

import assert from 'assert';
import { execFileSync } from 'node:child_process';

const MOD_URL = new URL('../src/worker/selectionQuery.ts', import.meta.url).href;

let checks = 0;
const ok = (label, cond, extra) => {
  assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`);
  checks++;
};
const eq = (label, actual, expected) => {
  assert.deepStrictEqual(actual, expected, label);
  checks++;
};

// ---------------------------------------------------------------------------
// 1. Termination + token shapes for s-word queries (subprocess, 15s guard)
// ---------------------------------------------------------------------------
const QUERIES = [
  'spherical',
  'smallest',
  'size > 5',
  'nearest to point(0,0,5)',
  'faces',
  'normal ~ +Z and area >= 25',
  'spherical or size > 5',
];

function tokenizeAllInSubprocess(queries, timeoutMs = 15000) {
  const script = `
    import(${JSON.stringify(MOD_URL)}).then((m) => {
      const queries = ${JSON.stringify(queries)};
      process.stdout.write(JSON.stringify(queries.map((q) => m.tokenizeQuery(q))));
    }).catch((err) => { console.error(err); process.exit(1); });
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    timeout: timeoutMs,
    encoding: 'utf8',
  });
  return JSON.parse(out);
}

let tokenLists;
try {
  tokenLists = tokenizeAllInSubprocess(QUERIES);
} catch (err) {
  if (err.code === 'ETIMEDOUT' || err.signal) {
    console.error(
      'FAIL: tokenizeQuery did not terminate on an s-word query — the stray-\'s\' delimiter infinite loop (audit §1.6) is back.'
    );
    process.exit(1);
  }
  throw err;
}

ok('all s-word queries tokenized without hanging', tokenLists.length === QUERIES.length);
eq("'spherical' is one whole token", tokenLists[0], ['spherical']);
eq("'smallest' is one whole token", tokenLists[1], ['smallest']);
eq("'size > 5' splits into word/op/number", tokenLists[2], ['size', '>', '5']);
eq(
  "'nearest to point(0,0,5)' keeps point(...) as one token",
  tokenLists[3],
  ['nearest', 'to', 'point(0,0,5)']
);
eq("'faces' survives intact (the parser's own docs use it)", tokenLists[4], ['faces']);
eq(
  'mixed query with two-char op tokenizes correctly',
  tokenLists[5],
  ['normal', '~', '+Z', 'and', 'area', '>=', '25']
);
ok("'spherical or size > 5' terminates and yields tokens", tokenLists[6].length === 5, JSON.stringify(tokenLists[6]));

// ---------------------------------------------------------------------------
// 2. evaluateSelectionQuery AST cases against a mock element list
//    (safe to run in-process now that step 1 proved termination)
// ---------------------------------------------------------------------------
const { evaluateSelectionQuery, tokenizeQuery } = await import('../src/worker/selectionQuery.ts');

// Direct call sanity: same results as the subprocess run.
eq('in-process tokenization matches subprocess', tokenizeQuery('size > 5'), ['size', '>', '5']);

const mkFace = (hash, center, normal, area, geomType = 'PLANE') => ({
  hashCode: () => hash,
  center: { x: center[0], y: center[1], z: center[2] },
  normalAt: () => ({ toTuple: () => normal }),
  area,
  geomType,
});

// A box-ish mock: 6 planar faces + one spherical cap.
const mockSolid = {
  faces: [
    mkFace(1, [0, 0, 5], [0, 0, 1], 100),          // top
    mkFace(2, [0, 0, -5], [0, 0, -1], 100),        // bottom
    mkFace(3, [5, 0, 0], [1, 0, 0], 40),           // +X
    mkFace(4, [-5, 0, 0], [-1, 0, 0], 40),         // -X
    mkFace(5, [0, 5, 0], [0, 1, 0], 40),           // +Y
    mkFace(6, [0, -5, 0], [0, -1, 0], 40),         // -Y
    mkFace(7, [0, 0, 8], [0, 0, 1], 12, 'SPHERE'), // spherical cap above the top
  ],
  edges: [],
};

{
  const res = evaluateSelectionQuery('spherical', 'faces', mockSolid, {}, 0.1);
  eq("'spherical' (an s-word!) selects exactly the SPHERE face", res.hashes, [7]);
}
{
  const res = evaluateSelectionQuery('normal ~ +Z and area > 50', 'faces', mockSolid, {}, 0.1);
  eq('AND of direction + comparison narrows to the big top face', res.hashes, [1]);
}
{
  const res = evaluateSelectionQuery('not planar or nearest to point(0,0,-6)', 'faces', mockSolid, {}, 0.1);
  eq(
    'OR of NOT + nearest picks the sphere cap and the bottom face',
    [...res.hashes].sort((a, b) => a - b),
    [2, 7]
  );
}
{
  // A slider-scoped comparison limit: area > size*10 with size=5 → area > 50.
  const res = evaluateSelectionQuery('area > size*10', 'faces', mockSolid, { size: 5 }, 0.1);
  eq('comparison limit resolves slider formulas', [...res.hashes].sort((a, b) => a - b), [1, 2]);
}

console.log(`test_selection_tokenizer: all ${checks} contracts PASS`);
