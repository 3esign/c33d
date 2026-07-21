# Operating Rules for General Parametric Design Intelligence

A living "constitution" for C33D: the object-agnostic invariants a model + system must satisfy to design *anything* parametrically — a flower, a ship, a building, a machine. Every rule is distilled from observed multi-model evidence (flower, sail-ship, stadium, colosseum sessions), not from any single object. When a new failure appears, first ask *which rule it violates*; if none, consider whether a new rule is needed. This file is the north star; the per-session reports are its evidence.

Companion docs: `graph_intelligence_upgrade_plan_jul18.md` (the how/roadmap), `multimodel_flower_session_analysis_jul18.md`, `sailship_multimodel_report_jul19.md` (evidence).

---

## Governing meta-principle — capability and feedback, never recipes

**The system provides general capability and honest feedback; it must not encode object-specific solutions or step-by-step "how to build X" instructions. Intelligence is emergent — it compounds across sessions from surfaced errors and verified outcomes, not from pre-scripting.** Every probe (ship, flower, building…) exists to *reveal errors*, not to earn a bespoke fix. When something fails, the correct response is almost always to improve the substrate (make a capability reachable), the feedback (make the error honest and actionable), or the compounding knowledge (let verified runs teach the next) — **not** to write a new instruction telling agents what to do for that object.

The line to hold:

- **Capability exposure (REQUIRED, keep):** describing what tools exist and what they do — the node/op library, argument types, the wiring protocol, the parameter namespace, the feedback report. A model cannot use an affordance it doesn't know exists; naming the affordance is not a recipe.
- **Solution prescription (AVOID; this is "preorder" debt):** telling agents *which* nodes to use in *which* order for *which* object, per-object parameter name lists, canned correction checklists, pre-seeded macros, or retrieval that injects a whole prior solution. These manufacture the appearance of intelligence and make emergent generality unmeasurable.

**Known preorder-debt to test-remove and measure the effect of** (do this incrementally, behind the eval suite, watching whether a cleaner substrate + honest feedback holds up): the system-prompt CONSTRUCTION LADDER and COMMON CORRECTIONS blocks (`agent.ts` core rules), per-object recommended slider-label lists (rule 4), and exemplar retrieval that injects full plans/graphs rather than reusable idioms (R4.1). The test is not "does removing it lower pass rate for weak models" but "does the substrate + feedback let capable models reason it out themselves" — that delta *is* the measure of general intelligence we're compounding.

The rules below are all substrate/feedback/representation invariants — capability, not recipe. That is deliberate.

---

## Principle 0 — The design is a genotype, not a geometry

A parametric design is the **smallest generative program whose free parameters propagate through relationships to unfold into geometry**. The graph is the genotype; the geometry is the phenotype. Value lives in the *relationships*, not the coordinates.

- **R0.1 — Perturbation is the test of life.** Moving one driving parameter must re-develop the whole design and keep it valid and proportionate. A model that stays coherent under perturbation is alive; one baked with magic numbers is a photograph.
- **R0.2 — Complexity comes from rules, not statements.** N repeated parts = one source + an instancer + a field, never N hand-placed nodes. A 60-petal bloom is ~15 nodes, not 60 spheres. Detail is *expression of rules*, not *more nodes*.
- **R0.3 — Preserve intent independently of realization.** Capture WHAT is intended (archetype + parts + counts = the DesignGenome) before geometry, so that when construction is simplified the loss is *measurable and recoverable*, never silent. (Implemented: `src/ai/genome.ts`, `scoreIntentRealization`.)

## Principle 1 — Uniform reachability (the deepest law; the sail-ship lesson)

**Every input a model can reason about must be reachable by the same wiring protocol.** If some inputs are unwireable, models hit *invisible walls*: they emit the correct edge, it is silently rejected, and the design collapses to whatever primitives happened to resolve.

