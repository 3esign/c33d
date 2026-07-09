# C3D — Model Test Prompts & Feedback Checklist
*Use after `npm run build`. Run the same prompt across each model on a CLEARED canvas. The goal is to test the SYSTEM's reliability (does the loop recover, are the diagnostics actionable), not just the model.*

---

## NEWEST quick benchmark — the flower (tests the ScaleXYZ/Ellipsoid fix, July 9 build)

`ScaleXYZ` and non-uniform `Ellipsoid` previously threw on every call (`BRepBuilderAPI_GTransform_2 is not a constructor` — that class isn't compiled into replicad's WASM) and silently passed shapes through unscaled/unellipsoidal. This is why every past flower/organic-form attempt produced plain spheres for petals no matter what scale factors the model asked for. Fixed via a mesh-rebuild approach (`solidFromDeformedMesh` in `geometryWorker.ts`) — see `.agents/AGENTS.md` §12 for the technical detail.

Paste this verbatim, on an empty canvas:

> Build a parametric flower standing on the ground (Z-up). Use NumberSlider design parameters bloomRadius (default 10) and stemHeight (default 30). Build the stem as a tapered Cylinder or Cone. Build petals using Ellipsoid or Sphere->ScaleXYZ (non-uniform, cupped/flattened, NOT a uniform sphere) arranged in at least two size-graded rings with a phase offset between rings (use CircularPattern's startAngle/scaleStart/scaleEnd). Add a contrasting-color center and a ring of small stamens. Keep petals, center, stamens and stem as separate colored leaf nodes. Check the geometry report — petal bounding boxes should be visibly non-spherical (flattened in one axis) — then finish.

**What this discriminates:**
1. Do the petal leaves in the geometry report actually have non-equal bbox dimensions (flattened/stretched), or do they come back as perfect cubes/spheres (the old bug)?
2. Any `ScaleXYZ failed` / `Ellipsoid failed` warnings in the node errors? There should be none now.
3. Does a full multi-ring bloom still evaluate quickly (reference: a 16-petal, 2-ring test build took ~1.5s headlessly)?
4. Multi-color: are petals/center/stamens/stem visibly separate colors, not one gray fused blob?

---

## NEWEST+1 quick benchmark — the vine (tests Bend/Twist/Pipe, July 9 build)

Adds `Bend` (axis, angle — curves a shape like a banana), `Twist` (axis, angle — spirals a shape along its extent), and `Pipe` (pathSvg, radius — a circular tube along an SVG-style path, same syntax as Sketch minus the closing Z).

Paste this verbatim, on an empty canvas:

> Build a curling vine with a spiral horn ornament, standing on the ground (Z-up). Use a Pipe node for the vine's main stem, following a curved SVG path that sweeps upward and to one side (e.g. "M 0 0 C 5 15 -5 30 3 45"). Add at least 2 leaves attached along the vine using Bend (curved, not flat) at different heights. Add a small spiral horn near the top using a tapered Cone or Cylinder passed through a Twist node (at least 180 degrees). Keep the vine, leaves, and horn as separate colored leaf nodes. Check the geometry report for errors before finishing.

**What this discriminates:**
1. Does the Pipe node produce a non-degenerate curved tube (nonzero volume, bbox matching the path), or a flat/zero-volume failure?
2. Do the Bend'd leaves show actual curvature (non-flat bounding box in the curl axis), not just a flat leaf?
3. Does the Twist'd horn show a spiral (check it doesn't error with "passed through UNTWISTED")?
4. Total evaluation time — reference: a bent petal took ~1s, a twisted cylinder ~1s, a curved Pipe well under 1s. A whole vine+leaves+horn build should still land in single-digit seconds.

---

## NEW quick benchmark — the lighthouse (tests the Align node, July 8 build)

This build adds an **Align node** (inputs `shape` + `reference`; mode above/below/left/right/front/back/center/ground + offsets). It snaps a part's bounding box against a reference part's, so models no longer hand-compute stacking Z coordinates — the #1 source of buried/floating parts. A part used as a reference still renders as its own colored leaf. Also new: the report now warns about unlabeled sliders and errors on duplicate slider labels.

Paste this verbatim, on an empty canvas:

> Build a parametric lighthouse standing on the ground (Z-up). Use exactly 2 NumberSlider design parameters labeled towerHeight (default 30) and towerRadius (default 6), and make every other dimension an inline formula of them. Stack the parts flush bottom-to-top: a white tapered tower (cone, radius1 towerRadius*1.3, radius2 towerRadius*0.8, height towerHeight), a red gallery deck (short wide cylinder), a glass-blue lantern room (cylinder, height towerHeight*0.15), and a red conical roof. Add 6 thin railing posts around the gallery deck edge with a CircularPattern. Keep every part a separate colored leaf node so it renders in multiple colors. Check the geometry report — nothing buried, nothing floating, tower base at Z=0 — then finish.

