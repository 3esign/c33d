// ---------------------------------------------------------------------------
// IR COMPILER — deterministic expansion of an IrProgram into graph nodes/edges.
//
// The model emits a small typed program (see types.ts); this compiler expands
// it through the skill registry (skills.ts) into NODE_LIBRARY nodes with
// validator-canonical explicit handles. All wiring knowledge lives HERE, in
// code, instead of in the model's sampling distribution.
//
// INTEGRATION (additive; nothing imports this yet):
//   1. Prompt: include skillCatalogText() + IR protocol in buildSystemPrompt
//      (src/ai/agent.ts) as an alternative output mode.
//   2. Decode: constrain sampling with buildIrJsonSchema() (schema.ts) via
//      response_format json_schema (OpenAI/OpenRouter), format:<schema>
//      (Ollama structured outputs), responseSchema (Gemini).
//   3. Apply: const r = compileIr(program); on success feed r.graph into the
//      existing applyAndPerceive/validateGraphStructure pipeline (agent.ts);
//      on failure send r.issues back to the model as repair feedback (they are
//      written to be model-repairable, same style as executor warn messages).
// ---------------------------------------------------------------------------

import { NODE_LIBRARY } from '../../nodes/NodeDefinitions';
import type {
  CompileIssue, CompileResult, CompiledGraph, ExpandCtx, GraphEdge, GraphNode,
  IrOp, IrProgram, IrType, IrValue, NumArg, ValueRef,
} from './types';
import { resolveSkill, SKILLS } from './skills';

class CompileError extends Error {}

/**
 * Thrown when an op references a binding whose own op already failed. The body
 * loop swallows these WITHOUT recording an issue, so a single root cause
 * produces exactly one error instead of a cascade down every consumer.
 */
class PoisonedError extends Error {}

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Cap on reported body errors per attempt — enough to fix a lot in one round-trip, not a wall of text. */
const MAX_BODY_ISSUES = 8;

function isRefString(v: IrValue): v is string {
  return typeof v === 'string' && v.startsWith('$');
}

// ---------------------------------------------------------------------------
// Call-syntax parsing: "point(0, 0, -r*0.75)" → {op:'point', args:{x,y,z}}
//
// Models write constructor-call syntax constantly — it is how the skill catalog
// reads, so it is what they echo. Before Jul 25 every one of these was a hard
// failure at a reference argument ("must be a reference like \"$myCurve\"").
// Positional arguments map onto the skill's declared argument order; named
// forms ("point(x: 0, z: 5)") are also accepted.
// ---------------------------------------------------------------------------

const CALL_RE = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*)\)\s*$/;

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map(p => p.trim()).filter(p => p !== '');
}

/**
 * Parse a constructor-call string into an inline-op object, or null when the
 * string is not a call to a known skill (formulas like "sin(theta)*2" and plain
 * expressions fall through untouched — `sin` is not a skill).
 */
function parseCallSyntax(raw: string): { op: string; args: Record<string, any> } | null {
  const m = CALL_RE.exec(raw);
  if (!m) return null;
  const skill = resolveSkill(m[1]);
  if (!skill) return null;
  const argNames = Object.keys(skill.args);
  const parts = splitTopLevel(m[2]);
  if (parts.length > argNames.length) return null; // let the normal error path explain
  const args: Record<string, any> = {};
  for (let i = 0; i < parts.length; i++) {
    let piece = parts[i];
    let name = argNames[i];
    const kv = /^([A-Za-z_][A-Za-z0-9_]*)\s*[:=]\s*([\s\S]+)$/.exec(piece);
    if (kv && argNames.includes(kv[1])) { name = kv[1]; piece = kv[2].trim(); }
    if (!name) return null;
    piece = piece.replace(/^['"]|['"]$/g, '');
    const asNum = Number(piece);
    args[name] = (piece !== '' && isFinite(asNum)) ? asNum : piece;
  }
  return { op: skill.name, args };
}

// Function/constant names allowed inside formulas — identifiers in a formula
// that are NOT bindings and NOT one of these are left for the runtime scope
// (slider labels) to resolve.
// KEEP IN EXACT SYNC with the runtime evaluator (src/utils/expression.ts,
// SPEC-7): FUNCS + lerp + the constants pi/e/tau. Anything listed here that
// the runtime does not implement compiles clean and then fails at every
// consuming node ("random" was the worst offender — it does not exist at
// runtime and is intentionally absent: seeded jitter() is the sanctioned
// randomness).
const KNOWN_FUNCS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'min', 'max', 'floor', 'ceil', 'round', 'trunc',
  'pow', 'exp', 'log', 'log2', 'log10', 'mod', 'clamp', 'lerp',
  'pi', 'e', 'tau',
]);

