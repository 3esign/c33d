# Evaluation Results

This directory hosts versioned evaluation runs across different LLM providers to establish a matrix of which models can successfully perform parametric design.

## Disclaimer

> **These metrics measure capability within C33D's node vocabulary and architecture.** They evaluate how well a model can author a Replicad/OpenCascade B-Rep node graph that survives parameter changes. This is *not* a measure of general CAD ability or general coding ability.

## Protocol

Scores are computed by the eval harness (`src/ai/evalHarness.ts`) across four dimensions:

| Dimension | Description |
|---|---|
| **Parse** | Graph JSON is valid and conforms to the node library schema |
| **Execute** | OpenCascade worker builds the B-Rep without errors |
| **Geometry Sanity** | Bounding box is non-degenerate; volume is non-zero; no NaN values |
| **Parametric Integrity** | Design survives slider perturbations (proportional coherence) |

Each published row **must** carry: `model`, `modelVersion`, `provider`, `date`, `metricsVersion`, `promptSetVersion`, `nodeLibraryVersion`, and per-metric scores with variance (`n ≥ 3` runs). Ranked comparisons without variance will not be merged.

## Result File Schema

```json
{
  "runId": "gemini-2.5-pro-2026-07-09",
  "date": "2026-07-09",
  "model": "gemini-2.5-pro",
  "modelVersion": "gemini-2.5-pro-preview-06-05",
  "provider": "Google Gemini",
  "metricsVersion": "1.0.0",
  "promptSetVersion": "1.0.0",
  "nodeLibraryVersion": "0.1.0",
  "runsPerPrompt": 3,
  "results": {
    "parse":       { "mean": 0.92, "stddev": 0.04 },
    "execute":     { "mean": 0.85, "stddev": 0.06 },
    "sanity":      { "mean": 0.81, "stddev": 0.07 },
    "parametric":  { "mean": 0.62, "stddev": 0.11 }
  },
  "byDifficulty": {
    "L1": { "parse": 1.0,  "execute": 0.97, "sanity": 0.95, "parametric": 0.88 },
    "L2": { "parse": 0.95, "execute": 0.90, "sanity": 0.86, "parametric": 0.70 },
    "L3": { "parse": 0.88, "execute": 0.78, "sanity": 0.73, "parametric": 0.50 },
    "L4": { "parse": 0.82, "execute": 0.65, "sanity": 0.60, "parametric": 0.35 }
  },
  "notes": "Optional free-text notes about the run conditions"
}
```

## Submitting Results

1. Run the local eval harness (`npm run eval` — coming with eval upgrade Phase 1).
2. Save your result as `results/YYYY-MM-DD-model-provider.json`.
3. Open a PR. The schema is validated automatically by CI.

## Results Matrix

*Cross-provider matrix will be published once the eval upgrade (version stamps, protocol fields, and n=3 repeats) is finalized. Publishing single-run numbers invites fair criticism that rankings are noise.*