**What this discriminates (note per model):**

1. Did it use **Align** for the stacking (the capable path) or fall back to Translate with hand-computed formulas like `towerHeight/2 + deckHeight/2` (works, but brittle — watch whether the parts stay flush when you move a slider afterwards)?
2. Did it chain each Align's `reference` to the **previous Align node** (correct — stack stays flush when sliders move) or to the raw primitives (drifts)?
3. Slider hygiene: exactly 2 sliders, labeled correctly, all other dimensions inline formulas. Any "unlabeled slider" warnings or "duplicate label" errors in the report?
4. Multi-color: 4+ separate leaves in the viewport, or did it Boolean/Compound everything into one gray blob?
5. Repair behavior: if the first attempt had buried/floating parts, did the geometry report drive an actual fix within the 2-repair cap?

**After the build, move both sliders through their range** — the whole lighthouse should rescale and stay flush. That slider sweep is the real parametric test; screenshot before/after.

---

## Primary benchmark — the rocket (compare directly to the old broken runs)

Paste this verbatim, on an empty canvas:

> Build a multi-stage rocket standing on the ground (Z-up). Use 3 NumberSlider design parameters — bodyRadius, stage1Height, finCount — and make every other dimension a formula of them so the whole rocket rescales when I move a slider. Stack the parts bottom-to-top: engine nozzle (cone, flared), stage-1 body (cylinder), a short interstage cone, stage-2 body (narrower cylinder), a payload fairing cone, and a nose cone on top. Add 3–4 fins around the base with a CircularPattern, two decorative bands, and a small porthole window. Keep the parts as separate colored leaf nodes (dark engine, white body, red fairing, navy fins) so it renders in multiple colors. Verify the geometry report before finishing.

**Note (this build):** parameters can now be inline formula strings that reference a slider's label — e.g. a Cone with `data: { "height": "stage1Height*0.2", "radius1": "bodyRadius*1.3" }`. Models no longer need to wire `Expression` nodes or `param:` edges for dimensions, which is what every model failed at before. The only edges a rocket needs now are the solid chains (Cone→Translate→leaf). Watch whether the models actually take this path.

**Why this one:** it's the exact failure case from your logs — deep expression chains, stacked cones/cylinders with `solid` edges, multi-color leaves. It stresses every fix at once.

---

## Escalating suite (run to find each model's breaking point)

1. **L1 – primitive + transform:** `Make a coffee mug: a cylinder body with the top hollowed out and a handle on the side.`
2. **L2 – boolean + pattern:** `Make a square plate 40×40 with a fillet on the edges and six bolt holes evenly spaced around the perimeter.`
3. **L3 – the rocket above.**
4. **L4 – open creative:** `Design a small futuristic observation tower — be inventive with the silhouette. Use at least two design sliders.`

---

## What to send me for each run

For every model + prompt, capture:

1. **Model name** (exactly as shown in the agent slot) and which prompt (L1–L4).
2. **Screenshot** of the 3D viewport (the final result).
3. **The chat text**, specifically — this is the most useful part now, because the diagnostics changed:
   - the final **GEOMETRY REPORT** block,
   - any line starting with **`SKIPPED (fix and retry)`** (edge/handle problems),
   - any **structural error** (e.g. *"…is missing required input 'solid'"*, *"Expression … uses 'a' … not connected"*),
   - any **collapse** line (*"Most parts share the same center…"*),
   - any **"Response was truncated"** notice,
   - the final **node/edge count** and whether it hit **"Auto-repair limit reached."**
4. **Did the viewport show a coherent, multi-colored rocket, a partial one, or empty?**

---

## What I'm looking to learn from the results

- **Are the new error messages specific and correct?** (e.g. does it now say *which* edge is missing instead of "null result"?)
- **Did the collapse spam disappear?** The horse-style wall of "fully inside" messages should be gone, replaced by one root-cause line.
- **Did any repair turn actually change the report** (loop is healing) vs. stay identical (still stuck)?
- **Did truncation get detected** on the big builds instead of producing missing edges?
- **Node-count sanity:** it should NOT balloon across repairs the way it did before (29→75).

A quick note per run like *"glm-5.2: built full rocket, 1 repair, report clean, screenshot attached"* or *"gemma: SKIPPED 3 edges — pasted below, ended empty"* is exactly what I need to decide whether to move on to Tier 2 (orphan GC, incremental building) or the Stack node.

---

## Priority models (from your earlier log)

The ones that actually produced geometry before were the Ollama-cloud models — **gemma4:31b-cloud, minimax-m3:cloud, glm-5.2:cloud, deepseek-v4-flash**. Start there. The Gemini/OpenRouter frontier slots were all failing on **auth (403/400)**, not capability — if you want those in the comparison, fix their API keys first, otherwise they'll just log infra errors again.
