import { chatCompletion, chatCompletionWithTools, providerSupportsTools, providerSupportsVision } from './api';
import type { AgentMessage } from './api';
import { useStore, generateUUID, waitForEvaluation } from '../store/useStore';
import { NODE_LIBRARY } from '../nodes/NodeDefinitions';
import { AGENT_TOOLS, executeTool, geoInputHandles, allInputHandles, numberInputHandles, describeWireableInputs, defaultSourceHandle, pickTargetHandle } from './tools';
import type { WorkingGraph } from './tools';
import { autoLayout } from '../layout/autoLayout';
import { retrieveSimilarExamples, formatExampleForPrompt, condenseGraph } from './retrieval';
import { checkGeometrySanity, formatGeometryReport, runVisionVerification, computeGraphShapeMetrics } from './verification';
import { validateGraphStructure, inferMissingEdges } from './graphValidation';
import { validateGenome, scoreIntentRealization } from './genome';
import { captureViewportSnapshot } from '../utils/snapshot';
import { isSystemError } from '../utils/errors';
import { compileIr } from './ir/compile';
import { skillCatalogText } from './ir/skills';
import { buildIrJsonSchema } from './ir/schema';
import type { IrProgram } from './ir/types';

const MAX_AGENT_TURNS = 8;
const MAX_AUTO_REPAIRS = 2;

// A provider/auth/quota/region error is NOT a graph or protocol problem — no
// repair round, JSON fallback, or grammar change will fix it. Falling through to
// the legacy JSON path just re-hits the same dead provider and burns credits
// (the "403 key-limit" and region-lock loops in the Jul-18 session). Detect them
// so processUserIntent can abort the episode cleanly instead.
function isFatalProviderError(msg: string): boolean {
  return /\b(401|402|403|429)\b/.test(msg)
    || /key limit|limit exceeded|quota|rate.?limit|insufficient|only available in|unauthor|forbidden|payment required/i.test(msg);
}
function summarizeProviderError(msg: string): string {
  if (/key limit|limit exceeded|quota/i.test(msg)) return 'API key limit / quota exceeded';
  if (/only available in|region/i.test(msg)) return 'model is region-locked for your key';
  if (/401|unauthor/i.test(msg)) return 'authentication failed — check the API key';
  if (/429|rate.?limit/i.test(msg)) return 'rate limited — wait and retry';
  if (/402|payment/i.test(msg)) return 'payment required';
  if (/403|forbidden/i.test(msg)) return 'access forbidden';
  return msg.slice(0, 120);
}

// Anti-anchoring (Jul-18): on open-ended creative briefs, retrieval injects a
// stored exemplar's plan + graph and models re-render it near-verbatim — three
// different providers produced identical "layered rose" plans. Nudge each
// creative run down a different design axis with a per-run seed so the space
// stays open. Only for real user turns (evals stay reproducible).
function maybeVariationDirective(userText: string): string | null {
  const t = userText.toLowerCase();
  const creative = /\b(beautiful|stunning|elegant|organic|artistic|creative|interesting|unique|surprise|best|most|gorgeous|striking)\b/.test(t)
    && !/\b\d+\s?(mm|cm|m|units?|degrees?|x)\b/.test(t); // dimensioned briefs are engineering, not creative
  if (!creative) return null;
  const axes = [
    'silhouette: favour an asymmetric, off-balance composition this time',
    'rhythm: use a non-uniform gradient (137.5° phyllotaxis or a golden-ratio taper) across repeated parts',
    'proportion: exaggerate one dominant feature and keep the rest restrained',
    'curvature: let primary lines sway/bend rather than run straight or perfectly radial',
    'density: vary instance spacing/size with a field instead of copying identical parts',
    'stance: introduce a deliberate lean or spiral rather than upright symmetry',
    'contrast: pair one large gestural form with fine repeated detail',
  ];
  const seed = Math.floor(Math.random() * 1e6);
  const axis = axes[seed % axes.length];
  return `[Variation directive — seed ${seed}: This is a creative brief. Do NOT reproduce a previous/standard solution. Take a distinct interpretation. Emphasis this run — ${axis}. Keep it parametric (relations over magic numbers).]`;
}

// ---------- JSON repair (legacy fallback path) ----------
function robustJSONParse(text: string): any {
  if (typeof text !== 'string') {
    throw new Error("AI did not return any text response.");
  }
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON. Response was: " + text);
  }
  let jsonStr = jsonMatch[0];
  if (!jsonStr) {
    throw new Error("AI returned empty JSON match.");
  }
  jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');
  jsonStr = jsonStr.split('\n')
    .map(line => {
      const trimmed = line.trim();
      if (trimmed.startsWith('//')) return '';
      const commentIdx = line.indexOf('//');
      if (commentIdx !== -1) {
        const partBefore = line.substring(0, commentIdx);
        const doubleQuoteCount = (partBefore.match(/"/g) || []).length;
        if (doubleQuoteCount % 2 === 0) return partBefore;
      }
      return line;
    })
    .join('\n');
  jsonStr = jsonStr.replace(/,\s*(\r?\n?\s*[\}\]])/g, '$1');
  try {
    return JSON.parse(jsonStr);
  } catch (e: any) {
    try {
      const repaired = jsonStr.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, (match) => match.replace(/\r?\n/g, '\\n'));
      return JSON.parse(repaired);
    } catch (e2) {
      throw new Error(`AI returned malformed JSON: ${e.message}. Raw extracted text was:\n${jsonStr}`);
    }
  }
}

// ---------- System prompt (dieted) ----------
function condensedNodeLibrary(): string {
  return Object.values(NODE_LIBRARY)
    .filter(n => n.type !== 'Macro')
    .map(node => {
      const inputsStr = node.inputs.map(i => `${i.name}:${i.type}`).join(', ');
      const outputsStr = node.outputs.map(o => `${o.name}:${o.type}`).join(', ');
      const paramsStr = node.params.map(p => `${p.name}(${p.type},default ${p.default}${p.min !== undefined ? `,${p.min}..${p.max}` : ''})`).join(', ');
      return `- ${node.type}: in[${inputsStr}] out[${outputsStr}] params[${paramsStr}]`;
    }).join('\n');
}

function macroLibraryText(): string {
  const { macros } = useStore.getState();
  if (macros.length === 0) return '';
  return `\n### AVAILABLE MACROS (verified reusable components — prefer these over rebuilding from primitives):\n` +
    macros.map(m =>
      `- Macro "${m.name}" (macroId: "${m.id}"): ${m.description}. Params: [${m.exposedParams.map(p => `${p.name}(default ${p.default})`).join(', ')}]. Use: add_nodes with type "Macro", data { macroId: "${m.id}", <paramName>: <value> }.`
    ).join('\n');
}

