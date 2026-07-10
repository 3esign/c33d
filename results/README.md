# Evaluation Results

This directory will host versioned evaluation runs across different LLM providers (e.g., Gemini, OpenAI, Anthropic, local models) to establish a matrix of which models can successfully perform parametric design.

## Important Disclaimer

> **These metrics measure capability specifically within C33D's node vocabulary and architecture.** They evaluate how well a model can author a Replicad/OpenCascade B-Rep node graph that survives parameter changes (proportional coherence). This is *not* a measure of general CAD ability or general coding ability.

## Evaluation Protocol

Our evaluation methodology goes beyond static text-to-CAD metrics (like Chamfer distance on a single output). We score models based on:
1. **Parse / Compile**: Can the model emit valid JSON that conforms to the node library schema?
2. **Execute**: Does the OpenCascade worker successfully build the B-Rep shape without self-intersections or topological errors?
3. **Geometry Sanity / Vision**: Does the resulting shape look correct and have sane bounding box volumes?
4. **Parametric Integrity (Proportional Coherence)**: **(The core metric)** Does the generated graph survive slider perturbations? If we change the "Length" parameter by 2x, does the model stretch coherently, or do attached components (like wheels on a car) float away into empty space?

## Results Matrix

*The cross-provider matrix will be published here once the evaluation upgrade (version stamps, protocol fields, and n=3 repeats) is finalized to ensure statistically rigorous, non-noisy comparisons.*
