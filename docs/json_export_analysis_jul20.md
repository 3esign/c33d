# JSON Export Analysis — Jul 20, 2026

Source: `JSONs/c33d-graph-2026-07-20T05-36-24.json` (spaceship, glm-5.2:cloud via Ollama).
Only one export was present in the folder despite "a couple" being expected — worth re-checking the export/download flow.

## What the export shows

A clean parametric result on a weak transport path: 27 nodes / 9 leaves, all dimensions
formulas of 3 sliders, proportionalIntegrity 1.0, zero kernel faults, zero node errors.
The complaint in the comment is about the *ceiling*, not failure — and it is correct.

Graph anatomy: every part is `primitive → Rotate → Translate` with literal offset
expressions (`-shipLength*0.36`, `shipWidth*0.6`…). Zero Align, zero Point/Curve nodes,
zero anchors. 15 of 27 nodes are transform scaffolding (nodesPerLeafRatio 3.0).
Transport: tool-calling returned empty → JSON fallback → 2 invalid JSON attempts before
success, on an *empty canvas* turn. `plan` is empty; the raw invalid payloads were discarded.

## Finding 0 — the capability the comment asks for partially EXISTS

The comment: "one point turned into array of points … generate spheres … another list to
have varying radius … does not seem to be possible how i see nodes."

It is possible today: `Series/Range → PointsFromLists (x,y,z,scale,group) →
InstanceOnPoints`, whose executor gives per-point `scale` priority over the
scaleStart→scaleEnd ramp (executors.ts ~2451). Built in the Jul 12 bridge wave.

That the project owner doesn't know it exists is itself the finding: **capability lives in
executor code; knowledge lives in the prompt; visibility lives in the UI — and all three
drift independently.** The prompt's COMMON CORRECTIONS even says "InstanceOnPoints uses
scaleStart and scaleEnd" with no mention of the scale channel or PointsFromLists. Channels
(`t, index, row, col, group, scale, tangent`) are declared nowhere in NodeDefinitions —
they exist only as executor code comments.

## Finding 1 — Rule 5 is unenforced prose

The system prompt (agent.ts rule 5) already forbids exactly what this graph does:
"Placement: RELATIVE, never arithmetic. Translate between parts is forbidden; use Align."
glm-5.2 violated it wholesale and **nothing in the loop pushed back** — the geometry
report has no probe for it (`perturbationIssues: []`, integrity 1.0, no warnings).
Per the no-preorders methodology: a rule that isn't measured is a suggestion. The fix is
not more prose; it is a probe.

## Finding 2 — primitives have no geometric sockets

`Sphere.inputs: []` — same for Box/Cylinder/Cone. No base point, no orientation. Rotate
has no pivot input (angle + axis + isLocal only). This *forces* the
primitive→Rotate→Translate pattern and coordinate guessing; the model can't derive
placement even when it wants to. Translate already has the B9 `target: Point` socket —
the pattern exists, it just stops one layer too early.

## Recommended shifts (ranked)

### S1 (P0) — Measure what you mandate: placement-provenance probe
Add to the geometry report: `placements: { anchored: n, literal: m }` — count leaf
placements driven by Align/Point-socket/curve derivation vs. literal Translate/Rotate
expressions. Surface `anchoredPlacementRatio` and, when low on multi-part models, a
one-line nudge naming the top literal offenders. In-loop honest feedback, object-agnostic,
no recipes. (This export would read 0/9 and the model would have been told.)

### S2 (P0) — Geometric sockets on primitives; pivot on Rotate
Optional `center: Point` (+ optional `axis`/frame) input on every primitive, defaulting to
origin; optional `pivot: Point` + `axis` sockets on Rotate. This is B9 continued to its
conclusion. Payoff: collapses 3-node chains to 1 (this graph: ~27 → ~15 nodes), shrinks
the JSON the model must emit (reliability win), and makes geometry-from-geometry the
*shortest* path: `Centroid → Sphere.center`, `DivideCurve → point → Cylinder.center`.

### S3 (P1) — Promote channels to first-class, declared metadata
Declare per-point channels in NodeDefinitions so they appear in `condensedNodeLibrary()`
(model) and node tooltips (human). Then generalize per-instance binding beyond uniform
`scale`: at minimum `rotation` and non-uniform `scaleX/Y/Z` channels on InstanceOnPoints;
the fuller version is channel→param binding on the instanced shape. This turns the
comment's wish (per-point radius) from a hidden special case into a system.

### S4 (P1) — One capability manifest, three consumers
Generate the prompt's NODE LIBRARY text, UI tooltips/palette docs, and a
`docs/capabilities.md` from a single source: NODE_LIBRARY + declared channels + executor
capability annotations. Executor-only capabilities (like the scale channel) become
impossible to hide. Add a CI check: any executor that reads an input handle or channel not
declared in NodeDefinitions fails the build. That check would have caught this drift.

### S5 (P1) — Export completeness for the knowledge base
The export is good (graph + conversation + geometryReport + comment) but discards the most
diagnostic data of a reliability program:
- raw invalid model payloads + the repair prompts sent (currently just "attempt 1/3" notes)
- prompt/version provenance: git hash, skills+macro library hash, provider request options
  (was schema-constrained decode active on this Ollama call?)