async function buildSystemPrompt(userText: string, forTools: boolean): Promise<string> {
  const store = useStore.getState();

  // Retrieval: verified examples similar to this request
  let examplesSection = '';
  try {
    const similar = await retrieveSimilarExamples(userText, store.successExamples, 2);
    if (similar.length > 0) {
      examplesSection = `\n### VERIFIED PAST EXAMPLES (user-confirmed successes for similar requests — reuse their construction patterns):\n` +
        similar.map((ex, i) => formatExampleForPrompt(ex, i)).join('\n\n');
    }
  } catch (e) { /* retrieval is best-effort */ }

  const core = `You are C33D, an expert computational designer. You design 3D objects by building PARAMETRIC NODE GRAPHS that a B-Rep CAD kernel (OpenCascade) evaluates deterministically. The graph — not the geometry — is your medium: think in construction operations, attachments, and proportional relationships.

### NODE LIBRARY:
${condensedNodeLibrary()}
${macroLibraryText()}

### CONCEIVE, THEN BUILD (do this thinking BEFORE emitting any node):
A graph is a web of RELATIONSHIPS, not a pile of positioned parts. Conceive the design in this order:
1. SKELETON — name the object's driving structure: its main axis or path, its ground contact, its profile or silhouette. If any part follows a path/boundary/profile, that curve or point set IS the design; big forms derive from it.
2. ANCHORS — decide every part's position as a relationship, never a coordinate: "on top of the base" (Align), "at the tip of the body" (Centroid/BoundingBox/Endpoints point → a primitive's "center"), "along the rim" (DivideCurve → InstanceOnPoints), "hinged at the wing root" (Rotate with "pivot"). If you are about to type a coordinate arithmetic like "-shipLength*0.36", stop and name the anchor it approximates — then wire that anchor instead.
3. DRIVERS — 2-5 labeled sliders; every dimension a formula of them.
4. EMIT COMPACTLY — the fewest nodes that express the relationships. A Point into a primitive's "center" replaces a Rotate+Translate chain; an "axis" Vector replaces a Rotate-90.
The geometry report measures this: "Placement provenance" counts how many leaves are anchored vs. literally offset. Aim for anchored.

### CORE RULES:
1. Z is UP. The XY plane is the ground. The Plane node is a true 2D face on XY (Z=0); use Rotate (angle + axisX/axisY/axisZ) to orient shapes.
2. Data flow — TWO SPINES. (a) SOLID spine: primitives output "solid"; transforms take a "solid" (or named) input and output "solid"; Boolean takes "target" + "tool"; every transform input MUST be connected. (b) SKELETON spine: Point and Curve nodes are construction geometry that big forms DERIVE from — rails to loft (LoftCurves), paths to pipe/sweep (Pipe with its "path" input, SweepAlongCurve), boundaries to divide into placement points (DivideCurve → InstanceOnPoints), profiles to revolve/extrude (RevolveCurve, ExtrudeCurve). Large smooth forms, rhythms, and anything that must FOLLOW a shape belong on the skeleton spine; boxy mechanical assemblies belong on the solid spine.
3. No loops exist. For repeated/scattered shapes use LinearPattern, CircularPattern, ScatterOnSurface, PlaceOnVertices — never dozens of duplicated nodes.
4. PARAMETRIC DESIGN (essential — read carefully): create 2–5 NumberSlider nodes as the top-level design parameters, and give each a clear "label" (e.g. data {"label":"bodyRadius","value":6}). To make ANY numeric parameter depend on them, set that parameter's VALUE TO A FORMULA STRING referencing slider labels — NOT a separate node. Examples: a Cone with data {"radius1":"bodyRadius*1.3","radius2":"bodyRadius*0.6","height":"stage1Height*0.2"}; a Translate with data {"z":"stage1Height*0.6 + stage1Height/2"}. Formulas support + - * / ^ %, parentheses and functions (min, max, abs, sqrt, sin, cos, clamp, lerp, …). Do NOT build Expression nodes or "param:" edges for this kind of scalar math — inline formula strings are strongly preferred, need zero edges, and keep the graph small and robust. When a slider moves, every formula re-evaluates so the whole model rescales. (Expression / Series / Range nodes exist only for list/loop math, not for simple dimensions.) THE INTERCONNECTION IS THE DESIGN: derive parts from SHARED sliders so proportions are coupled (wheelRadius "carLength*0.09", cabin "carLength*0.45") — a slider that drives only one isolated shape, or a dimension typed as a bare number, is a design failure. Recommended slider labels: carLength, carWidth, carHeight, wheelRadius, wheelWidth (for cars); rockSize, rockRoughness, rockScale (for rocks); buildingHeight, buildingWidth, columnRadius, columnHeight, domeRadius (for buildings); stemHeight, stemRadius, petalCount, petalLength, petalWidth, centerRadius (for flowers). The geometry report will call out hard-coded dimensions and dead sliders; rewire them before finishing.
5. Placement: RELATIVE, never arithmetic. Translate between parts is forbidden; use Align or geometric sockets. GEOMETRIC SOCKETS (preferred): every solid primitive (Box/Sphere/Cylinder/Cone/Ellipsoid/Torus) has an optional "center" Point input — wire a Point/Centroid/Midpoint/PointBetween/DivideCurve output into it to place the primitive where geometry says, with zero Translate nodes. Cylinder/Cone/Torus also take an "axis" Vector input that tilts them onto the vector (no more Rotate 90 boilerplate). Rotate takes an optional "pivot" Point (rotation centre — hinges, joints, petal roots) and "axis" Vector. Translate takes an optional "target" Point that overrides x/y/z. Translate is only for small nudges, and its vector components must be formulas of a driver slider, never literals. To stack or attach a part next to another, use the Align node (inputs "shape" + "reference"; param mode: above/below/left/right/front/back/center/ground, plus offsetX/Y/Z) — it snaps the shape's bounding box against the reference's, so you never hand-compute stacking coordinates. Example rocket: nozzle at origin → Align(shape=stage1, reference=nozzle, mode "above") → Align(shape=stage2, reference=that Align, mode "above") → … A part used as an Align reference STILL renders as its own colored leaf (reference edges do not consume it). Chain each next Align's reference to the PREVIOUS Align node (not the raw part) so the stack stays connected when sliders move. Use mode "ground" (no reference needed) to sit a part on Z=0. For attaching onto curved surfaces use PlaceOnSurface u/v, PlaceOnVertices, ScatterOnSurface.
6. Multi-color rendering: leaf nodes (no outgoing edges) mesh separately, each with its own "color" param traced from its subgraph. Keep sub-assemblies as separate leaves for multi-color models; merge with Boolean/Compound only what must be single-color/solid.
7. Detailing: SubdivideSurface and FilterFaces carve panels/windows/facades out of base solids. Loft between profiles for tapered/organic forms. Revolve a Sketch profile for rotationally symmetric parts (vases, domes, wheels).
7b. ORGANIC FORMS: use ScaleXYZ (non-uniform squash/stretch, isLocal default) to turn spheres into petals/leaves/discs/cushions — e.g. Sphere→ScaleXYZ(1, 0.4, 0.15) is a cupped petal, far better than a thin extruded sketch. Ellipsoid and Torus are direct primitives (seed heads, rings, tires, wreaths). CircularPattern supports startAngle (phase-offset interleaved petal rings), rise (z per copy → spirals/phyllotaxis), and scaleStart/scaleEnd (instances grade in size — natural, not mechanical). For a flower: petal = Ellipsoid or ScaleXYZ'd Sphere, tilted with Rotate(isLocal), Translate outward, CircularPattern with count=petalCount; second ring with startAngle "180/petalCount" and smaller scale.
7c. SUB-SHAPE EDITING & SELECTIONS: use SelectFaces / SelectEdges (outputs "Selection") to target specific sub-faces or edges of a solid using a query predicate. Predicate queries support: "normal ~ +Z" (normal near direction), "center.z > 5" (face/edge centroid position), "parallel Z" (edge direction), "area > 10" (face area), "length < 5" (edge length), "coplanar" or "coaxial" checks. Boolean combinators (and, or, not) and parentheses are supported (e.g., "normal ~ +Z and center.z > 10"). Connect the Selection into ExtrudeFace (param height: positive to pull, negative to push/cut) or Fillet/Chamfer to modify the targeted sub-shapes. Use SplitLoop(solid, axis, at) to imprint edge loops (slice the outer face mesh into separate sub-faces) before selecting them; this allows localized extrusions/details on a single base solid. Note: Selection nodes output a Selection descriptor (resolved on execution); do not connect them to "solid" ports.
7d. CONSTRUCTION LADDER — pick the strategy BEFORE picking nodes: shell/bowl/hull/organic skin → 2-3 rail curves at heights (EllipseCurve/SplineCurve + TransformCurve) → LoftCurves. tube/cable/rail/stem → OPEN curve → Pipe (connect the curve to its "path" input). ring/torus/hoop (small circle swept around a big circle) → Torus (majorRadius, minorRadius) — NEVER Pipe along a closed CircleCurve; the kernel fails on closed paths. repeated elements along a boundary (columns, windows, seats, spokes) → curve → DivideCurve → InstanceOnPoints (alignToTangent to follow the curve, scaleStart/scaleEnd to grade sizes). rotationally symmetric → profile curve → RevolveCurve. flat footprint/slab → closed curve → ExtrudeCurve. boxy/mechanical → primitives + Align. If ONE driving curve can generate the whole form, prefer it over assembling primitives — move one slider and everything follows. Curves and points are cheap construction geometry: they render as thin guides, never block leaves, and the report lists their coordinates.
8. Style: vary construction strategies and aesthetics between requests — do not repeat one formulaic design.
9. When the user asks for a completely NEW object, clear the graph first so old geometry does not overlap.
10. TEXT ANSWERS: when the user asks a question or requests feedback, critique, a report, an explanation, or advice, ANSWER IN TEXT and leave the graph alone. Do NOT build geometry to "represent" your answer — no 3D text banners, no "conceptual architecture" sculptures, no symbolic diagrams. Only build or modify geometry when the user asks for an object or a change to one.

### VERIFICATION LOOP:
After graph changes you receive a GEOMETRY REPORT: per-leaf bounding boxes, volumes, node errors, scene extents, the slider inventory (names your formulas can reference), graph size, and PLACEMENT PROVENANCE (how many leaves are anchored to geometry vs. positioned by literal offsets — literal-offset assemblies only "fit" at current slider values, so rewire the named nodes onto anchors). READ IT. Compare sizes, positions and proportions against your plan (e.g. wheels bbox z-min should be at ground 0; parts should not be far from the scene bulk). Node errors saying a Fillet/Chamfer/Shell "passed the solid through" mean that feature silently did nothing — shrink its parameter instead of ignoring it. If the graph size grew across repairs, remove stale duplicate nodes rather than adding more. Fix discrepancies before declaring success.

### COMMON CORRECTIONS (recurring traps — get these right the first time):
- Ring/torus: to sweep a small circle around a bigger circle, use a Torus (majorRadius, minorRadius). Do NOT Pipe along a closed CircleCurve — the kernel fails on closed paths.
- Scatter with random/graded sizes: InstanceOnPoints uses scaleStart and scaleEnd (NOT scaleMin/scaleMax/seed). Feed a Solid into "shape" and the DivideCurve points into "points"; its output is the scattered copies.
- EXACT per-instance sizes (e.g. spheres with per-point radii): PointsFromLists takes number LISTS (Series/Range/Expression) on x/y/z AND a "scale" list — each point carries its own scale, and InstanceOnPoints applies it per instance (the per-point scale channel beats scaleStart/scaleEnd). One point node + one instancer = a whole array of individually-sized shapes.
- Placing one primitive at a derived position: wire the Point into the primitive's "center" input directly. Do NOT build primitive→Rotate→Translate chains — that is 3 nodes and 2 guessed coordinates where 1 edge suffices.
- Points ON a circle: CircleCurve → DivideCurve(count) yields points on the circumference — wire those into InstanceOnPoints.points. A lone Sphere with no instancer just sits at the origin (this is the "spheres in the centre" mistake).
- Edges: omit sourceHandle/targetHandle — they are inferred from the ports. Never put a "solid" output on a Point/Vector/Curve node.
- Output budget: keep "reasoning" short and emit the graph compactly; an over-long plan truncates the JSON and fails the whole turn.
${examplesSection}

### USER GUIDELINES:
${store.agentGuidelines}

### CURRENT GRAPH (condensed):
${store.nodes.length > 0 ? condenseGraph(store.nodes as any[], store.edges as any[]) : '(empty)'}`;

  if (forTools) {
    return core + `

### HOW TO WORK (tools):
1. For a new design: call set_plan first — include the GENOME (archetype + parts with roles/counts, e.g. petals count "petalCount" of petal on bloom) plus the SKELETON (driving curves/points and what derives from each), then parts, attachments, governing ratios. The genome records your intended detail so it is preserved even if repairs simplify the graph — if you plan 3 petal rings, build 3. Then clear_graph if replacing, then add_nodes + connect (batch related calls), then read the geometry report, repair if needed, and call finish with a short summary.
2. For modifications: update_nodes / connect / remove_nodes on the existing graph — do not rebuild everything.
3. If the request is genuinely ambiguous, call ask_user with 1-3 targeted questions instead of guessing.
4. Do NOT emit node positions — layout is automatic.
5. For questions/feedback/reports (CORE RULE 10): reply in plain text with NO tool calls — that text is shown to the user directly.`;
  }

  return core + `

### OUTPUT PROTOCOL (respond ONLY with raw JSON, no markdown):

PREFERRED — for a NEW design or a full rebuild, emit an IR PROGRAM. The compiler expands it into the graph deterministically: no node ids, no handles, no wiring — mistakes are impossible at that layer. Shape:
{
  "intent": "one sentence describing the design",
  "genome": {"archetype":"tapered-tower","detailBudget":"medium","parts":[{"id":"tower","role":"focal"}]},
  "params": [{"name":"totalHeight","value":40,"min":10,"max":100}],
  "body": [
    {"let":"profile","op":"circle","args":{"radius":"totalHeight*0.2"}},
    {"let":"tower","op":"extrude","args":{"curve":"$profile","height":"totalHeight"}}
  ],
  "emit": [{"ref":"$tower","color":"#3b82f6"}]
}
The optional "genome" field records WHAT you intend (archetype + parts with roles/counts) so your planned detail is preserved even if repairs simplify the graph. Include it for new designs.
IR RULES: each op binds its result to "let"; later args reference bindings as "$name". Numeric args accept literals (5), formulas of param names ("totalHeight*0.2"), or "$refs" to number bindings. Data lists are literals ([0.39, 0.72, 1.0]). Think DATA-FIRST: sort/remap real data into lists, derive point skeletons from the lists, and generate solids at the very END (one source shape + instances beats many primitives).
AVAILABLE OPS (name(args, ?=optional) -> returns — meaning):
${skillCatalogText()}

For SMALL EDITS to the existing graph, use the legacy patch protocol instead:
{
  "reasoning": "[string] 1-2 sentences. EXCEPTION: for questions/feedback/reports (CORE RULE 10) put your FULL text answer here and include NO graph fields at all — that is a complete, valid response.",
  "questions": ["clarifying questions, or empty array"],
  // OPTION A - PATCH: "addedNodes": [{"id","type","data"}], "updatedNodes": [{"id","data"}], "removedNodeIds": [], "addedEdges": [{"source","target"}], "removedEdgeIds": [{"source","target"}]  (remove edges by their {source,target} — a bare "source->target" string also works)
  // OPTION B - NEW OBJECT: "clearGraph": true plus full "nodes": [{"id","type","data"}] and "edges": [...]
}
EDGES (patch protocol only): just give {"source","target"} — BOTH handles are inferred from the node library. Param edges need explicit targetHandle "param:<name>". Do NOT include node positions — layout is automatic. Every node id must be unique.`;
}

