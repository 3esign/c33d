# C3D — Organic Shape Vocabulary Review
*July 9, 2026. Response to the platform-introspection request ("more freedom, more unique results, more nodes") and the accompanying 14-category node proposal. Grounded in the actual code (`NodeDefinitions.ts`, `geometryWorker.ts`, `agent.ts`, `replicad`'s own source) rather than the proposal's assumptions. Companion to [Evaluation and Improvement Plan.md](file:///C:/Users/treed/OneDrive/Desktop/C3D/Evaluation%20and%20Improvement%20Plan.md) and [Reliability and Diagnostics Plan.md](file:///C:/Users/treed/OneDrive/Desktop/C3D/Reliability%20and%20Diagnostics%20Plan.md). Engineering detail for the fixes below lives in `.agents/AGENTS.md` §12.*

---

## 1. The headline finding: the #1 proposed node already existed, and was silently broken

The introspection's top priority was "ScaleXYZ — the highest-impact single addition." `ScaleXYZ` has existed in `NodeDefinitions.ts` and `geometryWorker.ts` for a while, and the live system prompt (`agent.ts` rule 7b) already explicitly tells every model to use it: *"use ScaleXYZ... e.g. Sphere→ScaleXYZ(1, 0.4, 0.15) is a cupped petal."* `Ellipsoid` and `Torus` also already exist as direct primitives.

The reason the model's output still looked like unscaled spheres is that `ScaleXYZ`'s implementation called `new OC.BRepBuilderAPI_GTransform_2(...)` — a class that **is not compiled into replicad's WASM bundle** (`replicad_single.wasm`). Confirmed empirically in a headless Node harness: `typeof OC.BRepBuilderAPI_GTransform_2 === 'undefined'` at runtime, in both WASM variants replicad ships (`_single` and `_with_exceptions`), even though the upstream `.d.ts` advertises the class. Only 888 of the full OpenCascade class surface are bound in this build. Every call threw, was caught, and silently passed the shape through **unscaled** — the exact failure visible in the pasted logs (`OC.BRepBuilderAPI_GTransform_2 is not a constructor`). `Ellipsoid` routes through the same function whenever its three radii aren't all equal, so it had the identical bug: a non-uniform `Ellipsoid` request silently degraded to a plain sphere.

This was not a missing-vocabulary problem. It was one broken binding, load-bearing under a feature the system already recommended by name. It's fixed now (see §3), and it was the correct first thing to fix — no amount of new node types would have helped while the one everyone was being told to use didn't work.

## 2. What the proposal asked for vs. what's actually in `NODE_LIBRARY` today

Read against `NodeDefinitions.ts` directly, not against what the model assumed:

**Already shipped, contrary to the proposal's premise:**
- `ScaleXYZ` (non-uniform squash/stretch) — existed, now actually works (§3).
- `Ellipsoid`, `Torus` — direct primitives.
- `Align` (shape + reference, mode: above/below/left/right/front/back/center/ground + offsets) — this *is* the proposed Anchor/Attach system, added July 8. Not identical API (no face-selector/UV addressing on the reference) but solves the stated problem: "attach bloom to top of stem" is exactly `Align(mode: "above")`.
- `Macro` (verified reusable subgraphs, exposed params, retrieved into the prompt as `AVAILABLE MACROS`) — this *is* the proposed MacroDefinition/MacroCall system.
- `Revolve`, `FilterFaces`, `SubdivideSurface` — rotationally-symmetric parts and panel/facade detailing.
- `CircularPattern` already has `startAngle`, `rise` (phase-offset rings, phyllotaxis spirals), and `scaleStart`/`scaleEnd` (graded instance size) — most of "CircularPattern v2."
- Inline formula parameters (any numeric param can be a string like `"bodyRadius*0.2"`) plus `NumberSlider` — the parametric-design layer the proposal's macro section wanted.
- Per-node `color`, multi-color leaf rendering, a geometry report with per-leaf bbox/volume and a collapse/null-geometry diagnostic trace.

**Genuinely missing — real gaps, worth building:**
- Bend, Twist (as standalone deformers), a Superellipsoid primitive, DeformByLattice — no equivalent exists.
- **Sweep/Pipe is *not* actually hard.** `replicad` exports `genericSweep(wire, spine, config)` and `Sketch.sweepSketch(...)` natively — the same shape of "thin wrapper" work as `Revolve` was. This should be re-prioritized upward; it's misfiled as a big lift in the original proposal.
- Construction planes / `SketchOnFace` (`PlaneFromFace`, `OffsetPlane`, `SketchOnPlane`) — sketches are hard-coded to the XY plane today. Real gap for detailing (windows on walls, panels, engravings).
- Orientation helpers (`AimAt`, `OrientToNormal`, `RotateAroundPoint` as a convenience over raw Euler `Rotate`) — real gap.
- Material/PBR system (roughness, metallic, opacity, transmission, emission) — only a flat hex `color` exists anywhere in the codebase. Probably the single highest visual-impact genuine gap: glass, wax, metal, skin, gems are all currently the same flat-shaded plastic look regardless of what the model calls them.
- Parametric profile generators (`PetalProfile`, `LeafProfile`, `GearProfile`, ...) — not built as dedicated node *types*, but the `Macro` system is explicitly the right mechanism for these (build once via `Sketch`, save as a macro, reuse) rather than hard-coding another dozen primitive types. This matches the library-learning direction already set in the Evaluation Plan §6.2.
- Visual/thumbnail diagnostics (render-and-judge) — flagged as still-missing in the Evaluation Plan §2.3 too; independently confirmed here.
- Pattern jitter (`rotationJitter`/`scaleJitter`/`radialJitter`/`seed`, per-instance index output) — `CircularPattern` has the "graded" half (start/end scale, phase, rise) but not the "irregular" half. `LinearPattern` has neither.

**One correction to existing docs, found in passing:** `AGENTS.md` claimed "Compound requires 4 unique inputs" and warned it could "silently fail." Checked against the current code: `Compound` has 8 input slots (`solid1`..`solid8`), and duplicate references are de-duplicated, not rejected. That line was stale (the node was probably expanded from 4→8 slots at some point without updating the doc) and has been corrected — it was telling the model to avoid something that isn't actually a problem.

## 3. What was fixed this pass

**`ScaleXYZ` / non-uniform `Ellipsoid` (root cause above).** `nonUniformScale()` in `geometryWorker.ts` now goes through a new helper, `solidFromDeformedMesh(shape, deform, tolerance)`: tessellate the input, run an arbitrary per-vertex JS function over it, and re-sew the result into a genuine `TopoDS_Solid` using only primitives confirmed present in this WASM build (point → edge → wire → planar face → sewing → solid — no `GTransform` needed anywhere).

Validated in a headless harness before touching production code:
- Sphere r=2 scaled to semi-axes (2, 3, 0.5): correct bounding box, volume within 1–8% of the analytic value depending on tessellation tolerance (tighter tolerance = closer, slower).
- Box 4×6×2 scaled (2, 0.5, 3): volume exactly 144 (flat faces tessellate exactly, no approximation).
- Downstream operations on the result — `.faces`, `.clone()`, `.translate()`, `.fuse()` with another solid — all behave normally.
- A full composite flower (2 rings × 8 non-uniform `Ellipsoid` petals, phase-offset, tilted and lifted onto a stem, plus a stamen ring) built end-to-end in **1.5 seconds** with sane bounding boxes and volumes throughout.

Trade-off, stated plainly: the result is faceted (polyhedral) rather than a perfectly smooth analytic surface. Invisible at normal render density; worth knowing if a future feature ever needs to reason about "true curvature."

**Bonus, same root utility:** `solidFromDeformedMesh` takes any per-vertex deform function, not just linear scale — `Bend` and `Twist` are the same shape of problem (no native OC binding, needs deform-and-resew) and can call it directly instead of re-solving GTransform. This makes both cheap to add next; see §4.

**`Extrude` taper/twist.** Checked replicad's own `.extrude()` signature: it already accepts `extrusionProfile: { profile: 'linear' | 's-curve', endFactor }` and `twistAngle` — this *is* the proposed `TaperedExtrude`, just never wired to node parameters. Added `taperEndFactor`, `taperProfile`, `twistAngle` params to the `Extrude` node (10-line change, zero new kernel risk, since it's calling an already-tested library option). Verified against replicad directly: a 10×6 rectangle extruded 20 units with `endFactor: 0.3` + `twistAngle: 90` produces the expected tapered, twisted volume. Use on a `Sketch` profile (not on `Plane`/`Face` output — those don't have `.extrude()` in replicad; that's a separate, smaller pre-existing gap, not addressed here).

**Geometry report volume field.** Found in passing while fixing the above: the per-leaf `volume` in the geometry report read `(value as any).volume`, which is not a real property on replicad's shape class (verified against replicad's own compiled source — there is no getter; volume is only exposed via the exported `measureVolume(shape)` function). This was silently `undefined` for *every* node's report, not just the ones this pass touched. Now calls `replicad.measureVolume(value)` and actually reports real numbers.

