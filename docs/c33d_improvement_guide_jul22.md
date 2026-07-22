# C33D Improvement & Upgrade Guide — July 22, 2026

**Inputs:** all 28 session exports in `JSONs/` (Jul 20 05:36 → Jul 22 08:20, eight models), `intelligence_log.json` (812 run records since Jul 4), the current source tree, and the prior analyses (`json_export_analysis_jul20/21/21b.md`, `parametric_intelligence_rules.md`). The non-JSON file in the folder (`Magistarski rad - Dorotea Abaz.docx`) is an unrelated thesis document and was excluded from the evidence base — consider moving it out of `JSONs/` so export tooling can treat that folder as machine-readable.

**What landed with this guide (same session):** per-turn graph timeline in exports (`c33dExport: 2`), node-graph zoom-to-fit, provider model listing for all four providers, IR compiler ergonomic coercions, and transcript de-noising. Section 3 documents them; sections 4–6 are the forward program.

---

## 1. Where the system actually is

The corpus tells a clean before/after story around the Jul-21 number-input-wall fix, and then exposes the next wall behind it.

### 1.1 Corpus at a glance

| period | exports | typical outcome |
|---|---|---|
| Jul 20 (pre-conception-wave) | 4 | spaceship trio + one total blackout; 0.52–0.63 edges/node; hand-placed primitives |
| Jul 21 morning–afternoon (pre-fix) | 13 | procedural city / rose / Boeing waves; instancing backbones emitted **as disconnected islands** (up to 26 of 68 nodes fully isolated); "still no working graph" repair spirals |
| Jul 21 evening (fix session data) | 9 | simple-task probes (divide-curve-spheres, sphere-surface-points) — the unwinnable edge-rejection deadlock, all failing |
| Jul 22 morning (post-fix) | 2 | qwen3.5: one long building session still strangled by IR compile errors; one circle-of-spheres session with **60 edges on 38 nodes, 27 generative nodes, integrity 1.0, autofix visibly working** — the best-wired graph in the corpus |

The Jul-22 08:20 export is the proof that the substrate now works when the transport lets a program through: Series→Expression→PointsFromLists→InstanceOnPoints chains survive, `[Autofix] Wired "xCoords" → "points":x` fires, and the user's comment flips from "disaster" to "qwen did some interesting things". The bottleneck has moved. It is no longer *edge acceptance*; it is *what the compiler and namespace accept as a way of saying things*.

### 1.2 The five failure classes that remain (ranked by measured damage)

**F1 — The IR compile-error loop.** The Jul-22 06:46 building session contains ~40 compile-error system messages across 17 user turns. Every one burned a repair attempt, and every failed IR turn fell back to a *more primitive* graph than the program the model was trying to express. The specific rejected forms, with transcript line references:

- inline op literals — `"points": {"op":"points","args":{...}}` (msgs 25, 97) and `"center": {"op":"point",...}`;
- arithmetic on references — `"start": "$podiumH+0.5"`, `"$crownBaseR*0.5"` (msgs 62, 66);
- bare `{"x":0,"y":0,"z":0}` literals where a point is required (`rotate.pivot`, msg 79);
- bare binding names without `$` — `"center": "plinthCenter"` (msg 150);
- formulas naming computed bindings — `"plinthH + chamberH * 0.5"` compiled, then died at runtime with *"references unknown slider(s): plinthh"* (msgs 71, 91, 110, 155, 233).

None of these are design errors. They are all *reasonable notations for the same intent*, and models across vendors emit them consistently. **Fixed in code today** — see §3.4.

**F2 — Name-scope fragmentation.** The runtime formula scope contains slider labels only (lowercased); IR bindings, Expression outputs, and node ids each live in separate namespaces. Models — reasonably — assume one namespace: they define `numFloors` as an expression, then write `count: "numFloors"` and get *"unknown slider 'numfloors'"* with a list of five unrelated slider names. The compile-time half of this is fixed today (formulas naming computed bindings now auto-wire through `expr()`); the runtime half — the worker's formula scope — is the top remaining substrate item (§5, P0-2).

**F3 — The phantom edge-removal spiral.** 20–53 `removedEdgeIds … matched NO edge` messages per session (53 in the Jul-21 13:22 Boeing session, 30 even in the *good* Jul-22 session). Cause: the model removes edges it believes exist — because the IR compiler minted `_x`/`_x_2` helper ids it then renamed, or because the edges were already dropped a turn earlier. The individual message was honest; fifty of them in a row buried every other signal and taught the model the system was haunted. **Aggregated today** into one ranked note per patch (§3.5). The *minted-id* root cause remains: compiler-created helper nodes are invisible to the model's mental graph (§5, P1-2).

