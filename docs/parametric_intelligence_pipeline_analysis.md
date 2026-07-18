# Parametric Design Intelligence — Pipeline Analysis & Fixes

_Date: 2026-07-14. Source: the "clean the graph → still not correct" transcript (circle → divide → pipe → instanced spheres, then the three-ring cage request). Scope: diagnose why simple, well-specified prompts failed, and harden the pipeline so models can actually solve them. Treat this as general parametric intelligence, not a one-off bug hunt._

## The transcript in one sentence

The model understood the design correctly almost every time — a big circle, points on it, a ring, and randomly-sized spheres scattered on the points — but the **pipeline** kept turning correct intent into broken graphs: a wrong default handle silently dropped the edge that put spheres on the circle, a schema mismatch deleted the sphere-scatter node outright, the Pipe node crashed on closed rings with an opaque code, and finally the JSON channel collapsed into truncated and empty responses. None of these are reasoning failures. They are avoidable failures of the harness around the model.

This matters beyond one transcript. Every one of these is a place where the system silently punished a reasonable action, forcing the model to rediscover a house rule instead of designing. A parametric-design intelligence is only as good as the feedback surface it stands on; most of the "intelligence" gap here was the surface, not the model.

## What actually went wrong — six failure classes

**1. Output-protocol collapse (fatal).** The end of the transcript is a wall of `Response was not valid JSON`, `Model returned an empty response`, `API Error: 400`, and truncated `{"reasoning": "..."` fragments. Two things compound here. First, once a provider rejects the native tool-call grammar, `runAiIntent` permanently flips the agent to `disableToolCalling` and drops to the single-shot JSON protocol for the rest of the session (`agent.ts`, the `/400|grammar/` branch). The native path is incremental and bounded — `set_plan`, then `add_nodes`, then `connect`, each a small call. The JSON path asks for the **entire** graph plus a verbose `reasoning` field in one payload. Second, the protocol told the model to put its _full_ plan — "SKELETON first … then parts, attachments, ratios, then verification notes" — into `reasoning`. On the three-ring request the reasoning alone ran hundreds of tokens; against the `MAX_OUTPUT_TOKENS` ceiling the nodes/edges got cut mid-array, `robustJSONParse` failed, and the repair loop asked for a resend that truncated again. This is the classic reasoning-field-eats-the-budget failure.

**2. The wrong source-handle default (systemic tax).** This is the single highest-leverage bug. When an edge omits `sourceHandle` — which the prompt and the `connect` tool _actively encourage_ "to save tokens" — the code that writes the edge defaulted the handle to `'value'` for number nodes and **`'solid'` for everything else**. But `Point` outputs `point`, `VectorXYZ` outputs `vector`, `CircleCurve`/`Line`/`Spline` output `curve`, and `DivideCurve` outputs `points`. So every skeleton edge got stamped with a `solid` output the node does not have, and the structural validator correctly rejected it. The model then burned a turn rediscovering "the validator defaulted to solid, I must specify handles" — _every single episode_, because episodes are stateless. Worse, there were **three** copies of this logic and they disagreed: `graphValidation.ts` inferred the handle correctly from `outputs[0].name`, while the two paths that actually _wrote_ edges (`tools.ts::defaultSourceHandle` and `agent.ts::applyParsedGraphOps`) hardcoded `'solid'`.

**3. "Spheres in the centre" (a cascade, not a new bug).** The user repeatedly reported the spheres sitting at the circle's centre instead of instanced on it. The `InstanceOnPoints` executor is correct — it translates each copy to its point. The real chain is: the `DivideCurve → InstanceOnPoints.points` edge got the wrong `solid` source handle (class 2) → the edge failed type-checking and was dropped → `InstanceOnPoints` saw zero points and returned null → only the base `Sphere` leaf rendered, at the origin. So the most-repeated user complaint in the whole transcript was a _downstream symptom_ of the handle default. Fix class 2 and this largely disappears.

