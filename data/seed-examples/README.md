# Seed Examples

This directory contains a curated corpus of verified, successful C33D model graphs. These examples are used as few-shot demonstrations in the AI agent's prompt (the "knowledge loop"), and as a shared community resource for contributors.

## License

All examples in this directory are released under **Creative Commons Attribution 4.0 International (CC-BY-4.0)**.

If you contribute an example, you agree to license it under CC-BY-4.0.

## Schema

Each example is a JSON file with the following structure:

```json
{
  "id": "unique-slug-describing-the-object",
  "name": "Human-readable name",
  "description": "What it is and what makes it a good example of parametric design",
  "prompt": "The original natural language prompt used to generate this",
  "graph": { ... },
  "tags": ["keyword1", "keyword2"],
  "verifiedBy": "contributor-github-handle",
  "verifiedAt": "2026-07-09",
  "modelUsed": "gemini-2.5-pro"
}
```

## Contributing Examples

1. Build a model in C33D and verify it works correctly (sliders produce coherent behavior).
2. Click "Save as Example" in the UI (or export the graph JSON manually).
3. Add it as `data/seed-examples/your-object-name.json` following the schema above.
4. Open a PR — the maintainer will test and verify the graph before merging.

## Current Examples

*(Empty — first examples will be added after the proportional-coherence work lands, ensuring verified examples remain coherent under parameter perturbation.)*
