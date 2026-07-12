# Stadium/Cat Transcript Analysis — Kernel Poisoning and the Missing Curve→Solid Bridge

**Date:** 2026-07-12
**Series:** follows `cat_multimodel_test_analysis.md` (feedback channel) and `local_model_harness_fixes.md` (five silent-lie fixes). Those fixes are visible and working in this transcript — engine-fault caps fire, `removedEdgeIds` no-matches are reported, structural errors don't burn budget. This transcript exposes the **next layer down**: a kernel-health blind spot that wasted ~15 model turns, and a vocabulary ceiling that keeps even *successful* graphs at primitive-collage quality.

---

## Part 1 — What actually happened (session reconstruction)

The transcript (reverse-chronological in the log) has four phases:

**Phase A — "make a stadium":** two invalid-JSON resends, then a structurally valid graph *with zero edges* (truncation), then the model invented a `_scene_` node convention and wired every leaf to it. Engine faults follow. The `_scene_` hallucination is the model *guessing the rendering contract* because leaves-render-automatically is stated in error messages but the model had already committed to a different theory.

**Phase B — rebuilds:** engine faults with correct model behavior (it explicitly reasoned "engine fault, not caused by my design, don't modify the graph" — the July 10 message wording works). Produced working graphs. User verdict: *"these are working graphs but nowhere near stadium."*

**Phase C — the capability peak:** asked to analyze its own bottlenecks, the model produced a genuinely good analysis (thin-wall Boolean fragility, difference-of-cylinders over Shell, magic numbers as design failure, Align for stacking, illusion-of-detail via SubdivideSurface vs. modeling seats). It then built stadium variants (Ziggurat, Hyper-Sling, Solar-Spires) — all primitive collages: Torus bowls, Cone roofs, ScaleXYZ'd Ellipsoid "petals". Recurring mechanical failures: truncation dropping edge batches, Align input-order swap (shape vs reference), SelectFaces used as a leaf, zero-volume facade panels.

**Phase D — collapse (the expensive one):** after several engine faults and heavy graphs, **every node fails with opaque numeric errors** — `failed: 24`, `Sketch failed: 24`, `failed: 548501952`, `failed: 57503824` — for the remainder of the session. The model cycles Box → Sphere → Sketch → Plane → Pipe → Helix testing its "bindings are broken per node type" theory. It cites "confirmed working in July 2026 update notes" as evidence (a capability claim standing in for a test). It eventually reaches the *correct* diagnosis — *"the system needs a full reset beyond what I can do"* — and has **no tool that matches its diagnosis**. The user tries "still nothing try from clean graph" four times; clearing the graph does not recycle the worker, so nothing changes. Session ends in failure.

**Phase D headline:** the model was right, the harness was wrong, and the repair budget was charged to the model anyway. Zero curve/point nodes were used in the entire session despite the toolkit existing.

---

## Part 2 — Root causes in the harness (with code locations)

### 2.1 Per-node kernel errors are invisible to every kernel-health mechanism (P0)

The kernel-health machinery that exists today:

- Worker respawn + one retry on system error — but only for `EVALUATE_ERROR` messages (`useStore.ts:254–271`).
- Periodic worker recycle — but only after 400 evals (`geometryWorker.ts:235`, `WORKER_RECYCLE_HINT`).
- Engine-fault circuit breaker (3 consecutive) — but only when `isSystemError(percept.error)` is true (`agent.ts:718–727`).

None of these can see Phase D, because a poisoned kernel **evaluates "successfully"** — the per-node exceptions land in `report.nodeErrors` via the catch at `geometryWorker.ts:474–477`:

```ts
nodeErrors.push({ id: node.id, error: String(err.message || err) });
```

When OpenCascade WASM throws (Emscripten throws numbers/exception pointers), `err.message` is undefined and the model sees `failed: 24`. The string `"24"` matches nothing in `isSystemError()` (`utils/errors.ts`), so the sanity failure is classified as a *design* problem, charged to the repair budget, and the model is asked to fix its graph. Sixteen consecutive times.

Contributing factor: shape deletion is disabled entirely (`geometryWorker.ts:494–496`, the TopoDS pointer-corruption mitigation), so every eval leaks all shapes. Heavy stadium graphs plus perturbation evals accumulate; late-session allocation failure or corrupted heap state after an engine fault is the *expected* end state of a long session. Recycle-at-400 is far too late, and `clearGraph` never recycles.

**Fixes:**

