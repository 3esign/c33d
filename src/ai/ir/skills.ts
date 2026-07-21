// ---------------------------------------------------------------------------
// SKILL REGISTRY — the IR's vocabulary.
//
// Each skill is a named geometric constructor (Grasshopper-style overload:
// line(a,b) vs line_sdl(start,direction,length)) with a typed signature and a
// deterministic expansion into NODE_LIBRARY nodes. Skills NEVER invent kernel
// capability — they package existing nodes under intent-named signatures, and
// they encode known engine corrections structurally (e.g. `ring` compiles to
// Torus, so a closed-circle Pipe kernel fault is unreachable from the IR).
//
// Adding a skill = adding an entry here. The prompt catalog (skillCatalogText)
// and the decoding schema (schema.ts) are generated from this registry, so the
// model's vocabulary, the validator, and the compiler cannot drift apart.
// ---------------------------------------------------------------------------

import type { ExpandCtx, SkillDef, ValueRef } from './types';

const solid = (ctx: ExpandCtx, id: string): ValueRef => ctx.out(id, 'solid', 'solid');

// -- small shared expansions -------------------------------------------------

/** Point at origin (used when a skill's center/normal args are omitted). */
function originPoint(ctx: ExpandCtx): ValueRef {
  const id = ctx.node('Point', { params: { x: 0, y: 0, z: 0 } });
  return ctx.out(id, 'point', 'point');
}
function zUpVector(ctx: ExpandCtx): ValueRef {
  const id = ctx.node('VectorXYZ', { params: { x: 0, y: 0, z: 1 } });
  return ctx.out(id, 'vector', 'vector');
}

/** Wrap an inline numeric/formula (or data literal) into a number[]-producing node. */
function literalList(ctx: ExpandCtx, entries: (number | string)[]): ValueRef {
  const id = ctx.node('ListConstant', { params: { values: entries.join(', ') } });
  return ctx.out(id, 'values', 'number[]');
}

/** number[] arg → ValueRef, materializing literals as ListConstant. */
function listRef(ctx: ExpandCtx, name: string): ValueRef | undefined {
  const v = ctx.list(name);
  if (!v) return undefined;
  if (v.ref) return v.ref;
  return literalList(ctx, v.literal || []);
}

const NUM = { kind: 'num' as const };
const NUMR = { kind: 'num' as const, required: true };
const LIST = { kind: 'num[]' as const };
const LISTR = { kind: 'num[]' as const, required: true };

