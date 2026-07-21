# JSON Export Analysis — July 21 evening batch (12 new exports)

**Scope:** the 12 exports from `JSONs/` timestamped 2026-07-21T11:50 → 20:58 (procedural city, Pantheon, 4× Boeing 747, guitar, 2× divide-curve-spheres probe, 1 continuation, 2× sphere-surface-points probe), cross-read against `intelligence_log.json` (56 turns on Jul 21, 46% technical success) and the live source in `src/ai`. Follow-up to `docs/json_export_analysis_jul21.md` (morning batch, "edge under-generation" finding).

**Headline: the models solved your simple tasks. The harness rejected their solutions.** The morning diagnosis ("models emit nodes but under-generate edges") was only half the story. The evening transcripts prove the other, dominant half: models DID emit the correct dataflow edges — and C3D's own edge validator dropped every one of them, then demanded they be added, forever. This is the **number-input wiring wall** (R1.1 in `docs/parametric_intelligence_rules.md`), now proven at code level and **fixed in this session**.

---

## 1. The deadlock, step by step (glm-5.2, "make a curve and divide it in points and place a sphere on each point and have a random radius…")

The model's first-turn conception was *textbook parametric design* — exactly the "one node instantiated with list data" pattern:

```
curveLength, pointCount (sliders)
t     = Series(start 0, step "1/(pointCount-1)", count "pointCount")   ← 12 values 0…1
x     = Expression("curveLength * a")
y     = Expression("curveLength * sin(a*6.283) * 0.18")
z     = Expression("curveLength * cos(a*6.283) * 0.12 + …")
radii = Expression("lerp(curveLength/20, curveLength/10, …)")          ← the requested 1/20…1/10 random radius!
pts   = PointsFromLists(x,y,z,scale)  →  curve = SplineCurve  →  pipe = Pipe
sphere → spheres = InstanceOnPoints(shape, points, per-point scale)
```

12 nodes, 12 intended edges. What survived in the exported graph: **4 edges — precisely the four non-number ones** (`pts→curve.points`, `curve→pipe.path`, `sphere→spheres.shape`, `pts→spheres.points`). All 8 number-list edges (`t→{x,y,z,radii}:a`, `{x,y,z}→pts:{x,y,z}`, `radii→pts:scale`) were stripped.

Why. Both AI edge paths — `agent.ts::validateAndResolveEdge` (JSON patch protocol **and the IR compiler's output**, which routes through the same full-rebuild apply) and `tools.ts::connect` — validated `targetHandle` against `geoInputHandles()`, which is *deliberately defined as the non-number inputs*. `Expression` declares only number inputs (a/b/c/d), `PointsFromLists` only number inputs (x/y/z/scale/group) — so to the validator these nodes had **no inputs at all**. Every wiring attempt returned `"Expression" has no input handle "a"`, and the `connect` tool literally told models `Valid inputs: (none)`.

Meanwhile `validateGraphStructure` (correctly) raised errors demanding exactly those edges: *"a/b/c/d are supplied by wiring a number list into the matching input handle … Add the edge: connect a Series/Range/Expression list into 'a'"*. **The system demanded an edge that the same turn's validator refused to accept.** No sequence of model outputs could escape.

The transcripts show the models behaving *rationally* inside this trap:

- glm-5.2: "My added edges were silently dropped in both previous attempts… I need to include both sourceHandle and targetHandle" → still dropped → "All 4 prior attempts failed because targetHandle used 'param:a' prefix… The correct format is bare handle name" → still dropped → Ollama 500 → budget exhausted.
- gemma4: tried bare `a`/`x` → dropped → concluded "the system uses 'param:a', … the only reliable way" → dropped → budget exhausted.
- qwen3.5 (guitar): wired pegs via Series→PointsFromLists (the right design), hit the wall, and *drew the intended lesson backwards*: "Switch to a simpler approach… This avoids the PointsFromLists complexity."

Three different models, both handle spellings, both protocols (patch + IR), same dead end. The trap was airtight and invisible: the rejection reason ranked in the "others" bucket of `aggregateAndRankIssues` and usually fell off the 5-issue cap, while the transcript line said only "Structural validation error — asking the model to fix."

### Blast radius

`geoInputHandles`-based acceptance walled off the number inputs of **14 node types** — the entire list/vector layer: Expression a/b/c/d; PointsFromLists x/y/z/scale/group; Series start/step/count; Range min/max/steps; ListItem, ListLength, RepeatEach, Tile; Point x/y/z; VectorXYZ x/y/z; PointBetween t; VectorMath factor; PointOnCurve t; EvaluateCurve t. Everything that makes a graph *generative* rather than hand-assembled.

This also revises the morning's megapolis autopsy: some of those "un-emitted" edges were plausibly emitted and confiscated — the exports only record the post-strip graph. (The Jul-21 morning `inferMissingEdges` autofix couldn't rescue these sessions either: it required trailing-number id groups (`x1_expr`), and the natural single-group naming — `t, x, y, z, radii, pts` — has none.)