1. **Error taxonomy at the catch site.** Classify each node error: `typeof err === 'number'` → `KERNEL`; `TypeError` containing "is not a constructor" → `RUNTIME`; message mentioning input params → `PARAM`; svgPath parse → `PARSE`. Attach the class to the report entry.
2. **Decode numeric throws.** Replicad exposes the `oc` module; attempt `oc.OCJS?.getStandard_FailureData?.(err)?.GetMessageString?.()` before falling back. Even when decoding fails, render it truthfully: `kernel exception (opaque code 24) — engine state problem, NOT a parameter problem`. Never let the Sketch executor blame the svgPath for a kernel-class error (`executors.ts:618–631` blames unconditionally — that hint sent the model rewriting valid paths repeatedly).
3. **Poisoned-eval detection → respawn + replay.** If ≥2 node errors are kernel-class in one eval (or any node type that previously succeeded this session now fails kernel-class), treat the whole evaluation as a system error: respawn the worker, replay once (extend the existing `hasRetriedDeleted` path), do not charge the repair budget.
4. **Canary after respawn.** Evaluate a hardcoded `Box(10,10,10)` in the fresh worker before replaying. Put one line in the geometry report: `kernel health: OK (canary passed)` or `kernel health: FAILED — engine restart required`. This single line kills the entire "which primitive still works" search space for the model. If the canary fails post-respawn, stop the episode with an honest message.
5. **Fresh worker on `clearGraph` / new episode.** Cheap, and it makes the user's instinctive recovery action ("try from clean graph") actually work.
6. **Recycle much earlier.** With deletion disabled, 400 evals of stadium-scale graphs is fantasy. Recycle every ~50 evals, or when `WebAssembly.Memory` growth crosses a threshold.

**Acceptance test:** replay Phase D's graph sequence. Expected: one respawn + canary, evaluation proceeds, fewer than 5 system messages total, zero repair-budget charges for kernel faults.

### 2.2 Cross-attempt diagnosis state (P1)

Phase D's thrash was six tests of the *same hypothesis* (swap node type). The repair prompt contains graph state + ranked issues (`agent.ts:697–701`) but no memory of what was already tried. Add a harness-maintained, 3-line `DIAGNOSIS STATE` block to each repair prompt: `tried:` (fix classes attempted), `ruled out:`, `open hypotheses:`. Additionally, after two failed repairs on the same node, run a **harness-side minimal repro**: evaluate that node alone with defaults in a scratch context (no model turn), then tell the model the result — "fails even alone ⇒ not your graph" vs "works alone ⇒ your inputs". This is the July 10 lesson generalized: give the model *causal attribution*, not just observations.

### 2.3 Capability claims need canaries, not citations (P1)

"Helix which was confirmed working in July 2026 update notes" — no such text exists in the codebase or guidelines; it came from KB retrieval or confabulation. Either way the lesson holds: **node health must come from tests, not documents.** Run a per-build node smoke matrix (instantiate every node type with defaults once, in dev), store it, and inject the support matrix into the prompt. Version-stamp KB examples (`verified on build X, 2026-07-09`) so retrieval can't present stale success as current capability. This is verify-before-store extended to verify-before-*cite*.

### 2.4 Patch protocol residue (P2)

The fuzzy edge matching + no-match reporting from July 10 works (`agent.ts:1039–1070`). Remaining friction: the model retried identical wrong ids. When a `removedEdgeIds` entry matches nothing, append the *actual current edges* touching the named nodes to the note — a candidate list turns the retry into a correction.

---

## Part 3 — The ceiling: why working graphs are "nowhere near stadium"

This is the part that answers the roadmap question ("motivate models to create geometry from existing geometry... dividing curves on points, translating curves, lofting curves, connecting points, arrays of points... everything starts with the point").

### 3.1 The models are not choosing primitive collage — the system is

Three forces steer every model into Torus-bowl/Cone-roof territory:

1. **The prompt says so.** CORE RULE 2: *"The solid chain … is usually the ONLY kind of edge you need"* (`agent.ts:99`). For a weak model, that sentence is a command: never touch Curve/Point sockets.
2. **The node docs are a phone book.** `condensedNodeLibrary()` (`agent.ts:58–67`) emits ~60 one-line signatures with zero compositional idioms. A signature dump teaches *what exists*, never *what composes with what to achieve what*.
3. **Retrieval reinforces the incumbent style.** VERIFIED PAST EXAMPLES are primitive collages, so every new design inherits the dialect.

