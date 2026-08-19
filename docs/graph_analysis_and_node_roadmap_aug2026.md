# C33D Graph Dataset Analysis & Parametric CAD Roadmap (August 2026)

## 1. Executive Summary

This document records the empirical findings, error taxonomy, and architectural roadmap derived from analyzing:
- **105 exported JSON graphs** in `JSONs/*.json` (2,553 total nodes, 2,184 edges).
- **123 recorded multi-turn sessions** in `data/c33d.db` (1,000 model runs, 3,488 messages, 106 user review verdicts).
- **Test suite results**: 26/26 passing test suites covering the WASM OpenCascade kernel, IR compiler, and graph execution runtime.

The goal is to provide a complete, actionable technical blueprint for the next agent or developer to expand the node library, eliminate multi-turn graph editing failures, and elevate procedural CAD modeling fidelity.

---

## 2. Dataset Metrics & Empirical Findings

### 2.1 Node Distribution & Graph Topologies
Across all 105 exported graphs:
- **Total Nodes**: 2,553
- **Total Edges**: 2,184
- **Isolated Nodes**: 486 (19.0% of all nodes in user graphs had zero inputs or outputs wired).
- **Math/Scaffolding Dominance**: 45.7% of all generated nodes were purely low-level coordinate or scalar math:
  - `NumberSlider`: 410 (16.1%)
  - `Expression`: 386 (15.1%)
  - `Point`: 370 (14.5%)
  - `Box`: 131 (5.1%)
  - `Translate`: 113 (4.4%)
  - `Cylinder`: 111 (4.3%)
  - `Sphere`: 89 (3.5%)
  - `ListConstant`: 86 (3.4%)
  - `Cone`: 66 (2.6%)
  - `Rotate`: 64 (2.5%)
  - `InstanceOnPoints`: 61 (2.4%)
  - `Compound`: 60 (2.4%)

### 2.2 Top Edge Chains
The most frequent edge connections demonstrate how models currently assemble graphs:
1. `Expression -> Expression` (166 edges): Deep mathematical chaining for trigonometry and offsets.
2. `Expression -> Point` (105 edges): Mapping scalars into point coordinates.
3. `Point -> Box` / `Point -> Cylinder` (143 edges): Positioning primitives.
4. `PointsFromLists -> InstanceOnPoints` (40 edges): Distributing instances.
5. `RepeatEach -> PointsFromLists` & `Tile -> Expression` (86 edges): Cross-product 2D/3D grids.

### 2.3 Error Taxonomy & Failure Signatures
Analysis of `data/c33d.db` messages table reveals the top failure modes:

| Rank | Failure Signature | Occurrences | Technical Root Cause | Proposed Remedy |
| :--- | :--- | :--- | :--- | :--- |
| **1** | `[Patch] removedEdgeIds matched NO edge` | **185** | Multi-turn editing hallucinated edge UUIDs (`e-1234`) instead of referencing live ReactFlow edge IDs. | Implement semantic endpoint matching `{ from, to }` in `agent.ts`. |
| **2** | `Engine fault / OpenCascade crash` | **122** | Degenerate boolean cuts, zero-thickness face lofts, or self-intersecting fillets. | Add geometric guardrails and safe fallback bounding. |
| **3** | `Response was not valid JSON / Blackouts` | **114** | Large multi-part raw graph output exceeded token limits before JSON was closed. | Enforce IR compilation path over raw JSON emission. |
| **4** | `[Warning] Socket X is an INPUT SOCKET...` | **40+** | LLMs confusing node `data` parameters with graph input sockets. | Auto-coerce data parameters to matching sockets when unattached. |

---

## 3. Qualitative User Feedback Trends

User reviews and verdicts in `c33d.db` highlighted 4 major recurring themes:

### Theme A: Architectural / Urban / Facades (*"make a procedural building / city"*)
- **Complaint**: Models produced disconnected stacks of extruded cubes without internal floor slabs, wall thickness, or aligned window arrays.
- **Missing Nodes**: `CurveOffset` (for wall/slab thickness), `Ngon` (regular polygons), and `FloorGrid` / `FacadeDivider`.

### Theme B: Botanical / Organic (*"make a rose / flower / tree"*)
- **Complaint**: Petal layering and spiral whorls failed because models tried to hand-code polar coordinates using 12+ math nodes; only the stem was generated.
- **Missing Nodes**: `Phyllotaxis` / `FibonacciSpiral` (golden angle distribution) and `MultiLoft` (multi-cross-section skinning).

### Theme C: Transport / Aerospace (*"make a boeing 747 / spaceship"*)
- **Complaint**: Fuselages looked like single cones or cylinders rather than smooth lofted aerodynamic cross-sections.
- **Missing Nodes**: `MultiLoft` with variable scaling along guide spines and `AirfoilCurve`.

### Theme D: Curve Instancing (*"divide curve and place spheres with varying radius"*)
- **Complaint**: Instances on curves lacked tangent alignment; shapes did not tilt with the curvature of the path.
- **Missing Nodes**: `CurveFrame` (Frenet frame output: tangent, normal, binormal).

---

## 4. Technical Blueprint for New Nodes

### Node 1: `MultiLoft`
- **Purpose**: Loft across an arbitrary list of 3+ cross-section curves (or `curve1`..`curve8` input sockets).
- **Node Definition** (`src/nodes/NodeDefinitions.ts`):
  ```typescript
  MultiLoft: {
    type: 'MultiLoft',
    label: 'Multi Loft',
    category: 'geometry',
    inputs: [
      { name: 'curves', type: 'Curve[]' },
      { name: 'curve1', type: 'Curve' },
      { name: 'curve2', type: 'Curve' },
      { name: 'curve3', type: 'Curve' },
      { name: 'curve4', type: 'Curve' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'ruled', type: 'boolean', default: false },
      { name: 'closed', type: 'boolean', default: false },
    ],
  }
  ```
