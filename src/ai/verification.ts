// Verification: turns kernel measurements into symbolic percepts the model can
// reason over, and runs an optional vision pass over viewport snapshots.

import type { GeometryReport } from '../store/useStore';
import { useStore } from '../store/useStore';
import { chatCompletionVision } from './api';
import { isSystemError } from '../utils/errors';

export interface SanityResult {
  sane: boolean;
  issues: string[];
  // Non-gating structural warnings (e.g. unlabeled sliders): shown to the model
  // in the geometry report but never trigger the auto-repair loop.
  warnings?: string[];
}

const fmt = (n: number) => Math.round(n * 100) / 100;

type Box = { min: number[]; max: number[]; center: number[]; size: number[] };

// Signed overlap along one axis: >0 boxes overlap, <0 is the gap between them.
const axisOverlap = (a: Box, b: Box, i: number) =>
  Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i]);

// True when every corner of `inner` lies within `outer` (small tolerance).
function isContained(inner: Box, outer: Box, tol: number): boolean {
  for (let i = 0; i < 3; i++) {
    if (inner.min[i] < outer.min[i] - tol || inner.max[i] > outer.max[i] + tol) return false;
  }
  return true;
}

// True when all live leaves share essentially the same center — the signature of
// an origin collapse (a missing slider→expression or solid edge zeroed the
// positions), which otherwise manifests as O(n^2) false "fully inside" spam.
function isCollapsed(leaves: { bbox: Box }[], diag: number): boolean {
  if (leaves.length < 3) return false;
  const tol = Math.max(diag * 0.05, 1e-3);
  const c0 = leaves[0].bbox.center;
  const near = leaves.filter(l =>
    [0, 1, 2].every(i => Math.abs(l.bbox.center[i] - c0[i]) <= tol)
  ).length;
  return near / leaves.length >= 0.6;
}

