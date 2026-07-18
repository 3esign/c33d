# The Node System, From First Principles — and the Skill/IR Layer That Sits on Top

**Date:** 2026-07-16
**Question:** Should the node system be revised? Should nodes be "skills" (line-from-two-points, line-from-point-and-direction, circle-from-center-and-radius, circle-from-three-tangents)? Is Grasshopper-style better than Blender-style? What are better "channels"?
**Grounding:** full inventory of the 87-node library (`src/nodes/NodeDefinitions.ts`), the executor registry (`src/worker/executors.ts`), the evaluation loop (`src/worker/geometryWorker.ts`), the validator (`src/ai/graphValidation.ts`), and the agent/serving seams (`src/ai/agent.ts`, `src/ai/api.ts`). Everything below that says "landed today" is implemented and typechecked, not proposed.

**Verdict in one paragraph:** the node system does not need a rewrite — it needs a *conformance pass* (nine silent declaration/executor drifts were found and fixed today, several of which directly caused transcript failures), *three small data-flow nodes* it was missing (also landed), and a *skill/IR layer on top* where the constructor-overload idea ("nodes as skills") actually belongs. Grasshopper's typed-dataflow substrate is the right foundation — your instinct is correct — but steal two things from Blender (channels on point sets, instancing as data) and reject Grasshopper's most famous feature (data trees). The deepest finding: the solar-system prompt from the transcripts was *inexpressible* in the old vocabulary — no constant-list node, no points-from-lists node, no per-instance size channel — so no amount of prompting, translating, or model-swapping could ever have produced the graph the user described. Language-to-form fails when the form language is missing words.

---

## Part I — What a geometry node system actually is

Strip away the UI and every parametric node system is the same object: **a pure functional program whose values are geometric entities, presented as a dataflow graph**. A node is a function, an edge is function application, the canvas is an AST that humans can read spatially. Everything that differentiates Grasshopper from Blender from Houdini is a position on six design axes:

1. **Entity vocabulary** — what types flow on wires (numbers, points, vectors, planes, curves, surfaces, solids, meshes, selections).
2. **Channel discipline** — how strictly ports are typed, and what implicit conversions exist.
3. **Multiplicity** — how one node processes many values (lists? trees? per-element fields? attributes?). This axis causes more design divergence than all others combined.
4. **Constructor granularity** — one `Circle` node with a mode dropdown, or `Circle CNR` / `Circle 3Pt` / `Circle TTR` as separate named constructors.
5. **Identity & sub-shape reference** — how downstream ops name "that face" or "those edges" robustly across parameter changes.
6. **The authoring agent** — who writes the graph. Every classic system assumed a human with a mouse. C3D's author is a language model. **This axis is new, it is yours alone, and it should dominate the other five.**

The LLM-authoring axis yields four design rules that recur through this document:

- **Explicit beats implicit.** Every implicit behavior (default handles, list-matching rules, auto-conversions) is a surface the model can hallucinate against. A human discovers implicit behavior by dragging a wire and looking; the model discovers it by failing.
- **Names beat modes.** `line_sdl(start, direction, length)` is one token sequence with an unambiguous signature; `Line` node + `mode: "SDL"` + three anonymous inputs is a wiring puzzle. Named constructors are also exactly what natural language contains ("a line from A along D").
- **Contracts beat conventions.** Each operation should have checkable pre/postconditions so the verifier can localize blame ("`remap` got `inMax == inMin`") instead of reporting a downstream symptom ("leaf produced no geometry").
- **The graph must be text-isomorphic.** The model speaks text; whatever it emits must map 1:1 onto the graph with zero interpretation freedom. This is an argument *for* the typed IR and *against* prompt paraphrase / latent reinterpretation, which adds a second stochastic generation where ambiguity re-enters.

## Part II — What the classic systems teach

**Grasshopper (Rhino).** Typed parameters with implicit casts, components as pure functions, and — critically for your question — **constructor overloads as separate components**: `Line (2Pt)`, `Line (SDL)`, `Circle CNR`, `Circle 3Pt`, `Circle TanTanTan`, `Arc 3Pt`, `Arc SED`. This is the single most language-aligned design decision in any node system: the component palette *is* a phrasebook of geometric intent. Its weakness is the multiplicity model: **data trees** (`{0;1}` branch paths with graft/flatten/simplify and three matching modes) are the #1 source of human confusion in the ecosystem, and for an LLM author they would be lethal — matching behavior is invisible in the graph text. Also: no attributes on geometry, weak sub-shape identity (index-based, breaks on topology change).