**4. Kernel opacity on closed-curve Pipe.** "Sweep a small circle around the big circle to get a pipe" is geometrically a torus, but the model reasonably reached for the `Pipe` node with the circle on its `path` input. OpenCascade's `BRepOffsetAPI_MakePipe` is numerically unstable sweeping along a _closed_ wire, so it threw a raw kernel exception. The error surfaced as `kernel exception (opaque code 11744448) — engine state problem, NOT a parameter problem`. That message is actively misleading: it _is_ triggered by the input (a closed path), and the fix (use `Torus`) is specific and known — but the model had to discover it by trial, spending its whole engine-fault exemption budget first. `decodeOcctException` tries to recover a real message via `getStandard_FailureData`, but in this WASM build that returns nothing, so the model only ever sees the opaque code.

**5. Schema drift / parameter hallucination.** The model set `scaleMin`, `scaleMax`, and `seed` on `InstanceOnPoints`; the real params are `scaleStart`, `scaleEnd`, `everyNth`, `maxCount`. These are Grasshopper/other-CAD priors. The system rejected them — correctly — but a single unknown param made `add_nodes` skip the **entire** node, which is why the sphere-scatter node kept vanishing and the model kept "re-adding" it. Reactive rejection with a good message is right; silently deleting the node over one stray key is not.

**6. Edge-id guessing.** On removals the model invented ids like `edge_0` and `circle.curve → pipe.path`. The resolver already tolerates `{source,target}` objects and `"source->target"` strings and reports the real edges — that part is good — but the protocol still nominally asked for `removedEdgeIds`, nudging the model toward ids it cannot know.

## Root causes, grounded in code

| # | Symptom in transcript | Root cause (symbol) | Class |
|---|---|---|---|
| 1 | truncated / empty JSON, 400s | `reasoning` holds the full plan; JSON path emits the whole graph in one payload under `MAX_OUTPUT_TOKENS`; grammar error → session-wide `disableToolCalling` | protocol |
| 2 | "validator defaulted to solid" repair loops | `tools.ts::defaultSourceHandle` and `agent.ts::applyParsedGraphOps` hardcode `'solid'`; only `graphValidation.ts` inferred correctly | wiring |
| 3 | "spheres in the centre" | class 2 drops `DivideCurve→InstanceOnPoints.points` → instancer null → base Sphere renders alone at origin | wiring (downstream) |
| 4 | `opaque code …`, 3 engine-fault retries | `Pipe` on a closed wire throws; message says "NOT a parameter problem"; no routing to `Torus` | kernel/UX |
| 5 | node repeatedly dropped | `scaleMin/scaleMax/seed` unknown → whole node rejected by `validateAndNormalizeNodeData` | schema |
| 6 | `matched NO edge` | protocol asks for `removedEdgeIds`; model cannot know ids | protocol/UX |

## Fixes applied in this pass

All changes are additive and covered by `tests/test_handle_inference.mjs` (16 assertions) plus the existing validation suites, and typecheck clean under `--strict`.

**Source-handle inference (class 2 & 3).** `tools.ts::defaultSourceHandle` now consults `NODE_LIBRARY[type].outputs`: a single-output node resolves to its real output (`Point→point`, `CircleCurve→curve`, `DivideCurve→points`, …), number/list nodes keep the `value` alias, and only genuine multi-output decomposition nodes (`DeconstructPoint`, `BoundingBox`, `Endpoints`, `EvaluateCurve`) fall back and expect an explicit handle. `agent.ts::applyParsedGraphOps` now imports and uses the same helper, so both protocols resolve omitted handles identically and identically to the validator. The `connect` tool description and the JSON `EDGES` note were rewritten to say handles are _inferred_ — omitting them is now genuinely safe, not a trap.

**Parameter synonym aliasing (class 5).** `validateAndNormalizeNodeData` now maps common cross-tool synonyms to the real param _when the node has it_ (`scaleMin/scaleMax → scaleStart/scaleEnd`, `divisions/segments/num → count`, `major/minor → majorRadius/minorRadius`), and treats a small set of intent-only keys (`seed`, `random`, …) as benign drops with a note. A genuine typo on an unrelated node still errors. The node is no longer deleted over one stray key.

