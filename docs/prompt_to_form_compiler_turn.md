# Prompt → Form Reliability: the Solar-System / Colosseum Session, and the Compiler Turn

*Date: 2026-07-16. Source: the user-pasted transcript spanning the circle→pipe→spheres retries, the 8-planet solar system, and two Colosseum attempts. Scope: diagnose why these "not complex" prompts kept failing, evaluate the proposed "prompt translator / latent remap" idea, and lay out the highest-leverage improvements. Companion to `parametric_intelligence_pipeline_analysis.md` (2026-07-14), which diagnosed the same failure taxonomy from an earlier transcript.*

---

## 1. The session in one paragraph

The model's **design intent was correct almost everywhere** — a big circle with points on it, a swept ring, scattered spheres; eight planets on proportionally-remapped orbits with a central sun; an annular Colosseum wall with arches on a podium. What failed was never the idea. It was the **channel between the idea and the graph**: responses came back empty or as invalid JSON, the Ollama server 502'd, native tool-calling collapsed to the fragile single-shot JSON path, edge removals referenced edges that never existed, and one `Pipe`/`ExtrudeCurve` call after another died on the kernel. Roughly **two-thirds of the distinct failure lines in this log are transport- or protocol-layer, not reasoning-layer.** This is the same conclusion the 2026-07-14 analysis reached — and several of that document's fixes are in the code — but its own top-priority next steps (P1) were never implemented, and they are exactly what is biting now.

The uncomfortable, load-bearing finding: **the system prompt already tells the model the correct answer to every geometry mistake in this log.** Ring→Torus, `scaleStart/scaleEnd` not `scaleMin/scaleMax`, points-on-a-circle wiring, inferred handles, short reasoning — all present, verbatim, in the `COMMON CORRECTIONS` block (`agent.ts` ~L115-120). The model is failing to *apply* a 250-line prompt under a strict output contract on an unreliable local model, not failing to *be told*. You cannot fix that by adding a 251st line. You fix it by making the model's job smaller and the channel narrower.

---

## 2. The failure ledger — every distinct symptom, classified

| # | Log symptom (verbatim-ish) | Class | Already handled in code? | Root cause |
|---|---|---|---|---|
| 1 | `Ollama Error: 502 Bad Gateway`; `Engine fault … retrying` | **Infra / serving** | Partially (engine-fault circuit breaker, `agent.ts` L836) | Local Ollama server unavailable/overloaded. Not a code bug — a capacity/deployment fact. |
| 2 | `Model returned an empty response (no text, no actions)` → fallback | **Model capability** | Detected & falls back (`agent.ts` L765) | Weak model can't drive the native tool grammar; emits nothing. |
| 3 | `AI did not return valid JSON`; `Response was not valid JSON (attempt n/3)` | **Protocol** | Repaired up to 3× then fails (`agent.ts` L962-971) | Loose JSON mode only (`response_format: json_object` / Ollama `format:'json'`) — no schema-constrained decoding. Weak model + huge free-form payload. |
| 4 | `Tool-calling unavailable (…) — falling back to JSON protocol` | **Protocol** | Yes, but **session-wide** (`agent.ts` L690) | One 400/grammar error disables tools for the *entire session*, committing every later turn to the fragile JSON path. This is Jul-14 P1, **not landed**. |
| 5 | `removedEdgeIds entry {…} matched NO edge` (×15+) | **State desync** | Yes — tolerant resolver + candidate list (`agent.ts` L1175-1222) | Model tried to delete `pNeptune→iNeptune` etc. that never existed (the instancer edges never succeeded). Its mental model of the graph diverged from reality; the stateful patch protocol makes it edit a graph it can't see. |
| 6 | `InstanceOnPoints failed: connect points … to "points"` | **Wiring** | Executor guards & warns (`executors.ts` L2286) | `DivideCurve.points → InstanceOnPoints.points` not wired (or wired wrong). The "spheres in the centre" family. |
| 7 | `Pipe … kernel exception (opaque code 9546792)` | **Kernel** | Yes — closed-wire guard routes to Torus (`executors.ts` L794-799) | Model reached for `Pipe` on a closed circle despite the prompt forbidding it. Guard now intercepts, but the model still *chose* it. |
| 8 | `scaleMin/scaleMax/seed` rejected; node dropped | **Schema drift** | Yes — synonym map + benign-drop (`agent.ts` L185-193) | Grasshopper priors. Now aliased, so mostly cured — but the model's reasoning still narrates the old confusion. |
| 9 | `ExtrudeCurve failed: Cannot read properties of undefined (reading '$$')` | **Kernel / UX** | Caught, but message surfaced **raw** (`executors.ts` L2125, L2141) | `makeFace` on a malformed/open wire. `kernelAwareMsg` only rewrites *numeric* throws, so this embind error reaches the model unactionable. |
| 10 | `i only see three cylinders please redo` | **Intent-completeness** | **No** | Geometry meshed and passed sanity, but the *result didn't match the request's structure/count*. Booleans collapsed most parts. Nothing checks "you asked for many, you got 3." |

