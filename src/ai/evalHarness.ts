// Eval harness: a fixed prompt set across 4 complexity levels, run through the
// exact same agent pipeline, scored automatically. Run before/after any change
// to prompts, node library, or loop logic — regressions become visible numbers.

import { useStore, generateUUID } from '../store/useStore';
import { processUserIntent } from './agent';

export interface EvalPrompt {
  id: string;
  level: 1 | 2 | 3 | 4;
  prompt: string;
}

export const EVAL_PROMPTS: EvalPrompt[] = [
  // L1 — primitives + single transform
  { id: 'L1-01', level: 1, prompt: 'Make a cube with 15mm sides.' },
  { id: 'L1-02', level: 1, prompt: 'Create a sphere of radius 8 sitting on the ground plane (bottom touching Z=0).' },
  { id: 'L1-03', level: 1, prompt: 'Make a cylinder 30 tall and 4 wide, standing upright.' },
  { id: 'L1-04', level: 1, prompt: 'Create a flat rectangular plate 40 x 20 with rounded edges.' },
  { id: 'L1-05', level: 1, prompt: 'Make a cone that is 20 tall with a base radius of 10 and a tip radius of 1.' },
  { id: 'L1-06', level: 1, prompt: 'Create the 3D text "C33D" extruded 3 units deep.' },
  { id: 'L1-07', level: 1, prompt: 'Make a box 10x10x10 rotated 45 degrees around the Z axis.' },

  // L2 — booleans, patterns, shells
  { id: 'L2-01', level: 2, prompt: 'Make a 30x30x5 plate with a 10mm diameter hole through the center.' },
  { id: 'L2-02', level: 2, prompt: 'Create a hollow box 20x20x20 with 1.5 thick walls and an open top.' },
  { id: 'L2-03', level: 2, prompt: 'Make a round plate with 6 bolt holes arranged in a circle near the edge.' },
  { id: 'L2-04', level: 2, prompt: 'Create a simple dome of radius 12 sitting on the ground.' },
  { id: 'L2-05', level: 2, prompt: 'Make a row of 5 identical cylinders spaced 15 apart along X.' },
  { id: 'L2-06', level: 2, prompt: 'Create a cup: hollow cylinder with a bottom, wall thickness 1, height 25, radius 8.' },
  { id: 'L2-07', level: 2, prompt: 'Make a ring (torus-like) by subtracting a smaller cylinder from a bigger one, 2 units tall.' },
  { id: 'L2-08', level: 2, prompt: 'Create a tapered column: wide circular base lofted to a narrow top, 40 tall.' },
  { id: 'L2-09', level: 2, prompt: 'Create a smooth helical spline curve with 8 turns, radius 10, height 40, and 200 points.' },

  // L3 — multi-part composition + parametric relationships
  { id: 'L3-01', level: 3, prompt: 'Design a simple table: rectangular top with four legs at the corners. Make the leg thickness a parameter driven from the tabletop size.' },
  { id: 'L3-02', level: 3, prompt: 'Build a simple chair with a seat, four legs and a backrest, in two different colors.' },
  { id: 'L3-03', level: 3, prompt: 'Create a chess pawn: revolve or stack profiles to get a base, body and spherical head.' },
  { id: 'L3-04', level: 3, prompt: 'Design a small house: box body, triangular/prism roof, door and two windows carved into the front facade.' },
  { id: 'L3-05', level: 3, prompt: 'Make a dumbbell: two spheres connected by a cylindrical bar, with one NumberSlider controlling the overall size.' },
  { id: 'L3-06', level: 3, prompt: 'Create a simple bridge: deck, two support pillars, and railings made with a linear pattern of posts.' },
  { id: 'L3-07', level: 3, prompt: 'Design a rocket: cylindrical body, nose cone, and three fins arranged radially, multi-colored.' },
  { id: 'L3-08', level: 3, prompt: 'Make a gear-like disc: cylinder with 8 teeth arranged with a circular pattern around the rim.' },
  { id: 'L3-09', level: 3, prompt: 'Sweep a circular profile of radius 2 along a helical spine of radius 15, pitch 10, height 50.' },
  { id: 'L3-10', level: 3, prompt: 'Create a 20x20x20 cube, select its vertical corners (edges parallel to Z), and apply a variable fillet that transitions from radius 1 at the bottom to radius 4 at the top.' },
  { id: 'L3-11', level: 3, prompt: 'make a cube, split its top face 3x3, and extrude the center cell' },
  { id: 'L3-12', level: 3, prompt: 'Create a parametric rock using formulaic sliders for size and roughness, ensuring all dimensions scale with the rockSize slider (use rockSize * 0.8, etc., with spaces in labels but correctly mapped normalized formulas).' },

  // L4 — open creative briefs
  { id: 'L4-01', level: 4, prompt: 'Design a modern coffee table with an interesting parametric leg structure. Expose 3 design sliders.' },
  { id: 'L4-02', level: 4, prompt: 'Create a small futuristic tower building with a paneled facade using surface subdivision.' },
  { id: 'L4-03', level: 4, prompt: 'Design a decorative vase with an organic lofted profile and a hollow interior.' },
  { id: 'L4-04', level: 4, prompt: 'Build a simple stadium: oval bowl, tiered seating suggestion, and a field in the middle.' },
  { id: 'L4-05', level: 4, prompt: 'Design a stylized tree: trunk, branching suggestion, and a scattered foliage canopy.' },
  { id: 'L4-06', level: 4, prompt: 'Create a sci-fi drone: central body with four rotor arms and rotor discs, multi-colored.' },
  { id: 'L4-07', level: 4, prompt: 'Design a parametric bookshelf where shelf count and spacing are driven by sliders.' },
  // C7: the derivation benchmark — pass requires geometry sane AND a high
  // derivation ratio (tracked via EvalResultEntry.derivationRatio).
  { id: 'L4-08', level: 4, prompt: 'Design a recognizable stadium where every major part derives from at most 2 driving curves: build the boundary ellipse first, transform/offset it into rails, loft the seating bowl from the rails (LoftCurves), divide the boundary and instance columns on the points (DivideCurve then InstanceOnPoints), and run a roof ring along a curve (Pipe with its path input). Expose 2-3 driving sliders.' },
];

