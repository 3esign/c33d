# C33D DECISION BRIEF — synthesis of six research lenses
*Scan date 25 Jul 2026. Reader assumed: author of the system, post-audit (45% failure, 25% no-graph, ~17 empty-provider deaths, root causes encoding-surface).*

---

## 1. THE FIVE THINGS THAT CHANGE WHAT YOU DO NEXT

### 1.1 Your error messages are the single largest measured lever, and the payload isn't the location — it's the admissible set
The strongest experimental result in the whole corpus ([Structured Feedback Improves Repair in an LLM Agent Loop, arXiv 2607.14167](https://arxiv.org/html/2607.14167v1) — 2,652 calls, Qwen2.5-Coder-14B + Llama-3.1-8B, 50 environments, 4-call budget) ablates feedback into four policies:

| Policy | Content | Δ vs RawDiag |
|---|---|---|
| RawDiag | raw validator error | baseline |
| **LocObs** | label + location + observed value | **≈ 0 (no gain)** |
| SameNL | + **admissible alternatives**, prose | **+44pp** (Qwen, 95% CI 28–60) |
| TypedFields | + admissible alternatives, JSON fields | **+42pp** |

Three corollaries you can act on today: (a) telling the model *where* it went wrong is worth approximately nothing — the enumerated valid alternatives contribute **+36–40pp of the total**; (b) prose vs JSON diagnostics differ by **0–2pp with CIs containing zero**, so build no machine-readable diagnostic schema for the model's benefit; (c) enumerate but **cap at 12, deterministic order** (the paper's own implementation).

Compounding this: [FeedbackEval](https://arxiv.org/html/2504.06939v2) ranks Repair@1 as Mixed (diagnostic + guidance + suggestion) **63.6%** > LLM-Expert 62.9% > Test 57.9% > **Minimal ("the code is wrong, fix it") 53.1%** > **raw compiler diagnostics 49.2%**. Shipping your type-checker's internal text is measurably worse than saying nothing specific. This settles the "describe the violation vs. suggest the fix" question: **suggest the fix.**

### 1.2 Your ~17 empty responses are a documented, open provider bug — not a model failure, and not yours
[ollama#17091](https://github.com/ollama/ollama/issues/17091): **`glm-5.2:cloud`** returns `{"message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":31437227137}` — HTTP 200, ~30s latency, reproducible for 15+ minutes, survives service restart, both `/api/chat` and `/v1/chat/completions`. `kimi-k2.6:cloud` is fine at ~2s on the same instance. Open, no maintainer response. `glm-5.2` is on your model list.

Two more that are load-bearing: [ollama#15169](https://github.com/ollama/ollama/issues/15169) — cloud models omit `usage` in streaming chunks *and* omit the `X-Prompt-Tokens`/`X-Completion-Tokens` headers, though non-streaming returns usage. Without `eval_count` you cannot distinguish reasoning-exhaustion from truncation from null-generation, so **the entire failure-classification table collapses**. And [ollama#16456](https://github.com/ollama/ollama/issues/16456): `gemma4:26b` MoE Q4_K_M generates at 67 tok/s with valid token IDs in `context` but empty `response`; dense models on the same instance are fine; no workaround as of v0.30.2 — if your `gemma4:31b` is MoE+quantized, **retry is wasted spend, switch models**.

This is ~22% of your sessions recoverable with zero model-quality work: switch the IR call to non-streaming, classify per the table in §5.3, retry off-budget with backoff, circuit-break per model-id.

### 1.3 The loop's entire value is feedback specificity, not iteration — by a factor of ~40
[RefineBench](https://arxiv.org/html/2511.22173v1) (1,000 problems, 11 domains, ~9.9 binary checklist criteria each, 5 turns):
- **Self-refinement over 5 turns: Gemini 2.5 Pro +1.8%, GPT-5 29.1%, DeepSeek-R1 −0.1%.**
- **Guided refinement (told which checklist items are unfilled): Claude-Opus-4.1 → 98.4%, a +79.7 point gain; o3-mini → 98.2%.**

Corroborated in the negative direction by [Huang et al., ICLR 2024](https://arxiv.org/abs/2310.01798): intrinsic self-correction degrades monotonically (GPT-4 GSM8K **95.5 → 91.5 → 89.0**; GPT-3.5 CommonSenseQA **75.8 → 38.1**), while the *same loop with oracle labels improves* (GPT-4 HotpotQA 49.0 → 59.0). [Kamoi et al., TACL 2024](https://arxiv.org/html/2406.01297v3): *"the bottleneck is in the feedback generation"*, and no prior work demonstrates self-correction from prompted-LLM feedback on **code generation or plan generation** specifically.

Consequence: a 3-attempt budget against a compiler that reports the **first error only** is gradient descent with one bit of gradient per step. Fix bandwidth before tuning the loop, or every stall rule you add just detects the same stall faster.

### 1.4 Your linear-IR-compiles-to-graph architecture is the one decision with unambiguous third-party validation — and it has a free upgrade
[ComfyBench (CVPR 2025)](https://arxiv.org/pdf/2409.01392v3) ran exactly your architectural question as an ablation. Code-like linearization (reversibly converted to the graph) vs native JSON graph: **62% vs 52% pass on vanilla tasks, 45% vs 25% on complex tasks.** Stated reason: *"the native JSON representation of workflows is inadequate for LLM-based agents to fully comprehend the intrinsic logic and dependencies."*

[Knowledge-Centric Agents for ComfyUI (arXiv 2607.15845)](https://arxiv.org/html/2607.15845v1) then adds the upgrade: invert real workflows into full pseudo-code → **skeleton pseudo-code (topology only) → strategy**, then generate top-down. **Execution pass 86.9% vs 36.4%; link completeness 98.3% vs 56.7%; valid node diversity 152 vs 42** — with a 14B model beating a 32B baseline. Its named failure modes are your audit verbatim: *"small mistakes such as misconnected links or inconsistent parameter bindings can easily make the workflow fail to execute"* and **rare nodes get substituted with common ones**. A 45-op flat prompt is exactly the condition that produces rare-op substitution — models fall back to `box`/`translate` and never reach `on_circle`, `remap`, `repeat_each`.

Never let anyone talk you into having the model emit React Flow nodes/edges. Do adopt **topology-skeleton-first, parameters-second**, and **per-op retrieval** (LL3M's BlenderRAG: 5× complex-op usage, −26% errors, [arXiv 2508.08228](https://arxiv.org/html/2508.08228v1)).

### 1.5 Constrained decoding is unavailable to you and would be nearly worthless anyway — the format tax is in the prompt
[Ollama docs, verbatim](https://docs.ollama.com/capabilities/structured-outputs): *"Ollama's Cloud currently does not support structured outputs."* Corroborated by [ollama#13206](https://github.com/ollama/ollama/issues/13206). Even locally, [ollama#15260](https://github.com/ollama/ollama/issues/15260) shows **`think=false` silently voids `format`** — format probability masking is deferred to the end-of-thinking token, which never appears — with **`gemma4` and `qwen3.5` named as affected**. No `logit_bias` on the OpenAI-compat surface either, so you can't even hand-roll a token ban.

And it doesn't matter: [The Format Tax (arXiv 2604.03616)](https://arxiv.org/html/2604.03616) resolves the 2024–25 contradiction between [Let Me Speak Freely](https://arxiv.org/abs/2408.02442) and [JSONSchemaBench](https://arxiv.org/abs/2501.10868) — **92% of statistically significant degradation appears with no decoder constraint applied at all.** Grammar-constrained decoding adds only **−1.6pp on top of the prompt's −3.9pp**. Closed-weight frontier models show near-zero tax; [Capacity, Not Format (arXiv 2606.09410)](https://arxiv.org/html/2606.09410) shows it's a headroom phenomenon — Sonnet 4.6 stable ~89%, **Haiku 4.5 88.7% → 52.5% (−36.2pp)** on MATH-Hard under JSON. Your model tier is the low-headroom band.

The validated mitigation, independently confirmed twice: **decouple reasoning from serialization.** Two-turn generation recovers **7–10pp** (Format Tax); delayed-structure ablation recovers **80–87% of lost performance** (Capacity, Not Format). One extra call. Do this instead of chasing vLLM/XGrammar self-hosting.

**Calibration note, so you don't over-correct:** 45% failure is *field-normal*. [Text2CAD-Bench](https://arxiv.org/html/2605.18430) L3 invalidity for general LLMs is **68–93%**; [CADBench](https://arxiv.org/html/2605.10873v1) has GPT-5.4 at **IoU 0.124, VSR 0.517** and Claude Opus 4.7 at 0.306 against purpose-trained CADFit's 0.895/1.000; [3D-PreMise](https://arxiv.org/pdf/2401.06437) baseline Pass@1 is 17.5%; [Hephaestus-CCX](https://arxiv.org/html/2605.17448v1) had GPT-5.5 and Opus 4.7 produce **zero strict-passing artifacts on first attempt** across 50 briefs. **The 25% no-graph is the anomaly** — that's an infrastructure number and the field has no excuse for it, nor do you.

---

## 2. THE THREE OPEN DECISIONS

### (a) Plane/frame placement type — YES, but minimal, and third in line

**Recommendation: add it, ship it in Wave 3, after the encoding-surface fixes and after point rendering. Two ops, not seven.**

The mechanism that makes it worth anything is **op-count collapse**, and that's measurable. Today *"a cylinder lying on its side at the top of a column, rotated 30° about its own axis"* is `point` + `vector` + `cylinder` + `rotate` (+ maybe `translate`), with a rotate/translate ordering hazard and an arbitrary implicit roll. With a plane it is `plane` + `cylinder(on=…)`. Fewer ops per intent → fewer first-error-abort opportunities inside your budget.

The math is not in dispute: a rigid frame is 6 DOF; **`center + axis` gives 5**. The missing DOF is roll about the axis, which is why you need a separate `rotate` op at all. Your backend already constructs the full frame — `BRepPrimAPI_MakeBox/MakeCylinder/MakeCone/MakeTorus` and every `gp_Pln` op take a [`gp_Ax2`](https://dev.opencascade.org/doc/refman/html/classgp___ax2.html) (origin + main direction Z + X direction, Y = Z × X). You are constructing it **lossily today**, picking an arbitrary X.

Convergent evidence is overwhelming: Grasshopper `Plane`, [Rhino `Rhino.Geometry.Plane`](https://developer.rhino3d.com/api/rhinocommon/rhino.geometry.plane) (with `Plane.Unset` as an explicit no-frame sentinel), OCCT `gp_Ax2`/`gp_Ax3`, Dynamo `CoordinateSystem`, Houdini's five orientation encodings with a published precedence table, Blender 4.2 deprecating `Align Euler to Vector` for a first-class **Rotation socket** plus an **`Axes to Rotation`** node, Sverchok matrices, [Substance 3D Designer's `Basis`](https://helpx.adobe.com/substance-3d-designer/substance-model-graphs/nodes-reference-for-substance-model-graphs/creation/basis.html) (a brand-new 2023+ system that independently reinvented the GH Plane), [CadQuery `Workplane`](https://cadquery.readthedocs.io/en/latest/workplane.html), [build123d `Plane`/`Location`](https://build123d.readthedocs.io/en/latest/location_arithmetic.html), [BOSL2 anchor/spin/orient](https://github.com/BelfrySCAD/BOSL2/wiki/attachments.scad). And your nearest commercial analogue — **KCL** — has `Plane` first-class with `startSketchOn(plane_or_face)`, `offsetPlane()`, `planeOf(sketch)` ([zoo.dev/docs/kcl-std](https://zoo.dev/docs/kcl-std)); the center+axis+rotate triple is exactly what KCL deliberately does *not* do.

**The strongest counterargument, stated fairly:**

1. **No direct A/B evidence exists.** Nobody has run frame-DSL vs coordinate-DSL on the same prompt set. Everything supporting planes is convergent-design and circumstantial: coordinate-frame mixing is a *named* failure category in [Embodied CAD (arXiv 2606.31252)](https://arxiv.org/html/2606.31252v1) (*"local and global frames are mixed, especially for mirrored or rotated features"*); [CADCodeVerify's](https://proceedings.iclr.cc/paper_files/paper/2025/file/81a934cd364e18ea6fdeaf57a93c17d4-Paper-Conference.pdf) taxonomy puts **Structural Configuration Error at 48%** but **Positional at only 8%**; and the tell is that CADCodeVerify instructs its question generator *"Try not to reference orientation the components of the 3D object"* — **the benchmark literature has been routing around orientation because models are bad at it.**
2. **A plane type that only accepts numbers still asks the model to author coordinates.** CadQuery's actual power is `faces(">Z").workplane()` — the frame is *derived from geometry the model never described numerically*. **C33D has no selector layer at all.** Absent that, you capture maybe half the benefit.
3. **Schema-prompt growth.** +2 ops, +1 parameter across ~22 ops. [GrandpaCAD's](https://grandpacad.com/en/blog/why-we-are-switching-to-openscad) token argument is real if your prompt is near the models' effective instruction-following limit — and per-op retrieval (§1.4) is a *different* fix for the same pressure.
4. **Risk of importing GH's worst failure mode.** The dominant practitioner complaint is not "planes are hard" but *"my planes' X axes are arbitrary and inconsistent"* — Bob Mackay on `Plane Normal`: *"Clearly this is enough information to define a plane, but not enough to constrain the orientation of the X and Y axes"* ([McNeel #135269](https://discourse.mcneel.com/t/axis-orientation-when-using-plane-normal/135269)). Add a silently-guessing `plane_from_normal` and you ship the bug wholesale.
5. **Ordering risk is the killer.** If you ship a new ref-typed slot that *also* rejects inline literals, you make 45% worse, not better.

**What decides it for you:** you cannot currently *measure* this bug class. [BenchCAD](https://arxiv.org/html/2605.10865v1) explicitly reports that single-axis IoU **underestimated failures**, and only **24-axis rotation-invariant voxel IoU** exposed models that build the right shape in the wrong frame. Build Tier 4 with rotation-invariant IoU and run the falsifiable experiment below before committing engineering.

**The experiment (one day of harness work, re-runs your 77 prompts under two schemas):** measure per session — ops emitted, `rotate` frequency, first-attempt compile rate, human-annotated wrong-orientation rate.
- Predicted **large gain**: radial/tilted/along-curve intents (balloon gores, temple pediment, spiral stair, `circular_pattern` of non-axis-aligned parts, `sweep`/`loft`/`pipe`).
- Predicted **~zero gain**: axis-aligned box stacks. Gains there mean you're measuring prompt novelty.
- Predicted **mechanism**: ops-per-successful-model drops, `rotate` frequency drops sharply, failure-rate improvement *tracks* the op-count drop. **If failure rate improves without op count dropping, the plane type is not doing what the theory says.**

**The type signature to ship (verbatim):**

```ts
type PlaneVal = {
  origin: [number, number, number];
  x_dir:  [number, number, number];   // unit, ⟂ normal (always resolved)
  normal: [number, number, number];   // unit
};                                     // y_dir = normal × x_dir, derived, never stored

op plane {
  base?:   "XY" | "XZ" | "YZ" | PlaneRef        // default "XY"
  origin?: [n,n,n] | PointRef                   // default [0,0,0] (or base.origin)
  normal?: [n,n,n] | VectorRef                  // default base.normal
  x_dir?:  [n,n,n] | VectorRef                  // default: projected base.x_dir,
                                                //   else deterministic ONB(normal)
  from_points?: [PointRef|[n,n,n], …3]          // A=origin, B→+X, C in +XY halfplane
  offset?: number                               // slide along normal
  spin?:   number                               // degrees about normal (the missing 6th DOF)
  flip?:   boolean                              // negate normal, keep x_dir
}                                               // modifiers applied in this fixed order
→ PlaneVal | PlaneVal[]

op frame_on {
  curve: CurveRef
  at: number | number[]                         // 0..1 params
  mode?: "perp" | "horizontal" | "rmf"          // default "rmf" (rotation-minimizing)
  up?: [n,n,n] | VectorRef                      // roll disambiguator, default world +Z
} → PlaneVal[]
```

Plus one universal optional parameter on every op currently taking `center` or `axis` (`box, cylinder, cone, torus, ring, circle, ellipse, arc, polyline, spline, grid, on_circle, points, extrude, revolve, sweep, pipe, loft, instances, linear_pattern, circular_pattern, scale, rotate`):

```
on?: PlaneRef | "XY" | "XZ" | "YZ" | { origin?, normal?, x_dir?, spin?, offset? }
```

**Four non-negotiable rules:**
1. **`on` accepts inline literals, string constants, node refs, and lists — all four.** If `on` is ref-only, do not ship it. (Houdini's lesson: permissive input, deterministic published resolution.)
2. **`center` retained and reinterpreted as local to `on`.** `cylinder(on=P, center=[0,0,5])` = 5 units along P's normal. Every existing graph without `on` (`on = XY @ origin`) keeps working byte-identically.
3. **`axis` retained as sugar, desugared losslessly:** `axis=v` ≡ `on={normal:v, origin:center}`. Deprecation *note*, never an error. Forbid `axis` + `on` together with a specific message.
4. **Every derivation deterministic, every repair reported.** Use [Duff et al.'s branchless ONB (JCGT 6(1))](https://jcgt.org/published/0006/01/01/paper-lowres.pdf) — not naive `cross(z, worldZ)`, which blows up on horizontal planes, your most common case; Frisvad 2012 is *"wrong by up to a factor of 2"* near z = −1:

```cpp
void branchlessONB(const Vec3f &n, Vec3f &b1, Vec3f &b2) {
  float sign = copysignf(1.0f, n.z);
  const float a = -1.0f / (sign + n.z);
  const float b = n.x * n.y * a;
  b1 = Vec3f(1.0f + sign * n.x * n.x * a, sign * b, -sign * n.x);
  b2 = Vec3f(b, sign + n.y * n.y * a, -n.y);
}
```
Branchless ONB is deterministic but **not continuous** — it flips at the z=0 equator, so `frame_on` must default to `"rmf"` (parallel transport), never `"perp"`.

**Repair before the `gp_Ax2` call.** `gp_Ax2(P, N, Vx)` raises `Standard_ConstructionError` if `Vx ∥ N` — a C++ exception in the worker, the worst possible error surface. Instead:

```
plane#3: x_dir [0,0,1] is parallel to normal [0,0,1] (0.0° apart). Used deterministic
fallback x_dir=[1,0,0]. To control roll explicitly, set spin=<deg> or give an x_dir
at least 1° off the normal.
```

**Naming, and this is free money:** [Text-to-CadQuery (arXiv 2505.06507)](https://arxiv.org/html/2505.06507v1) found *"most open-source models actually demonstrated familiarity with CadQuery syntax during pre-training"* (3B Qwen2.5 → 69.3% top-1 exact match; Mistral-7B invalid rate down to **1.32%**). Call it `plane`, constants `XY`/`XZ`/`YZ`, parameter `on=`/`workplane=`. **Do not invent `frame`, `basis`, `datum`, or `ax2`** — you get free prior probability mass from CadQuery, build123d, Grasshopper and Rhino all using the same word.

**The higher-value follow-on, and I'd rank it above `frame_on`:** a minimal **anchor vocabulary** — `on: {of: <solidRef>, anchor: "TOP"}` with BOSL2 semantics (`TOP`=[0,0,1], `RIGHT`=[1,0,0], additive `TOP+RIGHT`; `position()` moves only, `attach()` moves *and* rotates). "Put the roof on top of the columns" with zero numbers is the actual target, and it's fully generic — no preorders. Compare [ArtiCAD's Connector Contract](https://arxiv.org/html/2604.10992) (origin + primary axis + orthogonal reference + semantic label, fixed at *design* time before any geometry exists): **100% success on 120 assembly tasks, training-free**, because it *"transforms assembly from a combinatorial search problem into deterministic frame alignment."* Counter-datum to keep you honest: AIDL's ablation showed **removing constraints raised raw success 64% → 94%** while destroying editability — so a full constraint solver is a later, optional layer. Frame alignment gets most of the benefit at O(1) cost.

**Ship point/reference rendering in the same release. Do not ship planes headless.** Planes are invisible state; a user who can't see the frame can't see why placement is wrong.

---

### (b) The "loop until done" termination rule

**Recommendation: model-declared "done" is a *proposal*, not a decision. It must clear a deterministic machine gate. A failed gate becomes a checklist — which is the one regime where self-correction demonstrably works (+79.7 vs +1.8).**

Every production system converges on the same shape — model-declared done wrapped in **three independent machine kill-switches**: turn cap, cost/wall-clock cap, stuck detector. [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/agent-loop): text response with no tool calls, plus `maxTurns`/`maxBudgetUsd` with distinct result subtypes `error_max_turns`/`error_max_budget_usd`. [SWE-agent](https://swe-agent.com/latest/reference/model_config/): explicit `submit` tool + `per_instance_cost_limit` default **$3.00**. [Aider](https://github.com/Aider-AI/aider/issues/3450): `max_reflections = 3` hardcoded, triggered by *machine-detected* conditions (malformed SEARCH/REPLACE, lint failure, test failure) — never by the model deciding to retry. [OpenHands](https://docs.openhands.dev/sdk/guides/agent-stuck-detector): five-pattern detector on by default — identical action+observation ×4; same action→error ×3; 3+ consecutive no-progress agent messages; ping-pong over 6 cycles; repeated context-window errors — compared *semantically*, **ignoring IDs and metrics**.

Aider is your closest analogue: retry counter of 3, exactly your budget — **but Aider's linter and tests report all diagnostics, so each of its 3 rounds carries full information.** That is the entire difference.

**The rule, concretely.** Add exactly three fields to your existing per-turn record:

```ts
type TurnV2 = Turn & {
  programHash: string;      // sha256 of canonicalized IR (sorted args, ids stripped, floats→1e-6)
  compile: { ok: boolean; errorCount: number; errorSigs: string[] };
                            // errorSig = `${code}:${op}:${argName}` — NO line numbers, NO values
  eval:    { ok: boolean; solidCount: number; bboxVolume: number; nonFinite: boolean };
};

// Lexicographic, higher-is-better, deliberately domain-GENERIC. Honors "no preorders".
const progress = (t: TurnV2): number[] => [
  t.compile.ok ? 1 : 0,
  -t.compile.errorCount,
  t.eval.ok ? 1 : 0,
  t.eval.nonFinite ? -1 : 0,
  t.eval.solidCount > 0 ? 1 : 0,
  -t.isolatedCount,
  t.eval.bboxVolume > EPS ? 1 : 0,
];
const churn = (d: Turn['diff']) => d.addedNodes + d.removedNodes + d.changedNodes
                                 + d.addedEdges + d.removedEdges;
```

Stall reasons and thresholds — `NOOP` (churn 0 on 2 consecutive turns), `ERROR_FIXPOINT` (identical leading `errorSigs[0]` 3 turns running — mirrors OpenHands' action→error ×3 and Aider's cap; **this will be your dominant mode**), `OSCILLATION` (ABAB over 4 by `programHash`, or `programHash` revisited within 6), `CHURN_NO_PROGRESS` (churn > 0 but `progress()` not strictly improved for 2 turns — this is the single most valuable rule), `THRASH` (≥60% of the previous graph deleted, twice in 4 turns), `REGRESSION` (worse than `bestSoFar` for 2 turns), `CONVERGED` (gate passes AND last churn ≤ 2 → stop *happily*).

Justification for the aggressiveness: [arXiv 2509.13941](https://arxiv.org/html/2509.13941v1) found failed OpenHands tasks needed **54 rounds to cover 80% of failures** while successes mostly land within ~25, and **failed issues averaged 3.5× more interaction steps than successful ones**. Step count is a strong *negative* predictor. Its named modes map onto your rules: C2.1 Non-Progressive Iteration → `CHURN_NO_PROGRESS`; C2.2 Blind Strategy Switching → `THRASH`; C2.3 Validation Retreat. ~65% of failures are "cognitive deadlock."

`CONVERGED` has theory behind it. [Self-Correction as Feedback Control (arXiv 2604.22273)](https://arxiv.org/html/2604.22273v2) models the loop as a 2-state Markov chain and derives:

> **Refinement helps iff ECR / EIR > Acc / (1 − Acc)**

(ECR = incorrect→correct rate, EIR = correct→incorrect). As quality rises the bar rises hyperbolically — **a loop that helps at attempt 1 mathematically must stop helping.** They find a near-zero EIR boundary (≲0.5%) that only o3-mini, Claude Opus 4.6 and o4-mini stayed under, and observe four regimes: monotone degradation (GPT-4o-mini EIR 1.3%→3.8%, **−6.2pp cumulative**), absorbing lock, oscillation, beneficial convergence. Their "verify-first" prompt (force independent re-derivation before changing anything) took GPT-4o-mini EIR 2%→0% and flipped −6.2pp to +0.2pp.

**`bestSoFar` is mandatory, not optional.** Keep `argmax_t progress(h[t])` with its IR program. Every stall exit *and* budget exhaustion *and* user cancel restores it. Without it, `REGRESSION` has nowhere to land. **Free diagnostic on data you already have:** grep your 77-session timelines for `max(progress) > progress(final)` — that's a 20-line query and it directly measures your empirical EIR. If EIR > 1%, your loop is net-harmful and you should shorten it before doing anything else.

**The phase structure:**

```
A GENERATE  1 turn, unbudgeted: prompt → IR
B REPAIR    ≤6 turns, gated on MACHINE errors only. Feed the FULL error list back.
            [RefineBench-guided regime — expect large gains]
C DONE-GATE deterministic, domain-generic:
              compile.ok && eval.ok && !nonFinite
              && solidCount >= 1 && bboxVolume > EPS
              && isolatedCount == 0 && nodeCount >= 4
            PASS → user. FAIL → checklist feedback, max 2 rejections.
D REFINE    ≤3 turns, OFF BY DEFAULT. Entered only on explicit USER critique.
            Never on the model's own "this could be better."
            [RefineBench-self regime — expect ~+2%]
```

```ts
if (modelDeclaredDone) {
  const g = gate(currentTurn);
  if (g.pass) return finish(current, 'DONE_VERIFIED');
  if (rejectedDoneCount++ >= 2) return finish(best, 'DONE_REJECTED_TWICE');
  feedback = g.unmet.map(c => `- ${c.what}: ${c.observed}. Required: ${c.required}.`);
  continue;   // converts self-assessment (worst regime) into guided refinement (best)
}
```

**Budget defaults:** repair turns **6** (was 3 — but only *after* all-errors reporting lands; with full diagnostics 4–5 suffices, 6 gives headroom), refine **3**, total hard cap **10**, per-turn wall clock **90s** via `AbortSignal.timeout`, per-run **8 min**, output tokens **~8k/turn**, total **~120k soft (log, don't enforce)**. **Empty-response retries: 3, exponential backoff 0.5/1.5/4s, NOT charged to the repair budget** — retry with `temperature += 0.1`, and after 2 failures halve `max_tokens`. Fixed budget, **escalate only on explicit user action** (Claude Code pattern: `error_max_turns` is a distinct resumable state, UI shows "Stopped after 10 turns — 4 nodes still unwired. [Continue 5 more]"). Automatic escalation is anti-correlated with success: the tasks consuming the most budget are 3.5× less likely to succeed.

**Tell the model its budget coarsely and with consequences, never as the enforcement mechanism.** [BAGEN (arXiv 2606.00198)](https://arxiv.org/html/2606.00198v1): budget-estimation ability barely correlates with performance (r≈0.35); **systematic optimism bias across all models, and weaker models are *more* optimistic**; models still predict "feasible" after burning **60% of budget**; interval coverage caps at **47%** even after SFT+RL. But binary feasibility is trainable (25.5%→~90% with SFT alone) and **harness-side early stopping saves 28–64% of tokens on failed trajectories for 1.6–4.2pp success loss.**
- ✅ `"Attempt 4 of 6. After attempt 6 the run stops and whichever graph scored best is kept."`
- ❌ `"You have 47,231 tokens remaining."`
Stating the *consequence* makes the correct strategy legible — consolidate a working graph rather than gamble on a rewrite. Never show a countdown below 2 (panic-simplification risk in mid-tier models); the best-so-far rule makes a panic dump non-winning anyway.

**Strongest counterargument to allowing model-declared done:** self-assessment is the *specific* faculty that is broken, and **your model tier is the worst case**. The premature-completion literature says frontier models verify internally with near-zero premature termination but **"mid-tier models are most vulnerable"** ([agentpatterns.ai](https://agentpatterns.ai/anti-patterns/premature-completion/)) — qwen3.5 / glm-5.2 / gemma4:31b / deepseek-v4-flash / minimax-m3 are all mid-tier. Agents patch already-passing code >50% of the time; ~6.2pp of reported SWE-bench resolution involves untouched tests. A subset of your 25% no-graph sessions almost certainly terminated *believing they had succeeded*.

**Why the recommendation survives it:** only the model knows the intent-to-artifact gap. Your gate can verify a valid non-degenerate solid; it cannot verify "this reads as a hot air balloon." Deleting model-declared-done means either shipping machine-valid blobs or hard-coding object recipes — the latter violates "no preorders." The gate structure takes the win from both sides: the model proposes, the machine decides, and the machine's rejection is a *checklist* (the +79.7 regime), not a scold. **Mitigations with measured effect that address the counterargument directly:** reproduction-first prompting took GPT-4-mini's correct-code detection **24% → 77%**; pre-completion checklists took LangChain Terminal-Bench **52.8% → 66.5%**. What does *not* work: "be thorough" instructions and longer CoT.

**Worth testing before you commit to sequential repair at all.** Huang et al.'s budget-matched result — plain **self-consistency 85.3% vs multi-agent debate 83.2%** at 6 responses — plus [Weaver's](https://hazyresearch.stanford.edu/blog/2025-06-18-weaver) generation-verification gap (Llama 3.3 70B on GPQA Diamond: **82.8% oracle pass@100 vs 45.5% majority-vote, a 37.3-point gap**; individual verifiers 43–62% accurate, only ensembles of ≥20 weak verifiers reach 91%) suggests: at equal token cost, compare **1 run × 10 turns** vs **3 independent runs × 3 turns, pick best by `progress()`**. Given that 25% of your sessions produce *no graph at all*, three independent shots at a first graph likely crushes ten sequential repairs on one broken one. A day's work.

---

### (c) VLM judge — NO for evaluation, YES for in-loop feedback. These are different systems and conflating them is the trap.

**Recommendation: build Tier 0/1 (encoding + validity) and the perturbation suite first — they cost ~a week and will reproduce most of your 77 human labels. Build multi-view render + kernel-fact feedback *inside the repair loop* in Wave 4. Defer the VLM *judge* as a metric until you have an anchor set and controls.**

**Why automatic metrics are enough for now:** with 45% failure and 25% no-graph, **>90% of the variance in your 77 labels is explainable at Tier 0/1** — did it emit, did it compile, did it produce a valid solid. Mesh metrics and judges are premature optimization until the encoding surface is fixed. Execution/invalidity rate is the single most discriminative metric while a system is immature, and it saturates fast ([CADSmith](https://arxiv.org/html/2603.26512): 95%→100%). You're at ~55%; it's still your live signal.

**Why the judge specifically is not trustworthy as a metric yet:** [VLM Judges Can Rank but Cannot Score (arXiv 2604.25235)](https://arxiv.org/abs/2604.25235) — across 14 visual task families, judges reach **Pearson 0.30–0.46 / Spearman 0.29–0.45** with humans on absolute 1–5 scores while conformal intervals span **up to 70% of the score range**. Annotation noise dominates method choice. [De-biased VLM-as-3D-Judge (arXiv 2606.20364)](https://arxiv.org/abs/2606.20364) documents three 3D-specific failure modes: **seven images caused Qwen2.5-VL to answer purely by position — 100% order flips**; pretty rendering hides defects (Gaussian-splat renders made broken meshes look clean, judge split ~50/50 on geometrically flawed pairs); reference-free judging rewards clean-but-incorrect output. Position consistency across judges ranges **0.23–0.89** ([IJCNLP 2025](https://aclanthology.org/2025.ijcnlp-long.18.pdf)).

Also: **no paper reports a correlation coefficient between CD/IoU and human judgement for CAD.** [CADmium](https://github.com/chandar-lab/CADmium) explicitly concedes no large-scale human eval and states *"simple metrics often fail to reflect the quality of generated objects."* The only solid human protocol in the field is [neuralCAD-Edit](https://arxiv.org/html/2604.16170v1) (5 experts × instruction-following 1–7 and quality 1–7, acceptance = ≥5 on both, **ICC(2,k)=0.88**, human 78% acceptance vs GPT-5.2 25%).

**The strongest counterargument, and it is strong:** vision feedback *in the loop* is not optional and the effect sizes are enormous. [CADSmith](https://arxiv.org/html/2603.26512): ablating the vision judge degraded hard-tier Chamfer **35×**; the full pipeline took execution 95%→100%, median IoU 0.8085→0.9629, mean Chamfer **28.37→0.74 (38×)**. [CADCodeVerify](https://proceedings.iclr.cc/paper_files/paper/2025/file/81a934cd364e18ea6fdeaf57a93c17d4-Paper-Conference.pdf): 4 renders at 0/90/180/270 + self-generated verification questions → compile rate **96.5% (+5.5)**, point-cloud distance **−7.30%**. [Hephaestus-CCX](https://arxiv.org/html/2605.17448v1): 21 calibrated views raised requirement-pass **19.4% → 29.3%**.

**Resolution.** These results are about a *critic returning specific observations into a repair loop*, not about a judge producing a number you track over time. Build the former; defer the latter. And note the cheapest 80%: **[CADSmith's actual pattern is kernel facts + renders → judge.** Feed the model bbox in mm, volume, solid/face/edge/vertex counts, COM, watertightness **alongside** the images. That single move kills scale blindness and most hallucinated compliance, because countable claims become checkable. **You get all of it free from OCC.js on every successful compile** — no vision model required to catch "compiled but is a 4000mm teapot." [agentcad.dev](https://agentcad.dev/) returns exactly this on every run and treats the feedback design *as the product*. Add [AADvark's](https://arxiv.org/html/2604.15184v1) trick — color every face uniquely so the agent can disambiguate identical parts — which is directly applicable to `instances`/`linear_pattern` debugging.

**When you do build the judge, the acceptance protocol is pre-registered:** pairwise not absolute; **4 views in a 2×2 montage, not 8**; **mesh normal-map / matcap renders, not pretty shading** (*"holes and missing parts become unmistakable"*); order-swap with discard (keep only order-consistent verdicts); judge model from a **different family** than any model under test; and two controls every single run — **clear-gap** (good vs deliberately degraded, expect win-rate 0.83–1.0) and **base-vs-base** (expect ≈0.5). **Abort and mark the run invalid if clear-gap < 0.85 or base-vs-base outside [0.4, 0.6].** Score against a **frozen anchor set** (3–5 human-ranked outputs per prompt) via Bradley-Terry/Elo so numbers are comparable across runs. **Discard any numeric total the judge produces** — keep per-dimension verdicts and one-line justifications. Rubric: prompt fidelity, part-inventory completeness, structural plausibility (floating/interpenetrating parts), proportion, detail. Cost: ~60 prompts × 5 anchors × 2 orders ≈ 600 judge calls/night.

**What actually replaces the judge for your specific question ("is the intent encoded or just the instance?"):** the perturbation suite. That's §4.1 below and it's where you can be ahead of the field rather than behind it — **nothing published evaluates a node-graph IR under parameter perturbation.**

---

## 3. CONSOLIDATED BUILD ORDER

Effort in person-days. **⊢** marks a prerequisite for later items. Yield is expected effect on `usable_rate` unless noted.

### WAVE 0 — Encoding surface. Everything else is gated on this.

| # | Item | Days | Expected yield | Prereq for |
|---|---|---|---|---|
| **0.1** ⊢ | **Non-streaming IR call** + §5.3 empty-response taxonomy + off-budget retry w/ backoff + per-model circuit breaker & failover | 1–2 | **~17/77 sessions (≈22%) recovered outright**; without it `eval_count` is unavailable and rows 1–4 of the table are indistinguishable | 1.1, all loop work |
| **0.2** ⊢ | **Admissible alternatives in every diagnostic** — in-scope bindings of the required type, declaration order, cap 12; for bad op names, ≤12 nearest ops *within the same category* (curve/solid/transform/boolean), never all 45 | 2–3 | **+36–40pp** on repair success ([2607.14167](https://arxiv.org/html/2607.14167v1)) | 3.2 |
| **0.3** ⊢ | **All independent errors per attempt**, deduped by class, **dependency-ordered** (root errors before dependents), cap 8–10, with a "CONSUMED BY" section suppressing cascades | 1–2 | Converts 1 bit/round into a checklist; the +1.8→+79.7 regime shift | 2.1, budget change to 6 |
| **0.4** ⊢ | **Partial acceptance**: statement-level recovery (newline *is* the recovery set — no bracket resync needed for a linear IR), `PoisonBinding{name, reason}`, transitive reachability pass, **commit + render the valid subset** | 3–5 | **Makes zero-graph nearly impossible**; directly attacks 25% | 0.6, replay overlays |
| **0.5** | Make `union`/`difference`/`intersect`/`compound` **variadic** (kill the 4-part cap); **promote both coercions to first-class syntax** (inline literals legal in ref position, bare names legal where unambiguous) | 1–2 | Removes two per-run turn costs; removes the Postel objection entirely by eliminating the deviation | 3.2 (`on` must be polymorphic from commit one) |
| **0.6** | Feed the compiler's **canonical reprint of the accepted program** into the retry prompt, not the model's original text; `note:` every remaining coercion, on success as well as failure | 1 | Repair becomes *extension*, not *rewrite*; blocks dialect drift through the loop's own context | — |
| **0.7** | Rewrite diagnostics to FeedbackEval's **Mixed** composition (diagnostic + guidance + concrete suggested fix), using the template in §5.2 | 1–2 | **63.6% vs 49.2%** Repair@1 | — |

### WAVE 1 — Measurement. You cannot claim Wave 0 worked without this.

| # | Item | Days | Yield | Notes |
|---|---|---|---|---|
| **1.1** ⊢ | **Tier 0 + Tier 1 harness**: `emitted_response`, `parsed_ir`, `produced_graph`, `attempts_used`, `error_class` taxonomy, `errors_reported_per_attempt`, op histogram; + `BRepCheck_Analyzer`, watertight, manifold, no self-intersection, volume>0, solid count, **Exact Euler Characteristic**, dangling-edge length, inter-part overlap volume | 2–3 | Reproduces most of your 77 labels; `empty_response_rate` reported **separately** as a provider metric | 1.5, 4.x, 5.4 |
| **1.2** ⊢ | **TurnV2 logging**: `programHash`, `errorSigs[]`, `progress()` vector, `churn`, phase, stall reason, raw provider response length | 1 | Prerequisite for the stall rule | 2.1 |
| **1.3** | **Re-code the 77 labels** to a 4-point ordinal (0 no-graph / 1 compiles-but-degenerate / 2 plausible / 3 good) + binary `usable`; blind re-code a shuffled 30 ≥1 week later; compute **Krippendorff's α (ordinal)** as your agreement ceiling | 1 | Expect α ≈ 0.7–0.85 — **that caps what you can claim** | pre-registration |
| **1.4** | Retro-query existing sessions for `max(progress) > progress(final)` | 0.5 | **Empirical EIR.** If >1%, shorten the loop before anything else | — |
| **1.5** | **Ablation axis baked into the harness: {first-error-only vs all-errors} × {3 vs 6 attempts}** | 1 | Turns the harness into the instrument that proves your audit's central claim | — |

**Statistics discipline, pre-register it:** n=77 with a 45/55 split gives AUC SE ≈ 0.06 → 95% CI ≈ **±0.13**. Fit nothing, or an unweighted Tier0+Tier1 composite, or at most logistic regression with **≤3 predictors**, LOO-validated. **Stratify** — report separately on the `graph produced` subset (n≈58), or the no-graph cases create trivial separation and you will fool yourself. Acceptance: composite AUC ≥ 0.85 with lower CI bound ≥ 0.75.

### WAVE 2 — Loop and generation strategy

| # | Item | Days | Yield | Prereq |
|---|---|---|---|---|
| **2.1** | `detectStall` + `bestSoFar` + done-gate + phase structure; budget 6/3/10 | 2–3 | Kills `CHURN_NO_PROGRESS`/`THRASH`/`REGRESSION` waste; recovers destroyed-best-work runs | 1.2, 0.3 |
| **2.2** | **`RunController` + cancellation architecture**: `AbortController` → fetch/stream; `SharedArrayBuffer` `Int32Array` cancel flag polled *between* IR ops in the worker; **250 ms escalation to `worker.terminate()`**; generation counter; **prewarmed spare worker** | 3–4 | Cancel feels instant; OCCT booleans in wasm are uninterruptible so you need both mechanisms. Requires COOP/COEP (`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`); if unavailable, terminate-only | independent |
| **2.3** | **Two-turn generation**: Turn A free-form geometric plan in prose (parts, relations, rough dimensions, no IR syntax) → Turn B serialize to IR | 1–2 | **+7–10pp** (Format Tax) / **80–87% of format loss recovered** (Capacity, Not Format) | — |
| **2.4** | **Topology skeleton → parameters**: pass 1 emits the op DAG with symbolic names and no numbers, pass 2 fills literals/exprs. Both passes stay in the linear IR | 2–3 | **86.9% vs 36.4%** execution pass, **98.3% vs 56.7%** link completeness ([2607.15845](https://arxiv.org/html/2607.15845v1)); Hephaestus blueprint stage **IoU 0.444→0.592** | run as one experiment with 2.3 — they may be the same effect |
| **2.5** | **Kernel facts returned on every *successful* compile**, not just failures: bbox mm, volume, solid/face/edge/vertex counts, COM, watertightness | 1 | Nearly free with OCC.js; catches "compiled but is a 4000mm teapot" with no vision model | 1.1 |
| **2.6** | **Per-op retrieval**: 5–8 op cards with worked examples per turn, weighted by what the plan implies, replacing the flat 45-op prompt | 2–3 | **5× complex-op usage, −26% errors** (BlenderRAG); directly attacks rare-op substitution | 2.4 helps select |
| **2.7** | Few-shot IR exemplars as a **versioned, measured asset**, chosen for *op-argument-shape coverage* (reference args, assembly arity), not object coverage | 1 | Constrained/structured generation shows **steeper gains from demonstrations**; with no decoder constraint available these carry more load | — |

### WAVE 3 — Geometry surface

| # | Item | Days | Yield | Prereq |
|---|---|---|---|---|
| **3.1** ⊢ | **Render points + reference geometry.** Screen-constant markers via `InstancedMesh` of unit quads expanded on the camera's right/up basis (`worldSize = pixelSizePx * (2·tan(fov/2)·dist) / viewportHeightPx`; ortho: `pixelSizePx * ((top−bottom)/zoom) / viewportHeightPx`). **Ship a size slider from day one.** Two depth modes: *occluded* (`depthTest:true, depthWrite:false, transparent:true, renderOrder:900, polygonOffset:true, polygonOffsetFactor:-1`) and **X-ray** (`depthTest:false, renderOrder:999`) for interior points | 2–3 | Best debugging affordance available; **~30–35% of the placement lens's value, almost all on the human axis** | 3.2, 4.2 |
| **3.2** | **`plane` type + universal `on` param** + `spin`/`flip`/`offset` + Duff ONB + repair reporting; `axis` → deprecated lossless alias | 5–8 | Op-count collapse on radial/tilted/along-curve intents; ~0 on box stacks | 0.2, 0.3, 0.5, 3.1, **and the 4.3 measurement** |
| **3.3** | **Anchor vocabulary** — `on: {of: <solidRef>, anchor: "TOP"}`, BOSL2 semantics, `position()` vs `attach()` | 3–5 | *Higher value than `frame_on`.* "Roof on top of the columns" with zero numbers. Fully generic | 3.2 |
| **3.4** | `frame_on(curve, at, mode="rmf", up)` | 3 | Curve-derived frames for sweep/loft/pipe | 3.2 |
| **3.5** | Plane gizmo rendering: `PlaneGeometry` quad at opacity 0.10–0.15 `DoubleSide` + full-opacity `LineSegments` border + normal arrow + **red/green X/Y ticks** (X=red, Y=green, Z=blue is universal — do not deviate); two-sided tinting so normal direction is readable | 1–2 | Surfaces the flipped-normal / `invert` bug class visually | 3.2 |
| **3.6** | AIDL's free rule: **forbid references to geometry created after a boolean.** No selector layer needed | 0.5 | Sidesteps the entire face/edge-selection problem at zero cost | — |

### WAVE 4 — Eval depth

| # | Item | Days | Yield | Prereq |
|---|---|---|---|---|
| **4.1** | **Perturbation / metamorphic suite MR1–MR6** + derived scalars | 4–6 | **Where you can be ahead of the field.** Validate by construction (unit tests on hand-authored good/bad graph pairs), not against the 77 labels | 1.1 |
| **4.2** | **Multi-view render + kernel-fact feedback in the repair loop**: 4 views at 0/90/180/270, normal-map/matcap, unique face colors, + the 2.5 fact block | 3–4 | **+5.5pp compile rate, −7.30% PCD** (CADCodeVerify); **35× hard-tier Chamfer** (CADSmith ablation) | 3.1, 2.5 |
| **4.3** | Tier 4 reference metrics on subset A only: CD (report **both** unit-bbox-normalized *and* absolute mm — they are different metrics), Vol-IoU **+** Surface-IoU (ρ = 0.45, not interchangeable; CD↔Surface-IoU ρ = −0.85), F1@τ on 30k surface points, normal consistency, **24-axis rotation-invariant voxel IoU** | 3 | **Non-optional given the missing frame type** — single-axis IoU *underestimates* exactly your dominant bug class | 1.1; **gates 3.2** |
| **4.4** | VLM pairwise judge with anchor set + full control protocol | 5–7 | **Defer.** Only after 4.1–4.3 and a purpose-collected ~200-comparison pairwise preference set | 4.2, 1.3 |

**Prompt set to freeze and version (~60 prompts × k=3 at fixed seeds; report mean, `pass@3`, and `pass^3`):** A. Spec-exact (15, you author ground-truth IR + STEP — the only tier where CD/IoU are meaningful). B. Procedural step-by-step (15, scored by op-recall against an expected op multiset). C. Open-ended nouns (20 — perturbation + pairwise only). D. **Op-coverage probes (10, each of the 45 ops exercised ≥2× → a per-op success matrix**, the direct instrument for encoding-surface debugging).

**Perturbation suite, concretely** — auto-discover perturbable parameters (numeric literals reachable from `expr`/`range`/`series`/pattern counts), then:

| MR | Perturbation | Must hold | Diagnoses |
|---|---|---|---|
| MR1 Monotonicity | scale a length param by k ∈ {0.5, 0.8, 1.25, 2} | bbox extent monotone in k; volume non-decreasing for k>1 | inverted/broken dependency |
| MR2 Cardinality | pattern/`instances` count n → n±1 | solid count changes by exactly the expected delta | **instance vs intent** — 12 hand-placed cylinders have no count param, score 0 |
| MR3 Continuity | sweep each param, N=9 samples across ±30% | no descriptor jump > τ·range; **Euler characteristic constant** | fragile topology, accidental booleans |
| MR4 Rigid invariance | perturb a top-level `translate`/`rotate` param | volume, area, genus **exactly** invariant (1e-6); relative COM offsets preserved | **hard-coded absolute coordinates — i.e. the missing frame type.** A temple whose columns detach when the base rotates fails here |
| MR5 Commutation | permute `union`/`compound` operand order | identical volume within tolerance | non-associative assembly bugs; the 4-part cap |
| MR6 Degeneracy floor | push a param to 0 / negative / 100× | must fail **loudly** with a typed error, never silently emit an invalid solid | error-surface honesty |

Derived scalars, all ∈[0,1], all headless: **VFDS** (fraction of a 64-sample Latin-hypercube producing a valid solid — [Fab Forms](https://cdfg.mit.edu/publications/fab-forms-customizable-objects-fabrication-validity-and-geometry-caching)); **topological stability** (fraction of sweep steps preserving solid count and Euler char.); **smoothness** (1 − normalized max descriptor jump; empirical Lipschitz — the [ShapeCoder](https://arxiv.org/pdf/2305.05661) analogue, where good abstractions kept Fréchet distance at 84 vs 157 at noise level 0.5); **discrete parametric effectiveness** (rank of ∂(descriptors)/∂(parameters) normalized by parameter count — the [Robinson et al.](https://link.springer.com/article/10.1007/s00366-011-0248-4) PE analogue); **intent ratio** (numerics reachable from named `expr`/`range` nodes ÷ total numeric literals); **structural sharing** (fraction of nodes with fan-out > 1) and **compression ratio** (flattened op count ÷ actual op count — a temple with `circular_pattern` compresses, twelve hand-placed cylinders does not).

**Every MR is object-agnostic. No MR mentions columns or roofs. This is fully compatible with "no preorders."**

### WAVE 5 — Replay / video. Real value, but it's the eval surface, not the demo.

| # | Item | Days | Prereq |
|---|---|---|---|
| **5.1** | `StepPlan` data model derived from existing snapshots; **acceptance test: `seek(t)` twice at the same `t` produces byte-identical renders** | 2–3 | 0.4 (for `state: 'error'`/`'orphan'`) |
| **5.2** | Viewport replay + timeline scrubber + the five overlays | 5–8 | 5.1, 3.1 |
| **5.3** | Record via [`canvas-record`](https://github.com/dmnsgn/canvas-record) → [mediabunny](https://mediabunny.dev/) | 2–3 | 5.1 |
| **5.4** | **Headless CI reels** — Playwright driving the same in-page recorder, one reel per benchmark prompt per model, artifacted next to session annotations | 2–3 | 1.1, 5.3 |

**Identity is the crux, and your geometry hash already gives it to you.** Key every mesh by `nodeId`, pass `geomHash` as a *prop*:

```tsx
{meshes.map(m => <ReplayMeshView key={m.nodeId} geomHash={m.geomHash} {...m} />)}
```
`key={nodeId}` keeps the component mounted so animation state survives; `geomHash` changing as a prop triggers an in-place crossfade instead of unmount/remount. **Remounting is what causes flicker**, and r3f disposes geometry/material on unmount — use `dispose={null}` on the replay group.

**On morphing between two different meshes: don't.** The three.js consensus is that smooth morphing requires per-vertex correspondence and matching counts; your OCCT tessellations have neither, and a `difference` changes topology. Use **dissolve-out + op-specific-reveal-in** ([Codrops dissolve implementation](https://tympanus.net/codrops/2025/02/17/implementing-a-dissolve-effect-with-shaders-and-particles-in-three-js/), Feb 2025) — it's a *material* change so it composites correctly with depth.

**Deterministic capture, not `MediaRecorder`.** `canvas.captureStream()` + `MediaRecorder` is realtime by construction — a 400 ms frame gives you a *held* frame, not a slow one ([w3c/mediacapture-record#213](https://github.com/w3c/mediacapture-record/issues/213), open since 2015). The 2026 recipe:

```ts
const source = new CanvasSource(canvas, { codec: 'avc', bitrate: QUALITY_HIGH });
const output = new Output({ video: source, format: new Mp4OutputFormat(), target: new BufferTarget() });
await output.start();
for (let f = 0; f < total; f++) {
  const vT = f / FPS;              // virtual seconds — the ONLY clock
  plan.seek(vT);                   // pure function of vT
  controls.update(1 / FPS);        // FIXED delta — camera-controls is SmoothDamp-based
  advance(vT, true);               // r3f frameloop="never", renders synchronously
  await source.add(vT, 1 / FPS, { keyFrame: f % (FPS * 2) === 0 });  // ⟵ backpressure
}
```
Load-bearing details: `await source.add()` is both your backpressure and your determinism — a 400 ms geometry upload makes the *export* slower, not the *video*. `preserveDrawingBuffer: true` on the `gl` prop or you capture black frames. **Every `useFrame` must read `state.clock.elapsedTime`, never `+= delta`** — any accumulation makes the recording differ from the preview. First frame must be a keyframe; timestamps are microseconds if driving `VideoEncoder` directly.

**Animation numbers (established):** most animations **100–500 ms**, usable band **100–400 ms**, at 500 ms it "starts to feel like a real drag" ([NN/g](https://www.nngroup.com/articles/animation-duration/)); entry longer than exit (300 in / 200–250 out); **default to ease-out** — `cubic-bezier(0.0, 0.0, 0.2, 1)` for every mesh reveal; standard `cubic-bezier(0.4, 0.0, 0.2, 1)`; linear "looks weird and unnatural" *except* camera orbits. Staggering: use GSAP's **`amount`** (total spread divided among N), **never `each`** — instance counts vary wildly and `each` blows your step budget at N=400. `from: "center"` for `circular_pattern`, `"start"` for `linear_pattern`, `"edges"` for `grid`. Manim's `lag_ratio` semantics (default 0.05, **does not extend total runtime**) are exactly what you want for "reveal 200 instances inside a fixed 600 ms step." Baseline **600 ms/step** (250 anim + 350 hold), 900 ms with a caption, 400 ms for pure data ops. Camera: **never move the camera during a geometry reveal** — three behaviours only (Hold / Reframe via `fitToBox` when union bounds grow >20% / Punch-in, max 2 per video), a 4–6°/s orbit bed under everything, **hard cut only on turn boundaries where the graph was replaced after a compile failure** — the cut is the honest signal that this is a different attempt.

**The five overlays, ranked by diagnostic yield for *your* failure modes:** (1) **bidirectional provenance cross-highlight** (mesh ↔ React Flow node ↔ timeline chip, colors from `hash(nodeId) → hue` shared across all three panes — Fusion's component-color trick, the cheapest high-yield legibility win); (2) **null-geometry gutter** with Onshape's three-tier vocabulary mapped onto your taxonomy — **red = compile error, yellow = unresolved reference argument (your #1 root cause), blue = legal-but-unwired** — rendering "produced null" as a dashed wireframe of the *expected* bbox; (3) **orphan/dead-code overlay** via backward reachability from terminal assembly nodes — **this directly visualises the 4-part cap: you will see 4 wired parts and N orphans, a screenshot that makes the bug self-evident**; (4) **intent captions per step** (the model's stated rationale as a lower-third) — the mismatch between stated intent and rendered result is your fastest failure classifier; (5) **attempt/retry lanes** — three stacked lanes each dying on a different single error is a *picture* of the one-error-at-a-time pathology. Make all of these an **overlay mode on the existing graph**, not a separate view (Houdini's convention): `graph overlay: none | timing | provenance | error | diff | orphan`.

---

## 4. CONTRADICTIONS AND OPEN QUESTIONS

### 4.1 Direct disagreements between the reports

**Repair budget: 3 or 6?** The DSL-repair lens says **keep it at 3** — [Is Three the Magic Number? (arXiv 2607.05197)](https://arxiv.org/html/2607.05197v1), tested on *Gemma-4 and Qwen3.5 specifically*, finds the first 3–4 iterations capture most gains and steps 5–7 are near zero; [How Many Tries (arXiv 2604.10508)](https://arxiv.org/html/2604.10508) puts 76–95% of achievable gains in the first two rounds. The agent-loops lens says **raise to 6**, reasoning that Aider's 3 comes with full diagnostics while yours comes with one. **Resolution: they don't actually conflict — sequence them.** Ship all-errors reporting (0.3) at budget 3, measure, *then* decide. Do not raise the budget to compensate for one-error-at-a-time; that pays generation cost to avoid a formatting change. The ablation (1.5) resolves it in a day.

**Plane priority.** The placement lens ranks planes **second-priority, worth ~⅓ of what the encoding fixes are worth, and actively harmful if shipped first.** The competitive lens ranks "add a first-class `plane`/`frame` type and **delete** the center+axis+rotate triple" as ADOPT #2. **Resolution: the competitive lens is reasoning from KCL/AIDL/Autodesk design evidence; the placement lens is reasoning from your audit.** Your audit wins on sequencing, the competitive scan wins on direction. Hence Wave 3, and hence the four non-negotiable rules (a new ref-typed slot that rejects literals makes 45% worse).

**Report-all-errors: no controlled evidence exists.** Both lenses flag this. [2607.05197](https://arxiv.org/html/2607.05197v1) and [2604.10508](https://arxiv.org/html/2604.10508) *explicitly decline* to analyze one-at-a-time vs batched. [2607.14167](https://arxiv.org/html/2607.14167v1) reported one *failure* at a time, but that was one atomic validation failure per candidate, not deliberate suppression of co-occurring errors. **This is your #1 self-run experiment** and it's the reason 1.5 exists. The arithmetic argument (N independent defects, 1 surfaced per attempt, 3 attempts ⇒ cannot converge for N>3) is compelling but is *your inference*, not published.

**VLM judge: "defer" vs "not optional."** Resolved above by separating **judge-as-metric** (defer — Pearson 0.30–0.46, 70%-wide intervals) from **critic-in-loop** (build — 35× and +5.5pp effects). If you take one thing: the effect sizes in the loop literature come from *specific observations returned into a repair turn*, which is the same mechanism as the +36–40pp admissible-alternatives result. It is not a scoring mechanism.

**Self-preference bias magnitude is contested.** [arXiv 2410.21819](https://arxiv.org/abs/2410.21819) establishes it; [arXiv 2601.22548](https://arxiv.org/html/2601.22548) partially deflates the effect size. Treat "self-preference is huge" as contested, "nonzero and directionally bad" as established. It's an argument for cross-family judges, not for abandoning model-declared done.

**Coercion: BAML vs Postel.** [BAML's Schema-Aligned Parsing](https://boundaryml.com/blog/schema-aligned-parsing) has the numbers (GPT-4o Mini **19.8% function-calling → 92.4% SAP** on BFCL; Claude 3 Haiku 57.3% → 91.7%) and the maintainability argument (*"grammars can be virtually impossible to maintain long term"* — live for a 45-op IR under active development). [draft-thomson-postel-was-wrong](https://datatracker.ietf.org/doc/html/draft-thomson-postel-was-wrong-03) has the failure mode: leniency **displaces the specification**, and tolerance becomes unremovable. **The synthesis is the HTML5 move** — standardize the leniency: write every coercion into the IR spec, versioned and tested; coerce only where the mapping is **total and unique** (inline-literal lifting ✓; bare-name resolution when it resolves to exactly one in-scope binding of the right type ✓; **scalar→vector broadcast ✗** — `translate(x=5)` → `[5,0,0]` is a guess, make it an error with both alternatives listed); echo the canonical parsed form on success *and* failure; and for the two named cases, **promote them to first-class syntax so there's no deviation to normalize at all.** Your ~92% compile-loop reduction is in-family with BAML's results and should be regarded as expected, not lucky.

### 4.2 Where the evidence is thin — run your own experiment

1. **Frames vs coordinates for LLM authoring: no A/B exists anywhere.** I'd put moderate confidence this is a paper you're positioned to write. Run the two-schema re-run of your 77 prompts (§2a) before committing 5–8 days to 3.2.
2. **One-error vs all-errors under a fixed budget.** Nobody has run it. (1.5)
3. **K independent samples vs sequential repair at equal token cost.** Huang et al.'s self-consistency-beats-debate result plus Weaver's 37.3-point generation-verification gap suggests 3 runs × 3 turns may crush 1 run × 10 turns, *especially* given 25% no-graph. A day's work.
4. **Your empirical EIR.** Computable retroactively from existing timelines (1.4). This single number tells you whether your loop is currently net-harmful.
5. **"Escalate on evidence of progress."** If the last 2 turns each produced a strict lexicographic improvement when the budget expires, grant +2 turns once. Untested anywhere; the natural dual of the stall rule; cheap A/B.
6. **Your prompt corpus may be depressing your own numbers.** [Text2CAD-Bench](https://arxiv.org/html/2605.18430) reports that **geometric-description prompts consistently outperform procedural-sequence prompts** across all tested models. You test with procedural step-by-step descriptions. **A/B this before concluding anything about op coverage.** This is cheap and could re-frame your entire audit.
7. **`BatchedMesh` CPU overhead** ([three.js #28776](https://github.com/mrdoob/three.js/issues/28776)) may make it *slower* than N plain meshes at your scale. Benchmark before Wave 5 Phase 7. Its `setVisibleAt` is otherwise the ideal replay primitive (add every geometry once, flip visibility per step, zero re-upload).
8. **Chamfer distance normalization is not standardized** — Text2CAD-Bench normalizes to unit bbox, CADSmith uses absolute mm. **These are different metrics and the choice flips rankings.** Report both, always. And no paper anywhere reports a CD↔human correlation coefficient for CAD; treat any such claim as unsupported.
9. **The 77 labels cannot validate Tier 3 at all.** One annotator, one view, one glance — they encode view-dependent judgement. A graph that shatters when a slider moves looks fine in a render. Validate Tiers 0/1/4 against the 77; validate Tier 3 **by construction** (unit tests on hand-authored good/bad pairs); validate Tier 5 against a **new, purpose-collected ~200-comparison pairwise set**.
10. **Sweep/loft/pipe already have implicit internal frames** that may disagree with an explicit `on`. Define precedence before you ship 3.2: explicit `on` on the *profile* wins; `on` on the sweep op sets the start frame only.

### 4.3 Two structural gaps nobody's evidence resolves for you

- **No fillet/chamfer/shell in the 45-op set.** [BenchCAD](https://arxiv.org/html/2605.10865v1) flags missing advanced ops (twist-extrude, loft, helical sweep) as a top-three deficiency of generated code. No amount of pattern vocabulary substitutes. Decide deliberately whether this is out of scope for a procedural/architectural system or a real hole.
- **No face/edge selection layer.** [Pointer-CAD](https://arxiv.org/html/2603.04337v1) solves it with learned pointers into B-Rep entities (a research project, not a weekend). **AIDL sidesteps it for free** by forbidding references to geometry created after a boolean — adopt that rule today (3.6); it costs nothing and removes an entire ambiguity class. Anchors (3.3) then cover the common case without a selector.

### 4.4 Where you're actually defensible — hold this line

Nobody credible ships **the graph as the human-editable artifact**. Zoo hands you KCL text; Adam hands you OpenSCAD; agentcad hands you Python; Onshape's coming MCP hands you FeatureScript. All hand the human a *program* — precisely the artifact non-programmers can't edit, and Zoo's own language engineer [names this as KCL's unresolved tension](https://www.ncameron.org/blog/kcl-part-0/): the human-friendly design and the LLM-friendly design pull in opposite directions, because *"AI models expect to write KCL which is more like existing languages."* C33D's answer — LLM writes a program, human edits a graph, in a browser, no install — is the resolution, and Grasshopper is the only ecosystem with that property, sitting behind a $1k+ Windows-only license with unbenchmarked plugin-ware AI tooling.

Second: your op vocabulary (`on_circle`, `grid`, `jitter`, `tile`, `repeat_each`, `remap`, `series`, `instances`) is **procedural/pattern**, not mechanical-part. That's Text2CAD-Bench's L4 tier and CADBench's CAD-Organic family — exactly where every mechanical-CAD system is weakest and where "greek temple / hot air balloon" lives. Pattern ops compose combinatorially; extrude-and-fillet ops don't.

**Avoid, unambiguously:** letting the model emit the node graph directly (62/52 and 45/25); making the IR *more* graph-like; making the IR exotic (constrain semantics, keep syntax boring — Anka's DSL hit **99.9% zero-shot parse and +40pp over Python on multi-step pipelines** by being *explicit*, not unfamiliar; AMPL beat Python **94.7% vs 79.8%** executability); competing on mesh/scan→B-Rep, a geometry kernel, or a trained CAD foundation model (CADFit 0.895 IoU vs best general LLM 0.306; Backflip has $30M on scan-to-CAD; and **Zoo, having built its own GPU CSG engine, still ships v1 without assembly mates or Constraints 2.0**); and shipping object recipes — though note that "no preorders" does *not* mean "no abstraction." AIDL's ablation showed removing hierarchy degraded local editability, and its stated advantage over OpenSCAD was outputs *"hierarchically organized with meaningful part names"* vs flat vertex soup. **No shipped `column()` op; yes to the model defining and reusing its own named sub-programs within a session.** That is generic capability. ShapeCoder's whole thesis is that abstractions should be *discovered*, not hand-authored.

---

## 5. ARTIFACT APPENDIX

### 5.1 Ollama / provider field names you need
Native `/api/chat`, `/api/generate`: `done`, **`done_reason` ∈ `"stop" | "length" | "load" | "unload"`**, `message.content`, **`message.thinking`**, `response`, `prompt_eval_count`, `eval_count`, `total_duration` (ns).
OpenAI-compat: `choices[0].finish_reason` (**can be `null`** — [ollama#7547](https://github.com/ollama/ollama/issues/7547)), `usage.prompt_tokens`, `usage.completion_tokens`. **Not supported: `tool_choice`, `logit_bias`, `logprobs`, `n`.**
OpenRouter: `choices[0].finish_reason` + **`choices[0].native_finish_reason`**; errors via **`error.metadata.error_type`** (`context_length_exceeded`, `max_tokens_exceeded`, `token_limit_exceeded`, `content_policy_violation`, `refusal`, `provider_overloaded` 503, `provider_unavailable` 502, `rate_limit_exceeded` 429, `timeout` 504, `server` 500, `unmapped`, `invalid_request`), plus `error.metadata.reasons[]`, `error.metadata.flagged_input` (≤100 chars). **Mid-stream errors arrive as a `chat.completion.chunk` with a top-level `error` object and `finish_reason: "error"`** — invisible if you only read `delta.content`.
OpenAI Responses: `status: "incomplete"`, **`incomplete_details.reason: "max_output_tokens"`**, `usage.output_tokens_details.reasoning_tokens`.

### 5.2 Error-message template (ship this shape)

```
COMPILE REPORT — 2 of 7 ops rejected. 5 ops compiled and are on the canvas.

[E-REF-001]  op #4  `extrude`  arg `profile`
  you wrote:   profile: circle(r=3)
  problem:     `profile` takes a reference to a named binding, not an inline op.
  fix:         bind the circle first, then reference it:
                 c1 = circle(r=3)
                 s1 = extrude(profile=c1, height=10)
  admissible here: any binding whose value is a curve or wire.
                 in scope now: base_circle, rim, outline, prof_a
  note:        I auto-lifted this for you as `_auto_profile_4 = circle(r=3)`.
               Accepted, but write it explicitly next time.

[E-ARITY-002]  op #9  `union`
  you wrote:   union(a, b, c, d, e, f)   (6 parts)
  problem:     `union` accepts at most 4 parts.
  fix:         nest them:
                 u1 = union(a, b, c, d)
                 u2 = union(u1, e, f)
  admissible here: 2..4 references to solids.
                 solids in scope: a, b, c, d, e, f, shell, cap

CONSUMED BY THESE FAILURES (not separately broken):
  op #12 `translate` — depends on op #9
  op #15 `compound`  — depends on op #12

STILL VALID AND RENDERED: base_circle, rim, outline, prof_a, shell
```
Header = partial-acceptance signal (the loop is converging, not restarting). `admissible here` is the **+36–40pp field**. "CONSUMED BY" is the [Clang secondary-diagnostic suppression](https://discourse.llvm.org/t/suppress-secondary-diagnostics-for-typo-correction/56819) practice. Stable codes (`E-REF-001`) so you can measure **which diagnostics actually resolve on retry** — the only way to iterate on this template empirically. **Codes describe encoding failures, not objects; no "no preorders" violation.** Prose, because format was measured at 0–2pp.

### 5.3 Empty/truncated response diagnosis (abbreviated — prerequisite: non-streaming)

| Signature | Diagnosis | Action |
|---|---|---|
| `content==""` + `done_reason=="length"` + `eval_count>0` + **`message.thinking` non-empty** | reasoning-token exhaustion | 2× `num_predict`, or lower `reasoning_effort`. **Never `think=false`** (voids `format`) |
| same but thinking also empty | truncation, **or MoE-quant token-capture bug** ([#16456](https://github.com/ollama/ollama/issues/16456)) | if `gemma4:31b` is MoE+quant: **switch model, don't retry** |
| `content==""` + `done_reason=="stop"` + `eval_count≈0` + ~30s latency | **provider null generation — `glm-5.2:cloud`** ([#17091](https://github.com/ollama/ollama/issues/17091)) | immediate retry (free); after 2, **fail over + circuit-break** |
| `content==""` + `done_reason=="stop"` + `eval_count` large | tokens generated, not captured | **read `message.thinking` and parse the IR out of it** — free recovery |
| `done_reason=="load"` / `"unload"` | lifecycle event, not a generation | re-issue verbatim, **never charge the budget** |
| output stops at a delimiter in your `stop` array | stop-sequence collision (your IR uses `\n`, `}`, `]`, `)`) | audit `stop`; prefer a unique sentinel `<<<END_IR>>>` or none |

### 5.4 Kernel-fact block to return on every compile (free from OCC.js)
`bbox` (mm), `volume`, `solidCount`, `faceCount`, `edgeCount`, `vertexCount`, `centerOfMass`, `watertight`, `manifold`, `selfIntersecting`, `eulerCharacteristic`, `danglingEdgeLength`, `interPartOverlapVolume`, `BRepCheck_Analyzer` pass. Sources: [BRepCheck_Analyzer](https://dev.opencascade.org/doc/refman/html/class_b_rep_check___analyzer.html), [Analysis Situs check taxonomy](https://www.analysissitus.org/features/features_check-shape.html), [CADmium's topological menu](https://github.com/chandar-lab/CADmium).

### 5.5 Libraries named
[mediabunny](https://mediabunny.dev/) (MPL-2.0, zero-dep TS, supersedes mp4-muxer/webm-muxer) · [canvas-record](https://github.com/dmnsgn/canvas-record) · [camera-controls](https://github.com/yomotsu/camera-controls) v3 (`fitToBox`, `lerpLookAt`; SmoothDamp `smoothTime` 0.25s — **feed fixed delta in record mode**) · drei `<Bvh>` `<Bounds>` `<Instances>` `<CameraControls makeDefault />` · [three.ez/instanced-mesh](https://github.com/agargaro/instanced-mesh) · [`BatchedMesh`](https://threejs.org/docs/pages/BatchedMesh.html) (`setVisibleAt` is the replay primitive; needs WebGL2 `WEBGL_multi_draw`; no negative scale) · [json_repair](https://mangiucugna.github.io/json_repair/) / [partial-json-parser](https://pypi.org/project/partial-json-parser) · [BAML SAP](https://boundaryml.com/blog/schema-aligned-parsing) · eval code worth stealing: [BenchCAD](https://arxiv.org/html/2605.10865v1) (MIT, 17.9k programs, 24-axis rotation-invariant IoU), [MUSE](https://arxiv.org/html/2605.28579) (3-stage funnel + 4 binary geometric checks), [CadBench HF `DeCoDELab/CADBench`](https://arxiv.org/abs/2605.10873), [CADPrompt 200-object set](https://github.com/Kamel773/CAD_Code_Generation), [Eval3D](https://eval3d.github.io/) (reference-free cross-foundation-model consistency), [GPTEval3D](https://github.com/3DTopia/GPTEval3D).

### 5.6 The one-line version
**Ship Wave 0 in the next two weeks. Measure with Wave 1. Everything else — planes, judges, replay — is a bet you can only price honestly once the encoding surface stops eating the signal.**