Read the "Already handled?" column top to bottom. Rows 5–8 are largely fixed in code, yet **they still appear in this session's reasoning and outcomes.** That tells you the fixes are real but insufficient: they lower the per-trap cost, but the model is still spending its limited turns rediscovering and narrating traps because the surrounding protocol keeps overwhelming it. Rows 1–4 (the majority by volume) have no real fix yet. Rows 9–10 are genuine open gaps.

---

## 3. Why the Jul-14 fixes didn't stop the bleeding

The 2026-07-14 pass was correct and landed real improvements (handle inference, synonym aliasing, closed-Pipe routing, the corrections block, reasoning diet). But it explicitly deferred two items to **"P1 — worth doing next,"** and neither shipped:

- **"Make the grammar-error fallback per-request, not session-wide."** Still session-wide: `agent.ts` L690 flips `disableToolCalling: true` for the whole agent on the first tool-grammar 400. After that, every turn uses the single-shot JSON path — the exact path that produces symptoms #3 and the truncation spirals.
- **"Chunk the JSON path like the tool path."** Not done: `runLegacyJson` still asks for the *entire* graph plus `reasoning` in one payload. On a 40-node solar system or a multi-ring Colosseum, that payload is the truncation/invalid-JSON generator.

So the honest status is: **the band-aids stuck, but the wound is upstream of them.** The two deferred P1 items are not polish — they are the difference between "a weak model gets bounded, recoverable sub-tasks" and "a weak model is handed a maximal one-shot contract and fails whole." Do these before anything new.

---

## 4. The real bottleneck, named plainly

Three compounding facts, all verified in the current code:

**(a) The output contract is maximal.** The JSON protocol asks a single generation to emit a complete, internally-consistent, *stateful* graph: unique node IDs, exact param names, exact handle names, correctly-ordered multi-input edges, kernel-safe node choices, and short reasoning — all at once, all correct, or the turn fails. That is the hardest possible ask for a weak model.

**(b) Decoding is unconstrained.** `api.ts` uses `response_format: { type: 'json_object' }` (L143, L444) and Ollama `format: 'json'` (L111) — loose JSON mode. **There is no `json_schema` / grammar-constrained decoding anywhere.** Loose JSON mode guarantees *syntactic* JSON at best (and the log shows even that failing on this model); it does nothing to keep the model inside your node/handle/param vocabulary. The model is free to emit `scaleMin`, `Pipe`-on-a-ring, or a half-finished array, and only *post-hoc* validation catches it.

**(c) The model/infra under it is the weakest link.** The 502s and empty responses are a local Ollama deployment that is either under-resourced or serving a model too small to drive this protocol. An enormous, genuinely impressive amount of harness engineering exists to compensate — synonym maps, autofixes, diagnosis state, minimal-repro, circuit breakers. That scaffolding is the right instinct, but it is compensating for a channel that is fundamentally too wide for the model pushed through it.

The lesson is not "get a bigger model" (though a stronger model would paper over most of this). It is: **narrow the channel until the model you have can saturate it reliably, and constrain decoding so illegal output is impossible rather than merely rejected.**

---

## 5. The "prompt translator / latent remap" idea, evaluated honestly

The proposal — *reinterpret and map the prompt, in several versions, evaluate possibly in latent space, a translator as the solution* — has a **correct kernel and a mis-aimed mechanism.**