- **WASM Executor** (`src/worker/executors.ts`):
  Collect all input curves into an array, ensure matching orientations, call `oc.BRepOffsetAPI_ThruSections` (or `replicad.loft(wires, { ruled, closed })`), and return the fused solid.

---

### Node 2: `Phyllotaxis` (Fibonacci Spiral Generator)
- **Purpose**: Generate golden-ratio spiral point distributions on flat planes or spherical caps for petals, florets, seeds, and spiral stairs.
- **Node Definition**:
  ```typescript
  Phyllotaxis: {
    type: 'Phyllotaxis',
    label: 'Phyllotaxis (Spiral)',
    category: 'math',
    inputs: [
      { name: 'count', type: 'number' },
      { name: 'spread', type: 'number' },
    ],
    outputs: [
      { name: 'points', type: 'Point[]' },
      { name: 'rotations', type: 'Vector[]' },
      { name: 'radii', type: 'number[]' },
    ],
    params: [
      { name: 'count', type: 'number', default: 34, min: 1, max: 500, step: 1 },
      { name: 'spread', type: 'number', default: 2.0, min: 0.1, max: 20, step: 0.1 },
      { name: 'divergenceAngle', type: 'number', default: 137.5077, min: 0, max: 360, step: 0.01 },
      { name: 'pitchZ', type: 'number', default: 0.2, min: -10, max: 10, step: 0.05 },
      { name: 'domeRadius', type: 'number', default: 0, min: 0, max: 100, step: 0.5 },
    ],
  }
  ```
- **Executor Math**:
  For $n = 0 \dots (\text{count} - 1)$:
  $$\theta = n \times \text{divergenceAngle} \times \frac{\pi}{180}$$
  $$r = \text{spread} \times \sqrt{n}$$
  $$x = r \cos(\theta), \quad y = r \sin(\theta), \quad z = n \times \text{pitchZ} - \frac{r^2}{2 \times \text{domeRadius}}$$

---

### Node 3: `CurveOffset` / `PolygonOffset`
- **Purpose**: Inset or outset 2D planar curves/polygons for architectural floorplans, window mullions, and hollow walls.
- **Node Definition**:
  ```typescript
  CurveOffset: {
    type: 'CurveOffset',
    label: 'Curve Offset',
    category: 'geometry',
    inputs: [{ name: 'curve', type: 'Curve' }, { name: 'distance', type: 'number' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'distance', type: 'number', default: 1.0, min: -50, max: 50, step: 0.1 },
      { name: 'joinType', type: 'string', default: 'round' }, // 'round' | 'miter' | 'bevel'
    ],
  }
  ```

---

### Node 4: `CurveFrame` (Tangent & Normal Align)
- **Purpose**: Evaluate a curve at parameter $t$ or length $s$ to provide Frenet frames $(P, T, N, B)$ for orienting instances along arbitrary 3D paths.
- **Outputs**: `points` (Point[]), `tangents` (Vector[]), `normals` (Vector[]), `rotations` (VectorXYZ[] angles in degrees).

---

### Node 5: `RegularPolygon` (N-Gon Wire)
- **Purpose**: Fast parametric generation of equilateral triangles, pentagons, hexagons, octagons, and star polygons without manual SVG string construction.
- **Params**: `sides` (3..32), `radius` (outer radius), `filletRadius` (corner rounding), `starRatio` (1.0 = regular, < 1.0 = star).

---

## 5. Graph Logic & Engine Enhancements

### 5.1 Semantic Edge Patching in `agent.ts`
When an AI agent sends a patch with `removedEdgeIds: ["e_123"]` that fails to match a ReactFlow UUID, the patcher should fallback to endpoint resolution:
```typescript
function findEdgeByEndpoints(edges: Edge[], fromNodeId: string, toNodeId: string, targetHandle?: string): Edge | undefined {
  return edges.find(e => 
    e.source === fromNodeId && 
    e.target === toNodeId && 
    (!targetHandle || e.targetHandle === targetHandle)
  );
}
```

### 5.2 Auto-Pruning Dead Scaffolding Nodes
During graph cleanup / compilation:
- If a node is not connected downstream and is not a leaf solid node, flag it or prune it during export to avoid the 19% isolated node accumulation.

### 5.3 IR Skill Bindings in `src/ai/ir/skills.ts`
Wrap the new nodes in high-level IR operations:
- `multi_loft(curves, ruled?, closed?)`
- `spiral_points(count, spread, divergence?, pitch?)`
- `offset_curve(curve, distance)`
- `polygon(sides, radius, fillet?)`

---

## 6. Verification & Test Plan

1. **Unit Test for New Nodes**: Create `tests/test_new_nodes_aug2026.mjs` verifying:
   - Multi-profile loft across 4 concentric circles of varying radii.
   - Phyllotaxis spiral generating 50 points following the golden angle ($137.5^\circ$).
   - Polygon offset producing correct perimeter reduction without self-intersection.
2. **Multi-Turn Semantic Edge Test**: Extend `tests/test_patch_semantics.mjs` to test removing edges by `{ from, to }` descriptors.
3. **Full Regression Run**: Ensure `npm run lint`, `npm run build`, and `npm test` maintain 100% pass rate.
