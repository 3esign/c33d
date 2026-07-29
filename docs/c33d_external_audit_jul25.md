# C33D — External Audit
### Corpus: 77 annotated sessions, 22–25 July 2026 · 7 models · 20 prompts
*Prepared as an outside reviewer. Findings are drawn from your own exports and source; no changes were made to the repo.*

---

## 1. Headline

**The system is no longer failing at design. It is failing at data entry.**

Across 77 sessions, 45% ended in what you yourself labelled a failure. When I traced every terminal failure back to its cause, the overwhelming majority were **not** cases where a model misunderstood geometry, proportion, or assembly. They were cases where a model expressed a *correct* idea in a spelling the compiler refused — and then died, because the compiler reports one error at a time and only allows three attempts.

The clearest single sentence in this audit:

> You already proved the coercion strategy works — you applied it to *number* arguments and not to *reference* arguments. Half of all compile deaths are in the half you didn't cover.

---

## 2. Scoreboard

### 2.1 Outcome distribution (your own comment labels)

| Outcome | Sessions | Share |
|---|---:|---:|
| OK (you called it interesting / correct / best) | 18 | 23% |
| WEAK (recognisable but primitive / partial) | 16 | 21% |
| FAIL (no usable result) | 35 | 45% |
| Unclassified | 8 | 10% |

**19 of 77 sessions (25%) never applied a graph at all** — zero nodes, zero geometry, nothing to critique. That is a quarter of your experimental budget producing no design signal whatsoever.

### 2.2 By day

| Day | N | OK% | FAIL% | avg nodes | IR-loop/session | bad-JSON/session | engine faults |
|---|---:|---:|---:|---:|---:|---:|---:|
| Jul 22 | 7 | 43 | 43 | 22.0 | 4.9 | 1.1 | 10.6 |
| Jul 23 | 22 | 18 | 32 | 33.1 | 1.8 | 1.4 | 0.2 |
| Jul 24 | 36 | 28 | 42 | 21.6 | 0.4 | 0.4 | 0.6 |
| Jul 25 | 12 | 8 | 83 | 19.4 | 0.7 | 0.6 | 0.8 |

**What genuinely improved:** the Jul-22 IR coercion wave worked. Compile-repair loops fell 4.9 → 0.4 per session (−92%). Engine faults fell 10.6 → 0.6 (−94%). Those were real fixes and they held.

**What did not improve:** the *outcome* didn't move. OK-rate went 43% → 8%. Node counts flat. You removed two large classes of noise and the success rate went sideways — which means the binding constraint was never those two classes. It is what sits underneath them.

### 2.3 By model (post-Jul-22, from `intelligence_log.json`, 154 runs)

| Model | runs | success% | avg nodes | avg sec | blackouts (exports) |
|---|---:|---:|---:|---:|---:|
| qwen3.5 | 50 | 64 | 46.2 | 94 | 0 / 11 |
| kimi-k2.7-code | 7 | 71 | 20.4 | 207 | 2 / 9 |
| glm-5.2 | 15 | 53 | 20.6 | 159 | 2 / 15 |
| nemotron-3-super | 16 | 31 | 26.6 | 251 | 3 / 13 |
| deepseek-v4-flash | 21 | 29 | 42.5 | 86 | 1 / 12 |
| gemma4:31b | 18 | 28 | 19.9 | 190 | 2 / 11 |
| minimax-m3 | 9 | 22 | 6.2 | 244 | **7 / 8** |

**⚠ This table is not a model ranking. Read §4 before using it as one.**

---

## 3. Findings, ranked by expected yield

### F-1 · Reference arguments reject every inline literal — 50% of all compile deaths
**Severity: critical · Effort: ~half a day · Confidence: certain**

`ctx.refOpt` (`src/ai/ir/compile.ts:326–364`) accepts exactly two non-`$ref` forms: an `{op:…}` object, and a bare `{x,y,z}`. Everything else hits `fail()` at line 357. Here is what models actually sent, verbatim from your transcripts:

```
got "vector(0, 0, 1)"                                        ×4   call-syntax string
got "point(0, 0, -balloonRadius*0.75)"                       ×4   call-syntax string w/ formula
got ["$roofP1","$roofP2","$roofP3"]                          ×3   array of refs → point[]
got [{"x":"-(w+2*r+1)/2","y":0,"z":0}, …]                    ×1   array of literals → point[]
got {"point":{"x":0,"y":0,"z":"totalHeight - envelopeRadius"}} ×1  one extra wrapper
references "$gf_w * 0.6", which is not bound                  ×2   arithmetic in a ref slot
```