- a render thumbnail (comments like "does not look bad" are unverifiable later)
- structured comments: keep free text, optionally add `{target: nodeId|null, tag, text}`
  so the experience store can mine them; allow multiple comments per export

### S6 (P2) — Point-array ergonomics
"One point → array of points" today requires Series+PointsFromLists or PointGrid/
DivideCurve. Consider point-space patterns (linear/circular on Point lists, mirroring
LinearPattern/CircularPattern for solids). Low urgency once S2 lands.

## Transport note

2 invalid JSON attempts on an empty-canvas turn suggests schema-constrained decoding was
not effective on this Ollama call (api.ts falls back `format: schema → 'json'` when the
request errors — check whether glm-5.2:cloud rejects structured outputs and whether that
fallback is logged). S5's provenance capture would answer this definitively next time.

## One-line summary

The system already contains much of what this session's comment asks for — the shifts that
matter are: probe the placement rule instead of preaching it (S1), give primitives
geometric sockets so derivation is the shortest path (S2), and make capability visible
from one source of truth so neither the model nor the owner can lose track of what exists
(S3/S4).

---

# Second batch (added later on Jul 20): two blackout sessions

Files: `c33d-graph-2026-07-20T06-03-26.json` (kimi-k2.7-code, "two times graph does not
give preview") and `c33d-graph-2026-07-20T06-08-48.json` (nemotron-3-ultra, "did not
provide graph with working 3d model"). Both exports have `geometryReport: NONE` — the
sessions ended in total blackout.

## The headline: conception is no longer the bottleneck in these sessions — recovery is

The nemotron graph is the strongest conception seen from any local-tier model to date: 6
coupled sliders, FOUR Align nodes, Mirror for nacelle symmetry, zero literal
part-to-part Translates. It is close to a textbook answer under the new constitution. And
it rendered nothing: "Engine fault (1/3, 2/3, 3/3) — retrying", then silence. The kimi
session died the same way (and its model twice explicitly, correctly, refused to mutilate
the design to work around an engine fault — good norm-following with no reward).

The A3/A4 respawn logic (useStore) handles kernel-class faults by respawn + replay ONCE —
built for transient poisoning. These sessions show the other failure class: a graph that
DETERMINISTICALLY crashes evaluation. Respawn replays the same graph, it faults again,
the agent's 3 exemptions burn out, and the turn ends with: no report, no partial meshes,
no culprit node, nothing in the export. The design assumed faults are noise; these
sessions prove faults are sometimes signal — and the system currently throws that signal
away.

## Reframe R-A (new P0): fault bisection — turn engine faults into node errors

When a full evaluation faults (and a respawned worker faults again on the same graph),
the system should bisect: re-evaluate progressively (per-leaf subgraphs, or binary search
over the node list) in a scratch worker until the faulting node is isolated. Output:
(a) a PARTIAL geometry report for every healthy leaf (the user sees 90% of the ship
instead of nothing), and (b) a normal node error: "node X crashes the geometry kernel —
rebuild this part differently (different node type or parameters)". That converts an
unrecoverable infrastructure blackout into a repairable design turn — the same
honest-feedback philosophy as S1, applied to crashes. Suspect list for these two graphs:
ScaleXYZ (mesh-sew rebuild) on a large tapered Box, feeding 4 Aligns + Mirror.

## Reframe R-B: compiler errors must not gaslight the model

kimi's transcript shows the IR compiler itself emitting malformed PointsFromLists wiring
(2 compile-error rounds), after which the model patched against a graph state it
misjudged — SIX consecutive "[Patch] removedEdgeIds matched NO edge" rounds referencing
compiler-minted ids (`wingPts_x_3`) for nodes that were never actually added. Fixes:
compile errors are the compiler's fault and must trigger deterministic
fallback/self-repair, never the model's repair budget; after a failed IR attempt the
system must state plainly "NONE of your nodes were added — current graph is: …"; and the
PointsFromLists emission path (ListConstant-of-formulas → x/y/z handles) needs a
regression test.

## Reframe R-C: sessions need an escalation channel

kimi correctly diagnosed a system bug and had nowhere to put that diagnosis — it wrote it
into its answer text and the session just ended. Give the agent a `report_system_issue`
tool whose payload lands in the export/knowledge base tagged as infra (not design). The
user's comment field said "does not give preview"; the agent knew *why* four turns
earlier. The knowledge base should capture the agent's diagnosis structurally.

## Reframe R-D: exports must capture terminal failure state

Both exports say `report: NONE` and nothing else. The export should always include:
lastEvaluationError, fault count and stage (initial / post-respawn), the last GOOD report
if any turn ever produced one, and (once R-A exists) the isolated culprit node. A
knowledge base of blackouts that don't say why they went black teaches nothing.

## Priority restack after batch 2

1. R-A fault bisection + partial reports (new P0 — blocks everything downstream: even
   perfect conception dies unseen)
2. S1 placement probe + S2 geometric sockets (landed this session — the conception layer)
3. R-B compiler-error honesty + R-D export failure capture (cheap, high knowledge yield)
4. S3/S4 channel declarations + capability manifest
5. R-C escalation tool
