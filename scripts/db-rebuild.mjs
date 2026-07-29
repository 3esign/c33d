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

import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readAllEvents } from './lib/events.mjs';
import { openDb, upsertSession, addTurn, addMessage, addRun, addComment, addVersion, stats, dbFile } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

for (const suffix of ['', '-wal', '-shm']) {
  const f = join(root, 'data', `c33d.db${suffix}`);
  if (existsSync(f)) rmSync(f);
}
console.log('Index cleared. Replaying the event log...\n');

openDb(root);
const { events, problems } = readAllEvents(root);

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
if (problems.length) {
  console.log(`\n${problems.length} unreadable line(s) skipped (usually a write cut short by a kill):`);
  problems.slice(0, 5).forEach(p => console.log(`  ${p}`));
}

const s = stats();
console.log(`\nIndex rebuilt: ${dbFile()}`);
console.log(`  sessions ${s.sessions} · turns ${s.turns} · messages ${s.messages} · runs ${s.runs} · comments ${s.comments}`);
