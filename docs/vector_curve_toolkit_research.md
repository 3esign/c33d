# Point / Vector / Curve / Measurement Toolkit — Deep Feature Inventory

*Research report, July 9 2026. Companion to `node_expansion_research.md` (expands Wave 1 into a full
catalog) and `subshape_editing_design.md` (Selections supply edges-as-curves).*

C3D today has **zero** point/vector/curve tooling: no Point type, no midpoint, no centroid, no curve
evaluation, no distance measurement (verified against the 42 nodes in `NodeDefinitions.ts`). Below is
the full candidate catalog, cross-referenced from Grasshopper's Vector/Curve tabs, Dynamo's geometry
API, Blender GN utilities, and what OCCT already provides nearly for free.

**Status legend:** ➕ new proposal · 🔶 already sketched in node_expansion Wave 1/2 · ⚙ = OCCT gives it
almost directly (class named). **LLM value** = how much it improves the *model's* ability to build
correct geometry (not just expressiveness).

## Why this layer matters more for C3D than for human tools

Midpoints, centroids, and evaluated curve points are **computed anchors**. Today the model *guesses*
coordinates ("eye at [8.77, 3.75, 5]") — the root cause of the buried/detached failures in the bee
transcript. Every node below that outputs a Point/measurement converts a guess into a derivation:
`Midpoint(head.centroid, thorax.centroid)`, `EvaluateCurve(spine, t=0.3)`. Combined with the
proportional-coherence plan, measured anchors let placement formulas reference geometry instead of
literals — the single strongest structural fix for spatial hallucination.

---

## A. Point tools

| Feature | What it does | Kernel | LLM value |
|---|---|---|---|
| ➕🔶 `Point` / `DeconstructPoint` | xyz ↔ Point | trivial | prerequisite |
| ➕ `Midpoint` | midpoint of 2 points / of an edge / of a curve (t=0.5 by arc length ⚙ GCPnts_AbscissaPoint) | S | ★★★ anchor generator |
| ➕ `PointBetween` | lerp(A, B, t) — generalized midpoint, t may be a slider formula | S | ★★★ "place eye 30% from head front" |
| ➕ `Centroid` | 3 variants: vertex-average, area centroid (face), volume centroid (solid) ⚙ GProp/BRepGProp | S | ★★★ pivot + anchor; distinct variants matter (GH lesson) |
| 🔶 `ClosestPoint` | point→PointSet/Curve/Face/Solid, returns point + `dist` (+ `t`/uv) ⚙ GeomAPI_ProjectPointOnCurve/Surf, BRepExtrema | M | ★★★ attractor idiom core |
| ➕ `ProjectPoint` | project along a direction onto plane/face/solid (vs. closest = perpendicular) | M | ★★ |
| ➕ `PullToSurface` | snap PointSet onto a face, keep channels | M | ★★ scatter cleanup |
| ➕ `SortPoints` / `CullDuplicates` | by axis/along-curve/by-channel; merge within tolerance | S | ★★ deterministic indexing (selector-friendly) |
| ➕ `PointGrid` | rectangular / hex / radial / 3D lattice of points, spacing as formulas → PointSet | S | ★★★ pattern substrate |
| ➕ `FibonacciSphere` / `Phyllotaxis` | sunflower/golden-angle distributions → PointSet | S | ★★ organic scatter without physics |
| ➕ `RandomPoints` | seeded, in box/on face/in volume | S | ★★ (seeded = reproducible for evals) |

## B. Vector tools

| Feature | What it does | LLM value |
|---|---|---|
| ➕🔶 `VectorXYZ` / `UnitX/Y/Z` / `Vector2Pt` | construct; 2Pt(A,B) = "direction from A to B" is the model's most-used phrase | ★★★ |
| ➕ `VectorMath` | add, sub, scale (GH "Amplitude"), negate, unitize, length, dot, cross, angle(ref plane), lerp, average | ★★★ one node, op param |
| ➕ `RotateVector` | rotate around axis by angle | ★★ |
| ➕ `ReflectVector` | mirror across plane | ★ |
| ➕ `PerpVector` | any stable perpendicular (for building frames from a single direction) | ★★ |
| ➕ `VectorBetweenCentroids` | sugar: Centroid(A)−Centroid(B) as one node — the "which way is the head" primitive | ★★ |

## C. Planes & frames

| Feature | What it does | LLM value |
|---|---|---|
| ➕🔶 `ConstructPlane` | origin+normal / 3 points / origin+2 axes; `DeconstructPlane` | ★★★ orientation currency |
| ➕ `FitPlane` | least-squares plane through PointSet (+ deviation output) | ★★ |
| ➕ `OffsetPlane` / `RotatePlane` / `AlignPlane` | plane manipulation set | ★★ |
| ➕ `PlaneCoords` | express point in plane's local uvw ↔ world (the coordinate-system bridge) | ★★ |
| 🔶 `PerpFrames` (via DivideCurve) | evenly spaced frames along curve — the rib/waffle/vertebrae primitive | ★★★ |
| ➕ `SurfaceFrame` | frame at (u,v) of a face — normal + tangents; powers oriented placement on curved bodies | ★★★ |

