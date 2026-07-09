// Retrieval over the success library: provider embeddings when available,
// lexical token-overlap fallback otherwise. This is the step that turns the
// stored examples into working intelligence — top matches are injected into
// the system prompt as few-shot exemplars.

import type { SuccessExample } from '../nodes/NodeDefinitions';
import { tryEmbed } from './api';

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2);
}

function lexicalScore(query: string, docText: string): number {
  const q = new Set(tokenize(query));
  const d = new Set(tokenize(docText));
  if (q.size === 0 || d.size === 0) return 0;
  let overlap = 0;
  q.forEach(t => { if (d.has(t)) overlap++; });
  // Dice coefficient
  return (2 * overlap) / (q.size + d.size);
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function exampleSearchText(ex: SuccessExample): string {
  return [ex.prompts.join(' '), ex.comment, ex.tags.join(' ')].join(' ');
}

export async function retrieveSimilarExamples(
  query: string,
  examples: SuccessExample[],
  topK = 2,
): Promise<SuccessExample[]> {
  if (examples.length === 0) return [];

  // Try embedding path: query embedding + stored example embeddings
  const queryEmbedding = await tryEmbed(query);

  const scored = examples.map(ex => {
    let score: number;
    if (queryEmbedding && ex.embedding && ex.embedding.length === queryEmbedding.length) {
      score = cosine(queryEmbedding, ex.embedding);
    } else {
      score = lexicalScore(query, exampleSearchText(ex));
    }
    return { ex, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const MIN_SCORE = queryEmbedding ? 0.35 : 0.12;
  return scored.filter(s => s.score >= MIN_SCORE).slice(0, topK).map(s => s.ex);
}

// Condensed, token-cheap view of a graph for prompt injection
export function condenseGraph(nodes: any[], edges: any[], maxNodes = 40): string {
  const lines: string[] = [];
  const shown = nodes.filter(n => n.type !== 'group').slice(0, maxNodes);
  for (const n of shown) {
    const params = Object.entries(n.data || {})
      .filter(([k, v]) => !k.includes('__') && (typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'))
      .map(([k, v]) => `${k}=${typeof v === 'string' && String(v).length > 40 ? String(v).slice(0, 40) + '…' : v}`)
      .join(', ');
    const inputs = edges
      .filter(e => e.target === n.id)
      .map(e => `${e.targetHandle}←${e.source}.${e.sourceHandle}`)
      .join(', ');
    lines.push(`${n.id} [${n.type}] {${params}}${inputs ? ` inputs: ${inputs}` : ''}`);
  }
  if (nodes.length > maxNodes) lines.push(`… and ${nodes.length - maxNodes} more nodes`);
  return lines.join('\n');
}

export function formatExampleForPrompt(ex: SuccessExample, index: number): string {
  const g = ex.graphFinal;
  return `--- Verified example ${index + 1} (user-confirmed successful design) ---
Request(s): ${ex.prompts.slice(0, 3).join(' | ').slice(0, 300)}
${ex.comment ? `User comment: ${ex.comment.slice(0, 200)}` : ''}
${ex.plan ? `Plan: ${ex.plan.slice(0, 400)}` : ''}
Graph (${g.nodes.length} nodes):
${condenseGraph(g.nodes, g.edges, 30)}`;
}
