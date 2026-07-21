export type NodeParamType = 'number' | 'string' | 'boolean' | 'vector3';

export interface NodeParamDef {
  name: string;
  type: NodeParamType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
}

export interface NodeDefinition {
  type: string;
  label: string;
  category: 'geometry' | 'transform' | 'boolean' | 'math';
  inputs: { name: string; type: string }[];
  outputs: { name: string; type: string }[];
  params: NodeParamDef[];
}

export const NODE_LIBRARY: Record<string, NodeDefinition> = {
  NumberSlider: {
    type: 'NumberSlider',
    label: 'Number (Design Param)',
    category: 'math',
    inputs: [],
    outputs: [{ name: 'value', type: 'number' }],
    params: [
      { name: 'value', type: 'number', default: 10, min: -1000, max: 1000, step: 0.1 },
      { name: 'min', type: 'number', default: 0, min: -1000, max: 1000, step: 0.1 },
      { name: 'max', type: 'number', default: 100, min: -1000, max: 1000, step: 0.1 },
      { name: 'step', type: 'number', default: 0.1, min: 0.001, max: 10, step: 0.001 },
      { name: 'label', type: 'string', default: 'Param' },
    ],
  },
  Expression: {
    type: 'Expression',
    label: 'Expression (Math)',
    category: 'math',
    inputs: [
      { name: 'a', type: 'number' },
      { name: 'b', type: 'number' },
      { name: 'c', type: 'number' },
      { name: 'd', type: 'number' },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    params: [
      { name: 'formula', type: 'string', default: 'a * 2' },
    ],
  },
  Series: {
    type: 'Series',
    label: 'Series (List)',
    category: 'math',
    inputs: [
      { name: 'start', type: 'number' },
      { name: 'step', type: 'number' },
      { name: 'count', type: 'number' },
    ],
    outputs: [{ name: 'values', type: 'number' }],
    params: [
      { name: 'start', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'step', type: 'number', default: 1, min: -100, max: 100, step: 0.1 },
      { name: 'count', type: 'number', default: 5, min: 1, max: 100, step: 1 },
    ],
  },
  Range: {
    type: 'Range',
    label: 'Range (List)',
    category: 'math',
    inputs: [
      { name: 'min', type: 'number' },
      { name: 'max', type: 'number' },
      { name: 'steps', type: 'number' },
    ],
    outputs: [{ name: 'values', type: 'number' }],
    params: [
      { name: 'min', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'max', type: 'number', default: 10, min: -100, max: 100, step: 0.1 },
      { name: 'steps', type: 'number', default: 5, min: 1, max: 100, step: 1 },
    ],
  },
  ListItem: {
    type: 'ListItem',
    label: 'List Item',
    category: 'math',
    inputs: [
      { name: 'list', type: 'number' },
      { name: 'index', type: 'number' },
    ],
    outputs: [{ name: 'value', type: 'number' }],
    params: [
      { name: 'index', type: 'number', default: 0, min: 0, max: 100, step: 1 },
    ],
  },
  ListLength: {
    type: 'ListLength',
    label: 'List Length',
    category: 'math',
    inputs: [
      { name: 'list', type: 'number' },
    ],
    outputs: [{ name: 'length', type: 'number' }],
    params: [],
  },
  ListConstant: {
    type: 'ListConstant',
    label: 'List (Data)',
    category: 'math',
    inputs: [],
    outputs: [{ name: 'values', type: 'number' }],
    params: [
      // Comma-separated entries; each entry may be a number OR a formula
      // referencing slider labels (e.g. "R*0.2, R*0.5, R").
      { name: 'values', type: 'string', default: '1, 2, 3, 4' },
    ],
  },
  PointsFromLists: {
    type: 'PointsFromLists',
    label: 'Points From Lists',
    category: 'math',
    inputs: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'z', type: 'number' },
      { name: 'scale', type: 'number' },
      // Optional per-point group id channel; SplineCurve/PolylineCurve with
      // groupBy:"group" interpolate one curve per group.
      { name: 'group', type: 'number' },
    ],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [],
  },
  RepeatEach: {
    type: 'RepeatEach',
    label: 'Repeat Each (List)',
    category: 'math',
    inputs: [
      { name: 'list', type: 'number' },
      { name: 'count', type: 'number' },
    ],
    outputs: [{ name: 'values', type: 'number' }],
    params: [
      { name: 'count', type: 'number', default: 2, min: 1, max: 200, step: 1 },
    ],
  },
  Tile: {
    type: 'Tile',
    label: 'Tile / Cycle (List)',
    category: 'math',
    inputs: [
      { name: 'list', type: 'number' },
      { name: 'count', type: 'number' },
    ],
    outputs: [{ name: 'values', type: 'number' }],
    params: [
      { name: 'count', type: 'number', default: 2, min: 1, max: 200, step: 1 },
    ],
  },
  // S2 (Jul-20 geometric sockets): every solid primitive accepts an OPTIONAL
  // "center" Point input — placement DERIVED from geometry (Centroid, Midpoint,
  // DivideCurve, BoundingBox anchors …) instead of a Translate chain with typed
  // coordinates. Rotational primitives also accept an optional "axis" Vector
  // that tilts the primitive's +Z onto the vector (replaces Rotate-90 boilerplate).
  Box: {
    type: 'Box',
    label: 'Box',
    category: 'geometry',
    inputs: [{ name: 'center', type: 'Point' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'width', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'length', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'height', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Sphere: {
    type: 'Sphere',
    label: 'Sphere',
    category: 'geometry',
    inputs: [{ name: 'center', type: 'Point' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 5, min: 0.1, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Cylinder: {
    type: 'Cylinder',
    label: 'Cylinder',
    category: 'geometry',
    inputs: [
      { name: 'center', type: 'Point' },
      { name: 'axis', type: 'Vector' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 5, min: 0.1, max: 200, step: 0.1 },
      { name: 'height', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Cone: {
    type: 'Cone',
    label: 'Cone',
    category: 'geometry',
    inputs: [
      { name: 'center', type: 'Point' },
      { name: 'axis', type: 'Vector' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius1', type: 'number', default: 5, min: 0.0, max: 200, step: 0.1 },
      { name: 'radius2', type: 'number', default: 2, min: 0.0, max: 200, step: 0.1 },
      { name: 'height', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Ellipsoid: {
    type: 'Ellipsoid',
    label: 'Ellipsoid',
    category: 'geometry',
    inputs: [{ name: 'center', type: 'Point' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radiusX', type: 'number', default: 5, min: 0.1, max: 100, step: 0.1 },
      { name: 'radiusY', type: 'number', default: 3, min: 0.1, max: 100, step: 0.1 },
      { name: 'radiusZ', type: 'number', default: 2, min: 0.1, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Torus: {
    type: 'Torus',
    label: 'Torus (Ring)',
    category: 'geometry',
    inputs: [
      { name: 'center', type: 'Point' },
      { name: 'axis', type: 'Vector' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'majorRadius', type: 'number', default: 8, min: 0.2, max: 200, step: 0.1 },
      { name: 'minorRadius', type: 'number', default: 2, min: 0.1, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Plane: {
    type: 'Plane',
    label: 'Plane (2D)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'width', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'length', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Translate: {
    type: 'Translate',
    label: 'Translate',
    category: 'transform',
    // B9 (geometric sockets): optional "target" Point overrides x/y/z so
    // positions can be DERIVED from geometry instead of typed as literals.
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'target', type: 'Point' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'x', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'y', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'z', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'isLocal', type: 'boolean', default: false },
    ],
  },
  Rotate: {
    type: 'Rotate',
    label: 'Rotate',
    category: 'transform',
    // S2 (geometric sockets): optional "pivot" Point sets the rotation centre
    // (overrides isLocal/origin); optional "axis" Vector overrides axisX/Y/Z.
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'pivot', type: 'Point' },
      { name: 'axis', type: 'Vector' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'angle', type: 'number', default: 90, min: -360, max: 360, step: 1 },
      { name: 'axisX', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisY', type: 'number', default: 0, min: -1, max: 1, step: 0.1 },
      { name: 'axisZ', type: 'number', default: 1, min: -1, max: 1, step: 0.1 },
      { name: 'isLocal', type: 'boolean', default: false },
    ],
  },
  Scale: {
    type: 'Scale',
    label: 'Scale',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'factor', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      // Scale around the shape's own bbox center instead of the world origin —
      // usually what you want for parts that are already positioned.
      { name: 'isLocal', type: 'boolean', default: false },
    ],
  },
  ScaleXYZ: {
    type: 'ScaleXYZ',
    label: 'Scale XYZ (Non-uniform)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'factorX', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'factorY', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'factorZ', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'isLocal', type: 'boolean', default: true },
    ],
  },
  Bend: {
    type: 'Bend',
    label: 'Bend (Curve Along Axis)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      // 'X'/'Y': bends that axis's extent, curling into Z (petals, leaves, wings,
      // banners curving upward). 'Z': bends a vertical extent sideways into X
      // (stems, horns, vines curving as they rise).
      { name: 'axis', type: 'string', default: 'X' }, // 'X' | 'Y' | 'Z'
      { name: 'angle', type: 'number', default: 45, min: -170, max: 170, step: 1 },
    ],
  },
  Twist: {
    type: 'Twist',
    label: 'Twist (Spiral Along Axis)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'axis', type: 'string', default: 'Z' }, // 'X' | 'Y' | 'Z'
      { name: 'angle', type: 'number', default: 90, min: -1080, max: 1080, step: 1 },
    ],
  },
  Fillet: {
    type: 'Fillet',
    label: 'Fillet (Round Edges)',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'selection', type: 'Selection' }
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 1, min: 0.1, max: 20, step: 0.1 },
    ],
  },
  Chamfer: {
    type: 'Chamfer',
    label: 'Chamfer (Bevel Edges)',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'selection', type: 'Selection' }
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 1, min: 0.1, max: 20, step: 0.1 },
    ],
  },
  Extrude: {
    type: 'Extrude',
    label: 'Extrude',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'height', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      // Taper: scale the top cross-section relative to the base (1 = no taper,
      // 0.3 = tapers to 30% size at the top). 'sCurve' gives an organic curved
      // taper instead of a straight cone-like taper. Turns a plain Extrude into
      // a tapered petal/feather/fin/claw/spire without a separate node.
      { name: 'taperEndFactor', type: 'number', default: 1, min: 0.02, max: 3, step: 0.02 },
      { name: 'taperProfile', type: 'string', default: 'linear' }, // 'linear' | 'sCurve'
      { name: 'twistAngle', type: 'number', default: 0, min: -360, max: 360, step: 1 },
    ],
  },
  Mirror: {
    type: 'Mirror',
    label: 'Mirror',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'plane', type: 'string', default: 'YZ' }, // 'YZ' (flips X), 'XZ' (flips Y), 'XY' (flips Z)
    ],
  },
  Align: {
    type: 'Align',
    label: 'Align (Relative Placement)',
    category: 'transform',
    inputs: [
      { name: 'shape', type: 'Solid' },
      { name: 'reference', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      // above|below|left|right|front|back|center|ground  (left/right = -X/+X, front/back = -Y/+Y)
      { name: 'mode', type: 'string', default: 'above' },
      { name: 'offsetX', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
      { name: 'offsetY', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
      { name: 'offsetZ', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
    ],
  },
  Sketch: {
    type: 'Sketch',
    label: '2D Sketch (SVG)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }], // We output the sketch itself to be used by sweep/extrude/loft
    params: [
      { name: 'svgPath', type: 'string', default: 'M 0 0 L 10 0 L 10 10 L 0 10 Z' },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Pipe: {
    type: 'Pipe',
    label: 'Pipe (Tube Along Path)',
    category: 'geometry',
    // B1 (curve bridge): optional Curve input overrides pathSvg — any curve
    // (Ellipse, Spline-through-points, transformed/offset/divided curves)
    // becomes a visible tube.
    inputs: [{ name: 'path', type: 'Curve' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    // A circular-cross-section tube swept along an SVG-style path on the XY
    // plane (same M/L/C/Q syntax as Sketch — just leave off the closing Z).
    // Critical for stems, vines, cables, handles, tentacles, horns, arteries.
    // The profile auto-orients to the path's initial tangent direction.
    params: [
      { name: 'pathSvg', type: 'string', default: 'M 0 0 C 5 10 15 10 20 0' },
      { name: 'radius', type: 'number', default: 1, min: 0.02, max: 50, step: 0.02 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },

  Compound: {
    type: 'Compound',
    label: 'Group (Compound)',
    category: 'boolean',
    inputs: [
      { name: 'solid1', type: 'Solid' },
      { name: 'solid2', type: 'Solid' },
      { name: 'solid3', type: 'Solid' },
      { name: 'solid4', type: 'Solid' },
      { name: 'solid5', type: 'Solid' },
      { name: 'solid6', type: 'Solid' },
      { name: 'solid7', type: 'Solid' },
      { name: 'solid8', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [],
  },
  Text3D: {
    type: 'Text3D',
    label: 'Text (3D)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'text', type: 'string', default: 'C33D' },
      { name: 'size', type: 'number', default: 10, min: 1, max: 100, step: 1 },
      { name: 'height', type: 'number', default: 2, min: 0.1, max: 50, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Shell: {
    type: 'Shell',
    label: 'Shell (Hollow)',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'selection', type: 'Selection' }
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'thickness', type: 'number', default: 1, min: 0.1, max: 50, step: 0.1 },
      { name: 'removeBottomFace', type: 'boolean', default: false },
    ],
  },
  Loft: {
    type: 'Loft',
    label: 'Loft',
    category: 'transform',
    inputs: [
      { name: 'profile1', type: 'Solid' },
      { name: 'profile2', type: 'Solid' },
      { name: 'profile3', type: 'Solid' },
      { name: 'profile4', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [],
  },
  Revolve: {
    type: 'Revolve',
    label: 'Revolve',
    category: 'transform',
    inputs: [{ name: 'profile', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'angle', type: 'number', default: 360, min: 1, max: 360, step: 1 },
      { name: 'axis', type: 'string', default: 'Z' }, // 'X' | 'Y' | 'Z'
    ],
  },
  LinearPattern: {
    type: 'LinearPattern',
    label: 'Linear Pattern',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 3, min: 1, max: 100, step: 1 },
      { name: 'directionX', type: 'number', default: 15, min: -100, max: 100, step: 1 },
      { name: 'directionY', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'directionZ', type: 'number', default: 0, min: -100, max: 100, step: 1 },
    ],
  },
  CircularPattern: {
    type: 'CircularPattern',
    label: 'Circular Pattern',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 4, min: 1, max: 100, step: 1 },
      { name: 'radius', type: 'number', default: 20, min: 1, max: 200, step: 1 },
      { name: 'angle', type: 'number', default: 360, min: 0, max: 360, step: 1 },
      // Organic/spiral controls: phase-rotate the whole ring, spiral copies
      // upward, and grade instance scale from first to last copy.
      { name: 'startAngle', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'rise', type: 'number', default: 0, min: -50, max: 50, step: 0.1 },
      { name: 'scaleStart', type: 'number', default: 1, min: 0.05, max: 5, step: 0.05 },
      { name: 'scaleEnd', type: 'number', default: 1, min: 0.05, max: 5, step: 0.05 },
    ],
  },
  PlaceOnSurface: {
    type: 'PlaceOnSurface',
    label: 'Place on Surface',
    category: 'transform',
    inputs: [
      { name: 'surface', type: 'Solid' },
      { name: 'shape', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'u', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
      { name: 'v', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  ScatterOnSurface: {
    type: 'ScatterOnSurface',
    label: 'Scatter on Surface',
    category: 'transform',
    inputs: [
      { name: 'surface', type: 'Solid' },
      { name: 'shape', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 10, min: 1, max: 200, step: 1 },
      { name: 'seed', type: 'number', default: 1, min: 1, max: 100, step: 1 },
      { name: 'scaleMin', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'scaleMax', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'includeBase', type: 'boolean', default: true },
    ],
  },
  PlaceOnVertices: {
    type: 'PlaceOnVertices',
    label: 'Place on Vertices',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'shape', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'scaleMin', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'scaleMax', type: 'number', default: 1, min: 0.01, max: 10, step: 0.01 },
      { name: 'includeBase', type: 'boolean', default: true },
    ],
  },
  Boolean: {
    type: 'Boolean',
    label: 'Boolean',
    category: 'boolean',
    inputs: [
      { name: 'target', type: 'Solid' },
      { name: 'tool', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'operation', type: 'string', default: 'union' }, // 'union', 'difference', 'intersect'
    ],
  },
  SubdivideSurface: {
    type: 'SubdivideSurface',
    label: 'Subdivide Surface',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'uDivisions', type: 'number', default: 3, min: 1, max: 50, step: 1 },
      { name: 'vDivisions', type: 'number', default: 3, min: 1, max: 50, step: 1 },
      { name: 'inset', type: 'number', default: 0.1, min: 0, max: 0.99, step: 0.01 },
      { name: 'extrudeMin', type: 'number', default: 0.5, min: 0, max: 50, step: 0.1 },
      { name: 'extrudeMax', type: 'number', default: 0.5, min: 0, max: 50, step: 0.1 },
      { name: 'seed', type: 'number', default: 1, min: 1, max: 100, step: 1 },
      { name: 'faceIndex', type: 'number', default: -1, min: -1, max: 100, step: 1 },
      { name: 'includeBase', type: 'boolean', default: true },
    ],
  },
  FilterFaces: {
    type: 'FilterFaces',
    label: 'Filter Faces',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'axisFilter', type: 'string', default: 'maxZ' }, // 'maxZ', 'minZ', 'maxX', 'minX', 'maxY', 'minY', 'index', 'direction'
      { name: 'direction', type: 'string', default: 'Z' }, // 'X', 'Y', 'Z'
      { name: 'index', type: 'number', default: 0, min: 0, max: 100, step: 1 },
      { name: 'tolerance', type: 'number', default: 0.1, min: 0.01, max: 1.0, step: 0.01 },
    ],
  },
  Helix: {
    type: 'Helix',
    label: 'Helix (Coil)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'pitch', type: 'number', default: 5, min: 0.1, max: 100, step: 0.1 },
      { name: 'height', type: 'number', default: 20, min: 0.1, max: 200, step: 0.1 },
      { name: 'radius', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'radialChange', type: 'number', default: 0, min: -50, max: 50, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Sweep: {
    type: 'Sweep',
    label: 'Sweep Along Path',
    category: 'transform',
    inputs: [
      { name: 'profile', type: 'Solid' },
      { name: 'path', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [],
  },
  VariableFillet: {
    type: 'VariableFillet',
    label: 'Variable/Filtered Fillet',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 1, min: 0.01, max: 50, step: 0.01 },
      { name: 'filterAxis', type: 'string', default: 'all' }, // 'all', 'X', 'Y', 'Z'
      { name: 'edgeIndex', type: 'number', default: -1, min: -1, max: 200, step: 1 },
    ],
  },
  SelectFaces: {
    type: 'SelectFaces',
    label: 'Select Faces',
    category: 'geometry',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'selection', type: 'Selection' }],
    params: [
      { name: 'predicate', type: 'string', default: 'normal ~ +Z' },
      { name: 'tolerance', type: 'number', default: 0.1, min: 0.001, max: 1.0, step: 0.001 }
    ],
  },
  SelectEdges: {
    type: 'SelectEdges',
    label: 'Select Edges',
    category: 'geometry',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'selection', type: 'Selection' }],
    params: [
      { name: 'predicate', type: 'string', default: 'parallel Z' },
      { name: 'tolerance', type: 'number', default: 0.1, min: 0.001, max: 1.0, step: 0.001 }
    ],
  },
  SelectionCombine: {
    type: 'SelectionCombine',
    label: 'Combine Selections',
    category: 'boolean',
    inputs: [
      { name: 'selection1', type: 'Selection' },
      { name: 'selection2', type: 'Selection' }
    ],
    outputs: [{ name: 'selection', type: 'Selection' }],
    params: [
      { name: 'operation', type: 'string', default: 'union' }
    ],
  },
  SplitLoop: {
    type: 'SplitLoop',
    label: 'Split Loop (Slicing)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'axis', type: 'string', default: 'Z' }, // 'X' | 'Y' | 'Z'
      { name: 'at', type: 'number', default: 0.5, min: 0.0, max: 1.0, step: 0.01 }
    ],
  },
  SplitSolid: {
    type: 'SplitSolid',
    label: 'Split Solid (Cutter)',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'tool', type: 'Solid' }
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [],
  },
  ExtrudeFace: {
    type: 'ExtrudeFace',
    label: 'Extrude Face (Push/Pull)',
    category: 'transform',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'selection', type: 'Selection' }
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'height', type: 'number', default: 5, min: -100, max: 100, step: 0.1 }
    ],
  },
  // ---------- Point & Vector Math ----------
  Point: {
    type: 'Point',
    label: 'Point (XYZ)',
    category: 'math',
    inputs: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'z', type: 'number' },
    ],
    outputs: [{ name: 'point', type: 'Point' }],
    params: [
      { name: 'x', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'y', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'z', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
    ],
  },
  DeconstructPoint: {
    type: 'DeconstructPoint',
    label: 'Deconstruct Point',
    category: 'math',
    inputs: [{ name: 'point', type: 'Point' }],
    outputs: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'z', type: 'number' },
    ],
    params: [],
  },
  Centroid: {
    type: 'Centroid',
    label: 'Centroid',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'centroid', type: 'Point' }],
    params: [],
  },
  Midpoint: {
    type: 'Midpoint',
    label: 'Midpoint',
    category: 'math',
    inputs: [
      { name: 'a', type: 'Point' },
      { name: 'b', type: 'Point' },
    ],
    outputs: [{ name: 'midpoint', type: 'Point' }],
    params: [],
  },
  PointBetween: {
    type: 'PointBetween',
    label: 'Point Between',
    category: 'math',
    inputs: [
      { name: 'a', type: 'Point' },
      { name: 'b', type: 'Point' },
      { name: 't', type: 'number' },
    ],
    outputs: [{ name: 'point', type: 'Point' }],
    params: [
      { name: 't', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  Endpoints: {
    type: 'Endpoints',
    label: 'Endpoints',
    category: 'math',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [
      { name: 'start', type: 'Point' },
      { name: 'end', type: 'Point' },
    ],
    params: [],
  },
  VectorXYZ: {
    type: 'VectorXYZ',
    label: 'Vector (XYZ)',
    category: 'math',
    inputs: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'z', type: 'number' },
    ],
    outputs: [{ name: 'vector', type: 'Vector' }],
    params: [
      { name: 'x', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'y', type: 'number', default: 0, min: -100, max: 100, step: 0.1 },
      { name: 'z', type: 'number', default: 1, min: -100, max: 100, step: 0.1 },
    ],
  },
  DeconstructVector: {
    type: 'DeconstructVector',
    label: 'Deconstruct Vector',
    category: 'math',
    inputs: [{ name: 'vector', type: 'Vector' }],
    outputs: [
      { name: 'x', type: 'number' },
      { name: 'y', type: 'number' },
      { name: 'z', type: 'number' },
    ],
    params: [],
  },
  Vector2Pt: {
    type: 'Vector2Pt',
    label: 'Vector 2Pt',
    category: 'math',
    inputs: [
      { name: 'a', type: 'Point' },
      { name: 'b', type: 'Point' },
    ],
    outputs: [{ name: 'vector', type: 'Vector' }],
    params: [
      { name: 'normalize', type: 'boolean', default: false },
    ],
  },
  VectorMath: {
    type: 'VectorMath',
    label: 'Vector Math',
    category: 'math',
    inputs: [
      { name: 'a', type: 'Vector' },
      { name: 'b', type: 'Vector' },
      { name: 'factor', type: 'number' },
    ],
    outputs: [
      { name: 'vector', type: 'Vector' },
      { name: 'value', type: 'number' },
    ],
    params: [
      { name: 'operation', type: 'string', default: 'add' }, // add, subtract, scale, cross, dot, angle
      { name: 'factor', type: 'number', default: 1, min: -100, max: 100, step: 0.1 },
    ],
  },
  ConstructPlane: {
    type: 'ConstructPlane',
    label: 'Construct Plane',
    category: 'math',
    inputs: [
      { name: 'origin', type: 'Point' },
      { name: 'normal', type: 'Vector' },
    ],
    outputs: [{ name: 'plane', type: 'Plane' }],
    params: [],
  },
  // ---------- Curve Generation ----------
  Line: {
    type: 'Line',
    label: 'Line (2Pt)',
    category: 'geometry',
    inputs: [
      { name: 'a', type: 'Point' },
      { name: 'b', type: 'Point' },
    ],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Arc: {
    type: 'Arc',
    label: 'Arc (3Pt)',
    category: 'geometry',
    inputs: [
      { name: 'start', type: 'Point' },
      { name: 'middle', type: 'Point' },
      { name: 'end', type: 'Point' },
    ],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  CircleCurve: {
    type: 'CircleCurve',
    label: 'Circle (Curve)',
    category: 'geometry',
    inputs: [
      { name: 'center', type: 'Point' },
      { name: 'normal', type: 'Vector' },
    ],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'radius', type: 'number', default: 5, min: 0.1, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  EllipseCurve: {
    type: 'EllipseCurve',
    label: 'Ellipse (Curve)',
    category: 'geometry',
    inputs: [
      { name: 'center', type: 'Point' },
      { name: 'normal', type: 'Vector' },
    ],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'radiusX', type: 'number', default: 5, min: 0.1, max: 100, step: 0.1 },
      { name: 'radiusY', type: 'number', default: 3, min: 0.1, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  PolylineCurve: {
    type: 'PolylineCurve',
    label: 'Polyline',
    category: 'geometry',
    inputs: [{ name: 'points', type: 'Point' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'closed', type: 'boolean', default: false },
      // Name of a per-point channel ('row', 'group', 'wireIndex'): one
      // polyline per consecutive run of equal channel value.
      { name: 'groupBy', type: 'string', default: '' },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  SplineCurve: {
    type: 'SplineCurve',
    label: 'Spline (Interpolate)',
    category: 'geometry',
    inputs: [{ name: 'points', type: 'Point' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'closed', type: 'boolean', default: false },
      // Name of a per-point channel ('row', 'group', 'wireIndex'): one spline
      // per consecutive run of equal channel value → multi-wire Curve for Loft.
      { name: 'groupBy', type: 'string', default: '' },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  EdgesAsCurves: {
    type: 'EdgesAsCurves',
    label: 'Edges to Curves',
    category: 'geometry',
    // Executor extracts edges from a SOLID; the previous 'selection: Selection'
    // declaration never worked (a Selection record carries no geometry).
    inputs: [{ name: 'shape', type: 'Solid' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  // ---------- Measurement & Query ----------
  Measure: {
    type: 'Measure',
    label: 'Measure Shape',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [
      { name: 'volume', type: 'number' },
      { name: 'area', type: 'number' },
      { name: 'centroid', type: 'Point' },
    ],
    params: [],
  },
  BoundingBox: {
    type: 'BoundingBox',
    label: 'Bounding Box',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [
      { name: 'box', type: 'Solid' },
      { name: 'min', type: 'Point' },
      { name: 'max', type: 'Point' },
      { name: 'size', type: 'Vector' },
    ],
    params: [],
  },
  DistanceMeasure: {
    type: 'DistanceMeasure',
    label: 'Distance',
    category: 'math',
    inputs: [
      { name: 'a', type: 'Point' },
      { name: 'b', type: 'Point' },
    ],
    outputs: [{ name: 'distance', type: 'number' }],
    params: [],
  },
  IsInside: {
    type: 'IsInside',
    label: 'Is Inside',
    category: 'math',
    inputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'point', type: 'Point' },
    ],
    outputs: [{ name: 'isInside', type: 'number' }],
    params: [],
  },
  SelectionMeasure: {
    type: 'SelectionMeasure',
    label: 'Selection Measure',
    category: 'math',
    inputs: [{ name: 'selection', type: 'Selection' }],
    outputs: [
      { name: 'areaOrLength', type: 'number' },
      { name: 'centroid', type: 'Point' },
    ],
    params: [],
  },
  CurveLength: {
    type: 'CurveLength',
    label: 'Curve Length',
    category: 'math',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'length', type: 'number' }],
    params: [],
  },
  PointOnCurve: {
    type: 'PointOnCurve',
    label: 'Point on Curve',
    category: 'math',
    inputs: [
      { name: 'curve', type: 'Curve' },
      { name: 't', type: 'number' },
    ],
    outputs: [{ name: 'point', type: 'Point' }],
    params: [
      { name: 't', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  EvaluateCurve: {
    type: 'EvaluateCurve',
    label: 'Evaluate Curve',
    category: 'math',
    inputs: [
      { name: 'curve', type: 'Curve' },
      { name: 't', type: 'number' },
    ],
    outputs: [
      { name: 'point', type: 'Point' },
      { name: 'tangent', type: 'Vector' },
    ],
    params: [
      { name: 't', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
    ],
  },
  DivideCurve: {
    type: 'DivideCurve',
    label: 'Divide Curve',
    category: 'math',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [
      { name: 'count', type: 'number', default: 10, min: 2, max: 1000, step: 1 },
    ],
  },
  // ---------- Point Grid & Jitter ----------
  PointGrid: {
    type: 'PointGrid',
    label: 'Point Grid',
    category: 'math',
    inputs: [],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [
      { name: 'countX', type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { name: 'countY', type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { name: 'spacingX', type: 'number', default: 2, min: 0.1, max: 50, step: 0.1 },
      { name: 'spacingY', type: 'number', default: 2, min: 0.1, max: 50, step: 0.1 },
    ],
  },
  Jitter: {
    type: 'Jitter',
    label: 'Jitter Points',
    category: 'math',
    inputs: [{ name: 'points', type: 'Point' }],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [
      { name: 'amount', type: 'number', default: 0.5, min: 0, max: 20, step: 0.01 },
      { name: 'seed', type: 'number', default: 1, min: 1, max: 100, step: 1 },
    ],
  },
  // ---------- Curve → Solid bridges (Workstream B) ----------
  // These close the loop that made the curve/point layer an island: curves
  // become solids (extrude/loft/sweep/revolve/pipe-with-path) and point
  // streams become instances. See docs/kernel_health_and_curve_bridge_plan.md.
  ExtrudeCurve: {
    type: 'ExtrudeCurve',
    label: 'Extrude Curve (Closed → Solid)',
    category: 'transform',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'height', type: 'number', default: 10, min: 0.1, max: 200, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  LoftCurves: {
    type: 'LoftCurves',
    label: 'Loft Curves (Rails → Solid)',
    category: 'transform',
    inputs: [
      { name: 'curve1', type: 'Curve' },
      { name: 'curve2', type: 'Curve' },
      { name: 'curve3', type: 'Curve' },
      { name: 'curve4', type: 'Curve' },
      { name: 'curve5', type: 'Curve' },
      { name: 'curve6', type: 'Curve' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'ruled', type: 'boolean', default: false },
      { name: 'closed', type: 'boolean', default: false },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  SweepAlongCurve: {
    type: 'SweepAlongCurve',
    label: 'Sweep Along Curve',
    category: 'transform',
    inputs: [
      { name: 'rail', type: 'Curve' },
      { name: 'profile', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  RevolveCurve: {
    type: 'RevolveCurve',
    label: 'Revolve Curve (Profile → Solid)',
    category: 'transform',
    inputs: [{ name: 'profile', type: 'Curve' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'angle', type: 'number', default: 360, min: 1, max: 360, step: 1 },
      { name: 'axis', type: 'string', default: 'Z' },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  InstanceOnPoints: {
    type: 'InstanceOnPoints',
    label: 'Instance On Points',
    category: 'transform',
    inputs: [
      { name: 'shape', type: 'Solid' },
      { name: 'points', type: 'Point' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'alignToTangent', type: 'boolean', default: false },
      { name: 'scaleStart', type: 'number', default: 1, min: 0.05, max: 5, step: 0.05 },
      { name: 'scaleEnd', type: 'number', default: 1, min: 0.05, max: 5, step: 0.05 },
      { name: 'everyNth', type: 'number', default: 1, min: 1, max: 20, step: 1 },
      { name: 'maxCount', type: 'number', default: 100, min: 1, max: 200, step: 1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  TransformCurve: {
    type: 'TransformCurve',
    label: 'Transform Curve (Move/Rotate/Scale)',
    category: 'geometry',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'tx', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
      { name: 'ty', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
      { name: 'tz', type: 'number', default: 0, min: -200, max: 200, step: 0.1 },
      { name: 'rotate', type: 'number', default: 0, min: -360, max: 360, step: 1 },
      { name: 'scale', type: 'number', default: 1, min: 0.05, max: 20, step: 0.05 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  OffsetCurve: {
    type: 'OffsetCurve',
    label: 'Offset Curve (Parallel)',
    category: 'geometry',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'distance', type: 'number', default: 2, min: -100, max: 100, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Macro: {
    type: 'Macro',
    label: 'Macro (Reusable Component)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    // Params are dynamic: defined by the macro's exposedParams; the UI and worker
    // resolve them from the MacroDefinition referenced by data.macroId.
    params: [],
  }
};

// ---------- Shared knowledge-base types ----------

export interface MacroExposedParam {
  name: string;          // public name shown on the macro node
  nodeId: string;        // inner node id
  param: string;         // inner node param name
  type: NodeParamType;
  default: any;
  min?: number;
  max?: number;
  step?: number;
}

export interface MacroDefinition {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  nodes: any[];          // inner subgraph (positions kept for editing/inspection)
  edges: any[];
  outputNodeId: string;  // inner node whose result is the macro output
  exposedParams: MacroExposedParam[];
}

export interface SuccessExample {
  id: string;
  createdAt: string;
  prompts: string[];        // user prompts of the episode
  plan: string;             // the model's plan/reasoning text
  comment: string;          // user's comment at save time
  graphOriginal: { nodes: any[]; edges: any[] } | null;  // as the AI produced it
  graphFinal: { nodes: any[]; edges: any[] };            // after user's manual edits
  thumbnail: string;        // dataURL snapshot
  model: string;
  tags: string[];
  embedding?: number[];     // optional provider embedding of prompts+comment
  verifiedOnBuild?: string; // C5: provenance stamp — capability claims need dates
}
