# Sail-Ship Multi-Model Session Report — Jul 19, 2026

An extensive, reuse-oriented analysis of the "make a sail ship" / "make a grand sail ship" test runs across many models (OpenRouter auto/gpt-4o, poolside/lagun, openrouter/free, openrouter/fusion, Ollama-local kimi-k2.7-coder, and others), plus the earlier "make a flower" runs. It captures what each model produced, taxonomizes every recurring failure with code grounding, explains *how the models build graphs and where that goes wrong*, answers the graph-readability / visibility asks, and separates what recent commits already fix from what is still open.

Companion docs: `multimodel_flower_session_analysis_jul18.md` (flower session), `graph_intelligence_upgrade_plan_jul18.md` (genome/4-pillar plan). This report is the sail-ship counterpart and should be read alongside them.

---

## 0. The one finding that explains most of the session

**The patch/connect edge protocol structurally cannot wire number-typed inputs.** `geoInputHandles()` (`src/ai/tools.ts:232-236`, mirrored in `graphValidation.ts:29` and `geometryWorker.ts:28`) filters out every input whose `type === 'number'`. So for `PointsFromLists` (inputs x/y/z/scale/group — all number), `Expression` (a/b/c/d — all number), `Series`/`Range` (numeric inputs), the set of "valid input handles" the protocol will accept is **empty**. When a model emits an edge `Series → PointsFromLists.x`, the validator rejects it — `"PointsFromLists" has no input handle "x". Valid inputs: (none).` (`tools.ts:443-445`, `agent.ts:1286-1287`) — and silently drops it. At evaluation the executor then finds nothing wired and raises `PointsFromLists: connect at least one number list …` (`executors.ts:2189`).

Only the **IR/skill compiler** can build these edges (`src/ai/ir/compile.ts:273-274`, which wires by `inputNames`, not `geoInputHandles`). So every model that reached for the list-machinery through the tool/JSON patch protocol — which is exactly what you do to place 3 masts at 3 X positions, or to derive a yard's Z from a slider via an Expression — was fighting a wall it could not see. This single mechanism is behind the PointsFromLists failures (screenshots 2 & 5), the Expression `a/b/c/d` confusion, and a large share of the "graph exists but nothing renders" outcomes.

Everything else below is real too, but this is the spine of the sail-ship failure.

---

## 1. What was tested (and an important build caveat)

The same intent — a sailing ship — was run through ~6 model configurations, on two surfaces: the deployed site (`c33d.vercel.app`) and local dev (`localhost:5173`, screenshots 4–5). "Ship" is a hard prompt for this system precisely because a plausible ship needs *both spines at once*: a lofted organic hull (skeleton/curve spine) **and** repeated masts/sails along the deck (list/instancing spine) **and** stacked solid parts (solid spine + Align). It exercises every weak seam simultaneously — which is why it's a good benchmark and a punishing one.

**Build caveat for reuse:** several errors in these transcripts (EllipseCurve "missing required inputs: center, normal"; the 401 falling through to the JSON protocol) are **already fixed** in commits `91bf857` and `8ee0af6`. If those still appear, the run was on a build that predates the deploy (or on a stale localhost). When re-running this benchmark, confirm the build first (the eval panel now stamps provider; check the commit).

---

## 2. Per-session walkthrough

**Session 1 — OpenRouter auto / gpt-4o (screenshot 1).** Result: two brown boxes (cabin) and a single white meshed blob (one sail) on a thin black vertical line (a mast rendered as a bare cylinder). Scene layers: cabin, mast1–3, sail1–2. Transcript: `Engine fault … "This object has been deleted"` twice then the 3-strike episode stop, preceded by structural errors — `hullExtrude` (Extrude) missing `solid`, `hullScale` (ScaleXYZ) missing `solid`, `hullGround` (Align) missing `shape`. Reading: the hull sub-chain never got a base solid wired, so Extrude→Scale→Align all failed in a cascade; the masts/sail that *did* render are the only survivors. This is the classic "goes basic": what ships is the handful of solid-spine parts whose inputs happened to resolve.

**Session 2 — OpenRouter poolside/lagun (screenshot 2).** A wide, flat graph (Cylinder, Translate, Scale×2, Translate, two Group/Compound nodes, Point, CircleCurve, Vector, Spline…). Scene layers: only `Node_bowspritPos`. Transcript: `Auto-repair limit reached … PointsFromLists: connect at least one number list …` and IR notes about emitted bindings being consumed downstream. Reading: this is the number-input wall (§0) in its purest form — the model built the list machinery for masts/points but the edges into `PointsFromLists` were rejected, so almost nothing meshed. A big graph, an almost-empty scene.

