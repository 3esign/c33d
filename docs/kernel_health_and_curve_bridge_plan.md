# Implementation Plan — Kernel Health + Curve→Solid Bridge

**Date:** 2026-07-12
**Implementation status (2026-07-12):** Workstreams A, B and C are LANDED — commits `29e8126` (A1-A7), `00528bb` (A8-A9), `8103692` (B1-B9), `5310f25` (C1-C5, C7). Full test suite passes 14/14 (including `test_flower_integration` and `test_nonuniform`, which were failing pre-existing on Jul 10). Deviations from spec: LoftCurves shipped with `ruled`/`closed` but without `thickness` (shell the result with the existing Shell node instead); C5 shipped as a registry-consistency smoke test (85/85 node types implemented) + `verifiedOnBuild` stamps — the in-app per-build support matrix in the prompt is deferred since the runtime canary (A4) covers kernel truth. C6 (golden exemplars) is the only open item — it requires running the app with a model and saving verified graphs. Verified against the real kernel during implementation: this OCJS build has `BRepOffsetAPI_ThruSections` (no `_1` suffix — the executor probes both), and replicad Drawings lack `pointAt`, so CircleCurve/EllipseCurve now emit wires (this had silently broken DivideCurve on circles/ellipses since Jul 9).

**Basis:** `docs/stadium_transcript_analysis.md` (forensics of the stadium/cat Gemma session). This document is the actionable spec: every task lists target files, the change, a code sketch where useful, and an acceptance check. Three workstreams, ordered by leverage: **A** stops the harness from charging models for engine failures; **B** closes the curve→solid loop so derivation-based construction is expressible; **C** makes derivation the default way models think, and measurable.

**Status legend:** each task starts `[ ]`; flip to `[x]` with the commit hash when landed.

---

## Workstream A — Kernel health & truthful errors (P0, ~1 week)

Goal: replaying the stadium transcript's Phase D produces one worker respawn, a passing canary, and a normal build — instead of 15 wasted repair turns on `failed: 24`.

### A1. `[x]` (29e8126) Error taxonomy at the node catch site

**File:** `src/worker/geometryWorker.ts` (catch at ~474–477).

Replace `String(err.message || err)` with a classifier:

```ts
type ErrClass = 'KERNEL' | 'RUNTIME' | 'PARAM' | 'PARSE' | 'GEOM';

function classifyNodeError(err: any): { cls: ErrClass; msg: string } {
  if (typeof err === 'number') {
    return { cls: 'KERNEL', msg: decodeOcctException(err) };
  }
  if (err instanceof TypeError && /is not a constructor|is not a function/.test(err.message)) {
    return { cls: 'RUNTIME', msg: err.message };
  }
  // existing message-bearing errors stay GEOM/PARAM by content
  return { cls: 'GEOM', msg: String(err?.message || err) };
}

function decodeOcctException(ptr: number): string {
  try {
    const oc = (replicad as any).getOC();
    const data = oc?.OCJS?.getStandard_FailureData?.(ptr);
    const m = data?.GetMessageString?.();
    if (m) return `kernel exception: ${m}`;
  } catch { /* fall through */ }
  return `kernel exception (opaque code ${ptr}) — engine state problem, NOT a graph/parameter problem`;
}
```

Store `cls` on the report entry (`nodeErrors: {id, error, cls}`); `formatGeometryReport` prefixes it: `[KERNEL] Node "n_base" failed: …`.

**Accept:** a thrown `24` renders as `[KERNEL] … NOT a graph/parameter problem`; `tsc -b` clean; existing tests pass.

### A2. `[x]` (29e8126) Stop the Sketch executor blaming svgPath for kernel errors

**File:** `src/worker/executors.ts` (~618–631). Only emit "Check the svgPath string (supported: M L H V C Q Z)" when the error came from `parseSVGPath` (PARSE class / parse-site throw). Kernel-class errors get the A1 message instead. Same audit for Pipe/Extrude fallback messages ("input is probably already a 3D solid") — never assert a cause the executor didn't verify.

**Accept:** replay a Sketch node against a poisoned kernel (mock a numeric throw): message contains no svgPath advice.

### A3. `[x]` (29e8126) Poisoned-evaluation detection → respawn + replay

**Files:** `src/worker/geometryWorker.ts`, `src/store/useStore.ts`.

