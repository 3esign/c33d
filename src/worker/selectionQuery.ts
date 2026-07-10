import { evaluateExpression as evaluateExpressionSafe } from '../utils/expression.ts';

export interface ElementData {
  element: any;
  hash: number;
  centroid: [number, number, number];
  normal?: [number, number, number];
  direction?: [number, number, number];
  areaOrLength: number;
  geomType: string;
}

type QueryAST =
  | { type: 'and'; left: QueryAST; right: QueryAST }
  | { type: 'or'; left: QueryAST; right: QueryAST }
  | { type: 'not'; expr: QueryAST }
  | { type: 'predicate'; pred: string; args: string[] };

function getNormalVec(face: any): [number, number, number] {
  try {
    const norm = face.normalAt();
    if (norm && typeof norm.toTuple === 'function') return norm.toTuple();
    if (norm && 'x' in norm) return [norm.x, norm.y, norm.z];
  } catch (e) {}
  try {
    const A = face.pointOnSurface(0, 0);
    const B = face.pointOnSurface(1, 0);
    const C = face.pointOnSurface(1, 1);
    const D = face.pointOnSurface(0, 1);
    const v1x = C[0] - A[0];
    const v1y = C[1] - A[1];
    const v1z = C[2] - A[2];
    const v2x = D[0] - B[0];
    const v2y = D[1] - B[1];
    const v2z = D[2] - B[2];
    let nx = v1y * v2z - v1z * v2y;
    let ny = v1z * v2x - v1x * v2z;
    let nz = v1x * v2y - v1y * v2x;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    return len > 0 ? [nx / len, ny / len, nz / len] : [0, 0, 1];
  } catch (e) {
    return [0, 0, 1];
  }
}

function getArea(face: any): number {
  if (typeof face.surfaceArea === 'function') return face.surfaceArea();
  if (typeof face.area === 'number') return face.area;
  return 0;
}

function getEdgeDirection(edge: any): [number, number, number] {
  try {
    if (edge.direction && Array.isArray(edge.direction)) return edge.direction as any;
    if (typeof edge.tangentAt === 'function') {
      const tangent = edge.tangentAt(0.5);
      if (tangent && typeof tangent.toTuple === 'function') return tangent.toTuple();
      if (tangent && 'x' in tangent) return [tangent.x, tangent.y, tangent.z];
    }
  } catch (e) {}
  return [0, 0, 1];
}

function getLength(edge: any): number {
  if (typeof edge.length === 'number') return edge.length;
  if (typeof edge.length === 'function') return edge.length();
  return 0;
}

function resolveDirection(dirStr: string): [number, number, number] | null {
  const s = dirStr.trim().toUpperCase();
  if (s === 'X' || s === '+X') return [1, 0, 0];
  if (s === '-X') return [-1, 0, 0];
  if (s === 'Y' || s === '+Y') return [0, 1, 0];
  if (s === '-Y') return [0, -1, 0];
  if (s === 'Z' || s === '+Z') return [0, 0, 1];
  if (s === '-Z') return [0, 0, -1];
  
  const m = s.match(/\[?\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]?/);
  if (m) {
    const x = parseFloat(m[1]);
    const y = parseFloat(m[2]);
    const z = parseFloat(m[3]);
    const len = Math.sqrt(x*x + y*y + z*z);
    return len > 0 ? [x / len, y / len, z / len] : [0, 0, 1];
  }
  return null;
}

function tokenizeQuery(src: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(' || c === ')') {
      tokens.push(c);
      i++;
      continue;
    }
    const twoChars = src.slice(i, i + 2);
    if (twoChars === '>=' || twoChars === '<=' || twoChars === '==') {
      tokens.push(twoChars);
      i += 2;
      continue;
    }
    if ('><~='.includes(c)) {
      tokens.push(c);
      i++;
      continue;
    }
    let j = i;
    while (j < src.length && !'()><~=\s,'.includes(src[j]) && !/\s/.test(src[j])) {
      if (src[j] === '[') {
        while (j < src.length && src[j] !== ']') j++;
        if (j < src.length) j++;
        continue;
      }
      if (src.slice(j, j + 6) === 'point(') {
        while (j < src.length && src[j] !== ')') j++;
        if (j < src.length) j++;
        continue;
      }
      j++;
    }
    const val = src.slice(i, j);
    tokens.push(val);
    i = j;
  }
  return tokens;
}

