// ---------------------------------------------------------------------------
// Typed Intermediate Representation (IR) for prompt→graph compilation.
//
// WHY THIS EXISTS
// The model used to hand-emit 40+ low-level nodes with explicit handles — every
// wiring/handle/kernel mistake in the transcripts lives at that layer. With the
// IR, the model emits a SHORT typed program (one line per design intention:
// "remap these orbit radii to 0.2..1", "instance this sphere on those points")
// and a deterministic compiler (compile.ts) expands it into NODE_LIBRARY nodes
// with validator-canonical explicit handles. The compiler cannot hallucinate a
// handle, cannot pick Pipe for a closed ring, and produces precise, repairable
// error messages when the program itself is wrong.
//
// Each IR op is a SKILL: a named geometric constructor with a typed signature
// (Grasshopper-style overloads — line(a,b) vs line_sdl(start,direction,length))
// and a deterministic expansion. The skill registry lives in skills.ts.
// ---------------------------------------------------------------------------

/** Types a binding (a `let`) can have inside an IR program. */
export type IrType =
  | 'number' | 'number[]'
  | 'point' | 'point[]'
  | 'vector' | 'plane' | 'curve' | 'solid' | 'selection'
  | 'string' | 'boolean';

/**
 * Values inside op args:
 *  - number / boolean literals
 *  - strings starting with "$"  → reference to a prior `let` binding OR a param
 *  - other strings              → inline formula ("systemRadius*0.2") or plain string
 *  - arrays of numbers/strings  → data literals (compiled to ListConstant)
 *  - objects                    → ERGONOMIC forms the compiler auto-lifts
 *                                 (Jul 22): {"op":"point","args":{...}} nested
 *                                 constructors become their own step, and bare
 *                                 {"x":..,"y":..,"z":..} literals become
 *                                 point()/vector() where a point/vector is
 *                                 expected. Models write these constantly; the
 *                                 canonical $ref form remains preferred.
 */
export type IrValue =
  | number | string | boolean
  | (number | string)[]
  | { [key: string]: any };

export interface IrOp {
  /** Binding name; later ops reference this result as "$<name>". */
  let: string;
  /** Skill name from the registry, e.g. "circle", "remap", "instances". */
  op: string;
  args: Record<string, IrValue>;
}

export interface IrParam {
  /** Slider name; referenced by name inside formulas ("R*0.04"). */
  name: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
}

export interface IrEmit {
  /** "$<name>" of a solid-typed binding to render as a leaf. */
  ref: string;
  /** Hex color for multi-color rendering, e.g. "#3b82f6". */
  color?: string;
}

export interface IrProgram {
  /** One-line restatement of the user's intent (used for logging/verification). */
  intent?: string;
  /** Design parameters — become NumberSlider nodes. */
  params?: IrParam[];
  /** The program body, executed top to bottom. */
  body: IrOp[];
  /** Which bindings are the visible leaves. */
  emit: IrEmit[];
}

// ---------------------------------------------------------------------------
// Compilation output (shape-compatible with WorkingGraph in src/ai/tools.ts)
// ---------------------------------------------------------------------------

export interface GraphNode { id: string; type: string; data: Record<string, any>; }
export interface GraphEdge { source: string; target: string; sourceHandle: string; targetHandle: string; }
export interface CompiledGraph { nodes: GraphNode[]; edges: GraphEdge[]; }

export interface CompileIssue {
  /** Binding name / section that failed ("body[3] orbitR", "emit[0]"). */
  where: string;
  message: string;
}

export interface CompileResult {
  graph: CompiledGraph | null;
  issues: CompileIssue[];
  /** Non-fatal observations (e.g. emitted node is consumed downstream). */
  notes: string[];
}

/** A reference to a value produced by a compiled node. */
export interface ValueRef {
  nodeId: string;
  /** Declared output handle name (validator-canonical). */
  handle: string;
  type: IrType;
}

/** A numeric argument: inline literal/formula, or a reference to a number binding. */
export interface NumArg {
  inline?: number | string;
  ref?: ValueRef;
}

// ---------------------------------------------------------------------------
// Skill definitions
// ---------------------------------------------------------------------------

export type SkillArgKind =
  | 'num'      // number literal, formula string, or $ref to a number binding
  | 'num[]'    // data-list literal or $ref to a number[] binding
  | 'point' | 'point[]' | 'vector' | 'plane' | 'curve' | 'solid'
  | 'string' | 'bool';

export interface SkillArg {
  kind: SkillArgKind;
  required?: boolean;
  doc?: string;
}

/**
 * The expansion context handed to a skill. Implemented by the compiler.
 * `node()` is the single node-creation primitive: numeric NumArgs become inline
 * data (literal/formula) or — when they are $refs — edges into the node's input
 * handle of the same name (falling back to a "param:<name>" edge).
 */
export interface ExpandCtx {
  /** Required numeric arg. */
  num(name: string): NumArg;
  /** Optional numeric arg. */
  numOpt(name: string): NumArg | undefined;
  /** Numeric arg that MUST be inline (literal or formula), never a $ref. */
  inlineNum(name: string): number | string;
  inlineNumOpt(name: string): number | string | undefined;
  /** Required geometry/list reference of one of the accepted types. */
  ref(name: string, ...accept: IrType[]): ValueRef;
  refOpt(name: string, ...accept: IrType[]): ValueRef | undefined;
  /** number[] arg: a $ref to a list binding, or a data literal. */
  list(name: string): { ref?: ValueRef; literal?: (number | string)[] } | undefined;
  str(name: string): string | undefined;
  bool(name: string): boolean | undefined;

  /**
   * Create a node. `params` values: number/string/boolean → inline data;
   * NumArg → inline data or input/param edge; undefined → skipped.
   * `inputs` values: ValueRef → edge with explicit declared handles.
   */
  node(
    type: string,
    spec?: {
      params?: Record<string, number | string | boolean | NumArg | undefined>;
      inputs?: Record<string, ValueRef | undefined>;
    },
  ): string;

  /** Build a ValueRef for an output of a created node. */
  out(nodeId: string, handle: string, type: IrType): ValueRef;

  /** Abort this op's expansion with a precise, model-repairable message. */
  fail(message: string): never;
}

export interface SkillDef {
  name: string;
  /** One line shown to the model in the skill catalog. */
  doc: string;
  args: Record<string, SkillArg>;
  returns: IrType;
  expand(ctx: ExpandCtx): ValueRef;
}
