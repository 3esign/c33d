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
  // ListConstant parses its `values` param by splitting on commas — an entry
  // that itself contains a comma ("min(a, b)", "1,5") would be silently split
  // into corrupt fragments. Refuse with a repairable message instead.
  const bad = entries.find(e => typeof e === 'string' && e.includes(','));
  if (bad !== undefined) {
    ctx.fail(`Data-list entries must not contain commas (got ${JSON.stringify(bad)}) — the list is stored comma-separated, so an embedded comma would corrupt it. Use separate constant entries (one number/formula per entry), and comma-free formulas; precompute anything needing min(a,b)-style calls with an expr() step and reference it.`);
  }
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
    prefer: 'point → rect → extrude',
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
    prefer: 'point → arc → revolve or ellipsoid',
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
    prefer: 'point → circle → extrude',
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
    prefer: 'points → circle1 + circle2 → loft',
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
    doc: 'loft a solid/surface through section curves in order — either curve1..curve6, or ONE grouped multi-curve (spline with groupBy) on curve1',
    args: {
      curve1: { kind: 'curve', required: true },
      curve2: { kind: 'curve' },
      curve3: { kind: 'curve' },
      curve4: { kind: 'curve' },
      curve5: { kind: 'curve' },
      curve6: { kind: 'curve' },
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
        // The LoftCurves node declares six section sockets — capping the IR at
        // four made 5/6-rail lofts impossible from the very layer that
        // recommends rail-loft construction.
        curve5: ctx.refOpt('curve5', 'curve'),
        curve6: ctx.refOpt('curve6', 'curve'),
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
    doc: 'repeat a solid N times along a direction (default +X spacing 15)',
    args: { shape: { kind: 'solid', required: true }, count: NUMR, directionX: NUM, directionY: NUM, directionZ: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('LinearPattern', {
      params: {
        count: ctx.num('count'),
        // Omitted direction defaults to the node definition's (15, 0, 0); an
        // EXPLICIT 0 stays 0 (the executor no longer "defaults" zeros away).
        // Compiling omitted axes to all-zero left the pattern degenerate the
        // moment the executor's `|| 15` crutch was removed.
        directionX: ctx.numOpt('directionX') ?? 15, directionY: ctx.numOpt('directionY') ?? 0, directionZ: ctx.numOpt('directionZ') ?? 0,
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
    doc: 'fuse solids into one watertight solid — two (a, b) or any number (parts: [...])',
    args: {
      a: { kind: 'solid' }, b: { kind: 'solid' },
      parts: { kind: 'solid', doc: 'list of solids to fuse — any length' },
    },
    returns: 'solid',
    expand: (ctx) => {
      // N-ary fuse folds left through the binary Boolean node. Unlike compound
      // this must stay a CHAIN (each fuse feeds the next), so it cannot use the
      // 8-socket tree — fusing is a real kernel operation, not a grouping.
      const listed = ctx.refList('parts', 'solid') ?? [];
      const named = [ctx.refOpt('a', 'solid'), ctx.refOpt('b', 'solid')]
        .filter((r): r is NonNullable<typeof r> => !!r);
      const all = [...listed, ...named];
      if (all.length >= 2) {
        let acc = all[0];
        for (let i = 1; i < all.length; i++) {
          acc = ctx.out(ctx.node('Boolean', {
            params: { operation: 'union' },
            inputs: { target: acc, tool: all[i] },
          }), 'solid', 'solid');
        }
        return acc;
      }
      return ctx.fail('union() needs at least two solids to fuse — pass a and b, or parts: ["$x","$y","$z"].');
    },
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
    doc: 'group ANY number of solids into one (no fusing) — parts: ["$a","$b","$c", ...]',
    args: {
      parts: { kind: 'solid', doc: 'list of solids to group — any length' },
      a: { kind: 'solid' }, b: { kind: 'solid' }, c: { kind: 'solid' }, d: { kind: 'solid' },
      e: { kind: 'solid' }, f: { kind: 'solid' }, g: { kind: 'solid' }, h: { kind: 'solid' },
    },
    returns: 'solid',
    expand: (ctx) => {
      // Jul-25: assembly used to cap at 4 (a…d). Every object with more than
      // four components died on its LAST line — one audit transcript shows a
      // complete 73-step skeleton failing at `compound has no argument "e"`.
      // `parts` takes any length; a…h remain as sugar. The underlying Compound
      // node has always had 8 sockets, and combine() chains them beyond that.
      const listed = ctx.refList('parts', 'solid') ?? [];
      const named = (['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const)
        .map(k => ctx.refOpt(k, 'solid'))
        .filter((r): r is NonNullable<typeof r> => !!r);
      const all = [...listed, ...named];
      if (all.length === 0) {
        ctx.fail('compound() needs solids to group — pass parts: ["$roof", "$walls", "$floor"] (any length), or a/b/c/… for a few.');
      }
      return ctx.combine(all, 'solid');
    },
  },

  // --- Architectural Skills (12) ---
  multi_loft: {
    name: 'multi_loft',
    doc: 'loft across 2+ section curves (curve1..curve8 or curve list)',
    args: {
      curve1: { kind: 'curve' }, curve2: { kind: 'curve' }, curve3: { kind: 'curve' }, curve4: { kind: 'curve' },
      curve5: { kind: 'curve' }, curve6: { kind: 'curve' }, curve7: { kind: 'curve' }, curve8: { kind: 'curve' },
      ruled: { kind: 'bool' }, closed: { kind: 'bool' },
    },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('MultiLoft', {
      params: { ruled: ctx.bool('ruled') ?? false, closed: ctx.bool('closed') ?? false },
      inputs: {
        curve1: ctx.refOpt('curve1', 'curve'), curve2: ctx.refOpt('curve2', 'curve'),
        curve3: ctx.refOpt('curve3', 'curve'), curve4: ctx.refOpt('curve4', 'curve'),
        curve5: ctx.refOpt('curve5', 'curve'), curve6: ctx.refOpt('curve6', 'curve'),
        curve7: ctx.refOpt('curve7', 'curve'), curve8: ctx.refOpt('curve8', 'curve'),
      }
    }))
  },
  offset_curve: {
    name: 'offset_curve',
    doc: 'parallel inset or outset of a 2D planar curve',
    args: { curve: { kind: 'curve', required: true }, distance: NUMR },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('CurveOffset', {
      params: { distance: ctx.num('distance') },
      inputs: { curve: ctx.ref('curve', 'curve') }
    }), 'curve', 'curve')
  },
  regular_polygon: {
    name: 'regular_polygon',
    doc: 'N-gon wire (sides 3..32) with corner filleting and star ratio',
    args: { sides: NUM, radius: NUM, filletRadius: NUM, starRatio: NUM },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('RegularPolygon', {
      params: {
        sides: ctx.numOpt('sides') ?? 6,
        radius: ctx.numOpt('radius') ?? 10,
        filletRadius: ctx.numOpt('filletRadius') ?? 0,
        starRatio: ctx.numOpt('starRatio') ?? 1.0,
      }
    }), 'curve', 'curve')
  },
  floor_grid: {
    name: 'floor_grid',
    doc: 'multi-story architectural floor slabs and column grid',
    args: { width: NUM, length: NUM, floors: NUM, floorHeight: NUM, slabThickness: NUM, columnRadius: NUM, columnSpacing: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('FloorGrid', {
      params: {
        width: ctx.numOpt('width') ?? 30, length: ctx.numOpt('length') ?? 40,
        floors: ctx.numOpt('floors') ?? 4, floorHeight: ctx.numOpt('floorHeight') ?? 4,
        slabThickness: ctx.numOpt('slabThickness') ?? 0.4, columnRadius: ctx.numOpt('columnRadius') ?? 0.35,
        columnSpacing: ctx.numOpt('columnSpacing') ?? 8
      }
    }))
  },
  facade_divider: {
    name: 'facade_divider',
    doc: 'window mullion and curtain wall facade panel grid',
    args: { width: NUM, height: NUM, uPanels: NUM, vPanels: NUM, frameThickness: NUM, glassDepth: NUM, mullionWidth: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('FacadeDivider', {
      params: {
        width: ctx.numOpt('width') ?? 20, height: ctx.numOpt('height') ?? 12,
        uPanels: ctx.numOpt('uPanels') ?? 5, vPanels: ctx.numOpt('vPanels') ?? 3,
        frameThickness: ctx.numOpt('frameThickness') ?? 0.2, glassDepth: ctx.numOpt('glassDepth') ?? 0.05,
        mullionWidth: ctx.numOpt('mullionWidth') ?? 0.15
      }
    }))
  },
  stairs: {
    name: 'stairs',
    doc: 'parametric straight or spiral stair treads',
    args: { type: { kind: 'string' }, steps: NUM, width: NUM, totalHeight: NUM, treadDepth: NUM, innerRadius: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Stairs', {
      params: {
        type: ctx.str('type') ?? 'straight', steps: ctx.numOpt('steps') ?? 14,
        width: ctx.numOpt('width') ?? 1.2, totalHeight: ctx.numOpt('totalHeight') ?? 2.8,
        treadDepth: ctx.numOpt('treadDepth') ?? 0.28, innerRadius: ctx.numOpt('innerRadius') ?? 0.6
      }
    }))
  },
  roof_profile: {
    name: 'roof_profile',
    doc: 'gable, hip, shed, or mansard architectural roof geometry',
    args: { type: { kind: 'string' }, width: NUM, length: NUM, pitchAngle: NUM, thickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('RoofProfile', {
      params: {
        type: ctx.str('type') ?? 'gable', width: ctx.numOpt('width') ?? 12,
        length: ctx.numOpt('length') ?? 16, pitchAngle: ctx.numOpt('pitchAngle') ?? 30,
        thickness: ctx.numOpt('thickness') ?? 0.3
      }
    }))
  },
  arch: {
    name: 'arch',
    doc: 'roman, gothic, or parabolic structural architectural arch',
    args: { type: { kind: 'string' }, span: NUM, height: NUM, depth: NUM, wallThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Arch', {
      params: {
        type: ctx.str('type') ?? 'roman', span: ctx.numOpt('span') ?? 4,
        height: ctx.numOpt('height') ?? 5, depth: ctx.numOpt('depth') ?? 1.2,
        wallThickness: ctx.numOpt('wallThickness') ?? 0.4
      }
    }))
  },
  column: {
    name: 'column',
    doc: 'classical column with pedestal base, fluted shaft, and capital',
    args: { height: NUM, baseRadius: NUM, topRadius: NUM, fluteCount: NUM, baseHeight: NUM, capitalHeight: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Column', {
      params: {
        height: ctx.numOpt('height') ?? 8, baseRadius: ctx.numOpt('baseRadius') ?? 0.6,
        topRadius: ctx.numOpt('topRadius') ?? 0.48, fluteCount: ctx.numOpt('fluteCount') ?? 16,
        baseHeight: ctx.numOpt('baseHeight') ?? 0.8, capitalHeight: ctx.numOpt('capitalHeight') ?? 0.8
      }
    }))
  },
  truss: {
    name: 'truss',
    doc: 'structural Warren truss framework with chords and web diagonals',
    args: { span: NUM, height: NUM, depth: NUM, panels: NUM, barThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Truss', {
      params: {
        span: ctx.numOpt('span') ?? 16, height: ctx.numOpt('height') ?? 2.5,
        depth: ctx.numOpt('depth') ?? 0.4, panels: ctx.numOpt('panels') ?? 6,
        barThickness: ctx.numOpt('barThickness') ?? 0.15
      }
    }))
  },
  balustrade: {
    name: 'balustrade',
    doc: 'linear railing and vertical baluster fence/guard',
    args: { length: NUM, height: NUM, balusterSpacing: NUM, balusterRadius: NUM, railRadius: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Balustrade', {
      params: {
        length: ctx.numOpt('length') ?? 10, height: ctx.numOpt('height') ?? 1.0,
        balusterSpacing: ctx.numOpt('balusterSpacing') ?? 0.2,
        balusterRadius: ctx.numOpt('balusterRadius') ?? 0.025,
        railRadius: ctx.numOpt('railRadius') ?? 0.04
      }
    }))
  },
  wall_with_openings: {
    name: 'wall_with_openings',
    doc: 'solid wall with patterned door/window opening cutouts',
    args: { length: NUM, height: NUM, thickness: NUM, openingWidth: NUM, openingHeight: NUM, openingCount: NUM, openingBottomOffset: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('WallWithOpenings', {
      params: {
        length: ctx.numOpt('length') ?? 12, height: ctx.numOpt('height') ?? 3.2,
        thickness: ctx.numOpt('thickness') ?? 0.3, openingWidth: ctx.numOpt('openingWidth') ?? 1.4,
        openingHeight: ctx.numOpt('openingHeight') ?? 1.8, openingCount: ctx.numOpt('openingCount') ?? 3,
        openingBottomOffset: ctx.numOpt('openingBottomOffset') ?? 0.8
      }
    }))
  },

  // --- Organic Skills (10) ---
  phyllotaxis: {
    name: 'phyllotaxis',
    doc: 'Fibonacci spiral point & rotation distribution on planes or dome caps',
    args: { count: NUM, spread: NUM, divergenceAngle: NUM, pitchZ: NUM, domeRadius: NUM },
    returns: 'point[]',
    expand: (ctx) => ctx.out(ctx.node('Phyllotaxis', {
      params: {
        count: ctx.numOpt('count') ?? 34, spread: ctx.numOpt('spread') ?? 2.0,
        divergenceAngle: ctx.numOpt('divergenceAngle') ?? 137.5077,
        pitchZ: ctx.numOpt('pitchZ') ?? 0.2, domeRadius: ctx.numOpt('domeRadius') ?? 0
      }
    }), 'points', 'point[]')
  },
  airfoil: {
    name: 'airfoil',
    doc: 'NACA 4-digit aerodynamic wing/fin profile curve',
    args: { chord: NUM, nacaCode: { kind: 'string' }, numPoints: NUM },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('AirfoilCurve', {
      params: { chord: ctx.numOpt('chord') ?? 10, nacaCode: ctx.str('nacaCode') ?? '0012', numPoints: ctx.numOpt('numPoints') ?? 40 }
    }), 'curve', 'curve')
  },
  superellipse: {
    name: 'superellipse',
    doc: 'Lamé curve / squircle rounded cross-section wire',
    args: { radiusX: NUM, radiusY: NUM, exponent: NUM, numPoints: NUM },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('Superellipse', {
      params: { radiusX: ctx.numOpt('radiusX') ?? 6, radiusY: ctx.numOpt('radiusY') ?? 4, exponent: ctx.numOpt('exponent') ?? 2.5, numPoints: ctx.numOpt('numPoints') ?? 48 }
    }), 'curve', 'curve')
  },
  organic_rib: {
    name: 'organic_rib',
    doc: 'tapered curved organic rib spine',
    args: { length: NUM, baseRadius: NUM, tipRadius: NUM, archHeight: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('OrganicRib', {
      params: { length: ctx.numOpt('length') ?? 10, baseRadius: ctx.numOpt('baseRadius') ?? 0.8, tipRadius: ctx.numOpt('tipRadius') ?? 0.2, archHeight: ctx.numOpt('archHeight') ?? 2.5 }
    }))
  },
  branching_system: {
    name: 'branching_system',
    doc: 'recursive 3D branching tree / vascular tubular system',
    args: { levels: NUM, trunkRadius: NUM, trunkHeight: NUM, branchAngle: NUM, radiusDecay: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('BranchingSystem', {
      params: { levels: ctx.numOpt('levels') ?? 2, trunkRadius: ctx.numOpt('trunkRadius') ?? 0.8, trunkHeight: ctx.numOpt('trunkHeight') ?? 6, branchAngle: ctx.numOpt('branchAngle') ?? 30, radiusDecay: ctx.numOpt('radiusDecay') ?? 0.65 }
    }))
  },
  tendon: {
    name: 'tendon',
    doc: 'catenary sagging organic tendon cable',
    args: { radius: NUM, length: NUM, sag: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Tendon', {
      params: { radius: ctx.numOpt('radius') ?? 0.3, length: ctx.numOpt('length') ?? 10, sag: ctx.numOpt('sag') ?? 1.0 }
    }))
  },
  petal_morph: {
    name: 'petal_morph',
    doc: 'curved botanical flower petal with cup depth and edge waviness',
    args: { length: NUM, width: NUM, cupDepth: NUM, edgeWaviness: NUM, thickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('PetalMorph', {
      params: { length: ctx.numOpt('length') ?? 10, width: ctx.numOpt('width') ?? 5, cupDepth: ctx.numOpt('cupDepth') ?? 1.5, edgeWaviness: ctx.numOpt('edgeWaviness') ?? 0.4, thickness: ctx.numOpt('thickness') ?? 0.3 }
    }))
  },
  spine_loft: {
    name: 'spine_loft',
    doc: 'variable cross-section loft along a curved spine',
    args: { spineLength: NUM, radiusStart: NUM, radiusMid: NUM, radiusEnd: NUM, segments: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('SpineLoft', {
      params: { spineLength: ctx.numOpt('spineLength') ?? 12, radiusStart: ctx.numOpt('radiusStart') ?? 1.5, radiusMid: ctx.numOpt('radiusMid') ?? 3.0, radiusEnd: ctx.numOpt('radiusEnd') ?? 0.4, segments: ctx.numOpt('segments') ?? 8 }
    }))
  },
  segmented_body: {
    name: 'segmented_body',
    doc: 'tapered insect / arthropod segmented shell',
    args: { segments: NUM, baseRadius: NUM, maxRadius: NUM, length: NUM, segmentGap: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('SegmentedBody', {
      params: { segments: ctx.numOpt('segments') ?? 6, baseRadius: ctx.numOpt('baseRadius') ?? 1.2, maxRadius: ctx.numOpt('maxRadius') ?? 2.5, length: ctx.numOpt('length') ?? 12, segmentGap: ctx.numOpt('segmentGap') ?? 0.15 }
    }))
  },
  metaballs: {
    name: 'metaballs',
    doc: 'cluster of organic smoothed blob spheres',
    args: { count: NUM, radius: NUM, spread: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('MetaballCluster', {
      params: { count: ctx.numOpt('count') ?? 5, radius: ctx.numOpt('radius') ?? 2.0, spread: ctx.numOpt('spread') ?? 3.0 }
    }))
  },

  // --- Engineering Skills (11) ---
  involute_gear: {
    name: 'involute_gear',
    doc: 'precision spur gear with involute tooth profile and center bore',
    args: { teeth: NUM, module: NUM, faceWidth: NUM, boreDiameter: NUM, pressureAngle: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('InvoluteGear', {
      params: { teeth: ctx.numOpt('teeth') ?? 20, module: ctx.numOpt('module') ?? 1.0, faceWidth: ctx.numOpt('faceWidth') ?? 5.0, boreDiameter: ctx.numOpt('boreDiameter') ?? 4.0, pressureAngle: ctx.numOpt('pressureAngle') ?? 20 }
    }))
  },
  bevel_gear: {
    name: 'bevel_gear',
    doc: 'conical bevel gear blank with pitch cone angle',
    args: { teeth: NUM, module: NUM, faceWidth: NUM, boreDiameter: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('BevelGear', {
      params: { teeth: ctx.numOpt('teeth') ?? 18, module: ctx.numOpt('module') ?? 1.2, faceWidth: ctx.numOpt('faceWidth') ?? 4.0, boreDiameter: ctx.numOpt('boreDiameter') ?? 4.0 }
    }))
  },
  rack_and_pinion: {
    name: 'rack_and_pinion',
    doc: 'linear gear rack with matching module teeth',
    args: { length: NUM, module: NUM, height: NUM, width: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('RackAndPinion', {
      params: { length: ctx.numOpt('length') ?? 30, module: ctx.numOpt('module') ?? 1.0, height: ctx.numOpt('height') ?? 8.0, width: ctx.numOpt('width') ?? 5.0 }
    }))
  },
  sprocket: {
    name: 'sprocket',
    doc: 'ANSI/ISO roller chain sprocket with roller tooth cutouts',
    args: { teeth: NUM, pitch: NUM, rollerDiameter: NUM, thickness: NUM, boreDiameter: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('Sprocket', {
      params: { teeth: ctx.numOpt('teeth') ?? 16, pitch: ctx.numOpt('pitch') ?? 6.35, rollerDiameter: ctx.numOpt('rollerDiameter') ?? 3.3, thickness: ctx.numOpt('thickness') ?? 2.5, boreDiameter: ctx.numOpt('boreDiameter') ?? 5.0 }
    }))
  },
  timing_pulley: {
    name: 'timing_pulley',
    doc: 'timing belt pulley with retaining side flanges',
    args: { teeth: NUM, pitch: NUM, width: NUM, boreDiameter: NUM, flangeHeight: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('TimingPulley', {
      params: { teeth: ctx.numOpt('teeth') ?? 24, pitch: ctx.numOpt('pitch') ?? 2.0, width: ctx.numOpt('width') ?? 7.0, boreDiameter: ctx.numOpt('boreDiameter') ?? 5.0, flangeHeight: ctx.numOpt('flangeHeight') ?? 1.2 }
    }))
  },
  bolt_nut: {
    name: 'bolt_nut',
    doc: 'ISO hex head bolt with threaded shank',
    args: { boltDiameter: NUM, length: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('HexNutBolt', {
      params: { boltDiameter: ctx.numOpt('boltDiameter') ?? 6.0, length: ctx.numOpt('length') ?? 25.0 }
    }))
  },
  snap_fit: {
    name: 'snap_fit',
    doc: 'cantilever snap-fit beam with catch latch',
    args: { beamLength: NUM, beamWidth: NUM, beamThickness: NUM, hookDepth: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('SnapFitJoint', {
      params: { beamLength: ctx.numOpt('beamLength') ?? 12, beamWidth: ctx.numOpt('beamWidth') ?? 4, beamThickness: ctx.numOpt('beamThickness') ?? 1.2, hookDepth: ctx.numOpt('hookDepth') ?? 1.0 }
    }))
  },
  oring_groove: {
    name: 'oring_groove',
    doc: 'shaft with recessed O-ring sealing gland channel',
    args: { shaftDiameter: NUM, grooveWidth: NUM, grooveDepth: NUM, shaftLength: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('OringGroove', {
      params: { shaftDiameter: ctx.numOpt('shaftDiameter') ?? 20, grooveWidth: ctx.numOpt('grooveWidth') ?? 2.5, grooveDepth: ctx.numOpt('grooveDepth') ?? 1.5, shaftLength: ctx.numOpt('shaftLength') ?? 20 }
    }))
  },
  heat_sink: {
    name: 'heat_sink',
    doc: 'finned thermal cooling heat sink array',
    args: { baseWidth: NUM, baseLength: NUM, baseThickness: NUM, finCount: NUM, finHeight: NUM, finThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('HeatSink', {
      params: { baseWidth: ctx.numOpt('baseWidth') ?? 30, baseLength: ctx.numOpt('baseLength') ?? 40, baseThickness: ctx.numOpt('baseThickness') ?? 3, finCount: ctx.numOpt('finCount') ?? 12, finHeight: ctx.numOpt('finHeight') ?? 15, finThickness: ctx.numOpt('finThickness') ?? 1.0 }
    }))
  },
  flange: {
    name: 'flange',
    doc: 'pipe flange connection with circular PCD bolt hole pattern',
    args: { pipeDiameter: NUM, outerDiameter: NUM, flangeThickness: NUM, boltCount: NUM, boltHoleDiameter: NUM, pcd: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('FlangeConnection', {
      params: { pipeDiameter: ctx.numOpt('pipeDiameter') ?? 15, outerDiameter: ctx.numOpt('outerDiameter') ?? 30, flangeThickness: ctx.numOpt('flangeThickness') ?? 4, boltCount: ctx.numOpt('boltCount') ?? 6, boltHoleDiameter: ctx.numOpt('boltHoleDiameter') ?? 3.5, pcd: ctx.numOpt('pcd') ?? 22.5 }
    }))
  },
  keyway_shaft: {
    name: 'keyway_shaft',
    doc: 'drive shaft with rectangular keyway slot',
    args: { diameter: NUM, length: NUM, keywayWidth: NUM, keywayDepth: NUM, keywayLength: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('KeywayShaft', {
      params: { diameter: ctx.numOpt('diameter') ?? 16, length: ctx.numOpt('length') ?? 40, keywayWidth: ctx.numOpt('keywayWidth') ?? 5, keywayDepth: ctx.numOpt('keywayDepth') ?? 3, keywayLength: ctx.numOpt('keywayLength') ?? 20 }
    }))
  },

  // --- Generative Skills (14) ---
  curve_frame: {
    name: 'curve_frame',
    doc: 'Frenet-Serret PTNB orientation frame evaluation along a curve',
    args: { curve: { kind: 'curve', required: true }, samples: NUM },
    returns: 'point[]',
    expand: (ctx) => ctx.out(ctx.node('CurveFrame', {
      params: { samples: ctx.numOpt('samples') ?? 20 },
      inputs: { curve: ctx.ref('curve', 'curve') }
    }), 'points', 'point[]')
  },
  attractor_field: {
    name: 'attractor_field',
    doc: 'modulate point scale/weights based on proximity to an attractor target',
    args: { points: { kind: 'point[]', required: true }, target: { kind: 'point' }, radius: NUM, falloff: { kind: 'string' } },
    returns: 'point[]',
    expand: (ctx) => ctx.out(ctx.node('AttractorField', {
      params: { radius: ctx.numOpt('radius') ?? 10, falloff: ctx.str('falloff') ?? 'linear' },
      inputs: { points: ctx.ref('points', 'point[]'), target: ctx.refOpt('target', 'point') }
    }), 'points', 'point[]')
  },
  noise_displacement: {
    name: 'noise_displacement',
    doc: 'procedural 3D noise perturbation of a solid',
    args: { solid: { kind: 'solid', required: true }, amplitude: NUM, frequency: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('NoiseDisplacement', {
      params: { amplitude: ctx.numOpt('amplitude') ?? 1.0, frequency: ctx.numOpt('frequency') ?? 0.2 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  voronoi_pattern: {
    name: 'voronoi_pattern',
    doc: 'cellular 2D Voronoi partition slab with perforated cells',
    args: { width: NUM, height: NUM, cellCount: NUM, borderPadding: NUM, thickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('VoronoiPattern', {
      params: { width: ctx.numOpt('width') ?? 20, height: ctx.numOpt('height') ?? 20, cellCount: ctx.numOpt('cellCount') ?? 12, borderPadding: ctx.numOpt('borderPadding') ?? 0.4, thickness: ctx.numOpt('thickness') ?? 1.0 }
    }))
  },
  gyroid_lattice: {
    name: 'gyroid_lattice',
    doc: 'triply periodic minimal surface (TPMS) Gyroid unit cell array',
    args: { cellSize: NUM, periodsX: NUM, periodsY: NUM, periodsZ: NUM, wallThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('GyroidLattice', {
      params: { cellSize: ctx.numOpt('cellSize') ?? 5, periodsX: ctx.numOpt('periodsX') ?? 2, periodsY: ctx.numOpt('periodsY') ?? 2, periodsZ: ctx.numOpt('periodsZ') ?? 2, wallThickness: ctx.numOpt('wallThickness') ?? 0.4 }
    }))
  },
  diamond_lattice: {
    name: 'diamond_lattice',
    doc: 'Diamond TPMS minimal surface lattice structure',
    args: { cellSize: NUM, periodsX: NUM, periodsY: NUM, periodsZ: NUM, wallThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('DiamondLattice', {
      params: { cellSize: ctx.numOpt('cellSize') ?? 6, periodsX: ctx.numOpt('periodsX') ?? 2, periodsY: ctx.numOpt('periodsY') ?? 2, periodsZ: ctx.numOpt('periodsZ') ?? 2, wallThickness: ctx.numOpt('wallThickness') ?? 0.4 }
    }))
  },
  schwarz_p_lattice: {
    name: 'schwarz_p_lattice',
    doc: 'Schwarz-P TPMS minimal surface unit cell block',
    args: { cellSize: NUM, periodsX: NUM, periodsY: NUM, periodsZ: NUM, wallThickness: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('SchwarzPLattice', {
      params: { cellSize: ctx.numOpt('cellSize') ?? 6, periodsX: ctx.numOpt('periodsX') ?? 2, periodsY: ctx.numOpt('periodsY') ?? 2, periodsZ: ctx.numOpt('periodsZ') ?? 2, wallThickness: ctx.numOpt('wallThickness') ?? 0.5 }
    }))
  },
  delaunay_network: {
    name: 'delaunay_network',
    doc: 'Delaunay triangulation wireframe network across a point cloud',
    args: { points: { kind: 'point[]', required: true }, strutRadius: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('DelaunayTriangulation', {
      params: { strutRadius: ctx.numOpt('strutRadius') ?? 0.1 },
      inputs: { points: ctx.ref('points', 'point[]') }
    }))
  },
  wave_field: {
    name: 'wave_field',
    doc: 'harmonic ripple spatial wave deformation',
    args: { solid: { kind: 'solid', required: true }, frequencyX: NUM, amplitude: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('WaveField', {
      params: { frequencyX: ctx.numOpt('frequencyX') ?? 0.2, amplitude: ctx.numOpt('amplitude') ?? 1.0 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  curve_morph: {
    name: 'curve_morph',
    doc: 'interpolated morphing transition between two curves',
    args: { curve1: { kind: 'curve', required: true }, curve2: { kind: 'curve', required: true }, factor: NUM },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('CurveMorph', {
      params: { factor: ctx.numOpt('factor') ?? 0.5 },
      inputs: { curve1: ctx.ref('curve1', 'curve'), curve2: ctx.ref('curve2', 'curve') }
    }), 'curve', 'curve')
  },
  reaction_diffusion: {
    name: 'reaction_diffusion',
    doc: 'Turing pattern spot distribution simulation',
    args: { gridSize: NUM, spotRadius: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('ReactionDiffusion', {
      params: { gridSize: ctx.numOpt('gridSize') ?? 20, spotRadius: ctx.numOpt('spotRadius') ?? 0.6 }
    }))
  },
  cellular_automata: {
    name: 'cellular_automata',
    doc: 'discrete 3D voxel growth pattern solid',
    args: { gridSize: NUM, cellSize: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('CellularAutomata', {
      params: { gridSize: ctx.numOpt('gridSize') ?? 8, cellSize: ctx.numOpt('cellSize') ?? 1.5 }
    }))
  },
  differential_growth: {
    name: 'differential_growth',
    doc: 'meandering organic differential growth curve',
    args: { initialRadius: NUM, steps: NUM, tubeRadius: NUM },
    returns: 'curve',
    expand: (ctx) => ctx.out(ctx.node('DifferentialGrowth', {
      params: { initialRadius: ctx.numOpt('initialRadius') ?? 6, steps: ctx.numOpt('steps') ?? 36, tubeRadius: ctx.numOpt('tubeRadius') ?? 0.25 }
    }), 'curve', 'curve')
  },
  radial_symmetry: {
    name: 'radial_symmetry',
    doc: 'distribute a solid across N-fold rotational symmetry',
    args: { solid: { kind: 'solid', required: true }, count: NUM, totalAngle: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('RadialSymmetryCluster', {
      params: { count: ctx.numOpt('count') ?? 6, totalAngle: ctx.numOpt('totalAngle') ?? 360 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },

  // --- Analysis Skills (10) ---
  mass_properties: {
    name: 'mass_properties',
    doc: 'calculate volume, area, and center of gravity',
    args: { solid: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('MassProperties', {
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  curvature_analysis: {
    name: 'curvature_analysis',
    doc: 'evaluate mean curvature across solid faces',
    args: { solid: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('CurvatureAnalysis', {
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  interference_check: {
    name: 'interference_check',
    doc: 'detect geometric collision volume between two solids',
    args: { solid1: { kind: 'solid', required: true }, solid2: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('InterferenceCheck', {
      inputs: { solid1: ctx.ref('solid1', 'solid'), solid2: ctx.ref('solid2', 'solid') }
    }))
  },
  wall_thickness_check: {
    name: 'wall_thickness_check',
    doc: 'check minimum wall thickness threshold',
    args: { solid: { kind: 'solid', required: true }, minThreshold: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('WallThicknessCheck', {
      params: { minThreshold: ctx.numOpt('minThreshold') ?? 1.0 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  overhang_analysis: {
    name: 'overhang_analysis',
    doc: 'detect 3D printing steep overhang angles (>45 deg)',
    args: { solid: { kind: 'solid', required: true }, thresholdAngle: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('OverhangAnalysis', {
      params: { thresholdAngle: ctx.numOpt('thresholdAngle') ?? 45 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  draft_angle_analysis: {
    name: 'draft_angle_analysis',
    doc: 'verify injection molding draft angles along mold pull vector',
    args: { solid: { kind: 'solid', required: true }, requiredAngle: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('DraftAngleAnalysis', {
      params: { requiredAngle: ctx.numOpt('requiredAngle') ?? 2.0 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  bounding_box_oriented: {
    name: 'bounding_box_oriented',
    doc: 'compute minimum-volume oriented bounding box (OBB)',
    args: { solid: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('BoundingBoxOriented', {
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  center_of_gravity: {
    name: 'center_of_gravity',
    doc: 'visual marker sphere placed at center of gravity (COG)',
    args: { solid: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('CenterOfGravity', {
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  cross_section_slice: {
    name: 'cross_section_slice',
    doc: 'slice solid into an array of planar cross sections',
    args: { solid: { kind: 'solid', required: true }, count: NUM, startOffset: NUM, endOffset: NUM },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('CrossSectionSlice', {
      params: { count: ctx.numOpt('count') ?? 5, startOffset: ctx.numOpt('startOffset') ?? -10, endOffset: ctx.numOpt('endOffset') ?? 10 },
      inputs: { solid: ctx.ref('solid', 'solid') }
    }))
  },
  geometry_diff: {
    name: 'geometry_diff',
    doc: 'visual boolean diff between two revision solids',
    args: { solid1: { kind: 'solid', required: true }, solid2: { kind: 'solid', required: true } },
    returns: 'solid',
    expand: (ctx) => solid(ctx, ctx.node('GeometryDiff', {
      inputs: { solid1: ctx.ref('solid1', 'solid'), solid2: ctx.ref('solid2', 'solid') }
    }))
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
  spur_gear: 'involute_gear',
  gear: 'involute_gear',
  spiral_stair: 'stairs',
  staircase: 'stairs',
  facade: 'facade_divider',
  windows: 'facade_divider',
  mullions: 'facade_divider',
  floors: 'floor_grid',
  building_frame: 'floor_grid',
  polygon: 'regular_polygon',
  ngon: 'regular_polygon',
  hexagon: 'regular_polygon',
  pentagon: 'regular_polygon',
  octagon: 'regular_polygon',
  roof: 'roof_profile',
  gable_roof: 'roof_profile',
  mansard: 'roof_profile',
  gothic_arch: 'arch',
  roman_arch: 'arch',
  colonnade_column: 'column',
  pillar: 'column',
  warren_truss: 'truss',
  bridge_truss: 'truss',
  railing: 'balustrade',
  fence: 'balustrade',
  wall: 'wall_with_openings',
  fibonacci_spiral: 'phyllotaxis',
  sunflower_points: 'phyllotaxis',
  naca_airfoil: 'airfoil',
  wing_profile: 'airfoil',
  squircle: 'superellipse',
  curved_rib: 'organic_rib',
  tree_branches: 'branching_system',
  vascular_network: 'branching_system',
  cable: 'tendon',
  petal: 'petal_morph',
  flower_petal: 'petal_morph',
  tapered_spine: 'spine_loft',
  caterpillar_body: 'segmented_body',
  blobs: 'metaballs',
  heatsink: 'heat_sink',
  thermal_fins: 'heat_sink',
  pipe_flange: 'flange',
  bolt: 'bolt_nut',
  screw: 'bolt_nut',
  nut_and_bolt: 'bolt_nut',
  chain_sprocket: 'sprocket',
  pulley: 'timing_pulley',
  belt_pulley: 'timing_pulley',
  frenet_frame: 'curve_frame',
  attractor: 'attractor_field',
  perlin_noise: 'noise_displacement',
  voronoi: 'voronoi_pattern',
  gyroid: 'gyroid_lattice',
  minimal_surface: 'gyroid_lattice',
  diamond_tpms: 'diamond_lattice',
  schwarz_p: 'schwarz_p_lattice',
  delaunay: 'delaunay_network',
  ripple_wave: 'wave_field',
  morph_curves: 'curve_morph',
  turing_pattern: 'reaction_diffusion',
  cellular: 'cellular_automata',
  meander_growth: 'differential_growth',
  rotational_symmetry: 'radial_symmetry',
  cog: 'center_of_gravity',
  centroid: 'center_of_gravity',
  obb: 'bounding_box_oriented',
  clash_detect: 'interference_check',
  slice_solid: 'cross_section_slice',
  mesh_diff: 'geometry_diff',
};

export function resolveSkill(op: string): SkillDef | undefined {
  return SKILLS[op] ?? SKILLS[SKILL_ALIASES[op]];
}

export function skillCatalogText(): string {
  const lines: string[] = [];
  for (const s of Object.values(SKILLS)) {
    const sig = Object.entries(s.args)
      .map(([n, a]) => (a.required ? n : `${n}?`))
      .join(', ');
    const preferStr = s.prefer ? ` [prefer: ${s.prefer}]` : '';
    lines.push(`${s.name}(${sig}) -> ${s.returns}${preferStr} — ${s.doc}`);
  }
  return lines.join('\n');
}
