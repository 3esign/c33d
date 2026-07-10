# "Make a Sailship" Cross-Model Test — Deep-Dive Analysis

*July 9 2026. Sources: full chat transcript + 9 model screenshots in `Screenshots/`. Same prompt,
same system, ~10 models via OpenRouter/Ollama.*

## Scoreboard

| Model | 3D result | Dominant failure |
|---|---|---|
| gpt-5.6-terra-pro | ✅ best run — recognizable ship (hull/deck/cabin/mast/2 sails/finial) | still had "produced no geometry" rounds |
| gpt-5.6-luna-pro | 🟡 partial ship, proportions off | no-geometry params, vision 4/5 (too lenient) |
| claude-fable-5 | 🟡 hull + deck cutout + bare mast, no sails | truncation mid-turn, deleted-object |
| kimi-k2.7-code | 🟡 floating planks, wrong proportions | JSON fallback quality |
| claude-opus-4.8 | ❌ empty scene | deleted-object |
| gemini-3.5-flash | ❌ empty scene | deleted-object + missing Align edges |
| grok-4.5 | ❌ empty scene | ~10 Align nodes all missing "shape" edges |
| nemotron-3-super | ❌ empty scene | deleted-object *even on a 5-edge Box+Translate graph* |
| minimax-m3 | ❌ empty scene | deleted-object |

**Verdict: this test did not measure model capability.** 5 of 9 runs were killed by a single engine
bug, and most remaining budget was burned by protocol failures. The strongest and weakest models were
nearly indistinguishable because the system, not the model, set the ceiling. Fixing the two system
issues below is worth more than any prompt or knowledge-base improvement.

## F1 — "This object has been deleted" (engine bug, kills ~55% of runs)

New evidence from this test narrows it decisively:

- It occurs on a **minimal 5-edge Box+Translate graph** (nemotron run) — no exotic nodes needed.
- It recurs after **erase → rebuild** cycles, with models reusing common ids (`hull`, `deck`) —
  consistent with corruption living in the **persistent shapeCache**, which survives graph clears.
- It became frequent after the July reliability work added **pass-through-on-failure** to many
  executors (Fillet/Mirror/Extrude "passed the input through UNCHANGED").

**Leading hypothesis:** replicad `.clone()` and pass-through both produce wrappers that share the
underlying OCCT `TopoDS_Shape`. When cache eviction `.delete()`s a stale entry, every other wrapper
over that same WASM object dies with it — the next `mesh()` call throws "This object has been
deleted." The identity-set check in eviction compares *JS wrapper* identity, not underlying-shape
identity, so a clone slips past it.

**Fix sequence (do this before anything else in this doc):**

1. **Repro harness** `tests/test_lifetime.mjs`: box → oversized fillet (triggers pass-through) →
   change a param → re-evaluate → mesh. Also: build → clear-all → rebuild same ids → mesh.
2. **Verify replicad clone semantics** (does `.clone()` share the wrapped OCCT object?). If shared:
   deep-copy via `BRepBuilderAPI_Copy`, or stop deleting at all (see 4).
3. **Purge shapeCache** on graph-clear instead of relying on the eviction pass.
4. **Consider not calling `.delete()` at all** — accept WASM memory growth, add a "rebuild kernel"
   button / auto-restart worker at a memory threshold. A leak is strictly better than corruption;
   this is the 1-line mitigation that would have saved 5 of 9 runs today.
5. **Worker respawn as auto-recovery:** when evaluation throws "deleted", terminate + respawn the
   worker and re-evaluate once *before* charging a model repair round. Kernel corruption is not the
   model's problem to solve.

## F2 — Error attribution: the system makes models superstitious