// Object-agnostic spatial reasoning over leaf bounding boxes. Returns both
// concrete problems (for the sanity gate) and a human-readable relations
// summary (fed to the model so it can see how parts sit relative to each other).
function analyzeSpatialRelations(report: GeometryReport): { contained: string[]; detached: string[]; relations: string[] } {
  const contained: string[] = [];
  const detached: string[] = [];
  const relations: string[] = [];
  // Only non-degenerate leaves participate in placement checks. A null/zero
  // bbox is a null-geometry problem (reported elsewhere), not a "move it" one.
  const leaves = report.leaves.filter((l: any) =>
    l.bbox && l.bbox.size.every((s: number) => isFinite(s) && s > 1e-6)
  ) as { id: string; bbox: Box; volume?: number }[];
  if (leaves.length < 2) return { contained, detached, relations };

  const diag = report.scene
    ? Math.sqrt(report.scene.size.reduce((s: number, v: number) => s + v * v, 0))
    : 0;
  const tol = Math.max(diag * 0.01, 1e-3); // ~1% of scene diagonal

  // Collapse guard: emit ONE root-cause line instead of the full pairwise list,
  // which is otherwise dozens of misleading "buried" messages.
  if (isCollapsed(leaves, diag)) {
    contained.push('Most parts share the same center (geometry collapsed toward the origin). This almost always means a slider→Expression or solid input edge is missing — fix the missing connection (see structural/null-geometry errors above); do NOT try to move parts apart.');
    return { contained, detached, relations };
  }

  // Containment: one part fully buried inside another (hidden/mispositioned).
  // Deduplicate by unordered pair and cap to keep the signal readable.
  const seenPairs = new Set<string>();
  for (const a of leaves) {
    for (const b of leaves) {
      if (a.id === b.id) continue;
      const pairKey = [a.id, b.id].sort().join('||');
      if (seenPairs.has(pairKey)) continue;
      const volA = a.volume ?? 0, volB = b.volume ?? 0;
      if (isContained(a.bbox, b.bbox, tol) && (volB === 0 || volA <= volB)) {
        seenPairs.add(pairKey);
        // Enrich with the numbers the model needs to formulate a fix.
        const sz = a.bbox.size, oc = b.bbox.center, oz = b.bbox.size;
        const push = fmt(oz[2] / 2 + sz[2] / 2 + tol);
        contained.push(`Part "${a.id}" (size [${sz.map(fmt).join(', ')}], center [${a.bbox.center.map(fmt).join(', ')}]) is fully inside "${b.id}" (size [${oz.map(fmt).join(', ')}], center [${oc.map(fmt).join(', ')}]) — hidden/buried. If it is a surface detail of "${b.id}" (rim, window, panel), keep it attached and nudge it to protrude slightly along its thin axis (small offset, or make it a bit larger). Otherwise place it with Align relative to "${b.id}" — do NOT fling it far away (e.g. Z +${push} only if it truly belongs on top).`);
      }
      if (contained.length >= 5) break;
    }
    if (contained.length >= 5) break;
  }

  // Connectivity: does each part touch/overlap at least one other part?
  for (const a of leaves) {
    let touches = false;
    let minGap = Infinity;
    let nearest = '';
    for (const b of leaves) {
      if (a.id === b.id) continue;
      const ov = [0, 1, 2].map(i => axisOverlap(a.bbox, b.bbox, i));
      if (ov.every(o => o > -tol)) { touches = true; break; }
      // gap = largest single-axis separation (the axes that are apart)
      const gap = Math.max(...ov.filter(o => o < 0).map(o => -o));
      if (gap < minGap) { minGap = gap; nearest = b.id; }
    }
    if (!touches && diag > 0 && minGap > diag * 0.02) {
      detached.push(`Part "${a.id}" is detached from the rest of the model (nearest is "${nearest}", gap ${fmt(minGap)}). If it should be attached, align its bounding box to touch a neighbor.`);
    }
  }

  // Adjacency summary — which parts overlap/touch which (helps the model reason
  // about assembly without re-deriving coordinates).
  for (const a of leaves) {
    const neighbors = leaves
      .filter(b => b.id !== a.id && [0, 1, 2].every(i => axisOverlap(a.bbox, b.bbox, i) > -tol))
      .map(b => b.id);
    if (neighbors.length) relations.push(`${a.id} touches: ${neighbors.join(', ')}`);
  }

  return { contained, detached, relations };
}