export function compileIr(program: IrProgram): CompileResult {
  const issues: CompileIssue[] = [];
  const notes: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const env = new Map<string, ValueRef>();
  const usedIds = new Set<string>();
  // Bindings whose own op failed. Consumers of a poisoned binding fail SILENTLY
  // (PoisonedError), so one root cause yields one error, not one per consumer.
  const poisoned = new Set<string>();

  const freshId = (base: string): string => {
    const clean = ID_RE.test(base) ? base : base.replace(/[^A-Za-z0-9_]/g, '_') || 'n';
    if (!usedIds.has(clean)) { usedIds.add(clean); return clean; }
    let i = 2;
    while (usedIds.has(`${clean}_${i}`)) i++;
    usedIds.add(`${clean}_${i}`);
    return `${clean}_${i}`;
  };

  // ---- 1. params → NumberSlider nodes --------------------------------------
  for (const p of program.params ?? []) {
    if (!p || typeof p.name !== 'string' || !ID_RE.test(p.name)) {
      issues.push({ where: 'params', message: `Param name "${p?.name}" must be a plain identifier (letters/digits/underscore).` });
      continue;
    }
    if (env.has(p.name)) {
      issues.push({ where: 'params', message: `Duplicate param name "${p.name}".` });
      continue;
    }
    const id = freshId(p.name);
    nodes.push({
      id,
      type: 'NumberSlider',
      data: {
        value: p.value, label: p.name,
        min: p.min ?? 0, max: p.max ?? Math.max(100, p.value * 2), step: p.step ?? 0.1,
      },
    });
    env.set(p.name, { nodeId: id, handle: 'value', type: 'number' });
  }

  // ---- 2. body ops through the skill registry ------------------------------
  if (!Array.isArray(program.body) || program.body.length === 0) {
    issues.push({ where: 'body', message: 'Program body is empty — emit at least one op.' });
  }

  for (let i = 0; i < (program.body?.length ?? 0); i++) {
    const op = program.body[i];
    const where = `body[${i}] (${op?.let ?? '?'} = ${op?.op ?? '?'})`;
    try {
      if (!op || typeof op.let !== 'string' || !ID_RE.test(op.let)) {
        throw new CompileError(`Every op needs a "let" binding name (plain identifier). Got: ${JSON.stringify(op?.let)}.`);
      }
      if (env.has(op.let)) {
        throw new CompileError(`Binding "${op.let}" already exists — binding names must be unique.`);
      }
      const skill = resolveSkill(String(op.op ?? ''));
      if (!skill) {
        throw new CompileError(`Unknown op "${op.op}". Available ops: ${Object.keys(SKILLS).join(', ')}.`);
      }
      const args = op.args ?? {};
      for (const k of Object.keys(args)) {
        if (!(k in skill.args)) {
          throw new CompileError(`"${skill.name}" has no argument "${k}". Valid arguments: ${Object.keys(skill.args).join(', ')}.`);
        }
      }
      for (const [k, def] of Object.entries(skill.args)) {
        if (def.required && args[k] === undefined) {
          throw new CompileError(`"${skill.name}" requires argument "${k}" (${def.kind}).`);
        }
      }
      const ctx = makeCtx(skill.name, op, env, nodes, edges, freshId, notes, poisoned);
      const ref = skill.expand(ctx);
      env.set(op.let, ref);
    } catch (err: any) {
      // Jul-25: report ALL independent body errors in ONE attempt instead of
      // stopping at the first. Evidence (77-session audit): in every session
      // with multiple compile attempts the failing op index MOVED each time
      // (10→12→9, 28→8→24→29) — models fixed exactly what they were told and
      // died anyway, because they were told one thing at a time while the
      // budget was three attempts. The binding is poisoned so downstream
      // consumers stay silent and only ROOT causes are reported.
      if (typeof op?.let === 'string') poisoned.add(op.let);
      if (err instanceof PoisonedError) continue; // upstream already reported
      const bodyIssues = issues.filter(iss => iss.where.startsWith('body['));
      if (bodyIssues.length < MAX_BODY_ISSUES) {
        issues.push({ where, message: err?.message ?? String(err) });
      } else if (bodyIssues.length === MAX_BODY_ISSUES) {
        issues.push({ where: 'body', message: `More errors after this point were not reported — fix the ones listed above and resend.` });
      }
    }
  }

  // ---- 3. emit: leaves + colors ---------------------------------------------
  if (!Array.isArray(program.emit) || program.emit.length === 0) {
    issues.push({ where: 'emit', message: 'Emit at least one solid binding, e.g. {"ref": "$planets", "color": "#f59e0b"}.' });
  }
  for (let i = 0; i < (program.emit?.length ?? 0); i++) {
    const e = program.emit[i];
    const where = `emit[${i}]`;
    const name = typeof e?.ref === 'string' && e.ref.startsWith('$') ? e.ref.slice(1) : e?.ref;
    if (typeof name === 'string' && poisoned.has(name)) continue; // its op already reported
    const ref = typeof name === 'string' ? env.get(name) : undefined;
    if (!ref) {
      issues.push({ where, message: `Emit ref "${e?.ref}" does not match any binding. Bindings: ${[...env.keys()].join(', ')}.` });
      continue;
    }
    if (ref.type !== 'solid') {
      issues.push({ where, message: `Emit ref "$${name}" is a ${ref.type}; only solids render. Extrude/loft/instance it into a solid first.` });
      continue;
    }
    const node = nodes.find(n => n.id === ref.nodeId);
    if (node && e.color) node.data.color = e.color;
    if (edges.some(ed => ed.source === ref.nodeId && !ed.targetHandle.startsWith('param:'))) {
      notes.push(`Emitted binding "$${name}" is also consumed downstream — it will not render as a separate leaf (leaves are unconsumed nodes).`);
    }
  }

  if (issues.length > 0) return { graph: null, issues, notes };
  const graph: CompiledGraph = { nodes, edges };
  return { graph, issues, notes };
}

