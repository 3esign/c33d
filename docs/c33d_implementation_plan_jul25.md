# C33D — Implementation Plan
### From the 77-session audit and the six-lens research brief · 25 July 2026

Read order if you only read one thing: **§0 (run the script today)**, then **§2 Wave 0**.
Everything after Wave 1 is a bet you can't price honestly until Wave 0 lands.

---

## 0. When to run the script — today, in this order

The work from this morning is sitting **uncommitted in a OneDrive folder**. That is the
riskiest state it can be in. Ten minutes:

1. Double-click **`C3D.bat`**
2. **`[1] Run all checks`** — typecheck, build, full suite. Expect everything to pass except
   `test_flower_integration` and `test_nonuniform`, which failed identically before any of
   this. Look for `test_ir_ref_coercion: all 39 contracts PASS` and
   `test_run_abort: all 24 contracts PASS`.
3. **`[4] Commit and push`** — it shows you the diff first, asks about source and `JSONs/`
   separately, then offers to push. If it complains about a lock file, run `[7]` first.
4. **`[3] Start the app`** — spend five minutes actually using it. Two things to confirm
   with your own eyes, because no test can:
   - send a prompt, then click the red square where Send used to be. The run should stop
     within a second or two and the graph should be exactly as it was.
   - ask for something with many parts — *"a temple with 20 columns and a pediment"* —
     and check that `compound`/`union` no longer die past four.
5. **`[5] Deploy`** only when you want the live site to move. Pushing does not publish.

**After today, the routine is:** `[2]` while editing the compiler (seconds), `[1]` before
committing, `[6]` when you want the whole chain. That's the whole workflow.

---

## 1. Where things stand

### Landed this morning (verified, uncommitted)

| | Item | Wave |
|---|---|---|
| ✅ | Reference args accept inline literals — call-syntax strings, arrays, wrappers | 0.5 |
| ✅ | N-ary `compound` / `union` via `parts`; new `MergePoints` node | 0.5 |
| ✅ | All independent body errors reported per attempt, with poison-suppressed cascades | 0.3 |
| ✅ | Better message when an inline object has no `op` | 0.7 (partial) |
| ✅ | Run abort + Stop button (`src/ai/abort.ts`) | 2.2 (partial) |
| ✅ | Two contract tests driving the real modules (63 contracts) | 1.x groundwork |

### Two measurements I ran on your existing data

**A — Your compiler tells the model what's wrong far more often than what's allowed.**
Of 44 user-facing failure messages in `compile.ts` + `skills.ts`:

- **31 say only what is wrong** — no enumeration of the admissible set
- 13 enumerate something
- **4** offer a concrete suggested fix

The ablation study says the admissible set is worth **+36–40pp** of repair success and the
location is worth ≈0. So the single highest-yield work item is rewriting ~31 strings. Also:
two messages dump **all 45 ops** on an unknown-op error, which is the exact anti-pattern the
paper names — the cap is 12, scoped to the relevant category.

**B — Half of your multi-turn sessions end worse than they peaked.**
Across the 29 sessions with ≥3 real turns, using `(wired nodes, edges)` as a progress proxy:

- **15 of 29 (52%)** finish worse than an earlier turn
- **125 of 190 (66%)** graph-changing turns did not improve the graph
- median destroyed: **8 wired nodes**; worst case: **238**

Concrete cases: qwen3.5 reached 263 nodes / 428 edges at turn 5 and ended at 25/27.
glm-5.2 reached 65/120 at turn 10 and ended at **0/0**. Another glm-5.2 session was at its
best on turn *one* (76/77) and spent thirteen more turns getting to 10/5 — your comment on
that session was *"no visible 3d model at all."*

**Two honest caveats.** The proxy rewards larger graphs, so a model legitimately simplifying
looks like regression. And the verdict split between regressed and non-regressed sessions is
**not** meaningfully different (4/3/4 OK/WEAK/FAIL vs 5/2/6), so I cannot claim keeping the
best graph would have raised your OK-rate. What it does establish is that **work is being
destroyed at scale**, and that `bestSoFar` is cheap insurance against the worst cases. Treat
this as a reason to build the retention mechanism, not as a proven win.