## 4. Where this leaves the priority roadmap

The original P0 list (ScaleXYZ, Ellipsoid/Torus/Capsule, CircularPattern orientation, Assembly, Material) is mostly done or was a documentation gap, not a build gap. Re-ranking what's left, by the same "cheap + high leverage first" logic that motivated fixing ScaleXYZ before anything else:

1. **Material/PBR params** (roughness, metallic, opacity, emission on primitives; a handful of presets). Nothing else on this list changes the *rendered look* of every single object this dramatically — it's the difference between "a plastic flower" and "a flower," independent of geometry quality. Pure additive work (new params + a Three.js material mapping in the viewport), no kernel risk.
2. **Sweep/Pipe.** Misclassified as hard in the original proposal; `replicad.genericSweep`/`sweepSketch` already exist. Same effort class as `Revolve` was. Unlocks stems, vines, cables, tentacles, horns — a real, currently-missing capability, cheaply.
3. **Bend/Twist as standalone nodes.** The hard part (deform-and-resew) is already built and proven (§3); this is now mostly a NodeDefinitions entry + a `deform` callback, same pattern as `nonUniformScale`.
4. **Construction planes / `SketchOnPlane`.** Needed for any detailing that isn't on the XY plane — windows, panels, engravings on non-ground faces.
5. **Pattern jitter + orientation** (`faceOutward`, `radialTilt`, jitter, seed) on `CircularPattern`/`LinearPattern` — the "identical clone" complaint has a narrow, well-scoped fix here.
6. **Visual verification pass** (render-and-judge) — independently flagged in both this review and the Evaluation Plan; still nobody's built it. This is arguably higher-leverage than any single node, since it would have caught "petals are unscaled spheres" automatically instead of needing a human to notice and paste an error log.