**Session 3 — OpenRouter free (screenshot 3).** Result: a blue box hull, a black deck cap, and one red meshed ellipsoid standing vertically (a "sail" that reads as a blade). Scene: hullBox, alignDeck, alignMast, alignSail, alignBow, alignFlag. The plan was genuinely good — hull box, deck cap, 3 masts, yards, ScaleXYZ'd billowed sails, bowsprit, flags, all from shipLength/shipWidth/hullHeight/mastHeight/sailFullness. Reading: the Align chain partially worked (deck sat on hull), but the repeated masts/sails collapsed to a single element, and the sail orientation is wrong (vertical blade, not a billow). Detailed intent → simplified realization: exactly the detail-loss the new DesignGenome scoring is built to catch.

**Session 4 & 5 — Ollama-local kimi-k2.7-coder (screenshots 4–5, localhost).** Result: the **best hull of the batch** — a properly lofted, boat-shaped brown hull with a bowsprit spar. Scene: sternCastle, bowspritPlaced, hull. But it took a second prompt ("make a grand sail ship") after the first died on `Response was not valid JSON (attempt 1/3, 2/3)` → `Error: AI did not return valid JSON`. The graph (screenshot 5 minimap) is tall, narrow, and hard to read; nodes include Box, Translate×2, Boolean×2 (difference), Cylinder, Rotate, InstanceOnPoints, EllipseCurve ribs, LoftCurves. Reading: when the loft ribs actually get wired (the IR/skill path can do this), the hull is excellent — proof the capability exists and the bottleneck is wiring/protocol, not modeling ability. The masts/sails still didn't populate (InstanceOnPoints without wired points), and the graph is visually unreadable at the current zoom.

