# C33D — Consolidated Development Roadmap
*July 2026. A living design record and master roadmap combining implementation phases, code-level analysis, reliability diagnostics, and architectural conventions.*

---

## 1. The Perception–Action Loop (The Intelligence Harness)

An LLM reasons in language and emits symbols, but has no innate 3D perception. The core architecture of C33D is a **perception–action loop** built around a blind reasoner:

```
  intent (language)
      ↓  reasoning
  design plan (parts, proportions, relationships)   ← semantic layer
      ↓  compilation
  node graph (typed operations, driven parameters)  ← symbolic layer
      ↓  deterministic evaluation (OpenCascade)
  geometry (B-Rep solids)                           ← physical layer
      ↓  measurement + rendering
  percepts (bounding boxes, volumes, snapshots)     ← perception layer
      ↓  feedback
  reasoning (repair / refine / confirm)             ← closes the loop
```

### The Remapping Strategy
1. **Relative Placement Over Absolute Coordinates:** Parts attach to parts (using `PlaceOnSurface`, `PlaceOnVertices`, `ScatterOnSurface`, or `Align`), with only the root solid at the origin. The model reasons about topology and relationships rather than coordinates.
2. **Relationships as Expressions:** Proportions (e.g., `wheelRadius = 0.12 * chassisLength`) are defined via `Expression` nodes to persist design constraints through changes.
3. **Structured Plans:** The model emits a structured semantic plan (named parts, roles, relationships, ratios) before graph nodes to guide the decomposition.
4. **Symbolic Percepts:** A geometry report (bounding boxes, volumes, centroid distances, intersection check) provides quantitative data for the model to analyze.
5. **Macros for Reusability:** Distilling successful subgraphs into reusable macros reduces reasoning distance.

---

## 2. Core Implementation Phases

### Phase 1: Geometry Report & Auto-Retry Loop (Reflexes)
* **Goal:** The model automatically detects and repairs its own geometry errors.
* **Details:**
  * Track per-leaf-node metrics (bounding box, volume, center of mass, null/failed flags) after evaluation.
  * If a sanity check fails (degenerate bbox, NaN volumes, disconnected parts), trigger an auto-repair turn sending the report + error back to the model (cap at 2 retries).
  * Update `success` logging to represent "sane geometry" rather than "JSON parsed successfully."

### Phase 2: Auto-Layout & Prompt Optimization
* **Goal:** Shrink the system prompt and eliminate layout tokens.
* **Details:**
  * Integrate `elkjs` or `dagre` for automated canvas layout; ignore coordinate `position` inputs from the AI.
  * Remove layout math rules from the system prompt.
  * Condense graph state representation in prompt to `{id, type, params, inputs←sources}`.

### Phase 3: Success Library
* **Goal:** Curate a library of user-verified successful graphs.
* **Details:**
  * Add a "Save as successful" button in the viewport.
  * Store original AI graph, user-modified graph, prompts, comments, model name, and a 256px isometric snapshot.
  * Provide a library panel with thumbnail grid to load, inspect, or delete examples.

### Phase 4: Few-Shot Example Retrieval
* **Goal:** Dynamically feed contextually relevant successful examples to the model.
* **Details:**
  * Embed examples' prompts and comments locally using `@xenova/transformers` (MiniLM).
  * Perform semantic search on new requests and inject top-2 similar examples as few-shots.

### Phase 5: Parametric Expression Core
* **Goal:** Enable dynamic design changes via top-level parameters.
* **Details:**
  * Add `Constant/Number` nodes (`{label, value}`) and `Expression` nodes (`{formula, inputs}`).
  * Allow number outputs to drive numeric params of other nodes (locking the slider in the UI).
  * Resolve number-graph values via topological sorting before geometry evaluation.

### Phase 6: Native Tool Calling
* **Goal:** Replaces large fragile JSON documents with native schema-guided API calls.
* **Details:**
  * Implement tool-calling protocol (`add_nodes`, `update_nodes`, `connect`, `remove_nodes`, `finish`).
  * Run a multi-turn builder loop where the model gets intermediate geometry feedback and acts incrementally.
  * Retain JSON-mode only as a fallback for Ollama/non-tool models.

### Phase 7: Visual Verification Loop (Vision Criticism)
* **Goal:** Catch spatial bugs that escape numerical tests.
* **Details:**
  * Snapshot 4 views (iso/front/side/top) upon build completion.
  * Send snapshots to a vision-capable LLM to verify alignment with intent. If discrepancies are found, trigger a repair turn.

### Phase 8: Macros (Compounding Vocabulary)
* **Goal:** Allow user-distilled subgraphs to act as custom nodes.
* **Details:**
  * Add `Macro` node referencing a subgraph with declared exposed input parameters.
  * Implement subgraph expansion in worker evaluation.
  * Support macro creation by canvas selection or example distillation.

### Phase 9: Evaluation Harness
* **Goal:** Measure model capability quantitatively.
* **Details:**
  * Implement 30 fixed test prompts across 4 difficulty tiers.
  * Score runs on: parsing, execution success, geometry sanity, node count, and duration (with optional VLM-judge grading).

### Phase 10: Engine Memoization & Memory Hygiene
* **Goal:** Optimize performance and prevent memory leaks.
* **Details:**
  * Implement dirty-subtree memoization: cache computed shapes by hashing node inputs and dependencies.
  * Track and explicitly call `.delete()` on stale OpenCascade shapes in WASM to prevent memory growth.
  * Support evaluation cancellation for rapid slider updates.

---

## 3. Systemic Reliability & Diagnostics (Hardening the Loop)

### Graph Integrity & Auto-Repair Diagnostics
To prevent cascading failures in multi-turn editing and auto-repairs, the following validation rules must be enforced:
* **Pre-Evaluation Validation Gate:** Before sending geometry to the worker, walk the graph. Reject with a clear error if any node lacks required inputs (e.g. `Translate missing solid`, `Expression missing variable edge`).
* **Dependency Trace (`explainNullGeometry`):** When a solid evaluates to null, trace back to the first node that failed or had missing inputs, and highlight the root cause instead of intermediate symptoms.
* **Containment De-noising:** 
  * If >40% of leaf nodes share a center or have near-zero bounding boxes, raise a `Collapse Alert` indicating missing coordinate/expression connections.
  * Limit the reported overlapping pair list to the top-5 most severe intersections, ignoring null/degenerate geometries.
* **Edge Compression:** Allow implicit connections for simple solid-to-solid transforms (defaulting to the `"solid"` handle if there is only one option) to reduce token overhead.

### Parameters Scope Resolution
* Keep a unified scope: `{sliders ∪ constants ∪ expressions}`.
* Evaluate the dependency graph in topological order.
* Detect cycles early and reject with an explicit warning.
* Explicitly alert on unknown symbols (never silently default to `0`).
