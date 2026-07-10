# Node System Expansion Research

**Grasshopper · Dynamo · Houdini SOPs · Blender Geometry Nodes → C3D**
*July 9, 2026 — deep-research report with adversarially verified claims*

---

## Executive summary

C3D's 40 nodes already cover the solid-modeling core (primitives, booleans, fillets, loft/revolve/sweep, patterns, basic deformers). Compared against the four mature ecosystems, the gaps are not "more primitives" — they are **three structural capabilities** that every mature system converged on independently:

1. **First-class points, vectors, planes, and curves on wires.** In all four systems, the highest-leverage nodes (Copy to Points, Divide Curve, Evaluate Surface, attractors) operate on point/plane/curve data flowing between nodes. C3D wires carry only `Solid` and `number`, so this entire composition layer is inexpressible.
2. **A per-element data mechanism (attributes/fields), not data trees.** The evidence is unusually one-sided: Grasshopper's data trees are the documented pain point of that ecosystem, while Houdini's attribute model measured "markedly better" in the only controlled comparison, and Blender rebuilt its system around fields for exactly the robustness reasons that matter for LLM-authored graphs.
3. **A node-making system**: an inline sandboxed code node for one-offs plus versioned, named subgraph definitions (an upgrade of the existing Macro) — the Houdini wrangle→HDA escalation path, which practitioners treat as the extensibility gold standard.

The recommended sequence: **Wave 1** (point/vector/plane/curve types + ~14 nodes that use them), **Wave 2** (attribute-driven variation: attractors, remap, per-element selections), **Wave 3** (code node + node definitions), **Wave 4** (SDF/mesh sub-kernel via manifold-3d for organic robustness), **Wave 5** (solvers: relaxation, shortest path, growth). Full node specs, costs, and kernel feasibility below.

---

## 1. Where C3D stands vs. the four ecosystems

| | C3D | Grasshopper | Dynamo | Houdini SOPs | Blender GN |
|---|---|---|---|---|---|
| Node count | 40 | ~1,000 stock | ~500 core | ~600 | ~250 |
| Wire types | Solid, number | 20+ (point, vector, plane, curve, surface, brep, mesh, domain…) | geometry + lists of any | one: geometry (attributes inside) | geometry + typed fields |
| Per-element data | — | data trees (paths) | nested lists + lacing | attributes on points/prims/verts/detail + groups | fields + anonymous attributes |
| Iteration | list auto-expand → Compound | implicit tree matching | implicit lacing | explicit for-each | implicit per-element (fields), repeat zones |
| User-defined nodes | Macro (subgraph + exposed params) | clusters + C#/Python script components | custom nodes + Python | HDAs + VEX wrangles | node groups (no code node) |
| Kernel | Replicad/OpenCascade.js B-Rep | Rhino NURBS B-Rep | ProtoGeometry | mixed (polygons, VDB, NURBS) | meshes/curves/volumes |

Notably, C3D is **ahead** of the stock versions of these tools in a few places: `Align` (bbox-relative placement — Grasshopper has no stock equivalent), inline formula strings referencing sliders by name (cleaner than GH expression wiring), and the verify-before-store knowledge loop (none of the four has anything comparable).

### What the ecosystems agree on: the universal power primitives

Cross-referencing SideFX's curated "bread and butter" SOP set (18 nodes), practitioner 80/20 guides for Grasshopper, the Dynamo Primer's frequently-used list, and Blender GN fundamentals, the same nine capabilities recur in every system:

1. **Copy/instance onto points** (Houdini Copy to Points ≈ Blender Instance on Points ≈ GH Orient-to-planes) — one node turns any geometry × any point set into a populated design. Repeatedly called "the most useful node" in Houdini practice.
2. **Scatter/populate** (Scatter ≈ Distribute Points on Faces ≈ Populate Geometry) — converts surfaces into point domains everything else consumes. C3D's `ScatterOnSurface` fuses scatter+copy into one node; splitting them is what unlocks composition.
3. **Per-element data driver** — vary every copy by data, not parameters (attributes/fields/attractor idioms).
4. **Remap** (GH Remap Numbers ≈ Blender Map Range ≈ VEX `fit()`) — the universal glue between measured data and driven parameters.
5. **Divide/evaluate along a parameter** — Divide Curve, Evaluate Curve/Surface, Perp Frames.
6. **Booleans** (present everywhere; C3D has this).
7. **Selection as a first-class object** (Houdini groups, Blender selection fields, GH Dispatch/Cull) — restricting any operation to a subset multiplies every other node. C3D's `FilterFaces` is a fixed-function hint of this.
8. **A code escape hatch** (wrangle, Code Block, GH scripting) — one node covering the long tail the taxonomy misses.
9. **Inspection nodes as peers** (Panel, Watch3D, Visualize, Viewer) — for C3D the analogue is machine-readable inspection (measure/report nodes the LLM can read), which fits the existing geometry-report loop.