---

## 2. Answer to your observation: "many separate node points whilst there should be one node instantiated with the list of vector data"

Yes — and the transcripts show something important: **the models already think the way you want.** On every fresh simple task, all three local models' first move was the list-driven pattern (one PointsFromLists + one InstanceOnPoints + Series/Expression drivers). The singleton-Point sprawl you see in the surviving graphs is not the models' preference — it is the only style the validator allowed to live:

- glm-5.2 Boeing ("interesting result"): 11 hand-placed `Point` nodes, each wired into a primitive's `center`/`pivot` socket, zero instancing, zero list math. It survived *because* Point→center edges are geometry-typed.
- qwen3.5 Boeing: 9 Points; deepseek Boeing: 5 Points + 10 sliders, report NONE after 139 messages of edge-fights (53 phantom edge-removal attempts).

So the selection pressure ran backwards: parametric thinking → rejected → repair-budget death; manual placement → accepted → "success" recorded in the intelligence log. Left running, the knowledge base would compound in exactly the wrong direction.

On the design question itself: one generator node fed by lists (with per-element channels like `scale`, and instancing downstream) **is** the correct general way to think — it is the data-flow core of every serious parametric system, it's what your Expression broadcast semantics and PointsFromLists channels were built for, and it's what makes a graph a *design* rather than a frozen arrangement. Hand-placed Point anchors remain legitimate for a small number of *distinct* named anchors (a nose, a tail, one pivot). The boundary is repetition: the moment the same shape appears at N places, positions belong in lists. Per your no-preorders methodology, this should NOT become a prompt commandment — with the wall removed, the substrate permits it again, the existing probes (placement provenance, node-economy warning) already reward it, and the models' own first instincts carry it. If a future probe is wanted, an object-agnostic *instancing ratio* (repeated-congruent-leaves vs instanced leaves) in the geometry report would measure it without prescribing it.

---

## 3. What was implemented (this session, committed to your working tree)

Substrate + feedback only; zero object-specific instructions.