### 3.2 The curve/point layer is an island

The July 9 toolkit shipped a real skeleton vocabulary — and it dead-ends. Audit of `NodeDefinitions.ts`:

| | Producers | Consumers |
|---|---|---|
| **Curve** | Line(2Pt), Arc(3Pt), CircleCurve, EllipseCurve, PolylineCurve, SplineCurve, EdgesAsCurves | Endpoints, CurveLength, PointOnCurve, EvaluateCurve, DivideCurve — **measurement only** |
| **Point** | Point, Centroid, Midpoint, PointBetween, Endpoints, PointOnCurve, EvaluateCurve, DivideCurve, PointGrid, Jitter | Line/Arc/CircleCurve/EllipseCurve anchors, PolylineCurve, SplineCurve, Jitter — **curve constructors and noise only** |

**No node converts a curve into a solid.** Loft takes `profile1..4: Solid` (`NodeDefinitions.ts:416–421`). Revolve takes `profile: Solid` (`:429`). Pipe takes a `pathSvg` *string param*, not a Curve input (`executors.ts:634`). Extrude wants sketch faces. **No node instances geometry on points** — PlaceOnVertices reads a *solid's* vertices (`:498–511`).

The only bridge back to solids is `DeconstructPoint → three param: edges → Translate x/y/z`. Three edges per placement is maximal friction; hardcoding `{"x": 24}` is one token. **Type gravity guarantees the observed behavior:** models will always take the cheapest well-typed path, and today that path is magic numbers. Interconnectivity is low not because models can't think in dependencies, but because dependency edges are the expensive option.

### 3.3 Close the loop — the Bridge wave (highest leverage nodes, in order)

1. **PipeOnCurve** — add an optional `path: Curve` input to Pipe that overrides `pathSvg`. Smallest change, immediately makes every curve producible as visible geometry (cables, handrails, rims, tubes).
2. **ExtrudeCurve** — closed planar Curve → face → prism (`height`, optional `draft`). Stadium footprint slab from the boundary ellipse.
3. **LoftCurves** — `curve1..curve6` → surface/solid (`closed`, `ruled`, optional `thickness` for shells). *The* stadium idiom: three ellipse rails at heights → seating bowl in one node.
4. **InstanceOnPoints** — `shape: Solid` + `points: Point` → Compound, with `alignToTangent` (when points carry tangent, e.g. from DivideCurve), `scaleStart/scaleEnd`, `everyNth`. Kills the DeconstructPoint dance; columns-on-divided-ellipse becomes two edges.
5. **TransformCurve** — translate/rotate/scale a Curve ("translating curves" from the roadmap; tier rails = one EllipseCurve + two TransformCurves at z-heights, all driven by sliders).
6. **OffsetCurve** — planar offset (concourse rings, wall thicknesses, track lanes).
7. **SweepAlongCurve** — `rail: Curve` + `profile: Curve|Solid`, auto-orient to tangent (roof ribbons, gutters, rims).
8. **RevolveCurve** — `profile: Curve` + axis (vases, domes — without the SVG detour).

Make **DivideCurve emit channels** (`index`, `t`, `tangent`) on its point stream so InstanceOnPoints and formulas can grade per-instance scale/rotation — this matches the CircularPattern `scaleStart/scaleEnd` idiom that already works.

With these eight, the stadium construction the user is asking for becomes expressible in exactly the terms they stated: *EllipseCurve (the point→curve seed) → OffsetCurve/TransformCurve (translating curves) → LoftCurves (lofting curves) → DivideCurve (dividing curves into points) → InstanceOnPoints (arrays on points) → Line/SplineCurve between division points (connecting points) → PipeOnCurve (making connections visible).* Every element derives from one ellipse; move one slider, the entire stadium follows. That is the interconnectivity target, achieved *by construction* rather than by exhortation.

### 3.4 Make derivation the path of least resistance

- **Geometric sockets override scalars.** Give Translate (and friends) an optional `target: Point` input that overrides x/y/z. When a geometric input is connected, the report suppresses hardcoded-dimension warnings for those params. Cheapest well-typed path flips from literals to derivation.
- **Rewrite CORE RULE 2** around *two spines*: the SOLID chain (assembly) and the SKELETON chain (points/curves that big forms derive from). Teach: "Large smooth forms are lofted from rails; rhythm comes from divided curves; tubes follow curves. Primitives + Align are for boxy/mechanical assemblies."
- **Construction ladder for weak models** (explicit decision procedure beats open creativity at 4B scale):
  - shell / bowl / hull / organic skin → 2–3 rail curves at heights → **LoftCurves**
  - tube / cable / rail / branch → curve → **PipeOnCurve**
  - repeated elements along a boundary (columns, windows, seats, spokes) → curve → **DivideCurve → InstanceOnPoints**
  - rotationally symmetric → profile curve → **RevolveCurve**
  - boxy / mechanical → primitives + **Align**