## D. Curve creation

| Feature | What it does | Kernel | LLM value |
|---|---|---|---|
| ➕🔶 `Line`, `Arc` (3pt / center+angles), `CircleCurve`, `EllipseCurve`, `RectangleCurve`, `PolygonCurve` | analytic curves on a plane | S each | ★★★ |
| ➕🔶 `PolylineCurve`, `SplineCurve` (interpolated / control-point, closed?, tangents) ⚙ GeomAPI_PointsToBSpline / Interpolate | from PointSet | M | ★★★ |
| ➕ `BlendCurve` | smooth bridge between two curve ends with continuity option (G1/G2) | M | ★★ |
| ➕ `FilletPolyline` | round polyline corners by radius (2D fillet) — replicad has 2D fillet | S | ★★ |
| 🔶 `OffsetCurve` | planar offset with corner style | M | ★★ |
| ➕ `JoinCurves` / `ExplodeCurve` | merge touching curves ↔ split into segments | S | ★★ |
| ➕ `TrimCurve` / `Shatter` | split at parameters / mutual intersections | M | ★★ |
| ➕ `ExtendCurve` | lengthen by distance, straight/arc/smooth | M | ★ |
| ➕ `RebuildCurve` | re-fit with n control points (cleanup before loft/sweep — prevents ugly surfaces) | M | ★★ |
| ➕ **`EdgesAsCurves`** | Selection(edges) → Curve list — **the bridge between sub-shape selection and the whole curve toolkit** (fillet path, rail extraction, measure a specific edge) | S | ★★★ |
| ➕ `ProjectCurve` / `WrapCurve` | project onto face along direction / map planar curve onto surface via uv | M/L | ★★ |
| ➕ `IsoCurve` | u/v isoparametric curve of a face | M | ★★ |
| ➕ `TweenCurves` | n intermediate curves between two curves — instant loft ribs, gradient fins | M | ★★★ |

## E. Curve evaluation & analysis (the "midpoints/endpoints/evaluate" core)

| Feature | What it does | Kernel | LLM value |
|---|---|---|---|
| ➕ `Endpoints` | start + end points (+ tangents) | trivial | ★★★ |
| ➕ `PointOnCurve` | normalized t ∈ [0..1] **by arc length** → point ⚙ GCPnts_AbscissaPoint (GH "Point On Curve"; arc-length t is what humans and LLMs mean) | S | ★★★ |
| 🔶 `EvaluateCurve` | t → point, tangent, normal, perp frame, curvature ⚙ BRepAdaptor_Curve + GeomLProp | S | ★★★ |
| 🔶 `DivideCurve` | by count / by length / by deflection ⚙ GCPnts_Uniform* → PointSet with `t`, `tangent`, frames | M | ★★★ |
| ➕ `CurveLength` | total or between parameters ⚙ GCPnts_AbscissaPoint | S | ★★★ feeds Expression: "scale teeth count by rim length" |
| ➕ `ClosestPointOnCurve` | point → t, point, distance ⚙ GeomAPI_ProjectPointOnCurve | S | ★★★ |
| ➕ `CurveCurveIntersect` | intersection points + params of 2 curves ⚙ GeomAPI_ExtremaCurveCurve | M | ★★ |
| ➕ `CurvePlaneIntersect` | curve ∩ plane → points | M | ★★ |
| ➕ `CurvatureAt` / `CurvatureChannel` | curvature scalar at t / sampled as channel on divided PointSet (drives thickness-by-curvature idioms) | M | ★★ |
| ➕ `CurveQueries` | isClosed, isPlanar, plane, domain, degree — booleans/values for validation + Expression | S | ★★ validation percepts |

## F. Measurement & interrogation (solids and everything else)

| Feature | What it does | Kernel | LLM value |
|---|---|---|---|
| 🔶 `Measure` | volume, surface area, centroid, moments/principal axes ⚙ GProp_GProps + BRepGProp (3 calls) | S | ★★★ percept + Expression input — closes the measure→derive loop |
| ➕ `DistanceMeasure` | min distance between any two shapes + the closest point pair ⚙ BRepExtrema_DistShapeShape | S | ★★★ "is the wing touching the thorax?" becomes checkable |
| ➕ `AngleMeasure` | angle between vectors/edges/face normals | S | ★★ |
| 🔶 `BoundingBox` | box solid + dims + center (world or oriented/principal-axis) | S | ★★★ |
| ➕ `IsInside` | point-in-solid / shape-in-shape classification ⚙ BRepClass3d_SolidClassifier | S | ★★★ powers containment checks as a *node* the model can use proactively, not just a validator complaint |
| ➕ `SelectionMeasure` | area/length/centroid of a Selection (faces/edges) — interrogate before operating | S | ★★★ pairs with selection percepts |
| ➕ `Deviation` | max/mean distance between two shapes (compare variants; also an eval metric) | M | ★★ |