function parseExpression(tokens: string[]): QueryAST {
  let pos = 0;
  
  function peek() { return tokens[pos]; }
  function next() { return tokens[pos++]; }
  
  function parseOr(): QueryAST {
    let left = parseAnd();
    while (peek() && peek().toLowerCase() === 'or') {
      next();
      const right = parseAnd();
      left = { type: 'or', left, right };
    }
    return left;
  }
  
  function parseAnd(): QueryAST {
    let left = parseNot();
    while (peek() && peek().toLowerCase() === 'and') {
      next();
      const right = parseNot();
      left = { type: 'and', left, right };
    }
    return left;
  }
  
  function parseNot(): QueryAST {
    if (peek() && peek().toLowerCase() === 'not') {
      next();
      const expr = parseNot();
      return { type: 'not', expr };
    }
    return parsePrimary();
  }
  
  function parsePrimary(): QueryAST {
    const t = next();
    if (!t) throw new Error('Unexpected end of selection query');
    if (t === '(') {
      const expr = parseOr();
      if (next() !== ')') throw new Error('Missing closing parenthesis in selection query');
      return expr;
    }
    
    const lowT = t.toLowerCase();
    if (['planar', 'cylindrical', 'spherical', 'boundary'].includes(lowT)) {
      return { type: 'predicate', pred: lowT, args: [] };
    }
    
    if (lowT === 'normal' || lowT === 'direction' || lowT === 'parallel') {
      const op = next();
      if (op === '~' || op === 'parallel') {
        const dir = next();
        return { type: 'predicate', pred: lowT, args: [op, dir] };
      } else {
        return { type: 'predicate', pred: lowT, args: ['~', op] };
      }
    }
    
    if (lowT === 'max' || lowT === 'min') {
      const axis = next();
      return { type: 'predicate', pred: lowT, args: [axis] };
    }
    
    if (lowT === 'nearest') {
      const toK = next();
      if (toK.toLowerCase() !== 'to') {
        pos--;
      }
      const pt = next();
      return { type: 'predicate', pred: 'nearest', args: [pt] };
    }
    
    if (lowT === 'index') {
      const n = next();
      const byK = peek();
      if (byK && byK.toLowerCase() === 'by') {
        next();
        const expr = next();
        return { type: 'predicate', pred: 'index', args: [n, expr] };
      }
      return { type: 'predicate', pred: 'index', args: [n] };
    }
    
    const op = peek();
    if (op && ['>', '<', '>=', '<=', '==', '~'].includes(op)) {
      next();
      const rhs = next();
      return { type: 'predicate', pred: 'comparison', args: [t, op, rhs] };
    }
    
    return { type: 'predicate', pred: lowT, args: [] };
  }
  
  return parseOr();
}

function matchesPredicate(
  el: ElementData,
  pred: string,
  args: string[],
  _scope: Record<string, number>,
  boundaryHashes: Set<number>,
  tolerance: number
): boolean {
  const p = pred.toLowerCase();
  
  if (p === 'planar') return el.geomType === 'PLANE';
  if (p === 'cylindrical') return el.geomType === 'CYLINDRE';
  if (p === 'spherical') return el.geomType === 'SPHERE';
  if (p === 'boundary') return boundaryHashes.has(el.hash);
  
  if (p === 'normal' || p === 'direction' || p === 'parallel') {
    const op = args[0];
    const targetStr = args[1];
    const target = resolveDirection(targetStr);
    if (!target) return false;
    
    const vec = p === 'normal' ? el.normal : (p === 'parallel' ? el.direction : el.direction || el.normal);
    if (!vec) return false;
    
    const dot = vec[0]*target[0] + vec[1]*target[1] + vec[2]*target[2];
    if (op === '~') {
      return dot > 1 - tolerance;
    } else {
      return Math.abs(dot) > 1 - tolerance;
    }
  }
  
  return false;
}

