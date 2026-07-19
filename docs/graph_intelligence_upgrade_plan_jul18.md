# Graph Intelligence Upgrade — Toward Detailed, Generative Parametric Design

Jul 18, 2026. Builds on `multimodel_flower_session_analysis_jul18.md`. This document sharpens the theory of what we are actually building, diagnoses why models produce "basic and simple" results, and lays out a four-pillar upgrade aimed at richer detail through *generative* structure rather than more hand-placed geometry.

---

## 1. What parametric design actually is (sharpening your mental model)

Your instinct is right, but let me tighten it. The pipeline you described —

> semantically decode task → object → name → geometrical features → identify as relational and proportional

— is correct as far as it goes, but it collapses several distinct layers into one step, and that collapse is exactly where detail is lost today. The decode is really a **stack of five representations**, each a lossy compression of the one below, and each of which we should be able to inspect, score, and edit independently:

1. **Semantic** — what the thing *is*: concept, function, archetype. ("Lily" → radial bloom, whorled petals, phyllotactic center, single stem.) This is the *meaning*.
2. **Topological** — the *parts* and how they relate: what connects to what, what drives what. This is your "skeleton" (curves drive parts). It is the graph's backbone.
3. **Proportional** — *relations before numbers*: ratios, symmetries, gradients, counts. Petal length ∝ bloom radius; ring radii graded; golden-angle spacing. This is where "parametric" lives.
4. **Geometric** — the actual solids, surfaces, curves that a kernel can build.
5. **Detail / aesthetic** — edge treatments, surface features, per-instance variation, deformation, the "life" of the object.

**The central claim — your DNA metaphor, made precise.** DNA is not a blueprint of the finished organism; it is a *compact generative program* that unfolds into a phenotype through development. A genome is astronomically smaller than the body it grows, because it encodes **rules and relationships**, not coordinates — reuse (one "petal gene" expressed many times), regulation (gradients that modulate expression by position), symmetry with variation, and hierarchical unfolding.

Map that onto us exactly:

| Biology | Parametric design |
|---|---|
| Genotype (DNA) | The graph / IR program |
| Phenotype (organism) | The evaluated geometry |
| Genes reused across the body | Reusable subgraph components, instanced |
| Morphogen gradients | Channels / fields that modulate per-instance parameters |
| Development (unfolding over time) | Progressive construction: skeleton → solids → detail |
| Homeosis (same gene, different context) | `attach()` / context-dependent placement |
| Mutation / variation | Seeded randomness, jitter, design-axis sampling |

So the **essence of parametric design is this**: *encode design intent as the smallest generative program whose free variables propagate through relationships to unfold into coherent geometry.* A model is "alive" when perturbing one parameter re-develops the whole thing and it stays valid and proportionate. A model is "dead" when geometry is baked with magic numbers — a photograph of a phenotype with no genotype behind it. You already measure this instinct (`derivationRatio`, `magicNumberCount`, the perturbation test). The upgrade is to make the *whole system* push toward small-genotype / rich-phenotype.

**What "graph intelligence" means, precisely.** Two things, and we want both:
- **Intelligence *in* the graph** — the graph is compact, generative, legible, and structured so that changing it is cheap and safe. The graph *is* the DNA; a smart graph is a good genome.
- **Intelligence *from* the graph** — the graph is serialized to the model in a form that helps it *reason and decide*: a named parts-list with proportions and feedback, not a flat wire soup. The graph becomes the model's working memory and decision surface, not just its output.

The resolution of the tension you feel — "we want complex geometries **but** a tendency toward smart, clean graphs" — falls straight out of DNA: **complexity must come from generative rules (small genotype, rich phenotype), never from flat piles of nodes.** A rose with 60 petals should be ~15 nodes with a gradient and an instancer, not 60 sphere nodes. Detail = more *expression* of rules, not more *statements*.

---

## 2. Why results are "basic and simple" today

Grounded in the flower session and the code:

**Detail dies in the repair loop (biggest cause).** Models *plan* rich designs — "3 interleaved petal rings, sepals, stamen cluster, bent leaves." Then a compile/kernel error triggers repair, and under repair pressure the model simplifies until *something* passes: 3 rings → 1 ring, stamens dropped. "Sane after aggressive simplification" and "sane as designed" score identically today, so the system has no idea it happened. The survivor is basic by construction.

**Generative primitives are half-there.** We already have `repeat_each`, `tile`, `on_circle` (group channel), `instances` (scale channel + scale ramp), `circular_pattern` (rise + scale ramp), `divide` (t/index/tangent channels), `jitter`, `spline(groupBy)→loft` (`skills.ts`). What's missing for richness: **per-instance rotation/tilt/color gradients** (only scale ramps exist), **arbitrary field/channel modulation**, **reusable components** (no component/def op — so every part is rebuilt from scratch, which inflates node count and caps complexity), **bounded recursion** (no self-similar detail), and **seeded randomness as a design axis** (jitter exists but isn't wired into a variation strategy).

