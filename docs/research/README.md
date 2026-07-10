# C33D Research & Design Documents

This directory contains the foundational research and design documents for C33D's architecture. They map the evolution from basic shape generation to an AI-native parametric CAD platform.

## Document Index (Reading Order)

1. **[Proportional Coherence](proportional_coherence_plan.md)**: The core thesis of the project—how to generate node graphs that maintain structural integrity when parameters change, avoiding the brittleness of direct LLM geometry output.
2. **[Sub-Shape Editing (B-Rep tier)](subshape_editing_design.md)**: Giving the LLM the ability to subdivide objects and push/pull specific faces parametrically, overcoming OpenCascade's topological naming problem via semantic queries.
3. **[Point / Vector / Curve Toolkit](vector_curve_toolkit_research.md)**: A deep inventory of the missing geometric infrastructure required for LLMs to reason about space, anchors, and alignment.
4. **[Node Expansion](node_expansion_research.md)**: The phased plan for expanding the `replicad` node capabilities to reach parity with traditional parametric tools (grasshopper/Blender).
5. **[Eval Upgrade](eval_upgrade_plan.md)**: Establishing the evaluation methodology to measure "parametric design intelligence"—testing whether a model's design survives slider perturbations.

## Relationship to Other Systems
* c33d differs from *Text2CAD-Bench* or *CAD-Coder* by focusing on the **AI-native parametric loop**. We don't just measure if the model can write code to produce a static shape; we measure if the model can author a robust graph that remains editable.
* c33d uses a **verify-before-store knowledge loop**, where the AI saves successful designs as few-shot examples, extending its own vocabulary.