**F4 — Type ping-pong repairs.** When the model wires `InstanceOnPoints` backwards (solid→points, points→shape), validation reports both mismatches; the model swaps *both* edges and produces the mirror error; three rounds die (Jul-22 06:46 msgs 139–145). A deterministic swap is obvious from types alone and never needs a model turn (§5, P1-3).

**F5 — Conception outruns transport, so selection pressure runs backwards.** Read the plans in the failed sessions: facade panels driven by floor counts, golden-angle phyllotaxis, loft-through-varying-circles fuselages, per-story column styles. The *conceptions* are genuinely parametric — better than anything in the success library. What survives to render is whichever fragment didn't hit F1–F4: hand-placed primitive singletons. Every session where that happens teaches the knowledge base that primitive = successful. This is the same backwards-selection dynamic the number-input wall had, one layer up. The cure is not prompting; it is making the elegant path the *most likely to survive* path (§4).

### 1.3 What the aggregate numbers say about style

Across all 28 exports: `NumberSlider` 134, `Expression` 64, `Point` 57, `Translate` 43, `Box` 42 — versus `InstanceOnPoints` 20, `PointsFromLists` 18, `Series` 14, `RepeatEach` 6, `Tile` 2. The list layer exists but is outnumbered ~3:1 by the singleton layer, and `Align` (5 uses) has nearly vanished against 43 Translates. Edges/node across sessions: 0.11–0.85 with a single outlier at 1.58 — the post-fix session. A healthy procedural graph should sit near or above 1.0 (every node consumed at least once). These are the numbers the elegance program (§4) must move, and the new export timeline makes them measurable *per turn* rather than per corpus.

---

## 2. What "terrible graphs" actually are — a diagnosis

The user's observation — "a lot of nodes on the start whilst we should use little nodes and generate everything procedurally" — is exactly what the data shows, and it has three distinct causes worth separating, because each has a different fix:

1. **Vocabulary tax.** Expressing "8 spheres on a circle with varying radius" canonically costs ~7 ops (series, two exprs, points, sphere, instances, emit). Models that don't find that path pay 3× more nodes doing it with 8 Points + 8 Spheres + 8 Translates — and that degenerate form has *fewer failure modes*, so under a lossy transport it wins. Lower the tax (composite ops, coercions) and raise the degenerate form's visibility (economy percepts) simultaneously.

2. **Transport lossiness** (F1–F4). Every dropped edge or failed compile converts a derivation chain into orphan nodes. A 38-node graph with 13 edges isn't a style choice — it's a 38-node graph that *lost* 25 edges on the way in. Post-fix evidence confirms models emit dense wiring when accepted.

3. **No longitudinal pressure.** Until today, neither the model nor the analysis could see *graph trajectory* — only final states. A model that thrashes from 12 nodes → 68 nodes → 6 nodes across a session looked identical, in the export, to one that refined 12 nodes patiently. The timeline (§3.1) turns that into data; the elegance metrics (§4.2) turn it into feedback; the knowledge base (§4.3) turns it into selection.

The governing methodology stands: no object recipes, no "here is how to build a building" prompt blocks. Everything below is capability, feedback, or selection — object-agnostic by construction.

---

## 3. Landed this session (Jul 22)

### 3.1 Graph timeline in session exports — `c33dExport: 2`

`useStore.recordGraphSnapshot(trigger, label, details?)` snapshots the graph on every AI application (tool loop, JSON patch, IR rebuild, repair round), every manual structural edit (connect / node / edge removal), and at export. Each `timeline[]` entry carries: `at`, `turn` (user-message count), `trigger` (`ai-tools` / `ai-json` / `ai-ir` / `ai-repair` / `user-edit` / `export`), a compact `label` (the patch summary or tool batch), `nodeCount` / `edgeCount` / `isolatedCount`, a precomputed `diff` (added/removed/changed node ids, edge add/remove counts), per-application `details` (dropped edges, structural issues), and the **full nodes/edges snapshot**. Identical consecutive states dedupe; the in-memory cap is 200 entries; the timeline intentionally does not persist to localStorage (it resets with the conversation, matching export semantics).

