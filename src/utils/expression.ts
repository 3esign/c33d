// Safe arithmetic expression evaluator (no eval, no object access).
// Supports: + - * / % ^, parentheses, unary minus, variables (a-z identifiers),
// functions: sin cos tan asin acos atan atan2 sinh cosh tanh sqrt cbrt abs sign
//            trunc min max floor ceil round pow log exp log2 log10 mod clamp lerp
// Constants: pi, tau, e
//
// SPEC-7 semantics: silent-zero is banned. Division/modulo by zero, malformed
// numerics ("1.2.3") and non-finite results THROW — a broken formula must
// error loudly instead of producing default-sized confident geometry.

type Tok = { kind: 'num' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma'; value: string };

const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, sign: Math.sign, trunc: Math.trunc,
  min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  pow: Math.pow, log: Math.log, exp: Math.exp, log2: Math.log2, log10: Math.log10,
  mod: (a, b) => {
    if (b === 0) throw new Error('division by zero in formula');
    return a % b;
  },
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
};

// Arity checks for the functions where a wrong count silently computed garbage
// (min() → Infinity, clamp(x, lo) → NaN). null max = variadic.
const FUNC_ARITY: Record<string, { min: number; max: number | null }> = {
  min: { min: 1, max: null },
  max: { min: 1, max: null },
  clamp: { min: 3, max: 3 },
  lerp: { min: 3, max: 3 },
  mod: { min: 2, max: 2 },
  atan2: { min: 2, max: 2 },
};

const CONSTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E };

// Strict numeric literal: catches "1.2.3", "1e", ".." that parseFloat silently
// truncates into confident wrong numbers.
const NUM_RE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][-+]?[0-9]+)?$/;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.eE]/.test(src[j])) {
        // allow 1e-3 / 1e+3
        if ((src[j] === 'e' || src[j] === 'E') && (src[j + 1] === '-' || src[j + 1] === '+')) j++;
        j++;
      }
      const raw = src.slice(i, j);
      if (!NUM_RE.test(raw)) throw new Error(`malformed number '${raw}' in formula`);
      toks.push({ kind: 'num', value: raw });
      i = j;
    } else if (/[a-zA-Z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[a-zA-Z_0-9]/.test(src[j])) j++;
      toks.push({ kind: 'id', value: src.slice(i, j).toLowerCase() });
      i = j;
    } else if ('+-*/%^'.includes(c)) {
      toks.push({ kind: 'op', value: c }); i++;
    } else if (c === '(') { toks.push({ kind: 'lparen', value: c }); i++; }
    else if (c === ')') { toks.push({ kind: 'rparen', value: c }); i++; }
    else if (c === ',') { toks.push({ kind: 'comma', value: c }); i++; }
    else throw new Error(`Unexpected character '${c}' in expression`);
  }
  return toks;
}

export function normalizeVarName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

export function evaluateExpression(formula: string, vars: Record<string, number>): number {
  const toks = tokenize(formula);
  let pos = 0;

  const normalizedVars: Record<string, number> = {};
  for (const [k, v] of Object.entries(vars)) {
    normalizedVars[normalizeVarName(k)] = v;
  }

  const peek = () => toks[pos];
  const next = () => toks[pos++];

  function parseExpr(): number { return parseAddSub(); }

  function parseAddSub(): number {
    let left = parseMulDiv();
    while (peek() && peek().kind === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const right = parseMulDiv();
      left = op === '+' ? left + right : left - right;
    }
    return left;
  }

  function parseMulDiv(): number {
    let left = parseUnary();
    while (peek() && peek().kind === 'op' && '*/%'.includes(peek().value)) {
      const op = next().value;
      const right = parseUnary();
      if (op === '*') left = left * right;
      else if (right === 0) throw new Error('division by zero in formula');
      else if (op === '/') left = left / right;
      else left = left % right;
    }
    return left;
  }

  // Unary sits ABOVE power so `-2^2 === -4` (unary minus applies to the power
  // result, matching every mainstream math notation and spreadsheet).
  function parseUnary(): number {
    if (peek() && peek().kind === 'op' && peek().value === '-') { next(); return -parseUnary(); }
    if (peek() && peek().kind === 'op' && peek().value === '+') { next(); return parseUnary(); }
    return parsePower();
  }

  function parsePower(): number {
    const base = parseAtom();
    if (peek() && peek().kind === 'op' && peek().value === '^') {
      next();
      return Math.pow(base, parseUnary()); // right-assoc, unary allowed in exponent (2^-3)
    }
    return base;
  }

  function parseAtom(): number {
    const t = next();
    if (!t) throw new Error('Unexpected end of expression');
    if (t.kind === 'num') return parseFloat(t.value);
    if (t.kind === 'lparen') {
      const v = parseExpr();
      if (!peek() || next().kind !== 'rparen') throw new Error('Missing closing parenthesis');
      return v;
    }
    if (t.kind === 'id') {
      // function call?
      if (peek() && peek().kind === 'lparen') {
        next(); // consume (
        const args: number[] = [];
        if (peek() && peek().kind !== 'rparen') {
          args.push(parseExpr());
          while (peek() && peek().kind === 'comma') { next(); args.push(parseExpr()); }
        }
        if (!peek() || next().kind !== 'rparen') throw new Error(`Missing ) after ${t.value}(...)`);
        const fn = FUNCS[t.value];
        if (!fn) throw new Error(`Unknown function '${t.value}'`);
        const arity = FUNC_ARITY[t.value];
        if (arity) {
          if (args.length < arity.min) throw new Error(`${t.value}() expects at least ${arity.min} argument${arity.min > 1 ? 's' : ''}, got ${args.length}`);
          if (arity.max !== null && args.length > arity.max) throw new Error(`${t.value}() expects at most ${arity.max} arguments, got ${args.length}`);
        }
        return fn(...args);
      }
      const normId = normalizeVarName(t.value);
      if (normId in normalizedVars) {
        const vv: any = normalizedVars[normId];
        if (typeof vv === 'number' && isFinite(vv)) return vv;
        // Bound but unusable is NOT "unknown" — say what is actually wrong.
        if (Array.isArray(vv)) {
          throw new Error(`variable '${t.value}' is a list — pick one element (ListItem) or use it where lists are accepted`);
        }
        throw new Error(`variable '${t.value}' is not a finite number`);
      }
      if (normId in CONSTS) return CONSTS[normId];
      const available = Object.keys(normalizedVars).join(', ');
      // a/b/c/d are the Expression node's per-element input handles. When one is
      // referenced but unbound, the raw "unknown variable" message misleads the
      // repair model into swapping it for a slider (which discards the per-element
      // mapping). Name the true fix — wire a list into that handle — instead.
      if (/^[a-d]$/.test(normId)) {
        throw new Error(
          `unknown variable '${t.value}': in an Expression, a/b/c/d are per-element variables supplied by wiring a number list (Series/Range/ListConstant/PointsFromLists/another Expression) into the '${t.value}' input handle. Nothing is wired to '${t.value}'. Add that edge — do NOT replace '${t.value}' with a slider name, which drops the per-element mapping. Sliders in scope: ${available || '(none)'}.`
        );
      }
      throw new Error(`unknown variable '${t.value}' — available: ${available || '(none)'}`);
    }
    throw new Error(`Unexpected token '${t.value}'`);
  }

  const result = parseExpr();
  if (pos < toks.length) throw new Error(`Unexpected trailing input near '${toks[pos].value}'`);
  if (!isFinite(result) || isNaN(result)) throw new Error('formula result is not a finite number');
  return result;
}