Worker: after the node loop, set `report.kernelSuspect = true` when ≥2 node errors are `KERNEL`/`RUNTIME`, or when a node type that succeeded earlier this worker-lifetime now fails kernel-class (keep a `Set<string>` of succeeded types).

Main thread (`useStore.ts`, EVALUATE_RESULT handler ~line 200): if `report.kernelSuspect && !hasRetriedDeleted` → terminate + respawn worker (reuse the existing EVALUATE_ERROR respawn block at ~254–271), set `hasRetriedDeleted`, re-post the evaluation. This must not consume the agent's repair budget — the replay happens below the agent loop, exactly like the current system-error retry.

**Accept:** unit test `test_kernel_poisoning.mjs`: simulate all-nodes-throw-24 → observe one respawn + replay; second (healthy) eval renders; the agent loop never sees the poisoned report.

### A4. `[x]` (29e8126) Canary + `kernel health` line in the geometry report

**Files:** `src/worker/geometryWorker.ts`, `src/ai/verification.ts`.

On worker init AND after any respawn-replay, evaluate a hardcoded `Box(10,10,10)` outside the user graph (direct executor call, no graph mutation). Report gains `kernelHealth: 'ok' | 'failed'`. `formatGeometryReport` always prints one line: `kernel health: OK (canary passed)` / `kernel health: FAILED — engine restart required, graph edits will not help`. If the canary fails after a respawn, the agent loop stops the episode with the honest circuit-breaker message (`agent.ts` ~722–726 path) — never a repair charge.

This single line removes the entire "which primitive still works" search space that consumed Phase D.

**Accept:** poisoned-kernel test shows `kernel health: FAILED` ending the episode in ≤1 model turn; healthy runs always show `OK`.

### A5. `[x]` (29e8126) Fresh worker on `clearGraph` / new episode

**File:** `src/store/useStore.ts` (clearGraph action; also agent episode reset in `agent.ts`).

`clearGraph:true` and the tool-path `clear_graph` recycle the worker before the next evaluation. Rationale: it makes the user's (and model's) instinctive recovery — "try from clean graph" — actually reset the engine. Cheap: worker boot is already awaited by the message queue.

**Accept:** after a forced poison, user clicking Clear Graph + re-prompt yields working geometry with zero manual reloads.

### A6. `[x]` (29e8126) Recycle earlier

**File:** `src/worker/geometryWorker.ts:235`. `WORKER_RECYCLE_HINT` 400 → **50**. With shape deletion disabled (`geometryWorker.ts:494–496` mitigation), leak growth per stadium-scale eval is large; 400 was calibrated for nothing. Optional stretch: also recommend recycle when `performance.memory?.usedJSHeapSize` (or `WebAssembly.Memory` buffer byteLength) crosses ~1.5 GB.

**Accept:** long eval-suite run (5-model cat suite) shows periodic recycles and no late-session kernel-class cascades.

### A7. `[x]` (29e8126) Extend `isSystemError`

**File:** `src/utils/errors.ts`. Add: `is not a constructor`, `kernel exception`, and bare-numeric error strings (`/^\d+$/` after trim). Keeps every downstream guard (save-blocking, engine-fault classification, respawn) consistent with the new taxonomy.

**Accept:** unit table-test over the Phase D error strings — all classify as system.

### A8. `[x]` (00528bb) DIAGNOSIS STATE block + harness-side minimal repro

**File:** `src/ai/agent.ts` (repair loop, ~697–736).

Maintain per-episode: `triedFixes: string[]` (one-line summaries the harness writes from each patch: "swapped node type Box→Sphere", "rewrote svgPath", …), `ruledOut: string[]`. Inject into every repair prompt:

```
DIAGNOSIS STATE (harness-maintained):
- tried: swapped primitive type ×3 (no effect), rewrote svgPath (no effect)
- ruled out: parameter values (canary Box with defaults also fails)
- do NOT repeat a tried fix class; change hypothesis.
```

After 2 failed repairs touching the same node: harness evaluates that node **alone with default params** in a scratch context (new worker message `EVALUATE_NODE_ISOLATED`), then reports: `minimal repro: "n_bowl" fails even in isolation ⇒ not your graph` or `works in isolation ⇒ its inputs/params in your graph`. Costs zero model turns.

