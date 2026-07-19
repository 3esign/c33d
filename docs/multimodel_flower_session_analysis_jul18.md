# Multi-Model Flower Session Analysis — Jul 18, 2026

Triage of the "most beautiful flower" multi-model test session (nemotron-3-ultra, minimax, deepseek, kimi, OpenRouter auto, misc. open-source) plus the partial 36-eval run. Every claim below is grounded in code (file:line).

## 1. Executive read

The session shows real capability progress (models plan skeletons, diagnose their own wiring bugs, switch construction strategy — kimi's "changing construction strategy" turn is exactly the behavior we want). But the transcript splits into three very different failure buckets that should never be conflated in a knowledge base:

| Bucket | Share of failed episodes | Examples from this session |
|---|---|---|
| **Infrastructure** (provider down, region-lock, key limit) | ~half | Ollama 502, OpenRouter 403 ×4, 500, "Failed to fetch", empty response |
| **Transport/format** (invalid JSON, grammar fallback) | ~quarter | "not valid JSON" ×4, "provider grammar error" fallback |
| **Semantics** (actual design/graph errors) | ~quarter | sweep type error, unwired PointsFromLists, duplicate sliders, `$$` kernel crash |

"Frontier model spent a lot of credits and did nothing" was a 403 key-limit loop, not a model failure. The system currently retries and falls back through provider errors as if they were model errors — burning credits and polluting the impression of model quality.

**The single most important finding:** the "goes back to older versions" feeling is real and has a specific cause — exemplar anchoring (§5).

## 2. Error-by-error triage

### 2.1 Persistent JSON formatting errors — why "after all this time"

Schema-constrained decoding IS implemented (`api.ts:126` Ollama `format`, `api.ts:167-171` OpenRouter `json_schema`) — but it is **only applied on the empty-canvas IR turn** (`agent.ts:966-970`). Every repair turn, patch turn, and the legacy JSON-protocol fallback run **unconstrained**. That is exactly where all four "Response was not valid JSON" events in this session occurred. `robustJSONParse` (`agent.ts:22-59`) already strips comments/trailing commas, but can't fix truncation or multi-object responses.

**Fix (P0):**
- Build a JSON schema for the patch/repair protocol (like `buildIrJsonSchema`) and pass it on *every* structured turn, not just empty canvas.
- On OpenRouter set `strict: true` where the model supports it (currently `strict:false`, `api.ts:169`).
- Classify each parse failure (fence / truncation / prose preamble / multi-object) and log the class into the eval record — right now these failures are invisible to analysis.
- Truncation specifically: check `finish_reason === 'length'` and immediately continue-generate rather than bouncing the whole response.

### 2.2 `ExtrudeCurve: Cannot read properties of undefined (reading '$$')`

Raw emscripten handle error leaking from `executors.ts:2244-2278` — `curveToWire` returned a wire whose OCCT object is disposed/undefined, then `makeFace(w)` dereferenced `.$$`. Two problems:

1. The message is **useless to the model** — no model can act on `'$$'`. The repair budget was burned (leafSlab episode) with zero chance of recovery.
2. A `$$`-TypeError is a kernel-integrity signal and should set `kernelSuspect` so the existing respawn path (`useStore.ts:185-223`) fires. Today it's wrapped by `kernelAwareMsg` and treated as an ordinary node failure.

**Fix (P0):** guard the wire handle before `makeFace`; translate any `.$$`/embind TypeError into: *"internal kernel object was invalid — upstream curve is likely null or open; rebuild the curve input"* AND flag `kernelSuspect=true`. Also: the respawn is once-per-graph (`hasRetriedDeleted`) — the "Engine fault persisted across 3 consecutive evaluations" streak in this session suggests allowing one respawn *per episode*, not per graph.

### 2.3 IR compiler ergonomics — three recurring trip wires

These three produced compile errors across *different* models, which means they're API-design problems, not model problems:

**(a) `sweep.profile expects solid, got curve`** (`skills.ts:521`, raised at `compile.ts:224-226`). Models reasonably pass a profile *curve* to sweep — every CAD kernel converts closed planar curve → face internally. **Fix:** accept curve refs for `sweep.profile` and coerce (closed planar curve → face) in the compiler, or emit an actionable hint ("wrap in extrude/face first"). Coercion is better; `typeOk` (`compile.ts:171-176`) already cross-accepts `point`↔`point[]` — extend the same idea.

**(b) `instances.shape must be a reference, got {"op":"sphere",...}`** (`compile.ts:220-222`). Models naturally inline sub-expressions. **Fix:** auto-lift inline op objects into anonymous `let` bindings inside `refOpt`. Pure compiler sugar, deletes an entire error class, zero prompt cost.

**(c) Duplicate slider labels** (`stemHeight` + `slider_stemHeight`, error at `graphValidation.ts:83-90`). The model re-declared params it had already declared. **Fix:** dedupe at creation — when an added NumberSlider's normalized label collides with an existing one, alias the new node to the existing slider and emit a note instead of an error. Erroring costs a full repair round for something the system can resolve deterministically.

### 2.4 CircleCurve "missing required inputs: center, normal" — stale validation

The executor already defaults omitted center→origin and normal→+Z (`orientAndPlaceWire`, `executors.ts:218-236`; optional reads at `:1918-1943`). The structural validation that hard-requires them (`graphValidation.ts::requiredGeoInputs`, `:26-45`) is **stricter than the engine** and cost several repair rounds in this session across two different models. **Fix:** downgrade CircleCurve/EllipseCurve center+normal to an info-level note ("defaults to origin/+Z"). One-line change, removes a whole recurring error class.

### 2.5 Patch edge-removal misses (kimi episode)

The resolver (`agent.ts:1235-1283`) already fuzzy-matches `{source,target}` ignoring handles. Kimi's removals matched NO edge because those edges *never existed* — the model hallucinated graph state. The candidate-listing in the error is good. **Fixes:**
- Add a **target-only form**: `{"target":"stamens","targetHandle":"shape"}` = "disconnect this input, whatever feeds it". Models know which input they want free far more reliably than which edge feeds it.
- Make no-match removals **free** (don't count against anything, they already don't — but also don't emit three separate scary system lines; batch into one note).

### 2.6 Unwired PointsFromLists (house/roof episode)

The model's *diagnosis was correct* ("ListConstants contain valid values but are not wired") yet auto-repair still failed twice. When a required list input is empty and same-graph nodes of compatible type exist with name overlap (`roofX/roofY/roofZ` → `x/y/z`), the validator should **propose the exact edges** in the error message: "candidates: roofX.values→x, roofY.values→y...". Cheap heuristic (name similarity + type match), turns a 2-round failure into a 1-round fix.

### 2.7 Provider failures — fail fast, don't fall back

The tool-loop catch (`agent.ts:704-715`) falls through to `runLegacyJson` on **every** error — 403 region-lock, 402/403 key-limit, 502, "Failed to fetch" all get "falling back to JSON protocol" and then re-call the *same dead provider* via a different protocol. That is the exact credit-burn mechanism in the "frontier model did nothing" episode. **Fix:** classify HTTP errors before the fallback: 401/403/402/429-quota → **abort the episode immediately** with a clear "provider unavailable: <reason>" banner; 5xx → one retry with backoff then abort. Never enter the repair loop on provider errors. Optionally: a 1-token preflight ping when a model is selected.

## 3. Eval run read + evals as stored experience

### 3.1 The numbers

Only 19 of 36 prompts ran (L1 7/7, L2 9/9, L3 3/12, L4 0/8) — the suite aborted partway, so "L3 100%" is 3 samples and the L1/L2 percentages aren't comparable to previous full runs. The panel should display partial-run status explicitly.

Signal in what did run: **L1 (86%) < L2 (89%)** because L1-04 (rounded plate → Fillet) failed at EVAL after 108.7s — fillet is still the weakest primitive (radius ≥ half-thickness cases). L2-09 (helix, 200 pts) died at PARSE after 127.7s — long list-machinery outputs hitting exactly the unconstrained-JSON problem from §2.1. Also worth tracking: time correlates with repair rounds; **repairRounds must become a first-class eval metric** — "sane after 3 repairs" and "sane first-shot" currently score identically.

### 3.2 The experience store (your explicit ask)

Today the harness throws the graph away: `runEvalSuite` calls `clearGraph()` per prompt (`evalHarness.ts:92-99`) and `EvalResultEntry` (`types.ts:55-73`) stores only scalars. Rows in `EvalPanel.tsx:89-100` are plain divs, not clickable. Concrete design:

**Extend `EvalResultEntry`:**
```ts
graphSnapshot?: { nodes; edges }   // captured BEFORE clearGraph, after scoring
irProgram?: string                 // the compiled program, if IR path
thumbnail?: string                 // 128px JPEG dataURL from canvas
repairRounds: number
parseFailClass?: 'fence'|'truncation'|'prose'|'multi'
model: string; provider: string
tags?: string[]                    // model-generated, see below
transcriptTail?: string[]          // last N system events
```
Capture point: inside the per-prompt loop right before `clearGraph()` of the *next* iteration. Storage: the existing store persistence (`evalResults.slice(-200)`, `useStore.ts:757`) handles it; thumbnails at 128px keep 200 entries under a few MB. If that grows, move graph snapshots to IndexedDB keyed by runId.

**UI:** row click → detail drawer: thumbnail, score breakdown, errors, transcript tail, and two actions — **"Load graph"** (restores snapshot to canvas, with confirm) and **"Pin as exemplar"** / **"Add to regression suite"**. Compare mode later: same promptId across models side-by-side.

**Self-tagging → experience:** after each run, one cheap model call: *"Tag this run: idioms used, failure classes, notable choices"* → structured tags stored on the entry. This is what turns evals into experience: SANE + vision-verified runs become *candidate* exemplars automatically (still gated by the verify-before-store rule); failed runs become **anti-patterns** retrievable by error class (e.g., next time any model hits `sweep expects solid`, retrieval can surface "curve profiles must be lofted/extruded — seen in run #142"). Failures are currently 100% wasted; they are the richest training signal you have.

**Regression pinning:** any in-the-wild failure (like this flower session) gets one-click "add to suite" as a custom prompt. The suite should grow from real failures, not stay fixed at 36.

## 4. Graph readability — collapse the list machinery

The infrastructure already exists and is unused: `GroupNode.tsx` is registered (`NodeGraph.tsx:21`), `autoLayout` respects `parentId` (`autoLayout.ts:4,16`), but **nothing ever creates a group** — group nodes are filtered out in six places (`useStore.ts:263` etc.).

**Plan:**
1. **Auto-cluster detection:** any connected subgraph of pure data nodes (Series, Range, ListConstant, ListItem, Expression, PointsFromLists, RepeatEach, Tile) whose outputs feed a single non-data consumer → wrap in a group node labeled by its product: `"PointList (12 pts) → roofProfile"`. Collapsed by default, click to expand.
2. **Lanes:** deterministic layered layout — sliders left rail, data/list layer, curve layer, solids, leaves right. Same canonical arrangement every time.
3. **The graph as a decision aid for models:** mirror the collapsed view in `formatCompactGraphState` (`agent.ts:504-514`, currently a flat node+edge dump). Hierarchical serialization: params first, then named clusters with a one-line summary (`stemAssembly: 6 nodes, Pipe along spline, bbox 2×2×40`), then leaves — fold the per-node geometry report (`verification.ts:339-423`) into per-cluster lines. This cuts tokens *and* hands the model a parts-list mental model instead of a wire soup. The cluster names become the vocabulary for patches ("modify stemAssembly") — a step toward sub-shape editing by query.

## 5. "Goes back to older versions" — exemplar anchoring is real

Three episodes on *different providers* produced near-verbatim identical plans ("Layered rose-like bloom… 3 interleaved petal rings… 4 sliders drive everything"). Different models don't converge on identical prose by chance. Cause: `formatExampleForPrompt` (`retrieval.ts:83-91`) injects a stored exemplar's **plan text (400 chars) + full condensed graph** as a "Verified example (user-confirmed successful design)" — models treat that as the answer key and copy it. Retrieval is doing its job too well: it turns every "flower" prompt into a re-render of the best stored flower.

**Fixes (keep correctness rails, remove design rails):**
- **Split exemplar content by purpose.** For *creative* prompts (detect: superlatives, "beautiful", no dimensions), inject **idioms only** (node-chain patterns like `CircleCurve→DivideCurve→InstanceOnPoints`), never the plan prose and never a whole same-subject graph. For *engineering* prompts (dimensioned, mechanical), full exemplars stay — there convergence is a feature.
- **Variation seeds:** on creative prompts, sample 2-3 random design axes into the prompt ("this time: drooping asymmetric bloom / 137.5° phyllotaxis / cool color story"). One line of code, immediate diversity.
- **Measure it:** add run-to-run distinctiveness to evals — embedding distance between repeated runs of the same creative prompt. "Sane but identical" becomes a visible failure mode. Consider an L5-creative band scored on vision-aesthetics + distinctiveness.
- **Progressive detailing:** "results basic and simple" is partly repair-loop survivorship — each repair round pressures models to simplify until something passes. When a repair drops planned detail (3 petal rings → 1), record it as a *deferred detail*; after first SANE render, prompt one enrichment pass to re-add it. Skeleton-first, detail-second matches how the models already plan.

## 6. Priorities

**P0 (this week)**
1. Eval experience store: persist graph+thumbnail+repairRounds, clickable rows (§3.2) — your explicit ask, and it compounds.
2. Schema-constrained decoding on repair/patch turns + parse-failure classification (§2.1) — kills most remaining format errors.
3. `$$` kernel fault: actionable message + kernelSuspect flag + per-episode respawn (§2.2).
4. Provider error classification: abort on 402/403/429, never repair-loop on infra errors (§2.7).

**P1**
5. IR sugar: auto-lift inline ops; sweep curve-profile coercion; slider dedupe-on-create; CircleCurve validation downgrade (§2.3-2.4).
6. Edge-proposal hints for unwired required list inputs; target-only edge removal form (§2.5-2.6).

**P2**
7. Exemplar diet for creative prompts + variation seeds + distinctiveness metric (§5).
8. List-machinery auto-clustering + hierarchical model-facing graph state (§4).

The through-line: almost nothing in this session was a model-intelligence failure. The models planned well, diagnosed accurately, and even self-corrected strategy. The system lost their work to unconstrained decoding turns, un-actionable kernel messages, validation stricter than the engine, provider errors treated as model errors, and an exemplar injector that overwrites their creativity. Fix the harness, and the intelligence you already observed gets through.