How to read it when analyzing a directed-repair session: plot `nodeCount`, `edgeCount`, `isolatedCount` by entry — collapse events (a rebuild that lost the instancing layer) show as edge-count cliffs; thrash shows as alternating add/remove of the same ids; the `details` on `ai-repair` entries name exactly which edges each round sacrificed. This replaces guessing from final graphs what happened mid-session, and it is the instrument for the longer conversations you're planning. Files: `src/store/types.ts` (`GraphTimelineEntry`), `src/store/useStore.ts`, `src/utils/exportSession.ts`, hooks in `src/ai/agent.ts::applyAndPerceive`.

### 3.2 Node-graph zoom-to-fit

React Flow's default `minZoom` of 0.5 literally prevented zooming out far enough to see a 40-node graph. Now: `minZoom` 0.03, a **Fit Graph** button (top-left of the canvas), the **G** shortcut (mirroring the viewport's F), and an automatic fit after every AI application (`zoomGraphToFit` bumped in `applyAndPerceive`, consumed in `NodeGraph.tsx`), so the graph stays whole-in-view as the model grows it.

### 3.3 Model lists for every provider

`listProviderModels(provider, apiKey)` in `src/ai/api.ts`: Ollama `/api/tags`, OpenRouter `/api/v1/models` (public, works before a key is entered), OpenAI `/v1/models` (non-chat endpoints filtered), Gemini `models?pageSize=1000` (filtered to `generateContent`). The settings panel auto-loads lists where possible, adds a **Load models** refresh button on every slot, keeps the **Type custom** escape hatch for all providers, and surfaces errors inline ("is Ollama running at…", HTTP status for bad keys). No more hand-typing `nvidia/nemotron-3-ultra-550b`.

### 3.4 IR ergonomic coercions — the F1 killer

`src/ai/ir/compile.ts` now deterministically accepts, with a canonical-form note each time (so the models still *learn* the preferred notation from feedback rather than being silently indulged):

- **Inline op literals** anywhere a reference is expected — `{"op":"points","args":{...}}` auto-lifts into its own step (recursively).
- **Bare `{x,y,z}` objects** where a point/vector is expected — lifted through `point()` / `vector()`.
- **Bare binding names** (`"plinthCenter"`) — coerced to `$plinthCenter` when the binding exists; number-typed bindings referenced by bare name in numeric args wire as edges.
- **Arithmetic on refs** (`"$podiumH+0.5"`) and **formulas naming computed bindings** (`"plinthH + chamberH*0.5"`) — resolved at compile time: slider names stay inline (the runtime scope has them), computed bindings auto-wire through a synthesized `expr()` with free-letter substitution (collision-safe, ≤4 bindings; beyond that, an honest "split it" error).

Honest failures are preserved: unknown ops, unknown bindings, and type mismatches still fail with precise messages. The IR JSON schema (`schema.ts`) now admits object args so schema-constrained decoding doesn't fight the coercions; `IrValue` widened accordingly. Verified: `tsc -b` clean, `vite build` clean, 11/11 checks in a real-compiler smoke run (each replaying an exact transcript failure), fixtures (`SOLAR_SYSTEM_IR`, `SOLAR_DOTS_IR`, `CURTAIN_IR`) unchanged, plus the `tests/test_ir_ergonomics.mjs` mirror.

Expected effect, measurable in the next batch: compile-error messages per session should fall by roughly the share of these five classes among the 40 observed — inspect new exports' timelines for `ai-ir` entries succeeding on attempt 1.

### 3.5 Transcript de-noising