The transcript is full of confident, physics-flavored, **entirely false** diagnoses: "Cylinder max-Z
face coplanar with a Translate target plane collides OC handles", "rotating a thin extruded shape 90°
causes deletion", "Boolean union with touching coplanar faces". Models then *degrade their designs to
appease a ghost* — removing Booleans, Bends, ScaleXYZ, sketch-extruded sails ("no Boolean cuts to
avoid kernel errors") — and ship worse geometry that still crashes.

Two poisoning risks: (a) repair budget spent on unfixable system errors; (b) **the knowledge base** —
if any of these runs get saved, false lessons ("avoid Rotate after Extrude") enter the few-shot corpus
and degrade every future model.

Fixes:

1. **Classify errors as SYSTEM vs MODEL** in the report. Kernel-level errors ("deleted", WASM aborts)
   present as: *"Engine fault — not caused by your design. Do not modify the graph to work around it;
   the system is retrying."* Auto-repair rounds are only consumed by MODEL-class issues.
2. **Block Save-as-Successful** (and eval `geometrySane`) for runs containing SYSTEM-class errors;
   never let superstition into the success library.
3. The repeated Align-missing-"shape" cascades (grok: 10 Aligns, zero shape edges) are ingestion-time
   detectable — reject/report at graph-apply, don't spend repair rounds (already planned; this test
   re-confirms it as the #2 budget drain).

## F3 — Protocol failures (the JSON fallback is where quality dies)

Observed: invalid JSON ×8, output-limit truncation mid-graph ×3 (leaving half-wired graphs the model
then repairs blind), empty responses, one client bug (`Cannot read properties of undefined (reading
'split')` in tool-call parsing — find and fix), and an OpenRouter key-limit 403 silently degrading the
run mid-session. All previously roadmapped (incremental ops/DSL); this test adds: **truncation
recovery must re-sync state** — after a truncated emission, send the model the *actual* current
node/edge list, not just "continue", because it continues from its imagined graph otherwise.

## F4 — Real capability gaps (only visible once F1–F3 are gone)

Sails expose the toolkit gaps precisely: models had no way to make a billowed triangular sail (needed:
Sketch→Extrude→Rotate chains kept failing; proper answer is curve/loft/surface tools from the
vector-curve catalog), no anchors (mast-top, deck-front positions all guessed — the Measure/Centroid/
attach() work), and Bend-on-thin-box as the only curvature tool. The one perturbation-test firing in
the transcript (finial 9% deviation) shows the new validator working — good.

## F5 — The node-economy request (user direction, confirmed right)

Requested: fewer nodes — one Translate with a *list* of vectors instead of N Translate nodes;
surfaces/faces of existing parts defining points that seed the next construction layer.

- **List-driven transforms partially exist** (list auto-expansion in Translate/Rotate) but models
  never use them: not documented in the prompt catalog, no percept shows the expansion, and Compound
  is needed to collect results. Action: document + exemplar + make `PlaceOnVertices`/future
  `CopyToPoints` the canonical instancing idiom.
- **Faces-as-next-layer-substrate** is exactly the Selection → anchors → attach() pipeline already
  designed (sub-shape doc + vector/curve catalog). This test adds motivation: every removed node is
  fewer tokens → fewer truncations → fewer F3 failures. Node economy is a *reliability* feature.
- Add **node-economy to metrics**: nodes-per-leaf ratio in the eval report; flag graphs with >2×
  transform nodes per rendered leaf.

## Priority order (updated for today's evidence)

| # | Action | Class |
|---|---|---|
| 1 | Lifetime repro test + clone audit + stop-deleting mitigation + worker respawn | F1 engine |
| 2 | SYSTEM/MODEL error classification + save-gate + repair-budget exemption | F2 attribution |
| 3 | Ingestion-time edge rejection + truncation state re-sync | F3 protocol |
| 4 | Fix tool-call parser `'split'` crash; loud key-limit failures | F3 client |
| 5 | Document list-expansion + instancing idiom + node-economy metric | F5 |
| 6 | Then: re-run this exact sailship matrix — it becomes the before/after proof for the results/ table | eval |

Prediction to verify after #1–#4: the empty-scene rate should drop from ~55% to near zero, and the
spread between models should *widen* (capability becomes visible again). If it doesn't, the diagnosis
above is wrong and the repro harness will say why.