- **R1.1 — No second-class inputs.** Evidence: the patch/connect protocol filters out `type:'number'` inputs (`geoInputHandles`, `tools.ts:235`), so `PointsFromLists.x/y/z`, `Expression.a/b/c/d`, `Series` numeric inputs cannot be wired at all — only the IR compiler can. Every model that reached for the list-machinery to place masts or derive a yard height was fighting a wall it could not see. **A protocol that accepts some inputs and rejects others of equal conceptual status is a bug in the intelligence substrate, not the model.** (OPEN P0.)
- **R1.2 — One unified parameter namespace.** Slider labels, constants, inline formulas, and wired values must resolve in one place. A formula must be able to reference a driver by name with no edge (already true in the executor's unified scope) — and the model must *know* this and never be forced to choose between inline formulas and wired ports. Ambiguity here produced the recurring `unknown variable`/`param:a`/`param:b` confusion.
- **R1.3 — The wiring vocabulary the model is shown must equal the wiring vocabulary the system accepts.** If the graph state advertises handles the protocol won't accept (or hides handles it needs), the model wastes repair rounds guessing. Show exactly the removable edge ids and connectable handles — no more, no less.

## Principle 2 — Two spines, first-class idioms

Construction has a **solid spine** (primitives → booleans → Align) and a **skeleton spine** (points/curves → loft/sweep/revolve/instance). Both must be equally buildable.

- **R2.1 — Repetition and derivation are first-class, wireable idioms**, not hand-assembly. Placing 3 masts is `pattern`/`instance-on-points`/`field`, not three Translate chains and not an unwireable list. If the idiomatic path is harder to wire than the naive one, models take the naive one and the design degrades.
- **R2.2 — Skeleton before mass.** Large smooth/organic forms and rhythms derive from curves/points (loft rails, sweep paths, division points). When the skeleton path is open, models build beautifully (the one lofted hull that succeeded proves the ceiling is high); when it's blocked, they fall back to boxes.
- **R2.3 — Placement is relational, never arithmetic.** Attachment (Align/attach/on-surface) over computed coordinates, so the assembly survives parameter changes. A missing attachment input must not silently collapse a whole sub-tree — it should be diagnosable and, where possible, inferable.

## Principle 3 — Truthful, actionable feedback

The model can only be as good as the signal it gets back.

- **R3.1 — "Exists" ≠ "connected" ≠ "renders."** A part can be built, unwired, and still mesh as a stray leaf (loft ribs that render while the loft is empty), giving a false "it's there." Feedback must distinguish built-but-unconsumed from realized, and name the missing connection.
- **R3.2 — Errors must speak the model's language.** No raw kernel strings (`$$`, `This object has been deleted`). Translate every fault into an actionable instruction in the model's own vocabulary, and classify kernel-integrity faults as such (respawn, don't burn repair budget).
- **R3.3 — Separate transport from semantics.** Provider/auth/quota/JSON failures are not design failures; never spend a repair round or a "the model is bad" judgment on them. (Implemented: provider fast-fail, tool-schema sanitization, robust JSON fallback.)
- **R3.4 — Score realization, not just sanity.** "Sane" must not equal "as-intended." Track intent-realization (planned parts/counts vs rendered), repair rounds, and run-to-run distinctiveness — a design that shipped 1 sail against a planned 4 is a *visible* failure, not a pass.

## Principle 4 — Creativity and generality

- **R4.1 — Retrieval injects idioms, not answers.** Feeding a whole prior solution makes models re-render it; keep exemplars to reusable *patterns* and keep a first-class variation/randomness axis so the space stays open. (Implemented: variation seeds, exemplar diet — ongoing.)
- **R4.2 — Rules are object-agnostic.** The same grammar must build a flower, a ship, and a building. If a rule only helps one archetype, it belongs in an exemplar, not in the substrate. Validate across the 4 eval levels and multiple archetypes, not one favorite.
- **R4.3 — Grow detail developmentally.** Skeleton sane first, then detail passes that can roll back independently — so correctness and richness stop competing in a single turn. (Designed, not yet built: developmental construction.)

## Principle 5 — The graph is a decision surface

- **R5.1 — Legible to human and model alike.** Hierarchical, clustered, named by intent (a parts-list, not a wire soup). The model should reason over `bloom: 21 petals` and `stemAssembly`, not 40 anonymous nodes. (Designed: auto-clustering + hierarchical model-facing state.)
- **R5.2 — The view must not cap understanding.** If the canvas can't zoom out to fit a large graph, neither the human nor a screenshot-based collaborator can reason about it. Structure must always be viewable. (OPEN: `<ReactFlow>` sets no `minZoom`.)
- **R5.3 — Runs are shareable artifacts.** Every design/eval run should be re-loadable and exportable (graph JSON), so failures can be analyzed without a screenshot and successes become knowledge. (Implemented: eval experience store; export button pending.)

---

## Rule → status map (living)

| Rule | Status | Anchor |
|---|---|---|
| R0.3 preserve intent (genome) | DONE | `src/ai/genome.ts` |
| R3.3 transport ≠ semantics | DONE | provider fast-fail, `api.ts` schema sanitize |
| R3.4 score realization | DONE | `scoreIntentRealization`, EvalPanel |
| R4.1 variation over anchoring | PARTIAL | `maybeVariationDirective` |
| **R1.1 no second-class inputs** | **OPEN — P0** | `geoInputHandles` `tools.ts:235` |
| R1.2 unified namespace (model-facing) | PARTIAL | executor unified; prompt clarity pending |
| R3.1 built≠connected feedback | OPEN | loft-rib / align-shape hints |
| R5.1 clustered graph | OPEN | `GroupNode` unused for auto-cluster |
| R5.2 zoom to fit | OPEN | `NodeGraph.tsx` `minZoom` |
| R4.3 developmental construction | DESIGNED | upgrade plan Pillar 3 |

The single most general, highest-leverage open item is **R1.1** — uniform input reachability. It is not a ship fix; it is a law of the substrate. Opening it lets *every* archetype use repetition and derivation the way the intelligence already plans to.
