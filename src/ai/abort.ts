// ---------------------------------------------------------------------------
// RUN CANCELLATION — one AbortController per agent run.
//
// WHY THIS EXISTS
// Until Jul 25 there was no way to stop a run. Every provider fetch ran to
// completion, and the audit corpus contains models averaging 250 s per call
// across up to 8 agent turns: a wrong prompt cost twenty minutes with no exit.
// That is also the reason a "keep refining" loop could not be built — an
// unbounded loop without a kill switch is not shippable.
//
// DESIGN
// Module-level rather than threaded through every signature: the app runs ONE
// agent run at a time (ChatPanel disables input while a run is in flight), so a
// single current-run controller is both sufficient and far less invasive than
// passing a signal through ~20 call sites. Two cancellation paths:
//   - transport:  fetch(..., { signal }) rejects in-flight HTTP immediately
//   - cooperative: throwIfAborted() at agent-loop boundaries, so a run that is
//     between requests (compiling, evaluating, repairing) also stops promptly
// ---------------------------------------------------------------------------

/** Thrown at a loop boundary when the user has stopped the run. */
export class RunAbortedError extends Error {
  constructor(message = 'Stopped.') {
    super(message);
    this.name = 'RunAbortedError';
  }
}

let controller: AbortController | null = null;

/** Start a new run, cancelling any run still in flight. */
export function beginRun(): AbortSignal {
  controller?.abort();
  controller = new AbortController();
  return controller.signal;
}

/** Stop the current run. Safe to call when nothing is running. */
export function abortRun(): void {
  controller?.abort();
}

/** The current run's signal, or undefined outside a run (fetches then behave as before). */
export function currentSignal(): AbortSignal | undefined {
  return controller?.signal;
}

export function isAborted(): boolean {
  return controller?.signal.aborted === true;
}

/** Cooperative cancellation point — call at every loop boundary. */
export function throwIfAborted(): void {
  if (isAborted()) throw new RunAbortedError();
}

/** Clear the run slot once a run has finished (successfully or not). */
export function endRun(): void {
  controller = null;
}

/** True when an error is either our cooperative abort or a fetch abort. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof RunAbortedError) return true;
  const name = (err as any)?.name;
  return name === 'AbortError' || name === 'RunAbortedError';
}
