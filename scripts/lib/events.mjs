// ---------------------------------------------------------------------------
// THE EVENT LOG — append-only, plain text, the source of truth.
//
// Every interaction is appended here as one JSON object per line, and lines are
// never rewritten. The database in data/c33d.db is a DERIVED INDEX built from
// these files: delete it, run `node scripts/db-rebuild.mjs`, and it comes back
// exactly. Nothing is locked inside a binary format.
//
// WHY ONE FILE PER SERVER PER DAY
// Append-only is only crash-safe if a single append cannot be torn in half. A
// short line written with one appendFileSync is effectively atomic; a 40 KB
// line carrying a full graph snapshot, written concurrently by five dev
// servers, is not — two appends can interleave and corrupt both. Giving each
// server its own file removes the contention entirely rather than relying on
// how the OS happens to buffer writes. Concatenating them for analysis is a
// glob and a sort.
//
//   data/events/2026-07-29-5173.jsonl
//   data/events/2026-07-29-5174.jsonl
//
// Each line: {"ts":"...","type":"turn|message|run|comment|session","...":...}
// Unknown event types are preserved and ignored by the indexer, so the log can
// grow new kinds of records without any migration.
// ---------------------------------------------------------------------------

import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function eventsDir(root = process.cwd()) {
  const dir = join(root, 'data', 'events');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

function fileFor(root, port, when) {
  const day = when.slice(0, 10);
  return join(eventsDir(root), `${day}-${port ?? 'cli'}.jsonl`);
}

/**
 * Append one event. Returns the event as written (with ts filled in).
 * Never throws: losing a record is bad, but breaking the app to report it is
 * worse — the caller is on the app's critical path.
 */
export function appendEvent(root, port, event) {
  const ts = event.ts ?? new Date().toISOString();
  const line = JSON.stringify({ ts, port: port ?? null, ...event });
  try {
    appendFileSync(fileFor(root, port, ts), line + '\n', 'utf8');
  } catch (err) {
    console.warn(`[events] could not append: ${err?.message}`);
  }
  return { ts, port: port ?? null, ...event };
}

/** Every event file, oldest first. */
export function eventFiles(root = process.cwd()) {
  const dir = eventsDir(root);
  return readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort()
    .map(f => join(dir, f));
}

/**
 * Read every event, in timestamp order across all servers.
 * A truncated final line (killed mid-append) is reported and skipped rather
 * than aborting the read — one bad line must not cost you the history.
 */
export function readAllEvents(root = process.cwd()) {
  const events = [];
  const problems = [];
  for (const file of eventFiles(root)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      try { events.push(JSON.parse(line)); }
      catch { problems.push(`${file}:${i + 1}`); }
    });
  }
  events.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  return { events, problems };
}
