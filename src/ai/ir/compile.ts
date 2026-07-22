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

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isRefString(v: IrValue): v is string {
  return typeof v === 'string' && v.startsWith('$');
}

// Function/constant names allowed inside formulas — identifiers in a formula
// that are NOT bindings and NOT one of these are left for the runtime scope
// (slider labels) to resolve.
const KNOWN_FUNCS = new Set([
  'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'sinh', 'cosh', 'tanh',
  'sqrt', 'cbrt', 'abs', 'sign', 'min', 'max', 'floor', 'ceil', 'round', 'trunc',
  'pow', 'exp', 'log', 'log2', 'log10', 'mod', 'clamp', 'random',
  'pi', 'PI', 'e', 'E', 'tau', 'TAU',
]);

export function compileIr(program: IrProgram): CompileResult {
  const issues: CompileIssue[] = [];
  const notes: string[] = [];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const env = new Map<string, ValueRef>();
  const usedIds = new Set<string>();

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
      const ctx = makeCtx(skill.name, op, env, nodes, edges, freshId, notes);
      const ref = skill.expand(ctx);
      env.set(op.let, ref);
    } catch (err: any) {
      issues.push({ where, message: err?.message ?? String(err) });
      // Programs are small: stop at the first body error so the model repairs
      // and resends the whole program (no cascading unknown-binding noise).
      return { graph: null, issues, notes };
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
): ExpandCtx {
  const args = op.args ?? {};
  let mintedPrimary = false;

  const fail = (message: string): never => { throw new CompileError(message); };

  const resolveRef = (raw: string, argName: string): ValueRef => {
    const name = raw.slice(1);
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
    const subCtx = makeCtx(subSkill!.name, subOp, env, nodes, edges, freshId, notes);
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
      if (!isRefString(raw)) {
        // Inline op literal: {"op":"point","args":{...}} → lift to its own step.
        if (raw && typeof raw === 'object' && !Array.isArray(raw) && typeof (raw as any).op === 'string') {
          const ref = liftInlineOp(raw, name);
          if (!typeOk(ref.type, accept)) {
            fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; the inline ${(raw as any).op}() produced a ${ref.type}.`);
          }
          return ref;
        }
        // Bare {"x","y","z"} literal where a point/vector is expected.
        if (
          raw && typeof raw === 'object' && !Array.isArray(raw) &&
          ('x' in (raw as any) || 'y' in (raw as any) || 'z' in (raw as any)) &&
          (accept.includes('point') || accept.includes('vector'))
        ) {
          const kind = accept.includes('point') ? 'point' : 'vector';
          const { x, y, z } = raw as any;
          return liftInlineOp({ op: kind, args: { x, y, z } }, name);
        }
        // Bare binding name without the "$" prefix.
        if (typeof raw === 'string' && env.has(raw)) {
          const ref = env.get(raw)!;
          if (!typeOk(ref.type, accept)) {
            fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; binding "${raw}" is a ${ref.type}.`);
          }
          notes.push(`Argument "${name}" of "${skillName}": treated "${raw}" as the binding "$${raw}" (add the "$" prefix to reference bindings).`);
          return ref;
        }
        fail(`Argument "${name}" of "${skillName}" must be a reference like "$myCurve" (${accept.join(' | ')}), got ${JSON.stringify(raw)}.`);
      }
      const ref = resolveRef(raw as string, name);
      if (!typeOk(ref.type, accept)) {
        fail(`Argument "${name}" of "${skillName}" expects ${accept.join(' | ')}; "$${(raw as string).slice(1)}" is a ${ref.type}.`);
      }
      return ref;
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