**The correct kernel.** The instinct that there should be a *translation stage* between language and graph is right, and it is already latent in your own architecture diagram (`ROADMAP.md` §1): `intent → design plan → compilation → node graph`. The problem is that today the **"compilation" arrow is performed by the LLM** — the model *is* the compiler, hand-emitting low-level nodes. Every failure in §2 rows 5–9 lives in that hand-compilation step. The fix the diagram is begging for is to **make "compilation" a real, deterministic pass** and shrink what the LLM must produce to the *plan* above it.

**Where the mechanism is mis-aimed.** Three cautions, in decreasing order of importance:

1. *A translator does not touch the dominant failures.* Rows 1–4 (infra, empty responses, invalid JSON, session-wide fallback) are ~two-thirds of this log. Re-expressing the English prompt does nothing for a 502 or an over-long payload. If the translator runs on the *same* weak local model, you have **added a second failure-prone generation** in front of the first. A translation layer only helps if it either (a) runs on a stronger model, or (b) shrinks the *downstream* output, or both.

2. *"Evaluate in latent space" is the weak version of a strong idea.* Comparing prompt embeddings is a similarity heuristic — you already use it for example retrieval, and it's fine there. But "generate several versions and pick the best" does not want *latent* evaluation; it wants **grounded** evaluation, and you already have the ground truth: the geometry report, `proportionalIntegrity`, the vision verdict, `derivationRatio`. Pick the best candidate by *running* it, not by embedding-comparing it. See §7.

3. *A free-text "reinterpretation" reintroduces ambiguity you're trying to remove.* If the translator emits more prose, you've moved the parsing problem, not solved it. The translation target should be a **typed, closed, machine-checkable representation**, not a paraphrase.

So: **yes, build a translator — but make it a front-end that emits a typed intermediate representation, and make the thing after it a deterministic compiler, not the LLM.** That is the next section.

---

## 6. The Compiler Turn — a typed IR + deterministic back-end

Split the one hard job into two easy ones. This is the classic compiler split (front-end: language→AST; back-end: AST→target), and it maps cleanly onto your existing loop.

```
  intent (language)
      │   LLM  ── front-end (semantic, small output, schema-constrained)
      ▼
  DESIGN IR  ── a tiny, typed, closed vocabulary of high-level ops + list math
      │   deterministic compiler  ── back-end (owns ALL low-level correctness)
      ▼
  node graph  ── exact IDs, handles, param names, kernel-safe node choices
      │   OpenCascade (unchanged)
      ▼
  geometry → percepts → feedback (unchanged)
```

**What the LLM emits changes from ~45 fragile nodes to ~6 robust lines.** The IR is small enough to (a) fit a strict JSON schema for constrained decoding, (b) rarely truncate, and (c) be *verified before a single node exists*. The compiler, being code, **cannot hallucinate a handle, cannot pick `Pipe` for a ring, cannot misorder a Boolean's inputs, cannot invent an edge id.** Every row 5–9 failure becomes structurally impossible rather than reactively caught.

### 6.1 The solar system is *already a program* — that's the tell

Re-read the user's own words: *"sort first all the data … remap them from 0.2 to 1 … use those radiuses to generate toruses … elevate them at positions proportional to real state … a list of the sizes remapped … one sphere component."* That is not a description of a picture. **It is a pipeline** — sort, remap, map-to-geometry, instance. The model kept failing to *hand-compile* that pipeline into 40+ nodes with correct handles and IDs. But the pipeline itself is five lines. Give the model a language in which it can write those five lines, and hand the 40 nodes to a compiler:

```text
# DESIGN IR (illustrative) — the LLM emits THIS, not nodes
master = slider("systemSize", 80)                      # the ONE control the user asked for

bodies = [                                             # real data, baked in as constants
  {name:"Mercury", au:0.39, r:2439},  {name:"Venus",  au:0.72, r:6052},
  {name:"Earth",   au:1.00, r:6371},  {name:"Mars",   au:1.52, r:3390},
  {name:"Jupiter", au:5.20, r:69911}, {name:"Saturn", au:9.58, r:58232},
  {name:"Uranus",  au:19.2, r:25362}, {name:"Neptune",au:30.1, r:24622},
]

orbit = remap(bodies.au, 0.2, 1.0) * master            # list → proportional ring radii
size  = remapLog(bodies.r, 0.5, 4.0)                   # list → believable (not literal) planet sizes
tube  = orbit * 0.008                                  # proportional, tiny profile

rings   = map(orbit,          ρ => Torus(major=ρ, minor=tube))           # ring leaves
planets = map(zip(orbit,size),(ρ,s) => Sphere(radius=s) at point(ρ,0,0)) # instanced spheres
sun     = Sphere(radius=master*0.12) at origin
```