**No developmental stages.** Construction is one-shot: the model must emit the whole detailed graph at once, and any error risks the whole thing. There is no "get the skeleton sane first, *then* add detail" protocol — so detail and correctness compete in a single turn instead of being sequenced.

**The graph doesn't help the model think.** `formatCompactGraphState` (`agent.ts:504-514`) hands back a flat node+edge dump. No hierarchy, no part names, no proportions, no per-cluster feedback. The model can't reason "the stem assembly is fine, enrich the bloom" because it doesn't see assemblies — it sees 40 anonymous nodes. And exemplar anchoring (`retrieval.ts:83-91`) actively pushes toward re-rendering the *same* basic design.

**Weak detail vocabulary.** Fillet/chamfer are the weakest primitives (L1-04 failed on a rounded plate), and there is no vocabulary for surface features, panel lines, embossing, controlled asymmetry, or edge variation — the things that read as "detailed."

---

## 3. The upgrade — four pillars

### Pillar 1 — Make the decode stack explicit: the "design genome"

Introduce a typed intermediate that sits between the plan prose and the IR program: a **DesignGenome** — a small structured object capturing layers 1–3 (semantic, topological, proportional) *before* any geometry op is chosen. Roughly:

```
{
  archetype: "radial-bloom-flower",
  parts: [ {id:"stem", role:"support"}, {id:"bloom", role:"focal"},
           {id:"petals", role:"repeated", of:"bloom", count:"$petalCount"},
           {id:"leaves", role:"repeated", on:"stem"} ],
  relations: [ "bloom.at = stem.tip", "petals.radius ∝ bloom.radius",
               "petals.size gradient outer→inner", "leaves.spacing = phyllotactic" ],
  proportions: { petalCount: 21, ringCount: 3, goldenAngle: 137.5 },
  detailBudget: "high"
}
```

Why this matters: it gives us a place to **preserve intent independently of the geometry that realizes it.** When repair simplifies the geometry, the genome still says "3 rings, high detail" — so we can detect the gap (Pillar 3) and re-enrich. It also becomes the retrieval key (match on archetype + relations, not surface tokens), the diff target for edits ("change petals.count"), and the thing the model reasons over. This is the single highest-leverage structural change; everything else hangs off it.

Implementation: the genome is emitted by the planning turn (we already have a plan/skeleton step), validated against a small schema, then compiled to IR. Store it on the eval record and on success exemplars.

### Pillar 2 — Generative primitives (grow the genotype's expressive power)

Add the DNA mechanisms we're missing, so richness comes from rules. In rough priority:

1. **Fields / channels as first-class modulators.** Generalize the existing scale channel into a `field()` op: a function of position/index/t (linear, radial, sinusoidal, noise) that any instancer reads to modulate *scale, rotation, tilt, color, or any numeric param* per instance. This alone converts flat patterns into graded, organic ones — the difference between 60 identical spheres and a bloom.
2. **Reusable components (emergent, not pre-seeded).** A `define(name, params){…}` + `use(name, args)` pair so a model can author a "petal" once and instance it with varied args. This is gene reuse: it *shrinks* the genotype while *growing* the phenotype, directly lifting the complexity ceiling. Note: this is model-authored per design — it is **not** a shipped macro library (consistent with the "don't pre-seed macros" preference); the reuse is emergent within a single design.
3. **Seeded randomness as a design axis.** Promote `jitter` into a coherent `seed`-driven variation system: a per-design seed plus controlled random ranges on position/rotation/scale, so "make it natural/asymmetric/varied" has a real lever. Ties directly to the anti-anchoring goal ("keep space open for randomness") — a seed makes diversity reproducible *and* controllable.
4. **Bounded recursion / L-system-lite.** A depth-limited `branch()` for self-similar detail (veins, branching, fractal edges). High ceiling for "complex geometry," but gate it hard with depth/iteration caps to protect the kernel.

Every one of these is *node-count-sublinear* in visual complexity — the whole point.

### Pillar 3 — Developmental construction (unfold, don't one-shot)

Sequence construction the way development sequences growth, so correctness and detail stop competing:

1. **Skeleton-first commit.** Build and evaluate the topological skeleton + coarse solids; confirm it's sane and proportionate. Freeze it.
2. **Detail passes.** *Then* run enrichment turns that add petals/gradients/features onto the frozen skeleton. An error in a detail pass rolls back *that pass only* — it can never collapse the skeleton back to a box.
3. **Detail-preserving repair.** When repair must simplify, record the dropped detail as a **deferred-detail list** on the genome (Pillar 1) rather than silently losing it; after first SANE render, attempt to re-add deferred detail. "Simplified to survive" becomes a visible, recoverable state, not a permanent loss.