Taxonomy pattern worth copying: Dynamo organizes every category by **Create / Action / Query** verbs. Adopting that as node-naming discipline (`Curve.Divide`, `Surface.Evaluate`, `Solid.Measure`) makes the vocabulary itself predictable for an LLM — names become an API the model can guess correctly.

---

## 2. The data-model decision (make this before adding many nodes)

### Evidence

- **Grasshopper data trees are the documented failure mode of that paradigm.** Mismatched structures don't error — GH silently "repairs" by duplicating data, producing wrong geometry with no diagnostic. Practitioner guidance is to *avoid the automatic matcher entirely* and manually align structures; novices destroy stream correspondence with reflexive Flatten. Scripts restructure trees 2–10 times per definition.
- **The only controlled comparison found** (Janssen, eCAADe 2014 — same roof task built in GH, Dynamo, GenerativeComponents, Houdini; verified against the PDF) concluded Houdini's graphs were "markedly better": fewer links because per-element data is *embedded in the geometry as attributes*, and explicit for-each instead of implicit tree matching, whose results the paper calls "very difficult to predict." (Caveat the paper itself adds: individual Houdini nodes are complex for novices.)
- **Blender's fields redesign rationale** (verified quote from the proposal): "Compared to lists, fields don't become incompatible when geometry changes in most cases" — with the acknowledged cost that fields are harder to debug than stored attributes. Blender essentially adopted Houdini's attribute model but with typed wires instead of stringly-typed attribute names.

### Why this matters double for LLM-authored graphs

- **Silent structural failure is the worst failure mode for an LLM.** A human notices "weird results" in the viewport; the model needs hard, local errors. GH's matcher never errors. An attribute contract ("input geometry must carry attribute X on domain Y") is a checkable pre/postcondition that slots directly into `graphValidation.ts` and the retry loop.
- **Correctness stays local.** In tree models, whether a node is right depends on the branch structure of *every* upstream input — long-range reasoning models do unreliably. In attribute models each node's contract is local.
- **Robustness to edits.** LLM workflows are iterative; inserting a node mid-graph rarely breaks downstream selections in attribute/field models, and routinely does in tree models.
- **Smaller graphs** = fewer tokens = fewer errors. No graft/flatten/shift boilerplate, whose per-socket settings are exactly the kind of subtle state models mis-set.

### Recommendation for C3D

**Do not build data trees.** Adopt a hybrid:

- **Typed object wires** for whole-object composition (current model, extended with new types — §3).
- **Attributes riding on geometry** for per-element data: a `PointSet` carries named per-point channels (`scale`, `rotation`, `t`, `dist`, `normal`, arbitrary names); nodes that consume point sets read channels by name with a declared default. This is Houdini's `pscale`/`orient` convention, which is what makes Copy to Points a one-node powerhouse.
- **Keep list auto-expansion** (current Translate/Rotate behavior) but make length mismatch a **hard validation error**, never silent repair. Where broadcasting is intended, require an explicit `Repeat`/`Cycle` node.
- **Extend inline formulas into per-element expressions**: inside point-set-consuming nodes, allow formula strings over element variables (`dist`, `t`, `index`, `x/y/z`, `normal`) — e.g. Copy to Points with `scale = "1 - dist/40"`. This reuses the existing safe expression parser and is C3D's equivalent of a VEX one-liner without a new wire type.

---

## 3. New wire types

| Type | Contents | Why |
|---|---|---|
| `Point` / `Vector` | xyz triple (unit-agnostic) | prerequisite for everything below |
| `Plane` | origin + x/y/z axes | the "orientation currency" — most GH components accept a plane; frames from curves/surfaces flow here |
| `Curve` | OCCT wire/edge handle (B-Rep native) | unlocks the entire curve toolkit; `Sketch` currently locks 2D profiles inside one node as SVG strings |
| `PointSet` | ordered points + named per-element channels + optional per-point frames | the attribute carrier (§2) |
| `Mesh` | indexed triangle mesh (tessellated) | the mesh/SDF sub-kernel boundary (§6); already exists internally in `solidFromDeformedMesh` |
| `Selection` | face/edge/vertex subset of a specific Solid | generalizes `FilterFaces` into a reusable object any feature node accepts |