// ---------- Shared helpers ----------

export interface IntentOutcome {
  parsedOk: boolean;
  evaluatedOk: boolean;
  geometrySane: boolean;
  nodeCount: number;
  edgeCount: number;
  durationMs: number;
  visionScore?: number;
  proportionalIntegrity?: number;
  // Graph-shape metrics (Workstream C): trend these across models/builds to
  // see whether derivation-based construction is actually improving.
  derivationRatio?: number;
  skeletonNodes?: number;
  magicNumberCount?: number;
  error?: string;
  repairRounds?: number;
  realizationScore?: number;
  deferredDetail?: string[];
}

function addSystemMessage(content: string) {
  useStore.getState().addMessage({ id: generateUUID(), role: 'system', content });
}
function addAssistantMessage(content: string) {
  useStore.getState().addMessage({ id: generateUUID(), role: 'assistant', content });
}

// Cross-tool parameter synonyms (Grasshopper / other-CAD priors the model
// reaches for). Keys and values are lowercased; a synonym only maps when THIS
// node actually has the canonical param, so a real typo on an unrelated node
// still surfaces as an error. Without this, one stray param made add_nodes
// reject the ENTIRE node — the origin of the "spheres never instantiated" loop
// (InstanceOnPoints "scaleMin"/"scaleMax"/"seed" → node dropped → no points).
const PARAM_SYNONYMS: Record<string, string> = {
  scalemin: 'scalestart', minscale: 'scalestart', startscale: 'scalestart', minsize: 'scalestart', sizemin: 'scalestart',
  scalemax: 'scaleend', maxscale: 'scaleend', endscale: 'scaleend', maxsize: 'scaleend', sizemax: 'scaleend',
  num: 'count', number: 'count', divisions: 'count', segments: 'count', samples: 'count', resolution: 'count', copies: 'count', instances: 'count',
  major: 'majorradius', minor: 'minorradius', tuberadius: 'minorradius', tube: 'minorradius',
};
// Params expressing an intent this kernel realizes a different way. Drop with a
// note instead of rejecting the whole node when the type doesn't have them.
const BENIGN_DROP_PARAMS = new Set(['seed', 'random', 'randomize', 'randomseed', 'jitter']);

export function validateAndNormalizeNodeData(
  id: string,
  type: string,
  data: Record<string, any> | undefined,
  _macros: any[]
): { warnings: string[]; errors: string[]; validatedData: Record<string, any> } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const validatedData: Record<string, any> = {};

  if (!data) return { warnings, errors, validatedData };

  const def = NODE_LIBRARY[type];
  if (!def) {
    return { warnings, errors, validatedData: { ...data } };
  }

  const allowedKeys = new Set([
    'label',
    'formula',
    'operation',
    'color',
    'macroId',
    'parentId',
    'axisFilter',
    'direction',
    'index',
    'tolerance'
  ]);

  const allowedKeysLowerMap = new Map<string, string>();
  allowedKeys.forEach(k => allowedKeysLowerMap.set(k.toLowerCase(), k));

  const validParams = def.params.map(p => p.name);
  const validParamsLowerMap = new Map<string, string>();
  validParams.forEach(p => validParamsLowerMap.set(p.toLowerCase(), p));

  for (const [key, value] of Object.entries(data)) {
    const keyLower = key.toLowerCase();
    
    if (allowedKeysLowerMap.has(keyLower)) {
      const correctKey = allowedKeysLowerMap.get(keyLower)!;
      validatedData[correctKey] = value;
      if (correctKey !== key) {
        warnings.push(`field "${key}" on node "${id}" was auto-corrected to "${correctKey}"`);
      }
      continue;
    }

    const doubleUnderscoreIdx = key.indexOf('__');
    if (doubleUnderscoreIdx > 0) {
      const baseParam = key.slice(0, doubleUnderscoreIdx);
      const suffix = key.slice(doubleUnderscoreIdx);
      if (suffix === '__min' || suffix === '__max' || suffix === '__step') {
        const baseParamLower = baseParam.toLowerCase();
        if (validParamsLowerMap.has(baseParamLower)) {
          const correctBase = validParamsLowerMap.get(baseParamLower)!;
          validatedData[correctBase + suffix] = value;
          if (correctBase !== baseParam) {
            warnings.push(`parameter override "${key}" on node "${id}" was auto-corrected to "${correctBase + suffix}"`);
          }
        } else {
          errors.push(`unknown parameter override "${key}" on node "${id}" (node type "${type}" has no parameter "${baseParam}")`);
        }
        continue;
      }
    }

    if (validParamsLowerMap.has(keyLower)) {
      const correctKey = validParamsLowerMap.get(keyLower)!;
      validatedData[correctKey] = value;
      if (correctKey !== key) {
        warnings.push(`parameter "${key}" on node "${id}" was auto-corrected to "${correctKey}"`);
      }
    } else {
      // A known synonym that THIS node actually supports? Map it rather than
      // rejecting the whole node. (add_nodes skips any node with a param error,
      // so an unmapped stray param silently deletes the node.)
      const canonicalLower = PARAM_SYNONYMS[keyLower];
      const resolved = canonicalLower ? validParamsLowerMap.get(canonicalLower) : undefined;
      if (resolved) {
        validatedData[resolved] = value;
        warnings.push(`parameter "${key}" on node "${id}" was mapped to "${resolved}" (synonym).`);
      } else if (BENIGN_DROP_PARAMS.has(keyLower)) {
        warnings.push(`parameter "${key}" on node "${id}" is not supported by ${type} and was ignored — for per-instance size variation use scaleStart/scaleEnd.`);
      } else if ((NODE_LIBRARY[type]?.inputs || []).some(inp => inp.name.toLowerCase() === keyLower)) {
        // The name IS a socket, just not a data param (e.g. Rotate's "pivot",
        // a Sphere's "center"): say so, or the model concludes the capability
        // does not exist at all and abandons it.
        warnings.push(`"${key}" on node "${id}" is an INPUT SOCKET of ${type}, not a data parameter — it was ignored here. Wire an edge into it instead: {"source": <node>, "target": "${id}", "targetHandle": "${key}"}.`);
      } else {
        errors.push(`unknown parameter "${key}" on node "${id}" (node type "${type}" does not support "${key}"). Valid parameters: ${validParams.join(', ') || '(none)'}`);
      }
    }
  }

  return { warnings, errors, validatedData };
}

function autofixGraphStructure(graph: WorkingGraph) {
  // 1. Auto-coerce solid -> shape on Align target handles
  for (const edge of graph.edges) {
    const targetNode = graph.nodes.find(n => n.id === edge.target);
    if (targetNode && targetNode.type === 'Align') {
      if (edge.targetHandle === 'solid' || !edge.targetHandle) {
        edge.targetHandle = 'shape';
      }
    }
  }

  // 2. Auto-connect Align shape input if exactly one unconsumed solid exists
  for (const node of graph.nodes) {
    if (node.type === 'Align') {
      const hasShapeInput = graph.edges.some(e => e.target === node.id && e.targetHandle === 'shape');
      if (!hasShapeInput) {
        const solidNodes = graph.nodes.filter(n => {
          if (n.id === node.id) return false;
          const def = NODE_LIBRARY[n.type];
          return def?.outputs.some(o => o.name === 'solid');
        });
        const consumedNodeIds = new Set(graph.edges.map(e => e.source));
        const unconsumedSolids = solidNodes.filter(n => !consumedNodeIds.has(n.id));
        if (unconsumedSolids.length === 1) {
          graph.edges.push({
            id: `${unconsumedSolids[0].id}__to__${node.id}__shape`,
            source: unconsumedSolids[0].id,
            sourceHandle: 'solid',
            target: node.id,
            targetHandle: 'shape'
          });
          addSystemMessage(`[Autofix] Connected unconsumed solid "${unconsumedSolids[0].id}" to Align "${node.id}" shape input.`);
        }
      }
    }
  }

  // 3. Naming-convention dataflow auto-wire (edge-completion). Models emit the
  //    nodes and formulas of a generative subsystem (angles → coord Expression →
  //    PointsFromLists → InstanceOnPoints) but frequently omit the edges, leaving
  //    it a disconnected island that collapses to nothing. Reconnect the
  //    unambiguous links deterministically; only EMPTY handles are ever filled,
  //    so this can never override the model's explicit wiring. Runs before
  //    structural validation, so a fully reconnected subgraph evaluates normally.
  const inferred = inferMissingEdges(graph.nodes as any[], graph.edges as any[]);
  for (const e of inferred) {
    graph.edges.push({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
    });
    addSystemMessage(`[Autofix] Wired "${e.source}" → "${e.target}":${e.targetHandle} (inferred from naming — ${e.reason}).`);
  }
}

