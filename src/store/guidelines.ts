export const DEFAULT_GUIDELINES = `# AI Parametric CAD Architect Agent Guidelines

This document outlines the core architecture, constraints, coordinate systems, and design conventions for the AI Architect graph editor application. All AI coding assistants and graph generation agents working on this project must adhere strictly to these rules.

## 1. Coordinate System Mapping (Z-up vs Y-up)
- **CAD Engine**: Replicad/OpenCascade uses **Z-up** coordinates:
  - \`XY\` plane is the ground plane (where \`Z = 0\`).
  - \`Z\` is the height axis.
- **3D Viewport**: Three.js uses **Y-up** coordinates.
- **Mapping Fix**: The 3D viewport applies a \`-90\` degree rotation around the X-axis (\`[-Math.PI / 2, 0, 0]\`) to align the systems.
  - Consequently, building a shape on the \`XY\` plane in the CAD node graph will correctly render flat on the ground grid in the 3D viewport.
  - Do not apply ad-hoc rotations to make elements face "up" in the viewport; they are naturally Z-up.

## 2. Dynamic Slider Parameter Ranges
All numerical sliders rendered in the UI adapt to custom limits configured in the node library:
- **Translate offsets**: \`-100\` to \`100\`
- **Rotational Angles**: \`-360\` to \`360\`
- **Scaling Factors**: \`0.01\` to \`10\`
- **Geometric Dimensions (Radius, Width, etc.)**: \`0.1\` to \`200\`
- **UV Coordinates (u, v)**: \`0\` to \`1\`
Ensure you specify numerical values in \`node.data\` that fall within these logical ranges.

- **Dynamic Limit Overrides & Geometry Guardrails**: You can override these limits on any node dynamically by adding \`"[paramName]__min"\`, \`"[paramName]__max"\`, and \`"[paramName]__step"\` to the node's \`data\` object. Use this feature aggressively on transforms (like \`Fillet\`, \`Chamfer\`, \`Scale\`) to prevent users from sliding parameters into invalid, self-intersecting values that crash OpenCascade. E.g., for a Fillet on a height=2.0 box: \`"data": { "radius": 0.2, "radius__min": 0.05, "radius__max": 0.9, "radius__step": 0.05 }\`.

## 3. List Processing & Loop Approximations (Parametric Loops)
- The graph engine supports implicit looping via list mapping.
- **Series & Range:** Use \`Series\` or \`Range\` nodes to generate lists of numbers.
- **Implicit Mapping on Transforms:** If you connect a list of numbers (from \`Series\`, \`Range\`, or list-mapped \`Expression\`) to a numeric input parameter of a transform node (\`Translate\`, \`Rotate\`, \`Scale\`), the transform is automatically repeated for each value in the list, producing a \`Compound\` solid containing all the individual instances. For example, connecting a \`Series\` to a \`Translate\` node's \`z\` parameter creates a vertical stack of shifted solids.
- **List Expressions:** If any inputs (\`a\`, \`b\`, \`c\`, \`d\`) to an \`Expression\` node are lists, the formula is evaluated element-by-element, returning a list of numbers.
- **Scatter/Place fallback:** If a specific point on a surface is required, use **\`PlaceOnSurface\`** with \`"u"\` and \`"v"\` values between \`0\` and \`1\`. To create a cluster of multiple shapes scattered across a surface, you can still use the **\`ScatterOnSurface\`** node.

## 4. Standard Geometric Recipes
- **Dome**:
  To build a dome of radius R:
  1. Create a \`Sphere\` node (radius = R).
  2. Create a \`Box\` node (width = 2*R + 10, length = 2*R + 10, height = R).
  3. Create a \`Translate\` node with offsets \`x = 0, y = 0, z = -R/2\` and connect \`Box.solid\` -> \`Translate.solid\`.
  4. Create a \`Boolean\` node with \`operation = "difference"\`.
  5. Connect \`Sphere.solid\` -> \`Boolean.target\` and \`Translate.solid\` -> \`Boolean.tool\`. This subtracts the bottom hemisphere to yield a clean dome.

- **Tapered Column / Stem / Rocket Body**:
  To build a tapering stem or pillar of height H:
  1. Create a \`Cone\` node.
  2. Set \`radius1\` to the base radius (e.g., 2), \`radius2\` to the top radius (e.g., 0.5), and \`height\` to H. This directly creates a smoothly tapering solid.
`;
