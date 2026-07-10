import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createRequire } from 'module';
import { evaluateExpression, normalizeVarName } from '../src/utils/expression.ts';

// Setup node module resolution compatibility
const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
globalThis.__dirname = join(projectRoot, 'node_modules', 'replicad-opencascadejs', 'src');
globalThis.require = createRequire(import.meta.url);

import assert from 'assert';

function testFormulaFix() {
  console.log('=== Test 1: normalizeVarName ===');
  assert.strictEqual(normalizeVarName('Rock Size'), 'rocksize');
  assert.strictEqual(normalizeVarName('body-radius_width'), 'bodyradius_width');
  assert.strictEqual(normalizeVarName('rockSize'), 'rocksize');
  console.log('NormalizeVarName tests passed.');

  console.log('=== Test 2: evaluateExpression with spaces in label ===');
  const scope = {
    'Rock Size': 5,
    'bodyRadius': 10
  };
  
  // Formula referencing Rock Size as rockSize should resolve
  const result1 = evaluateExpression('rockSize * 0.8', scope);
  assert.strictEqual(result1, 4.0);

  // Formula referencing bodyRadius should resolve
  const result2 = evaluateExpression('bodyradius + 2', scope);
  assert.strictEqual(result2, 12);
  console.log('EvaluateExpression variable normalization tests passed.');

  console.log('=== Test 3: Actionable Error on Unknown Variables ===');
  try {
    evaluateExpression('unknownVar * 2', scope);
    assert.fail('Should have thrown an error for unknown variable');
  } catch (err) {
    console.log('Caught expected error:', err.message);
    assert.ok(err.message.includes("unknown variable 'unknownvar'"));
    assert.ok(err.message.includes("available: rocksize, bodyradius"));
  }
  console.log('Unknown variables error tests passed.');
}

try {
  testFormulaFix();
  console.log('\nAll formula fix tests PASSED!');
} catch (err) {
  console.error('\nTest FAILED:', err);
  process.exit(1);
}