function evaluateAST(
  ast: QueryAST,
  elements: ElementData[],
  scope: Record<string, number>,
  boundaryHashes: Set<number>,
  tolerance: number
): ElementData[] {
  if (ast.type === 'or') {
    const left = evaluateAST(ast.left, elements, scope, boundaryHashes, tolerance);
    const right = evaluateAST(ast.right, elements, scope, boundaryHashes, tolerance);
    const hashes = new Set(left.map(e => e.hash));
    return [...left, ...right.filter(e => !hashes.has(e.hash))];
  }
  if (ast.type === 'and') {
    const left = evaluateAST(ast.left, elements, scope, boundaryHashes, tolerance);
    const right = evaluateAST(ast.right, elements, scope, boundaryHashes, tolerance);
    const hashes = new Set(right.map(e => e.hash));
    return left.filter(e => hashes.has(e.hash));
  }
  if (ast.type === 'not') {
    const sub = evaluateAST(ast.expr, elements, scope, boundaryHashes, tolerance);
    const subHashes = new Set(sub.map(e => e.hash));
    return elements.filter(e => !subHashes.has(e.hash));
  }
  
  const p = ast.pred.toLowerCase();
  
  if (p === 'max' || p === 'min') {
    const axis = ast.args[0].toUpperCase();
    const axisIdx = axis === 'X' ? 0 : (axis === 'Y' ? 1 : 2);
    if (elements.length === 0) return [];
    let bestVal = p === 'max' ? -Infinity : Infinity;
    for (const el of elements) {
      const val = el.centroid[axisIdx];
      if (p === 'max') {
        if (val > bestVal) bestVal = val;
      } else {
        if (val < bestVal) bestVal = val;
      }
    }
    return elements.filter(el => Math.abs(el.centroid[axisIdx] - bestVal) < tolerance);
  }
  
  if (p === 'nearest') {
    const ptStr = ast.args[0];
    const m = ptStr.match(/point\s*\(\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\)/i) ||
              ptStr.match(/\[?\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*,\s*([+-]?[0-9.]+)\s*\]?/);
    if (!m) return [];
    const tx = parseFloat(m[1]);
    const ty = parseFloat(m[2]);
    const tz = parseFloat(m[3]);
    
    if (elements.length === 0) return [];
    let minD = Infinity;
    const dists = elements.map(el => {
      const dx = el.centroid[0] - tx;
      const dy = el.centroid[1] - ty;
      const dz = el.centroid[2] - tz;
      const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
      if (d < minD) minD = d;
      return { el, d };
    });
    return dists.filter(x => Math.abs(x.d - minD) < 1e-4).map(x => x.el);
  }
  
  if (p === 'index') {
    const n = parseInt(ast.args[0]) || 0;
    const sortBy = ast.args[1];
    
    const sorted = [...elements].sort((a, b) => {
      if (sortBy) {
        const axis = sortBy.toLowerCase().endsWith('x') ? 0 : (sortBy.toLowerCase().endsWith('y') ? 1 : 2);
        const diff = a.centroid[axis] - b.centroid[axis];
        if (Math.abs(diff) > 1e-5) return diff;
      }
      const dz = a.centroid[2] - b.centroid[2];
      if (Math.abs(dz) > 1e-5) return dz;
      const dy = a.centroid[1] - b.centroid[1];
      if (Math.abs(dy) > 1e-5) return dy;
      const dx = a.centroid[0] - b.centroid[0];
      if (Math.abs(dx) > 1e-5) return dx;
      return a.hash - b.hash;
    });
    const idx = Math.max(0, Math.min(sorted.length - 1, n));
    return sorted.length > 0 ? [sorted[idx]] : [];
  }
  
  if (p === 'comparison') {
    const prop = ast.args[0].toLowerCase();
    const op = ast.args[1];
    const formula = ast.args[2];
    
    let limit = 0;
    try {
      limit = evaluateExpressionSafe(formula, scope);
    } catch (e) {
      limit = 0;
    }
    
    return elements.filter(el => {
      let val = 0;
      if (prop === 'center.x' || prop === 'x') val = el.centroid[0];
      else if (prop === 'center.y' || prop === 'y') val = el.centroid[1];
      else if (prop === 'center.z' || prop === 'z') val = el.centroid[2];
      else if (prop === 'area' || prop === 'length') val = el.areaOrLength;
      else if (prop === 'normal.x' || prop === 'nx') val = el.normal ? el.normal[0] : 0;
      else if (prop === 'normal.y' || prop === 'ny') val = el.normal ? el.normal[1] : 0;
      else if (prop === 'normal.z' || prop === 'nz') val = el.normal ? el.normal[2] : 0;
      
      if (op === '>') return val > limit;
      if (op === '<') return val < limit;
      if (op === '>=') return val >= limit;
      if (op === '<=') return val <= limit;
      if (op === '==') return Math.abs(val - limit) < 1e-4;
      if (op === '~') return Math.abs(val - limit) < tolerance;
      return false;
    });
  }
  
  return elements.filter(el => matchesPredicate(el, ast.pred, ast.args, scope, boundaryHashes, tolerance));
}

