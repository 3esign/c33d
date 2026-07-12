import assert from 'assert';

// Standalone replicas (repo test convention) of the kernel-health logic added
// in Workstream A — source of truth: src/worker/errorClass.ts and
// src/utils/errors.ts. If those change, update these replicas.

function decodeOcctException(ptr) {
  return `kernel exception (opaque code ${ptr}) — engine state problem, NOT a graph/parameter problem`;
}

function classifyNodeError(err) {
  if (typeof err === 'number') return { cls: 'KERNEL', msg: decodeOcctException(err) };
  if (err instanceof TypeError && /is not a (constructor|function)/.test(String(err.message))) {
    return { cls: 'RUNTIME', msg: `${err.message} — missing kernel binding or corrupted engine state, NOT a graph problem` };
  }
  const msg = String(err?.message ?? err);
  if (/^\d+$/.test(msg.trim())) return { cls: 'KERNEL', msg: decodeOcctException(Number(msg.trim())) };
  return { cls: 'GEOM', msg };
}

function isKernelClass(cls) { return cls === 'KERNEL' || cls === 'RUNTIME'; }

function isSystemError(errorStr) {
  if (!errorStr) return false;
  const lower = errorStr.toLowerCase();
  if (/^\d+$/.test(lower.trim())) return true;
  return lower.includes('deleted') ||
         lower.includes('wasm') ||
         lower.includes('out of memory') ||
         lower.includes('memory access') ||
         lower.includes('abort') ||
         lower.includes('unreachable') ||
         lower.includes('signature mismatch') ||
         lower.includes('array bounds') ||
         lower.includes('timed out') ||
         lower.includes('timeout') ||
         lower.includes('opencascade kernel failed') ||
         lower.includes('worker error') ||
         lower.includes('kernel exception') ||
         lower.includes('is not a constructor') ||
         lower.includes('kernel canary');
}

// ---- classifier: the Phase D error strings from the stadium transcript ----

// Emscripten throws raw numbers (exception pointers / codes)
let r = classifyNodeError(24);
assert.strictEqual(r.cls, 'KERNEL');
assert.ok(r.msg.includes('opaque code 24'));
assert.ok(r.msg.includes('NOT a graph/parameter problem'));

r = classifyNodeError(548501952);
assert.strictEqual(r.cls, 'KERNEL');

// Error whose message is a bare number (String(err.message || err) path)
r = classifyNodeError(new Error('57503824'));
assert.strictEqual(r.cls, 'KERNEL');

// Missing binding — the "OC.BRepPrimAPI_MakeCone_1 is not a constructor" case
r = classifyNodeError(new TypeError('OC.BRepPrimAPI_MakeCone_1 is not a constructor'));
assert.strictEqual(r.cls, 'RUNTIME');
assert.ok(r.msg.includes('NOT a graph problem'));

// Real parameter/geometry errors stay attributable to the graph
r = classifyNodeError(new Error('radius must be positive'));
assert.strictEqual(r.cls, 'GEOM');
assert.strictEqual(r.msg, 'radius must be positive');

// ---- kernelSuspect aggregation ----
function kernelSuspect(nodeErrors, succeededTypes, failures) {
  let count = 0, regression = false;
  for (const f of failures) {
    const c = classifyNodeError(f.err);
    if (isKernelClass(c.cls)) {
      count++;
      if (succeededTypes.has(f.type)) regression = true;
    }
  }
  return count >= 2 || regression;
}
// two kernel-class failures => suspect
assert.strictEqual(kernelSuspect([], new Set(), [{ type: 'Box', err: 24 }, { type: 'Sphere', err: 24 }]), true);
// one kernel failure on a type that worked before in this worker => suspect
assert.strictEqual(kernelSuspect([], new Set(['Box']), [{ type: 'Box', err: 24 }]), true);
// one kernel failure on a never-seen type => not yet suspect (could be graph-triggered)
assert.strictEqual(kernelSuspect([], new Set(), [{ type: 'Boolean', err: 24 }]), false);
// plain geometry errors never suspect
assert.strictEqual(kernelSuspect([], new Set(['Box']), [{ type: 'Box', err: new Error('bad fillet radius') }]), false);

// ---- isSystemError coverage of the new classes ----
assert.strictEqual(isSystemError('24'), true);
assert.strictEqual(isSystemError('[KERNEL] kernel exception (opaque code 24) — engine state problem, NOT a graph/parameter problem'), true);
assert.strictEqual(isSystemError('OC.BRepPrimAPI_MakeCone_1 is not a constructor'), true);
assert.strictEqual(isSystemError('OpenCascade kernel canary failed after worker restart — engine restart required; graph edits will not help. Reload the app if this persists.'), true);
assert.strictEqual(isSystemError('Sketch failed: bad token near L 10'), false);
assert.strictEqual(isSystemError('Leaf "n_x" has non-positive volume (0)'), false);

console.log('test_kernel_poisoning: all assertions passed');