export function aggregateAndRankIssues(issues: string[]): string[] {
  const structural: string[] = [];
  const nullGeometry: string[] = [];
  const engine: string[] = [];
  const containment: string[] = [];
  const proportional: string[] = [];
  const others: string[] = [];
  const dropped: string[] = [];

  const propRegex = /At (.*?) (?:increase|decrease) \(.*?x\), "(.*?)" shifts non-proportionally.*\(deviation (\d+)%\)/i;
  const propBySlider: Record<string, { parts: Set<string>; worstPart: string; worstDev: number }> = {};

  for (const issue of issues) {
    const lower = issue.toLowerCase();
    // Rejected-edge lines are aggregated by reason below so eight identical
    // rejections cost one line of the 5-issue cap instead of falling off it.
    if (lower.startsWith('dropped invalid edge')) {
      dropped.push(issue);
      continue;
    }
    const match = issue.match(propRegex);
    if (match) {
      const slider = match[1];
      const part = match[2];
      const dev = parseInt(match[3], 10);
      if (!propBySlider[slider]) {
        propBySlider[slider] = { parts: new Set(), worstPart: part, worstDev: dev };
      }
      propBySlider[slider].parts.add(part);
      if (dev > propBySlider[slider].worstDev) {
        propBySlider[slider].worstDev = dev;
        propBySlider[slider].worstPart = part;
      }
      continue;
    }
    if (lower.includes('shifts non-proportionally') || lower.includes('fragile under scaling')) {
      proportional.push(issue);
      continue;
    }
    if (
      lower.includes('missing required input') ||
      lower.includes('no connection on input') ||
      lower.includes('is not set. expected formula') ||
      lower.includes('deviation: "') ||
      lower.includes('does not exist') ||
      lower.includes('does not output') ||
      lower.includes('target handle') ||
      // A rejected edge is the single most actionable fact in a repair round —
      // it must outrank downstream null-geometry noise, not fall off the
      // 5-issue cap in the "others" bucket (which is how models fought the
      // wiring wall blind: told to add an edge, never told why it vanished).
      lower.includes('dropped invalid edge') ||
      lower.includes('no input handle') ||
      lower.includes('no numeric param') ||
      lower.includes('expression') && lower.includes('not connected')
    ) {
      structural.push(issue);
      continue;
    }
    if (
      lower.includes('could not be meshed') ||
      lower.includes('failed:') ||
      lower.includes('produced no geometry') ||
      lower.includes('degenerate geometry') ||
      lower.includes('non-positive volume')
    ) {
      nullGeometry.push(issue);
      continue;
    }
    if (
      lower.includes('engine fault') ||
      lower.includes('evaluation error') ||
      lower.includes('timed out') ||
      lower.includes('crashed') ||
      lower.includes('kernel failed')
    ) {
      engine.push(issue);
      continue;
    }
    if (
      lower.includes('floating in space') ||
      lower.includes('far from the rest') ||
      lower.includes('exact same space') ||
      lower.includes('stale duplicate') ||
      lower.includes('buried inside') ||
      lower.includes('fully contained')
    ) {
      containment.push(issue);
      continue;
    }
    others.push(issue);
  }

  const proportionalFormatted: string[] = [];
  for (const [slider, info] of Object.entries(propBySlider)) {
    proportionalFormatted.push(
      `${info.parts.size} parts shift non-proportionally when "${slider}" moves — positions use absolute Translates; worst: "${info.worstPart}" (${info.worstDev}%)`
    );
  }

  let duplicateCount = 0;
  const filteredContainment: string[] = [];
  for (const c of containment) {
    if (c.toLowerCase().includes('occupy the exact same space')) {
      duplicateCount++;
    } else {
      filteredContainment.push(c);
    }
  }
  if (duplicateCount > 0) {
    filteredContainment.push(`${duplicateCount} pairs of leaves occupy the exact same space (stale duplicates). Remove one of them.`);
  }

  // Aggregate rejected edges by reason: the reason is the actionable part, and
  // it must lead the list — a model that never learns WHY its edge vanished
  // re-sends it forever (the Jul-21 wiring-wall spiral).
  const dropByReason: Record<string, string[]> = {};
  for (const d of dropped) {
    const m = d.match(/^Dropped invalid edge: (.*?) \((.*)\)$/s);
    const reason = m ? m[2] : d.replace(/^Dropped invalid edge:\s*/i, '');
    const edge = m ? m[1] : '(see reason)';
    (dropByReason[reason] = dropByReason[reason] || []).push(edge);
  }
  const droppedFormatted = Object.entries(dropByReason).map(([reason, es]) =>
    `${es.length} edge(s) REJECTED, not added — ${reason}. Affected: ${es.slice(0, 4).join(', ')}${es.length > 4 ? ` (+${es.length - 4} more)` : ''}`);

  const ordered = [
    ...droppedFormatted,
    ...structural,
    ...nullGeometry,
    ...engine,
    ...filteredContainment,
    ...proportionalFormatted,
    ...proportional.filter(p => !p.match(propRegex)),
    ...others
  ];

  if (ordered.length > 5) {
    const capped = ordered.slice(0, 5);
    capped.push(`... and ${ordered.length - 5} more quality issues (see full list in UI).`);
    return capped;
  }
  return ordered;
}

// Applies a working graph to the store (with auto-layout), waits for evaluation,
// returns { error, report, sanity } — the agent's percepts.
async function applyAndPerceive(graph: WorkingGraph) {
  const store = useStore.getState();

  // Run deterministic autofixes
  autofixGraphStructure(graph);

  // Run structural validation first
  const structural = validateGraphStructure(graph.nodes as any[], graph.edges as any[], store.episodeRatios);
  const structuralErrors = structural.filter(s => s.severity === 'error').map(s => s.message);
  const structuralWarnings = structural.filter(s => s.severity === 'warning').map(s => s.message);

  // Always auto-layout and set nodes/edges in the store FIRST so the viewport displays updates!
  const laidOut = autoLayout(graph.nodes as any[], graph.edges as any[]);
  store.setNodes(laidOut as any[]);
  store.setEdges(graph.edges as any[]);

  if (structuralErrors.length > 0) {
    // Skip worker evaluation entirely on structural errors!
    return {
      error: 'Structural validation failed',
      report: null,
      sanity: {
        sane: false,
        issues: structuralErrors,
        warnings: structuralWarnings
      },
      isStructural: true
    };
  }

  const outcome = await waitForEvaluation();
  const sanity = checkGeometrySanity(outcome.report, outcome.error);

  if (structuralWarnings.length > 0) {
    sanity.warnings = [...(sanity.warnings || []), ...structuralWarnings];
  }
  return { ...outcome, sanity, isStructural: false };
}

function formatCompactGraphState(nodes: any[], edges: any[]): string {
  const nodeStrs = nodes.map(n => {
    const params = Object.entries(n.data || {})
      .filter(([k]) => !k.endsWith('__min') && !k.endsWith('__max') && !k.endsWith('__step'))
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    return `- ${n.id} (${n.type})${params ? ` [${params}]` : ''}`;
  });
  const edgeStrs = edges.map(e => `- ${e.source}${e.sourceHandle !== 'solid' && e.sourceHandle !== 'value' ? `.${e.sourceHandle}` : ''} → ${e.target}.${e.targetHandle}`);
  return `CURRENT CANVAS GRAPH STATE:\nNodes (${nodes.length}):\n${nodeStrs.join('\n') || '(no nodes)'}\nEdges (${edges.length}):\n${edgeStrs.join('\n') || '(no edges)'}`;
}

// ---------- A8: cross-attempt diagnosis state ----------
// The stadium transcript showed six consecutive tests of the SAME hypothesis
// (swap the node type) because nothing tracked what had been tried across
// repair rounds. The harness — not the model — is responsible for remembering.
interface RepairDiagnosis {
  tried: string[];
  lastIssueSig: string | null;
  nodeFailStreak: Record<string, number>;
  reproDone: Set<string>;
}
function newRepairDiagnosis(): RepairDiagnosis {
  return { tried: [], lastIssueSig: null, nodeFailStreak: {}, reproDone: new Set() };
}
function summarizePatchForDiagnosis(parsed: any): string {
  const bits: string[] = [];
  if (parsed.clearGraph || (Array.isArray(parsed.nodes) && parsed.nodes.length > 0)) {
    bits.push(`rebuilt graph (${(parsed.nodes || []).length} nodes)`);
  }
  if (Array.isArray(parsed.addedNodes) && parsed.addedNodes.length) {
    const types = [...new Set(parsed.addedNodes.map((n: any) => String(n.type)))].slice(0, 4);
    bits.push(`added ${parsed.addedNodes.length} node(s) [${types.join(', ')}]`);
  }
  if (Array.isArray(parsed.updatedNodes) && parsed.updatedNodes.length) {
    const typeChanges = parsed.updatedNodes.filter((n: any) => n.type).map((n: any) => `${n.id}→${n.type}`).slice(0, 4);
    bits.push(`updated ${parsed.updatedNodes.length} node(s)${typeChanges.length ? ` (type changes: ${typeChanges.join(', ')})` : ''}`);
  }
  if (Array.isArray(parsed.removedNodeIds) && parsed.removedNodeIds.length) bits.push(`removed ${parsed.removedNodeIds.length} node(s)`);
  if (Array.isArray(parsed.addedEdges) && parsed.addedEdges.length) bits.push(`added ${parsed.addedEdges.length} edge(s)`);
  if (Array.isArray(parsed.removedEdgeIds) && parsed.removedEdgeIds.length) bits.push(`removed ${parsed.removedEdgeIds.length} edge(s)`);
  return bits.join('; ') || 'no graph changes';
}
function updateDiagnosis(diag: RepairDiagnosis, actionSummary: string, issues: string[]): string {
  const sig = issues.slice(0, 2).join(' | ');
  const noEffect = diag.lastIssueSig !== null && sig === diag.lastIssueSig;
  diag.lastIssueSig = sig;
  diag.tried.push(`${actionSummary}${noEffect ? ' → NO EFFECT (identical issues)' : ''}`);
  for (const iss of issues) {
    const m = iss.match(/Node "([^"]+)" failed/);
    if (m) diag.nodeFailStreak[m[1]] = (diag.nodeFailStreak[m[1]] || 0) + 1;
  }
  const lines = diag.tried.slice(-4).map((t, i) => `  ${i + 1}. ${t}`);
  return `DIAGNOSIS STATE (harness-maintained):\n${lines.join('\n')}\nRULE: do NOT repeat an approach marked NO EFFECT — change hypothesis (different wiring, a different construction strategy, or leave the graph alone if the errors are [KERNEL]/[RUNTIME] class — those are engine faults the system handles).`;
}
// After a node has failed twice, evaluate it ALONE with default params —
// harness-side, costing no model turn — and report causal attribution.
async function maybeMinimalRepro(diag: RepairDiagnosis): Promise<string | null> {
  const store = useStore.getState();
  for (const [nodeId, streak] of Object.entries(diag.nodeFailStreak)) {
    if (streak < 2 || diag.reproDone.has(nodeId)) continue;
    const node = store.nodes.find((n: any) => n.id === nodeId) as any;
    if (!node) continue;
    diag.reproDone.add(nodeId);
    try {
      const iso = await store.evaluateScratch([{ id: '__repro', type: node.type, data: {}, position: { x: 0, y: 0 } }]);
      const isoErrors = iso.report?.nodeErrors || [];
      const isoOk = !iso.error && isoErrors.length === 0;
      if (isoOk) {
        return `MINIMAL REPRO (harness ran it for you): a lone ${node.type} with default params evaluates FINE — the failure of "${nodeId}" is caused by YOUR graph's inputs/params/wiring for it, not by the node type or the engine.`;
      }
      const firstErr = iso.error || isoErrors[0]?.error || 'unknown';
      return `MINIMAL REPRO (harness ran it for you): a lone ${node.type} with default params ALSO fails (${String(firstErr).slice(0, 160)}) — this is NOT caused by your graph. Do not rewire; the system handles engine faults.`;
    } catch {
      return null;
    }
  }
  return null;
}