Unmatched `removedEdgeIds` now aggregate into **one** note per patch, naming every miss plus the edges that *do* exist on the referenced nodes, with an explicit "these were already gone — do NOT keep retrying" instruction (F3's symptom). The `[IR] emitted binding also consumed downstream` note aggregates identically (nine copies in one Taj Mahal build). Fewer, denser messages = more of the model's context spent on design.

---

## 4. The graph-elegance program

Goal state: a C33D graph reads like a genotype — a few drivers, derivation chains, instancing doing the multiplication, anchors instead of coordinates. The program has three legs; each is object-agnostic.

### 4.1 Substrate: make elegance the cheapest path

1. **Runtime unified namespace (P0-2 below).** One name universe for formulas: sliders + upstream *named number outputs* reachable by wire. With compile-time auto-wiring (landed) plus runtime resolution, "define once, name anywhere" finally holds, and the 4-input Expression ceiling stops mattering for the common case. Include case-insensitive matching with a warning — the transcripts show `numFloors`/`numfloors` mismatches costing whole turns.

2. **Composite skills where the transcripts show repeated multi-op idioms.** `on_circle` already proved the pattern (radius-list × count cross product in one op). The Jul-22 sessions hand-assembled, repeatedly and painfully: *interleaved start/end point pairs for line fields* (the 08:20 session's parity-formula hack), *evenly divided curves feeding instancers*, and *grid-with-per-cell-channels*. A `zip`/`interleave` list op and a `line_field(points_a, points_b)`-style constructor are generic list/geometry vocabulary (like Grasshopper's Weave/Shift), not object recipes. Add them as IR skills first (cheap), promote to nodes only if hand-wiring demand appears.

3. **IR beyond the empty canvas (P1-1).** The IR path — the one place wiring is deterministic — currently fires only on an empty canvas; every repair and extension turn falls back to the error-prone patch protocol. Design sketch: accept `{"body":[...], "emit":[...], "base": "keep"}` where new ops may reference *existing node ids* as bindings (`$existing:nodeId` or auto-importing exported names); compile to a patch (addedNodes/addedEdges) instead of a rebuild. This single change moves most F1-class breakage off the repair path too.

4. **Deterministic swap autofix (P1-3)** for reversed typed pairs — when exactly two type-mismatched edges between the same node pair form a valid graph when swapped, swap them with an `[Autofix]` note. Kills F4 without a model turn.

5. **Expression capacity.** Either raise a–d to a–f, or (better, no schema change) teach the unified namespace to chain: formulas referencing more than 4 computed values auto-split into an expr tree at compile time. The 08:20 session hit the `e`/`f` wall twice.

### 4.2 Feedback: make in-elegance visible every turn

The report already tells the model its `derivationRatio`, skeleton nodes, magic numbers, and node economy (`verification.ts:370`) — good. What's missing is *trajectory* and *leverage*:

1. **Instancing leverage** — rendered instance count ÷ authored geometry nodes. A 40-node graph rendering 40 things has leverage 1 (a sculpture); 12 nodes rendering 200 (leverage ~17) is procedural. One line in the geometry report; the worker already knows instance counts.
2. **Turn-over-turn deltas in the repair prompt.** The harness now has the timeline; a one-line "since your last change: nodes 26→31, edges 17→14 (**down**), isolated 3→9 (**up**)" in the repair feedback makes collapse *felt* by the model the turn it happens, instead of discovered by the user at the end. Cheap: diff the last two timeline entries in `applyAndPerceive` callers.
3. **Economy in the sanity gate, softly.** Don't fail builds for inelegance (that would manufacture style compliance — preorder debt); *do* include the metrics line in the final report the model sees when declaring success, so its own summary internalizes them.

### 4.3 Selection: make elegance what gets remembered

1. Stamp `derivationRatio`, `instancingLeverage`, `edges/node`, and `isolatedCount` onto saved success examples at save time (they're one `computeGraphShapeMetrics` call away in `SaveExampleModal`/store).
2. Retrieval already injects exemplars; prefer higher-leverage exemplars at equal relevance, and keep the Jul-18 anti-anchoring rule (idioms, not whole plans, for creative prompts).
3. The eval suite gates substrate changes; add the same metrics as tracked columns per run (harness already records `derivationRatio`) and watch them across the 36-prompt suite before/after each wave. "Evolution" is exactly this loop: substrate change → probes unchanged → metrics move → keep or revert.

### 4.4 What NOT to do

No node-count budgets in the prompt, no "always use InstanceOnPoints" rules, no per-object construction ladders beyond what exists (and test-remove those per the Jul-19 plan). The transcripts prove models already *want* to build procedurally; every failed elegant graph in the corpus was killed by transport or namespace, not by missing instructions. Instruction-patching this would mask the substrate signal and add preorder debt.

---

## 5. Priority queue (with file anchors)

**P0-1. Ship today's work.** Commit + push, then `npx vercel --prod` (the live site does NOT auto-deploy from GitHub — `.vercel/` is CLI-linked only). Then re-run the *unchanged* probe prompts (divide-curve-spheres, sphere-surface-points, "make a procedural building…") on qwen3.5 / glm-5.2 / gemma4 and export — the timeline entries will show whether F1 died. Expected: `ai-ir` attempt-1 success on forms that previously burned 2–3 attempts.

**P0-2. Runtime unified namespace.** In `geometryWorker.ts`, the formula scope for node data params is sliders only (`sliderScope`); extend evaluation so a formula identifier can also resolve to a *wired-in upstream number output* (the executor already resolves edges for `param:` targets — the gap is name-based lookup for values computed in the same graph). Pair with case-insensitive fallback + warning. Acceptance probe: a graph where a Box height formula names an Expression binding evaluates without an edge from the model. This is R1.1's sibling and closes F2 fully.

**P1-1. IR patch mode** (§4.1.3) — `src/ai/ir/compile.ts` + the IR branch in `agent.ts::runLegacyJson`; schema gains `base`. Also apply the response schema on repair turns (currently empty-canvas only, `agent.ts` ~line 1120), since constrained decoding is what made attempt-1 IR reliable.

**P1-2. Kill minted-id confusion.** Compiler helper nodes (`_x`, `_x_2`) should either reuse the model's names (`points` op with `let: "pts"` → node id `pts`, helpers `pts_x` → prefix with the *arg* name: `pts.x` style is invalid as an id, but `pts_x` is — the real fix is including minted ids in the compact graph state the model sees, which already happens, AND having the aggregated no-match note say "ids like `pts_x` were created by the compiler — they may have been renamed; trust the graph state list"). Half of F3's remaining volume is explanation, not code.

**P1-3. Reversed-pair swap autofix** — `graphValidation.ts::inferMissingEdges` or a sibling `autofixGraphStructure` rule in `agent.ts`; mirror test alongside `test_edge_completion.mjs`.

**P1-4. Standing opens from Jul 21 that this batch re-confirms:** `ScatterOnSurface` NaN/degenerate output (both models that chose it were punished for the right instinct); Ollama 5xx mid-repair needs one retry; nemotron empty-tool-call transport death.

**P2-1. Deterministic-fault bisection (R-A, Jul 20).** Engine faults appeared in the Jul-22 building session too (3 in one turn-run). On a *deterministic* post-respawn fault, bisect the graph halves harness-side to name the culprit node and return a partial report. Turns blackouts into node errors.

**P2-2. Knowledge-base economy stamps + retrieval preference** (§4.3.1–2).

**P2-3. Timeline-driven regression probes.** The eval harness can now assert *trajectory* contracts ("no eval run may end with isolatedCount > 20% of nodes"), which catch collapse modes scalar success misses.

**P3. Graph readability layer** — auto-clustering list-machinery into visual groups (GroupNode infra exists, nothing creates groups); lanes layout; hierarchical compact state for the model. Valuable, but behind the substrate items above because clusters of *disconnected* nodes are noise either way.

**P3. Macro mining from timelines.** With timelines accumulating, recurring subgraph shapes across *successful* sessions become minable (frequent-subgraph over typed node/edge labels). Surface "this 6-node idiom appeared in 4 verified sessions — save as macro?" — the self-extending vocabulary loop, driven by evidence instead of pre-seeding.

---

## 6. Working practice for the longer directed sessions you're planning

Run the conversation as you intend (build → inspect → direct fixes), then export with a comment *every time*, including the good ones — the corpus is currently ~90% failure-comments, which starves the selection side. When directing a fix, name the part and the relation ("the wing boxes should sit on the fuselage midline"), not the mechanism; whether the model reaches for Align, sockets, or points is exactly the signal being measured. In analysis, open the export's `timeline` first: find the entry where `edgeCount` or `isolatedCount` inflects, read that entry's `details` and `label`, and you have the failing turn without replaying the whole chat. The two new UI affordances (Fit Graph, per-provider model lists) plus the existing F-key viewport fit make the observation loop hands-free; `c33dExport: 2` files remain backward-compatible for the existing analysis scripts (all v1 fields unchanged).

One hygiene note from this batch: a non-C33D text was accidentally pasted mid-session (Jul-22 08:20, msg 29 — crypto-bot output) and entered the model's context as a user instruction until you retracted it. The model handled it gracefully, but for clean experiments consider an "ignore previous message" being honored is not guaranteed across models; a small "undo last user message" affordance (removing it from `messages` before the next turn) would keep experiment transcripts uncontaminated.

---

## 7. Verification record (this session)

`npm ci` + `tsc -b` exit 0; `vite build` clean (2.4s). Real-compiler smoke: 11/11 checks, each replaying an exact Jul-22 transcript failure form, plus three fixture regressions. Mirror tests: `test_ir_ergonomics.mjs` (14 contracts), `test_graph_timeline.mjs` (6 contracts), existing `test_number_input_edges.mjs` re-run green. Not verified here: browser-side behavior of fitView/model-picker (needs a manual dev-server pass — checklist: G key, Fit button, auto-fit after an AI turn, model dropdown on all four providers, export contains `timeline`), and WASM-dependent suites (sandbox OCJS limitation — run `npm test` on Windows as usual).