// -----------------------------------------------------------------------------
export const SKILLS: Record<string, SkillDef> = {
  // ---------------- data / lists ----------------
  list: {
    name: 'list',
    doc: 'constant data list; entries may be numbers or slider formulas — the substrate for data-driven design',
    args: { values: LISTR },
    returns: 'number[]',
    expand: (ctx) => {
      const v = ctx.list('values')!;
      if (v.ref) ctx.fail('list(values) expects a data literal like [0.39, 0.72, 1.0], not a reference — reference the original binding directly instead.');
      return literalList(ctx, v.literal || []);
    },
  },
  series: {
    name: 'series',
    doc: 'arithmetic sequence: start, start+step, … (count items)',
    args: { start: NUM, step: NUM, count: NUM },
    returns: 'number[]',
    expand: (ctx) => {
      const id = ctx.node('Series', {
        params: { start: ctx.numOpt('start') ?? 0, step: ctx.numOpt('step') ?? 1, count: ctx.numOpt('count') ?? 5 },
      });
      return ctx.out(id, 'values', 'number[]');
    },
  },
  range: {
    name: 'range',
    doc: 'evenly spaced numbers from min to max (steps+1 items)',
    args: { min: NUM, max: NUM, steps: NUM },
    returns: 'number[]',
    expand: (ctx) => {
      const id = ctx.node('Range', {
        params: { min: ctx.numOpt('min') ?? 0, max: ctx.numOpt('max') ?? 10, steps: ctx.numOpt('steps') ?? 5 },
      });
      return ctx.out(id, 'values', 'number[]');
    },
  },
  remap: {
    name: 'remap',
    doc: 'linearly remap a list from [inMin..inMax] to [outMin..outMax] — proportional scaling of real-world data',
    args: {
      values: LISTR,
      inMin: { ...NUMR, doc: 'inline number/formula' },
      inMax: NUMR,
      outMin: NUMR,
      outMax: NUMR,
    },
    returns: 'number[]',
    expand: (ctx) => {
      const values = listRef(ctx, 'values')!;
      const [i0, i1, o0, o1] = ['inMin', 'inMax', 'outMin', 'outMax'].map(n => ctx.inlineNum(n));
      // Expression broadcasts element-wise over list inputs; slider labels
      // resolve inside Expression formulas (unified namespace).
      const formula = `(a - (${i0})) / ((${i1}) - (${i0})) * ((${o1}) - (${o0})) + (${o0})`;
      const id = ctx.node('Expression', { params: { formula }, inputs: { a: values } });
      return ctx.out(id, 'value', 'number[]');
    },
  },
  expr: {
    name: 'expr',
    doc: 'math over numbers/lists: formula of a,b,c,d and slider names; broadcasts element-wise over lists',
    args: {
      formula: { kind: 'string', required: true },
      a: LIST, b: LIST, c: LIST, d: LIST,
    },
    returns: 'number[]',
    expand: (ctx) => {
      const formula = ctx.str('formula');
      if (!formula) ctx.fail('expr requires a formula string, e.g. "a*cos(b)".');
      const inputs: Record<string, ValueRef | undefined> = {};
      for (const v of ['a', 'b', 'c', 'd']) inputs[v] = listRef(ctx, v);
      const id = ctx.node('Expression', { params: { formula }, inputs });
      return ctx.out(id, 'value', 'number[]');
    },
  },
  item: {
    name: 'item',
    doc: 'pick one element of a number list by index',
    args: { list: LISTR, index: NUM },
    returns: 'number',
    expand: (ctx) => {
      const id = ctx.node('ListItem', {
        params: { index: ctx.numOpt('index') ?? 0 },
        inputs: { list: listRef(ctx, 'list') },
      });
      return ctx.out(id, 'value', 'number');
    },
  },
  repeat_each: {
    name: 'repeat_each',
    doc: 'repeat every element count times: [a,b]×3 → [a,a,a,b,b,b] — pairs with tile() for cross products (for-each-X-for-each-Y)',
    args: { values: LISTR, count: NUMR },
    returns: 'number[]',
    expand: (ctx) => {
      const id = ctx.node('RepeatEach', {
        params: { count: ctx.num('count') },
        inputs: { list: listRef(ctx, 'values') },
      });
      return ctx.out(id, 'values', 'number[]');
    },
  },
  tile: {
    name: 'tile',
    doc: 'repeat the whole list count times: [a,b]×3 → [a,b,a,b,a,b] — pairs with repeat_each() for cross products',
    args: { values: LISTR, count: NUMR },
    returns: 'number[]',
    expand: (ctx) => {
      const id = ctx.node('Tile', {
        params: { count: ctx.num('count') },
        inputs: { list: listRef(ctx, 'values') },
      });
      return ctx.out(id, 'values', 'number[]');
    },
  },

  // ---------------- skeleton: points / vectors ----------------
  point: {
    name: 'point',
    doc: 'construction point at (x, y, z)',
    args: { x: NUM, y: NUM, z: NUM },
    returns: 'point',
    expand: (ctx) => {
      const id = ctx.node('Point', {
        params: { x: ctx.numOpt('x') ?? 0, y: ctx.numOpt('y') ?? 0, z: ctx.numOpt('z') ?? 0 },
      });
      return ctx.out(id, 'point', 'point');
    },
  },
  vector: {
    name: 'vector',
    doc: 'direction vector (x, y, z)',
    args: { x: NUM, y: NUM, z: NUM },
    returns: 'vector',
    expand: (ctx) => {
      const id = ctx.node('VectorXYZ', {
        params: { x: ctx.numOpt('x') ?? 0, y: ctx.numOpt('y') ?? 0, z: ctx.numOpt('z') ?? 0 },
      });
      return ctx.out(id, 'vector', 'vector');
    },
  },
  midpoint: {
    name: 'midpoint',
    doc: 'point halfway between two points',
    args: { a: { kind: 'point', required: true }, b: { kind: 'point', required: true } },
    returns: 'point',
    expand: (ctx) => {
      const id = ctx.node('Midpoint', { inputs: { a: ctx.ref('a', 'point'), b: ctx.ref('b', 'point') } });
      return ctx.out(id, 'midpoint', 'point');
    },
  },
  points: {
    name: 'points',
    doc: 'point list from number lists (x, y, z broadcast); "scale" channel = exact per-instance sizes in instances(); "group" channel = one curve per group in spline()',
    args: { x: LIST, y: LIST, z: LIST, scale: LIST, group: LIST },
    returns: 'point[]',
    expand: (ctx) => {
      const inputs: Record<string, ValueRef | undefined> = {};
      for (const v of ['x', 'y', 'z', 'scale', 'group']) inputs[v] = listRef(ctx, v);
      if (!inputs.x && !inputs.y && !inputs.z && !inputs.scale) {
        ctx.fail('points() needs at least one of x, y, z, scale (a list binding or data literal).');
      }
      const id = ctx.node('PointsFromLists', { inputs });
      return ctx.out(id, 'points', 'point[]');
    },
  },
  on_circle: {
    name: 'on_circle',
    doc: 'points on circle(s): radius may be a LIST (one ring of `count` points per radius, cross product built in); optional per-circle z and scale lists; points carry a per-circle group channel',
    args: {
      radius: LISTR,
      count: { ...NUMR, doc: 'points per circle — inline number/formula' },
      z: LIST,
      scale: LIST,
      startAngle: NUM,
    },
    returns: 'point[]',
    expand: (ctx) => {
      const radii = listRef(ctx, 'radius')!;
      const count = ctx.inlineNum('count');
      const start = ctx.inlineNumOpt('startAngle') ?? 0;
      // Cross product: repeat each radius `count` times; tile the angle list
      // once per radius (Tile.count driven by ListLength — works for any list).
      const lenR = ctx.node('ListLength', { inputs: { list: radii } });
      const repR = ctx.node('RepeatEach', { params: { count }, inputs: { list: radii } });
      const angles = ctx.node('Series', {
        params: { start, step: `2*pi/(${count})`, count },
      });
      const tiledA = ctx.node('Tile', {
        params: { count: { ref: ctx.out(lenR, 'length', 'number') } },
        inputs: { list: ctx.out(angles, 'values', 'number[]') },
      });
      const repRRef = ctx.out(repR, 'values', 'number[]');
      const tiledARef = ctx.out(tiledA, 'values', 'number[]');
      const px = ctx.node('Expression', { params: { formula: 'a*cos(b)' }, inputs: { a: repRRef, b: tiledARef } });
      const py = ctx.node('Expression', { params: { formula: 'a*sin(b)' }, inputs: { a: repRRef, b: tiledARef } });
      const zList = listRef(ctx, 'z');
      const sList = listRef(ctx, 'scale');
      const repList = (src: ValueRef | undefined) => {
        if (!src) return undefined;
        const n = ctx.node('RepeatEach', { params: { count }, inputs: { list: src } });
        return ctx.out(n, 'values', 'number[]');
      };
      const id = ctx.node('PointsFromLists', {
        inputs: {
          x: ctx.out(px, 'value', 'number[]'),
          y: ctx.out(py, 'value', 'number[]'),
          z: repList(zList),
          scale: repList(sList),
          group: repRRef, // equal radius ⇒ same circle ⇒ same group
        },
      });
      return ctx.out(id, 'points', 'point[]');
    },
  },
  grid: {
    name: 'grid',
    doc: 'rectangular XY grid of points',
    args: { countX: NUM, countY: NUM, spacingX: NUM, spacingY: NUM },
    returns: 'point[]',
    expand: (ctx) => {
      const id = ctx.node('PointGrid', {
        params: {
          countX: ctx.numOpt('countX') ?? 5, countY: ctx.numOpt('countY') ?? 5,
          spacingX: ctx.numOpt('spacingX') ?? 2, spacingY: ctx.numOpt('spacingY') ?? 2,
        },
      });
      return ctx.out(id, 'points', 'point[]');
    },
  },
  jitter: {
    name: 'jitter',
    doc: 'randomly displace a point list (seeded)',
    args: { points: { kind: 'point[]', required: true }, amount: NUM, seed: NUM },
    returns: 'point[]',
    expand: (ctx) => {
      const id = ctx.node('Jitter', {
        params: { amount: ctx.numOpt('amount') ?? 0.5, seed: ctx.numOpt('seed') ?? 42 },
        inputs: { points: ctx.ref('points', 'point[]', 'point') },
      });
      return ctx.out(id, 'points', 'point[]');
    },
  },

  // ---------------- curves ----------------
  line: {
    name: 'line',
    doc: 'line through two points',
    args: { a: { kind: 'point', required: true }, b: { kind: 'point', required: true } },
    returns: 'curve',
    expand: (ctx) => {
      const id = ctx.node('Line', { inputs: { a: ctx.ref('a', 'point'), b: ctx.ref('b', 'point') } });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  line_sdl: {
    name: 'line_sdl',
    doc: 'line from start point along a direction for a given length (start-direction-length)',
    args: {
      start: { kind: 'point', required: true },
      direction: { kind: 'vector', required: true },
      length: NUMR,
    },
    returns: 'curve',
    expand: (ctx) => {
      const start = ctx.ref('start', 'point');
      const dir = ctx.ref('direction', 'vector');
      const norm = ctx.node('VectorMath', { params: { operation: 'normalize' }, inputs: { a: dir } });
      const scaled = ctx.node('VectorMath', {
        params: { operation: 'scale', factor: ctx.num('length') },
        inputs: { a: ctx.out(norm, 'vector', 'vector') },
      });
      const sp = ctx.node('DeconstructPoint', { inputs: { point: start } });
      const sv = ctx.node('DeconstructVector', { inputs: { vector: ctx.out(scaled, 'vector', 'vector') } });
      const sum = (axis: 'x' | 'y' | 'z') => {
        const e = ctx.node('Expression', {
          params: { formula: 'a + b' },
          inputs: { a: ctx.out(sp, axis, 'number'), b: ctx.out(sv, axis, 'number') },
        });
        return ctx.out(e, 'value', 'number');
      };
      const end = ctx.node('Point', { inputs: { x: sum('x'), y: sum('y'), z: sum('z') } });
      const id = ctx.node('Line', { inputs: { a: start, b: ctx.out(end, 'point', 'point') } });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  circle: {
    name: 'circle',
    doc: 'circle by center, normal and radius (center/normal default to origin, Z-up)',
    args: { center: { kind: 'point' }, normal: { kind: 'vector' }, radius: NUMR },
    returns: 'curve',
    expand: (ctx) => {
      const center = ctx.refOpt('center', 'point') ?? originPoint(ctx);
      const normal = ctx.refOpt('normal', 'vector') ?? zUpVector(ctx);
      const id = ctx.node('CircleCurve', {
        params: { radius: ctx.num('radius') },
        inputs: { center, normal },
      });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  ellipse: {
    name: 'ellipse',
    doc: 'ellipse by center, normal and two radii',
    args: { center: { kind: 'point' }, normal: { kind: 'vector' }, radiusX: NUMR, radiusY: NUMR },
    returns: 'curve',
    expand: (ctx) => {
      const center = ctx.refOpt('center', 'point') ?? originPoint(ctx);
      const normal = ctx.refOpt('normal', 'vector') ?? zUpVector(ctx);
      const id = ctx.node('EllipseCurve', {
        params: { radiusX: ctx.num('radiusX'), radiusY: ctx.num('radiusY') },
        inputs: { center, normal },
      });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  arc: {
    name: 'arc',
    doc: 'arc through three points (start, mid, end)',
    args: {
      start: { kind: 'point', required: true },
      mid: { kind: 'point', required: true },
      end: { kind: 'point', required: true },
    },
    returns: 'curve',
    expand: (ctx) => {
      const id = ctx.node('Arc', {
        inputs: { start: ctx.ref('start', 'point'), middle: ctx.ref('mid', 'point'), end: ctx.ref('end', 'point') },
      });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  polyline: {
    name: 'polyline',
    doc: 'polyline through points; groupBy ("row"/"group"/"wireIndex") makes one polyline per point set',
    args: {
      points: { kind: 'point[]', required: true },
      closed: { kind: 'bool' },
      groupBy: { kind: 'string' },
    },
    returns: 'curve',
    expand: (ctx) => {
      const id = ctx.node('PolylineCurve', {
        params: { closed: ctx.bool('closed') ?? false, groupBy: ctx.str('groupBy') },
        inputs: { points: ctx.ref('points', 'point[]', 'point') },
      });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  spline: {
    name: 'spline',
    doc: 'interpolate smooth curve(s) through points; groupBy ("row"/"group"/"wireIndex") interpolates ONE CURVE PER POINT SET — feed the result to loft() for surfaces/curtains',
    args: {
      points: { kind: 'point[]', required: true },
      closed: { kind: 'bool' },
      groupBy: { kind: 'string' },
    },
    returns: 'curve',
    expand: (ctx) => {
      const id = ctx.node('SplineCurve', {
        params: { closed: ctx.bool('closed') ?? false, groupBy: ctx.str('groupBy') },
        inputs: { points: ctx.ref('points', 'point[]', 'point') },
      });
      return ctx.out(id, 'curve', 'curve');
    },
  },
  divide: {
    name: 'divide',
    doc: 'divide a curve into N points (carries t/index/tangent channels for instances())',
    args: { curve: { kind: 'curve', required: true }, count: NUMR },
    returns: 'point[]',
    expand: (ctx) => {
      const id = ctx.node('DivideCurve', {
        params: { count: ctx.num('count') },
        inputs: { curve: ctx.ref('curve', 'curve') },
      });
      return ctx.out(id, 'points', 'point[]');
    },
  },

  // ---------------- solids: primitives ----------------
  // S2 (Jul-20): primitives take an optional "center" Point (and, for the
  // rotational ones, an "axis" Vector) — placement/orientation DERIVED from
  // geometry instead of a translate()/rotate() chain with typed coordinates.
  box: {
    name: 'box',
    doc: 'box primitive (width, length, height); optional center point places it directly',
    args: { width: NUMR, length: NUMR, height: NUMR, center: { kind: 'point' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Box', {
      params: { width: ctx.num('width'), length: ctx.num('length'), height: ctx.num('height') },
      inputs: { center: ctx.refOpt('center', 'point') },
    })),
  },
  sphere: {
    name: 'sphere',
    doc: 'sphere primitive; optional center point places it directly (no translate needed)',
    args: { radius: NUMR, center: { kind: 'point' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Sphere', {
      params: { radius: ctx.num('radius') },
      inputs: { center: ctx.refOpt('center', 'point') },
    })),
  },
  cylinder: {
    name: 'cylinder',
    doc: 'cylinder primitive; optional center point + axis vector place and tilt it (axis replaces rotate-90)',
    args: { radius: NUMR, height: NUMR, center: { kind: 'point' }, axis: { kind: 'vector' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Cylinder', {
      params: { radius: ctx.num('radius'), height: ctx.num('height') },
      inputs: { center: ctx.refOpt('center', 'point'), axis: ctx.refOpt('axis', 'vector') },
    })),
  },
  cone: {
    name: 'cone',
    doc: 'cone/frustum primitive (radius1 bottom, radius2 top); optional center point + axis vector place and tilt it',
    args: { radius1: NUMR, radius2: NUM, height: NUMR, center: { kind: 'point' }, axis: { kind: 'vector' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Cone', {
      params: { radius1: ctx.num('radius1'), radius2: ctx.numOpt('radius2') ?? 0, height: ctx.num('height') },
      inputs: { center: ctx.refOpt('center', 'point'), axis: ctx.refOpt('axis', 'vector') },
    })),
  },
  torus: {
    name: 'torus',
    doc: 'torus primitive (majorRadius ring size, minorRadius tube thickness); optional center point + axis vector place and tilt it',
    args: { majorRadius: NUMR, minorRadius: NUMR, center: { kind: 'point' }, axis: { kind: 'vector' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Torus', {
      params: { majorRadius: ctx.num('majorRadius'), minorRadius: ctx.num('minorRadius') },
      inputs: { center: ctx.refOpt('center', 'point'), axis: ctx.refOpt('axis', 'vector') },
    })),
  },
  ring: {
    name: 'ring',
    doc: 'ring / orbit / pipe-around-a-circle: ALWAYS use this instead of pipe() on a closed circle (kernel-safe: compiles to Torus)',
    args: { radius: NUMR, thickness: NUMR },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Torus', {
      params: { majorRadius: ctx.num('radius'), minorRadius: ctx.num('thickness') },
    })),
  },

  // ---------------- solids: from curves ----------------
  extrude: {
    name: 'extrude',
    doc: 'extrude a closed curve into a solid',
    args: { curve: { kind: 'curve', required: true }, height: NUMR },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('ExtrudeCurve', {
      params: { height: ctx.num('height') },
      inputs: { curve: ctx.ref('curve', 'curve') },
    })),
  },
  loft: {
    name: 'loft',
    doc: 'loft a solid/surface through section curves in order — either curve1..curve4, or ONE grouped multi-curve (spline with groupBy) on curve1',
    args: {
      curve1: { kind: 'curve', required: true },
      curve2: { kind: 'curve' },
      curve3: { kind: 'curve' },
      curve4: { kind: 'curve' },
      ruled: { kind: 'bool' },
      closed: { kind: 'bool' },
    },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('LoftCurves', {
      params: { ruled: ctx.bool('ruled') ?? false, closed: ctx.bool('closed') ?? false },
      inputs: {
        curve1: ctx.ref('curve1', 'curve'),
        curve2: ctx.refOpt('curve2', 'curve'),
        curve3: ctx.refOpt('curve3', 'curve'),
        curve4: ctx.refOpt('curve4', 'curve'),
      },
    })),
  },
  sweep: {
    name: 'sweep',
    doc: 'sweep a profile solid/face along a rail curve',
    args: { rail: { kind: 'curve', required: true }, profile: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('SweepAlongCurve', {
      inputs: { rail: ctx.ref('rail', 'curve'), profile: ctx.ref('profile', 'solid') },
    })),
  },
  pipe: {
    name: 'pipe',
    doc: 'tube of given radius along an OPEN curve; for closed circles use ring()',
    args: { path: { kind: 'curve', required: true }, radius: NUMR },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Pipe', {
      params: { radius: ctx.num('radius') },
      inputs: { path: ctx.ref('path', 'curve') },
    })),
  },
  revolve: {
    name: 'revolve',
    doc: 'revolve a profile curve around an axis (default Z, 360°)',
    args: { profile: { kind: 'curve', required: true }, angle: NUM, axis: { kind: 'string' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('RevolveCurve', {
      params: { angle: ctx.numOpt('angle') ?? 360, axis: ctx.str('axis') ?? 'Z' },
      inputs: { profile: ctx.ref('profile', 'curve') },
    })),
  },

  // ---------------- transforms / replication ----------------
  translate: {
    name: 'translate',
    doc: 'move a solid by (x, y, z)',
    args: { shape: { kind: 'solid', required: true }, x: NUM, y: NUM, z: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Translate', {
      params: { x: ctx.numOpt('x') ?? 0, y: ctx.numOpt('y') ?? 0, z: ctx.numOpt('z') ?? 0 },
      inputs: { solid: ctx.ref('shape', 'solid') },
    })),
  },
  move_to: {
    name: 'move_to',
    doc: 'move a solid so it sits at a target point',
    args: { shape: { kind: 'solid', required: true }, target: { kind: 'point', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Translate', {
      inputs: { solid: ctx.ref('shape', 'solid'), target: ctx.ref('target', 'point') },
    })),
  },
  rotate: {
    name: 'rotate',
    doc: 'rotate a solid around an axis (degrees); optional pivot point sets the rotation centre (hinges, joints, petal roots)',
    args: { shape: { kind: 'solid', required: true }, angle: NUMR, axisX: NUM, axisY: NUM, axisZ: NUM, pivot: { kind: 'point' } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Rotate', {
      params: {
        angle: ctx.num('angle'),
        axisX: ctx.numOpt('axisX') ?? 0, axisY: ctx.numOpt('axisY') ?? 0, axisZ: ctx.numOpt('axisZ') ?? 1,
      },
      inputs: { solid: ctx.ref('shape', 'solid'), pivot: ctx.refOpt('pivot', 'point') },
    })),
  },
  scale: {
    name: 'scale',
    doc: 'uniformly scale a solid',
    args: { shape: { kind: 'solid', required: true }, factor: NUMR },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Scale', {
      params: { factor: ctx.num('factor') },
      inputs: { solid: ctx.ref('shape', 'solid') },
    })),
  },
  instances: {
    name: 'instances',
    doc: 'copy ONE source solid onto every point of a point list; per-point scale channel (from points()) gives exact sizes, else scaleStart→scaleEnd ramp',
    args: {
      shape: { kind: 'solid', required: true },
      points: { kind: 'point[]', required: true },
      scaleStart: NUM, scaleEnd: NUM,
      alignToTangent: { kind: 'bool' },
      maxCount: NUM,
    },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('InstanceOnPoints', {
      params: {
        scaleStart: ctx.numOpt('scaleStart') ?? 1,
        scaleEnd: ctx.numOpt('scaleEnd') ?? 1,
        alignToTangent: ctx.bool('alignToTangent') ?? false,
        maxCount: ctx.numOpt('maxCount'),
      },
      inputs: { shape: ctx.ref('shape', 'solid'), points: ctx.ref('points', 'point[]', 'point') },
    })),
  },
  linear_pattern: {
    name: 'linear_pattern',
    doc: 'repeat a solid N times along a direction',
    args: { shape: { kind: 'solid', required: true }, count: NUMR, directionX: NUM, directionY: NUM, directionZ: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('LinearPattern', {
      params: {
        count: ctx.num('count'),
        directionX: ctx.numOpt('directionX') ?? 0, directionY: ctx.numOpt('directionY') ?? 0, directionZ: ctx.numOpt('directionZ') ?? 0,
      },
      inputs: { solid: ctx.ref('shape', 'solid') },
    })),
  },
  circular_pattern: {
    name: 'circular_pattern',
    doc: 'repeat a solid around a circle (count, radius; optional rise and scale ramp)',
    args: {
      shape: { kind: 'solid', required: true }, count: NUMR, radius: NUMR,
      angle: NUM, startAngle: NUM, rise: NUM, scaleStart: NUM, scaleEnd: NUM,
    },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('CircularPattern', {
      params: {
        count: ctx.num('count'), radius: ctx.num('radius'),
        angle: ctx.numOpt('angle'), startAngle: ctx.numOpt('startAngle'),
        rise: ctx.numOpt('rise'), scaleStart: ctx.numOpt('scaleStart'), scaleEnd: ctx.numOpt('scaleEnd'),
      },
      inputs: { solid: ctx.ref('shape', 'solid') },
    })),
  },

  // ---------------- booleans / combine ----------------
  union: {
    name: 'union',
    doc: 'fuse two solids',
    args: { a: { kind: 'solid', required: true }, b: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Boolean', {
      params: { operation: 'union' },
      inputs: { target: ctx.ref('a', 'solid'), tool: ctx.ref('b', 'solid') },
    })),
  },
  difference: {
    name: 'difference',
    doc: 'subtract solid b from solid a',
    args: { a: { kind: 'solid', required: true }, b: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Boolean', {
      params: { operation: 'difference' },
      inputs: { target: ctx.ref('a', 'solid'), tool: ctx.ref('b', 'solid') },
    })),
  },
  intersect: {
    name: 'intersect',
    doc: 'keep only the overlap of two solids',
    args: { a: { kind: 'solid', required: true }, b: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Boolean', {
      params: { operation: 'intersect' },
      inputs: { target: ctx.ref('a', 'solid'), tool: ctx.ref('b', 'solid') },
    })),
  },
  compound: {
    name: 'compound',
    doc: 'group up to 4 solids into one (no fusing)',
    args: {
      a: { kind: 'solid', required: true }, b: { kind: 'solid', required: true },
      c: { kind: 'solid' }, d: { kind: 'solid' },
    },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Compound', {
      inputs: {
        solid1: ctx.ref('a', 'solid'), solid2: ctx.ref('b', 'solid'),
        solid3: ctx.refOpt('c', 'solid'), solid4: ctx.refOpt('d', 'solid'),
      },
    })),
  },
};

/** Alias table: natural-language-adjacent names → canonical skill. */
export const SKILL_ALIASES: Record<string, string> = {
  line_2pt: 'line',
  circle_cnr: 'circle',
  arc_3pt: 'arc',
  points_from_lists: 'points',
  polar_points: 'on_circle',
  orbit: 'ring',
  instance_on_points: 'instances',
  subtract: 'difference',
  fuse: 'union',
};

export function resolveSkill(op: string): SkillDef | undefined {
  return SKILLS[op] ?? SKILLS[SKILL_ALIASES[op]];
}

/** Compact catalog for the system prompt / few-shot context. */
export function skillCatalogText(): string {
  const lines: string[] = [];
  for (const s of Object.values(SKILLS)) {
    const sig = Object.entries(s.args)
      .map(([n, a]) => (a.required ? n : `${n}?`))
      .join(', ');
    lines.push(`${s.name}(${sig}) -> ${s.returns} — ${s.doc}`);
  }
  return lines.join('\n');
}