// Nudge: before the graph is wiped for a new object, offer to save the old design.
function maybeSetNudgeCandidate() {
  const store = useStore.getState();
  if (store.nodes.length > 0 && store.episodePrompts.length > 0 && !store.lastEvaluationError) {
    store.setNudgeCandidate({
      prompts: [...store.episodePrompts],
      plan: store.episodePlan,
      graphFinal: { nodes: JSON.parse(JSON.stringify(store.nodes)), edges: JSON.parse(JSON.stringify(store.edges)) },
      graphOriginal: store.lastAIGraph ? JSON.parse(JSON.stringify(store.lastAIGraph)) : null,
      model: currentModelName(),
    });
  }
}

function currentModelName(): string {
  const { agentSlots, activeAgentId } = useStore.getState();
  const a = agentSlots.find(s => s.id === activeAgentId);
  return a ? `${a.name} (${a.model})` : 'Unknown Agent';
}

async function maybeVisionVerify(userText: string): Promise<{ score?: number; discrepancies: string[] }> {
  const store = useStore.getState();
  const agent = store.agentSlots.find(a => a.id === store.activeAgentId);
  if (!agent?.enableVisionVerification || !providerSupportsVision(agent)) return { discrepancies: [] };
  // allow the viewport a moment to render the new meshes
  await new Promise(r => setTimeout(r, 900));
  const snapshot = captureViewportSnapshot(512);
  if (!snapshot) return { discrepancies: [] };
  const verdict = await runVisionVerification(userText, store.episodePlan, [snapshot]);
  if (!verdict) return { discrepancies: [] };
  addSystemMessage(`Vision check: score ${verdict.score}/5${verdict.discrepancies.length ? ' — ' + verdict.discrepancies.join('; ') : ' — matches intent.'}`);
  return { score: verdict.score, discrepancies: verdict.matches ? [] : verdict.discrepancies };
}

// ---------- Main entry ----------

export async function processUserIntent(userText: string, options?: { forEval?: boolean }): Promise<IntentOutcome> {
  const store = useStore.getState();

  // /learn command: append to static guidelines
  if (userText.trim().startsWith('/learn')) {
    const newRule = userText.replace(/^\/learn\s*/, '').trim();
    if (!newRule) {
      addSystemMessage('Error: Please specify a rule to learn. Example: /learn Spheres should have a minimum radius of 5.');
    } else {
      store.setAgentGuidelines((store.agentGuidelines || '').trim() + `\n- ${newRule}`);
      addSystemMessage(`Learned rule appended to guidelines: "${newRule}"`);
    }
    return { parsedOk: true, evaluatedOk: true, geometrySane: true, nodeCount: store.nodes.length, edgeCount: store.edges.length, durationMs: 0 };
  }

  // Deterministic command gate: unambiguous destructive commands must never
  // depend on a (possibly flaky) model. "erase", "clear the canvas", "reset
  // everything", "wipe it" etc. are handled directly and instantly.
  if (!options?.forEval) {
    const t = userText.trim().toLowerCase().replace(/[.!]+$/, '');
    const isClearCommand =
      /^(erase|clear|delete|reset|wipe|empty|start over|new scene|new canvas)\b/.test(t) &&
      // Guard: don't hijack build requests like "clear glass sphere" or
      // "delete the top face of the box" — only fire when the command is short
      // and refers to the whole scene, or is a bare verb.
      (t.split(/\s+/).length <= 4 || /\b(all|everything|graph|canvas|scene|it|board|screen)\b/.test(t)) &&
      !/\b(add|make|create|build|design|keep|except|but)\b/.test(t);
    if (isClearCommand) {
      store.addEpisodePrompt(userText);
      maybeSetNudgeCandidate();          // offer to save the prior design first
      store.clearGraph();
      store.resetEpisode();
      store.clearMessages();
      addAssistantMessage('Canvas cleared and chat history reset.');
      return { parsedOk: true, evaluatedOk: true, geometrySane: true, nodeCount: 0, edgeCount: 0, durationMs: 0 };
    }
  }

  if (!options?.forEval) store.addEpisodePrompt(userText);

  let modifiedUserText = userText;
  if (store.lastEvaluationError) {
    modifiedUserText = `[System Notice: The previous graph evaluation failed with the error: "${store.lastEvaluationError}". Please diagnose and fix it as part of handling this request.]\n\nUser request: ${userText}`;
    store.clearLastEvaluationError();
  }
  if (!options?.forEval) {
    const vary = maybeVariationDirective(userText);
    if (vary) modifiedUserText = `${modifiedUserText}\n\n${vary}`;
  }

  const activeAgent = store.agentSlots.find(a => a.id === store.activeAgentId);
  if (!activeAgent) {
    addSystemMessage('Error: No active agent. Please create or select an agent in settings.');
    return { parsedOk: false, evaluatedOk: false, geometrySane: false, nodeCount: 0, edgeCount: 0, durationMs: 0, error: 'No active agent' };
  }

  const provider = activeAgent.provider;
  const isOllama = provider === 'ollama';
  const hasKey = activeAgent.apiKey && activeAgent.apiKey.trim().length > 0;
  if (!isOllama && !hasKey) {
    const errorMsg = `Agent slot "${activeAgent.name}" has no API key. Please configure the API key in the settings panel before generating designs.`;
    addSystemMessage(`Error: ${errorMsg}`);
    return {
      parsedOk: false,
      evaluatedOk: false,
      geometrySane: false,
      nodeCount: store.nodes.length,
      edgeCount: store.edges.length,
      durationMs: 0,
      error: errorMsg
    };
  }

  const useTools = providerSupportsTools(activeAgent) && !activeAgent.optimizeForSmallModels;
  const startTime = performance.now();

  const statusId = generateUUID();
  store.addMessage({ id: statusId, role: 'system', content: `AI (${currentModelName()}) is working…` });

  let outcome: IntentOutcome;
  try {
    if (useTools) {
      try {
        outcome = await runToolLoop(modifiedUserText, userText, options);
      } catch (toolErr: any) {
        // Provider rejected tool-calling (unsupported model, schema quirk, …):
        // fall back to the single-shot JSON protocol instead of failing.
        const errMsg = String(toolErr.message || toolErr);
        if (isFatalProviderError(errMsg)) {
          // Auth/quota/region error — switching to the JSON protocol would just
          // re-hit the same dead provider and burn more credits. Abort cleanly.
          addSystemMessage(`Provider unavailable — ${summarizeProviderError(errMsg)}. Stopping this run (not a graph problem; no protocol fallback).`);
          outcome = {
            parsedOk: false, evaluatedOk: false, geometrySane: false,
            nodeCount: useStore.getState().nodes.length, edgeCount: useStore.getState().edges.length,
            durationMs: 0, error: errMsg.slice(0, 200),
          };
        } else {
          // If the provider's tool-call grammar is fundamentally broken for this
          // model (the Ollama "closing '}'" 400, or any 400 on the tools payload),
          // stop retrying native tools for the rest of the session — every future
          // turn would fail the same way and waste a round-trip.
          if (/400|closing '\}'|tool|schema|grammar/i.test(errMsg) && !options?.forEval) {
            useStore.getState().updateAgentSlot(activeAgent.id, { disableToolCalling: true });
            addSystemMessage('Native tool-calling disabled for this agent (provider grammar error) — using the JSON protocol from now on.');
          } else {
            addSystemMessage(`Tool-calling unavailable (${errMsg.slice(0, 160)}) — falling back to JSON protocol.`);
          }
          outcome = await runLegacyJson(modifiedUserText, userText, options);
        }
      }
    } else {
      outcome = await runLegacyJson(modifiedUserText, userText, options);
    }
  } catch (err: any) {
    outcome = {
      parsedOk: false, evaluatedOk: false, geometrySane: false,
      nodeCount: useStore.getState().nodes.length, edgeCount: useStore.getState().edges.length,
      durationMs: Math.round(performance.now() - startTime),
      error: String(err.message || err),
    };
    addSystemMessage(`Error: ${outcome.error}`);
  }
  useStore.getState().removeMessage(statusId);

  outcome.durationMs = Math.round(performance.now() - startTime);
  useStore.getState().addPerformanceLog({
    model: currentModelName(),
    request: userText,
    success: outcome.parsedOk && outcome.evaluatedOk && outcome.geometrySane,
    responseTimeMs: outcome.durationMs,
    nodeCount: outcome.nodeCount,
    edgeCount: outcome.edgeCount,
    error: outcome.error,
  });

  return outcome;
}

// ---------- Path A: native tool-calling agent loop ----------