## G. Point-set data & generative ops (the glue layer)

| Feature | What it does | LLM value |
|---|---|---|
| 🔶 `Remap`, `SortByChannel`, `FilterByChannel`, `Repeat/Cycle` | (Wave 1/2, unchanged) | ★★★ |
| ➕ `SetChannel` / `ChannelExpression` | write/derive named per-point channels with formulas over `x/y/z/t/dist/index` | ★★★ |
| ➕ `Jitter` | seeded random offset/rotation/scale channels (organic irregularity, reproducible) | ★★★ cheap "hand-made" look |
| ➕ `ClusterPoints` | group by distance → group index channel | ★ |
| ➕ `ConvexHull` | PointSet → mesh/solid hull (3D; 2D on plane → curve) | ★★ |
| ➕ `Voronoi2D` / `Delaunay2D` | on a plane/face, bounded → curve cells / triangles. The single most famous generative-design pattern; feeds Extrude/Thicken for panels, bones, cracks | ★★★ |
| ➕ `OffsetRegion2D` | inset/outset closed planar curves (cell walls from Voronoi cells) | ★★ |

## H. Idioms these unlock (composition, not new nodes)

- **Measured relational placement**: `Align(eye, head)` + `PointBetween(head.centroid, head.front, 0.7)` — anchors derived, not guessed; survives every slider.
- **Attractor gradient**: `PointGrid → ClosestPoint(attractor) → Remap(dist) → CopyToPoints(scale=…)`.
- **Rib/waffle structures**: `Section(solid, planes from DivideCurve frames) → Extrude` — boats, shelves, sculptural furniture.
- **Rail-following details**: `EdgesAsCurves(SelectEdges("top rim")) → DivideCurve → CopyToPoints(rivet)` — rivets/teeth/crenellations along any real edge of any solid.
- **Curvature-adaptive detail**: `CurvatureChannel → Remap → per-point scale` — denser/smaller elements where the form curves.
- **Measure→derive**: `Measure(gear).volume` into an Expression driving wall thickness — dimensional feedback inside the graph itself.
- **Voronoi panel façades / organic shells**: `PopulateSurface → Voronoi2D → OffsetRegion2D → Extrude → Boolean`.

## Priority (quick wins first — all S-cost, mostly one OCCT call each)

1. `Point`/`VectorXYZ`/`Vector2Pt`/`VectorMath` + `ConstructPlane` — the type layer (prereq for everything).
2. `Measure`, `BoundingBox`, `DistanceMeasure`, `IsInside` — measurement percepts; instantly improve the *existing* agent loop even before curves ship.
3. `Centroid`, `Midpoint`, `PointBetween`, `Endpoints` — the anchor kit; wire into Align/attach so placement formulas can reference them.
4. `Line`/`Arc`/`CircleCurve`/`PolylineCurve`/`SplineCurve` + `EvaluateCurve`/`PointOnCurve`/`DivideCurve`/`CurveLength` — the curve core (GCPnts/GeomAPI, all verified includable in the custom opencascade.js build per node_expansion §6).
5. `EdgesAsCurves` + `SelectionMeasure` — bridges to the sub-shape editing plan.
6. `PointGrid`, `Jitter`, `ClosestPoint`, `Remap`, `CopyToPoints` — the attractor/pattern stack.
7. `Voronoi2D`/`Delaunay2D`, `TweenCurves`, `SurfaceFrame` — the generative showpieces.

Ship each batch with the standard kit (validation contracts, geometry-report percepts, success-library
exemplars, eval prompts). Naming discipline: adopt `Domain.Verb` style (`Curve.Divide`, `Point.Between`,
`Solid.Measure`) per the Dynamo Create/Action/Query lesson — the vocabulary itself becomes guessable API.

## Sources

- Grasshopper Vector/Curve tabs: [Hopific vectors guide](https://hopific.com/vectors-in-grasshopper/) · [Curve components guide (IArchway)](https://iarchway.com/en/gh-curve-line-hub/) · [Evaluate Curve](https://grasshopperdocs.com/components/grasshoppercurve/evaluateCurve.html) · [Curve Proximity](https://grasshopperdocs.com/components/grasshoppercurve/curveProximity.html) · [component index](https://grasshopperdocs.com/completeIndex.html) · [points-from-curve tutorial](https://hopific.com/points-from-curve-grasshopper/)
- OCCT kernel basis: [GCPnts_AbscissaPoint](https://old.opencascade.com/doc/occt-7.0.0/refman/html/class_g_c_pnts___abscissa_point.html) (arc-length eval + length) · [Modeling Data guide](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_data.html) (GProp global properties: length/area/volume/centroid/inertia; GeomAPI projection/extrema classes; BRepExtrema)
- CadQuery's OCCT usage as implementation reference: [shapes.py](https://cadquery.readthedocs.io/en/stable/_modules/cadquery/occ_impl/shapes.html)
- Prior verified groundwork: `docs/node_expansion_research.md` §3–§6 (wire types, custom ocjs build ~2.4 MB, replicad API surface).