**A. The wall is down** — edge acceptance now checks ALL declared inputs:
- `src/ai/tools.ts`: new `allInputHandles()` / `numberInputHandles()` / `describeWireableInputs()`; `connect` accepts number-input handles; every rejection message now lists the real socket inventory ("geometry inputs: …; number/list inputs: …; numeric params: …") instead of "Valid inputs: (none)"; `param:a` mistakes get a pointed hint ("'a' IS a number input — use targetHandle 'a' without the 'param:' prefix").
- `src/ai/agent.ts::validateAndResolveEdge`: same acceptance + same honest messages (this path also validates the IR compiler's output, so compiler-emitted list wiring now survives).
- `src/ai/tools.ts::pickTargetHandle`: number sources with an omitted targetHandle now land on the first FREE number input in declaration order (Series→Expression lands on `a`, next on `b`; Expression→PointsFromLists lands on `x`, then `y`…). Previously they fell into the geometry-only fallback and were rejected; this also stops a slider from being silently wired into a curve input.

**B. Feedback can no longer hide the reason:**
- `aggregateAndRankIssues`: rejected edges are aggregated by reason ("8 edge(s) REJECTED, not added — …: t→x, t→y, …") and ranked FIRST, so they can't fall off the 5-issue cap. "No input handle"/"no numeric param" lines classify as structural.
- Structural-validation transcript lines now include the first two concrete issues (exports stop recording six opaque "Structural validation error" lines in a row — partial S5).
- `validateAndNormalizeNodeData`: a data param whose name is actually an input socket (e.g. Rotate's `pivot`, qwen Boeing) now yields a warning explaining how to wire it, instead of an error that deletes the node while implying the capability doesn't exist.

**C. Autofix reaches the natural naming** — `graphValidation.ts::inferMissingEdges` adds graph-wide-uniqueness fallbacks: with exactly ONE Series/Range in the whole graph, unwired Expression vars wire to it (Rule A2); with exactly one PointsFromLists, role-named producers (`x`, `xCoords`, `y_vals`…) wire to their channels (Rule B2). Still conservative: only empty handles, only unambiguous candidates, never overrides explicit wiring.

**Verification:** `tsc` clean (cloud clone; OneDrive tsc unusable per repo lore). Mirror tests: `test_number_input_edges.mjs` (new — includes the full 12-edge glm graph as an end-to-end contract), `test_edge_completion.mjs` (updated in lockstep: bare-naming now wires; two-sequence ambiguity still refused), `test_typed_handle_inference.mjs` (14 contracts, geometry behavior unchanged). All pass.

**Expected effect:** re-run the two probes ("curve → divide → spheres with random 1/20–1/10 radius", "sphere → surface → 10 random points → spheres") on glm-5.2 / qwen3.5 / gemma4. The Jul-21 graphs would now evaluate on the first turn — and even a model that forgets every edge gets the island auto-healed by A2/B2.

---

## 4. Secondary failure classes in this batch (evidence-ranked, not yet fixed)

1. **IR compiler ergonomics kill weak-transport models before geometry exists.** Nemotron Pantheon died twice on `Argument "center" of "cylinder" must be a reference like "$myCurve" (point), got {"op":"point",…}` — the model nested an op literal where only `$bindings` are allowed (a perfectly natural way to write a program); same with `{"op":"item",…}` for your airplane-loft request, and `"$rootChord/2"` (arithmetic on a ref; legal spelling is the formula string `"rootChord/2"`, which nothing in the error explains). Gemma burned 13 IR compile rounds across its sessions. Fix direction: accept inline nested ops for point/vector/item (compile them to the same nodes), rewrite ref-arithmetic errors to show the exact legal spelling, and consider auto-hoisting `$x/2`.
2. **Compiler-minted `_x`/`_x_2` ids** (freshId suffixes for a skill's secondary nodes) are unguessable, so follow-up patches fight phantoms — 53 no-match edge removals in one deepseek session, 55 in one qwen session. Direction: mint role-named ids (`pegPoints_ctr`, `pegPoints_curve`) or alias the model's original names.
3. **ScatterOnSurface produces NaN/degenerate output** — both qwen and gemma independently chose it for "random points on a sphere surface" (the right node for your probe!) and it returned non-finite bboxes with zero volume; both models then abandoned the correct approach. Needs a worker-side repro + fix (likely the exact capability your second probe was testing).
4. **Transport, nemotron/OpenRouter:** empty tool-call responses → JSON fallback → invalid-JSON death spirals; 4× HTTP 429; the Pantheon session ends with 6 sliders and 0 edges. Matches the Jul-16 compiler-turn analysis; the P1 there (constrained decode + IR-only mode for weak providers) is still the answer.
5. **Ollama 500s mid-repair** (2 sessions) end conversations at the worst moment; a retry-with-backoff on 5xx inside the repair loop would have saved glm's first probe run.
6. **Exports still don't capture the validator's actions** (dropped edges, autofix wires, IR programs, git hash). This session's structural-peek helps; full S5 capture remains open — it's what made this morning's diagnosis half-wrong.

## 5. Suggested next probes (unchanged tasks, now measurable)

Re-run the same two simple prompts, unmodified, across the same three local models; then the guitar. Success criterion: first-turn evaluation with per-point radii visible (bbox spread in sphere sizes), zero structural-exemption rounds. If those pass, the earlier failures (megapolis rings, city instancing) become the next honest test of *conception* rather than of the transport.