let stopRequested = false;
export function stopEvalSuite() {
  stopRequested = true;
}

export async function runEvalSuite(onProgress?: (done: number, total: number, current: string) => void) {
  const store = useStore.getState();
  if (store.isRunningEvals) return;
  store.setIsRunningEvals(true);
  stopRequested = false;

  const modelName = (() => {
    const a = store.agentSlots.find(s => s.id === store.activeAgentId);
    return a ? `${a.name} (${a.model})` : 'Unknown';
  })();

  // Snapshot user state to restore afterwards
  const savedNodes = JSON.parse(JSON.stringify(store.nodes));
  const savedEdges = JSON.parse(JSON.stringify(store.edges));

  try {
    for (let i = 0; i < EVAL_PROMPTS.length; i++) {
      if (stopRequested) {
        useStore.getState().addMessage({ id: generateUUID(), role: 'system', content: `Eval run stopped by user after ${i}/${EVAL_PROMPTS.length} prompts.` });
        break;
      }
      const p = EVAL_PROMPTS[i];
      onProgress?.(i, EVAL_PROMPTS.length, p.id);

      // Fresh canvas per prompt
      useStore.getState().clearGraph();
      useStore.getState().clearMessages();
      useStore.getState().addMessage({ id: generateUUID(), role: 'user', content: `[EVAL ${p.id}] ${p.prompt}` });

      const t0 = performance.now();
      let outcome;
      try {
        outcome = await processUserIntent(p.prompt, { forEval: true });
      } catch (err: any) {
        outcome = {
          parsedOk: false, evaluatedOk: false, geometrySane: false,
          nodeCount: 0, edgeCount: 0, durationMs: Math.round(performance.now() - t0),
          error: String(err.message || err),
        };
      }

      useStore.getState().addEvalResult({
        timestamp: new Date().toISOString(),
        model: modelName,
        promptId: p.id,
        level: p.level,
        prompt: p.prompt,
        parsedOk: outcome.parsedOk,
        evaluatedOk: outcome.evaluatedOk,
        geometrySane: outcome.geometrySane,
        nodeCount: outcome.nodeCount,
        edgeCount: outcome.edgeCount,
        durationMs: outcome.durationMs,
        visionScore: outcome.visionScore,
        proportionalIntegrity: outcome.proportionalIntegrity,
        derivationRatio: outcome.derivationRatio,
        skeletonNodes: outcome.skeletonNodes,
        magicNumberCount: outcome.magicNumberCount,
        error: outcome.error,
      });
    }
    onProgress?.(EVAL_PROMPTS.length, EVAL_PROMPTS.length, 'done');
  } finally {
    // Restore user's graph
    useStore.getState().setNodes(savedNodes);
    useStore.getState().setEdges(savedEdges);
    useStore.getState().setIsRunningEvals(false);
  }
}