**Accept:** Phase C replay (Align-order mistake) reaches the correct fix in ≤2 repairs; no fix class repeats within an episode.

### A9. `[x]` (00528bb) Candidate edges in patch no-match notes

**File:** `src/ai/agent.ts` (~1067–1069). When a `removedEdgeIds` entry matches nothing, append the actual current edges touching the referenced node ids: `no match; current edges at n_roof_base: n_roof_base->n_roof_pos.solid, slider1->n_roof_base.param:height`. Turns a retry into a correction.

**Accept:** transcript replay of the 8 no-match warnings shows the model correcting on the next turn (eval-suite spot check).

### A-regression gate

- New: `tests/test_kernel_poisoning.mjs` (A1/A3/A4), extend `tests/test_phantom_errors.mjs` table (A7).
- Re-run five-model cat suite + one stadium brief per model; log to EVAL_RESULTS as the new baseline. Expected deltas: zero repair-budget charges on kernel-class faults; system-message count in Phase-D-like sessions drops from ~40 to <5.

---

## Workstream B — Bridge wave: curve→solid + points→instances (~1 week)

Goal: the skeleton vocabulary (curves/points, shipped Jul 9) stops being an island. Payload conventions already in the codebase (keep them): Curve = `{ type: 'Curve', value: <replicad wire/drawing> }`; point stream = array of `{ type: 'Point', x, y, z }`.

Implementation order = leverage order. For each node: definition in `src/nodes/NodeDefinitions.ts`, executor in `src/worker/executors.ts`, one line in the prompt library (auto via `condensedNodeLibrary()`), a unit test, and one eval prompt exercising it.

### B1. `[x]` (8103692) PipeOnCurve (extend existing Pipe)

Definition: add optional input `{ name: 'path', type: 'Curve' }` to Pipe (`NodeDefinitions.ts:352`, currently `inputs: []`).
Executor: factor the sweep half of the current Pipe executor (executors.ts:633–670: wire → oriented circle profile → `BRepOffsetAPI_MakePipe_1`) into `sweepCircleAlongWire(wire, radius)`. When `path` input is connected, take `curve.value` (normalize Drawing → wire via `.wires()[0]` if needed, same as the pathSvg branch), orient the profile with `curve.value.tangentAt(0)` (3D, replaces the XY-only angle hack), position at `pointAt(0)`. `pathSvg` remains the fallback.
**Accept:** EllipseCurve → PipeOnCurve renders a ring; slider on radiusX reshapes it live.

### B2. `[x]` (8103692) ExtrudeCurve

Definition: input `curve: Curve`; params `height` (formula-capable), optional `draft`. Output Solid.
Executor: closed planar wire → `replicad.makeFace(wire)` → extrude/prism (reuse Extrude internals). Non-closed input → `[PARAM] curve must be closed — use closed:true on Polyline/Spline or a Circle/Ellipse curve`.
**Accept:** EllipseCurve → ExtrudeCurve = stadium footprint slab, height driven by slider.

### B3. `[x]` (8103692) LoftCurves

Definition: inputs `curve1..curve6: Curve` (≥2 connected); params `closed` (loop last→first), `ruled` (straight vs smooth), `thickness` (0 = solid; >0 = shell the loft).
Executor: wires in graph order → `BRepOffsetAPI_ThruSections` (solid mode true; `oc` via `replicad.getOC()`, cast like the Pipe maker; call `.delete()` on the maker). Guard: all wires must be closed for solid mode; else loft as surface + optional thicken.
**Accept:** three EllipseCurves at z-heights (via B5-lite: allow `EllipseCurve.center` from a `Point` node — already supported) loft into a seating-bowl solid; perturbation test keeps integrity ≥0.9.

### B4. `[x]` (8103692) InstanceOnPoints

Definition: inputs `shape: Solid`, `points: Point`; params `alignToTangent: boolean`, `scaleStart/scaleEnd` (matches CircularPattern idiom), `everyNth`, `maxCount` (default 100, hard cap — perf guard). Output Solid (compound).
Executor: for each point (respecting everyNth/maxCount): clone shape, scale by lerp(scaleStart, scaleEnd, i/(n-1)), rotate to tangent when present, translate to (x,y,z); `replicad.makeCompound(...)`.
**Prerequisite:** B4a — `DivideCurve` (executors.ts:1823) emits channels: `{ type: 'Point', x, y, z, t, index, tangent: [tx,ty,tz] }` via `curve.value.tangentAt(t)`. Backward-compatible (extra fields ignored by existing consumers).
**Accept:** EllipseCurve → DivideCurve(24) → InstanceOnPoints(column) = ring of columns hugging the ellipse; changing the ellipse radii moves all columns. This is *the* stadium idiom.

