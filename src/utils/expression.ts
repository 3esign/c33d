// Safe arithmetic expression evaluator (no eval, no object access).
// Supports: + - * / % ^, parentheses, unary minus, variables (a-z identifiers),
// functions: sin cos tan asin acos atan atan2 sqrt abs min max floor ceil round pow log exp clamp lerp
// Constants: pi, e

type Tok = { kind: 'num' | 'id' | 'op' | 'lparen' | 'rparen' | 'comma'; value: string };

const FUNCS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
  floor: Math.floor, ceil: Math.ceil, round: Math.round,
  pow: Math.pow, log: Math.log, exp: Math.exp,
  clamp: (x, lo, hi) => Math.min(Math.max(x, lo), hi),
  lerp: (a, b, t) => a + (b - a) * t,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

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
      toks.push({ kind: 'num', value: src.slice(i, j) });
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

export function evaluateExpression(formula: string, vars: Record<string, number>): number {
  const toks = tokenize(formula);
  let pos = 0;

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
    let left = parsePower();
    while (peek() && peek().kind === 'op' && '*/%'.includes(peek().value)) {
      const op = next().value;
      const right = parsePower();
      if (op === '*') left = left * right;
      else if (op === '/') left = right === 0 ? 0 : left / right;
      else left = right === 0 ? 0 : left % right;
    }
    return left;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() && peek().kind === 'op' && peek().value === '^') {
      next();
      return Math.pow(base, parsePower()); // right-assoc
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() && peek().kind === 'op' && peek().value === '-') { next(); return -parseUnary(); }
    if (peek() && peek().kind === 'op' && peek().value === '+') { next(); return parseUnary(); }
    return parseAtom();
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
        return fn(...args);
      }
      if (t.value in vars && typeof vars[t.value] === 'number' && isFinite(vars[t.value])) return vars[t.value];
      if (t.value in CONSTS) return CONSTS[t.value];
      // Unknown variable defaults to 0 (unconnected input)
      return 0;
    }
    throw new Error(`Unexpected token '${t.value}'`);
  }

  const result = parseExpr();
  if (pos < toks.length) throw new Error(`Unexpected trailing input near '${toks[pos].value}'`);
  if (!isFinite(result) || isNaN(result)) return 0;
  return result;
}