async function runToolLoop(modifiedUserText: string, originalText: string, options?: { forEval?: boolean }): Promise<IntentOutcome> {
  const systemPrompt = await buildSystemPrompt(originalText, true);
  const store = useStore.getState();

  const history: AgentMessage[] = store.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-8)
    .filter(m => m.content !== originalText)
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const messages: AgentMessage[] = [...history, { role: 'user', content: modifiedUserText }];

  // Working copy of the graph
  const graph: WorkingGraph = {
    nodes: JSON.parse(JSON.stringify(store.nodes)),
    edges: JSON.parse(JSON.stringify(store.edges)),
  };

  let parsedOk = false;
  let evaluatedOk = true;
  let geometrySane = true;
  let lastError: string | undefined;
  let visionScore: number | undefined;
  let repairs = 0;
  let visionRepairUsed = false;
  let consecutiveEngineFaults = 0;
  const toolDiagnosis = newRepairDiagnosis();

  for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
    const modelTurn = await chatCompletionWithTools(messages, systemPrompt, AGENT_TOOLS);
    parsedOk = true;

    if (modelTurn.toolCalls.length === 0) {
      // Plain text answer — surface it and stop
      if (modelTurn.text) { addAssistantMessage(modelTurn.text); break; }
      // Completely empty first turn (no text, no actions): the model cannot
      // drive this protocol — bail out so the caller falls back to the JSON
      // protocol instead of silently doing nothing.
      if (turn === 0) {
        throw new Error('Model returned an empty response (no text, no actions).');
      }
      break;
    }

    messages.push({ role: 'assistant', content: modelTurn.text, toolCalls: modelTurn.toolCalls });

    let mutated = false;
    let askedUser: string[] | null = null;
    let finished: string | null = null;
    let cleared = false;

    for (const tc of modelTurn.toolCalls) {
      if (tc.name === 'clear_graph' && !options?.forEval) {
        // Offer saving the previous design before wiping (uses live store graph)
        maybeSetNudgeCandidate();
      }
      const result = executeTool(tc.name, tc.arguments, graph, useStore.getState().macros);
      if (result.plan) {
        useStore.getState().setEpisodePlan(result.plan);
        if (result.ratios) useStore.getState().setEpisodeRatios(result.ratios);
        if (result.drivers) useStore.getState().setEpisodeDrivers(result.drivers);
        if (result.genome) useStore.getState().setEpisodeGenome(result.genome);
        addAssistantMessage(`Plan:\n${result.plan}`);
      }
      if (result.mutatedGraph) mutated = true;
      if (result.clearedGraph) cleared = true;
      if (result.askedUser) askedUser = result.askedUser;
      if (result.finished) finished = result.finished;
      messages.push({ role: 'tool', toolCallId: tc.id, name: tc.name, content: result.message });
    }

    if (cleared && !options?.forEval) {
      useStore.getState().resetEpisode();
      useStore.getState().addEpisodePrompt(originalText);
    }

    if (mutated) {
      const percept = await applyAndPerceive(graph);
      evaluatedOk = !percept.error;
      geometrySane = percept.sanity.sane;
      lastError = percept.error || (percept.sanity.issues.length ? percept.sanity.issues.join(' | ') : undefined);
      const compactState = formatCompactGraphState(graph.nodes, graph.edges);
      const reportText = formatGeometryReport(percept.report, percept.error) +
        (percept.sanity.issues.length ? `\nISSUES DETECTED:\n${aggregateAndRankIssues(percept.sanity.issues).map(i => '- ' + i).join('\n')}` : '\nNo issues detected.') +
        (percept.sanity.warnings?.length ? `\nWARNINGS (non-blocking):\n${percept.sanity.warnings.map(w => '- ' + w).join('\n')}` : '');
      messages.push({ role: 'user', content: `${compactState}\n\nGEOMETRY REPORT:\n${reportText}` });
      useStore.getState().setLastAIGraph({ nodes: JSON.parse(JSON.stringify(graph.nodes)), edges: JSON.parse(JSON.stringify(graph.edges)) });

      // Truncated turn: later tool calls (usually the `connect` batch after a
      // big add_nodes) never arrived — the missing-input issues are EXPECTED.
      // Ask the model to continue where it was cut off, without spending a
      // repair attempt on it.
      if (modelTurn.truncated) {
        addSystemMessage('Model response hit the output limit mid-turn — asking it to continue with the remaining tool calls.');
        messages.push({ role: 'user', content: 'Your tool calls were CUT OFF at the output limit. The nodes/edges above already exist — do NOT resend them. Continue now with the REMAINING calls only (usually the connect edges), in smaller batches.' });
        continue;
      }

      if (!percept.sanity.sane) {
        // A1/A3 follow-through: per-node kernel-class failures (report.
        // kernelFaultCount) are engine faults even though the evaluation
        // itself "succeeded" — never charge them to the repair budget.
        const kernelClassFailure = !percept.isStructural && !isSystemError(percept.error) && !!(percept.report as any)?.kernelFaultCount;
        if (!isSystemError(percept.error) && !kernelClassFailure) consecutiveEngineFaults = 0;
        if (percept.isStructural) {
          addSystemMessage(`Structural validation error (does not count against repair budget): ${percept.sanity.issues.slice(0, 3).join('; ')}`);
        } else if (isSystemError(percept.error) || kernelClassFailure) {
          // Circuit breaker: a kernel that faults on 3 consecutive evaluations
          // will not be fixed by graph edits — stop burning model turns.
          consecutiveEngineFaults++;
          if (consecutiveEngineFaults >= 3) {
            addSystemMessage(`Engine fault persisted across ${consecutiveEngineFaults} consecutive evaluations — stopping this episode. The kernel state may be corrupted; try again, Clear Graph, or reload the app.`);
            lastError = percept.error || lastError;
            break;
          }
          addSystemMessage(`Engine fault (does not count against repair budget, ${consecutiveEngineFaults}/3): ${percept.error}. Retrying...`);
        } else {
          repairs++;
          if (repairs > MAX_AUTO_REPAIRS) {
            addSystemMessage(`Auto-repair limit reached. Remaining issues: ${percept.sanity.issues.join('; ')}`);
            break;
          }
          addSystemMessage(`Issues detected (repair attempt ${repairs}/${MAX_AUTO_REPAIRS}): ${percept.sanity.issues.slice(0, 3).join('; ')}`);
          // A8: remember what was tried; attribute causes with a minimal repro.
          const diagBlock = updateDiagnosis(toolDiagnosis, 'tool-batch graph changes', percept.sanity.issues);
          messages.push({ role: 'user', content: diagBlock });
          const repro = await maybeMinimalRepro(toolDiagnosis);
          if (repro) messages.push({ role: 'user', content: repro });
        }
        continue; // let the model react to the report
      } else {
        consecutiveEngineFaults = 0;
      }
    }

    if (askedUser && askedUser.length > 0) {
      addAssistantMessage(`I need a bit more information:\n${askedUser.map(q => '- ' + q).join('\n')}`);
      break;
    }

    if (finished) {
      // Optional vision verification with one repair round. Gated by the active
      // agent's own enableVisionVerification opt-in (checked inside
      // maybeVisionVerify) — NOT by options.forEval. It used to also hard-block
      // during eval runs, which meant visionScore was silently always undefined
      // in EVAL_RESULTS.json even for agents that had vision verification turned
      // on, defeating the whole point of tracking it. If you did NOT enable
      // vision verification for your agent slot, this is a no-op either way —
      // eval behavior is unchanged. If you DID, eval runs now cost one extra
      // multimodal API call per prompt (only on prompts that evaluate as sane).
      if (!visionRepairUsed) {
        const vision = await maybeVisionVerify(originalText);
        visionScore = vision.score;
        if (vision.discrepancies.length > 0 && turn < MAX_AGENT_TURNS - 1) {
          visionRepairUsed = true;
          messages.push({ role: 'user', content: `VISUAL REVIEW found discrepancies with the intent — fix them:\n${vision.discrepancies.map(d => '- ' + d).join('\n')}` });
          continue;
        }
      }
      addAssistantMessage(finished);
      break;
    }

    if (!mutated && !finished && !askedUser) {
      // Model called only set_plan (or nothing actionable) — prompt it to proceed
      messages.push({ role: 'user', content: 'Proceed with building the graph now using add_nodes and connect.' });
    }
  }

  const s = useStore.getState();
  const graphShape = computeGraphShapeMetrics(s.nodes as any[], s.edges as any[]);
  const intent = scoreIntentRealization(s.episodeGenome, s.lastGeometryReport);
  return {
    parsedOk, evaluatedOk, geometrySane,
    nodeCount: s.nodes.length, edgeCount: s.edges.length,
    durationMs: 0, visionScore, error: lastError,
    proportionalIntegrity: s.lastGeometryReport?.proportionalIntegrity,
    derivationRatio: graphShape.derivationRatio,
    skeletonNodes: graphShape.skeletonNodes,
    magicNumberCount: graphShape.magicNumberCount,
    repairRounds: repairs,
    realizationScore: intent.realizationScore,
    deferredDetail: intent.deferredDetail,
  };
}

// ---------- Path B: legacy single-shot JSON with auto-retry ----------

