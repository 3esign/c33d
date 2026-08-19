import { readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const testsDir = __dirname;

async function runAllTests() {
  console.log('==================================================');
  console.log('           C33D Test Runner                       ');
  console.log('==================================================\n');

  // Every tests/test_*.mjs is picked up automatically — a new test file needs
  // no registration here.
  const files = readdirSync(testsDir)
    .filter(file => file.startsWith('test_') && (file.endsWith('.js') || file.endsWith('.mjs')))
    .filter(file => file !== 'run_tests.mjs')
    .sort();

  // A wedged test (WASM kernel spin, infinite loop) must fail the suite, not
  // hang it forever. 240s is generous: the slowest kernel test takes ~30s.
  const PER_TEST_TIMEOUT_MS = 240_000;

  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const file of files) {
    const filePath = join(testsDir, file);
    console.log(`Running: ${file}...`);
    const start = Date.now();

    const result = spawnSync('node', [filePath], {
      stdio: 'inherit',
      timeout: PER_TEST_TIMEOUT_MS,
    });

    const elapsed = Date.now() - start;
    const timedOut = result.error?.code === 'ETIMEDOUT' ||
      (result.status === null && elapsed >= PER_TEST_TIMEOUT_MS);

    if (result.status === 0 && !result.error) {
      console.log(`\x1b[32mPASS\x1b[0m: ${file} (${elapsed}ms)\n`);
      passed++;
    } else {
      const why = timedOut ? ` — TIMED OUT after ${PER_TEST_TIMEOUT_MS / 1000}s` : '';
      console.log(`\x1b[31mFAIL\x1b[0m: ${file} (${elapsed}ms)${why}\n`);
      failed++;
      failures.push({ file, exitCode: result.status, signal: result.signal, timedOut });
    }
  }

  console.log('==================================================');
  console.log('           Test Execution Summary                 ');
  console.log('==================================================');
  console.log(`Test files: ${passed + failed}`);
  console.log(`Passed:     \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed:     ${failed > 0 ? `\x1b[31m${failed}\x1b[0m` : '0'}`);
  console.log('==================================================\n');

  if (failed > 0) {
    console.error('\x1b[31mSome tests failed:\x1b[0m');
    for (const f of failures) {
      const detail = f.timedOut
        ? 'timed out'
        : `exit code: ${f.exitCode}${f.signal ? `, signal: ${f.signal}` : ''}`;
      console.error(`  - ${f.file} (${detail})`);
    }
    process.exit(1);
  } else {
    console.log('\x1b[32mAll tests completed successfully!\x1b[0m');
    process.exit(0);
  }
}

runAllTests().catch(err => {
  console.error('Unhandled error in test runner:', err);
  process.exit(1);
});