The compiler expands `remap`/`map`/`at point` into your existing substrate — `Range`/`Series`/`ListItem` for the list math, `Torus` (never `Pipe`) for rings, `Point`→`Sphere` or `InstanceOnPoints` for placement — with correct handles and unique IDs every time. The single control the user asked for ("I should only be able to control the overall size") falls out for free: `master` scales the whole list.

### 6.2 Two ways to build the back-end (ship the first, grow into the second)

- **Near-term, pragmatic: high-level ops → verified sub-graph templates.** Define ~15–25 IR ops (`ringAt`, `instanceScaledAlong`, `loftProfiles`, `revolveProfile`, `annularWall`, `archArray`, `remap`, `series`) whose expansions are *hand-written, tested sub-graphs* — essentially your **macros, promoted from advisory to executable.** You already have the macro machinery (`LibraryPanel.convertToMacro`, `expandMacros` in the worker). The move is to let the *planner* target macros/ops by name and let the compiler expand them, instead of hoping the model re-derives them from primitives. This is a few weeks of work and it directly kills rows 5–9 for every prompt that fits an op.

- **Fuller vision: a small composable list-DSL.** The example above (`map`, `zip`, `remap`, `at`) is a functional data-flow language over your existing list nodes. More expressive, preserves creativity (it's not a fixed template zoo), and is the natural home for "operate in that space, be creative, have all tools." Build it *after* the op-template version proves the split.

**Opinion:** do not over-rotate to a rigid template per object type — that kills the creativity the project is explicitly about. The right granularity is **composable mid-level ops** (a ring, an array-along-a-curve, a loft-through-profiles, a remap), from which both a solar system and a Colosseum are assembled. That preserves open-ended composition while guaranteeing each op is kernel-safe.

### 6.3 Why this also fixes the *protocol* failures (rows 1–4), not just wiring

A 6-line IR is ~10–20× smaller than the node payload it compiles to. Smaller output means: it fits a strict schema for constrained decoding (§8), it almost never truncates, and when the weak model *does* stumble, it's stumbling over a tiny closed grammar instead of a sprawling open one. The compiler turn is the single change that attacks reasoning-layer *and* protocol-layer failures at once.

---

## 7. "Several versions, pick the best" — done with the verifier you already have

This is the salvageable, powerful core of the "several versions / evaluate" idea — **verifier-guided best-of-N**, and you have every piece except the loop:

1. Sample **N** candidate IRs (temperature > 0), or N compilations of one IR.
2. Compile and evaluate each through the **existing** stack: `checkGeometrySanity` → geometry report → `proportionalIntegrity` (perturbation) → `derivationRatio`/`magicNumberCount` → optional `runVisionVerification`.
3. Keep the argmax on a composite score; discard the rest silently.

Because IR compilation is deterministic and cheap, and evaluation is already implemented, N can be 3–5 with modest cost. This is strictly better than latent-space selection because it scores what the design *actually builds*, not what its description *resembles*. It also turns your verifier from a *repair* signal (react after failure) into a *selection* signal (choose before showing the user) — the same signal, used proactively.

And it seeds a data flywheel: every `(prompt → winning IR → sane graph)` triple is a **labeled training example** for a small specialist model that emits IR. That is the realistic path from "endless prompt patching" to "a small model that is actually good at this" — which is the project's stated north star of *general* parametric design intelligence.

---

## 8. Kill the invalid-JSON class by construction

Independent of the compiler turn, and shippable now: **replace loose JSON mode with schema-constrained decoding.**

- **OpenAI / OpenRouter:** `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }` instead of `{ type: "json_object" }` (`api.ts` L143, L444). With `strict: true` the provider *cannot* emit a key outside your schema — `scaleMin`, a stray field, a malformed array all become impossible at the decode step.
- **Ollama:** pass a **JSON schema object** to `format` (structured outputs, supported since Ollama 0.5) instead of the string `'json'` (`api.ts` L111). Same guarantee, locally.

For the *tool* path, tighten the tool `parameters` schemas (they are currently permissive — `data` is a free-form object, which is exactly what Ollama's grammar chokes on per your own `sanitizeSchema` comment). A constrained IR (§6) makes this trivial because the IR schema is small and closed.

Two smaller, cheap hardening items while you're in these files:

- **Per-request grammar fallback (Jul-14 P1).** In `agent.ts` L690, retry the tool call once with the sanitized/simplified schema before setting `disableToolCalling` for the whole session. Reserve the session-wide flag for repeated failures, not the first.
- **Actionable kernel messages for the embind class (row 9).** `kernelAwareMsg` (`executors.ts` L79-85) only rewrites numeric throws. Add a branch: if the message matches `/reading '\$\$'|undefined .*wrapped/`, replace it with *"the curve fed to ExtrudeCurve is not a closed planar wire — close the profile or use Pipe for an open path."* Every kernel message must name the fix in the model's vocabulary; the raw embind string costs a wasted repair round.

---

## 9. Prioritized action list

**P0 — stop the protocol collapse (days, high certainty).**
Schema-constrained decoding (§8) on both the JSON and tool paths. Per-request grammar fallback (un-defer Jul-14 P1). Chunk the legacy JSON path into batched patches like the tool path (un-defer the other Jul-14 P1). These three attack rows 1–4, the majority of this log, and need no new architecture.

**P1 — the compiler turn (weeks, highest leverage).**
Introduce a typed DESIGN IR and a deterministic compiler (§6). Start with ~15 composable mid-level ops whose expansions are your promoted macros. Route the planner to emit IR; keep direct node emission as a fallback. This structurally eliminates rows 5–9 and shrinks the output enough to compound with P0.

**P2 — proactive selection & intent-completeness (weeks).**
Verifier-guided best-of-N over compiled IRs (§7), reusing the existing verification stack. Add an **intent-completeness check** to `checkGeometrySanity`: parse expected cardinality from the plan/prompt ("8 planets", "many arches", "N rings") and flag when leaf/instance counts fall grossly short — this is the missing signal behind *"I only see three cylinders"* (row 10). Enable vision verification by default for placement/pattern-heavy builds rather than opt-in.

**P3 — grow the knowledge base from data (ongoing; the project's real subject).**
You store `graphOriginal` vs `graphFinal` on every saved example — the **AI-vs-human-corrected delta.** Mine those deltas automatically into new synonym entries, corrective retrieval rules, and (once §6 lands) new IR ops. Every human correction is a labeled signal; today it decorates a dashboard instead of improving the next build. Half of a good knowledge base is corrective, not exemplary (the `COMMON CORRECTIONS` block is the hand-written seed — grow it from the deltas).

---

## 10. Meta-principles for general parametric design intelligence

**Move rules from the prompt into the compiler.** Every line in `COMMON CORRECTIONS` is something the model must *remember and apply under load*. Every rule you move into deterministic code is one fewer thing a weak model can get wrong, and one fewer line competing for its attention. The prompt should teach *design judgment* (what makes a good solar system), not *house mechanics* (which handle `DivideCurve` outputs). Mechanics belong in the machine.

**Constrain, don't validate.** Rejecting bad output after the fact costs a turn and a repair budget; making bad output undecodable costs nothing. Prefer schema-constrained decoding and a closed IR over post-hoc `validateAndNormalizeNodeData` wherever you can. Validation is the safety net, not the strategy.

**Ground selection in geometry, not in language.** You have a real verifier. Use it to *choose* among candidates, not only to *repair* the one you committed to. "Several versions, pick the best" is right — evaluate them by building them.

**Separate the model's capability from the channel's width and the server's uptime.** The eval harness already tags system errors distinctly (`isSystemError`) — extend that discipline everywhere: a 502 is not a design failure, and benchmarking a model on a flaky local server measures the server. Fix the channel (P0) and the compiler (P1) before concluding anything about the model.

**The cheapest intelligence upgrade remains institutional memory.** This session re-fought battles the Jul-14 document already won on paper, because the fixes were partial and the deferred half was the important half. Close loops fully, and mine the correction deltas you're already storing. Model capability was rarely the bottleneck in this log; the channel and the memory were.