async function runLegacyJson(modifiedUserText: string, originalText: string, options?: { forEval?: boolean }): Promise<IntentOutcome> {
  const systemPrompt = await buildSystemPrompt(originalText, false);
  const store = useStore.getState();

  const chatHistory = store.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map(m => {
      let content = m.content;
      if (m.role === 'assistant') content = content.replace(/^\[[^\]\n]+\]\s*/, '');
      if (m.role === 'user' && m.content === originalText) {
        return { role: 'user' as const, content: modifiedUserText };
      }
      return { role: m.role as 'user' | 'assistant', content };
    });

  const apiMessages = chatHistory.length > 0 ? chatHistory : [{ role: 'user' as const, content: modifiedUserText }];
  const last = apiMessages[apiMessages.length - 1];
  if (last && last.role === 'user') {
    last.content += "\n\nCRITICAL: You MUST respond ONLY with valid JSON. Your response must begin with '{' and end with '}'.";
  }

  let parsedOk = false;
  let evaluatedOk = false;
  let geometrySane = false;
  let lastError: string | undefined;
  let visionScore: number | undefined;
  let structuralExemptions = 0;
  let engineFaultExemptions = 0;
  let repairsUsed = 0;
  const jsonDiagnosis = newRepairDiagnosis();

  for (let attempt = 0; attempt <= MAX_AUTO_REPAIRS; attempt++) {
    repairsUsed = attempt;
    // Schema-constrained decoding: on an empty canvas the expected output is an
    // IR program, so constrain the sampler to the IR grammar (op-name enum kills
    // "unknown op" and malformed-JSON failures at the decoder). With an existing
    // graph the model may legitimately answer with the patch protocol instead,
    // so no constraint is applied.
    const emptyCanvas = useStore.getState().nodes.length === 0;
    const responseText = await chatCompletion(
      apiMessages, systemPrompt,
      emptyCanvas ? { responseSchema: buildIrJsonSchema() } : undefined,
    );

    // Truncation: the provider hit the output cap mid-response. Do NOT feed a
    // cut-off graph into the repair loop — ask the model to resend, more
    // compactly, using the token-saving edge shorthand.
    if (responseText.includes('/*__TRUNCATED__*/')) {
      addSystemMessage('Response was truncated (output limit hit). Asking the model to rebuild more compactly.');
      if (attempt < MAX_AUTO_REPAIRS) {
        const compactState = formatCompactGraphState(useStore.getState().nodes, useStore.getState().edges);
        apiMessages.push({
          role: 'user' as const,
          content: `${compactState}\n\nYour previous response was cut off before completing. Rebuild the FULL graph but be compact: omit sourceHandle/targetHandle/id for standard single-solid edges (give only {"source","target"}), and keep reasoning to one short sentence. Respond ONLY with JSON.`
        });
        continue;
      }
    }

    let parsed: any;
    try {
      parsed = robustJSONParse(responseText.replace('/*__TRUNCATED__*/', ''));
    } catch (parseErr: any) {
      // Malformed / empty / prose-only response: give the model another shot
      // with an explicit correction instead of failing the whole turn.
      if (attempt < MAX_AUTO_REPAIRS) {
        addSystemMessage(`Response was not valid JSON (attempt ${attempt + 1}/${MAX_AUTO_REPAIRS + 1}) — asking the model to resend.`);
        apiMessages.push({ role: 'assistant' as const, content: responseText.slice(0, 2000) || '(empty response)' });
        apiMessages.push({ role: 'user' as const, content: 'Your previous response was not valid JSON. Respond again with ONLY the JSON object — no prose, no markdown fences, no comments. Begin with { and end with }.' });
        continue;
      }
      throw parseErr;
    }
    parsedOk = true;

    // Capture the design genome (Pillar 1) BEFORE the IR path reassigns `parsed`
    // below — so both IR programs and patch responses carry it into eval records.
    if (parsed && parsed.genome) {
      const { genome } = validateGenome(parsed.genome);
      if (genome) useStore.getState().setEpisodeGenome(genome);
    }

    // IR PROGRAM path: a typed {params?, body, emit} program compiles
    // deterministically into nodes/edges (src/ai/ir). Compile errors are
    // model-repairable and do not touch the canvas.
    if (parsed && Array.isArray(parsed.body) && Array.isArray(parsed.emit)
        && !parsed.nodes && !parsed.addedNodes && !parsed.updatedNodes) {
      if (parsed.body.length === 0 && parsed.questions?.length > 0) {
        // Question-only response wearing the IR shape — hand to the question path.
        parsed = { reasoning: parsed.intent || '', questions: parsed.questions };
      } else {
        const compiled = compileIr(parsed as IrProgram);
        if (!compiled.graph) {
          const msgs = compiled.issues.map(i => `${i.where}: ${i.message}`).join('\n');
          if (attempt < MAX_AUTO_REPAIRS) {
            addSystemMessage(`IR program had compile errors (attempt ${attempt + 1}/${MAX_AUTO_REPAIRS + 1}) — asking the model to fix.`);
            apiMessages.push({ role: 'assistant' as const, content: responseText.slice(0, 4000) });
            apiMessages.push({ role: 'user' as const, content: `Your IR program did not compile:\n${msgs}\nResend the FULL corrected program. Respond ONLY with JSON.` });
            continue;
          }
          throw new Error(`IR compile failed: ${msgs}`);
        }
        compiled.notes.forEach(n => addSystemMessage(`[IR] ${n}`));
        // Route through the existing full-rebuild path (validation, layout,
        // evaluation, sanity) — the compiler's output is a complete graph.
        parsed = {
          reasoning: parsed.intent || 'Built from IR program.',
          clearGraph: true,
          nodes: compiled.graph.nodes,
          edges: compiled.graph.edges,
        };
      }
    }

    if (parsed.reasoning || parsed.questions?.length > 0) {
      const qs = parsed.questions?.length > 0
        ? '\n\nQuestions:\n' + parsed.questions.map((q: string) => '- ' + q).join('\n')
        : '';
      addAssistantMessage(`${parsed.reasoning || ''}${qs}`);
      if (parsed.reasoning && !options?.forEval) {
        useStore.getState().setEpisodePlan(String(parsed.reasoning));
        if (parsed.ratios) useStore.getState().setEpisodeRatios(parsed.ratios);
        if (parsed.drivers) useStore.getState().setEpisodeDrivers(parsed.drivers);
      }
    }

    const graphResult = applyParsedGraphOps(parsed, options);
    if (!graphResult) {
      // No graph changes (pure question / conversation)
      evaluatedOk = true;
      geometrySane = true;
      break;
    }

    const graph = { nodes: graphResult.nodes, edges: graphResult.edges };
    const percept = await applyAndPerceive(graph);
    if (graphResult.droppedEdges && graphResult.droppedEdges.length > 0) {
      percept.sanity.issues.push(...graphResult.droppedEdges.map((e: string) => `Dropped invalid edge: ${e}`));
      percept.sanity.sane = false;
    }
    if (graphResult.patchNotes && graphResult.patchNotes.length > 0) {
      // Non-blocking, but the model must see them (system messages don't reach it).
      percept.sanity.warnings = [...(percept.sanity.warnings || []), ...graphResult.patchNotes];
      graphResult.patchNotes.forEach((note: string) => addSystemMessage(`[Patch] ${note}`));
    }
    evaluatedOk = !percept.error;
    geometrySane = percept.sanity.sane;
    lastError = percept.error || (percept.sanity.issues.length ? percept.sanity.issues.join(' | ') : undefined);
    useStore.getState().setLastAIGraph({ nodes: JSON.parse(JSON.stringify(graph.nodes)), edges: JSON.parse(JSON.stringify(graph.edges)) });

    if (percept.sanity.sane) {
      // See the comment on the equivalent check in the tool-loop path above —
      // gated by the agent's own opt-in inside maybeVisionVerify, not forEval.
      {
        const vision = await maybeVisionVerify(originalText);
        visionScore = vision.score;
        if (vision.discrepancies.length > 0 && attempt < MAX_AUTO_REPAIRS) {
          apiMessages.push({ role: 'assistant' as const, content: responseText.slice(0, 4000) });
          apiMessages.push({ role: 'user' as const, content: `VISUAL REVIEW found discrepancies — fix the graph:\n${vision.discrepancies.map(d => '- ' + d).join('\n')}\nRespond ONLY with JSON using the patch protocol.` });
          continue;
        }
      }
      break;
    }

    let isBudgetExempt = false;
    // Per-node kernel-class failures are engine faults even though the
    // evaluation "succeeded" — see report.kernelFaultCount (Workstream A).
    const kernelClassFailure = !percept.isStructural && !isSystemError(percept.error) && !!(percept.report as any)?.kernelFaultCount;
    if (percept.isStructural) {
      // Name the actual issues in the visible transcript: the opaque one-liner
      // made exported sessions (and the user watching) blind to WHY every
      // repair round failed — the Jul-21 exports recorded 6 identical
      // "Structural validation error" lines while the real story (edges
      // rejected by the handle whitelist) was never captured anywhere.
      const structuralPeek = percept.sanity.issues.slice(0, 2).map(i => i.slice(0, 160)).join(' | ') || 'no detail';
      if (structuralExemptions < 3) {
        addSystemMessage(`Structural validation error (does not count against repair budget, ${structuralExemptions + 1}/3): ${structuralPeek}`);
        isBudgetExempt = true;
        structuralExemptions++;
      } else {
        addSystemMessage(`Structural validation error (exemptions exhausted, counts against repair budget): ${structuralPeek}`);
      }
    } else if (isSystemError(percept.error) || kernelClassFailure) {
      // Engine faults are exempt from the repair budget, but ONLY a limited
      // number of times. Without this cap a persistently faulting kernel put
      // the loop into an infinite retry (attempt-- forever) while the model
      // thrashed the graph chasing an error it never caused — see the Gemma
      // transcript (15+ consecutive faults, graph degraded to rubble).
      if (engineFaultExemptions < 3) {
        engineFaultExemptions++;
        addSystemMessage(`Engine fault (does not count against repair budget, ${engineFaultExemptions}/3) — retrying.`);
        isBudgetExempt = true;
      } else {
        addSystemMessage(`Engine fault persisted after 3 exempt retries — the kernel appears unstable with this graph. Further faults now count against the repair budget. Consider Clear Graph or reloading the app.`);
      }
    }

    if (isBudgetExempt) {
      attempt--;
    }

    if (attempt < MAX_AUTO_REPAIRS) {
      if (!isBudgetExempt) {
        addSystemMessage(`Issues detected (auto-repair ${attempt + 1}/${MAX_AUTO_REPAIRS}): ${percept.sanity.issues.slice(0, 3).join('; ')}`);
      }
      const compactState = formatCompactGraphState(graph.nodes, graph.edges);
      const intentGap = scoreIntentRealization(useStore.getState().episodeGenome, percept.report).deferredDetail;
      const reportText = formatGeometryReport(percept.report, percept.error) +
        `\nISSUES:\n${aggregateAndRankIssues(percept.sanity.issues).map(i => '- ' + i).join('\n')}` +
        (percept.sanity.warnings?.length ? `\nWARNINGS (non-blocking):\n${percept.sanity.warnings.map(w => '- ' + w).join('\n')}` : '') +
        (intentGap.length ? `\nDESIGN INTENT GAP (your planned genome is not fully realized — restore this detail, do not simplify further):\n${intentGap.map(d => '- ' + d).join('\n')}` : '');
      // A8: remember what was tried across repair rounds; attribute causes
      // with a harness-side minimal repro when the same node keeps failing.
      const diagBlock = updateDiagnosis(jsonDiagnosis, summarizePatchForDiagnosis(parsed), percept.sanity.issues);
      const repro = await maybeMinimalRepro(jsonDiagnosis);
      apiMessages.push({ role: 'assistant' as const, content: responseText.slice(0, 4000) });
      apiMessages.push({ role: 'user' as const, content: `${compactState}\n\nGEOMETRY REPORT after your last change:\n${reportText}\n\n${diagBlock}${repro ? `\n\n${repro}` : ''}\n\nFix these issues. Respond ONLY with JSON using the patch protocol (addedNodes/updatedNodes/removedNodeIds/addedEdges/removedEdgeIds).` });
    } else {
      addSystemMessage(`Auto-repair limit reached. Remaining issues: ${(lastError || '').slice(0, 300)}`);
    }
  }

  const s = useStore.getState();
  const graphShape = computeGraphShapeMetrics(s.nodes as any[], s.edges as any[]);
  const intent = scoreIntentRealization(s.episodeGenome, s.lastGeometryReport);
  return {
    parsedOk, evaluatedOk, geometrySane,
    nodeCount: s.nodes.length, edgeCount: s.edges.length,
    durationMs: 0, visionScore, error: lastError,
    proportionalIntegrity: s.lastGeometryReport?.proportionalIntegrity,
    derivationRatio: graphShape.derivationRatio,
    skeletonNodes: graphShape.skeletonNodes,
    magicNumberCount: graphShape.magicNumberCount,
    repairRounds: repairsUsed,
    realizationScore: intent.realizationScore,
    deferredDetail: intent.deferredDetail,
  };
}

// Applies parsed JSON graph operations to a fresh working copy. Returns null if no ops.
// (Source-handle defaulting lives in tools.ts::defaultSourceHandle, shared with
// the native tool path so both protocols resolve omitted handles identically.)

