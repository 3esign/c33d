// Contract test for RUN CANCELLATION (src/ai/abort.ts).
//
// Until Jul 25 there was no way to stop a run: every provider fetch ran to
// completion, and the audit corpus has models averaging 250 s per call across
// up to 8 agent turns. A stop button is also the precondition for any
// "keep refining" loop — an unbounded loop with no kill switch is not shippable.

import assert from 'assert';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

const {
  beginRun, abortRun, endRun, isAborted, throwIfAborted, currentSignal,
  isAbortError, RunAbortedError,
} = await import('../src/ai/abort.ts');

let checks = 0;
const ok = (label, cond, extra) => { assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); checks++; };

// ---- outside a run, nothing is aborted and fetches behave exactly as before --
endRun();
ok('no signal outside a run', currentSignal() === undefined);
ok('not aborted outside a run', isAborted() === false);
throwIfAborted(); // must not throw
ok('throwIfAborted is a no-op outside a run', true);
ok('abortRun outside a run is harmless', (() => { abortRun(); return true; })());

// ---- a started run exposes a live signal ------------------------------------
{
  const signal = beginRun();
  ok('beginRun returns a signal', signal instanceof AbortSignal);
  ok('signal starts un-aborted', signal.aborted === false);
  ok('currentSignal is the run signal', currentSignal() === signal);
  throwIfAborted();
  ok('throwIfAborted is a no-op while running', true);
}

// ---- stopping aborts transport AND cooperative checkpoints ------------------
{
  const signal = beginRun();
  let fetchRejected = false;
  // A never-settling request stands in for a 250-second completion.
  const pending = new Promise((_, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }).catch(err => { fetchRejected = isAbortError(err); });

  abortRun();
  await pending;

  ok('in-flight transport is rejected', fetchRejected);
  ok('signal reports aborted', signal.aborted === true);
  ok('isAborted() is true', isAborted() === true);
  let threw = null;
  try { throwIfAborted(); } catch (e) { threw = e; }
  ok('throwIfAborted throws at the next loop boundary', threw instanceof RunAbortedError);
  ok('a stop is recognised as an abort, not a model failure', isAbortError(threw));
}

// ---- a new run is clean even if the previous one was stopped ----------------
{
  const previous = currentSignal();
  const fresh = beginRun();
  ok('a new run gets a fresh signal', fresh !== previous);
  ok('the new run is not aborted', isAborted() === false);
  throwIfAborted();
  ok('the new run passes its checkpoints', true);
}

// ---- starting a run while one is live cancels the old one -------------------
{
  const first = beginRun();
  const second = beginRun();
  ok('the superseded run is aborted', first.aborted === true);
  ok('the new run is live', second.aborted === false);
}

// ---- endRun clears the slot -------------------------------------------------
{
  beginRun();
  endRun();
  ok('endRun clears the signal', currentSignal() === undefined);
  ok('endRun leaves nothing aborted', isAborted() === false);
}

// ---- error classification ---------------------------------------------------
{
  ok('DOMException AbortError is an abort', isAbortError(new DOMException('x', 'AbortError')));
  ok('RunAbortedError is an abort', isAbortError(new RunAbortedError()));
  ok('an ordinary error is NOT an abort', isAbortError(new Error('kernel exploded')) === false);
  ok('null is NOT an abort', isAbortError(null) === false);
}

console.log(`test_run_abort: all ${checks} contracts PASS`);
