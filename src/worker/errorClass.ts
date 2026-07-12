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

export function classifyNodeError(err: any): { cls: NodeErrorClass; msg: string } {
  if (typeof err === 'number') {
    return { cls: 'KERNEL', msg: decodeOcctException(err) };
  }
  if (err instanceof TypeError && /is not a (constructor|function)/.test(String(err.message))) {
    return {
      cls: 'RUNTIME',
      msg: `${err.message} — missing kernel binding or corrupted engine state, NOT a graph problem`,
    };
  }
  const msg = String(err?.message ?? err);
  if (/^\d+$/.test(msg.trim())) {
    return { cls: 'KERNEL', msg: decodeOcctException(Number(msg.trim())) };
  }
  return { cls: 'GEOM', msg };
}

export function isKernelClass(cls: NodeErrorClass): boolean {
  return cls === 'KERNEL' || cls === 'RUNTIME';
}