// ---------------------------------------------------------------------------
// ExpandCtx implementation
// ---------------------------------------------------------------------------

function makeCtx(
  skillName: string,
  op: IrOp,
  env: Map<string, ValueRef>,
  nodes: GraphNode[],
  edges: GraphEdge[],
  freshId: (base: string) => string,
  notes: string[],
  poisoned: Set<string> = new Set(),
): ExpandCtx {
  const args = op.args ?? {};
  let mintedPrimary = false;

  const fail = (message: string): never => { throw new CompileError(message); };

  /** Consuming a binding whose own op failed is not a new error — stay silent. */
  const checkPoison = (name: string): void => {
    if (poisoned.has(name)) throw new PoisonedError(name);
  };

  const resolveRef = (raw: string, argName: string): ValueRef => {
    const name = raw.slice(1);
    checkPoison(name);
    const ref = env.get(name);
    if (!ref) {
      fail(`Argument "${argName}" references "$${name}", which is not bound. Bindings so far: ${[...env.keys()].join(', ') || '(none)'}.`);
    }
    return ref!;
  };

  // ------- ERGONOMIC COERCIONS (Jul 22) --------------------------------------
  // The Jul-22 transcripts show models spending whole repair budgets on forms
  // the compiler COULD accept deterministically: nested op literals, bare
  // binding names without "$", {"x","y","z"} point literals, and arithmetic on
  // references. Each coercion below turns one of those hard failures into the
  // canonical expansion (with a note teaching the canonical form), so the turn
  // survives and the feedback stays honest.

  const isSliderRef = (r: ValueRef): boolean => {
    const n = nodes.find(nn => nn.id === r.nodeId);
    return !!n && n.type === 'NumberSlider';
  };

  // {"op":"point","args":{...}} nested inside another op's args → compile it
  // as its own step and use the resulting reference.
  const liftInlineOp = (rawObj: any, argName: string): ValueRef => {
    const subName = String(rawObj.op ?? '');
    if (!subName) {
      // Jul-25: an object with no "op" used to report `inline op "" is unknown`
      // plus the full 45-op menu — unrecoverable, because it described nothing
      // the model had actually written. Name the keys and guess the intent.
      const keys = Object.keys(rawObj ?? {});
      const has = (k: string) => keys.includes(k);
      const guess =
        (has('x') || has('y') || has('z')) ? 'point' :
        (has('formula')) ? 'expr' :
        (has('start') && has('count')) ? 'series' :
        (has('radius') && has('count')) ? 'on_circle' :
        (has('center') && has('radius')) ? 'circle' :
        (has('a') && has('b')) ? 'line' : null;
      fail(
        `Argument "${argName}" of "${skillName}": got an object with keys {${keys.join(', ') || 'none'}} but no "op" field, so there is nothing to build.` +
        (guess ? ` Did you mean {"op": "${guess}", "args": {${keys.map(k => `"${k}": ...`).join(', ')}}}?` : '') +
        ` Canonical form is a separate step: {"let": "myThing", "op": "...", "args": {...}} referenced as "$myThing".`,
      );
    }
    const subSkill = resolveSkill(subName);
    if (!subSkill) {
      fail(`Argument "${argName}" of "${skillName}": inline op "${subName}" is unknown. Available ops: ${Object.keys(SKILLS).join(', ')}.`);
    }
    const subArgs = rawObj.args ?? {};
    for (const k of Object.keys(subArgs)) {
      if (!(k in subSkill!.args)) {
        fail(`Inline "${subName}" (in argument "${argName}" of "${skillName}") has no argument "${k}". Valid arguments: ${Object.keys(subSkill!.args).join(', ')}.`);
      }
    }
    for (const [k, def] of Object.entries(subSkill!.args)) {
      if (def.required && subArgs[k] === undefined) {
        fail(`Inline "${subName}" (in argument "${argName}" of "${skillName}") requires argument "${k}" (${def.kind}).`);
      }
    }
    const subOp: IrOp = { let: `${op.let}_${argName}`, op: subName, args: subArgs };
    const subCtx = makeCtx(subSkill!.name, subOp, env, nodes, edges, freshId, notes, poisoned);
    const ref = subSkill!.expand(subCtx);
    notes.push(`Auto-lifted inline ${subName}() from "${op.let}.${argName}" into its own step — canonical form is a separate {"let": "...", "op": "${subName}", ...} referenced as "$name".`);
    return ref;
  };

  // Formula handling with COMPILE-TIME binding resolution: slider params may be
  // named directly (the runtime formula scope contains them), but computed
  // bindings (expr/series outputs) must be WIRED — auto-lift into expr() when
  // a formula names them, instead of failing at runtime with "unknown slider".
  const resolveFormula = (formulaRaw: string, argName: string): NumArg => {
    const formula = formulaRaw.replace(/\$/g, '');
    const ids = [...new Set([...formula.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)].map(m => m[0]))];
    const nonSliderBindings: string[] = [];
    for (const t of ids) {
      if (KNOWN_FUNCS.has(t)) continue;
      const r = env.get(t);
      if (!r) continue; // may be a runtime variable (slider label, a-d wire) — leave to runtime
      if (r.type !== 'number' && r.type !== 'number[]') {
        fail(`Argument "${argName}" of "${skillName}": formula "${formulaRaw}" uses "${t}", which is a ${r.type} binding — formulas can only use numbers.`);
      }
      if (!isSliderRef(r)) nonSliderBindings.push(t);
    }
    if (nonSliderBindings.length === 0) return { inline: formula };
    const letters = ['a', 'b', 'c', 'd'].filter(L => !ids.includes(L));
    if (nonSliderBindings.length > letters.length) {
      fail(`Argument "${argName}" of "${skillName}": formula "${formulaRaw}" references ${nonSliderBindings.length} computed bindings (${nonSliderBindings.join(', ')}) — too many to auto-wire. Precompute parts with expr() steps and reference the result.`);
    }
    let f2 = formula;
    const subArgs: Record<string, any> = {};
    nonSliderBindings.forEach((t, i) => {
      const L = letters[i];
      subArgs[L] = '$' + t;
      f2 = f2.replace(new RegExp(`\\b${t}\\b`, 'g'), L);
    });
    const ref = liftInlineOp({ op: 'expr', args: { formula: f2, ...subArgs } }, argName);
    notes.push(`Argument "${argName}" of "${skillName}": formula "${formulaRaw}" named computed binding(s) ${nonSliderBindings.map(b => `"${b}"`).join(', ')} — auto-wired via expr("${f2}"). Sliders can be named directly in formulas; computed bindings must be referenced as "$name" args.`);
    return { ref };
  };

  const typeOk = (t: IrType, accept: IrType[]): boolean =>
    accept.includes(t) ||
    // A single point/curve is acceptable where a list is expected and vice
    // versa at the graph level (arrays flow on the same handles).
    (accept.includes('point') && t === 'point[]') ||
    (accept.includes('point[]') && t === 'point');

  // -------------------------------------------------------------------------
  // REFERENCE-ARGUMENT COERCION (Jul 25)
  //
  // Reference arguments used to accept exactly three forms: "$binding",
  // {"op":…,"args":{…}} and a bare {x,y,z}. Everything else was a hard failure.
  // The 77-session audit found that 11 of 22 terminal compile deaths were a
  // CORRECT design intent in a rejected spelling — the same class of miss the
  // Jul-22 wave fixed for NUMBER arguments and never applied here:
  //     "vector(0, 0, 1)"                      constructor-call syntax
  //     "point(0, 0, -balloonRadius*0.75)"     ditto, with a formula inside
  //     ["$roofP1","$roofP2","$roofP3"]        list of refs where point[] wanted
  //     [{"x":"-(w+2*r)/2","y":0,"z":0}, …]    list of literals
  //     {"point":{"x":0,"y":0,"z":"h-r"}}      one redundant wrapper
  // Each is now lifted into canonical steps, with a note teaching the canonical
  // form. Genuinely unknown ops and bindings still fail honestly.
  // -------------------------------------------------------------------------

  /**
   * Merge several same-typed refs into one value: points via MergePoints,
   * solids via Compound. Both nodes take 8 inputs, so longer lists build a
   * balanced tree rather than failing — this is what removes the hard 4-part
   * assembly ceiling that killed 73-step programs on their last line.
   */
  const combineRefs = (refs: ValueRef[], accept: IrType[], argName: string): ValueRef => {
    const list = refs.filter(Boolean);
    if (list.length === 0) fail(`Argument "${argName}" of "${skillName}" has no usable entries.`);
    if (list.length === 1) return list[0];
    const asPoints = list.every(r => r.type === 'point' || r.type === 'point[]');
    const asSolids = list.every(r => r.type === 'solid');
    if (!asPoints && !asSolids) {
      fail(`Argument "${argName}" of "${skillName}": cannot combine entries of mixed types (${[...new Set(list.map(r => r.type))].join(', ')}). Build each kind separately.`);
    }
    const nodeType = asPoints ? 'MergePoints' : 'Compound';
    const handleOf = (i: number) => (asPoints ? `p${i + 1}` : `solid${i + 1}`);
    const outHandle = asPoints ? 'points' : 'solid';
    const outType: IrType = asPoints ? 'point[]' : 'solid';
    let level = list;
    let guard = 0;
    while (level.length > 1 && guard++ < 12) {
      const next: ValueRef[] = [];
      for (let i = 0; i < level.length; i += 8) {
        const chunk = level.slice(i, i + 8);
        if (chunk.length === 1) { next.push(chunk[0]); continue; }
        const inputs: Record<string, ValueRef> = {};
        chunk.forEach((r, j) => { inputs[handleOf(j)] = r; });
        next.push(ctx.out(ctx.node(nodeType, { inputs }), outHandle, outType));
      }
      level = next;
    }
    const merged = level[0];
    if (accept.length > 0 && !typeOk(merged.type, accept)) {
      fail(`Argument "${argName}" of "${skillName}" expects ${accept.join(' | ')}; combining those entries produced a ${merged.type}.`);
    }
    return merged;
  };

  const coerceRef = (raw: any, name: string, accept: IrType[]): ValueRef => {
    // 1. canonical "$binding"
    if (isRefString(raw)) {
      const ref = resolveRef(raw as string, name);
      if (!typeOk(ref.type, accept)) {
        fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; "$${(raw as string).slice(1)}" is a ${ref.type}.`);
      }
      return ref;
    }
    // 2. a list of things → coerce each entry, then merge into one value
    if (Array.isArray(raw)) {
      if (raw.length === 0) fail(`Argument "${name}" of "${skillName}" is an empty list.`);
      const parts = raw.map((el, i) => coerceRef(el, `${name}[${i}]`, accept));
      const merged = combineRefs(parts, accept, name);
      if (raw.length > 1) {
        notes.push(`Argument "${name}" of "${skillName}": combined ${raw.length} entries into one ${merged.type}. That is supported — for large sets a single generative step (points(), on_circle(), divide(), grid()) stays easier to edit.`);
      }
      return merged;
    }
    if (raw && typeof raw === 'object') {
      const obj = raw as Record<string, any>;
      // 3. inline op literal {"op":"point","args":{…}}
      if (typeof obj.op === 'string') {
        const ref = liftInlineOp(obj, name);
        if (!typeOk(ref.type, accept)) {
          fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; the inline ${obj.op}() produced a ${ref.type}.`);
        }
        return ref;
      }
      // 4. bare {x,y,z} where a point/vector is expected
      if (('x' in obj || 'y' in obj || 'z' in obj) && (accept.includes('point') || accept.includes('vector'))) {
        const kind = accept.includes('point') ? 'point' : 'vector';
        return liftInlineOp({ op: kind, args: { x: obj.x, y: obj.y, z: obj.z } }, name);
      }
      // 5. one redundant wrapper: {"point": {…}} / {"curve": "$c"}
      const keys = Object.keys(obj);
      if (keys.length === 1 && (accept as string[]).includes(keys[0])) {
        notes.push(`Argument "${name}" of "${skillName}": unwrapped a redundant {"${keys[0]}": …} wrapper — pass the value directly.`);
        return coerceRef(obj[keys[0]], name, accept);
      }
    }
    if (typeof raw === 'string') {
      // 6. bare binding name without the "$" prefix
      if (env.has(raw)) {
        checkPoison(raw);
        const ref = env.get(raw)!;
        if (!typeOk(ref.type, accept)) {
          fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; binding "${raw}" is a ${ref.type}.`);
        }
        notes.push(`Argument "${name}" of "${skillName}": treated "${raw}" as the binding "$${raw}" (add the "$" prefix to reference bindings).`);
        return ref;
      }
      // 7. constructor-call syntax: "point(0, 0, -balloonRadius*0.75)"
      const call = parseCallSyntax(raw);
      if (call) {
        const ref = liftInlineOp(call, name);
        if (!typeOk(ref.type, accept)) {
          fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; ${call.op}(…) produced a ${ref.type}.`);
        }
        return ref;
      }
    }
    return fail(`Argument "${name}" of "${skillName}" must be a reference like "$myCurve" (${accept.join(' | ')}), got ${JSON.stringify(raw)}.`);
  };

  const ctx: ExpandCtx = {
    num(name) {
      const a = ctx.numOpt(name);
      if (a === undefined) fail(`"${skillName}" requires numeric argument "${name}".`);
      return a!;
    },
    numOpt(name): NumArg | undefined {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (typeof raw === 'number') return { inline: raw };
      if (typeof raw === 'boolean' || Array.isArray(raw)) {
        fail(`Argument "${name}" of "${skillName}" must be a number, a formula string, or a "$binding" — got ${JSON.stringify(raw)}.`);
      }
      if (raw && typeof raw === 'object') {
        // Inline op object where a number is expected — auto-lift it.
        const ref = liftInlineOp(raw, name);
        if (ref.type !== 'number' && ref.type !== 'number[]') {
          fail(`Argument "${name}" of "${skillName}" needs a number; the inline ${(raw as any).op}() produced a ${ref.type}.`);
        }
        return { ref };
      }
      if (isRefString(raw)) {
        const refName = raw.slice(1);
        if (!ID_RE.test(refName)) {
          // "$podiumH + 0.5": arithmetic on a reference — resolve as a formula
          // (auto-wiring computed bindings through expr()).
          return resolveFormula(raw, name);
        }
        const ref = resolveRef(raw, name);
        if (ref.type !== 'number' && ref.type !== 'number[]') {
          fail(`Argument "${name}" of "${skillName}" needs a number; "$${raw.slice(1)}" is a ${ref.type}.`);
        }
        return { ref };
      }
      const asStr = String(raw);
      if (env.has(asStr)) {
        // Bare binding name without "$" — treat as the binding.
        const ref = env.get(asStr)!;
        if (ref.type === 'number' || ref.type === 'number[]') {
          if (isSliderRef(ref)) return { inline: asStr }; // slider names resolve in formulas
          notes.push(`Argument "${name}" of "${skillName}": treated "${asStr}" as the binding "$${asStr}" (add the "$" prefix to reference bindings).`);
          return { ref };
        }
        fail(`Argument "${name}" of "${skillName}" needs a number; binding "${asStr}" is a ${ref.type}.`);
      }
      return resolveFormula(asStr, name); // formula
    },
    inlineNum(name) {
      const v = ctx.inlineNumOpt(name);
      if (v === undefined) fail(`"${skillName}" requires argument "${name}" as an inline number or formula.`);
      return v!;
    },
    inlineNumOpt(name) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (typeof raw === 'number') return raw;
      if (typeof raw === 'string' && !isRefString(raw)) return raw;
      return fail(`Argument "${name}" of "${skillName}" must be an INLINE number or formula (e.g. 0.39 or "systemRadius*0.2"), not a reference.`);
    },
    ref(name, ...accept) {
      const r = ctx.refOpt(name, ...accept);
      if (!r) fail(`"${skillName}" requires argument "${name}" as a "$binding" (${accept.join(' | ')}).`);
      return r!;
    },
    refOpt(name, ...accept) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      return coerceRef(raw, name, accept);
    },
    refList(name, ...accept) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (Array.isArray(raw)) {
        if (raw.length === 0) fail(`Argument "${name}" of "${skillName}" is an empty list.`);
        return raw.map((el, i) => coerceRef(el, `${name}[${i}]`, accept));
      }
      return [coerceRef(raw, name, accept)];
    },
    combine(refs, ...accept) {
      return combineRefs(refs, accept, 'parts');
    },
    list(name) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (Array.isArray(raw)) return { literal: raw };
      if (typeof raw === 'number') return { literal: [raw] };
      if (typeof raw === 'boolean') {
        return fail(`Argument "${name}" of "${skillName}" must be a number list or "$binding", got a boolean.`);
      }
      if (raw && typeof raw === 'object') {
        // Inline op object where a list is expected — auto-lift it.
        const ref = liftInlineOp(raw, name);
        if (ref.type !== 'number[]' && ref.type !== 'number') {
          fail(`Argument "${name}" of "${skillName}" needs a number list; the inline ${(raw as any).op}() produced a ${ref.type}.`);
        }
        return { ref };
      }
      if (isRefString(raw)) {
        const ref = resolveRef(raw, name);
        if (ref.type !== 'number[]' && ref.type !== 'number') {
          fail(`Argument "${name}" of "${skillName}" needs a number list; "$${raw.slice(1)}" is a ${ref.type}.`);
        }
        return { ref };
      }
      if (typeof raw === 'string' && env.has(raw)) {
        // Bare binding name without "$" — wire the binding, not the string.
        const ref = env.get(raw)!;
        if (ref.type === 'number[]' || ref.type === 'number') {
          if (!isSliderRef(ref)) {
            notes.push(`Argument "${name}" of "${skillName}": treated "${raw}" as the binding "$${raw}" (add the "$" prefix to reference bindings).`);
            return { ref };
          }
        }
      }
      return { literal: [raw] }; // single formula string
    },
    str(name) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (typeof raw !== 'string') fail(`Argument "${name}" of "${skillName}" must be a string.`);
      return raw as string;
    },
    bool(name) {
      const raw = args[name];
      if (raw === undefined) return undefined;
      if (typeof raw !== 'boolean') fail(`Argument "${name}" of "${skillName}" must be true or false.`);
      return raw as boolean;
    },
    node(type, spec) {
      const def = NODE_LIBRARY[type];
      if (!def) fail(`[compiler bug] skill "${skillName}" expands to unknown node type "${type}".`);
      const id = freshId(mintedPrimary ? `${op.let}_x` : op.let);
      mintedPrimary = true;
      const data: Record<string, any> = {};
      const inputNames = new Set(def!.inputs.map(inp => inp.name));
      const numericParams = new Set(def!.params.filter(p => p.type === 'number').map(p => p.name));
      const declaredParams = new Set(def!.params.map(p => p.name));

      for (const [k, v] of Object.entries(spec?.params ?? {})) {
        if (v === undefined) continue;
        if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
          const na = v as NumArg;
          if (na.ref) {
            if (inputNames.has(k)) {
              edges.push({ source: na.ref.nodeId, sourceHandle: na.ref.handle, target: id, targetHandle: k });
            } else if (numericParams.has(k)) {
              edges.push({ source: na.ref.nodeId, sourceHandle: na.ref.handle, target: id, targetHandle: `param:${k}` });
            } else {
              fail(`[compiler bug] node "${type}" has neither input nor numeric param "${k}".`);
            }
          } else if (na.inline !== undefined) {
            if (!declaredParams.has(k) && !inputNames.has(k)) {
              fail(`[compiler bug] node "${type}" has no param "${k}".`);
            }
            data[k] = na.inline;
          }
        } else {
          data[k] = v;
        }
      }

      for (const [k, ref] of Object.entries(spec?.inputs ?? {})) {
        if (!ref) continue;
        if (!inputNames.has(k)) fail(`[compiler bug] node "${type}" has no input handle "${k}".`);
        edges.push({ source: ref.nodeId, sourceHandle: ref.handle, target: id, targetHandle: k });
      }

      nodes.push({ id, type, data });
      return id;
    },
    out(nodeId, handle, type) {
      return { nodeId, handle, type };
    },
    fail,
  };
  return ctx;
}