export function checkGeometrySanity(report: GeometryReport | null, evalError: string | null): SanityResult {
  const issues: string[] = [];
  if (evalError) {
    if (isSystemError(evalError)) {
      issues.push(`Engine fault — not caused by your design. Do not modify the graph to work around it; the system is retrying.`);
    } else {
      issues.push(`Evaluation error: ${evalError}`);
    }
  }
  if (!report) return { sane: issues.length === 0, issues };

  if (report.meshedLeafCount === 0 && report.leaves.length > 0) {
    issues.push('No leaf node produced meshable geometry — the viewport is empty.');
  }
  for (const err of report.nodeErrors) {
    issues.push(`Node "${err.id}" failed: ${err.error}`);
  }
  for (const leaf of report.leaves) {
    if (!leaf.meshOk) {
      issues.push(`Leaf "${leaf.id}" could not be meshed${leaf.error ? `: ${leaf.error}` : ''}.`);
      continue;
    }
    if (leaf.bbox) {
      const [sx, sy, sz] = leaf.bbox.size;
      if (!isFinite(sx) || !isFinite(sy) || !isFinite(sz)) {
        issues.push(`Leaf "${leaf.id}" has a non-finite bounding box (degenerate geometry).`);
      } else if (sx < 1e-6 && sy < 1e-6 && sz < 1e-6) {
        issues.push(`Leaf "${leaf.id}" has zero size (degenerate geometry).`);
      }
    }
    if (leaf.volume !== undefined && leaf.volume <= 0) {
      issues.push(`Leaf "${leaf.id}" has non-positive volume (${fmt(leaf.volume)}) — likely inverted or degenerate solid.`);
    }
  }

  const warnings: string[] = [];

  // Scattered-parts check: any leaf whose center is far outside the scene bulk
  if (report.scene && report.leaves.length > 1) {
    const diag = Math.sqrt(report.scene.size[0] ** 2 + report.scene.size[1] ** 2 + report.scene.size[2] ** 2);
    const sceneCenter = [
      (report.scene.min[0] + report.scene.max[0]) / 2,
      (report.scene.min[1] + report.scene.max[1]) / 2,
      (report.scene.min[2] + report.scene.max[2]) / 2,
    ];
    for (const leaf of report.leaves) {
      if (!leaf.bbox) continue;
      const d = Math.sqrt(
        (leaf.bbox.center[0] - sceneCenter[0]) ** 2 +
        (leaf.bbox.center[1] - sceneCenter[1]) ** 2 +
        (leaf.bbox.center[2] - sceneCenter[2]) ** 2
      );
      if (diag > 0 && d > diag * 0.75) {
        warnings.push(`Leaf "${leaf.id}" is far from the rest of the model (distance ${fmt(d)} vs scene diagonal ${fmt(diag)}) — it may be floating in space unintentionally.`);
      }
    }
  }

  // Coincident duplicates: two leaves with (near-)identical bbox center AND
  // size are almost always stale copies left behind by a repair round — they
  // z-fight in the viewport and balloon the node count. Flag each pair once.
  {
    const live = report.leaves.filter((l: any) => l.bbox && l.bbox.size.every((s: number) => isFinite(s)));
    const diag = report.scene ? Math.sqrt(report.scene.size.reduce((s: number, v: number) => s + v * v, 0)) : 0;
    const tol = Math.max(diag * 0.005, 1e-4);
    let flagged = 0;
    for (let i = 0; i < live.length && flagged < 4; i++) {
      for (let j = i + 1; j < live.length && flagged < 4; j++) {
        const a = live[i].bbox!, b = live[j].bbox!;
        const same = [0, 1, 2].every(k =>
          Math.abs(a.center[k] - b.center[k]) <= tol && Math.abs(a.size[k] - b.size[k]) <= tol);
        if (same) {
          flagged++;
          warnings.push(`Leaves "${live[i].id}" and "${live[j].id}" occupy the exact same space (same center and size) — one is almost certainly a stale duplicate from an earlier attempt. Remove one of them (remove_nodes), do not move it.`);
        }
      }
    }
  }

  // Object-agnostic containment check: a part fully buried inside another is
  // almost always a positioning/sizing mistake and is invisible in the viewport.
  const { contained } = analyzeSpatialRelations(report);
  warnings.push(...contained);

  // Perturbation test issues
  if ((report as any).perturbationIssues && (report as any).perturbationIssues.length > 0) {
    warnings.push(...(report as any).perturbationIssues);
  }

  // Flag any Translate node with large literal offsets relative to the leaf bbox
  const translateNodes = report.leaves.length > 0 ? (useStore.getState().nodes.filter(n => n.type === 'Translate')) : [];
  for (const tNode of translateNodes) {
    const data = tNode.data as any;
    const xVal = parseFloat(data?.x ?? '0');
    const yVal = parseFloat(data?.y ?? '0');
    const zVal = parseFloat(data?.z ?? '0');
    const isXLiteral = !data?.x || !isNaN(xVal);
    const isYLiteral = !data?.y || !isNaN(yVal);
    const isZLiteral = !data?.z || !isNaN(zVal);

    if (isXLiteral && isYLiteral && isZLiteral) {
      const isAncestorOfLeaf = (leafId: string): boolean => {
        const visited = new Set<string>();
        const queue = [tNode.id];
        while (queue.length > 0) {
          const curr = queue.shift()!;
          if (curr === leafId) return true;
          if (visited.has(curr)) continue;
          visited.add(curr);
          const outgoing = useStore.getState().edges.filter(e => e.source === curr).map(e => e.target);
          queue.push(...outgoing);
        }
        return false;
      };

      const dependentLeaves = report.leaves.filter(l => isAncestorOfLeaf(l.id) && l.bbox);
      for (const leaf of dependentLeaves) {
        if (!leaf.bbox) continue;
        const size = leaf.bbox.size;
        const maxOffset = Math.max(Math.abs(xVal), Math.abs(yVal), Math.abs(zVal));
        const maxPartSize = Math.max(size[0], size[1], size[2]);
        if (maxPartSize > 0 && maxOffset > maxPartSize * 0.20) {
          warnings.push(`Translate node "${tNode.id}" uses absolute literal offset [${data?.x || 0}, ${data?.y || 0}, ${data?.z || 0}] which is larger than 20% of the part size (${fmt(maxPartSize)}). Derive these coordinates from driver sliders (e.g. using a formula) or use Align to stack parts.`);
          break;
        }
      }
    }
  }

  if (report.nodeEconomyWarning) {
    warnings.push(`Node economy warning: This graph has too many transform nodes (${report.transformCount}) relative to the number of rendered leaves (${report.leaves.length}). Use list-driven transforms, patterns (LinearPattern/CircularPattern), or instancers (PlaceOnVertices/ScatterOnSurface) to repeat shapes instead of duplicating Translate/Rotate/Scale nodes.`);
  }
  return { sane: issues.length === 0, issues, warnings };
}

