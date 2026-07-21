# JSON Export Analysis — Jul 21, 2026 (12-export batch)

Extends `json_export_analysis_jul20.md` (which read the single spaceship export). This batch
covers **12 exports**, `2026-07-20T05:36` → `2026-07-21T07:12`, across **5 models** (all Ollama
cloud) and **4 prompts** (spaceship ×3, procedural city ×4, rose ×4, megapolis ×1).

## Headline

The models are **not** short on ideas or on capability. They emit rich, correct node sets with
the right formulas — including the exact `a/b/c` element-variable convention the Expression node
expects — and then **fail to emit the dataflow edges that wire those nodes together**. Every
recurring geometry error in this batch (`unknown variable 'a'` ×22, `PointsFromLists produced no
geometry` ×6, `InstanceOnPoints null` ×3) is a downstream symptom of one disease: **nodes without
wires.** The instancing/generative backbone is built as disconnected islands, so it silently
collapses to a few hand-wired singletons — which is exactly why every result reads as "primitive."

Fix sequencing follows from this: **edge-completion is the P0 bottleneck; richer "conception"
(the owner's intuition) is real but gated behind it** — better imagination won't show on screen
while the graph that expresses it stays unwired.

## The corpus

| # | time | prompt | model | outcome | nodes/edges | leaves ok | owner's verdict |
|---|------|--------|-------|---------|-------------|-----------|-----------------|
| 1 | 07-20 05:36 | spaceship | glm-5.2 | full | 27 / 17 | 9/9 | "does not look bad… want more detail, more derived geometry" |
| 2 | 07-20 06:03 | spaceship | kimi-k2.7-code | no-preview | 21 / 11 | 0/0 | "two times graph does not give preview" |
| 3 | 07-20 06:08 | spaceship | nemotron-3-ultra | no-preview | 18 / 11 | 0/0 | "did not provide graph with working 3d model" |
| 4 | 07-21 04:54 | city | minimax-m3 | full | 9 / 1 | 4/4 | "very primitive… took three times" |
| 5 | 07-21 05:03 | city | glm-5.2 | full | 24 / 13 | 7/7 | "working, but very poor and primitive… way under expectations" |
| 6 | 07-21 05:10 | city | kimi-k2.7-code | partial | 32 / 7 | 2/6 | "very poor… it works but this is terrible" |
| 7 | 07-21 05:16 | city | nemotron-3-ultra | empty | 0 / 0 | 0/0 | "no graph no 3d preview nothing" |
| 8 | 07-21 06:11 | rose | nemotron-3-ultra | partial | 41 / 27 | 3/5 | "terrible result" |
| 9 | 07-21 06:17 | rose | glm-5.2 | full | 26 / 17 | 7/7 | "terrible result for a rose" |
| 10 | 07-21 06:50 | rose | glm-5.2 | full | 40 / 29 | 9/9 | "very bad… only the lower green part is visible" |
| 11 | 07-21 07:00 | rose | deepseek-v4-pro | full | 23 / 13 | 7/7 | "very primitive… yet glimpse of intelligence" |
| 12 | 07-21 07:12 | megapolis | deepseek-v4-pro | partial | 38 / 13 | 2/8 | "missing better conceptualization… the graph here is terrible" |

Not one result cleared the owner's bar. "Full" here means *every leaf meshed* — it says nothing
about design quality, and the owner's verdicts make the gap explicit.

## Finding 1 (P0) — Edge under-generation is the real failure. The backbone is built as islands.

Autopsy of #12 (megapolis, deepseek) — a genuinely sophisticated **concentric-ring city**:
three rings (`cityRadius × 0.3 / 0.6 / 0.9`), each a `Series` of angles, each angle mapped to a
point via `(cityRadius*0.3)*cos(a)`, per-ring density and scale variation `1 + 0.2*sin(a*3)`,
`Jitter`, then `InstanceOnPoints` of a box+cone building. The *plan* is excellent.

What actually shipped: **38 nodes, 13 edges, 23 fully-disconnected nodes.** The entire coordinate
half — `angles1`, `x1_expr`, `y1_expr`, `points1`, `scale1_expr` (and the ×2, ×3 copies) — has
**zero inbound edges**. The model wired `jitter1 → buildings1` and `shapeA → buildings1`, but never
wired `angles1 → x1_expr:a`, never `x1_expr → points1:x`, never `points1 → jitter1`. The generative
subsystem is an unconnected pile; only the two hand-wired singletons (`ground`, `spire`) survived —
hence 2/8 leaves and a "primitive" render.

This is not a one-off. Edges-per-node collapses precisely on the instancing failures:

- #6 kimi city: **32 nodes / 7 edges** (0.22) → 2/6 leaves
- #12 deepseek megapolis: **38 / 13** (0.34) → 2/8 leaves
- #8 nemotron rose: **41 / 27** (0.66) → 3/5 leaves

versus the clean runs at **0.54–0.73** edges/node with all leaves meshed. The failure is *localized*:
the singleton leaves get wired, the repeated/generative subgraph does not. LLMs are reliably worse
at emitting adjacency (edges) than at emitting nodes — this batch is that weakness in the open.

## Finding 2 (P0) — The capability EXISTS; the error message sabotages the repair loop.

The Expression node already broadcasts element-wise over list inputs `a,b,c,d` — see
`src/ai/ir/skills.ts` (`math`: *"math over numbers/lists: formula of a,b,c,d and slider names;
broadcasts element-wise over lists"*, and `remap` wiring `inputs:{ a: values }`). The models even
adopt this convention unprompted: `a*cos(b)`, `a % petalCount`, `floor(a/petalCount)`, and the rose's
`azimuth: b*360/c + a*137.5` — **golden-angle phyllotaxis (137.5°)**. The intent is real and correct.

But when the raw graph leaves `a` unwired (Finding 1), the scalar evaluator throws
`unknown variable 'a' — available: <slider list>` (`src/utils/expression.ts:134`). That message is
**actively misleading**: it presents the sliders as "available," so the repair model's rational move
is to *replace `a` with a slider* — destroying the per-element intent and locking in a static result.
The message never says the true fact: *`a/b/c/d` are element variables bound by wiring a number-list
into the Expression's matching input handle, and none is wired.* Rewriting this one string to name the
missing **edge** (not offer sliders) would let the existing 2-repair budget fix a large share of runs.

## Finding 3 (P1) — Transport reliability is per-model, and it's still gating the weak models.

Aggregate protocol/transport signals across the batch: **25 repair-attempts, 12 IR-compile-errors,
10 "response was not valid JSON", 7 "native tool-calling disabled (provider grammar error)",** plus
provider rate-limits and empty-response fallbacks. These are not evenly distributed:

- **glm-5.2** — 4/4 produced valid, fully-meshed geometry; never a transport failure. The workhorse.
- **deepseek-v4-pro** — 1 full + 1 partial; the only "glimpse of intelligence" verdict. Most promising.
- **minimax-m3** — valid but minimal, and needed 3 attempts.
- **kimi-k2.7-code** — 0/2 clean; a graph that never previewed and a 2/6 partial. Good model, wrong path.
- **nemotron-3-ultra** — 0/3 clean; two empty/no-preview and one 3/5. Worst on this pipeline.

The owner's own note on #12 — *"optimized per model"* — is the right frame. glm and nemotron should
not be driven through the same emission path.

## Finding 4 — "Primitive" is mostly Finding 1, not weak imagination.

The owner keeps reaching for conception ("we first need a rich image of what we want to achieve").
Half-right: the *conception* of the megapolis (phyllotactic rings) and the rose (ringed petals on a
golden angle) was already strong — it died at wiring. So conception upgrades (the Jul-20 "conception
wave," commit `065240c`) will not become visible until the generative subgraph actually connects.
**Do edge-completion first; conception pays off second.** The one true capability gap the batch shows
is the owner's standing request — primitives that take a **base point + rotation** input so one
point-list drives an array of placed, varying instances — which reduces how many fragile edges the
model must emit in the first place (see P2).

## Recommendations (ranked)

### P0 — Disconnected-island probe + honest wiring errors (pre-execution)
Add a structural pass (extend the existing "missing required inputs" validator) that, before meshing,
flags: (a) any non-leaf node with no path to a rendered leaf; (b) any Expression using `a/b/c/d` with
no list on that handle; (c) any `PointsFromLists`/`InstanceOnPoints` with unwired required list inputs.
Emit **edge-level repair instructions naming the fix** ("wire `angles1 → x1_expr:a`", "wire
`x1_expr → points1:x`"), not symptom-level ones. Rewrite `expression.ts:134` per Finding 2. This is the
single highest-leverage change and it rides the repair loop already in place.

### P0 — Naming-convention auto-wire (deterministic repair)
The models name islands consistently (`angles1 → x1_expr → points1 → jitter1 → buildings1`). When an
Expression references `a` with no `a`-input and exactly one unconsumed list exists (or a sibling by
name), connect it; likewise infer `x_expr → points:x` by name. Deterministic edge inference reconnects
most islands without another model round-trip — and sidesteps the LLM's edge-emission weakness entirely.

### P1 — Steer weak models to the IR/DSL path; constrain decoding
The IR skills (`math`, `remap`, `on_circle`, `series`) auto-wire the list into handle `a` — the IR path
cannot produce this island failure. Route raw-graph-weak models (nemotron/kimi) through IR emission,
and apply schema/grammar-constrained decoding so "not valid JSON" and "IR compile error" cannot occur.
(Re-confirms the standing P0 in `c3d-compiler-turn-analysis`.)

### P2 — A high-level generative node to shrink the edge budget
Ship `ScatterOnCircle` / `RingInstances` / `GridInstances`: one node that internally does
angles→points→instance with per-element `scale`/`rotation`/`jitter`. The model emits **1 node + 1 edge**
instead of 8 nodes + 10 fragile edges. Fewer edges to omit. Pairs with giving primitives a `point` +
`rotation` socket (the owner's long-standing ask; `Translate` already has the `target:Point` precedent).

### P3 — Keep the conception wave, but measure derivation
Extend the report metric to count **derived vs. independent** leaves (geometry grown from other geometry
via pattern/offset/boolean/fillet vs. standalone primitives) and nudge when low — this operationalizes
"use existing geometry to generate other geometry." Gate expectations: this only shows once P0 lands.

## Per-model scorecard (this batch)

| model | runs | valid geometry | best verdict | failure mode |
|-------|------|----------------|--------------|--------------|
| glm-5.2 | 4 | 4/4 | "does not look bad" | under-detailed, literal placement |
| deepseek-v4-pro | 2 | 1 full / 1 partial | "glimpse of intelligence" | instancing islands (megapolis) |
| minimax-m3 | 1 | 1/1 | — | minimal; 3 attempts |
| kimi-k2.7-code | 2 | 0 clean | — | no-preview / unwired instancing |
| nemotron-3-ultra | 3 | 0 clean | — | invalid JSON / empty / islands |

## Appendix — deployment note (the "download button")

Separately reported: the live app `c33d.vercel.app` still lacks the Export/Download JSON button.
Root cause is **not** the code — the button is committed and pushed (`0a782c6`, `52e32b3`), and a clean
clone of `origin/main` builds cleanly (`npm ci` 8s, `tsc -b && vite build` 2.3s, exit 0). The cause is
that **Vercel is not connected to GitHub**: the repo has no Environments and `/deployments` 404s, there
is no deploy workflow (`ci.yml` only typechecks+tests), and the `.vercel` link folder + absent CLI
indicate the site was deployed once via `vercel`/`npx vercel` and never redeployed since the button
landed. Fix: one-off `npx vercel --prod` from the project folder; permanent fix — connect the repo in
Vercel → Project → Settings → Git (production branch `main`) so every push auto-deploys.

## Method

`buildSessionExport` bundles (graph, conversation, plan, genome, geometryReport, comment) per run.
Parsed all 12; counts are from `geometryReport.leaves[].meshOk`, `nodeErrors`, and the raw `edges`
array (island detection = nodes absent from both edge endpoints). Formulas quoted verbatim from
`node.data`. No model was re-run; this reads only the exports in `JSONs/`.