**Blender Geometry Nodes.** One fat `Geometry` socket carrying meshes/curves/points/instances, **named attributes (channels) on every element**, and **fields** — per-element expressions evaluated lazily across whatever geometry flows in. Channels + fields solve multiplicity without trees: "scale each instance by its distance to X" is a field, not a loop. Weaknesses for your domain: mesh-only (no B-Rep, no CAD-valid booleans/fillets), chunky nodes with mode enums (anti-language), and fields are hard to reason about statically — a field wire's meaning depends on which geometry it eventually meets, which is exactly the kind of context-dependence that breaks an LLM author.

**Houdini SOPs.** The maximalist version of Blender's answer: attributes on everything, VEX code as escape hatch. Its lesson is about **escape hatches**: when the node vocabulary runs out, Houdini artists drop to VEX one-liners instead of 40-node workarounds. C3D's inline formulas and selection-query DSL are already this pattern; the IR extends it.

**Dynamo (Revit).** Grasshopper-like with `List@Level` lacing — confirms that list-matching magic confuses even its own users. Negative lesson only.

**Scorecard against the six axes:** Grasshopper wins on vocabulary, discipline, and constructor granularity; Blender wins on multiplicity and channels; nobody had solved identity well (C3D's selection-by-query is genuinely ahead here); nobody designed for a machine author. So: **Grasshopper substrate, Blender channels, C3D selections, and a new skill layer for the machine author.**

## Part III — Audit of C3D's current system (and what today's audit found)

What C3D already gets right: typed ports (`number/Solid/Point/Vector/Plane/Curve/Selection`) with a real edge-type validator; a B-Rep kernel (replicad/OCCT) so booleans and fillets are CAD-valid; inline formulas (`"circleRadius*0.04"`) giving parametrics without wiring boilerplate — better than Grasshopper's slider-wires for an LLM; selection-by-query instead of indices; memoized topological evaluation; macros and success-examples as proto-skills. This substrate is worth keeping. **Do not rewrite it.**

What the audit found wrong falls into three classes:

**Class 1 — silent declaration/executor drift.** The `NodeDefinitions.ts` declaration (what the validator and the model see) and the `executors.ts` implementation (what runs) had diverged in nine places. Every one is a "language to form" break: the model wires exactly what the schema says, the validator approves it, and the executor silently reads a different handle name and falls back to defaults. Found and fixed today:

| Node | Declared | Executor read | Consequence before fix |
|---|---|---|---|
| Midpoint | `a`, `b` | `pointA`, `pointB` | always returned origin |
| PointBetween | `a`, `b` | `pointA`, `pointB` | always returned origin |
| DistanceMeasure | `a`, `b` | `pointA`, `pointB` | always 0 |
| Vector2Pt | `a`, `b` | `from`, `to` | always zero vector |
| VectorMath | `a`, `b` | `vectorA`, `vectorB` | always zero vector |
| **Line** | `a`, `b` | `start`, `end` | **always the default (0,0,0)→(10,10,10) line** |
| VectorMath `scale`/`angle` ops | declared in param docs | **not implemented** | silently returned zero vector |
| CircleCurve / EllipseCurve | inputs `center`, `normal` | **ignored entirely** | every circle rendered at origin on XY regardless of wiring |
| EdgesAsCurves | `selection: Selection` | `shape` + `.edges` | never worked at all (a Selection record carries no geometry) |
| Series/Range default handle | output `values` | `defaultSourceHandle` stamped `value` | validator rejected every inferred Series/Range edge |

The CircleCurve one deserves emphasis: the transcripts show the model repeatedly wiring `origin → circle.center` — *correctly* — and being gaslit by geometry that ignored the wire. Some fraction of the "you are still wrong" loop in the log is this bug, not the model.

**Class 2 — missing data-flow vocabulary.** The solar-system prompt is a *data program*: "sort real orbit radii, remap to 0.2–1, generate toruses from the list, remap planet sizes, instance one sphere with those sizes." The old vocabulary could not express it: no node produced a **constant list** (Series/Range make only arithmetic sequences — real orbit radii are neither), no node built **points from number lists**, no **remap**, and `InstanceOnPoints` could only do a monotonic `scaleStart→scaleEnd` ramp — planet sizes are not monotonic (Earth > Mars < Jupiter). The model was set up to fail *before sampling a single token*. This is the most important lesson of the whole analysis: **when the model thrashes on a task a human describes fluently, first ask whether the graph language has words for it.**

**Class 3 — namespace fragmentation.** Inline params could see slider labels, but `Expression` node formulas could not (worker passed only edge-fed `a..d` vars). So "one slider controls everything" broke exactly at the node that's supposed to do math.

## Part IV — The design: skills, channels, lists

### "Nodes as skills" — the right version of the idea

Your instinct — line-from-two-points, line-from-point-direction-angle, circle-from-three-tangents as *skills* — is Grasshopper's constructor-overload insight, and it's correct. But there are two ways to implement it, and only one is right:

- **Wrong version:** explode `NODE_LIBRARY` into 300 constructor nodes. The system prompt (which serializes the library) bloats past what small models can attend to; the UI palette becomes unusable; every new node needs an executor, validator awareness, and UI.
- **Right version:** keep the node vocabulary small and orthogonal (it's the *machine code*), and put the overloads in a **skill registry at the IR layer** (the *surface language*). A skill = name + typed signature + one doc line + deterministic expansion into nodes. `line(a,b)` expands to one `Line` node; `line_sdl(start,direction,length)` expands to nine nodes (normalize → scale → deconstruct → add → reconstruct → line) — and the model never sees that plumbing, the same way a C programmer never sees register allocation.

This resolves "should we revise the node system": **the node system is the compile target; the skill registry is the language.** They evolve at different speeds and with different tests. Three properties make this architecture self-consistent (all implemented in `src/ai/ir/`):

1. **No drift by construction.** The prompt catalog (`skillCatalogText()`) and the decoding schema (`buildIrJsonSchema()`, op-name enum) are *generated from the registry*, so the model's vocabulary, the grammar, and the compiler literally cannot disagree.
2. **Corrections become structure.** The system prompt currently spends tokens saying "for a ring, use Torus, never Pipe on a closed circle." The registry says it structurally: `ring(radius, thickness)` compiles to `Torus`; the kernel fault is unreachable from the IR. Same for handles: the compiler emits only validator-canonical declared handle names, so the entire class of handle errors — the majority of transcript repair loops — is gone, not discouraged.
3. **Honest gaps.** `circle_ttt` (three tangents) needs kernel work that doesn't exist yet. A skill registry *without* that entry produces "Unknown op `circle_ttt`. Available ops: …" — a repairable error — instead of a hallucinated wiring guess. When kernel support arrives, it's one registry entry.

Skills also unify with your existing knowledge-base machinery: macros are user-authored skills with graph bodies; success-examples are skill *usage* exemplars; the mining pipeline (P3 from the compiler-turn analysis) can propose new mid-level skills from verified `graphOriginal→graphFinal` deltas. One concept, four sources. (Per the roadmap decision: low-level constructors ship in the registry; domain-level skills — "colosseum arcade" — are *only* minted from verified sessions, never pre-seeded.)

### Channels — Blender's gift to your point sets

The "better channels" question has a concrete answer: **points already carry channels in C3D and nobody had named it.** `DivideCurve` emits points with `{t, index, wireIndex, globalIndex, tangent}`; `InstanceOnPoints` reads `tangent` for alignment. That is Blender's attribute model in embryo. Formalized today:

- **`PointsFromLists`** (new node): builds a point list from number lists (`x`, `y`, `z` broadcast against each other) and attaches an optional **`scale` channel** from a fourth list.
- **`InstanceOnPoints`** now honors a per-point `scale` channel over its ramp — data-driven per-instance sizing, which is what "planet sizes remapped from real data" *is*.

The pattern to extend (later waves, in order of demonstrated need): `rotation`/`normal` channel (instances oriented by data, not just curve tangent), `color` channel (per-instance color without leaf-splitting), then a `SetChannel`-style op (compute a channel with an expression — Blender fields, but statically typed and explicit). Channels stay on **point sets only**; do not put attributes on solids until a use case forces it — B-Rep identity under booleans makes solid attributes a research problem (Houdini never solved it for B-Rep either).

### Lists — explicit, no trees

Multiplicity discipline, decided: **flat lists + broadcast + explicit list ops.** `Expression` broadcasts element-wise (existing behavior, now with sliders in scope); `PointsFromLists` broadcasts scalars against lists; exhausted lists repeat their last element (documented, deterministic). The IR provides `list`, `series`, `range`, `remap`, `expr`, `item` — enough for every transcript task. No data trees, no graft/flatten, no lacing modes: when the model needs nested iteration ("a ring of columns per level"), that's `circular_pattern` with `rise`, or two instancing stages — both expressible as visible ops, not invisible matching rules. If genuinely nested data arrives someday, add an explicit `foreach`-style op to the IR (compiled to graph replication) rather than trees on wires — iteration should be readable in the program text.

## Part V — What landed today (all verified)

**Node/executor layer** (`NodeDefinitions.ts`, `executors.ts`, `geometryWorker.ts`, `tools.ts`, `verification.ts`, `ParametricNode.tsx`):

- Fixed all nine drift bugs from the Part III table (executors accept the declared handle names, keeping legacy names for old saved graphs; `EdgesAsCurves` re-declared to its true input `shape: Solid`; `defaultSourceHandle` now always resolves to the declared output name).
- `CircleCurve`/`EllipseCurve` honor `center`/`normal` via a shared `orientAndPlaceWire` helper (rotate Z→normal, translate to center).
- `VectorMath` gained its missing `scale` (with `factor` input or param) and `angle` ops.
- New `ListConstant` node — comma-separated entries, each a number *or a slider formula* (`"R*0.2, R*0.5, R"`), evaluated in the worker against slider scope.
- New `PointsFromLists` node with the `scale` channel (described above).
- **Unified namespace:** `Expression` formulas now see slider labels (edge vars `a..d` shadow on collision) — sliders, constants, and expressions share one namespace, per the parameter-layer plan.

**IR/skill layer** (`src/ai/ir/` — new, additive, nothing imports it yet):

- `types.ts` — the IR: `params` (sliders), `body` of `{let, op, args}` ops with `$ref` bindings, `emit` (leaves + colors). Plus the `ExpandCtx`/`SkillDef` contracts.
- `skills.ts` — 42 skills + 8 aliases: data (`list`, `series`, `range`, `remap`, `expr`, `item`), skeleton (`point`, `vector`, `midpoint`, `points`, `grid`, `jitter`), curves (`line`, `line_sdl`, `circle`, `ellipse`, `arc`, `polyline`, `spline`, `divide`), solids (`box`, `sphere`, `cylinder`, `cone`, `torus`, `ring`, `extrude`, `loft`, `sweep`, `pipe`, `revolve`), transforms/replication (`translate`, `move_to`, `rotate`, `scale`, `instances`, `linear_pattern`, `circular_pattern`), booleans (`union`, `difference`, `intersect`, `compound`). `skillCatalogText()` generates the prompt block.
- `compile.ts` — deterministic expansion with model-repairable errors ("Unknown op…", "`$c` is a curve; only solids render — extrude/loft/instance it first", "references `$x`, which is not bound. Bindings so far: …"). Stops at first body error so the model resends one small program, no cascades.
- `schema.ts` — JSON Schema generated from the registry, for schema-constrained decoding (the P0 from the compiler-turn analysis: `response_format: json_schema` on OpenAI/OpenRouter, `format: <schema>` on Ollama structured outputs, `responseSchema` on Gemini). Note: OpenAI `strict: true` requires all-properties-required and no free-form objects — either post-process the schema for strict mode or run `strict: false`; the op-name `enum` is the high-value constraint either way.
- `examples.ts` — the two transcript tasks as IR fixtures.

**The proof.** `SOLAR_SYSTEM_IR` — 15 ops + 1 slider, written exactly the way the user phrased the task (real data list → sort assumed in data → remap 0.2R–R → skeleton points → one torus instanced per orbit with proportional tube → one sphere instanced per planet with true per-planet sizes → sun) — compiles to **16 nodes / 17 edges, all validator-clean on first try**, using one `Sphere` node and one `Torus` node. The transcript shows ~45 hand-wired nodes failing across ~15 repair rounds and never converging. `RING_OF_SPHERES_IR` (the circle/pipe/spheres task): 5 ops → 9 nodes / 5 edges, clean. The uniform-scale trick on the unit torus even satisfies "proportional profile radius" automatically — scaling preserves the tube-to-ring ratio.

## Part VI — Wiring plan (the actual P0, in order)

1. **Prompt:** in `buildSystemPrompt` (`agent.ts:78`), add the IR output mode for the JSON-protocol path: the protocol block (~15 lines: program shape + `$ref` rule + emit rule) + `skillCatalogText()` (~40 lines). This *replaces* the node-schema dump and most COMMON CORRECTIONS for that path — a net prompt-size reduction; the tool path stays as-is for now, giving an A/B seam.
2. **Decode:** in `api.ts`, thread an optional `responseSchema` argument through `chatCompletion`; pass `buildIrJsonSchema()` where supported (per-provider mapping in `schema.ts` comments). Keep `MAX_OUTPUT_TOKENS` — IR programs are ~10× smaller than node dumps, so truncation pressure drops too.
3. **Apply:** in the JSON path (`runLegacyJson`, `agent.ts:910`), try `compileIr(parsed)`; on success, feed `{nodes, edges}` into the existing `applyAndPerceive` (autofix → `validateGraphStructure` → layout → evaluate → sanity). On `issues`, send them back as the repair message — they're written in the same actionable style as executor warns.
4. **Un-defer the two Jul-14 P1s** (they compound with this): per-request tool-grammar fallback instead of the session-wide `disableToolCalling` flip (`agent.ts:690`), and chunked JSON as truncation fallback.
5. **Conformance test** (`tests/test_node_conformance.mjs`): for every `NODE_LIBRARY` node, evaluate it through `evaluateScratch` with probe inputs wired to *declared* handle names, and assert non-null output + that removing a declared input changes the result (catches "accepted but ignored" like CircleCurve.center — a class no static check catches, since executors read handles dynamically). Nine drift bugs from one manual audit is the case for automating it.
6. **Eval gate:** run the 36-prompt suite once on the IR path vs the current JSON path; also add both `examples.ts` fixtures as L3 evals. Acceptance: parsedOk ≥ 95% (schema-constrained should make it ~100%), evaluatedOk and geometrySane strictly better, repair rounds per task strictly fewer.

Then, next waves: best-of-N sampling of IR programs scored by `computeGraphShapeMetrics` → `evaluateScratch` → `checkGeometrySanity` (IR programs are cheap enough to sample 3–5×); a cardinality check in the geometry report ("expected ~N instances, leaf has M solids" — catches "I only see three cylinders" symbolically); skill-mining from verified sessions; rotation/color channels on demand.

## Part VII — Open questions (deliberately not decided today)

- **Does the tool-calling path also move to IR?** Probably yes eventually (one `set_program` tool taking the IR), but keep both until the A/B numbers say so.
- **Sub-shape ops in the IR.** `fillet`/`shell`/`select` skills need the Selection system threaded through the IR's type space (`selection` type exists in `IrType` already). Design fits — `let edges = select_edges($body, "parallel Z")` — but do it as its own wave with the sub-shape editing plan.
- **Editing vs regenerating.** The IR currently describes whole programs. Incremental edits ("make the third ring thicker") can either regenerate the program (cheap at 16 lines — likely fine) or get patch ops later. Regenerate-first is the simple bet; measure before adding patch machinery.
- **UI surfacing.** The IR is also a human-readable build script — worth eventually showing in the chat panel as "what I did" (it's a better explanation artifact than either prose or a node screenshot), and it round-trips: any IR program is reproducible provenance for a macro.

---

## Part VIII — Wave 2 (landed later the same day): derivation chains + live wiring

The follow-up brief sharpened the target: *"data management distribution construction from point to line to points to lines… interpolate curves through sets of points then loft the curves to get a curtain… orbits made from very small spheres positioned on a circle… volumetry at the end."* Two capability gaps stood between the vocabulary and those sentences, and both are now closed:

**Gap 1 — list combinatorics (cross products).** "For each orbit radius, place 60 dots around a circle" is a cross product of two lists. Grasshopper does this with data-tree matching; we do it with two explicit, readable ops: **`RepeatEach`** (`[a,b]×3 → a,a,a,b,b,b`) and **`Tile`** (`[a,b]×3 → a,b,a,b,a,b`) — worker-inline list nodes, plus IR skills `repeat_each`/`tile`. On top of them sits the composite skill **`on_circle(radius, count, z?, scale?)`**: radius may be a *list*, and the expansion builds the whole cross product (ListLength → RepeatEach/Tile → cos/sin Expressions → PointsFromLists) — 9 nodes the model never has to think about. `Tile.count` is edge-driven by `ListLength`, so it works for any data list without the model counting elements.

**Gap 2 — sets of points → sets of curves.** "Interpolate curves through sets of points, then loft" needs one spline *per row*. Instead of nested lists on wires, the **group channel** does it: `PointsFromLists` takes an optional `group` input; `PointGrid` now stamps `row`/`col` channels; `Jitter` preserves channels (it silently dropped them before — fixed). `SplineCurve`/`PolylineCurve` gained a `groupBy` param that partitions consecutive equal-channel runs into separate wires, and `LoftCurves` now flattens multi-wire curves into its section list (it previously would have choked on them; it also no longer demands 2 connected inputs when one grouped curve carries all sections). Result: **grid → spline(groupBy:'row') → loft is a 3-node curtain.** `InstanceOnPoints`' cap was raised 200→500 for dotted-orbit densities.

**Proof fixtures** (compiled validator-clean, in `examples.ts`): `SOLAR_DOTS_IR` — the "only one sphere" solar system, planets as big instances and orbits as rings of tiny instances of the *same* unit sphere, 15 ops → 22 nodes / 27 edges; `CURTAIN_IR` — wavy curtain from pure data (series → tile/repeat_each → wave expressions → grouped points → splines → loft), 10 ops → 13 nodes / 12 edges. Both end in exactly the shape the brief asked for: data first, points as placement/starting sites, curves through point sets, volumetry at the very end.

**The IR is now LIVE in the agent** (P0 steps 1–3 from Part VI are done):

- `buildSystemPrompt` (JSON path) now presents the IR program as the preferred protocol with the generated skill catalog; the legacy patch protocol remains for small edits.
- `runLegacyJson` detects `{body, emit}` responses, runs `compileIr`, feeds compile issues back as budget-counted repairs, and routes the compiled graph through the existing `applyAndPerceive` pipeline (validation → layout → evaluate → sanity). Question-only responses still work.
- `chatCompletion` accepts an optional `responseSchema`: on an **empty canvas** the IR grammar (`buildIrJsonSchema()`, op-name enum) constrains decoding — OpenAI/OpenRouter `json_schema`, Ollama structured outputs — with an automatic one-shot fallback to plain JSON mode if a provider rejects the schema payload, so the constraint can never take down a turn. With an existing graph, no constraint (the model may patch).

**Still open (unchanged from Part VI):** per-request tool-grammar fallback (`agent.ts` session-wide flip), the node-conformance test, the A/B eval run, best-of-N sampling, and skill-mining. The eval suite should be run before judging the IR path — its numbers are now the gate, not opinion.

---

*Files: `src/ai/ir/{types,skills,compile,schema,examples}.ts` (new); fixes/extensions in `src/nodes/NodeDefinitions.ts`, `src/worker/executors.ts`, `src/worker/geometryWorker.ts`, `src/ai/tools.ts`, `src/ai/verification.ts`, `src/ai/agent.ts`, `src/ai/api.ts`, `src/components/ParametricNode.tsx`. Verified: strict-mode typecheck of the IR layer + runtime compile of all four fixtures with edge-level validator simulation. Companion docs: `prompt_to_form_compiler_turn.md` (serving-layer failure taxonomy), `cat_multimodel_test_analysis.md`, the node-expansion research report.*