**Closed-curve Pipe routing (class 4).** The `Pipe` executor now checks whether the path wire is closed (native `TopoDS_Shape::Closed()`, best-effort — unknown means "not closed" so open pipes are never blocked) and, for a ring, returns an actionable message routing to `Torus` instead of crashing. Both Pipe catch-paths now run through `kernelAwareMsg`, so a bare opaque code never reaches the model, and the message always names the fix.

**Protocol & knowledge (classes 1 & 6).** The `reasoning` field is now specified as 1–2 sentences for graph builds (full prose only for text answers), directly attacking the truncation cause. `MAX_OUTPUT_TOKENS` was raised to 12000 as a secondary margin (it is only a cap; the OpenRouter 402 affordability retry already guards low-credit accounts). A standing **COMMON CORRECTIONS** block was added to the system prompt — six lines that pre-empt the exact traps in this transcript (ring→Torus, `scaleStart/scaleEnd`, points-on-circle wiring, inferred handles, short reasoning). The construction ladder now routes closed rings to `Torus`, and the patch protocol documents removing edges by `{source,target}`.

## What's left — prioritized

**P1 — worth doing next.**

_Make the grammar-error fallback per-request, not session-wide._ A single 400 on the tools payload currently disables native tool-calling for the whole session and commits every later turn to the fragile JSON path. Retry once with a simplified/sanitized tool schema before giving up on tools; many of these 400s come from schema-shape quirks (`sanitizeSchema` gaps), not fundamental incapacity.

_Chunk the JSON path like the tool path._ When the model must use JSON, let it emit large builds as batched patches across turns (the patch ops already exist) instead of one giant payload. This removes truncation as a failure mode for complex requests rather than merely making it rarer.

_Positive intent verification, not just degeneracy._ `checkGeometrySanity` catches null geometry, origin collapse, and zero/negative volume, but a build that renders _something_ valid but _wrong_ (one sphere at origin) passes. Extend the plan-ratio contract to placement/counts: if the plan says "N instances on a ring of radius R" and the leaf has one solid at the origin, flag it. Make vision verification the default for placement-heavy builds (instancers, patterns), not opt-in.

**P2 — compounding leverage (this is the "knowledge base" the project is really after).**

Today retrieval injects only _positive_ success examples, and only above a similarity threshold — so novel prompts get no guidance and known traps are never pre-empted. Mine the tracked responses (`intelligence_log.json`, transcripts) into a small, curated set of **construction rules and gotchas** retrieved by trigger keywords (pipe+ring→torus; instance→scaleStart; skeleton edge→inferred handle) and injected regardless of example similarity. Half of a good knowledge base is corrective, not exemplary. The COMMON CORRECTIONS block added in this pass is a hand-written seed of exactly this; the next step is to grow it from data instead of by hand.

**P3 — polish.** Show stable, copyable edge ids in the condensed graph state. Decode OCCT exceptions properly (or maintain a small code→cause table for the handful that recur). Add a perturbation check (nudge a slider, confirm the model's declared ratios actually move) to catch dead-parameter designs before the user sees them.

## The meta-point for general parametric design intelligence

Three principles generalize past this transcript.

**Never punish an action the system told the model to take.** The handle bug and the "omit handles to save tokens" instruction were in direct contradiction; the model was obeying the prompt and being penalized by the validator. Audit every "you may omit X" affordance and confirm the default the system fills in is the _correct_ one, inferred from schema, not a convenient constant. A self-describing graph — where ports, defaults, and the single-output assumption are all derived from `NODE_LIBRARY` — has no house rules for the model to rediscover.

**Every failure message must name the fix, in the model's vocabulary.** "Opaque code 11744448, not a parameter problem" cost three retries; "closed ring — use Torus (majorRadius = ring radius)" costs zero. The engine's job is not to report that it failed but to route the model to the operation that succeeds. This is where most of the repair-loop budget was being spent.

**Statelessness is the tax you pay every episode.** The same four lessons were re-learned from scratch on every request. The cheapest intelligence upgrade in the whole system is a compact standing-hints block plus data-mined corrective retrieval — a few hundred tokens that convert recurring multi-turn repair spirals into first-try successes. Model capability was rarely the bottleneck here; institutional memory was.
