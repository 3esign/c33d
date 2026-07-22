# Adding a New Parametric Node to C33D

This guide walks you through the step-by-step process of adding a new parametric CAD node to the C33D node library.

---

## The Standard Kit Checklist

Every new node contribution requires **6 core components** to ensure stability, AI compiler support, and evaluation metrics.

```
┌────────────────────────────────────────────────────────────────────────┐
│                          The 6 Standard Components                     │
├────────────────────────────────────────────────────────────────────────┤
│ 1. Executor       → src/worker/executors.ts (OpenCascade logic)      │
│ 2. Schema         → src/nodes/NodeDefinitions.ts (Handles & Params)  │
│ 3. Validation     → src/ai/graphValidation.ts (Port rules & bounds)  │
│ 4. Percepts       → Geometry stats (volume, bbox, face counts)         │
│ 5. Exemplar       → data/seed-examples/ (Verified benchmark graph)     │
│ 6. Eval Prompt    → docs/test_prompts.md (L1-L4 test cases)            │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Walkthrough

### 1. Define the Node Schema (`src/nodes/NodeDefinitions.ts`)
Add the node definition to `NODE_LIBRARY`:

```typescript
export const NODE_LIBRARY: Record<string, NodeDefinition> = {
  // ...
  YourNewNode: {
    type: 'YourNewNode',
    category: 'modifier', // 'primitive' | 'transform' | 'modifier' | 'boolean' | 'math'
    label: 'Your New Node',
    inputs: [
      { name: 'solid', type: 'solid', label: 'Solid In' },
      { name: 'param', type: 'number', label: 'Parameter' },
    ],
    outputs: [
      { name: 'solid', type: 'solid', label: 'Solid Out' }
    ],
    defaultData: {
      param: 1.0,
      param__min: 0.1,
      param__max: 10.0,
      param__step: 0.1,
    },
  },
};
```

### 2. Implement the Worker Executor (`src/worker/executors.ts`)
Register the execution function in `executors.ts`:

```typescript
export function executeYourNewNode(node: AnyNode, inputs: Record<string, any>): SolidResult {
  const solid = inputs.solid;
  const param = node.data.param ?? 1.0;

  if (!solid) throw new Error('YourNewNode requires a valid input solid.');

  // Perform OpenCascade / replicad geometry operations
  const result = solid.clone(); // or custom transformation logic

  return result;
}
```

### 3. Add Validation Guardrails (`src/ai/graphValidation.ts`)
Add input type checks and boundary clamping to prevent downstream kernel crashes:

```typescript
if (node.type === 'YourNewNode') {
  const val = Number(data.param);
  if (isNaN(val) || val <= 0) {
    issues.push({ nodeId: node.id, severity: 'error', message: 'Param must be > 0' });
  }
}
```

### 4. Verify Percept Reporting
Ensure the executor attaches volumetric percepts (`volume`, `boundingBox`, `faceCount`) to enable auto-repair feedback loops for LLMs.

### 5. Add Exemplar Seed Graph (`data/seed-examples/`)
Save a JSON representation of a verified graph utilizing `YourNewNode`.

### 6. Add Evaluation Prompt (`docs/test_prompts.md`)
Add an L1 or L2 prompt targeting the new node capability to validate model generation accuracy.

---

## Verification & Testing

Run the full test and build suite before submitting a PR:

```bash
npm run lint
npm test
npm run build
```

---

*C33D — Copyright 2026 Semir Poturak, PhD <poturaksemir@gmail.com> — Apache-2.0*