export function evaluateSelectionQuery(
  query: string,
  domain: 'faces' | 'edges',
  solid: any,
  scope: Record<string, number>,
  tolerance = 0.1
): { hashes: number[]; elements: ElementData[] } {
  if (!solid) return { hashes: [], elements: [] };
  const rawElements = domain === 'faces' ? (solid.faces || []) : (solid.edges || []);
  
  const boundaryHashes = new Set<number>();
  if (domain === 'edges' && solid) {
    const faces = solid.faces || [];
    const edgeCounts = new Map<number, number>();
    for (const f of faces) {
      const fEdges = f.edges || [];
      for (const e of fEdges) {
        const h = typeof e.hashCode === 'function' ? e.hashCode() : e.hashCode;
        edgeCounts.set(h, (edgeCounts.get(h) || 0) + 1);
      }
    }
    for (const [h, count] of edgeCounts.entries()) {
      if (count === 1) boundaryHashes.add(h);
    }
  }

  const elements: ElementData[] = rawElements.map((el: any) => {
    const hash = typeof el.hashCode === 'function' ? el.hashCode() : el.hashCode;
    const geomType = el.geomType || 'OTHER';
    if (domain === 'faces') {
      const centroidVec = el.center;
      const centroid: [number, number, number] = centroidVec && typeof centroidVec.toTuple === 'function'
        ? centroidVec.toTuple()
        : (centroidVec && 'x' in centroidVec ? [centroidVec.x, centroidVec.y, centroidVec.z] : [0, 0, 0]);
      const normal = getNormalVec(el);
      const area = getArea(el);
      return { element: el, hash, centroid, normal, areaOrLength: area, geomType };
    } else {
      const centroid = el.boundingBox ? el.boundingBox.center : [0, 0, 0];
      const direction = getEdgeDirection(el);
      const length = getLength(el);
      return { element: el, hash, centroid, direction, areaOrLength: length, geomType };
    }
  });

  const q = query.trim();
  if (q === '' || q === 'all' || q === '*') {
    return { hashes: elements.map(e => e.hash), elements };
  }

  try {
    const tokens = tokenizeQuery(q);
    const ast = parseExpression(tokens);
    const matched = evaluateAST(ast, elements, scope, boundaryHashes, tolerance);
    return { hashes: matched.map(m => m.hash), elements: matched };
  } catch (err) {
    console.warn("Selection query evaluation failed:", err);
    return { hashes: [], elements: [] };
  }
}
