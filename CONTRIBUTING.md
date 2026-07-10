# Contributing to C33D

Thank you for your interest in contributing! C33D is an open research platform for AI-native parametric CAD. We welcome contributions at every level.

## Three Ways to Contribute

### (a) Node Contributions
Add new parametric operations to the node library.

**The Standard Kit** — every new node requires:
1. **Executor** (`src/worker/executors.ts`): The worker-side OpenCascade/replicad logic.
2. **Definition** (`src/nodes/NodeDefinitions.ts`): The schema — input handles, output handles, parameters, and slider limits.
3. **Validation** (`src/ai/graphValidation.ts`): Port type checks and guardrails to prevent invalid connections.
4. **Percept** — the node should report useful geometry data (volume, face count, bounding box) back to the LLM for the auto-repair loop.
5. **Exemplar** — add at least one verified example graph using the new node to `data/seed-examples/`.
6. **Eval Prompt** — add at least one L1/L2 test prompt to `docs/test_prompts.md`.

See [docs/contributing/adding-a-node.md](docs/contributing/adding-a-node.md) (coming soon) for a walkthrough.

Good first nodes to add: see the "S-cost" rows in [docs/research/node_expansion_research.md](docs/research/node_expansion_research.md) — these are well-specified, isolated tasks ideal for first contributions.

### (b) Eval & Knowledge Contributions
- **Add test prompts**: Open a PR adding prompts to `docs/test_prompts.md` at the appropriate difficulty level (L1-L4).
- **Submit eval runs**: Run the local eval harness and submit a versioned JSON result to `results/`. The schema is documented in `results/README.md`.
- **Contribute verified examples**: If the model produces a great design, save it (with human verification) as a seed example in `data/seed-examples/` under CC-BY-4.0.

### (c) Research Contributions (RFCs)
For significant design proposals, open an RFC:
1. Create `docs/rfcs/NNN-your-title.md` based on the existing research documents as quality references.
2. Open a PR for discussion — merge signals acceptance.

RFCs are **required** for: changes to the data model, evaluation metrics, or node library schema. Everything else can go straight to a PR.

## Bug Reports

Use the issue template and include:
- The **graph JSON** that caused the failure (copy from the editor)
- The **model and provider** used
- The **error message** from the console

## Pull Request Checklist

- [ ] Code builds without errors: `npm run build`
- [ ] TypeScript compiles: `tsc -b`
- [ ] Worker unit tests pass: `node tests/test_selection.mjs`
- [ ] Node contributions include all standard kit items (executor, definition, validation, percept, exemplar, eval prompt)

## Governance

Semir Poturak, PhD is the sole maintainer. RFCs are required for data model / metric changes. All other decisions are made by PR review.

---

*C33D — Copyright 2026 Semir Poturak, PhD — Apache-2.0*
