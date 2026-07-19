// DesignGenome — the typed intermediate between the plan and the geometry.
//
// Pillar 1 of the graph-intelligence upgrade (docs/graph_intelligence_upgrade_plan_jul18.md).
// The genome is the "genotype": a compact, semantic description of WHAT is being
// designed (archetype), its PARTS and how many, and their roles/relations —
// captured BEFORE any geometry op is chosen. It exists so that design intent is
// preserved independently of the geometry that realizes it: when the repair loop
// simplifies the graph (3 petal rings -> 1), the genome still says "3 rings", so
// we can measure the gap (scoreIntentRealization) and surface the dropped detail
// instead of silently shipping a basic result.
//
// This module is kernel-free and dependency-light (type-only import), so it is
// trivially unit-testable in Node, like graphValidation.ts.

import type { GeometryReport } from '../store/types';

export interface GenomePart {
  id: string;                    // human name of the part, e.g. "petals", "stem"
  role?: string;                 // 'support' | 'focal' | 'repeated' | 'detail' | 'shell' | ...
  count?: number | string;      // how many: a number (21) or a slider label ("petalCount")
  of?: string;                  // if these are instances OF another part, its id (petals "of" petal)
  on?: string;                  // placed ON which part/skeleton, e.g. "stem"
}

export interface DesignGenome {
  archetype: string;             // concept/archetype, e.g. "radial-bloom-flower"
  parts: GenomePart[];           // the topological layer: parts + counts + relations
  detailBudget?: 'low' | 'medium' | 'high';
  notes?: string;
}

export interface GenomeValidation {
  genome: DesignGenome | null;
  issues: string[];
}

const MAX_PARTS = 40;

function coerceMaybeJson(v: any): any {
  if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { return JSON.parse(t); } catch { return v; }
    }
  }
  return v;
}

// Tolerant validator. Never throws: a malformed genome is optional metadata, not
// a reason to fail a turn. Returns a normalized genome (or null) plus non-fatal
// issues for logging.
export function validateGenome(raw: any): GenomeValidation {
  const issues: string[] = [];
  raw = coerceMaybeJson(raw);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { genome: null, issues: raw ? ['genome is not an object'] : [] };
  }
  const archetype = String(raw.archetype ?? '').trim();
  if (!archetype) issues.push('genome.archetype missing');

  let partsRaw = coerceMaybeJson(raw.parts);
  if (!Array.isArray(partsRaw)) { partsRaw = []; if (raw.parts) issues.push('genome.parts is not an array'); }

  const parts: GenomePart[] = [];
  for (const p0 of partsRaw.slice(0, MAX_PARTS)) {
    const p = coerceMaybeJson(p0);
    if (!p || typeof p !== 'object') continue;
    const id = String(p.id ?? p.name ?? '').trim();
    if (!id) continue;
    const part: GenomePart = { id };
    if (p.role != null) part.role = String(p.role).trim();
    if (p.count != null) part.count = typeof p.count === 'number' ? p.count : String(p.count).trim();
    if (p.of != null) part.of = String(p.of).trim();
    if (p.on != null) part.on = String(p.on).trim();
    parts.push(part);
  }
  if (partsRaw.length > MAX_PARTS) issues.push(`genome.parts truncated to ${MAX_PARTS}`);

  const detailBudget = ['low', 'medium', 'high'].includes(raw.detailBudget) ? raw.detailBudget : undefined;

  if (!archetype && parts.length === 0) return { genome: null, issues };

  return {
    genome: {
      archetype: archetype || 'unspecified',
      parts,
      detailBudget,
      notes: raw.notes != null ? String(raw.notes).slice(0, 300) : undefined,
    },
    issues,
  };
}

// Compact single-block rendering for the reasoning tab / stored records.
export function formatGenomeSummary(g: DesignGenome | null): string {
  if (!g) return '';
  const parts = g.parts.map(p => {
    const bits = [p.id];
    if (p.role) bits.push(p.role);
    if (p.count != null) bits.push(`×${p.count}`);
    if (p.of) bits.push(`of ${p.of}`);
    if (p.on) bits.push(`on ${p.on}`);
    return bits.join(' ');
  });
  return `GENOME [${g.archetype}${g.detailBudget ? `, detail:${g.detailBudget}` : ''}]: ${parts.join('; ')}`;
}

export interface IntentRealization {
  realizationScore?: number;   // 0..1, realized distinct parts / planned distinct parts
  deferredDetail: string[];    // planned detail that appears to be missing/collapsed
}

// Compare the planned genome against the realized geometry report. Conservative
// by design — only flags CLEAR drops so it never wastes a repair round on a false
// alarm. This is the signal that makes "simplified to survive" visible instead of
// invisible, and the hook for a future re-enrichment pass.
export function scoreIntentRealization(
  genome: DesignGenome | null,
  report: GeometryReport | null,
): IntentRealization {
  if (!genome || !report) return { realizationScore: undefined, deferredDetail: [] };

  // Distinct parts = parts that are their own form (not just instances OF another).
  const distinct = genome.parts.filter(p => !p.of);
  const plannedDistinct = Math.max(1, distinct.length);
  const realizedLeaves = report.meshedLeafCount ?? (report.leaves || []).filter(l => l.meshOk).length;

  const deferred: string[] = [];

  // 1. Structural drop: markedly fewer rendered leaves than planned distinct parts.
  if (realizedLeaves < Math.ceil(plannedDistinct * 0.6)) {
    deferred.push(
      `Intent gap: planned ${plannedDistinct} distinct parts (${distinct.map(p => p.id).slice(0, 8).join(', ')}) but only ${realizedLeaves} rendered — re-add the dropped parts rather than shipping the simplified form.`,
    );
  }

  // 2. Repetition collapsed: a part planned as repeated whose count slider is <=1.
  const sliders = report.sliders || {};
  const sliderKeys = Object.keys(sliders);
  for (const p of genome.parts) {
    const wantsMany = (typeof p.count === 'number' && p.count > 1) || p.role === 'repeated';
    if (!wantsMany) continue;
    const ref = typeof p.count === 'string' ? p.count.toLowerCase() : '';
    const key = sliderKeys.find(k => {
      const kl = k.toLowerCase();
      return kl.includes(p.id.toLowerCase()) || (ref && kl.includes(ref)) || kl.includes('count');
    });
    if (key && sliders[key] <= 1) {
      deferred.push(`"${p.id}" was planned as repeated (count ${p.count ?? '>1'}) but slider "${key}" is ${sliders[key]} — restore the repetition.`);
    }
  }

  const realizationScore = Number(Math.max(0, Math.min(1, realizedLeaves / plannedDistinct)).toFixed(2));
  return { realizationScore, deferredDetail: deferred };
}