// Compact textual report for the model — symbolic percepts, not raw dumps.
export function formatGeometryReport(report: GeometryReport | null, evalError: string | null): string {
  if (evalError) {
    if (isSystemError(evalError)) {
      return `EVALUATION FAILED: Engine fault — not caused by your design. Do not modify the graph to work around it; the system is retrying.`;
    }
    return `EVALUATION FAILED: ${evalError}`;
  }
  if (!report) return 'No geometry report available.';
  const lines: string[] = [];
  lines.push(`Meshed leaves: ${report.meshedLeafCount}/${report.leaves.length}`);
  if (report.nodesPerLeafRatio !== undefined) {
    lines.push(`Node-per-leaf ratio: ${report.nodesPerLeafRatio.toFixed(2)} (Total: ${report.nodeCount} nodes, Transforms: ${report.transformCount}, Leaves: ${report.leaves.length})`);
  } else if (report.nodeCount !== undefined) {
    lines.push(`Graph size: ${report.nodeCount} nodes, ${report.edgeCount ?? '?'} edges. If this grew across repair rounds without the design getting richer, you likely left stale duplicate nodes behind — remove them.`);
  }
  const sliderEntries = Object.entries(report.sliders || {});
  if (sliderEntries.length > 0) {
    lines.push(`Design sliders (referenceable in inline formulas): ${sliderEntries.map(([k, v]) => `${k}=${fmt(v as number)}`).join(', ')}`);
  }
  if (report.scene) {
    lines.push(`Scene bbox: size [${report.scene.size.map(fmt).join(', ')}], min [${report.scene.min.map(fmt).join(', ')}], max [${report.scene.max.map(fmt).join(', ')}]`);
  }
  for (const leaf of report.leaves.slice(0, 20)) {
    if (leaf.bbox) {
      lines.push(`- ${leaf.id}: size [${leaf.bbox.size.map(fmt).join(', ')}], center [${leaf.bbox.center.map(fmt).join(', ')}]${leaf.volume !== undefined ? `, volume ${fmt(leaf.volume)}` : ''}${leaf.meshOk ? '' : ' — MESH FAILED'}`);
    } else {
      lines.push(`- ${leaf.id}: NO GEOMETRY${leaf.error ? ` (${leaf.error})` : ''}`);
    }
  }
  for (const err of report.nodeErrors.slice(0, 10)) {
    lines.push(`! node "${err.id}" error: ${err.error}`);
  }
  const numberEntries = Object.entries(report.numbers || {});
  if (numberEntries.length > 0) {
    lines.push(`Numbers: ${numberEntries.slice(0, 15).map(([k, v]) => {
      if (Array.isArray(v)) {
        return `${k}=[${v.map(fmt).join(', ')}]`;
      }
      return `${k}=${fmt(v as number)}`;
    }).join(', ')}`);
  }

  // Selections percepts
  const selectionEntries = Object.entries(report.selections || {});
  if (selectionEntries.length > 0) {
    lines.push('Selections:');
    for (const [nodeId, sel] of selectionEntries) {
      lines.push(`- ${nodeId}: matched ${sel.matchedCount} elements${sel.warning ? ` (WARNING: ${sel.warning})` : ''}`);
      sel.elements.forEach((el, idx) => {
        if (idx < 5) {
          const normalStr = el.normal ? `, normal [${el.normal.map(fmt).join(', ')}]` : '';
          const dirStr = el.direction ? `, direction [${el.direction.map(fmt).join(', ')}]` : '';
          lines.push(`  * [${idx}]: center [${el.centroid.map(fmt).join(', ')}]${normalStr}${dirStr}, size ${fmt(el.areaOrLength)}`);
        }
      });
      if (sel.elements.length > 5) {
        lines.push(`  * ... and ${sel.elements.length - 5} more`);
      }
    }
  }

  // Spatial relations — concrete adjacency/attachment feedback so the model can
  // reason about how parts sit together instead of re-deriving coordinates.
  const helperEntries = Object.entries(report.helpers || {});
  if (helperEntries.length > 0) {
    lines.push('Computed Points/Vectors/Planes:');
    for (const [id, h] of helperEntries) {
      if (h.type === 'Point' || h.type === 'Vector') {
        lines.push(`- ${id} (${h.type}): [${fmt(h.x)}, ${fmt(h.y)}, ${fmt(h.z)}]`);
      } else if (h.type === 'Plane') {
        const o = h.origin, n = h.normal;
        lines.push(`- ${id} (Plane): origin [${fmt(o.x)}, ${fmt(o.y)}, ${fmt(o.z)}], normal [${fmt(n.x)}, ${fmt(n.y)}, ${fmt(n.z)}]`);
      }
    }
  }

  const { contained, detached, relations } = analyzeSpatialRelations(report);
  if (contained.length) {
    lines.push('Geometry containment warnings (hidden/buried parts):');
    contained.slice(0, 10).forEach(c => lines.push(`  ${c}`));
  }
  if (relations.length) {
    lines.push('Spatial relations (which parts touch):');
    relations.slice(0, 20).forEach(r => lines.push(`  ${r}`));
  }
  if (detached.length) {
    lines.push('Detached parts:');
    detached.slice(0, 10).forEach(d => lines.push(`  ! ${d}`));
  }
  return lines.join('\n');
}

