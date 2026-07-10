# Multi-Model Cat Test — Deep-Dive Analysis (2026-07-10)

Forensic analysis of the "make a cat" sessions run across GLM-5.2, GPT-5.6, Claude, Gemini and Grok via OpenRouter, correlated against the current source. The headline finding changes how every one of those transcripts should be read.

## The headline: every model was chasing phantom errors

The wall of `Leaf "body" could not be meshed: Node "body" (Ellipsoid) produced no geometry — check its parameters are valid numbers within range.` that appears in **every** run is a false positive produced by an inverted condition in the geometry report, not by the models' graphs.

In `src/worker/geometryWorker.ts`, the report loop skips failed nodes and flags healthy ones:

- Line 527: `if (!value) continue;` — nodes that *actually* produced null are silently dropped from the report.
- Lines 609–614: the `else if` branch fires for every node that **is** a source of a consuming edge (i.e. every healthy intermediate node) and pushes a leaf report with `meshOk: false` and an `explainNullGeometry()` message.

Trace a healthy two-node graph `Sphere(body) → Translate(bodyT)`: `body` is in `sourceNodeIds`, its value is a valid shape, so it falls into the else-branch and gets reported as "produced no geometry — check its parameters are valid numbers within range." Meanwhile `bodyT` meshes fine and the cat renders. That is exactly the transcript text (including the doubled period from sanity's added ".").

Consequences, all visible in the transcripts:

1. **Sanity can never pass** for any graph containing an edge, so every run ends in "Auto-repair limit reached" regardless of quality. `checkGeometrySanity` (verification.ts:140–143) turns each phantom into a blocking issue.
2. **Models were told their healthy parts were broken.** They "fixed" working primitives — resizing, re-adding, moving them — which is why graphs churned and degraded across repair rounds (GPT's cat disassembling, Gemini removing ScaleXYZ inputs).
3. **Real failures are invisible.** A genuinely null node is skipped by line 527, so its cascade produces either silence or only "No leaf node produced meshable geometry". The explainer built to diagnose null geometry never runs on null nodes.
4. **All tracked metrics are poisoned.** `geometrySane` in performance logs and EVAL_RESULTS has been structurally false; historical eval numbers are not comparable to post-fix numbers. The "Save as successful?" nudge fires anyway (it only checks `lastEvaluationError`), so the knowledge base was being offered graphs from sessions the chat labeled broken.

The consumed-node branch was meant to catch nodes whose value is null; the guard order inverted it. **This is the single highest-leverage fix in the codebase** — one conditional, plus a regression test asserting a healthy `Sphere→Translate` graph yields zero issues.

## Failure taxonomy across the five runs

**F1 — Phantom "produced no geometry" walls (all runs).** Root cause above. Every consumed primitive (`body`, `head`, `earL`…) and consumed transform (`eyeLShape` (ScaleXYZ), `tailRotate`) flagged. The "despite connected inputs — likely invalid parameters" variant is the same bug hitting consumed transforms.

**F2 — `Align missing required input: "shape"` loops (GPT-5.6, Grok, Claude).** Real wiring errors, but the loop around them is broken:
- Structural failure returns before `setNodes` (`agent.ts` `applyAndPerceive` 174–186), so the canvas **never updates** — this is the literal cause of "still no 3d preview": the user watches a stale/empty viewport while turns burn.
- In the legacy JSON path the exemption `attempt--` (agent.ts:649) makes persistent structural errors an **infinite loop** (attempt oscillates 0→-1→0); only model drift breaks it. The tool path is capped at 8 turns.
- The error tells the model what's missing but not the one-line fix, and weak models re-emit the same graph. Likely sources of the missing edge: explicit `targetHandle:"reference"` on the chain edge with the shape edge never sent, truncation cutting the `connect` batch, or edges dropped because their source id didn't exist (`droppedEdges`) — the current message doesn't distinguish these.

**F3 — `Evaluation timed out after 30s` (GPT-5.6 ×4).** Three compounding causes:
- The perturbation test (geometryWorker.ts:838–895) synchronously re-evaluates the whole graph at 0.6× and 1.5× **per slider** — 7 sliders = 15 full evaluations — including re-meshing every leaf, since perturbed hashes never match cached meshes.
- `Ellipsoid` and `ScaleXYZ` don't use an affine kernel transform; they tessellate the shape and **sew hundreds of triangle faces back into a B-Rep** (`deformation.ts` `solidFromDeformedMesh`, `nonUniformScale` 122–133). A cat is 10+ of these. This is also why the renders look faceted.
- `waitForEvaluation` hard-caps at 30s (useStore.ts:63–72) and the timeout is **not** classified as a system error (`errors.ts`), so it burns repair budget and hands the model `report: null` — it then edits blind. The worker meanwhile finishes and the viewport updates *after* the agent already gave up, matching your "the cat showed up later" observations.

**F4 — `This object has been deleted` engine faults (Grok/Claude run).** OCCT wrapped-shape lifetime. Deletions in cache eviction are already commented out (geometryWorker.ts:483–487, 863–867); remaining suspects are `Ellipsoid`'s `base.delete()` after `nonUniformScale` (executors.ts:117) and stale shapes surviving worker recycling (400-eval hint) into `clone()` calls. Already budget-exempt with a single respawn-retry, but each fault costs a turn.

**F5 — Proportional-coherence spam (GLM run: ~50 lines).** The perturbation findings are per-part, per-slider, per-direction, mostly the same root cause ("derive position from driver sliders or use Align") repeated 30+ times. For a weak model this drowns the two lines that matter. They also gate sanity alongside hard failures, so an *aesthetic-tier* property (proportional integrity under slider perturbation) consumes the same repair budget as "nothing rendered".

**F6 — Truncation/protocol fragility (Gemini, 401-fallback runs).** Full-graph JSON for a 60-node cat flirts with the 8000-token cap; a truncated response fails `robustJSONParse` (regex requires the closing `}`), which triggers a "resend everything" retry with the same cap. Wrong-case or misnamed param keys in `data` (e.g. `RadiusX`) are silently ignored — executors fall back to defaults (`num()`), the UI shows empty value boxes (visible in the GLM screenshot), and no one is told.

## Per-model observations (what to harness)

- **GLM-5.2** never used Align — pure Translate stacking, old idiom, but it *did* assemble a recognizable cat. Weak models default to the simplest spatial idiom they know; the phantom wall was the only thing telling it it had failed.
- **GPT-5.6** had the best structural intent (ground→legs→body→head Align chains, per-part drivers) and was killed entirely by infrastructure: missing-shape loops, then timeouts.
- **Claude** produced the richest plan (patterned whiskers, S-curve Pipe tail, graded proportions catSize→everything). Its failure modes were geometric detail (whisker cylinders oriented/sized wrong → the giant white rods) — exactly the kind of error the geometry report *should* catch with orientation/length percepts.
- **Gemini** reached for Mirror-based symmetry — the right instinct; wiring subtleties (Mirror consumes its input; original must be re-included via Compound or a second leaf) aren't documented in the system prompt, and it collapsed into missing-solid errors.
- **Grok** followed the Align-chain recipe and got stuck on the same missing-shape structural loop.

The shared lesson: no model, strong or weak, could converge because the feedback channel itself was wrong. Fix the channel before judging any model's latent-space competence.

## Fix plan

### P0 — Make feedback truthful (do these first, in this order)

1. **Fix the phantom-leaf branch** (geometryWorker.ts:526–615). Report `explainNullGeometry` only for nodes whose cache value is null/undefined; never emit leaf reports for healthy consumed nodes. Move the null check so failed nodes are reported instead of skipped. Add `tests/`: healthy `Sphere→Translate` ⇒ 0 issues; `Align` with null upstream ⇒ exactly one cascade-labelled issue.
2. **Classify timeout as infrastructure.** Add "timed out" to `isSystemError` or a third budget-exempt class; on timeout, retry once with perturbation disabled before involving the model.
3. **Decouple the perturbation test from the blocking evaluation.** Skip meshing in perturbed runs (bboxes come from the B-Rep; `mesh()` is viewport-only), cap tested sliders to the 2–3 most-referenced, and post results as a follow-up report message rather than blocking `EVALUATE_DONE`. This alone should erase the 30s timeouts.
4. **Aggregate and rank issues before the model sees them.** One line per root cause with a count and worst offender ("14 parts shift non-proportionally when catSize moves — positions use absolute Translates; worst: bodyGround (9%)"). Order: structural → null geometry → engine → containment/detachment → proportional. Cap at ~5 lines; keep the full list in the UI, not the prompt.
5. **Split sanity into `blocking` vs `quality`.** Renders-at-all, null leaves, structural = blocking (gate repairs). Containment, proportional integrity, node economy = quality (reported, never burn budget, never produce "Auto-repair limit reached" on a cat that renders).

### P1 — Protocol ergonomics for weak models

6. **Structural errors must carry the fix as a literal op.** Extend the missing-input message with `Add: {"source":"<best candidate>","target":"legFLAttach","targetHandle":"shape"}` when exactly one unconsumed solid exists whose id/plan-name matches; otherwise list the 2–3 candidates. Weak models are excellent at copying ops and terrible at re-deriving them.
7. **Deterministic structural autofix tier.** Before asking the model at all: auto-connect an Align missing `shape` when there is exactly one dangling solid candidate, auto-coerce `solid`→`shape` handle names on Align, and cap budget-exempt structural retries at 3 (fixes the `attempt--` infinite loop).
8. **Validate `data` keys in `add_nodes`/JSON ingestion.** Unknown param key ⇒ case-insensitive/fuzzy match to the real param (`RadiusX`→`radiusX`, warn), truly unknown ⇒ loud per-key error in the tool result. Silent dropping is why sliders showed empty boxes.
9. **Incremental ops for `optimizeForSmallModels`.** Replace single-shot full-graph JSON with NDJSON ops (one `{op:"add_node"...}` per line): parse line-by-line, apply the valid prefix, and on truncation ask only for the remainder. This converts truncation from catastrophic to trivial and matches the parameter-layer plan already in docs/research.
10. **Shrink the decision surface in weak-model mode.** Offer a curated core library in the prompt (primitives, Translate, Rotate, ScaleXYZ, Align, Mirror, Linear/CircularPattern, NumberSlider) and mention the rest exists on request; disable vision verification and perturbation reporting; keep issue feed ≤3 lines.

### P2 — Kernel and performance

11. **Native affine scaling.** Route `Ellipsoid`/`ScaleXYZ` through `BRepBuilderAPI_GTransform` (gp_GTrsf with diagonal scaling) and keep `solidFromDeformedMesh` as fallback only. An order of magnitude faster, smooth surfaces, far smaller meshes downstream — Bend/Twist legitimately need the mesh path; uniform/diagonal scaling does not.
12. **Progress-aware timeout.** Worker posts `EVALUATE_PROGRESS` per node; main thread extends the deadline while progress flows and only times out on stall. Raise the ceiling to 60s for graphs >30 nodes in the interim.
13. **Shape-lifetime audit.** Remove `base.delete()` in Ellipsoid (harmless leak vs. corruption risk), wrap `clone()` in try/catch that re-executes the node on "deleted" faults, and reset `shapeCache` on worker recycle boundaries atomically.

### P3 — Design intelligence and knowledge base

14. **Mirror recipe or `includeOriginal` param.** Gemini's symmetry instinct was correct and the graph idiom to express it is undocumented. Cheapest robust fix: add `includeOriginal: true` to Mirror so one node yields the pair; document "build left, mirror right".
15. **Gate the save-nudge on blocking sanity**, not just `lastEvaluationError`, so the success library stays clean. Keep saving *failures* too — but into a separate labeled corpus (prompt, ops, issue evolution, outcome) exported as JSONL; these transcripts are exactly the training/eval substrate the project needs, and today they evaporate into chat history.
16. **Floor benchmark ("L0") — the weakest-model contract.** Add to `evalHarness.ts` and require 100% before any prompt/library change ships:
    - L0-01 single primitive with given dims; L0-02 two-part stack via Align(above); L0-03 slider-driven resize (one slider, two formulas); L0-04 recolor an existing node; L0-05 clear + rebuild simple object; L0-06 the cat brief itself as the graduation prompt.
    Success = blocking-sane geometry + non-empty viewport, with quality issues allowed. Track per model in EVAL_RESULTS; the current L1 set is close but includes fillet/text/kernel edge cases that don't belong in a floor.
17. **Percepts that name fixes, not just problems** (medium-term, aligns with the sub-shape/anchor plans): orientation percepts for elongated parts ("whiskerL axis spans 78% of scene X — likely wrong rotation axis"), and attachment suggestions phrased as Align ops. The bounding-box relations engine already computes what's needed; it's a formatting problem.

## Reading the benchmark question honestly

"Enable even the lowest-performance models to build something" is achievable, but the transcripts show the current stack failing models from the top down: GPT-5.6's run contained a fully correct construction plan defeated by a false error channel, a 15× hidden evaluation multiplier, and a 30s guillotine. Until P0 lands, transcript-based conclusions about *model* capability in this latent space are unreliable — the models were playing a rigged game. After P0, re-run the same five models on the same cat brief; that becomes the true baseline for the knowledge base, and my expectation is that the Align-chain recipe plus op-level structural fixes puts even GLM-class models over the floor consistently.

## Verification notes

Claims cross-checked against source at the cited lines: phantom branch (geometryWorker.ts:527 + 609–614), explainNullGeometry text match to transcripts (17–44), sanity gating (verification.ts:134–156), structural early-return skipping `setNodes` (agent.ts:174–189), `attempt--` exemption loop (agent.ts:639–650), 30s cap (useStore.ts:63–72), timeout not system-classed (utils/errors.ts), perturbation multiplier incl. meshing (geometryWorker.ts:838–895), mesh-sew scaling (deformation.ts:42–133, executors.ts:108–126,143–167), truncation marker + 8000 cap (api.ts:35,150,298–301), silent param keys (tools.ts add_nodes; executors.ts `num()` fallbacks), nudge gate (agent.ts:213–224).