### B5. `[x]` (8103692) TransformCurve

Definition: input `curve: Curve`; params `tx,ty,tz`, `rotate` (deg, Z), `scale` — all formula-capable. Output Curve.
Executor: `curve.value.translate([tx,ty,tz])` etc. (replicad wires support translate/rotate/scale; verify Drawing vs Wire and normalize to Wire first).
**Accept:** one EllipseCurve + two TransformCurves (z = `tierHeight`, `tierHeight*2`, scale 1.15/1.3) feeding LoftCurves = parametric tiered bowl from ONE curve.

### B6. `[x]` (8103692) OffsetCurve — planar offset (`params.distance`, formula-capable) via replicad `offset` on the drawing/wire. Concourse rings, track lanes, wall shells.

### B7. `[x]` (8103692) SweepAlongCurve — inputs `rail: Curve`, `profile: Curve|Solid`; auto-orient profile to rail tangent (generalizes B1 beyond circles). Roof ribbons, gutters, rims.

### B8. `[x]` (8103692) RevolveCurve — input `profile: Curve`, params `angle`, `axis`. Face-from-wire → revolve. Vases/domes without the SVG detour.

### B9. `[x]` (8103692) Geometric sockets on Translate (type-gravity flip)

Definition: optional input `target: Point` on Translate; when connected it overrides x/y/z. Report suppresses hardcoded-dimension warnings for overridden params. This makes "derive the position" a one-edge move — cheaper than typing a literal, which is the whole point.
**Accept:** Centroid → Translate.target chain works; report shows no magic-number warning for that node.

### B-regression gate

`tests/test_curve_bridge.mjs`: each node instantiated with defaults + one composed chain (ellipse → transform ×2 → loft; ellipse → divide → instance). Node smoke matrix (see C5) includes all new types. `npm run build` green.

---

## Workstream C — Thinking layer: prompt, plan schema, metrics, exemplars (~3–4 days, interleave with B)

### C1. `[x]` (5310f25) Rewrite CORE RULE 2 — two spines

**File:** `src/ai/agent.ts:99`. Replace the "solid chain is usually the ONLY kind of edge you need" sentence with:

> 2. Data flow — TWO SPINES. (a) The SOLID spine: primitives output "solid"; transforms consume and output "solid"; Boolean takes "target"+"tool". (b) The SKELETON spine: Point and Curve nodes are construction geometry that big forms DERIVE from — rails to loft (LoftCurves), paths to sweep (PipeOnCurve/SweepAlongCurve), boundaries to divide into placement points (DivideCurve → InstanceOnPoints). Large smooth forms, rhythms, and anything that must follow a shape belong on the skeleton spine; boxy mechanical assemblies belong on the solid spine. Every transform input MUST be connected.

### C2. `[x]` (5310f25) Construction ladder in the prompt

**File:** `src/ai/agent.ts` (new CORE RULE after 7c, or fold into 7). Exact text:

> 7d. CONSTRUCTION LADDER — pick the strategy BEFORE picking nodes: shell/bowl/hull/organic skin → 2–3 rail curves at heights → LoftCurves. tube/cable/rail/stem → curve → PipeOnCurve. repeated elements along a boundary (columns, windows, seats, spokes) → curve → DivideCurve → InstanceOnPoints. rotationally symmetric → profile curve → RevolveCurve. boxy/mechanical → primitives + Align. If one driving curve can generate the whole form, prefer it over assembling primitives — move one slider, everything follows.

### C3. `[x]` (5310f25) `set_plan` grows a SKELETON section

**File:** `src/ai/tools.ts` (set_plan schema) + tool-path prompt (`agent.ts` ~125). Plan schema adds `skeleton: [{ name, kind: 'point'|'curve', drives: string[] }]`. Prompt: "name your datum curves/points first and state what derives from each; parts not reachable from a datum or slider will be flagged."