function applyParsedGraphOps(parsed: any, options?: { forEval?: boolean }): (WorkingGraph & { droppedEdges: string[]; patchNotes: string[] }) | null {
  const store = useStore.getState();
  let nextNodes: any[] = JSON.parse(JSON.stringify(store.nodes));
  let nextEdges: any[] = JSON.parse(JSON.stringify(store.edges));
  let hasUpdates = false;
  const droppedEdges: string[] = [];
  // Soft feedback channel: things the model asked for that did NOT happen
  // (unmatched edge removals, skipped updates, type-change resets). These do
  // not fail sanity, but MUST reach the model — silent no-ops are how the
  // "phantom edge" repair spirals started: the model removed edges turn after
  // turn, nothing matched, and it concluded the system was haunted.
  const patchNotes: string[] = [];

  // Fill omitted edge handles the same way the tool path does, validating existence of nodes/handles
  const validateAndResolveEdge = (e: any, edgeList: any[]): { sourceHandle: string; targetHandle: string; isValid: boolean; error?: string } => {
    const source = String(e.source);
    const target = String(e.target);
    const srcNode = nextNodes.find(n => n.id === source);
    const tgtNode = nextNodes.find(n => n.id === target);
    if (!srcNode) {
      return { sourceHandle: '', targetHandle: '', isValid: false, error: `source node "${source}" does not exist` };
    }
    if (!tgtNode) {
      return { sourceHandle: '', targetHandle: '', isValid: false, error: `target node "${target}" does not exist` };
    }
    const srcType = srcNode.type;
    const tgtType = tgtNode.type;
    const targetDef = NODE_LIBRARY[tgtType];
    const geoHandles = geoInputHandles(tgtType);

    let targetHandle = e.targetHandle !== undefined && e.targetHandle !== null && String(e.targetHandle) ? String(e.targetHandle) : '';
    if (!targetHandle) {
      const gh = geoHandles;
      const taken = new Set(edgeList.filter((x: any) => x.target === target).map((x: any) => String(x.targetHandle)));
      // S2: type-aware inference first (Point→center/target, Vector→axis,
      // Solid→solid); null means a KNOWN type mismatch — reject honestly.
      const picked = pickTargetHandle(srcType, e.sourceHandle ? String(e.sourceHandle) : undefined, tgtType, taken);
      if (typeof picked === 'string') {
        targetHandle = picked;
      } else if (picked === null) {
        return { sourceHandle: '', targetHandle: '', isValid: false, error: `"${tgtType}" has no input accepting what "${source}" outputs. It accepts — ${describeWireableInputs(tgtType)}` };
      } else if (gh.length === 1) {
        targetHandle = gh[0];
      } else if (gh.length > 1) {
        targetHandle = gh.find(h => !taken.has(h)) || gh[0];
      } else {
        targetHandle = 'solid';
      }
    }

    // Check target handle validity. IMPORTANT: the whitelist is ALL declared
    // inputs — number-typed sockets (Expression a/b/c/d, PointsFromLists
    // x/y/z/scale, Point x/y/z, …) included. Validating against geometry-only
    // handles was the "number-input wiring wall": it dropped every list-layer
    // edge the model or the IR compiler emitted, while structural validation
    // demanded those same edges — an unwinnable repair loop.
    if (targetHandle.startsWith('param:')) {
      const pName = targetHandle.slice(6);
      if (targetDef && tgtType !== 'Macro' && !targetDef.params.some(p => p.name === pName && p.type === 'number')) {
        const hint = numberInputHandles(tgtType).includes(pName)
          ? ` — "${pName}" IS a number input on "${tgtType}"; use targetHandle "${pName}" without the "param:" prefix`
          : ` (it accepts — ${describeWireableInputs(tgtType)})`;
        return { sourceHandle: '', targetHandle: '', isValid: false, error: `"${tgtType}" has no numeric param "${pName}"${hint}` };
      }
    } else if (targetDef && tgtType !== 'Macro' && !allInputHandles(tgtType).includes(targetHandle)) {
      return { sourceHandle: '', targetHandle: '', isValid: false, error: `"${tgtType}" has no input handle "${targetHandle}" (it accepts — ${describeWireableInputs(tgtType)})` };
    }

    const sourceHandle = e.sourceHandle !== undefined && e.sourceHandle !== null && String(e.sourceHandle)
      ? String(e.sourceHandle)
      : defaultSourceHandle(srcType);

    return { sourceHandle, targetHandle, isValid: true };
  };

  const hasPatch = ['addedNodes', 'updatedNodes', 'removedNodeIds', 'addedEdges', 'removedEdgeIds']
    .some(k => Array.isArray(parsed[k]) && parsed[k].length > 0);
  const isExplicitClear = parsed.clearGraph === true ||
    (Array.isArray(parsed.nodes) && parsed.nodes.length === 0 && Array.isArray(parsed.edges) && parsed.edges.length === 0);

  if (isExplicitClear) {
    if (!options?.forEval) {
      maybeSetNudgeCandidate();
      store.resetEpisode();
    }
    hasUpdates = true;
    nextNodes = [];
    nextEdges = [];
  }

  if (hasPatch) {
    hasUpdates = true;
    if (parsed.removedNodeIds) {
      const toRemove = parsed.removedNodeIds.map(String);
      nextNodes = nextNodes.filter(n => !toRemove.includes(n.id));
      nextEdges = nextEdges.filter(e => !toRemove.includes(e.source) && !toRemove.includes(e.target));
    }
    if (parsed.removedEdgeIds) {
      // Models rarely know real edge ids. Accept, in order: exact id,
      // {source,target[,targetHandle]} objects, and "source->target[.handle]"
      // strings (also → and =>). Report anything that matched nothing.
      for (const raw of parsed.removedEdgeIds) {
        let matched = 0;
        const removeWhere = (pred: (e: any) => boolean) => {
          nextEdges = nextEdges.filter(e => {
            const hit = pred(e);
            if (hit) matched++;
            return !hit;
          });
        };
        if (raw && typeof raw === 'object') {
          const s = String(raw.source), t = String(raw.target);
          const th = raw.targetHandle !== undefined && raw.targetHandle !== null ? String(raw.targetHandle) : undefined;
          removeWhere(e => e.source === s && e.target === t && (!th || String(e.targetHandle) === th));
        } else {
          const idStr = String(raw);
          removeWhere(e => e.id === idStr);
          if (matched === 0) {
            const m = idStr.match(/^(.+?)\s*(?:->|→|=>)\s*([^.:\s]+)(?:[.:]([\w:]+))?$/);
            if (m) {
              const [, s, t, th] = m;
              removeWhere(e => e.source === s.trim() && e.target === t.trim() && (!th || String(e.targetHandle) === th));
            }
          }
        }
        if (matched === 0) {
          // A9: list the real edges touching the referenced nodes so the model
          // corrects on the next turn instead of retrying the same wrong id.
          const refIds = new Set<string>();
          if (raw && typeof raw === 'object') {
            refIds.add(String((raw as any).source));
            refIds.add(String((raw as any).target));
          } else {
            String(raw).split(/->|→|=>|[.\s]+/).forEach(part => {
              const p = part.trim();
              if (p) refIds.add(p);
            });
          }
          const candidates = nextEdges
            .filter(e => refIds.has(String(e.source)) || refIds.has(String(e.target)))
            .slice(0, 6)
            .map(e => `${e.source}->${e.target}${e.targetHandle ? `.${e.targetHandle}` : ''}`);
          patchNotes.push(`removedEdgeIds entry ${JSON.stringify(raw)} matched NO edge — nothing was removed. Use the edge ids shown in the graph state, {"source","target"} objects, or "source->target" strings.${candidates.length ? ` Current edges touching those nodes: ${candidates.join(', ')}` : ''}`);
        }
      }
    }
    if (parsed.addedNodes) {
      parsed.addedNodes.forEach((n: any) => {
        const id = String(n.id);
        const { warnings, errors, validatedData } = validateAndNormalizeNodeData(id, n.type, n.data, store.macros);
        if (errors.length > 0) {
          droppedEdges.push(`Node "${id}" has invalid data: ${errors.join(', ')}`);
        }
        if (warnings.length > 0) {
          warnings.forEach(w => addSystemMessage(`[Warning] ${w}`));
        }
        nextNodes = nextNodes.filter(existing => existing.id !== id);
        nextNodes.push({ ...n, id, data: validatedData, position: n.position || { x: 0, y: 0 } });
      });
    }
    if (parsed.updatedNodes) {
      parsed.updatedNodes.forEach((n: any) => {
        const id = String(n.id);
        const existing = nextNodes.find(x => x.id === id);
        if (!existing) {
          // Previously a silent no-op — the model kept "updating" ghosts.
          patchNotes.push(`updatedNodes entry "${id}" matched NO existing node — nothing was updated. Use addedNodes to create it.`);
          return;
        }
        // Type change: validate params against the NEW type and RESET data.
        // Merging old params across a type change is what produced kernel
        // crashes ("Sphere" nodes still carrying Torus/Pipe params) and the
        // model's "the system reports Sphere but claims Ellipsoid" confusion.
        const requestedType = n.type !== undefined && n.type !== null ? String(n.type) : '';
        const isTypeChange = !!requestedType && requestedType !== existing.type;
        if (isTypeChange && !NODE_LIBRARY[requestedType]) {
          patchNotes.push(`updatedNodes entry "${id}": unknown type "${requestedType}" — node left unchanged. Valid types are listed in the node library.`);
          return;
        }
        const effectiveType = isTypeChange ? requestedType : existing.type;
        const { warnings, errors, validatedData } = validateAndNormalizeNodeData(id, effectiveType, n.data, store.macros);
        if (errors.length > 0) {
          droppedEdges.push(`Node "${id}" update has invalid data: ${errors.join(', ')}`);
        }
        if (warnings.length > 0) {
          warnings.forEach(w => addSystemMessage(`[Warning] ${w}`));
        }
        if (isTypeChange) {
          const kept: Record<string, any> = {};
          if (existing.data && existing.data.label !== undefined) kept.label = existing.data.label;
          if (existing.data && existing.data.color !== undefined) kept.color = existing.data.color;
          nextNodes = nextNodes.map(ex => ex.id === id
            ? { ...ex, type: effectiveType, data: { ...kept, ...validatedData } }
            : ex);
          patchNotes.push(`Node "${id}" type changed ${existing.type} → ${effectiveType}; its old parameters were CLEARED (label/color kept). Supply all needed ${effectiveType} params.`);
        } else {
          nextNodes = nextNodes.map(ex => ex.id === id
            ? { ...ex, id, type: existing.type, data: { ...ex.data, ...validatedData } }
            : ex);
        }
      });
    }
    if (parsed.addedEdges) {
      parsed.addedEdges.forEach((e: any) => {
        const res = validateAndResolveEdge(e, nextEdges);
        if (!res.isValid) {
          droppedEdges.push(`${e.source} → ${e.target}${e.targetHandle ? `.${e.targetHandle}` : ''} (${res.error})`);
          return;
        }
        const { sourceHandle, targetHandle } = res;
        const id = String(e.id || `e_${e.source}_${e.target}_${targetHandle}`);
        nextEdges = nextEdges.filter(existing => existing.id !== id);
        nextEdges.push({ ...e, id, source: String(e.source), target: String(e.target), sourceHandle, targetHandle });
      });
    }
  }

  if (Array.isArray(parsed.nodes) && Array.isArray(parsed.edges) && parsed.nodes.length > 0) {
    hasUpdates = true;
    nextNodes = parsed.nodes.map((n: any) => {
      const id = String(n.id);
      const { warnings, errors, validatedData } = validateAndNormalizeNodeData(id, n.type, n.data, store.macros);
      if (errors.length > 0) {
        droppedEdges.push(`Node "${id}" has invalid data: ${errors.join(', ')}`);
      }
      if (warnings.length > 0) {
        warnings.forEach(w => addSystemMessage(`[Warning] ${w}`));
      }
      return { ...n, id, data: validatedData, position: n.position || { x: 0, y: 0 } };
    });
    const rebuilt: any[] = [];
    for (const e of parsed.edges) {
      const res = validateAndResolveEdge(e, rebuilt);
      if (!res.isValid) {
        droppedEdges.push(`${e.source} → ${e.target}${e.targetHandle ? `.${e.targetHandle}` : ''} (${res.error})`);
        continue;
      }
      const { sourceHandle, targetHandle } = res;
      rebuilt.push({
        ...e,
        id: String(e.id || `e_${e.source}_${e.target}_${targetHandle}`),
        source: String(e.source),
        target: String(e.target),
        sourceHandle,
        targetHandle,
      });
    }
    nextEdges = rebuilt;
  }

  return hasUpdates ? { nodes: nextNodes, edges: nextEdges, droppedEdges, patchNotes } : null;
}
