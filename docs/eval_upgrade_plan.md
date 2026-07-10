# Eval System Upgrade Plan — Measuring What Parametric Quality Means

*July 9 2026. Upgrades the existing eval harness (30 prompts, 4 levels) into a rigorous, reproducible
measurement instrument for the tool itself. Companion to `proportional_coherence_plan.md`.*

The system stays what it is — the quality dashboard of a 3D modeling tool. Everything below is framed
as acceptance checks and regression metrics; the same properties (fixed tasks, deterministic scoring,
versioning, cross-model comparability, held-out prompts) are what make results externally citable
later, if ever desired. No re-branding needed.

## Phase 1 — Proportional-integrity metric (the new core signal)

**Worker** (`geometryWorker.ts`): add an `evaluateVariant` message: re-evaluate the current graph with
overridden slider values *without* touching render state. After each successful eval build:

1. Identify driver sliders (NumberSlider nodes, ranked by out-degree; cap at top 2 to bound cost).
2. Build the **relation signature** at defaults from data the leaf-meshing pass already computes:
   per-leaf bbox/center → contact pairs (touch/overlap), containment pairs, leaf centers normalized by
   assembly size, assembly bbox aspect ratios.
3. Re-evaluate at 0.6× and 1.5× per driver; recompute signature; score = fraction of relations
   preserved (contact kept, no new burials/detachments, normalized centers within tolerance).

Worker-only — zero extra LLM calls, so it runs on every eval prompt for free.

**Scoring** (`verification.ts`): `scoreProportionalIntegrity(signatures) → { score: 0..1, violations: string[] }`
with violations phrased in repair-loop vocabulary ("at bodyLength +50%, 'eye_r' detaches from 'head'").

**Harness** (`evalHarness.ts`, `useStore`, `EvalPanel.tsx`): add `proportionalIntegrity` to the outcome
and `EvalResult`; new column in the panel; persists through the existing `/api/eval-results` middleware.

Exit criterion for the phase: one full suite run per configured agent slot. If scores spread across
models and levels (rather than everyone scoring ~equal), the metric discriminates — that is the
"know within a week" test.

## Phase 2 — Determinism and versioning (comparability over time)

- Seed everything stochastic (`ScatterOnSurface`, future `Jitter`/`RandomPoints`): fixed seed per eval
  run, recorded in the result row.
- Stamp every result row with `metricsVersion`, `promptSetVersion`, and `nodeLibraryVersion` (hash of
  `NodeDefinitions.ts` node names + params). Rows are only compared within matching versions — this is
  what makes month-old numbers meaningful after the node library grows.
- Record the **protocol actually used** (tool-loop vs JSON fallback) per run. The bee transcript showed
  silent protocol degradation; without this field, a "model regression" can actually be a 403.
- Pin the vision judge: fixed judge model + prompt template, identity recorded in the row. Treat
  visionScore as a soft aesthetic signal only — Phase 3 carries fidelity.

## Phase 3 — Per-prompt acceptance checks (fidelity without a judge)

Extend `EvalPrompt` with optional declarative checks evaluated against the geometry report — reuse the
existing expression evaluator over report values:

```ts
{ id: 'L1-01', level: 1, prompt: 'Make a cube with 15mm sides.',
  checks: ['abs(bbox.x - 15) < 0.15', 'abs(bbox.y - 15) < 0.15', 'abs(bbox.z - 15) < 0.15'] }
{ id: 'L2-01', checks: ['volume < 30*30*5 * 0.99'] }            // hole actually removed material
{ id: 'L3-05', checks: ['sliderCount >= 1', 'paramCoverage > 0.6', 'proportionalIntegrity > 0.8'] }
{ id: 'L4-07', checks: ['sliderCount >= 2', 'leafCount >= 4'] }
```

`checkScore` = fraction passed. This converts the weak `geometrySane` boolean into task-fidelity
measurement that is exact, free, and impossible to argue with. Add `paramCoverage` (from the
proportional-coherence lint) to the report so checks can reference it.

## Phase 4 — Matrix runs and reporting

- `runEvalSuite({ agentIds, repeats })`: iterate over multiple agent slots sequentially (the harness
  currently runs only the active slot); optional n=3 repeats with mean/variance — single stochastic
  runs are noise, and variance itself is a quality signal (flaky model vs consistent).
- EvalPanel aggregate view: level × metric matrix per model, delta vs the previous run of the same
  versions (regression highlighting), CSV/Markdown export of the summary table.
- Composite score per run: weighted (checkScore 0.4, proportionalIntegrity 0.3, evaluatedOk 0.2,
  visionScore 0.1) — weights in one place, versioned as part of `metricsVersion`.

## Phase 5 — Suite hygiene and growth

- Split prompts: the in-repo dev set (current 30, grow toward ~50 with category tags: mechanical,
  organic, architectural, parametric-relations) plus a small **held-out set** in a local gitignored
  file (like EVAL_RESULTS.json). Iterating on system prompts and the knowledge base overfits to
  visible prompts; the held-out delta measures how much.
- Every new capability ships with 2–3 prompts (already the standard kit; enforce it).
- L4 creative briefs keep no checks — they're scored by proportionalIntegrity + paramCoverage +
  vision only. Creativity should not be regression-tested into blandness.

## Sequencing and effort

| Step | Files | Effort |
|---|---|---|
| 1. evaluateVariant + relation signature | geometryWorker.ts | 1–2 days |
| 2. scoring + violations | verification.ts | 0.5 day |
| 3. harness/panel/result plumbing | evalHarness.ts, useStore.ts, EvalPanel.tsx | 0.5 day |
| 4. seeds + version stamps + protocol field | worker, evalHarness, api.ts | 0.5 day |
| 5. checks DSL + per-prompt checks | evalHarness.ts (+ report additions) | 1 day |
| 6. matrix runner + aggregate view | evalHarness.ts, EvalPanel.tsx | 1–2 days |
| 7. held-out set + category tags | evalHarness.ts, .gitignore | 0.5 day |

Steps 1–3 are the week-one payoff: run the suite across the provider matrix and read whether
proportional integrity separates models. Steps 4–5 make numbers trustworthy; 6–7 make them durable.
The perturbation violations also feed the live repair loop (proportional-coherence plan Rec. 1), so
step 1 improves the product and the measurement with one implementation.