// ---------- Vision verification pass ----------

export interface VisionVerdict {
  matches: boolean;
  score: number; // 1-5
  discrepancies: string[];
}

export async function runVisionVerification(
  intent: string,
  plan: string,
  snapshots: string[],
): Promise<VisionVerdict | null> {
  if (snapshots.length === 0) return null;
  const systemPrompt = `You are a strict CAD design reviewer. You will see viewport snapshot(s) of a 3D model that an AI built from a user request. Judge whether the geometry matches the stated intent. Respond ONLY with JSON: {"matches": boolean, "score": 1-5, "discrepancies": ["specific, actionable geometric problems"]}. Score 5 = clearly matches intent and looks well-proportioned; 1 = wrong or broken. Be specific in discrepancies (e.g. "the four legs do not touch the tabletop", not "looks off").`;
  const prompt = `User request: ${intent}\n${plan ? `AI's plan: ${plan.slice(0, 500)}\n` : ''}Judge the snapshots against this intent.`;
  try {
    const raw = await chatCompletionVision(prompt, snapshots, systemPrompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      matches: !!parsed.matches,
      score: Math.max(1, Math.min(5, Number(parsed.score) || 1)),
      discrepancies: Array.isArray(parsed.discrepancies) ? parsed.discrepancies.map(String) : [],
    };
  } catch (e) {
    console.warn('Vision verification failed:', e);
    return null;
  }
}