Eleven of the 22 identifiable terminal compile failures. Every one of them is a *correct design intent* in a rejected dialect. `numOpt` (line 268) already handles the analogous cases — formulas, bare names, arithmetic-on-refs via `resolveFormula`, inline op objects. `refOpt` got none of that.

**Fix.** Before line 357, add: (a) parse `name(a, b, c)` call-syntax strings into `{op:name, args:{…}}` and route through `liftInlineOp`; (b) accept arrays — lift each element (ref, `{x,y,z}`, or call-string) and emit a `points`/`list` op; (c) unwrap a single-key object whose key equals the expected type; (d) route arithmetic-bearing ref strings through `resolveFormula` as `numOpt` already does.

You have direct evidence this pattern works: your existing auto-lift fired **542 times across 26 sessions** without a single death. The coercion strategy is proven; it is just half-deployed.

---

### F-2 · Assembly caps at 4 parts — the structural ceiling on ambition
**Severity: critical · Effort: ~1 day · Confidence: certain**

```ts
compound: { doc: 'group up to 4 solids into one (no fusing)',
            args: { a, b, c, d } }          // skills.ts:684
union / difference / intersect: { a, b }     // binary only
```

Every single assembly operator in a 45-op language is fixed-arity ≤ 4. A Greek temple has 30 parts. A skeleton has 70. An opera house has a dozen shells. Your transcripts show models hitting the wall exactly where you'd predict:

```
body[8]  (head           = compound): "compound" has no argument "0"
body[73] (skeletonBones  = compound): "compound" has no argument "e"
body[?]  (temple         = compound): "compound" has no argument "e"
```

`body[73]` is the tell — that model built a complete 73-step skeleton and died on the last line, assembling it. The user comment on that session is "fail". It was not a failure of design intelligence.

**Fix.** Give `compound` and `union` a `parts` argument accepting an array or a `solid[]` ref, and expand internally into a balanced tree of the existing 4-socket `Compound` nodes. Keep `a…d` as sugar. This is pure compiler work — no kernel changes, no new node type.

**Why this matters beyond the crash:** an N-ary assembly operator is what lets a model *think in wholes*. With a 4-cap it must invent private hierarchies for a limitation that isn't real, and that cognitive overhead shows up as the isolated-island counts you've been tracking (2.6–4.9 unwired nodes per final graph).

---

### F-3 · First-error-only reporting × 3 attempts = deterministic death for long programs
**Severity: critical · Effort: ~half a day · Confidence: certain**

```ts
} catch (err) {
  issues.push(…);
  // Programs are small: stop at the first body error …
  return { graph: null, issues, notes };   // compile.ts:118–122
}
```

The comment's premise — "programs are small" — is no longer true. Your corpus averages 30+ ops and reaches 110. Combined with `MAX_AUTO_REPAIRS = 2` (three attempts total), the model gets three shots at a program with an unknown number of independent defects. The transcripts show the resulting march:

| session | body index across attempts |
|---|---|
| Jul 22 12:39 | 10 → 12 → 9 |
| Jul 23 09:13:42 | 28 → 8 → 24 → 29 |
| Jul 23 09:14:04 | 29 → 25 |
| Jul 22 22:25 | 2 → 3 |

**Four out of four sessions moved to a different op every attempt — the model never once repeated a mistake.** It fixed exactly what it was told and died anyway, because it was told one thing at a time. This is not a model deficiency; it is an information-rate defect in the feedback channel.

**Fix, in order of value:**
1. **Report all body errors at once.** Ops are independent; on failure, bind the name to a poison ref and continue compiling. One round-trip then carries N corrections instead of 1.
2. **Partial commit.** When a program has 60 valid ops and 2 broken ones, apply the 58-node subgraph and report the gap. Right now the user sees a blank canvas — the worst possible feedback, and the reason 19 sessions produced zero design signal.
3. Make the attempt budget a function of remaining *distinct* errors, not a flat 3.

---

### F-4 · Empty provider responses are being scored as model failures
**Severity: high (contaminates all your data) · Effort: ~1 day · Confidence: high**

17 sessions ended with `AI did not return valid JSON. Response was: (empty response)`. The pattern in every case is identical:

```
Response was not valid JSON (attempt 1/3) — asking the model to resend.
Response was not valid JSON (attempt 2/3) — asking the model to resend.
Error: AI did not return valid JSON. Response was: (empty response)
```

Two observations that change the interpretation:

- **The same models succeed elsewhere.** glm-5.2 blacked out at 18:58 and 10:21 and produced 49- and 57-node graphs on either side. deepseek, gemma, kimi, nemotron all show the same split. An empty response is not a capability signal.
- **Blackout rate correlates with response latency, not model quality.** minimax (244 s avg, 7/8 blackouts) and nemotron (251 s) dominate; qwen (94 s) has zero. That is the signature of output-token exhaustion or a reasoning-block-only completion, not of a weak designer.

`MAX_OUTPUT_TOKENS = 12000` with `stream: false`. A verbose-reasoning model that spends 12k tokens thinking returns a completion with no content field and no error. Your retry then re-sends the identical request twice — which will fail identically twice.

**Fix.**
1. Log `finish_reason` / `done_reason` and token usage alongside every failure. You cannot distinguish "model is bad" from "we cut it off" without this, and right now you are attributing the latter to the former across your whole benchmark.
2. On an empty completion, change something before retrying: raise the cap, strip reasoning, switch to streaming, or fall back to native tool-calling. Two identical retries have zero information value.
3. Consider streaming so a truncated response still yields a partial program.

---

### F-5 · Ghost edge removals — the Jul-12 bug, still live
**Severity: medium · Effort: ~half a day · Confidence: certain**

`[Patch] N removedEdgeIds entries matched NO edge` — **72 occurrences across 22 sessions (29%)**. Your Jul-22 note recorded this as "symptom fixed (de-noised), minted-id cause open". The symptom is indeed quieter; the cause is untouched and it is one of the most *widespread* defects in the corpus. Models are consistently reasoning about edge identities that don't exist, which means the edge-ID scheme they're shown doesn't match the one they're asked to use.

---

### F-6 · Inconsistent reference policy — the number-input wall, one layer up
**Severity: medium · Effort: ~half a day · Confidence: certain**

```
Argument "count" of "on_circle" must be an INLINE number or formula, not a reference.
```

`inlineNum` (compile.ts:309–320) hard-rejects `$refs` for `on_circle.count` and `remap`'s four bounds. Everywhere else in the language, `$refs` are the canonical form. A model has no way to know which arguments are second-class — the failure is unpredictable from the model's side, which is the exact shape of the number-input wall you diagnosed and fixed on 21 July at the node layer. It has reappeared at the IR layer.

**Fix.** Resolve slider refs to their current value at compile time with a note, or make count a driven parameter. Either way, remove the special case — an inconsistent rule is worse than a strict one.

---

### F-7 · Unhelpful error text on a malformed inline op
**Severity: low · Effort: 1 hour · Confidence: certain**

```ts
const subName = String(rawObj.op ?? '');   // compile.ts:198
… `inline op "" is unknown. Available ops: list, series, range, …`   // 45 names
```

When the object has no `op` key, the model is told its op is `""` and handed the full 45-op menu. It has no way to recover; two sessions died here. When `op` is missing, infer from the keys present (`{x,y,z}` → point, `{formula}` → expr, `{start,end,count}` → series) and say so.

---

### F-8 · Vocabulary gaps models reach for
`Unknown op "sketch"` · `Unknown op "subdivide"`. Also absent from the 45: **mirror, offset, shell/thickness, fillet, bounding-box, align, array-along-curve**. Mirror in particular is requested implicitly by every symmetric object in your corpus (formula 1, human body, skeleton, hat, temple) and is currently paid for in duplicated node subtrees.

### F-9 · Legacy JSON path still carries the socket/param confusion
58 `is an INPUT SOCKET of X, not a data parameter` warnings — concentrated in Compound (12), Cylinder (11), Expression (7), Torus (6), ScatterOnSurface (6). Only 6 of 77 sessions still route through the JSON/tools path (`ai-tools` appears in **one** session), so this is now legacy surface — but it's worth either fixing or removing, because a dead code path that still produces warnings costs you attention with no upside.

---

## 4. What your benchmark is currently measuring

This is the finding I'd put in a cover letter.

You are running a careful head-to-head: same prompt, 6–7 models, recorded verdicts. That design is sound. But right now the dominant term in the outcome variance is **your harness, not the models**:

- **25% of sessions never produce a graph.** Those are scored as model failures. At least 17 of them are empty-provider-response events (§F-4) and 11 are single-token-of-syntax compile deaths (§F-1).
- **Failure scales with program length, not with task difficulty.** Compare two procedural prompts of near-identical conceptual difficulty:

  | prompt | outcome |
  |---|---|
  | "make a circle divide it on ten points, translate up, scale…" (short) | 4 OK / 1 FAIL, nodes 15–56 |
  | "lets make a skeleton real one, from the point up the neck…" (long) | 1 OK / 5 FAIL, nodes **67, 0, 0, 0, 0, 0** |

  Same kind of thinking. The long one produced five total blackouts and one 67-node success. Programs don't fail because they're hard; they fail because they're *long enough to contain one syntax miss*.

