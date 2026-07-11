# Local-Model Harness Hardening (2026-07-10)

Follow-up to `cat_multimodel_test_analysis.md`. That report fixed the feedback channel (phantom leaves, perturbation timeouts, issue aggregation). This session analyzed the **Gemma-4B-via-Ollama transcript** — the weakest model tested so far — and fixed the five harness failures it exposed. None of these are model failures; all five are cases where the system lied to the model, ignored it silently, or gave it no legal way to comply.

## Failure modes found and fixed

### 1. Engine-fault infinite retry loop (fixed: `agent.ts`)
Engine faults were budget-exempt with `attempt--` and **no cap** — a persistently faulting kernel produced 15+ consecutive "Engine fault — retrying" rounds while the model thrashed the graph chasing an error it never caused (stripped Mirrors, replaced Aligns, wiped params — the graph degraded to rubble). Now: 3 exempt retries in the JSON path (then faults count against the repair budget), and a circuit breaker in the tool path (3 consecutive faults ⇒ stop the episode with an honest message). The one-shot worker respawn per evaluation is unchanged.

### 2. Phantom edges — silent no-op removals (fixed: `agent.ts`, `tools.ts`)
`removedEdgeIds` matched only exact internal edge ids, which models never know. Every removal silently matched nothing, the model saw the same edges next turn, and concluded the system was haunted ("phantom edges", "hard reset of the entire edge network"). Now removals accept exact ids, `{"source","target"[,"targetHandle"]}` objects, and `"source->target[.handle]"` strings — and anything that matches nothing is reported back to the model via patch notes (non-blocking warnings). `disconnect` in the tool path reports no-match entries too. Same for `updatedNodes` targeting nonexistent ids — previously a silent no-op, now reported.

### 3. Type-change ghost params (fixed: `agent.ts`, `tools.ts`)
Changing a node's type merged the new params **over** the old type's params and validated against the **old** type. A Pipe→Torus→Sphere sequence left `pathSvg`/torus params inside a "Sphere", crashing the kernel and producing the model's "the system reports Sphere but claims Ellipsoid" confusion — the exact loop in the Gemma transcript. Now a type change validates against the **new** type, resets data (keeping label/color), and tells the model its params were cleared. `update_nodes` (tool path) now supports `type` explicitly with the same semantics.

### 4. Text3D could never work (fixed: `executors.ts`, `geometryWorker.ts`, `public/fonts/`)
`replicad.sketchText` requires `loadFont()` — which was never called anywhere. Every Text3D died with `Cannot read properties of undefined (reading 'getPath')`, and the auto-repair loop burned turns replacing text with "symbolic information blocks". Now the worker preloads `public/fonts/DejaVuSans.ttf` before evaluating any graph containing Text3D (macros included); if the font can't load, the node fails with an actionable message telling the model not to retry.

### 5. No legal way to answer in text (fixed: system prompt)
When asked "tell me in text what can be improved", the model reasoned: "the system requires JSON and the output must be a CAD graph — I will translate this request into a Conceptual Architecture model" and built sphere-and-ring sculptures of its own feedback. The protocol supported reasoning-only responses, but nothing said so. New CORE RULE 10: questions/feedback/critique/reports get TEXT answers, never geometry that "represents" the answer; the JSON protocol documents that `{"reasoning": ...}` with no graph fields is a complete valid response, and the tool path documents plain-text replies.

## The general-intelligence lesson

The Gemma transcript reads as the model being stupid. It wasn't — every "stupid" behavior was a rational response to a broken environment:

- It "hallucinated" phantom edges → the system really was ignoring its removals silently.
- It "confused" Sphere and Ellipsoid → the graph really did contain hybrid ghost-param nodes.
- It thrashed the graph during engine faults → the system really did re-prompt it forever with a fault it couldn't affect.
- It built sculpture answers to text questions → the protocol really did appear to forbid text.

**Harness principle:** every op a model sends must either take effect or produce a loud, specific, actionable report of why not. Silent no-ops are worse than errors — they desynchronize the model's world-model, and weak models (rightly) trust their own action history over an inconsistent observation stream. Freedom for the model comes from a truthful, closed feedback loop, not from more instructions.

## Verification

- `tsc -p tsconfig.app.json --noEmit` clean.
- Test suite: 9/11 pass; the two failures (`test_flower_integration.mjs`, `test_nonuniform.mjs`, exit 7) fail identically at HEAD before these changes — pre-existing, tracked separately.
- `test_phantom_errors.mjs` (regression guard from the previous session) passes.

## Re-run protocol for the knowledge base

Re-run the same five-model cat brief plus Gemma with this build. Expect: no engine-fault spirals (capped), no phantom-edge turns, type changes land cleanly, Text3D renders, and "give me feedback" prompts produce chat text instead of geometry. Log per-model deltas in EVAL_RESULTS as the new baseline.
