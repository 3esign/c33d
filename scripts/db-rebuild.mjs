// ---------------------------------------------------------------------------
// Rebuild the queryable index from the append-only event log.
//
//   node scripts/db-rebuild.mjs
//
// The event files in data/events/*.jsonl are the source of truth. This throws
// away data/c33d.db and replays every event into a fresh one. If the index is
// ever corrupted, out of date, or you simply change what you want indexed, this
// is the answer — nothing is lost, because nothing was only ever in the index.
// ---------------------------------------------------------------------------

import { rmSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { eventFiles } from './lib/events.mjs';
import { openDb, upsertSession, addTurn, addMessage, addRun, addComment, addVersion, stats, dbFile } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainDbPath = join(root, 'data', 'c33d.db');

// Deleting the database out from under a live writer (a running dev server)
// corrupts its connection and can lose in-flight index writes. Probe for an
// exclusive lock first: if anyone is writing, stop instead of racing them.
if (existsSync(mainDbPath)) {
  try {
    const probe = new DatabaseSync(mainDbPath);
    try {
      probe.exec('PRAGMA busy_timeout = 0');
      probe.exec('BEGIN EXCLUSIVE');
      probe.exec('ROLLBACK');
    } finally {
      probe.close();
    }
  } catch (err) {
    console.error('The database is locked by another process (probably a running dev server).');
    console.error('Close running dev servers first, then rebuild.');
    console.error(`  (${err?.message})`);
    process.exit(1);
  }
}

for (const suffix of ['', '-wal', '-shm']) {
  const f = join(root, 'data', `c33d.db${suffix}`);
  if (existsSync(f)) rmSync(f);
}
console.log('Index cleared. Replaying the event log...\n');

openDb(root);

// Read every event line, oldest file first, deduplicating on a hash of the RAW
// line. OneDrive resolves sync conflicts by creating a full conflict-copy file
// ("2026-07-29-5173-DESKTOP.jsonl") next to the original; without this, every
// event in such a copy replays twice and every count in the index doubles. Two
// byte-identical lines are always the same event (ts has millisecond
// precision), so dropping the second copy is safe.
const events = [];
const problems = [];
const seenLines = new Set();
let duplicateLines = 0;
for (const file of eventFiles(root)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const hash = createHash('sha1').update(line).digest('hex');
    if (seenLines.has(hash)) { duplicateLines++; return; }
    seenLines.add(hash);
    try { events.push(JSON.parse(line)); }
    catch { problems.push(`${file}:${i + 1}`); }
  });
}
events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));

let counts = { session: 0, turn: 0, message: 0, run: 0, comment: 0, version: 0, unknown: 0 };
for (const e of events) {
  try {
    switch (e.type) {
      case 'version': addVersion(e); counts.version++; break;
      case 'session': upsertSession(e); counts.session++; break;
      case 'turn':    addTurn(e);      counts.turn++;    break;
      case 'message': addMessage(e);   counts.message++; break;
      case 'run':     addRun(e);       counts.run++;     break;
      case 'comment': addComment(e);   counts.comment++; break;
      default: counts.unknown++;       // forward compatible: keep, don't crash
    }
  } catch (err) {
    console.warn(`  ! ${e.type} at ${e.ts}: ${err.message}`);
  }
}

console.log(`Replayed ${events.length} events:`);
for (const [k, v] of Object.entries(counts)) if (v) console.log(`  ${k.padEnd(8)} ${v}`);
if (duplicateLines) {
  console.log(`\n${duplicateLines} duplicate line(s) skipped (sync conflict copies replay the same events twice).`);
}
if (problems.length) {
  console.log(`\n${problems.length} unreadable line(s) skipped (usually a write cut short by a kill):`);
  problems.slice(0, 5).forEach(p => console.log(`  ${p}`));
}

const s = stats();
console.log(`\nIndex rebuilt: ${dbFile()}`);
console.log(`  sessions ${s.sessions} · turns ${s.turns} · messages ${s.messages} · runs ${s.runs} · comments ${s.comments}`);