- **`set_plan` grows a SKELETON section:** named datum points/curves and what derives from each, *before* the parts list. The conceptual→parametric translation the roadmap asks for is exactly this two-register plan: register 1 is what the object *is* (bowl wrapping a field, floating roof); register 2 is what each element *derives from* (one ellipse; offsets; division points). Requiring the second register in the plan is how "thinking directly through parametric geometry" becomes a trained habit rather than a hope.

### 3.5 Measure it (extend the tracking you already do)

Add per-response graph-shape metrics to the geometry report and `intelligence_log.json` / EVAL_RESULTS:

- **derivation ratio** — geometry nodes with ≥1 geometry-input edge ÷ all geometry nodes (collapses to ~0 for primitive collages)
- **skeleton usage** — count of Curve/Point nodes on paths that reach leaves
- **magic-number count** — already detected ("hardcoded dimensions"); log it as a number
- **longest derivation chain** and **edge/node ratio**
- **proportional integrity** — already exists (perturbation)

Then make the stadium the benchmark brief: *"a recognizable stadium where every part derives from ≤2 driving curves"* is a crisp, measurable milestone for the eval harness, and the trend lines across models/builds tell you whether derivation thinking is actually improving.

### 3.6 Seed the KB with golden derivation exemplars

Two or three hand-verified graphs stored as VERIFIED PAST EXAMPLES (not macros — examples that teach the *shape of thought* while leaving construction free): stadium-from-one-ellipse; cat-from-spine-curve (spine spline → perpendicular profile circles graded by t → LoftCurves body → head sphere at Endpoints → ears via InstanceOnPoints); bridge-from-two-catenary-splines. Retrieval currently amplifies whatever dialect dominates the KB — put the dialect you want in it.

---

## Part 4 — Sequencing

**Week 1 (reliability — turns Phase D into a non-event):** error taxonomy + numeric decode; poisoned-eval respawn/replay + canary line in report; fresh worker on clearGraph; recycle at ~50 evals; candidate edges in no-match notes; DIAGNOSIS STATE block. Re-run the Phase D replay and the five-model cat suite as regression.

**Week 2 (bridges — the 80/20):** PipeOnCurve, ExtrudeCurve, LoftCurves, InstanceOnPoints (+ DivideCurve channels); CORE RULE 2 rewrite + construction ladder; derivation metrics in report/log.

**Week 3 (completion):** TransformCurve, OffsetCurve, SweepAlongCurve, RevolveCurve; geometric sockets on Translate; `set_plan` SKELETON section; golden exemplars; stadium benchmark in the eval harness.

---

## Appendix — Evidence index

| Transcript quote | Diagnosis |
|---|---|
| `Node "n_base" failed: 24` (Box, hardcoded dims) | Kernel-class exception surfaced as opaque number (`geometryWorker.ts:476`); misclassified as design error |
| `Sketch failed: 24. Check the svgPath string` | Executor blames svgPath unconditionally (`executors.ts:625–627`); model rewrote valid paths |
| `failed: 548501952`, `failed: 57503824` | Raw WASM exception pointers — decode via OCJS exception data |
| "Trying Sphere … different OC bindings" ×6 node types | Hypothesis thrash; no cross-attempt diagnosis state, no canary to falsify the theory |
| "the system needs a full reset beyond what I can do" | Correct diagnosis, no matching tool — add respawn+canary, fresh worker on clearGraph |
| "confirmed working in July 2026 update notes" | Capability claim without provenance — smoke matrix + version-stamped KB |
| `_scene_` edges, self-edges to "make leaves render" | Model guessing the rendering contract — rules exist only in error text, arrive after commitment |
| Truncated JSON → 0 edges → resent edges mismatch | Monolithic graph JSON; continue-from-cutoff exists in tool path, JSON path still resends whole graphs |
| Working stadiums = Torus bowl + Cone roof | Curve layer is an island: no curve→solid nodes, no point instancing; prompt steers to solid-chain-only |
| Zero curve/point nodes used all session | Type gravity: derivation is the expensive path today |
