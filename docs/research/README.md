# C33D Research & Design Documents

This directory contains the foundational research and design documents for C33D's architecture. They map the evolution from basic shape generation to an AI-native parametric CAD platform.

## Document Index (Reading Order)

1. **[Proportional Coherence](proportional_coherence_plan.md)** — The core thesis of the project: how to generate node graphs that maintain structural integrity when parameters change, avoiding the brittleness of direct LLM geometry output.

2. **[Sub-Shape Editing (B-Rep tier)](subshape_editing_design.md)** — Giving the LLM the ability to subdivide objects and push/pull specific faces parametrically, overcoming OpenCascade's topological naming problem via semantic query descriptors.

3. **[Point / Vector / Curve Toolkit](vector_curve_toolkit_research.md)** — A deep inventory of the missing geometric infrastructure required for LLMs to reason about space, anchors, and alignment. Cross-referenced against Grasshopper, Dynamo, and Blender GN.

4. **[Node Expansion](node_expansion_research.md)** — The phased plan for expanding the `replicad` node capabilities to reach parity with traditional parametric tools. Contains the "S/M/L cost" catalog — S-cost rows are good-first-issue candidates.

5. **[Eval Upgrade](eval_upgrade_plan.md)** — The evaluation methodology for measuring "parametric design intelligence": testing whether a model's design survives slider perturbations, with versioned metrics and variance requirements.

## How C33D Relates to Other Systems

| System | What it's for | How C33D differs |
|---|---|---|
| **Text2CAD-Bench / CAD-Coder** | Measures if a model can generate code that produces a *static* shape | C33D measures if the model can author a *graph* that survives parameter changes |
| **Grasshopper / Dynamo** | Human-authored parametric node graphs | C33D's node graphs are AI-authored; human editable via sliders |
| **Zoo / KCL** | AI-generated CAD code, vendor-hosted | C33D is browser-native, BYOK, open source |
| **Blender + LLM plugins** | Destructive mesh editing | C33D uses real B-Rep (STEP-exportable, manufacturing-grade) |

The project's unique niche is the **AI-native parametric loop**: verify-before-store knowledge, perception–action feedback, and the first evaluation suite that scores proportional integrity.