### C4. `[x]` (5310f25) Derivation metrics in report + logs

**Files:** `src/worker/geometryWorker.ts` (compute), `src/ai/verification.ts` (print), `intelligence_log.json` / EVAL_RESULTS writers (`evalHarness.ts`).

- `derivationRatio` = geometry nodes with ≥1 geometry-typed input edge ÷ geometry nodes (excludes sliders/expressions).
- `skeletonUsage` = count of Curve/Point nodes on paths that reach a leaf.
- `magicNumberCount` = existing hardcoded-dims detector, surfaced as a number.
- `maxDerivationDepth`, `edgeNodeRatio`.

Print one report line: `graph shape: derivation 0.42, skeleton nodes 6, magic numbers 3, depth 7`. Log per response for trend lines across models/builds.

### C5. `[x]` partial (5310f25) Node smoke matrix (capability truth, not citations)

**File:** new `tests/test_node_smoke.mjs` + dev-mode startup check. Instantiate every NODE_LIBRARY type with defaults, evaluate, record ok/fail per build. Persist to `data/node_support_matrix.json`; inject a short "VERIFIED THIS BUILD: all 68 node types pass smoke" (or the failing list) into the system prompt. KB examples get a `verifiedOnBuild` stamp at save time (`useStore` save flow); retrieval prints it. Kills the "confirmed working in July 2026 update notes" failure class.

### C6. `[ ]` Golden derivation exemplars (after B lands) — OPEN: requires a live model session; build the three graphs below and save them via the Save flow

Build, verify, and save via the normal Save flow (they become VERIFIED PAST EXAMPLES — *examples, not macros*): stadium-from-one-ellipse (ellipse → offset/transform → loft bowl; divide → columns; pipe ring roof), cat-from-spine-curve (spine spline → graded profile circles → LoftCurves body; head at Endpoints; ears via InstanceOnPoints), bridge-from-two-splines (deck sweep + divided-curve cables via PipeOnCurve).

### C7. `[x]` (5310f25) Stadium benchmark in the eval harness

**File:** `src/ai/evalHarness.ts` prompts. Brief: *"a recognizable stadium where every part derives from at most 2 driving curves."* Pass = sane geometry + vision check recognizes a stadium + `derivationRatio ≥ 0.5` + proportional integrity ≥ 0.85. Track per model per build.

---

## Sequencing

| Week | Land |
|---|---|
| 1 | A1–A9 + regression gate. Ship alone — it de-risks everything after. |
| 2 | B1–B4 (+B4a channels), C1–C2, C4. Re-run eval suite. |
| 3 | B5–B9, C3, C5–C7, golden exemplars. Stadium benchmark becomes the headline metric. |

Dependencies: A must merge before B evals are trustworthy (kernel faults would pollute B's numbers). C6/C7 require B1–B4.

---

## Git & deploy (Vercel)

- **Branching:** `fix/kernel-health` (Workstream A), `feat/curve-bridge` (B), `feat/derivation-thinking` (C). Small PRs per task group; every PR runs `npm run test` + `npm run build` locally before push.
- **This commit** (docs only — `stadium_transcript_analysis.md`, this plan, ROADMAP pointer) is safe for `main`: the Vercel build (`tsc -b && vite build`) does not compile `docs/`, so deploy output is unchanged.
- **Vercel gate for code PRs:** `tsc -b && vite build` green is the merge bar (same command Vercel runs). The worker is bundled by Vite from `src/worker/geometryWorker.ts` — A3/A5 respawn changes touch only runtime behavior, no config. No environment variables are introduced by this plan.
- **Verification before each push:** `npm run test` (including the two pre-existing failures noted in `local_model_harness_fixes.md` — do not let them grow), `npm run build`, then a manual smoke: cat brief + stadium brief on one local model.

---

## Definition of done (whole plan)

1. Phase D replay: ≤1 respawn, canary line present, zero repair-budget charges for kernel faults, session ends with geometry on screen.
2. A stadium brief on a 4B-class local model produces a graph where the bowl is lofted from curve rails and columns ride a divided curve — verified by `derivationRatio ≥ 0.5` in the log, not by eyeballing.
3. Every error a model sees names its class and who should act (model vs system).
4. EVAL_RESULTS trend lines exist for derivation metrics across ≥2 builds.