---

## 2. Wave 0 — the encoding surface (target: two weeks)

Nothing else is worth doing first. Every item is in files you already know.

### 0.1 — Non-streaming IR call + empty-response taxonomy · **1–2 days · do this first**

`glm-5.2:cloud` returning HTTP 200 with empty content is
[a documented open Ollama bug](https://github.com/ollama/ollama/issues/17091). Cloud models
also **omit `usage` in streaming but return it non-streaming**
([#15169](https://github.com/ollama/ollama/issues/15169)) — so without switching, you cannot
tell reasoning-exhaustion from truncation from null-generation, and the whole classification
collapses.

- set `stream: false` on the IR completion path in `api.ts`
- log `done_reason` / `finish_reason`, `eval_count`, `prompt_eval_count` on **every** call,
  success or failure
- classify empty responses and act differently per class: retry with backoff (0.5/1.5/4s) and
  a small temperature bump; after two failures halve `max_tokens`; circuit-break a model-id
  that fails three times in a row and say so in the UI
- **retries here must not count against the repair budget** — this is not the model's fault

**Acceptance:** an empty response produces a log line naming *which* failure class it was, and
`empty_response_rate` is reported as a **provider** metric, separate from model quality.
**Expected: ~17 of 77 sessions (≈22%) recovered outright.**

### 0.2 — Admissible alternatives in every diagnostic · **2–3 days · highest yield**

Rewrite the 31 messages identified above. The rule for each:

> name the violation → **enumerate what would be accepted here** (max 12, deterministic
> order, scoped by type/category) → offer one concrete corrected form

Specifics from measurement A:

- `Unknown op "sketch"` must offer **≤12 nearest ops in the same category** (curve ops when a
  curve was expected), never all 45
- `must be a reference like "$myCurve"` should list **the in-scope bindings of the required
  type**, in declaration order
- `needs a number; "$x" is a point` should name which bindings *are* numbers

**Acceptance:** every failure message answers "what should I have written instead?" Measure
with the 1.5 ablation, not by eye.

### 0.3 — Dependency-ordered, deduped errors · **1 day · half done**

All-errors reporting landed this morning. Still to do: order **root causes before dependents**,
dedupe by error class rather than by op, and add a short "consumed by" line so the model sees
which later ops were skipped rather than silently missing them.

### 0.4 — Partial acceptance · **3–5 days · this is the one that kills the 25%**

When a program has 58 valid ops and 2 broken ones, commit and render the 58. Today the user
sees a blank canvas — the least informative outcome possible, and the direct cause of a quarter
of your sessions producing no design signal at all.

The IR is linear with named bindings, so recovery is easy: **the statement boundary is the
recovery set.** You already have the poison machinery from this morning; the remaining work is
a transitive-reachability pass to find what's still buildable, then commit that subgraph and
report the gap as a checklist.

**Acceptance:** a program with one bad op in fifty renders forty-nine ops' worth of geometry and
says exactly what is missing. A zero-node outcome should become nearly impossible.

### 0.6 — Feed back the compiler's canonical reprint · **1 day · quiet but important**

On a repair round, send the model **the compiler's canonical re-print of what it accepted**,
not the model's original text. Repair becomes *extension* rather than *rewrite*, and the
model's own non-canonical dialect stops recirculating through the loop's context. Emit a
`note:` for every coercion applied — on success as well as failure — so the canonical form is
taught even when nothing broke.

### 0.7 — Mixed-composition messages · **1–2 days**

Diagnostic + guidance + concrete suggested fix scores **63.6%** vs **49.2%** for raw compiler
text. Fold this into 0.2 rather than doing it separately.

---

## 3. Wave 1 — measurement (1 week, overlaps Wave 0)

**You cannot claim Wave 0 worked without this, and the ablation is the point.**

- **1.1 Tier 0/1 harness** — `emitted_response`, `parsed_ir`, `produced_graph`,
  `attempts_used`, `errors_reported_per_attempt`, error-class histogram, op histogram. Plus
  kernel facts from OCC.js on every successful compile: bbox in mm, volume, solid/face/edge/
  vertex counts, watertightness. Those are free and they catch "compiled fine, it's a 4000 mm
  teapot."
- **1.2 TurnV2 logging** — add `programHash`, `errorSigs[]`, the `progress()` vector and
  `churn` to each timeline entry. This upgrades measurement B from a proxy to the real thing.
- **1.3 Re-code your 77 labels** to a 4-point ordinal plus a binary `usable`, then blind
  re-code a shuffled 30 a week later and compute agreement. That number is the ceiling on
  everything you can claim.
- **1.5 The ablation, baked into the harness:**
  **{first-error-only vs all-errors} × {3 vs 6 attempts}**, same prompt set.

**This is the experiment that proves or refutes the audit's central claim.** Run it on a fixed
subset of your existing prompts so the comparison is against real history.

⚠️ **Statistics discipline, decided in advance:** n=77 with a 45/55 split gives a 95% CI of
roughly **±0.13** on AUC. Fit at most three predictors. **Stratify on the sessions that
produced a graph** (n≈58) — otherwise the no-graph cases create trivial separation and you
will fool yourself.

---

## 4. Wave 2 — the loop (after Wave 0, ~1 week)

Do **not** build the loop before Wave 0. A loop over a compiler that reports one error at a
time is gradient descent with one bit of gradient per step — guided refinement gains
**+79.7pp** where unguided self-refinement gains **+1.8pp**, and the difference is entirely
in what the feedback contains.

**2.0 `bestSoFar` — half a day, do it early.** Keep the highest-scoring graph and its program;
restore it on every stall exit, budget exhaustion **and user cancel**. Measurement B says this
is worth doing on its own.

**2.1 Structure.** Model-declared "done" is a *proposal*; it must clear a deterministic gate
(compiles, evaluates, ≥1 solid, non-zero bbox, no isolated nodes). A failed gate comes back as
a **checklist**, which is the one regime where self-correction works. Max two rejections.

- **A** generate (1 turn, unbudgeted)
- **B** repair (≤6 turns — raise from 3 **only after 0.2/0.3 land**, machine errors only)
- **C** done-gate
- **D** refine (≤3, **off by default**, entered only on explicit user critique)

**Stall rules** over the `progress()` vector: no-change, error-fixpoint (same leading error
three turns — expect this to dominate), oscillation, **churn-without-progress** (measurement B
says 66% of your changing turns qualify), thrash, regression.

**Budget shown to the model coarsely, with consequences** — *"attempt 4 of 6; after 6 the run
stops and the best graph is kept"* — never a token countdown. Models are systematically
optimistic about budget, and weaker ones more so.

**2.2 Finish the abort story.** This morning's stop cancels the LLM loop. Geometry evaluation
in the worker is still uninterruptible, because OCCT booleans in wasm don't yield. The complete
version is a `SharedArrayBuffer` cancel flag polled between IR ops, escalating to
`worker.terminate()` after ~250 ms, with a prewarmed spare worker to avoid a cold kernel.
Needs COOP/COEP headers; without them, terminate-only.

**Worth one day before committing to sequential repair at all:** at equal token cost, compare
**1 run × 10 turns** against **3 independent runs × 3 turns, keep the best**. With a quarter of
sessions producing no graph, three independent shots at a *first* graph may well beat ten
repairs of one broken one.

---

## 5. Wave 3+ — after the signal is clean

**Points visible in the viewport** (half a day, do it whenever). Your Point node is the #2
most-used in the corpus and nothing draws it. That is why models place spheres to mark
locations. Screen-space-sized markers, excluded from leaf and geometry checks, toggleable.

**Plane / frame type** — yes, but here, not earlier, and two ops not seven. `center + axis` is
5 degrees of freedom; a frame is 6, and the missing roll is exactly why `rotate` exists as a
separate step. Your backend already builds a full `gp_Ax2` and picks the missing axis
arbitrarily. Four non-negotiables: `on` must accept inline literals from day one (or you
recreate the bug you just fixed), `center` is retained and reinterpreted as local to `on`,
`axis` stays as lossless sugar, and every derivation is deterministic — use branchless ONB,
not `cross(z, worldZ)`, which degenerates on horizontal planes.

**Run the falsifiable experiment first**, on your existing 77 prompts: op count per model,
`rotate` frequency, first-attempt compile rate, hand-annotated wrong-orientation rate.
Predicted gain on radial and tilted intents, ≈zero on axis-aligned box stacks. **If failure
rate improves without op count dropping, the theory is wrong** and you should stop.

The higher-value follow-on — ranked above curve frames — is an **anchor vocabulary**:
`on: {of: $columns, anchor: "TOP"}`. *"Put the roof on top of the columns"* with no numbers at
all, and fully object-agnostic, so it doesn't violate the no-preorders rule.

**`mirror` op** — implicit in nearly every symmetric prompt in your corpus and currently paid
for in duplicated subtrees. Add it, then re-measure before adding more vocabulary.

**Replay / video** — real value, but as the brief puts it, *"the eval surface, not the demo."*
You already have both ingredients: timeline v2 stores every intermediate state with diffs, and
the worker memoizes unchanged nodes by hash. Build it after Wave 1 so what it replays is worth
watching, and make it diagnostic — highlight isolated nodes, flag the turn geometry went null,
overlay the model's stated intent per step.

**VLM judge** — not as a metric. Judges correlate only 0.30–0.46 with human scores on absolute
ratings and show position-order effects up to 100%. The cheap 80% is kernel facts (Wave 1.1)
plus multi-view matcap renders fed **into the repair loop** as a critic. If you ever build the
judge proper, it's pairwise, order-swapped, different model family, with a clear-gap and a
base-vs-base control on every run or the run is void.

---

## 6. What not to build

- **Constrained decoding.** Ollama Cloud doesn't support structured outputs, and locally
  `think=false` silently voids `format` on gemma4 and qwen3.5. It wouldn't help much anyway —
  92% of the format penalty comes from the *prompt*, not the decoder. The validated mitigation
  is decoupling reasoning from serialization (two-turn generation recovers 7–10pp).
- **A machine-readable diagnostic schema for the model.** Prose vs JSON differed by 0–2pp with
  confidence intervals containing zero. Spend the effort on content instead.
- **Automatic budget escalation.** The runs that consume the most budget are markedly *less*
  likely to succeed. Escalate only when you press a button.
- **Having the model emit React Flow nodes and edges.** Someone will suggest it. The ablation
  is 62% vs 52% on simple tasks and 45% vs 25% on complex ones, in favour of what you already
  do.

---

## 7. The sequence, compressed

| When | What | Gate before moving on |
|---|---|---|
| **Today** | Run `[1]` then `[4]`. Commit the morning's work. | Tests pass, stop button works by hand |
| **This week** | 0.1 non-streaming + taxonomy → 0.2 admissible alternatives | Empty responses classified; every message names the admissible set |
| **Next week** | 0.3 ordering, 0.4 partial acceptance, 0.6 canonical reprint | A one-bad-op program still renders |
| **Week 3** | Wave 1 harness + **the ablation** | The ablation gives a number, with a CI |
| **Week 4** | `bestSoFar`, then loop structure and stall rules | EIR measured properly, not by proxy |
| **Then** | Visible points → plane experiment → mirror → replay | Each gated on its own experiment |

The one-line version, from the brief: **ship Wave 0 in the next two weeks, measure with Wave 1,
and price everything else only once the encoding surface stops eating the signal.**
