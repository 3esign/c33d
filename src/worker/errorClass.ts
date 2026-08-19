import * as replicad from 'replicad';

// Error taxonomy for node-level failures. OpenCascade WASM (Emscripten) throws
// raw numbers (exception pointers / codes) — String(err) turns those into
// opaque garbage like "24" that models (and humans) misread as a parameter
// problem and burn repair turns on. Classify at the catch site so every error
// names its class and who should act on it: the model (graph/params) or the
// system (kernel/runtime). See docs/stadium_transcript_analysis.md §2.1.
export type NodeErrorClass = 'KERNEL' | 'RUNTIME' | 'PARAM' | 'PARSE' | 'GEOM';

export function decodeOcctException(ptr: number): string {
  try {
    const oc = (replicad as any).getOC?.();
    const data = oc?.OCJS?.getStandard_FailureData?.(ptr);
    const m = data?.GetMessageString?.();
    if (m) return `kernel exception: ${m}`;
  } catch {
    /* decoding is best-effort */
  }
  return `kernel exception (opaque code ${ptr}) — engine state problem, NOT a graph/parameter problem`;
}

// PARAM: clamp/validation errors thrown by executors or the formula layer —
// the graph's numbers/wiring are wrong, not the engine. Kept to phrasings our
// own code emits so kernel messages never land here by accident.
const PARAM_MSG_RE = /\b(division by zero|not a finite number|is a list|unknown (variable|function|operation)|malformed number|must be|requires|invalid|out of range|expects at (least|most)|zero extent|no bounding box)\b/i;

export function classifyNodeError(err: any): { cls: NodeErrorClass; msg: string } {
  if (typeof err === 'number') {
    return { cls: 'KERNEL', msg: decodeOcctException(err) };
  }
  // JS-level faults ("x is not a function", "Cannot read properties of…",
  // invalid-length arrays from NaN indexes) are OUR code path hitting an
  // unexpected value shape. They are NOT kernel corruption and must never
  // feed the kernel-suspect respawn spiral (audit §1.7).
  if (err instanceof TypeError || err instanceof RangeError) {
    return {
      cls: 'RUNTIME',
      msg: `${err.message} — JS-level failure in this node's execution path (unexpected value shape), not a kernel fault`,
    };
  }
  const msg = String(err?.message ?? err);
  if (/^\d+$/.test(msg.trim())) {
    return { cls: 'KERNEL', msg: decodeOcctException(Number(msg.trim())) };
  }
  if (PARAM_MSG_RE.test(msg)) {
    return { cls: 'PARAM', msg };
  }
  return { cls: 'GEOM', msg };
}

// Only genuine OCCT aborts (raw numeric throws / decoded kernel exceptions)
// may count toward the poisoned-instance heuristic. RUNTIME used to count too,
// which turned every leaf-meshing TypeError into a phantom "kernel corrupted"
// respawn loop for perfectly healthy graphs.
export function isKernelClass(cls: NodeErrorClass): boolean {
  return cls === 'KERNEL';
}