`Surface` can remain implicit (a face of a Solid addressed via Selection) to avoid type explosion; revisit if paneling workflows demand standalone surfaces.

---

## 4. Recommended new nodes

Legend — **Cost**: S (≤1 day, native Replicad/OCCT), M (days, some kernel work or custom OCCT build additions), L (week+, new subsystem). **Power**: ★–★★★ expressive-power gain per node. Feasibility notes reference §6.

### Wave 1 — Points, curves, frames (the composition layer)

| Node | Inputs → outputs (key params) | Cost | Power |
|---|---|---|---|
| `Point` | x, y, z → Point | S | ★★ |
| `VectorMath` | a, b → Vector/number (add, sub, scale, dot, cross, unit, length, angle) | S | ★★ |
| `ConstructPlane` | origin, normal (or 3 points) → Plane | S | ★★ |
| `Line` | start, end → Curve | S | ★★ |
| `Arc` / `CircleCurve` | plane, radius, angles → Curve | S | ★★ |
| `PolylineCurve` | PointSet, closed? → Curve | S | ★★ |
| `SplineCurve` | PointSet, interpolate?, closed?, tangents → Curve (`GeomAPI_PointsToBSpline` / Replicad `smoothSpline`) | M | ★★★ |
| `DivideCurve` | Curve, count/length → PointSet (channels: `t`, `tangent`; frames) | M | ★★★ |
| `EvaluateCurve` | Curve, t → Point, tangent, Plane (perp frame) | S | ★★★ |
| `OffsetCurve` | Curve, distance, corner style → Curve (Replicad 2D offset; flag self-intersection as validation error) | M | ★★ |
| `CopyToPoints` | shape, PointSet → Compound (reads `scale`/`rotation` channels or per-element formulas; orients to frames) | M | ★★★ |
| `PopulateSurface` | Solid/face, count, seed, relax-iterations → PointSet with normals (generalizes ScatterOnSurface; relax ≈ blue noise) | M | ★★★ |
| `SweepAlongCurve` | profile (Sketch/Curve), rail Curve → Solid (Replicad `genericSweep` / `BRepOffsetAPI_MakePipeShell`; surface OCCT failure statuses to the repair loop) | M | ★★★ |
| `ClosestPoint` | PointSet, target (Point/Curve/Solid) → PointSet + `dist` channel | S | ★★★ |
| `Remap` | value/list/channel, from-domain, to-domain, clamp?, ease (linear/smooth/exp) → same shape | S | ★★★ |

`ClosestPoint` + `Remap` + `CopyToPoints` is the complete attractor idiom — three generic nodes replacing what would otherwise be a dozen specialized "graded pattern" nodes. This trio composes with existing `LinearPattern`/`CircularPattern` (emit their instance positions as an optional PointSet output) and with `PlaceOnVertices`.

### Wave 2 — Selections, features, interrogation

| Node | Inputs → outputs | Cost | Power |
|---|---|---|---|
| `SelectFaces` / `SelectEdges` | Solid, predicate (direction, size, curvature, box, index, formula) → Selection (generalizes FilterFaces) | M | ★★★ |
| `SelectionBoolean` | A, B → union/intersect/subtract of Selections | S | ★ |
| Fillet/Chamfer/Shell accept `Selection` input | (upgrade, not new node) — variable-radius fillet via per-edge channel later | M | ★★★ |
| `SplitSolid` | Solid, cutting plane/Solid → Solid list (`BRepAlgoAPI_Splitter`) | M | ★★ |
| `Section` | Solid, Plane → Curve(s) (`BRepAlgoAPI_Section`) — slicing, ribs, waffle structures | M | ★★★ |
| `ProjectCurve` | Curve, Solid, direction → Curve on surface | M | ★★ |
| `Measure` | Solid → volume, area, bbox, centroid (machine-readable; feeds geometry report + Expression inputs) | S | ★★ |
| `DistanceMeasure` | A, B → min distance, closest points | S | ★ |
| `BoundingBox` | Solid → Solid (box) + dims | S | ★ |
| `Repeat` / `Cycle` | list, count → list (explicit broadcast; enables the hard-error matching rule) | S | ★ |
| `SortByChannel` / `FilterByChannel` | PointSet/list, channel, predicate → subset (Dispatch/Cull equivalent) | S | ★★ |

