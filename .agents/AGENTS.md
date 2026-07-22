# AI Parametric CAD Architect Agent Guidelines

This document outlines the core architecture, constraints, coordinate systems, and design conventions for the AI Architect graph editor application. All AI coding assistants and graph generation agents working on this project must adhere strictly to these rules.

## 1. Node Library & Handles
The graph engine supports the following nodes defined in [NodeDefinitions.ts](file:///C:/Users/treed/OneDrive/Desktop/C3D/src/nodes/NodeDefinitions.ts). NOTE: this file had drifted behind the actual node registry — the live system prompt (`condensedNodeLibrary()` in `agent.ts`) is generated dynamically from `NODE_LIBRARY` and is always authoritative for what the model sees; this doc is the human/dev-facing reference and must be kept in sync manually.
- **Primitives**: `Box`, `Sphere`, `Cylinder`, `Cone`, `Ellipsoid`, `Torus`, `Plane`, `Text3D`.
  - Primitives only have output handles named `"solid"`.
  - `Plane` represents a true 2D flat surface. Do NOT use a thin `Box` to simulate a flat plane.
  - `Text3D` generates 3D extruded text from a string parameter.
  - `Cone` generates a tapered cylinder from `radius1` to `radius2` over `height`.
  - `Ellipsoid` (`radiusX/Y/Z`) is a direct organic-blob primitive — the preferred way to get petals, leaves, seeds, eggs, pebbles, lentils without hand-building Sphere+ScaleXYZ. Internally goes through the same `nonUniformScale`/`solidFromDeformedMesh` path as `ScaleXYZ` when the radii differ (see §7 note below) — as of July 2026 this is a real, correctly-sized non-uniform shape, not a silent no-op.
  - `Torus` (`majorRadius`, `minorRadius`) — rings, tires, wreaths, donuts.
  - `Pipe` (`pathSvg`: SVG-style M/L/C/Q path with no closing Z, `radius`) — a circular tube swept along the path, on the XY plane. Stems, vines, cables, tentacles, horns, arteries. See §13.
- **Transforms**: `Translate`, `Rotate`, `Scale`, `ScaleXYZ`, `Bend`, `Twist`, `Align`, `PlaceOnSurface`, `ScatterOnSurface`, `PlaceOnVertices`, `Fillet`, `Chamfer`, `Extrude`, `Mirror`, `Shell`, `Loft`, `Revolve`, `LinearPattern`, `CircularPattern`, `SubdivideSurface`, `FilterFaces`.
  - `Bend` (`axis`: X/Y/Z, `angle`) — curves a shape like a banana around its own local bbox center. X/Y bend that axis's span and curl into Z (petals, leaves, wings curving upward); Z bends a vertical span sideways into X (stems, horns curving as they rise). See §13.
  - `Twist` (`axis`, `angle`) — spirals a shape around an axis, linearly ramped along its own local extent (drill bits, spiral columns, horns, flames). See §13.
  - `Pipe` — geometry primitive, not a transform; see the Primitives bullet below and §13.
  - `ScaleXYZ` (`factorX/Y/Z`, `isLocal`) — non-uniform squash/stretch of an arbitrary input solid. See §7 (July 2026 update) for the implementation note; safe and reliable to use, budget ~0.05-1.5s of extra evaluation per use depending on the input's size.
  - `Align` — see §5 below (relative placement; supersedes hand-computed stacking Translates).
  - `FilterFaces` (`axisFilter`/`direction`/`index`/`tolerance`) — selects a face (or set) off a solid by direction or index, for use with `SubdivideSurface` to carve detail out of a specific face (cockpit out of a chassis top, windows out of a wall face, etc).
  - `Extrude` now takes optional `taperEndFactor` (1 = no taper, e.g. 0.3 = tapers to 30% size at the top), `taperProfile` (`'linear'` or `'sCurve'`), and `twistAngle` — this is a `TaperedExtrude` for free: replicad's `.extrude()` already supported `extrusionProfile`/`twistAngle`, it just wasn't wired to node params before July 2026. Use on a `Sketch` profile (not a `Plane`/`Face` — those don't have `.extrude()`) for tapered petals, feathers, fins, claws, spires. `sCurve` gives an organic curved taper rather than a straight cone-like one.
  - Transforms take a `"solid"` input handle (or specific inputs like `"profile1"`/`"profile2"` for `Loft`) and yield a `"solid"` output handle.
  - `PlaceOnSurface` takes `"surface"` and `"shape"`. It places a shape at a specific UV coordinate (`u`, `v`) on the surface.
  - `ScatterOnSurface` takes `"surface"` and `"shape"`. It places a configured `"count"` of the shape at pseudo-random UV positions on the surface. Supports random instanced sizing via `scaleMin` and `scaleMax` parameters. Note: This node only outputs the scattered shapes; to render the base surface as well, merge them using a Boolean (union) or Compound node.
  - `PlaceOnVertices` takes `"solid"` and `"shape"`. It duplicates the shape and places a copy centered on every single vertex (point/corner) of the primary solid. Supports random instanced sizing via `scaleMin` and `scaleMax` parameters. Note: This node only outputs the duplicated shapes; to render the base solid as well, merge them using a Boolean (union) or Compound node.
  - `Loft` takes `"profile1"` and `"profile2"`. It lofts a solid skin between their boundary wires.
  - `LinearPattern` repeats a solid in a straight line.
  - `CircularPattern` repeats a solid in a circle around the Z-axis.
  - `SubdivideSurface` takes `"solid"` and splits a selected `"faceIndex"` (or all faces if `-1`) into a `"uDivisions"` by `"vDivisions"` grid of cells. It shrinks each cell by `"inset"`, and extrudes them by a height randomized between `"extrudeMin"` and `"extrudeMax"` along the local normal vector of the face. Extremely powerful for paneling, window arrays, textured facades, or surface grids!
  - You must always connect the output of a shape or transform to the downstream nodes.
- **Booleans**: `Boolean`.
  - Takes two input handles: `"target"` and `"tool"`.
  - Outputs a combined `"solid"`.
  - Operations supported: `'union'`, `'difference'`, `'intersect'`.
- **Math & Lists (driven parameters)**: `NumberSlider`, `Expression`, `Series`, `Range`, `ListItem`, `ListLength`.
  - `NumberSlider` outputs a single value.
  - `Expression` evaluates a formula like 'a * 2 + b'.
  - `Series` generates a list of numbers starting at `start`, stepping by `step`, with a given `count`.
  - `Range` generates a list of numbers from `min` to `max` in a given number of `steps`.
  - `ListItem` retrieves an item from a list at the specified `index`.
  - `ListLength` returns the size of the list.

## 2. Coordinate System Mapping (Z-up vs Y-up)
- **CAD Engine**: Replicad/OpenCascade uses **Z-up** coordinates:
  - `XY` plane is the ground plane (where `Z = 0`).
  - `Z` is the height axis.
- **3D Viewport**: Three.js uses **Y-up** coordinates.
- **Mapping Fix**: The 3D viewport applies a `-90` degree rotation around the X-axis (`[-Math.PI / 2, 0, 0]`) to align the systems.
  - Consequently, building a shape on the `XY` plane in the CAD node graph will correctly render flat on the ground grid in the 3D viewport.
  - Do not apply ad-hoc rotations to make elements face "up" in the viewport; they are naturally Z-up.

## 3. Dynamic Slider Parameter Ranges
All numerical sliders rendered in the UI adapt to custom limits configured in the node library:
- **Translate offsets**: `-100` to `100`
- **Rotational Angles**: `-360` to `360`
- **Scaling Factors**: `0.01` to `10`
- **Geometric Dimensions (Radius, Width, etc.)**: `0.1` to `200`
- **UV Coordinates (u, v)**: `0` to `1`
Ensure you specify numerical values in `node.data` that fall within these logical ranges.

- **Dynamic Limit Overrides & Geometry Guardrails**: You can override these limits on any node dynamically by adding `"[paramName]__min"`, `"[paramName]__max"`, and `"[paramName]__step"` to the node's `data` object. Use this feature aggressively on transforms (like `Fillet`, `Chamfer`, `Scale`) to prevent users from sliding parameters into invalid, self-intersecting values that crash OpenCascade. E.g., for a Fillet on a height=2.0 box: `"data": { "radius": 0.2, "radius__min": 0.05, "radius__max": 0.9, "radius__step": 0.05 }`.

## 4. List Processing & Loop Approximations (Parametric Loops)
- The graph engine supports implicit looping via list mapping.
- **Series & Range:** Use `Series` or `Range` nodes to generate lists of numbers.
- **Implicit Mapping on Transforms (Transform List Auto-Expansion):** If you connect a list of numbers (from `Series`, `Range`, or list-mapped `Expression`) to a numeric input parameter of a transform node (`Translate`, `Rotate`, `Scale`), the transform is automatically repeated for each value in the list, producing a `Compound` solid containing all the individual instances. For example, connecting a `Series` to a `Translate` node's `z` parameter creates a vertical stack of shifted solids. This is the preferred way to create arrays without duplicating transform nodes.
- **List Expressions:** If any inputs (`a`, `b`, `c`, `d`) to an `Expression` node are lists, the formula is evaluated element-by-element, returning a list of numbers.
- **Canonical Instancing Idioms:** Use `PlaceOnVertices`, `PlaceOnSurface` (u, v), or `ScatterOnSurface` to duplicate and distribute instances onto a base geometry substrate instead of creating multiple duplicate nodes in empty space.
- **Node-Economy Metric:** To ensure execution speed and avoid output limit truncations, graphs must minimize the number of transform nodes. The system tracks the ratio of total nodes to rendered leaf nodes, and will flag a `Node economy warning` if there are more than 2× transform nodes per rendered leaf. Use list auto-expansion, patterns (LinearPattern/CircularPattern), and instancers rather than duplicating transforms.
- **Scatter/Place fallback:** If a specific point on a surface is required, use **`PlaceOnSurface`** with `"u"` and `"v"` values between `0` and `1`. To create a cluster of multiple shapes scattered across a surface, you can still use the **`ScatterOnSurface`** node.

## 5. Standard Geometric Recipes
- **Dome**:
  To build a dome of radius R:
  1. Create a `Sphere` node (radius = R).
  2. Create a `Box` node (width = 2*R + 10, length = 2*R + 10, height = R).
  3. Create a `Translate` node with offsets `x = 0, y = 0, z = -R/2` and connect `Box.solid` -> `Translate.solid`.
  4. Create a `Boolean` node with `operation = "difference"`.
  5. Connect `Sphere.solid` -> `Boolean.target` and `Translate.solid` -> `Boolean.tool`. This subtracts the bottom hemisphere to yield a clean dome.

- **Tapered Column / Stem / Rocket Body**:
  To build a tapering stem or pillar of height H:
  1. Create a `Cone` node.
  2. Set `radius1` to the base radius (e.g., 2), `radius2` to the top radius (e.g., 0.5), and `height` to H. This directly creates a smoothly tapering solid.

- **Parametric Flower (EXAMPLE ONLY - DO NOT COPY VERBATIM)**:
  To construct a beautiful parametric flower at height H (NOTE: When asked for a flower, you MUST invent entirely new ways to build one, e.g., low-poly boxy flowers, sunflowers with massive centers, alien glowing vines, or sharp crystal flowers. Use this ONLY as a structural reference for how parts can connect, but DO NOT reproduce these exact steps or topologies):
  1. **Stem**: Create a tapered pillar using the `Cone` node (e.g., `radius1 = 1`, `radius2 = 0.5`, `height = H`).
  2. **Receptacle/Center**: Create a `Sphere` node (radius = R) and translate it to `z = H` using a `Translate` node.
  3. **Petal Profile**: Create a `Sketch` node with a teardrop SVG path (e.g. `svgPath = "M 0 0 C -2 2 -4 6 0 10 C 4 6 2 2 0 0 Z"`).
  4. **Thickness**: Connect the sketch to `Extrude` (height = 0.2).
  5. **Pitch/Orientation**: Connect `Extrude` to a `Rotate` node with `isLocal: true` (e.g., `angle = 75`, `axisX = 1`, `axisY = 0`, `axisZ = 0`) to tilt the petal outward.
  6. **Radial Placement**: Connect the rotated petal to a `Translate` node to offset it from the center (e.g., `y = 3`) and lift it to the top of the stem (`z = H`).
  7. **Bloom Array**: Connect the translated petal to a `CircularPattern` node (e.g., `count = 8`, `angle = 360`) to create a radial bloom.
  8. **Group**: Connect the stem cone, center sphere translation, and circular pattern of petals into a `Compound` node.

## 6. Visual Node Grouping & Layout Math
- You can group related nodes visually using parent container nodes of type `"group"`.
- To create a group:
  1. Add a node with `"type": "group"`, and specify a label in its data (e.g. `data: { label: "Stem Group" }`).
  2. For any nodes inside the group, add the property `"parentId": "group_node_id"` and set their `"position"` relative to the group's top-left corner `[0, 0]`.
  3. **Strict Layout Math**: Custom nodes are approximately `160` wide and `150` tall. Space sequential nodes in a column by `160` vertically (e.g. `y = 40`, `y = 200`, `y = 360`) and in a row by `200` horizontally (e.g. `x = 20`, `x = 220`, `x = 420`).
  4. **Strict Group Size Sizing**: You MUST compute the group's boundary size using the formula:
     `style.width = max(child_relative_x) + 200`
     `style.height = max(child_relative_y) + 160`
     For example, a group containing a single column of 3 vertical nodes (max X = 20, max Y = 360) must have `"style": { "width": 220, "height": 520 }`. If you fail to do this, nodes will overflow the group boundaries.

## 7. Concept-to-CAD Graph Compilation Framework
When transforming abstract concepts (e.g., an eagle, a car) into parametric CAD graphs, you must reason using this systematic compilation framework:
- **Phase A: Semantic Deconstruction & Proportions**: Split the concept into logical component categories (e.g. for an eagle: Torso, Wings, Head, Claws; for a car: Chassis, Cabin, Wheels, Spoiler). Propose mathematical aspect ratios that relate dimensions of different parts (e.g., $WheelRadius = 0.1 \times ChassisLength$) to control proportions in the graph. Use these ratios to calculate the default slider parameters in the nodes.
- **Phase B: Skeletal 'Bone' Rigging & Watertight Assembly**: The node graph is a geometry data-flow engine. Do NOT use disconnected absolute `Translate` offsets to manually position parts in empty space. Instead:
  1. **Rigging**: Use `PlaceOnSurface`, `PlaceOnVertices`, or `ScatterOnSurface` to attach sub-assemblies (wheels, headlights, wings) parametrically onto specific locations (u,v) or vertices of the parent chassis so they inherit the parent's coordinates.
  2. **Watertight Box Modeling**: For organic/continuous bodies, use `FilterFaces` and `SubdivideSurface` on the base primitive to parametrically extrude/inset panel details directly out of the base mesh, rather than assembling disconnected primitives.
- **Phase C: Shape Formula Matching**: Match each sub-assembly to its parametric mathematical formula (e.g., a tapered column is a loft between cylinders; a wing is an extruded sketch).
- **Phase D: Boolean Fusion & Polish**: Locally combine sub-assemblies using Booleans or `Compound` nodes before fusing them to the root torso to keep graph complexity flat, and apply `Fillet` / `Chamfer` last.

## 9. Dynamic Complexity System (Direct Generation vs. Collaborative Stages)
- **Direct Mode (Primary Choice - Default)**: By default, ALWAYS generate the complete, detailed model graph immediately in a single turn (even for complex concepts like cars, spires, cathedrals). The user expects a complete zero-shot model immediately. Do not withhold parts or stop to ask for permission.
- **Collaborative Stage Mode (Optional - Only when explicitly requested)**: Only use this mode if the user explicitly requests to build the shape "step-by-step", "collaboratively", "in stages", or asks to start with a "base podium/chassis first". In that case:
  1. **Stage 1 (Proportional Foundation)**: 
     - Deconstruct the concept into simpler shapes and explain how they relate.
     - Propose aspect ratios to govern the dimensions between parts (document these in the `reasoning` field).
     - Build ONLY the central core/base chassis (e.g. torso or chassis) in a clean Group node, setting parameters that respect the proposed aspect ratios.
     - In the JSON `questions` field, ask the user to align on this deconstruction and the proposed ratios (e.g. "Do you agree with the $WheelRadius$ to $ChassisLength$ ratio, or would you like to tweak it?").
  2. **Stage 2 (Sub-Assemblies)**: Once the user provides feedback/approval, build the next logical sub-assembly in subsequent turns, ensuring the parameters respect the aspect ratios and keep everything structurally connected to the coordinate system.
  3. **Stage 3 (Geometric Detailing)**: Once the foundation is complete, perform a detailing pass. Use `SubdivideSurface` (with inset and extrusion parameters), `FilterFaces`, and Boolean subtractions to carve intricate paneling, grooves, and micro-structures into the bare surfaces to achieve a high level of detail.

## 9. UI & Logging Hygiene
- System evaluation errors (`EVALUATE_ERROR`) must be piped to the store's `performanceLogs` array to act as a diagnostic diary. Do not send raw worker errors or stack traces to the user-facing chat messages array (`messages`), as this clutters user interaction.
- Deleting all nodes or clicking the "Clear" button must reset the 3D view by setting `sceneObjects` to `[]`.
- To create organic leaf arrangements on a stem, use a combination of a Sketch-based leaf profile, rotation for tilt, and a LinearPattern or manual Translation to distribute them along the Z-axis.
- When creating organic stems, keep the radius ratio between base and top modest (e.g., 1:2) to avoid unintentional cone shapes.
- When building organic structures, ensure the scale ratio between thin elements (stems) and thick elements (blooms) is balanced to avoid visual disappearance in the viewport.
- Use standard Cylinder instead of Loft for stems to ensure visibility and avoid rendering failures in complex botanical models.
- Use Cylinder instead of Loft for stems to ensure rendering stability and visibility in the 3D viewport.
- For new flower designs, explore completely different geometric formulas (triangular spikes, boxy petals, layered rings) rather than repeating teardrop extrusions.
- For car wheels in CAD, rotate the cylinder 90° around the X axis (not Y) so the axle aligns with the Y axis and the circular face is visible from the side view, matching how real car wheels appear.
- When building architectural colonnades, use a single Cylinder + Translate + LinearPattern + Translate(center) rather than duplicating cylinder nodes, and ensure the entablature box overlaps the column tops in Z so the Boolean union succeeds.
- The Compound node accepts up to 8 solid inputs (`solid1`..`solid8`, not 4 — checked against the current `NodeDefinitions.ts`) and de-duplicates identical shape references rather than failing silently; feeding the same solid into multiple slots just produces fewer unique parts in the union, it does not break evaluation.

## 8. Multi-Stage CAD Modeling Philosophy (Conceptualization to Detail)
To create high-quality, complex models in a resource-efficient way:
- **Stage 1 (Conceptual Layout)**: Volumetrically map the model using simple primitives (e.g. main building hall, base podium, roof boundary). Connect their height/offset translation parameters to establish core parametric relationships first.
- **Stage 2 (Detailing & Patterns)**: Detail the model by introducing local parametric sub-assemblies (e.g. colonnades, windows, trim, headlights).
- **Boolean Optimization**: Chain Boolean unions locally to consolidate sub-assemblies before routing them to the final output node. Ensure intersecting faces overlap slightly (by 0.1-0.2 units) to avoid floating-point math failures in OpenCascade. Keep boolean chains shallow to reduce evaluation complexity.
- **Architectural & Style Variety**: Avoid blindly replicating the classic dome + colonnade Renaissance recipe for every building request. Explore distinct architectural styles (e.g., stepped pyramidal structures, gothic towers with spires, brutalist block configurations, or modern high-tech angular structures) to demonstrate visual design variety.
- When building complex objects like cars, use a layered approach: chassis as base layer, cabin as middle layer, wheels and details as outer layer, and fillet the whole assembly last for a polished look.

## 10. Cosmetic Styling & Multi-Color Rendering
- Geometric primitives (`Box`, `Sphere`, `Cylinder`, `Plane`, `Text3D`, `Sketch`) support a cosmetic parameter named `"color"` (e.g. `"color": "#ef4444"` or `"color": "#1e293b"`).
- The 3D Viewport automatically traces backwards from any leaf node to find and apply the nearest ancestor color to that mesh.
- **Rendering Multiple Colors**: If you merge all geometries into a single global union/compound node at the end of the graph, they will be fused into a single mesh and rendered in a single uniform color.
- **To Render Multi-Colored Objects**: Do NOT connect all sub-assemblies to a final single Compound/Boolean node. Instead, keep the sub-assemblies (e.g., Chassis assembly, Wheel assembly, Wing assembly) as separate **leaf nodes** (nodes with no outgoing connections). The engine will mesh them separately and render them in their respective colors.

## 11. Abstract Topological Idioms & Generative Parametric Patterns
Do NOT treat examples as rigid topic recipes (e.g., do not copy a "flower" or "car" step-by-step). Instead, treat them as **generic, topic-agnostic topological idioms** that can be creatively re-combined for ANY parametric modeling request.

*   **Avoid Monolithic Recipes:** Never default to a fixed construction formula for a prompt. Explore distinct architectural styles, futuristic geometries, or alternative organic topologies.
*   **Encourage Style Variety:** Every request can be solved using different topological idioms (curves, brutalist boxes, subdivided grids, radial patterns).

### Idiom 1: Radial Instanced Array around Central Substrate
*   **Topology**: A central substrate body (e.g. `Cylinder`, `Sphere`, `Cone`, or `Ellipsoid` of radius `R`) surrounded by a radially distributed array of curved/tapered elements (fins, petals, spokes, ribs, struts).
*   **Pattern**: Construct a single element (using `Ellipsoid`, `Bend`, or `Extrude` with `taperEndFactor`), apply local `Rotate` (tilt), translate outward by `y = R`, and feed into a `CircularPattern` (`radius = R`, `count = N`).
*   **Applications**: Radial blooms, turbines, stadium structural ribs, wheels, spires, dome arches.

### Idiom 2: Watertight Box Modeling & Integrated Face Sub-Extrusion
*   **Topology**: A primary continuous solid body where sub-features (cabins, windows, spoilers, cockpits, panels) are derived directly from the base geometry's faces rather than placing disconnected floating shapes in empty space.
*   **Pattern**: Use `FilterFaces` (e.g., `axisFilter = 'maxZ'`) on the main body to select a target surface, then pass it to `SubdivideSurface` (`uDivisions`, `vDivisions`, `inset`, `extrudeMin/Max`) to extrude paneling or cabins directly out of the surface.
*   **Applications**: Chassis/cockpits, architectural facade windows, rocket fuselage detailing, textured panels.

### Idiom 3: Deformed Organic Mesh Shell & Curvature Transformation
*   **Topology**: Smooth, organic, or aerodynamic bodies generated using multi-axis scaling and non-linear axial deformations.
*   **Pattern**: Start with `Ellipsoid` (`radiusX`, `radiusY`, `radiusZ`) for organic torsos, or apply `Bend` (`axis: "Y"`, `angle: 20..60`) and `Twist` to extruded shapes (`Box`, `Cone`, `Pipe`) for natural sweep and curvature.
*   **Applications**: Organic bodies, curved wings, twisted columns, horns, vine stems, sleek aerodynamic shrouds.

### Idiom 4: Vertical Colonnade / Structural Linear Array
*   **Topology**: A base podium, a repeated linear array of vertical supports, and a top entablature overlapping the supports.
*   **Pattern**: Base `Box` + `Cylinder` column translated and fed to `LinearPattern` (`count`, `spacing`) + an overlapping roof `Box` (with 0.1-0.2 unit vertical Z-overlap to ensure clean Boolean fusion).
*   **Applications**: Colonnades, fence posts, bridge piers, rib cages, louvers.