This list assumes the Evaluation Plan's own Tier ordering (geometry report, parametric params, tool calling) stays the backbone — this review only reorders the *shape-vocabulary* slice of the backlog, it doesn't supersede the reliability work.

## 5. Direct answers to the three questions the model asked

**"Which category first — organic deformers, material system, or semantic attachment?"** Semantic attachment (`Align`) already shipped July 8. Between the other two: material system, for the reason in §4.1 — it's the one change that visibly improves *every* existing model, not just future ones built with new deformer nodes.

**"Individual atomic nodes (Bend, Twist, TaperedExtrude) or one Deform node with a mode selector?"** Atomic. `TaperedExtrude` shipped as `Extrude` params, not a new node, because the capability was already sitting inside `.extrude()` — a mode-selector `Deform` node would have hidden that it's free. For `Bend`/`Twist`, keep them atomic too: separate nodes keep the per-node param list short and let the geometry report name the actual offending node when one fails, which the reliability work (Reliability Plan §1.1, `explainNullGeometry`) depends on — a generic `Deform{mode}` node would blur that diagnostic.

**"Built-in macro library for common sub-assemblies, or build from scratch every time?"** Macro library, and it already exists as infrastructure (`Macro` node type, `exposedParams`, `macroLibraryText()` retrieval) — it just doesn't have content yet. The next concrete step isn't a new mechanism, it's populating it: when a user keeps/approves a good petal, wheel, or colonnade, distill it into a macro (Evaluation Plan §6.2's "distillation flow" is still unbuilt — that's the actual gap, not the macro system itself).

---
*Verification: all claims above about what exists were checked against `NodeDefinitions.ts`, `geometryWorker.ts`, `agent.ts`, and replicad's own compiled source and `.d.ts`, not against documentation, which had drifted in at least two places (§2's Compound correction, and `AGENTS.md`'s node list itself, updated alongside this review). The ScaleXYZ fix and Extrude taper addition were both tested against the real OpenCascade WASM build in a headless harness before being merged, not just type-checked.*
