// ---------------------------------------------------------------------------
// Import the existing session exports (JSONs/*.json) into the store, and mark
// a version so everything captured from now on is comparable against them.
//
//   node scripts/db-import.mjs                 → import, tag v1
//   node scripts/db-import.mjs --tag v2        → import, tag v2
//   node scripts/db-import.mjs --archive       → also move JSONs/ aside
//
// Re-running is safe: a session already present is skipped, so an interrupted
// import can simply be run again. Nothing is deleted; --archive MOVES files.
// ---------------------------------------------------------------------------

import { readdirSync, readFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as store from './lib/db.mjs';
import { appendEvent } from './lib/events.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { openDb, stats, dbFile } = store;

// The event log is the source of truth, so the import writes there too — not
// just into the index. Without this a `db-rebuild` would quietly drop the whole
// imported corpus, because it would only ever have existed in the index.
const emit = (type, payload) => {
  const rec = appendEvent(root, 'import', { type, ...payload });
  try {
    if (type === 'version') store.addVersion(rec);
    if (type === 'session') store.upsertSession(rec);
    if (type === 'turn')    store.addTurn(rec);
    if (type === 'message') store.addMessage(rec);
    if (type === 'run')     store.addRun(rec);
    if (type === 'comment') store.addComment(rec);
  } catch (err) { console.warn(`  ! indexing ${type}: ${err.message}`); }
};
const addVersion   = (v) => emit('version', v);
const upsertSession= (v) => emit('session', v);
const addTurn      = (v) => emit('turn', v);
const addMessage   = (v) => emit('message', v);
const addRun       = (v) => emit('run', v);
const addComment   = (v) => emit('comment', v);

const args = process.argv.slice(2);
const tag = valueOf('--tag') ?? 'v1';
const doArchive = args.includes('--archive');

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
}

// A session's identity is its export filename — stable, and it makes a
// re-import idempotent without inventing hashes.
const sessionIdFor = (file) => `import:${basename(file, '.json')}`;

const db = openDb(root);
let gitSha = null;
try { gitSha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch { /* not a repo */ }
addVersion({ tag, gitSha, note: 'baseline — the corpus captured before automatic storage (pre Jul-29)' });
console.log(`Version tag: ${tag}${gitSha ? ` @ ${gitSha}` : ''}`);

const jsonDir = join(root, 'JSONs');
if (!existsSync(jsonDir)) {
  console.log('No JSONs/ folder — nothing to import.');
  report();
  process.exit(0);
}

const files = readdirSync(jsonDir).filter(f => f.endsWith('.json')).sort();
const already = new Set(db.prepare('SELECT id FROM sessions').all().map(r => r.id));

let imported = 0, skipped = 0, turns = 0, msgs = 0;
for (const f of files) {
  const id = sessionIdFor(f);
  if (already.has(id)) { skipped++; continue; }
  let d;
  try { d = JSON.parse(readFileSync(join(jsonDir, f), 'utf8')); }
  catch { console.warn(`  ! ${f} is not readable JSON — left alone, not imported`); continue; }

  const agent = d.agent || {};
  const conv = Array.isArray(d.conversation) ? d.conversation : [];
  const tl = Array.isArray(d.timeline) ? d.timeline : [];
  const g = d.graph || {};
  const startedAt = d.exportedAt || fileStamp(f);

  upsertSession({
    id, startedAt, model: agent.model ?? null, provider: agent.provider ?? null,
    versionTag: tag, source: 'imported',
    firstPrompt: (conv.find(m => m.role === 'user')?.content ?? '').slice(0, 500),
  });

  for (const t of tl) {
    addTurn({
      sessionId: id, turnIndex: t.turn, at: t.at, trigger: t.trigger, label: t.label,
      nodeCount: t.nodeCount, edgeCount: t.edgeCount, isolatedCount: t.isolatedCount,
      diff: t.diff, details: t.details, nodes: t.nodes, edges: t.edges,
    });
    turns++;
  }

  // Exports predating timeline v2 have no turns — record the final state as one.
  if (tl.length === 0 && (g.nodes?.length || g.edges?.length)) {
    const wired = new Set();
    (g.edges || []).forEach(e => { wired.add(String(e.source)); wired.add(String(e.target)); });
    addTurn({
      sessionId: id, at: startedAt, trigger: 'export', label: 'final state (pre-timeline export)',
      nodeCount: (g.nodes || []).length, edgeCount: (g.edges || []).length,
      isolatedCount: (g.nodes || []).filter(n => !wired.has(String(n.id))).length,
      nodes: g.nodes, edges: g.edges,
    });
    turns++;
  }

  conv.forEach((m, i) => { addMessage({ sessionId: id, seq: i, role: m.role, content: m.content, at: startedAt }); msgs++; });

  if (d.comment) {
    addComment({ sessionId: id, body: d.comment, tag: 'import' });
    db.prepare('UPDATE sessions SET verdict = ? WHERE id = ?').run(verdictOf(d.comment), id);
  }
  imported++;
}

// The legacy per-run log becomes the runs table.
for (const name of readdirSync(root).filter(f => /^intelligence_log(\.\d+)?\.json$/.test(f))) {
  let rows = [];
  try { rows = JSON.parse(readFileSync(join(root, name), 'utf8')); } catch { continue; }
  if (!Array.isArray(rows)) continue;
  const seen = new Set(
    db.prepare("SELECT at, IFNULL(model,'') m, IFNULL(request,'') q FROM runs")
      .all().map(r => `${r.at}|${r.m}|${r.q}`),
  );
  let added = 0;
  for (const r of rows) {
    const k = `${r.timestamp}|${r.model ?? ''}|${r.request ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    addRun({ at: r.timestamp, model: r.model, request: r.request, success: r.success,
             responseTimeMs: r.responseTimeMs, nodeCount: r.nodeCount, edgeCount: r.edgeCount,
             error: r.error, versionTag: tag });
    added++;
  }
  if (added) console.log(`  ${name}: ${added} runs imported`);
}

console.log(`\nSessions imported: ${imported}   already present: ${skipped}`);
console.log(`Turns: ${turns}   messages: ${msgs}`);

if (doArchive && imported > 0) {
  const dest = join(root, 'archive', tag);
  mkdirSync(dest, { recursive: true });
  let moved = 0;
  for (const f of files) { renameSync(join(jsonDir, f), join(dest, f)); moved++; }
  console.log(`\nArchived ${moved} export files → archive/${tag}/`);
  console.log('(moved, not deleted — the database now holds their contents)');
}

report();

function report() {
  const s = stats();
  console.log(`\nStore: ${dbFile()}`);
  console.log(`  sessions ${s.sessions} · turns ${s.turns} · messages ${s.messages} · runs ${s.runs} · comments ${s.comments}`);
}

function fileStamp(f) {
  const m = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(f);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.000Z` : new Date().toISOString();
}

// Your own one-line verdicts, coded so they can be queried alongside machine
// metrics. Deliberately crude — it reproduces the labelling you already do.
function verdictOf(comment) {
  const c = String(comment).toLowerCase();
  if (/\bfail|no visible|zero export/.test(c)) return 'FAIL';
  if (/primitive|poor|missed|only|bad/.test(c) && !/amazing|almost correct/.test(c)) return 'WEAK';
  if (/interest|amazing|nice|almost correct|best|not.*bad|progres/.test(c)) return 'OK';
  return null;
}
