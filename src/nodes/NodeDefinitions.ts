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
  SliceList: {
    type: 'SliceList',
    label: 'Slice List (Cull)',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
    ],
    outputs: [{ name: 'list', type: 'Solid' }],
    params: [
      { name: 'startIndex', type: 'number', default: 0, min: -100, max: 100, step: 1 },
      { name: 'endIndex', type: 'number', default: 0, min: -100, max: 100, step: 1 },
    ],
  },
  GetMatrixItem: {
    type: 'GetMatrixItem',
    label: 'Get Matrix Item',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
    ],
    outputs: [{ name: 'item', type: 'Solid' }],
    params: [
      { name: 'rowIndex', type: 'number', default: 0, min: 0, max: 1000, step: 1 },
      { name: 'colIndex', type: 'number', default: 0, min: 0, max: 1000, step: 1 },
    ],
  },
  TreeBranch: {
    type: 'TreeBranch',
    label: 'Tree Branch',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
    ],
    outputs: [{ name: 'branch', type: 'Solid' }],
    params: [
      { name: 'branchIndex', type: 'number', default: 0, min: 0, max: 1000, step: 1 },
    ],
  },
  DispatchList: {
    type: 'DispatchList',
    label: 'Dispatch List',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
      { name: 'pattern', type: 'number' },
    ],
    outputs: [
      { name: 'listA', type: 'Solid' },
      { name: 'listB', type: 'Solid' },
    ],
    params: [],
  },
  FlattenTree: {
    type: 'FlattenTree',
    label: 'Flatten Tree',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
    ],
    outputs: [{ name: 'list', type: 'Solid' }],
    params: [],
  },
  GraftTree: {
    type: 'GraftTree',
    label: 'Graft Tree',
    category: 'math',
    inputs: [
      { name: 'list', type: 'Solid' },
    ],
    outputs: [{ name: 'list', type: 'Solid' }],
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
  // Grasshopper-style "Merge": collect separately-built points (or point lists)
  // into ONE list. Without this there was no way to turn N individually created
  // points into the point[] that polyline/spline/instances consume — models
  // wrote ["$p1","$p2","$p3"] and the compiler had nothing to expand it into.
  MergePoints: {
    type: 'MergePoints',
    label: 'Merge Points',
    category: 'math',
    inputs: [
      { name: 'p1', type: 'Point' },
      { name: 'p2', type: 'Point' },
      { name: 'p3', type: 'Point' },
      { name: 'p4', type: 'Point' },
      { name: 'p5', type: 'Point' },
      { name: 'p6', type: 'Point' },
      { name: 'p7', type: 'Point' },
      { name: 'p8', type: 'Point' },
    ],
    outputs: [{ name: 'points', type: 'Point' }],
    params: [],
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
    // NOTE: actual runtime value is a 2D Face, not a Solid — the socket type
    // is load-bearing for connection matching, so it stays 'Solid'.
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
      // (isLocal removed: it was declared here but never read by the executor.)
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
    // NOTE: actual runtime value is a Sketch (2D), not a Solid — we output the
    // sketch itself to be used by sweep/extrude/loft; the socket type is
    // load-bearing for connection matching, so it stays 'Solid'.
    outputs: [{ name: 'solid', type: 'Solid' }],
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
    // NOTE: actual runtime value is a Wire, not a Solid — the socket type is
    // load-bearing for connection matching (Pipe/Sweep accept it), so it
    // stays 'Solid'.
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
    params: [
      // right|round|transformed — matches the executor's genericSweep option
      // (previously read by the executor but undeclared, so unsettable).
      { name: 'transitionMode', type: 'string', default: 'right' },
    ],
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
      { name: 'maxCount', type: 'number', default: 100, min: 1, max: 500, step: 1 },
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
  // --- Architectural Domain Nodes (12) ---
  MultiLoft: {
    type: 'MultiLoft',
    label: 'Multi Loft (Skin)',
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
      { name: 'color', type: 'string', default: '#94a3b8' },
    ],
  },
  CurveOffset: {
    type: 'CurveOffset',
    label: 'Curve Offset',
    category: 'geometry',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'distance', type: 'number', default: 1.0, min: -50, max: 50, step: 0.1 },
      { name: 'joinType', type: 'string', default: 'round' },
    ],
  },
  RegularPolygon: {
    type: 'RegularPolygon',
    label: 'Regular Polygon (N-Gon)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'sides', type: 'number', default: 6, min: 3, max: 32, step: 1 },
      { name: 'radius', type: 'number', default: 10, min: 0.1, max: 200, step: 0.5 },
      { name: 'filletRadius', type: 'number', default: 0, min: 0, max: 50, step: 0.1 },
      { name: 'starRatio', type: 'number', default: 1.0, min: 0.1, max: 1.0, step: 0.05 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  FloorGrid: {
    type: 'FloorGrid',
    label: 'Floor Grid (Building)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'width', type: 'number', default: 30, min: 5, max: 200, step: 1 },
      { name: 'length', type: 'number', default: 40, min: 5, max: 200, step: 1 },
      { name: 'floors', type: 'number', default: 4, min: 1, max: 50, step: 1 },
      { name: 'floorHeight', type: 'number', default: 4, min: 1, max: 20, step: 0.5 },
      { name: 'slabThickness', type: 'number', default: 0.4, min: 0.1, max: 2, step: 0.05 },
      { name: 'columnRadius', type: 'number', default: 0.35, min: 0.05, max: 2, step: 0.05 },
      { name: 'columnSpacing', type: 'number', default: 8, min: 2, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#cbd5e1' },
    ],
  },
  FacadeDivider: {
    type: 'FacadeDivider',
    label: 'Facade Divider (Panels)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'width', type: 'number', default: 20, min: 2, max: 100, step: 1 },
      { name: 'height', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { name: 'uPanels', type: 'number', default: 5, min: 1, max: 30, step: 1 },
      { name: 'vPanels', type: 'number', default: 3, min: 1, max: 30, step: 1 },
      { name: 'frameThickness', type: 'number', default: 0.2, min: 0.05, max: 2, step: 0.05 },
      { name: 'glassDepth', type: 'number', default: 0.05, min: 0.01, max: 1, step: 0.01 },
      { name: 'mullionWidth', type: 'number', default: 0.15, min: 0.05, max: 1, step: 0.05 },
      { name: 'color', type: 'string', default: '#64748b' },
    ],
  },
  Stairs: {
    type: 'Stairs',
    label: 'Stairs (Straight/Spiral)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'type', type: 'string', default: 'straight' },
      { name: 'steps', type: 'number', default: 14, min: 1, max: 100, step: 1 },
      { name: 'width', type: 'number', default: 1.2, min: 0.5, max: 10, step: 0.1 },
      { name: 'totalHeight', type: 'number', default: 2.8, min: 0.5, max: 20, step: 0.1 },
      { name: 'treadDepth', type: 'number', default: 0.28, min: 0.1, max: 1, step: 0.02 },
      { name: 'innerRadius', type: 'number', default: 0.6, min: 0.1, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#94a3b8' },
    ],
  },
  RoofProfile: {
    type: 'RoofProfile',
    label: 'Roof Profile (Gable/Mansard)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'type', type: 'string', default: 'gable' },
      { name: 'width', type: 'number', default: 12, min: 2, max: 100, step: 0.5 },
      { name: 'length', type: 'number', default: 16, min: 2, max: 100, step: 0.5 },
      { name: 'pitchAngle', type: 'number', default: 30, min: 5, max: 80, step: 1 },
      { name: 'thickness', type: 'number', default: 0.3, min: 0.05, max: 2, step: 0.05 },
      { name: 'color', type: 'string', default: '#b91c1c' },
    ],
  },
  Arch: {
    type: 'Arch',
    label: 'Arch (Roman/Gothic)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'type', type: 'string', default: 'roman' },
      { name: 'span', type: 'number', default: 4, min: 0.5, max: 50, step: 0.5 },
      { name: 'height', type: 'number', default: 5, min: 0.5, max: 50, step: 0.5 },
      { name: 'depth', type: 'number', default: 1.2, min: 0.1, max: 20, step: 0.1 },
      { name: 'wallThickness', type: 'number', default: 0.4, min: 0.1, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#d1d5db' },
    ],
  },
  Column: {
    type: 'Column',
    label: 'Column (Architectural)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'height', type: 'number', default: 8, min: 1, max: 50, step: 0.5 },
      { name: 'baseRadius', type: 'number', default: 0.6, min: 0.1, max: 10, step: 0.05 },
      { name: 'topRadius', type: 'number', default: 0.48, min: 0.1, max: 10, step: 0.05 },
      { name: 'fluteCount', type: 'number', default: 16, min: 0, max: 32, step: 1 },
      { name: 'baseHeight', type: 'number', default: 0.8, min: 0.1, max: 5, step: 0.1 },
      { name: 'capitalHeight', type: 'number', default: 0.8, min: 0.1, max: 5, step: 0.1 },
      { name: 'color', type: 'string', default: '#e2e8f0' },
    ],
  },
  Truss: {
    type: 'Truss',
    label: 'Truss (Warren Framework)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'span', type: 'number', default: 16, min: 2, max: 100, step: 1 },
      { name: 'height', type: 'number', default: 2.5, min: 0.5, max: 20, step: 0.5 },
      { name: 'depth', type: 'number', default: 0.4, min: 0.1, max: 5, step: 0.1 },
      { name: 'panels', type: 'number', default: 6, min: 2, max: 24, step: 1 },
      { name: 'barThickness', type: 'number', default: 0.15, min: 0.05, max: 1, step: 0.01 },
      { name: 'color', type: 'string', default: '#475569' },
    ],
  },
  Balustrade: {
    type: 'Balustrade',
    label: 'Balustrade (Railing)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'length', type: 'number', default: 10, min: 1, max: 100, step: 0.5 },
      { name: 'height', type: 'number', default: 1.0, min: 0.4, max: 3, step: 0.05 },
      { name: 'balusterSpacing', type: 'number', default: 0.2, min: 0.05, max: 1, step: 0.02 },
      { name: 'balusterRadius', type: 'number', default: 0.025, min: 0.005, max: 0.2, step: 0.005 },
      { name: 'railRadius', type: 'number', default: 0.04, min: 0.01, max: 0.2, step: 0.005 },
      { name: 'color', type: 'string', default: '#334155' },
    ],
  },
  WallWithOpenings: {
    type: 'WallWithOpenings',
    label: 'Wall with Openings',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'length', type: 'number', default: 12, min: 1, max: 100, step: 0.5 },
      { name: 'height', type: 'number', default: 3.2, min: 1, max: 20, step: 0.2 },
      { name: 'thickness', type: 'number', default: 0.3, min: 0.05, max: 2, step: 0.05 },
      { name: 'openingWidth', type: 'number', default: 1.4, min: 0.4, max: 10, step: 0.1 },
      { name: 'openingHeight', type: 'number', default: 1.8, min: 0.4, max: 10, step: 0.1 },
      { name: 'openingCount', type: 'number', default: 3, min: 1, max: 10, step: 1 },
      { name: 'openingBottomOffset', type: 'number', default: 0.8, min: 0, max: 5, step: 0.1 },
      { name: 'color', type: 'string', default: '#94a3b8' },
    ],
  },

  // --- Organic Domain Nodes (10) ---
  Phyllotaxis: {
    type: 'Phyllotaxis',
    label: 'Phyllotaxis (Spiral Points)',
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
      { name: 'spread', type: 'number', default: 2.0, min: 0.01, max: 50, step: 0.1 },
      { name: 'divergenceAngle', type: 'number', default: 137.5077, min: 0, max: 360, step: 0.01 },
      { name: 'pitchZ', type: 'number', default: 0.2, min: -10, max: 10, step: 0.05 },
      { name: 'domeRadius', type: 'number', default: 0, min: 0, max: 100, step: 0.5 },
    ],
  },
  AirfoilCurve: {
    type: 'AirfoilCurve',
    label: 'Airfoil Curve (NACA)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'chord', type: 'number', default: 10, min: 0.5, max: 200, step: 0.5 },
      { name: 'nacaCode', type: 'string', default: '0012' },
      { name: 'numPoints', type: 'number', default: 40, min: 10, max: 200, step: 2 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  Superellipse: {
    type: 'Superellipse',
    label: 'Superellipse (Squircle Curve)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'radiusX', type: 'number', default: 6, min: 0.5, max: 100, step: 0.5 },
      { name: 'radiusY', type: 'number', default: 4, min: 0.5, max: 100, step: 0.5 },
      { name: 'exponent', type: 'number', default: 2.5, min: 0.2, max: 10, step: 0.1 },
      { name: 'numPoints', type: 'number', default: 48, min: 12, max: 180, step: 4 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  OrganicRib: {
    type: 'OrganicRib',
    label: 'Organic Rib (Curved Spine)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'length', type: 'number', default: 10, min: 1, max: 100, step: 0.5 },
      { name: 'baseRadius', type: 'number', default: 0.8, min: 0.1, max: 10, step: 0.05 },
      { name: 'tipRadius', type: 'number', default: 0.2, min: 0.05, max: 10, step: 0.05 },
      { name: 'archHeight', type: 'number', default: 2.5, min: 0, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#10b981' },
    ],
  },
  BranchingSystem: {
    type: 'BranchingSystem',
    label: 'Branching System (Tree)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'levels', type: 'number', default: 2, min: 1, max: 4, step: 1 },
      { name: 'trunkRadius', type: 'number', default: 0.8, min: 0.1, max: 10, step: 0.05 },
      { name: 'trunkHeight', type: 'number', default: 6, min: 1, max: 50, step: 0.5 },
      { name: 'branchAngle', type: 'number', default: 30, min: 10, max: 60, step: 1 },
      { name: 'radiusDecay', type: 'number', default: 0.65, min: 0.4, max: 0.85, step: 0.05 },
      { name: 'color', type: 'string', default: '#15803d' },
    ],
  },
  Tendon: {
    type: 'Tendon',
    label: 'Tendon (Cable/Ligament)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'radius', type: 'number', default: 0.3, min: 0.05, max: 5, step: 0.05 },
      { name: 'length', type: 'number', default: 10, min: 1, max: 100, step: 0.5 },
      { name: 'sag', type: 'number', default: 1.0, min: -10, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#f43f5e' },
    ],
  },
  PetalMorph: {
    type: 'PetalMorph',
    label: 'Petal Morph (Curved Petal)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'length', type: 'number', default: 10, min: 1, max: 100, step: 0.5 },
      { name: 'width', type: 'number', default: 5, min: 0.5, max: 50, step: 0.5 },
      { name: 'cupDepth', type: 'number', default: 1.5, min: -10, max: 10, step: 0.2 },
      { name: 'edgeWaviness', type: 'number', default: 0.4, min: 0, max: 5, step: 0.1 },
      { name: 'thickness', type: 'number', default: 0.3, min: 0.05, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#ec4899' },
    ],
  },
  SpineLoft: {
    type: 'SpineLoft',
    label: 'Spine Loft (Variable Body)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'spineLength', type: 'number', default: 12, min: 1, max: 100, step: 0.5 },
      { name: 'radiusStart', type: 'number', default: 1.5, min: 0.1, max: 20, step: 0.1 },
      { name: 'radiusMid', type: 'number', default: 3.0, min: 0.1, max: 30, step: 0.1 },
      { name: 'radiusEnd', type: 'number', default: 0.4, min: 0.05, max: 20, step: 0.05 },
      { name: 'segments', type: 'number', default: 8, min: 3, max: 30, step: 1 },
      { name: 'color', type: 'string', default: '#a855f7' },
    ],
  },
  SegmentedBody: {
    type: 'SegmentedBody',
    label: 'Segmented Body (Arthropod)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'segments', type: 'number', default: 6, min: 2, max: 20, step: 1 },
      { name: 'baseRadius', type: 'number', default: 1.2, min: 0.2, max: 20, step: 0.1 },
      { name: 'maxRadius', type: 'number', default: 2.5, min: 0.2, max: 30, step: 0.1 },
      { name: 'length', type: 'number', default: 12, min: 1, max: 100, step: 0.5 },
      { name: 'segmentGap', type: 'number', default: 0.15, min: 0, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#eab308' },
    ],
  },
  MetaballCluster: {
    type: 'MetaballCluster',
    label: 'Metaball Cluster (Blob Compound)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 5, min: 1, max: 20, step: 1 },
      { name: 'radius', type: 'number', default: 2.0, min: 0.5, max: 20, step: 0.2 },
      { name: 'spread', type: 'number', default: 3.0, min: 0.5, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#06b6d4' },
    ],
  },

  // --- Engineering Domain Nodes (11) ---
  InvoluteGear: {
    type: 'InvoluteGear',
    label: 'Involute Gear (Spur)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'teeth', type: 'number', default: 20, min: 6, max: 100, step: 1 },
      { name: 'module', type: 'number', default: 1.0, min: 0.1, max: 20, step: 0.1 },
      { name: 'faceWidth', type: 'number', default: 5.0, min: 0.5, max: 100, step: 0.5 },
      { name: 'boreDiameter', type: 'number', default: 4.0, min: 0, max: 50, step: 0.5 },
      { name: 'pressureAngle', type: 'number', default: 20, min: 10, max: 35, step: 0.5 },
      { name: 'color', type: 'string', default: '#64748b' },
    ],
  },
  BevelGear: {
    type: 'BevelGear',
    label: 'Bevel Gear (Conical)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'teeth', type: 'number', default: 18, min: 8, max: 80, step: 1 },
      { name: 'module', type: 'number', default: 1.2, min: 0.1, max: 20, step: 0.1 },
      { name: 'faceWidth', type: 'number', default: 4.0, min: 0.5, max: 50, step: 0.5 },
      { name: 'boreDiameter', type: 'number', default: 4.0, min: 0, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#475569' },
    ],
  },
  RackAndPinion: {
    type: 'RackAndPinion',
    label: 'Rack and Pinion (Gear Rack)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'length', type: 'number', default: 30, min: 2, max: 200, step: 1 },
      { name: 'module', type: 'number', default: 1.0, min: 0.1, max: 20, step: 0.1 },
      { name: 'height', type: 'number', default: 8.0, min: 1, max: 50, step: 0.5 },
      { name: 'width', type: 'number', default: 5.0, min: 0.5, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#475569' },
    ],
  },
  Sprocket: {
    type: 'Sprocket',
    label: 'Sprocket (Roller Chain)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'teeth', type: 'number', default: 16, min: 8, max: 80, step: 1 },
      { name: 'pitch', type: 'number', default: 6.35, min: 0.5, max: 50, step: 0.05 },
      { name: 'rollerDiameter', type: 'number', default: 3.3, min: 0.2, max: 20, step: 0.1 },
      { name: 'thickness', type: 'number', default: 2.5, min: 0.2, max: 50, step: 0.1 },
      { name: 'boreDiameter', type: 'number', default: 5.0, min: 0, max: 50, step: 0.5 },
      { name: 'color', type: 'string', default: '#334155' },
    ],
  },
  TimingPulley: {
    type: 'TimingPulley',
    label: 'Timing Pulley (Belt)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'teeth', type: 'number', default: 24, min: 10, max: 100, step: 1 },
      { name: 'pitch', type: 'number', default: 2.0, min: 0.5, max: 20, step: 0.1 },
      { name: 'width', type: 'number', default: 7.0, min: 1, max: 50, step: 0.5 },
      { name: 'boreDiameter', type: 'number', default: 5.0, min: 0, max: 50, step: 0.5 },
      { name: 'flangeHeight', type: 'number', default: 1.2, min: 0, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#64748b' },
    ],
  },
  HexNutBolt: {
    type: 'HexNutBolt',
    label: 'Hex Nut and Bolt (Fastener)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'boltDiameter', type: 'number', default: 6.0, min: 1, max: 50, step: 0.5 },
      { name: 'length', type: 'number', default: 25.0, min: 2, max: 200, step: 1 },
      { name: 'color', type: 'string', default: '#94a3b8' },
    ],
  },
  SnapFitJoint: {
    type: 'SnapFitJoint',
    label: 'Snap-Fit Joint (Cantilever)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'beamLength', type: 'number', default: 12, min: 2, max: 100, step: 0.5 },
      { name: 'beamWidth', type: 'number', default: 4, min: 0.5, max: 50, step: 0.5 },
      { name: 'beamThickness', type: 'number', default: 1.2, min: 0.2, max: 10, step: 0.1 },
      { name: 'hookDepth', type: 'number', default: 1.0, min: 0.2, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#0284c7' },
    ],
  },
  OringGroove: {
    type: 'OringGroove',
    label: 'O-Ring Groove (Shaft)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'shaftDiameter', type: 'number', default: 20, min: 2, max: 100, step: 0.5 },
      { name: 'grooveWidth', type: 'number', default: 2.5, min: 0.5, max: 20, step: 0.1 },
      { name: 'grooveDepth', type: 'number', default: 1.5, min: 0.2, max: 10, step: 0.1 },
      { name: 'shaftLength', type: 'number', default: 20, min: 2, max: 100, step: 0.5 },
      { name: 'color', type: 'string', default: '#475569' },
    ],
  },
  HeatSink: {
    type: 'HeatSink',
    label: 'Heat Sink (Finned Array)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'baseWidth', type: 'number', default: 30, min: 2, max: 200, step: 1 },
      { name: 'baseLength', type: 'number', default: 40, min: 2, max: 200, step: 1 },
      { name: 'baseThickness', type: 'number', default: 3, min: 0.5, max: 20, step: 0.5 },
      { name: 'finCount', type: 'number', default: 12, min: 2, max: 40, step: 1 },
      { name: 'finHeight', type: 'number', default: 15, min: 1, max: 100, step: 1 },
      { name: 'finThickness', type: 'number', default: 1.0, min: 0.2, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#1e293b' },
    ],
  },
  FlangeConnection: {
    type: 'FlangeConnection',
    label: 'Flange Connection (PCD Holes)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'pipeDiameter', type: 'number', default: 15, min: 1, max: 100, step: 0.5 },
      { name: 'outerDiameter', type: 'number', default: 30, min: 2, max: 200, step: 1 },
      { name: 'flangeThickness', type: 'number', default: 4, min: 0.5, max: 50, step: 0.5 },
      { name: 'boltCount', type: 'number', default: 6, min: 3, max: 24, step: 1 },
      { name: 'boltHoleDiameter', type: 'number', default: 3.5, min: 0.5, max: 20, step: 0.5 },
      { name: 'pcd', type: 'number', default: 22.5, min: 1, max: 150, step: 0.5 },
      { name: 'color', type: 'string', default: '#64748b' },
    ],
  },
  KeywayShaft: {
    type: 'KeywayShaft',
    label: 'Keyway Shaft (Drive)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'diameter', type: 'number', default: 16, min: 2, max: 100, step: 0.5 },
      { name: 'length', type: 'number', default: 40, min: 4, max: 200, step: 1 },
      { name: 'keywayWidth', type: 'number', default: 5, min: 0.5, max: 20, step: 0.5 },
      { name: 'keywayDepth', type: 'number', default: 3, min: 0.2, max: 10, step: 0.1 },
      { name: 'keywayLength', type: 'number', default: 20, min: 1, max: 100, step: 0.5 },
      { name: 'color', type: 'string', default: '#475569' },
    ],
  },

  // --- Generative Domain Nodes (14) ---
  CurveFrame: {
    type: 'CurveFrame',
    label: 'Curve Frame (Frenet PTNB)',
    category: 'geometry',
    inputs: [{ name: 'curve', type: 'Curve' }],
    outputs: [
      { name: 'points', type: 'Point[]' },
      { name: 'tangents', type: 'Vector[]' },
      { name: 'normals', type: 'Vector[]' },
      { name: 'rotations', type: 'Vector[]' },
    ],
    params: [
      { name: 'samples', type: 'number', default: 20, min: 2, max: 200, step: 1 },
    ],
  },
  AttractorField: {
    type: 'AttractorField',
    label: 'Attractor Field (Influence)',
    category: 'math',
    inputs: [
      { name: 'points', type: 'Point[]' },
      { name: 'target', type: 'Point' },
    ],
    outputs: [{ name: 'points', type: 'Point[]' }],
    params: [
      { name: 'targetX', type: 'number', default: 0, min: -100, max: 100, step: 0.5 },
      { name: 'targetY', type: 'number', default: 0, min: -100, max: 100, step: 0.5 },
      { name: 'targetZ', type: 'number', default: 0, min: -100, max: 100, step: 0.5 },
      { name: 'radius', type: 'number', default: 10, min: 0.1, max: 100, step: 0.5 },
      { name: 'falloff', type: 'string', default: 'linear' },
    ],
  },
  NoiseDisplacement: {
    type: 'NoiseDisplacement',
    label: 'Noise Displacement (Perturb)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'amplitude', type: 'number', default: 1.0, min: 0, max: 20, step: 0.1 },
      { name: 'frequency', type: 'number', default: 0.2, min: 0.01, max: 5, step: 0.01 },
    ],
  },
  VoronoiPattern: {
    type: 'VoronoiPattern',
    label: 'Voronoi Pattern (Cells)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'width', type: 'number', default: 20, min: 2, max: 200, step: 1 },
      { name: 'height', type: 'number', default: 20, min: 2, max: 200, step: 1 },
      { name: 'cellCount', type: 'number', default: 12, min: 2, max: 100, step: 1 },
      { name: 'borderPadding', type: 'number', default: 0.4, min: 0.1, max: 5, step: 0.05 },
      { name: 'thickness', type: 'number', default: 1.0, min: 0.1, max: 20, step: 0.1 },
      { name: 'color', type: 'string', default: '#3b82f6' },
    ],
  },
  GyroidLattice: {
    type: 'GyroidLattice',
    label: 'Gyroid Lattice (TPMS)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'cellSize', type: 'number', default: 5, min: 1, max: 50, step: 0.5 },
      { name: 'periodsX', type: 'number', default: 2, min: 1, max: 10, step: 1 },
      { name: 'periodsY', type: 'number', default: 2, min: 1, max: 10, step: 1 },
      { name: 'periodsZ', type: 'number', default: 2, min: 1, max: 10, step: 1 },
      { name: 'wallThickness', type: 'number', default: 0.4, min: 0.1, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#6366f1' },
    ],
  },
  DiamondLattice: {
    type: 'DiamondLattice',
    label: 'Diamond Lattice (TPMS)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'cellSize', type: 'number', default: 6, min: 1, max: 50, step: 0.5 },
      { name: 'periodsX', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'periodsY', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'periodsZ', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'wallThickness', type: 'number', default: 0.4, min: 0.1, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#8b5cf6' },
    ],
  },
  SchwarzPLattice: {
    type: 'SchwarzPLattice',
    label: 'Schwarz-P Lattice (TPMS)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'cellSize', type: 'number', default: 6, min: 1, max: 50, step: 0.5 },
      { name: 'periodsX', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'periodsY', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'periodsZ', type: 'number', default: 2, min: 1, max: 8, step: 1 },
      { name: 'wallThickness', type: 'number', default: 0.5, min: 0.1, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#d946ef' },
    ],
  },
  DelaunayTriangulation: {
    type: 'DelaunayTriangulation',
    label: 'Delaunay Network (Truss/Mesh)',
    category: 'geometry',
    inputs: [{ name: 'points', type: 'Point[]' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'strutRadius', type: 'number', default: 0.1, min: 0.02, max: 2, step: 0.01 },
      { name: 'color', type: 'string', default: '#0ea5e9' },
    ],
  },
  WaveField: {
    type: 'WaveField',
    label: 'Wave Field (Deform)',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'frequencyX', type: 'number', default: 0.2, min: 0.01, max: 5, step: 0.01 },
      { name: 'amplitude', type: 'number', default: 1.0, min: 0, max: 10, step: 0.1 },
    ],
  },
  CurveMorph: {
    type: 'CurveMorph',
    label: 'Curve Morph (Interpolate)',
    category: 'geometry',
    inputs: [
      { name: 'curve1', type: 'Curve' },
      { name: 'curve2', type: 'Curve' },
    ],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'factor', type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
    ],
  },
  ReactionDiffusion: {
    type: 'ReactionDiffusion',
    label: 'Reaction-Diffusion (Turing)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'gridSize', type: 'number', default: 20, min: 5, max: 50, step: 1 },
      { name: 'spotRadius', type: 'number', default: 0.6, min: 0.1, max: 5, step: 0.05 },
      { name: 'color', type: 'string', default: '#10b981' },
    ],
  },
  CellularAutomata: {
    type: 'CellularAutomata',
    label: 'Cellular Automata (Growth)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'gridSize', type: 'number', default: 8, min: 4, max: 20, step: 1 },
      { name: 'cellSize', type: 'number', default: 1.5, min: 0.5, max: 10, step: 0.1 },
      { name: 'color', type: 'string', default: '#f59e0b' },
    ],
  },
  DifferentialGrowth: {
    type: 'DifferentialGrowth',
    label: 'Differential Growth (Curve)',
    category: 'geometry',
    inputs: [],
    outputs: [{ name: 'curve', type: 'Curve' }],
    params: [
      { name: 'initialRadius', type: 'number', default: 6, min: 1, max: 50, step: 0.5 },
      { name: 'steps', type: 'number', default: 36, min: 10, max: 100, step: 2 },
      { name: 'tubeRadius', type: 'number', default: 0.25, min: 0.05, max: 2, step: 0.05 },
      { name: 'color', type: 'string', default: '#14b8a6' },
    ],
  },
  RadialSymmetryCluster: {
    type: 'RadialSymmetryCluster',
    label: 'Radial Symmetry Cluster',
    category: 'transform',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 6, min: 2, max: 64, step: 1 },
      { name: 'totalAngle', type: 'number', default: 360, min: 10, max: 360, step: 5 },
    ],
  },

  // --- Analysis Domain Nodes (10) ---
  MassProperties: {
    type: 'MassProperties',
    label: 'Mass Properties (Volume/COG)',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'volume', type: 'number' },
      { name: 'surfaceArea', type: 'number' },
      { name: 'centerOfMass', type: 'Point' },
    ],
    params: [],
  },
  CurvatureAnalysis: {
    type: 'CurvatureAnalysis',
    label: 'Curvature Analysis',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [
      { name: 'solid', type: 'Solid' },
      { name: 'meanCurvature', type: 'number' },
    ],
    params: [],
  },
  InterferenceCheck: {
    type: 'InterferenceCheck',
    label: 'Interference Check (Clash)',
    category: 'boolean',
    inputs: [
      { name: 'solid1', type: 'Solid' },
      { name: 'solid2', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [],
  },
  WallThicknessCheck: {
    type: 'WallThicknessCheck',
    label: 'Wall Thickness Check',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'minThreshold', type: 'number', default: 1.0, min: 0.1, max: 20, step: 0.1 },
    ],
  },
  OverhangAnalysis: {
    type: 'OverhangAnalysis',
    label: 'Overhang Analysis (3D Print)',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'thresholdAngle', type: 'number', default: 45, min: 10, max: 80, step: 1 },
    ],
  },
  DraftAngleAnalysis: {
    type: 'DraftAngleAnalysis',
    label: 'Draft Angle Analysis (Molding)',
    category: 'math',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'requiredAngle', type: 'number', default: 2.0, min: 0.5, max: 10, step: 0.5 },
    ],
  },
  BoundingBoxOriented: {
    type: 'BoundingBoxOriented',
    label: 'Bounding Box Oriented (OBB)',
    category: 'geometry',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'color', type: 'string', default: '#94a3b8' },
    ],
  },
  CenterOfGravity: {
    type: 'CenterOfGravity',
    label: 'Center of Gravity (Point Marker)',
    category: 'geometry',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'color', type: 'string', default: '#ef4444' },
    ],
  },
  CrossSectionSlice: {
    type: 'CrossSectionSlice',
    label: 'Cross Section Slice (Array)',
    category: 'geometry',
    inputs: [{ name: 'solid', type: 'Solid' }],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'count', type: 'number', default: 5, min: 1, max: 50, step: 1 },
      { name: 'startOffset', type: 'number', default: -10, min: -100, max: 100, step: 1 },
      { name: 'endOffset', type: 'number', default: 10, min: -100, max: 100, step: 1 },
      { name: 'color', type: 'string', default: '#38bdf8' },
    ],
  },
  GeometryDiff: {
    type: 'GeometryDiff',
    label: 'Geometry Diff (Revision Compare)',
    category: 'boolean',
    inputs: [
      { name: 'solid1', type: 'Solid' },
      { name: 'solid2', type: 'Solid' },
    ],
    outputs: [{ name: 'solid', type: 'Solid' }],
    params: [
      { name: 'color', type: 'string', default: '#f97316' },
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