This is the fix for the number-one cause of "basic" results. It also plays to how models already plan (skeleton → parts → detail).

### Pillar 4 — Graph intelligence (make the graph think with the model)

Turn the graph from output into a reasoning surface. The `GroupNode` infra already exists and is unused (`NodeGraph.tsx:21`, `autoLayout` respects `parentId`) — activate it.

1. **Auto-clustering.** Collapse pure data/list machinery (Series, Range, ListConstant, PointsFromLists, RepeatEach, Tile, Expression) that feeds a single consumer into a labeled group summarizing its product (`"PointRing 21pts → petals"`). Collapsed by default, expandable. Immediately declutters the canvas the user complained about.
2. **Semantic annotation.** Tag clusters with their genome part (`stemAssembly`, `bloom`, `petalRingOuter`). These names become the shared vocabulary for edits and patches.
3. **Hierarchical model-facing state.** Replace flat `formatCompactGraphState` with a genome-grouped view: sliders first, then named clusters each with a one-line summary + folded per-cluster geometry feedback (`bloom: 21 petals, bbox 8×8×3, all leaves healthy`), then loose nodes. Cuts tokens *and* gives the model a parts-list to reason over. This is where "the graph helps models make decisions."
4. **Structural intelligence.** Detect symmetry and repeated subgraphs (candidates for componentization), flag orphan/dead clusters, and surface graph-edit-distance so the model can prefer minimal coherent edits. The graph starts *advising*: "these 3 subgraphs are identical — componentize."

---

## 4. Detail vocabulary (the aesthetic layer)

Complementary node/idiom work so "detailed" has building blocks (lean toward geometry/deformation over materials, per standing preference):

- **Robust edge treatments** — fix Fillet/Chamfer on the failure cases (radius ≥ half-thickness), variable-radius fillets, and a safe "auto-fillet all convex edges" idiom.
- **Surface features** — emboss/deboss, panel/parting lines, controlled displacement along a field.
- **Deformation stack** — we have Bend/Twist/Taper/Pipe; add cage/lattice deform and along-curve deform so instanced parts can flow.
- **Controlled asymmetry** — field- or seed-driven per-instance offsets so repeated detail reads as organic rather than mechanical.

These are what visually separate "basic" from "detailed" once Pillars 2–3 let detail survive.

---

## 5. Feedback: score detail and distinctiveness, not just sanity

The harness must reward what we're now asking for, or models won't learn it:

- **Detail/richness score** — instance counts, gradient usage, feature counts, phenotype-complexity vs genotype-size ratio (high = good DNA).
- **Intent-realization score** — genome (planned parts/rings) vs realized geometry. Directly measures detail-loss-in-repair.
- **Distinctiveness** — embedding distance between repeated runs of the same creative prompt; kills the anchoring/"identical output" failure mode.
- **Repair rounds & first-shot rate** — already recommended in the session analysis; a "detailed but took 3 repairs" result should be visible.

Store all of these on the eval experience record (from the session analysis §3.2), so the experience store becomes the training signal for the generative behavior we want.

---

## 6. Phasing and dependencies

**Phase 0 — unblock (from the session analysis, do first):** schema-constrained decoding on every turn; provider-error classification (abort on 402/403/429); `$$` kernel message + respawn; eval experience store with clickable rows. Without these, richer designs just fail more expensively. Pillar 1's genome slots directly into the eval record built here.

**Phase 1 — the genome + developmental construction (Pillars 1 & 3).** Highest leverage: preserves intent and stops detail dying in repair. Mostly agent/protocol work, low kernel risk. Ship with detail-realization scoring (§5) so the effect is measurable.

**Phase 2 — generative primitives (Pillar 2), in order: fields → components → seeded randomness → recursion.** Each is independently shippable and each raises the complexity ceiling. Fields first because they convert existing instancers into organic ones with the least new surface area.

**Phase 3 — graph intelligence (Pillar 4).** Auto-clustering + hierarchical model-facing state first (declutters canvas *and* helps the model), then structural detection. Depends on Pillar 1's part names to label clusters well.

**Phase 4 — detail vocabulary (§4) + distinctiveness scoring.** Polishes the aesthetic layer once the generative and process foundations carry it.

**Recommended first build after Phase 0:** the **DesignGenome + skeleton-first/detail-pass loop** (Pillars 1 + 3). It is the direct fix for "basic and simple," it's low kernel risk, and it is the substrate every other pillar plugs into — retrieval keys off it, clusters name off it, scoring diffs against it, generative primitives populate it.

The one-line thesis: **stop treating the graph as the output and start treating it as the genome.** Make it small, generative, legible, and developmental — then detail is something the model *grows*, not something it hand-places and loses.
