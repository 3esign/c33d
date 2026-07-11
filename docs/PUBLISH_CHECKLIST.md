# Publish Checklist — 2026-07-11

Everything is committed on `main`, 4 commits ahead of `origin/main` (github.com/3esign/c33d). Working tree clean.

## Ready to publish

The commits waiting to go out:

1. `cacefaa` / `8cea23b` / `945f0c4` — earlier reliability fixes (shape lifetime, budget leaks, save-gate).
2. `dfb4a7d` + `f179f6f` — phantom-error fix, decoupled perturbation, issue aggregator, key validation.
3. `30ebbff` — **this session**: engine-fault caps, phantom-edge/no-op feedback, type-change param reset, Text3D font preload, text-answer rule (details: `docs/local_model_harness_fixes.md`).
4. `05b7434` — Reasoning tab + Ollama cloud-model JSON-format fix.

## The button

```
git push origin main
```

Vercel is linked (`.vercel/project.json`) — if the project has git integration, the push auto-deploys. Otherwise run `npx vercel --prod` after the push.

## Verified before publish

`tsc -b` (the type gate of `npm run build`) passes on the exact committed tree. Test suite: 9/11 pass; the 2 failures (`test_flower_integration.mjs`, `test_nonuniform.mjs`) fail identically on the previous release commit — pre-existing, not from these changes. The phantom-error regression test passes.

The `vite build` bundling step was not runnable in the sandbox used for verification (WASM mmap limitation, not a code issue) — Vercel runs the full `npm run build` on deploy and will surface any bundling problem there. If deploying manually, run `npm run build` locally once first.

## After publish — first thing to do

Re-run the multi-model cat benchmark (including Gemma via Ollama) against the deployed build and log the results as the new knowledge-base baseline — the pre-fix transcripts measured a rigged game (see `docs/local_model_harness_fixes.md`).

## Known open items (tracked, not blockers)

Two pre-existing test failures above; kernel-level shape-lifetime audit (P2 in `docs/cat_multimodel_test_analysis.md`); L0 floor benchmark not yet added to `evalHarness.ts` (P3 item 16).
