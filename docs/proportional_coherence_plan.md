# Proportional Coherence: Making Slider Changes Preserve the Design

*Research + recommendations, July 9 2026. Based on the "make a bee" transcript, the current codebase, and external literature.*

## The problem, precisely stated

The bee transcript shows the model **already knows** what proportional design means — its plan contained a
correct governing-ratio table (`abdomenLength = bodyLength * 0.5`, `wingSpan = bodyLength * 0.9`, …).
The failure is that **nothing forces the plan into the graph and nothing verifies it landed**. The built
graph used absolute literals and absolute Translates, so moving a slider shears the model apart.

This is the classic CAD "design intent" problem: a model is only parametric if its constraints capture
which relationships must survive an edit. Autodesk Research attacked exactly this with *design
alignment* — using constraint-solver feedback as a verifiable reward — and moved fully-constrained
sketch rates from **8.9% to 93%** ([arXiv 2504.13178](https://arxiv.org/abs/2504.13178)). The lesson:
**you cannot prompt your way to design intent; you must verify it mechanically and feed the failure back.**

C3D already has every ingredient: inline formula params resolving against slider names
(`resolveInlineNumericParams` in `geometryWorker.ts`), Expression nodes, `param:` edges, the Align node,
the geometry report, and the auto-repair loop. What is missing is the **enforcement layer**.

---

## Recommendation 1 — The Perturbation Test (highest leverage, do this first)

Static linting can check that params reference sliders, but the only true test of proportionality is:
**change the slider and see if the design survives.** Add to the worker/verification pipeline:

1. After a successful build, snapshot the **relation signature** of the assembly at default slider values:
   - contact/adjacency graph between leaves (which parts touch/overlap which, from bboxes)
   - containment relations (eye ⊂ head-region, etc.)
   - assembly bbox aspect ratios
   - relative-center offsets of each leaf, normalized by assembly size
2. Re-evaluate the same graph at **0.6× and 1.5×** of each driver slider (workers make this cheap; the
   memo cache already invalidates on slider change).
3. Compare signatures. Report violations *in the same vocabulary the repair loop already uses*:
   - `"At bodyLength=30 (+50%), 'translate_eye_r' detaches from 'head' (gap 4.2). Its position is an absolute literal — derive it from bodyLength or use Align."`
   - `"At bodyLength=12 (−40%), 'wing_l' becomes fully buried in 'thorax'."`
4. Feed this into: (a) the auto-repair loop as issues, (b) the eval harness as a new scored metric
   (**proportional integrity**, 0–1 = fraction of relations preserved), (c) the Save-as-Successful gate —
   a design that shatters under slider change should not enter the success library.

This is the mechanical equivalent of Autodesk's solver feedback, adapted to your dataflow world. It
converts "please use ratios" from a plea into a testable invariant, and it works no matter which model
or protocol produced the graph.

## Recommendation 2 — Parameter-coverage lint (static, cheap, immediate)

Add a validation pass in `graphValidation.ts`:

- For every geometry node, classify each numeric param: **literal**, **formula referencing a slider**,
  or **param-edge driven**.
- Compute coverage = driven params / (driven + significant literals). Ignore small literals
  (segment counts, angles under a threshold, booleans).
- Emit repair-style issues for the worst offenders:
  `"'abdomen'.radiusX = 8 is a bare literal while slider 'bodyLength' exists — write it as a formula, e.g. 'bodyLength * 0.28'."`
- Track coverage as an eval metric next to nodeCount/visionScore.

Suggested policy (start soft, tighten later): warn under 60% coverage, block Save-as-Successful under 40%.

## Recommendation 3 — Plan→graph contract

The plan phase already produces ratio tables as free text. Make them structured and checkable:

- Extend `set_plan` with an optional `ratios` field: `[{param: "abdomen.radiusX", formula: "bodyLength*0.28"}]`
  and `drivers: ["bodyLength"]`.
- After the build, diff declared ratios against actual node params. Undeclared literals and unimplemented
  ratios become repair issues: `"Plan declared wingSpan = bodyLength*0.9 but 'wing_l'.radiusX = 9 (literal)."`
- This exploits the observed strength (good planning) to fix the observed weakness (lossy execution).

## Recommendation 4 — Placement must be relational, not positional

The buried-eyes / floating-legs failures all come from absolute `Translate`. The scene-generation
literature converges on **(target, relation, anchor) triplets** with placement expressed relative to the
anchor ([survey: arXiv 2505.05474](https://arxiv.org/pdf/2505.05474)). Concretely:

- **Ship the planned `attach()` node** (see c3d-parameter-layer notes): child + parent-reference inputs,
  placement as **fractions of the parent bbox** (`u,v,w ∈ [0..1]` + optional protrusion fraction).
  Fractional coordinates are scale-invariant by construction — eyes at `(0.9, ±0.3, 0.6)` of head bbox
  stay on the face at any bodyLength. This single node eliminates the whole class of failures.
- Until then: system prompt rule — *"Translate between parts is forbidden; use Align. Translate is only
  for small nudges, and its vector components must be formulas of a driver slider, never literals."*
- Validator: flag any Translate edge whose vector is literal and larger than ~20% of the moved part's size.
- Keep the containment/burial validator (it fired correctly throughout the transcript) but let its fix
  suggestions recommend Align/attach with fractions instead of coordinate nudges — nudges at one scale
  are wrong at every other scale.

## Recommendation 5 — Fix the failures that burned the repair budget

The bee used all repair rounds on issues the system caused or could have rejected instantly:

1. **"This object has been deleted"** (killed the best attempt). Shape-lifetime bug in the worker:
   cached shapes are shared across cache entries when executors pass inputs through, and
   `makeCompound` members may be freed by the eviction pass while still referenced. Fixes:
   - Rule: **an executor must never return an input object itself** — always `.clone()` on pass-through
     (Fillet/Mirror failure paths, Compound single-input path already does).
   - Clone members going into `makeCompound`.
   - In the eviction pass, treat a compound's children as retained, or refcount instead of the
     identity-set heuristic.
2. **Invalid edges should be rejected at ingestion, not litigated over repair rounds.** "Edge into
   'abdomen' targets handle 'solid', which Ellipsoid does not have" appeared in three consecutive
   rounds. When `add_nodes`/`connect` (or JSON graph) arrives, drop invalid edges immediately and return
   the correction in the tool result: `"dropped 2 edges: Ellipsoid has no inputs"`. The model then sees
   ground truth instead of re-emitting its own mistake. Repair rounds are too scarce for static errors.
3. **JSON fallback emits whole graphs → truncation and stale duplicates** (`rotate_antenna_r/l` twins,
   "connections cut off in the previous response"). Move the JSON protocol to the same incremental ops
   as tool-calling (this is the "DSL first / incremental ops" priority already on the roadmap — the
   transcript is the proof it matters).
4. **Gemini 403 → silent degradation.** The slot had no usable key for tool-calling, so the run silently
   fell into the weakest protocol. Fail loudly in the UI ("agent slot has no API key — fix before
   generating") instead of degrading; a user watching "make a bee" fail can't tell the difference
   between a dumb model and a hobbled one.
5. **Repair messages should carry state, not just complaints.** After each repair round, include the
   *current* node/edge list (compact) in the message. In round 3 the model said "complete the edge
   connections cut off in the previous response" — it was reasoning about its intention, not the store.

## Priority order

| # | Item | Effort | Impact |
|---|------|--------|--------|
| 1 | Reject invalid edges at ingestion (5.2) | small | stops repair-budget waste immediately |
| 2 | Shape-lifetime fix (5.1) | small | removes the crash that killed the best run |
| 3 | Parameter-coverage lint (R2) | small | immediate pressure toward ratios |
| 4 | Perturbation test (R1) | medium | *the* enforcement mechanism; also an eval metric |
| 5 | attach() fractional placement (R4) | medium | eliminates burial/detachment class |
| 6 | Plan→graph ratio contract (R3) | medium | closes the plan-execution gap |
| 7 | Incremental JSON protocol (5.3) | larger | already roadmapped; transcript confirms priority |

## External sources

- [Aligning Constraint Generation with Design Intent in Parametric CAD](https://arxiv.org/abs/2504.13178) (Autodesk, arXiv 2504.13178) — verifiable solver feedback as alignment signal; 8.9%→93% fully-constrained.
- [AutoConstrain blog, Autodesk Research](https://www.research.autodesk.com/blog/ai-alignment-in-cad-design-teaching-machines-to-understand-design-intent-in-autoconstrain/) — accessible summary of the above.
- [Text2CAD-Bench](https://arxiv.org/pdf/2605.18430), [TOOLCAD](https://arxiv.org/pdf/2604.07960), [Obj2CAD](https://openreview.net/pdf?id=uEND0LWlc8) — 2025–26 text-to-CAD landscape; Obj2CAD's hierarchical objects with semantic constraints parallels the attach()/anchor design.
- [CAD-Coder](https://arxiv.org/pdf/2505.19713) — chain-of-thought + geometric reward (same verify-don't-trust pattern).
- [3D Scene Generation survey](https://arxiv.org/pdf/2505.05474), [Hierarchical LLM scene synthesis](https://arxiv.org/pdf/2502.10675) — (target, relation, anchor) triplets and anchor-relative placement.
- [Alibre: Design Intent guide](https://www.alibre.com/blog/design-intent-a-guide-to-3d-parametric-modeling/), [Autodesk Inventor design-intent guide](https://www.autodesk.com/blogs/design-and-manufacturing/design-intent-cad-autodesk-inventor/) — practitioner consensus: few driving parameters, everything else derived; fully-constrain before extruding.