**Across all sessions:** the hull is either missing (chain broke) or basic (a box), except when the loft path succeeded (session 4). Masts render as bare lines/cylinders. Sails are single blobs, wrongly oriented, never a graded set. No session produced the multi-mast, multi-sail, billowed ship every plan described. The intelligence is in the *plans* (they're consistently good); the loss is entirely in *realization*.

---

## 3. Failure taxonomy (grounded in code)

**A. The number-input wiring wall — P0.** (§0.) `geoInputHandles` filters number inputs, so `PointsFromLists.x/y/z`, `Expression.a/b/c/d`, `Series`/`Range` numeric inputs are unreachable via the patch/connect protocol; edges are dropped, executors then error. Sites: `tools.ts:232-236, 443-445`; `agent.ts:1286-1287`; `executors.ts:2189`. Only IR compiles them (`compile.ts:273-274`). This is the highest-leverage fix in the whole report.

**B. Expression namespace confusion.** Expression inputs are `a,b,c,d` (number handles) and its only param is `formula` (string) — `NodeDefinitions.ts:36-50`. The executor evaluates the formula in a **unified namespace** where slider *labels* are visible directly (`geometryWorker.ts:405-423`; `expression.ts:54-143`), so a formula can reference `mastHeight` with **no edge at all**. Models don't know this: they either (a) reference an undefined name (`unknown variable 'deckz'`, `expression.ts:134`) because `deckZ` was never a slider, or (b) try to wire sliders via `param:a`/`param:b` edges, which don't exist (`param:a` → `"Expression" has no numeric param "a"`, `agent.ts:1283-1284`). Core-rule 4 already steers toward inline formulas, but under repair pressure models still reach for Expression nodes. Fix: strengthen the "inline formulas, never Expression for scalars" guidance and/or auto-rewrite a lone Expression-with-formula into an inline param.

**C. LoftCurves ribs built but unconnected.** `LoftCurves` needs ≥2 of curve1..6 (`graphValidation.ts:32, 198-204`). Ribs (`EllipseCurve`/`SplineCurve`) are `Curve`-typed so the protocol *accepts* them (unlike §A) — but if the model emits ribs without edges into the loft, the loft has 0 inputs while the ribs still mesh as their own leaves. So the ribs *look present* in the scene while the hull is empty. This is a false-positive trap: "the curves are there" ≠ "the loft is fed". Fix: when a LoftCurves has <2 inputs but ≥2 unconsumed compatible curves exist in the graph, propose the exact edges in the error (name-order heuristic), like the flower-report's unwired-list suggestion.

**D. Align missing `shape`.** `Align` requires `shape` (`graphValidation.ts:38-39`, def `NodeDefinitions.ts:382-398`). Models repeatedly emitted Align nodes with only `reference` wired (or nothing), breaking the stacking chain (sessions 1 & 5, and the "alignDeck/alignMast/alignSail missing shape" transcript). Because Align is the backbone of the ship's assembly, one missing `shape` collapses a whole sub-tree. Fix: clearer Align examples in-prompt, and an error hint naming which upstream solid most plausibly belongs on `shape`.

**E. removedEdgeIds param-handle hallucination.** During repair, models tried to remove edges like `{"source":"sailScale","target":"sailH_upper","targetHandle":"param:b"}` when the real edge was `sailH_upper → upperSailShape.param:height`. The resolver correctly reports the miss and lists the real edges touching those nodes (`agent.ts:1319-1364`), but the model burned repair rounds guessing handle names. Root: the model's mental model of param handles (`param:a/b`) doesn't match reality (`param:<realParamName>`). Fix: always echo the exact edge ids in the graph state the model edits from (the compact state already renders `source → target.targetHandle` at `agent.ts:561` — reinforce that these are the *only* removable ids), and accept a target-only removal form (`{target, targetHandle}`).

**F. Engine fault "This object has been deleted".** Thrown by replicad's `WrappingObj.wrapped` getter when a disposed WASM shape is reused (`node_modules/.../replicad.js:32`). Triggered historically by the cache-eviction `s.delete()` loop (`geometryWorker.ts:578-592`) interacting with shapes retained/shared across evaluations (`shapeCache`, `:246`). The delete is **already disabled as a mitigation** (`:585-587`), but the fault still surfaces from shared-handle reuse; it's classified as a system/kernel error (`errors.ts:6` treats `'deleted'` as system-class) and consumes the 3-strike engine-fault budget (session 1). Fix: on a `deleted`/`$$`/`wrapped` class fault, set `kernelSuspect` and fire the existing per-graph worker respawn (from the flower report), and consider deep-cloning shapes on cache retrieval so a node never holds a handle another node can dispose.

**G. Already fixed — appeared on an older build.** EllipseCurve/CircleCurve "missing required inputs: center, normal" is now suppressed — `graphValidation.ts:42-48` returns `null` for both (fixed in `91bf857`; the executor defaults them to origin/+Z). The `401 → falling back to JSON protocol` is now a fast-fail abort (`8ee0af6`). If these recur, the run predates the deploy.

---

## 4. How the AI builds graphs (pattern analysis)

Reading across the transcripts, the models converge on a consistent construction *strategy* and fail in consistent *places*:

The **plans are good and remarkably uniform** — hull + deck + 3 masts + yards + billowed sails + bowsprit + flag, all derived from 4–6 shared sliders, assembled with Align chains. This is correct parametric thinking and matches the system's own guidance. The intelligence layer is working.

The failure is always at the **transition from plan to wiring**, and it concentrates in three moves:

1. **Repetition (masts/sails along the deck).** Models reach for the list-machinery — Series/Range → PointsFromLists → InstanceOnPoints — because that's the "proper" parametric way. But PointsFromLists' number inputs are unwireable via the patch protocol (§A), so the points never populate and the instancer renders nothing. The models that instead used `LinearPattern`/`CircularPattern` (solid-spine nodes) or the IR `on_circle`/`grid` skills fared better. **The list-machinery is the graph graveyard**: it's where the most-intended detail (multiple masts, graded sails) goes to die.

2. **Derivation (yard Z from mast height, sail size from a slider).** Models build Expression nodes and try to wire a/b/c/d — again number inputs, again rejected — or reference names that aren't sliders (`deckZ`). The system *wants* them to inline formulas (`{"z":"mastHeight*0.6"}`), which needs no node and no edge, but the models don't reliably internalize that Expression is only for list math.

3. **Assembly (stacking via Align).** This mostly works when `shape` is wired, and is the reason session 3's deck sat correctly on the hull. It breaks when `shape` is omitted (§D), collapsing sub-trees.

The net visual signature — **a box hull (or none) plus one blob and a bare line** — is the direct sum of these: the solid-spine parts that resolve survive; the skeleton (loft) and list (masts/sails) parts get dropped or error, so the rich middle of the design evaporates. "It goes back to basic" is not the model dumbing down; it's the wiring layer amputating everything except the primitives.

**Design implication:** the fastest path to visibly better ships is to make the list/skeleton spines as wireable as the solid spine — either by letting the patch protocol carry number edges (§A fix), or by routing all repetition/derivation through the IR compiler (which already can), or by steering models to the solid-spine equivalents (LinearPattern/CircularPattern + inline formulas). The DesignGenome (just shipped) makes the loss *measurable*; these fixes make it *stop happening*.

---

## 5. Graph readability & giving me better views (your asks)

**Zoom-out is capped.** The `<ReactFlow>` in `src/components/NodeGraph.tsx:149-159` sets `fitView` but **no `minZoom`/`maxZoom`**, so it uses ReactFlow defaults (minZoom 0.5, maxZoom 2). Big ship graphs literally can't be zoomed out far enough to fit — the cause of the "weird, can't see it" minimap. One-line fix: add `minZoom={0.05}` (and e.g. `maxZoom={2.5}`, `fitViewOptions={{ minZoom: 0.05, padding: 0.2 }}`) to that element. Auto-layout spacing lives at `autoLayout.ts:7-10` (`COL_WIDTH 230`, `ROW_HEIGHT 190`) — widen for breathing room, or (better) lay the list-machinery in its own lane.

**Collapse already half-exists.** There's a "Collapse to Macro (N)" affordance for 2+ selected nodes (`NodeGraph.tsx:169-178`) and a real `GroupNode` type, but nothing auto-groups the list machinery — so ship graphs sprawl. This is the Pillar-4 auto-clustering work from the upgrade plan: collapse Series/Range/ListConstant/PointsFromLists/Expression clusters into one labeled node by default.

**Giving me better data.** I can only see what you screenshot, and a downsampled canvas hides the wiring that actually matters. Three better channels, in order of usefulness: (1) the **eval experience store** just shipped — its "Load this graph onto the canvas" stores the exact graph JSON; that JSON is the ground truth I can read directly; (2) an **"Export graph JSON" / copy-to-clipboard** button would let you paste a graph and I can analyze wiring precisely (small feature, high value for this collaboration); (3) for a specific failure, the **compact graph state** the model already sees (`agent.ts:561`, `source → target.handle`) is exactly what I need — surfacing/exporting that would let me debug a run without a screenshot.

---

## 6. What recent commits already address

`91bf857` (deployed): eval experience store (clickable, loadable, model-tagged runs — the channel above), provider fast-fail (kills the 401/403/429 credit-burn loop, §G), EllipseCurve/CircleCurve validation downgrade (§G), anti-anchoring variation seeds. `8ee0af6` (built, push pending): DesignGenome + intent-realization scoring — makes the sail-ship detail loss (single sail vs planned four; missing masts) a visible `realizationScore` + `deferredDetail` gap fed back into repair, instead of silently shipping the box.

Neither yet fixes the number-input wall (§A), the loft-rib auto-connect (§C), or the graph zoom/clustering (§5) — those are the open items.

---

## 7. Priorities

**P0 — the wiring wall (§A).** Decide the fix: (a) allow number-typed edges in the patch/connect protocol (change `geoInputHandles` to include number inputs for list nodes, with type checks), and/or (b) hard-route all repetition/derivation through the IR compiler and steer models there for new designs. Without this, no amount of better planning yields multi-mast ships. This is the single highest-leverage change in the report.

**P1 — realization-aware repair for the ship idioms.** Loft-rib auto-connect proposals (§C), Align-`shape` hint (§D), Expression→inline-formula auto-rewrite (§B), and lean on the new intent-gap feedback (§6) so a plan of "3 masts + 4 sails" that renders 1 gets pushed back automatically.

**P2 — graph legibility (§5).** Add `minZoom` (one line, immediate relief), then auto-cluster the list machinery into collapsible groups (Pillar 4), and add an "Export graph JSON" button so runs are shareable/analyzable without screenshots.

**P2 — kernel robustness (§F).** Promote `deleted`/`$$` faults to `kernelSuspect` + per-episode worker respawn; investigate deep-cloning cached shapes to end shared-handle disposal.

The throughline with the flower report holds: the models plan well and, when the wiring path is open (session 4's loft), build beautifully. The losses are transport and protocol — most sharply, a validator that rejects the exact number-list edges the models need to make a ship a ship. Open that path and the intelligence you can already see in the plans will reach the screen.
