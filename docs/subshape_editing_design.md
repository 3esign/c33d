# Sub-Shape Editing: "Blender Edit Mode" for an LLM in a Parametric Graph

*Design report, July 9 2026. Companion to `node_expansion_research.md` (Waves 2 & 4) and `proportional_coherence_plan.md`.*

## Goal

Let models subdivide geometry on demand, grab specific edges/faces/vertices, and extrude / move /
scale / rotate them — composably, like Blender edit mode — through a data toolset the model can
actually operate.

## The one decision everything hangs on: selection by query, never by index

Blender edit mode works because a human *sees* and *clicks*. A model can do neither, and C3D adds a
second, harder constraint: the graph re-evaluates every time a slider moves, and **OCCT re-derives
face/edge indices on every rebuild**. Selecting "edge 7" is meaningless after the upstream radius
changes. This is the **topological naming problem** — the bug class that plagued FreeCAD for a decade
and took a five-phase, multi-year effort to fix
([FreeCAD wiki](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_naming_problem.md),
[Ondsel post-mortem](https://www.ondsel.com/blog/toponaming-problem-is-history/)). Systems that survive
it either build elaborate persistent-naming machinery (SolidWorks, Fusion, FreeCAD's fix) or sidestep
it with **declarative selectors re-resolved at every evaluation** (CadQuery's `">Z"`, replicad's
`FaceFinder`/`EdgeFinder`). For LLM-authored parametric graphs the choice is forced: **selectors**.
A query is text (LLM-native), self-repairing under parameter change (re-runs each evaluation), and
auditable by the perturbation test from the proportional-coherence plan.

Consequences:

- `VariableFillet`'s `edgeIndex` param is the anti-pattern — deprecate it in favor of selector input.
- Indices allowed only as a last-resort predicate, with a validation warning, and always combined
  with a stable sort (by centroid, not internal OCCT order).
- A `Selection` is **not a stored list of elements** — it is a *query object* `(sourceNodeId, domain,
  predicate)` evaluated against the current shape each run. This is exactly Blender Geometry Nodes'
  "selection is a field, not a set" redesign — and GN is the proof that edit-mode operations
  (Extrude Mesh, Scale Elements, Delete Geometry all take a selection field input) can be fully
  parametric.

## The selector language (LLM-facing)

One compact query grammar used by SelectFaces / SelectEdges / SelectVerts across both kernels.
Predicates, combinable with `and`/`or`/`not`:

| Predicate | Example | Notes |
|---|---|---|
| direction | `normal ~ +Z` (faces), `parallel X` (edges) | tolerance param; CadQuery's workhorse |
| extremity | `max Z`, `min X` | "the top face", "the leftmost edge" |
| position/box | `center in box(...)`, `center.z > H*0.8` | box coords may be **formulas of sliders** |
| size | `area > A*0.1`, `length < L*0.05` | relative thresholds, per proportional-coherence rules |
| geometry kind | `planar`, `cylindrical`, `convex edge`, `boundary` | fillet/chamfer prefiltering |
| adjacency | `adjacent to <selection>`, `grow 1`, `boundary of <selection>` | region building |
| nearest | `nearest to point(x,y,z)` / `nearest to node("head")` | anchor-relative, scale-safe |
| index | `index 3 by center.x` | warned; sorted deterministically |

Every threshold and coordinate accepts the existing inline-formula syntax over slider names — a
selection like `faces where center.z > bodyLength*0.4` stays correct at any scale, which is what makes
sub-shape edits compatible with the perturbation test.

**Selection percept (the model's replacement for eyes).** Every selection node writes into the
geometry report: matched count, per-element centroid/area-or-length/normal digest, and a warning when
a query matches 0 or "everything". The repair loop then reads
`"select_top: matched 1 face, center [0,0,20], area 314"` and can verify it grabbed what it meant —
the machine equivalent of seeing the highlight in Blender. On perturbation runs, re-check match
counts: a selection that matches 3 edges at default and 7 at 1.5× is flagged as fragile.

## Two kernels, one vocabulary

B-Rep (replicad/OCCT) is precise but its local operations are rigid; true vertex-pushing edit mode is
a mesh concept. Run both, with the same selection grammar, and let the model cross via `ToMesh`/`ToSolid`
(both halves already exist internally — tessellation and `solidFromDeformedMesh`).

### Tier A — B-Rep local operations (precision edits)

| Node | Kernel basis | Cost |
|---|---|---|
| `SelectFaces` / `SelectEdges` → Selection | replicad FaceFinder/EdgeFinder + custom predicates | M |
| `SelectionCombine` (union/intersect/subtract/grow/boundary) | set ops over resolved elements | S |
| `ExtrudeFace` (push/pull, fuse or cut by sign) | `BRepFeat_MakePrism` — purpose-built for local protrusion/depression on an existing body ([OCCT refman](https://dev.opencascade.org/doc/occt-7.5.0/refman/html/class_b_rep_feat___make_prism.html)); needs adding to the custom opencascade.js build (bindings auto-generate; doc §6 verified builds stay ~2.4 MB) | M |
| `OffsetFaces` (thicken/inset selected faces) | `BRepOffset_MakeOffsetShape` partial offset; flaky — surface OCCT status codes through `explainNullGeometry` | M/L |
| `SplitFace` / `ImprintCurve` (subdivide a face with a sketch/curve — the B-Rep "subdivide") | `BRepFeat_SplitShape` / `BRepAlgoAPI_Splitter` (already on the Wave-2 include list) | M |
| `Fillet`/`Chamfer`/`Shell` accept Selection | replaces VariableFillet's axis/index params | S–M |
| `DeleteFaces` + heal | `ShapeFix` after face removal; defeaturing | M |
| `TransformFaces` (move/rotate a face with neighbors re-solved) | OCCT has no robust general "tweak" — **do not build**; emulate via SplitFace + ExtrudeFace, or send the model to Tier B | — |

### Tier B — Mesh edit mode (organic edits, true Blender feel)

Mesh becomes a first-class wire type (Wave 4) with **per-domain channels** (vertex/edge/face), and
selection = boolean channel. This is the "advanced data management toolset": Set/Capture/Remap
channels, selections as data flowing on the geometry itself.

| Node | Basis | Cost |
|---|---|---|
| `MeshSelect` (domain, query — same grammar, plus curvature & formula over `x/y/z/normal/index`) | trivial per-element evaluation; writes bool channel | S |
| `SubdivideMesh` (simple / Loop / Catmull-Clark, optionally restricted to selection) | [three-subdivide](https://github.com/stevinz/three-subdivide) (Loop, BufferGeometry-native) or [gl-catmull-clark](https://github.com/Erkaman/gl-catmull-clark); selection-restricted = split then merge | M |
| `ExtrudeMesh` (faces/edges, offset distance or formula, individual-vs-region) | direct implementation (Blender GN Extrude Mesh semantics: side quads connect region boundary) | M |
| `TransformElements` (translate/rotate/scale selected verts/edges/faces; pivot = selection centroid; **proportional falloff radius** — Blender's proportional editing, the single biggest organic-modeling unlock) | per-vertex weight = falloff(dist to selection); reuses deformation helpers | M |
| `MergeByDistance`, `DeleteElements`, `SeparateByChannel`, `FlipNormals` | bookkeeping ops | S each |
| `SetChannel` / `CaptureChannel` (store measured data — curvature, dist-to-anchor — as named channel for downstream selects/falloffs) | the Houdini attribute idiom, per node_expansion doc §2 | S |
| `MeshBoolean` | manifold-3d (already planned; also the ToSolid fallback when sewing fails) | M |

Chain example the model can actually author, all parametric:
`ToMesh(head) → MeshSelect(faces, "normal ~ +X and center.z > headH*0.6") → ExtrudeMesh(offset="headLen*0.15") → SubdivideMesh(CatmullClark, 2) → TransformElements(scale=1.2, falloff="headLen*0.3") → ToSolid` — a brow ridge, editable by slider forever.

## LLM ergonomics — what makes this operable rather than just present

1. **Verbs mirror Blender vocabulary** (`select`, `extrude`, `subdivide`, `merge`) — models have deep
   priors from Blender/Maya tutorials; naming to those priors reduces hallucinated APIs (same argument
   as Dynamo's Create/Action/Query discipline in the node-expansion doc).
2. **Select → inspect → act protocol** in the system prompt: after every selection node, read the
   selection percept *before* attaching the operation. Budget-wise this is free — it rides the
   existing geometry-report turn.
3. **Sequential ops, not mega-nodes.** "Combine those operations" = chains of small nodes, exactly the
   construction-sequence prompting that Text2CAD-Bench found beats appearance description on complex
   parts. The DSL (Phase 0 of the roadmap) matters double here — edit-mode chains are long, and
   one-line-per-op text is where Proc3D got 0%→89% compile rates.
4. **AIDL's lesson** ([arXiv 2502.09819](https://arxiv.org/pdf/2502.09819)): their solver-aided CAD
   language showed LLMs handle *referencing previously built geometry* far better when references are
   semantic (named features + spatial queries) than when they must track construction history. Selector
   queries + node names ("nearest to node('head')") are exactly that.
5. **Viewport is the human side**: clicking a face in the UI should emit the *query that uniquely
   matches it* (auto-synthesized from normal/position/area), inserted as a SelectFaces node. Humans and
   the model then speak one language, edits stay parametric, and clicked selections survive slider
   changes — Blender's UX without Blender's destructiveness.

## What NOT to build

- **Persistent topological naming** (FreeCAD-style ID tracking through rebuilds) — multi-year effort,
  unnecessary once selections are queries.
- **General B-Rep face "tweak"/drag** — OCCT can't re-solve neighbors robustly; the mesh tier covers it.
- **Stored element-index selections in saved graphs** — they rot; only queries persist.
- **NURBS control-point surface editing** — per node-expansion doc, high complexity, poor LLM usability;
  SubdivideMesh + TransformElements-with-falloff covers the organic use cases.

## Sequencing (slots into the existing roadmap)

1. **Selection type + SelectFaces/SelectEdges + percepts + Fillet/Chamfer/Shell take selections** —
   extends Wave 2; immediately retires VariableFillet's index param. Smallest step, big payoff.
2. **ExtrudeFace + SplitFace** (custom OCCT build additions: `BRepFeat_MakePrism`, `BRepFeat_SplitShape`,
   `BRepAlgoAPI_Splitter`) — B-Rep push/pull and face subdivision.
3. **Mesh wire type + MeshSelect + SubdivideMesh + ExtrudeMesh + TransformElements + channels** —
   the edit-mode core (fold into Wave 4, ahead of SDF/Lattice).
4. **MergeByDistance / Delete / Separate / Capture + viewport click-to-query.**

Each step ships with the standard kit: validation contracts (0-match/all-match selection errors, mesh
manifoldness check before ToSolid), selection percepts in the geometry report, perturbation-test
coverage of selections, 3–5 success-library exemplars, and eval prompts ("make a cube, subdivide its
top face 3×3, extrude the center cell", "give the bee's head a snout by extruding the front faces").

## Sources

- [FreeCAD topological naming problem](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Topological_naming_problem.md) · [Ondsel: toponaming fix history](https://www.ondsel.com/blog/toponaming-problem-is-history/) — why index references rot.
- [OCCT BRepFeat_MakePrism](https://dev.opencascade.org/doc/occt-7.5.0/refman/html/class_b_rep_feat___make_prism.html) · [OCCT Modeling Algorithms guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) — local protrusion/depression, splitting.
- [AIDL: solver-aided hierarchical language for LLM CAD](https://arxiv.org/pdf/2502.09819) — semantic references beat history tracking for LLMs.
- [three-subdivide](https://github.com/stevinz/three-subdivide) · [gl-catmull-clark](https://github.com/Erkaman/gl-catmull-clark) — browser subdivision implementations.
- Blender Geometry Nodes (Extrude Mesh / Scale Elements selection-field design) — the working proof that edit mode can be a parametric dataflow.
- `docs/node_expansion_research.md` §2–§6 — data-model evidence (attributes over trees), Selection wire type, custom opencascade.js build feasibility, manifold-3d.