### Wave 3 — Node-making system (§5) — `CodeNode`, `DefineNode`, versioning

### Wave 4 — Mesh/SDF sub-kernel (§6)

| Node | Inputs → outputs | Cost | Power |
|---|---|---|---|
| `ToMesh` / `ToSolid` | Solid ↔ Mesh (tessellate / sew — both halves already exist internally) | S | ★★ |
| `MeshBoolean` | Mesh, Mesh, op → Mesh (manifold-3d WASM: guaranteed-manifold booleans; the robustness fallback when B-Rep booleans fail — auto-retry candidate for the repair loop) | M | ★★★ |
| `SmoothMesh` | Mesh, iterations, method (Laplacian/Taubin) → Mesh | M | ★★ |
| `Remesh` | Mesh, target edge length / voxel size → Mesh (SDF resample; "fix and fuse anything" — no production OpenVDB WASM port exists, so implement via JS SDF grid or manifold's `levelSet`) | L | ★★★ |
| `SDFPrimitive` / `SDFCombine` / `SDFMesh` | implicit field nodes: primitives-as-fields, min/max/smooth-min blend, offset, shell; `SDFMesh(field, bounds, resolution)` → Mesh (marching cubes / manifold levelSet) | L | ★★★ |
| `Lattice` | body (Solid/Mesh), cell type (gyroid/schwarz/grid), cell size, wall thickness (constant or channel-driven) → Mesh (nTop-style TPMS; huge organic/engineering design space) | L | ★★★ |
| `DeformByField` | Solid/Mesh, formula over x/y/z → deformed (generalizes Bend/Twist through the existing tessellate→deform→re-sew path; one node subsumes taper, bulge, wave, noise displacement) | M | ★★★ |

### Wave 5 — Solvers (each is a small node count with a disproportionate unlock)

| Node | Inputs → outputs | Cost | Power |
|---|---|---|---|
| `RelaxMesh` | Mesh/PointSet, goals (anchors, target edge length, on-surface, planarize, inflate pressure), iterations → relaxed geometry (Kangaroo-lite: projective relaxation; even paneling, tensile forms, minimal surfaces) | L | ★★★ |
| `ShortestPath` | Curve network, start, end → Curve (A* over curve-graph topology; the reusable primitive is `CurvesToGraph`) | M | ★★ |
| `GrowCurve` | Curve, iterations, collision radius, max segment, bounds → Curve (differential growth: resample + separate + smooth loop; coral/labyrinth ornament) | M | ★★ |
| `NoiseField` | type (Perlin/Simplex), scale, seed → field usable as channel/deform input (Houdini Mountain equivalent) | M | ★★ |

Deliberately **excluded**: data-tree nodes (Graft/Flatten/Simplify — §2), full physics simulation, NURBS *surface* editing nodes (control-point-level surface modeling — high complexity, low LLM usability), volumetric rendering. Reaction-diffusion is deferred: high wow-factor but needs a simulation-loop primitive; `GrowCurve` covers the adjacent design space more cheaply.

---

## 5. Node-making system: how the AI authors new nodes

The Houdini pattern — inline **wrangle** for one-offs, **HDA** for matured tools, with a smooth escalation path between them — is the design to copy. C3D's Macro is already half of the HDA; what's missing:

**1. `CodeNode` (the wrangle equivalent).** A sandboxed JS kernel:

```
kernel(inputs: {solids, curves, points, numbers}, api) → {solid | mesh | pointset | numbers}
```

- Pure function: no I/O, no graph access, no global state; time/memory budget; deterministic. Trivially enforceable (isolated realm, frozen API surface) — LLM-authored code safe by construction.
- `api` = curated Replicad surface + PointSet/channel helpers + the expression math library.
- Typed, **coercing** ports (Grasshopper's type-hint lesson): a port declares type + coercion rule (number→vector broadcast, curve→points sample, solid→mesh tessellate) plus access level (item/list), so kernels stay scalar and the executor handles mapping.
- Two escape-hatch modes: element mode (runs per point of a PointSet — a VEX wrangle) and object mode (runs once).

**2. `DefineNode` (the HDA equivalent) — upgrade Macro with:**

- **Namespaced immutable versions**: `user::gearProfile::1.2`. Instances pin a version; edits create a new version; no silent mutation of existing graphs (Houdini's sync model minus its no-diff/merge pain; avoids Dynamo's embedded-script rot by storing kernel source once in the definition).
- **Parameter promotion**: any internal param liftable to the definition's interface with auto-binding; defaults baked into the definition ("copy defaults from node").
- **Registration gate, matching verify-before-store**: typecheck ports → dry-run on probe inputs → geometry report non-null and sane → vision check on a render → only then registered into the library and few-shot retrieval index. Failed definitions return diagnostics to the authoring loop.
- Later: **dive targets** — a locked definition exposing one sanctioned editable sub-region (AI scaffolds a template, user or later AI turn fills the slot).

**3. LLM-facing representation.** The strongest single result found: **Proc3D** (arXiv 2601.12234, verified) — LLMs emitting Blender's native node serialization achieved a **0% compile rate**; generic Blender Python ~30%; their compact one-line-per-node text format achieved **89%** at 9s vs 62s generation, with 4–10× fewer tokens. Every successful text-to-CAD effort (Zoo's KCL, CadQuery benchmarks, CAD-Recode) independently converged on **executable text programs, not serialized graphs**. This directly supports the planned incremental-ops/DSL layer (see `c3d-parameter-layer` memory): a compact line-per-node IR that compiles deterministically to the graph, in which the AI also authors `DefineNode` bodies. Sequencing note: **the DSL is the prerequisite** — every node added before it slightly worsens raw-JSON reliability, so land the IR before or alongside Wave 1.

Supporting evidence on vocabulary size: Text2CAD-Bench (verified) chose CadQuery because method-chaining "naturally aligns with natural language descriptions"; sequence-style prompts raised invalidity ~1.5–1.8× at L1–L2 versus geometric descriptions, and frontier-model invalidity hits 68–74% on complex (L3) parts — while the fine-tuned Text2CAD model achieved the *lowest* invalidity (~2–11%) but the *worst* geometric accuracy (near-zero IoU). Lessons: (a) executability and geometric fidelity are independent axes — C3D's vision-verification gate attacks exactly the "valid but wrong" failure mode the literature identifies; (b) for complex parts, plan prompts around **construction sequence**, not appearance; (c) a moderate orthogonal vocabulary (dozens of composable ops) beats both tiny primitive sets and huge specialized ones.

---

## 6. Kernel feasibility map

**Native OCCT/Replicad (Waves 1–2):** Replicad already exposes `genericSweep` (PipeShell with law functions, auxiliary spine, transition modes), loft with `ruled`, `makeOffset` (3D shape offset), edge/face/corner finders for fillet/chamfer, 2D booleans/offsets, STEP export (all verified against replicad.xyz API docs). OCCT classes not yet in the custom build (`BRepAlgoAPI_Section`, `BRepAlgoAPI_Splitter`, `GeomAPI_PointsToBSpline`, `BRepProj`, `ShapeFix_*`) are includable — opencascade.js bindings are auto-generated from OCCT headers; custom builds run ~2.4 MB compressed vs ~9.1 MB for the full build (verified). Known risk: OCCT pipe-shell and offset ops are the flakiest kernel areas — surface their failure statuses (`PipeNotDone`, etc.) through `explainNullGeometry` so the repair loop gets actionable errors instead of nulls.

**Mesh side (Wave 4):** `manifold-3d` npm WASM provides guaranteed-manifold mesh booleans (verified) — the robustness fallback for B-Rep boolean failures and the base for `MeshBoolean`/`Remesh`/`SDFMesh` (its `levelSet` meshes arbitrary SDF functions). **No production OpenVDB WASM port exists** (verified — only JS proofs-of-concept), so VDB-style workflows must be built on JS SDF grids or manifold, not ported. `three-bvh-csg` is faster but non-manifold — not suitable as the primary.

**Precedent for the GTransform gap:** the existing tessellate→deform→re-sew path is exactly how `DeformByField` generalizes; keep deformed results as `Mesh` when re-sewing fails, now legal since Mesh is a first-class wire type.

---

## 7. Prioritized roadmap

| Phase | Contents | Rationale |
|---|---|---|
| 0 | Compact DSL/IR for graph authoring (+ hard-error list matching) | Proc3D 0%→89%; prerequisite multiplier for everything after |
| 1 | Wave 1 types + nodes (Point/Vector/Plane/Curve/PointSet; DivideCurve, CopyToPoints, PopulateSurface, ClosestPoint, Remap, SweepAlongCurve, splines) | The composition layer; attractor idiom; ~15 nodes ≈ doubles expressible design space |
| 2 | Wave 2 (Selections, Section, Split, Measure, sort/filter) | Feature-modeling depth; machine-readable interrogation feeds the report loop |
| 3 | Wave 3 (CodeNode + DefineNode + registration gate) | Long-tail coverage; AI grows its own library under verify-before-store |
| 4 | Wave 4 (Mesh type, manifold-3d booleans, DeformByField, then SDF/Lattice) | Organic robustness; aligns with geometry/deformation-over-polish priority |
| 5 | Wave 5 (RelaxMesh, ShortestPath, GrowCurve, NoiseField) | Form-finding and generative pattern space |

Each phase should ship with: validation contracts in `graphValidation.ts`, 3–5 few-shot exemplars in the success library, eval prompts in `docs/test_prompts.md`, and geometry-report coverage — the infrastructure that made the July fixes stick.

---

## 8. Sources

**Node taxonomies:** SideFX SOP collection — sidefx.com/learn/collections/houdini-nodes/ · Dynamo Primer library — primer2.dynamobim.org/3_user_interface/2-library · Grasshopper 80/20 guide — cademy.xyz/learn/your-grasshopper-3d-learning-path · Blender GN manual — docs.blender.org/manual/en/latest/modeling/geometry_nodes/ · artisticrender.com/blender-geometry-nodes-fundamentals-guide/

**Data models:** Janssen, "Visual Dataflow Modelling: Some thoughts on complexity," eCAADe 2014 — papers.cumincad.org/data/works/att/ecaade2014_169.content.pdf · Lucke, "Fields and Anonymous Attributes" proposal — devtalk.blender.org/t/fields-and-anonymous-attributes-proposal/19450 · CodedShapes data-tree guide — codedshapes.com/p/a-practical-guide-to-data-trees-in · SideFX attributes — sidefx.com/docs/houdini/model/attributes.html · Dynamo lacing — primer.dynamobim.org/06_Designing-with-Lists/6-1_whats-a-list.html

**Node-making:** Rhino scripting-component guides — developer.rhino3d.com/guides/scripting/scripting-gh-csharp/ · cgwiki HDA — tokeru.com/cgwiki/HoudiniHDA.html · HDA namespaces — sidefx.com/docs/houdini/assets/namespaces.html · Dynamo custom nodes — primer2.dynamobim.org/6_custom_nodes_and_packages

**Curve/surface & advanced:** Grasshopper Surface index — grasshopperdocs.com/addons/grasshopper-surface.html · Kangaroo2 Solver — grasshopperdocs.com/components/kangaroo2/solver.html · VDB from Polygons — sidefx.com/docs/houdini/nodes/sop/vdbfrompolygons.html · nTop gyroid — support.ntop.com/hc/en-us/articles/360035831653 · libfive — github.com/libfive/libfive · ShortestWalk — food4rhino.com/en/app/shortest-walk-gh · attractors — hopific.com/attractor-points-grasshopper/ · differential growth — thedifferentdesign.com/differential-growth/

**LLM×CAD & kernel feasibility:** Proc3D — arxiv.org/abs/2601.12234 · Text2CAD-Bench — arxiv.org/abs/2605.18430 · Zero-to-CAD — arxiv.org/pdf/2604.24479 · ShapeCraft — arxiv.org/html/2510.17603 · Zoo KCL — zoo.dev/research/introducing-kcl · Replicad — replicad.xyz/docs/api/ + github.com/sgenoud/replicad · opencascade.js sizes/custom builds — ocjs.org/docs/getting-started/file-size · manifold — github.com/elalish/manifold · three-bvh-csg — github.com/gkjohnson/three-bvh-csg

*Verification notes: all bolded quantitative claims were checked against primary sources by an adversarial pass. Two claims from initial research were corrected before inclusion: a "79 Blender nodes" figure attributed to Proc3D (not in the paper — removed) and an overstated "2–3× invalidity" reading of Text2CAD-Bench (actual: ~1.5–1.8× at L1–L2, and it concerns prompt style, not output format).*