- **Run-to-run variance exceeds between-model variance.** "sidney opera house" at 02:48 with qwen → your comment: *"most amazing result until now."* The same prompt at 10:21 across six models → 6/6 fail. Single-run comparisons at this noise level cannot rank models.

- **Sessions you liked had 7.3 timeline entries; sessions you called failures had 2.3.** Quality tracks *iterations survived*. The system currently dies before the design conversation starts. Time-to-first-valid-graph is your real throughput metric, and nothing in the current instrumentation measures it.

**Recommendation:** before the next benchmark round, split the outcome field into `transport_failure | compile_failure | design_failure`, and run n≥3 per model per prompt. Until then, treat the model table in §2.3 as a measure of *how well each model's output dialect happens to match your parser*, which is what it currently is.

---

## 5. What's working — and should be protected

An audit that only lists defects is a bad audit. Credit where it's due:

1. **The IR layer is the right architecture.** 52 of 77 sessions ran through it; 17 OK vs 14 FAIL. The 19 sessions that produced *nothing* are almost entirely ones that never reached it. The IR is not the problem — its input surface is.
2. **The Jul-22 coercion wave is measurably effective.** −92% compile loops, −94% engine faults. 542 successful auto-lifts. This is the highest-yield technique you have, and §F-1 is simply "do more of the thing that already worked."
3. **The verify-before-store discipline and the no-preorders methodology are holding.** I checked: no object-specific recipes have crept into `skills.ts` or `AGENTS.md`. The 45 ops are all topology-generic. Given how tempting it must be to hard-code a "column" or a "roof" while chasing a temple demo, that's real discipline.
4. **The timeline instrumentation (`c33dExport: 2`) is what made this audit possible.** Per-turn node/edge/isolated counts with diffs let me separate "died at turn 1" from "iterated four times and stalled" without guessing. Keep extending it — adding `finish_reason` and token counts (§F-4) would close the last blind spot.
5. **Annotating every export with an honest one-line verdict** is the single most valuable thing in the whole corpus. 77 labelled examples is a real dataset. Most people building this don't have one.

---

## 6. Recommended order of work

| # | Action | Est. | Expected effect |
|---|---|---|---|
| 1 | **F-1** Coerce literals in ref positions (call-strings, arrays, wrappers, arith) | 0.5 d | Removes ~50% of compile deaths |
| 2 | **F-3a** Report all body errors per attempt, not the first | 0.5 d | Turns 3 attempts into 3 *rounds* instead of 3 fixes |
| 3 | **F-2** N-ary `compound` / `union` via `parts` | 1 d | Unblocks every object with >4 components |
| 4 | **F-3b** Partial commit of the valid subgraph | 1 d | Converts blank canvases into critiquable drafts |
| 5 | **F-4** Log `finish_reason` + usage; vary the retry | 1 d | De-contaminates the benchmark |
| 6 | **F-6** Remove the inline-only argument special case | 0.5 d | Kills the last "unpredictable from the model's side" rule |
| 7 | **F-5** Fix minted edge IDs at source | 0.5 d | Removes the most widespread residual defect (29%) |
| 8 | **F-8** Add `mirror`, then re-measure before adding more ops | 0.5 d | Symmetry is implicit in most of your corpus |

Items 1–4 are all in `src/ai/ir/compile.ts` and `skills.ts`. None require kernel work. On the evidence in this corpus, they would move a substantial share of the 35 failures into the WEAK-or-better band — where you can finally start arguing with the models about *design* instead of about syntax.

---

## 7. One closing observation

Your stated goal is parametric design *intelligence* — models that are creative in a geometric space. The most encouraging thing in this corpus is how often the intent was right and the encoding was wrong: a 73-step skeleton that died assembling itself, a temple that built its own pediment from three named points and was refused for using an array, a balloon that placed its skirt with `point(0, 0, -balloonRadius*0.75)` — a *parametric* placement, expressed in a dialect one regex away from being accepted.

The models are already designing. Right now, most of what you are measuring is whether they can spell.

---

*Method: 77 `c33dExport:2` sessions (2026-07-22T11:36 → 2026-07-25T10:21), 954-record `intelligence_log.json`, and `github.com/3esign/c33d` @ `75800e5`. All error counts are regex-extracted from session transcripts; code line numbers refer to that commit. Repo state: Jul-22 work committed and pushed (`main` in sync with `origin/main`); working tree clean apart from untracked exports.*
