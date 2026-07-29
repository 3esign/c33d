// Contract test for the APPEND-ONLY EVENT LOG (scripts/lib/events.mjs).
//
// The log is the source of truth; data/c33d.db is a disposable index rebuilt
// from it. That only holds if the log itself is trustworthy, which means:
//   - a line, once written, is never rewritten
//   - parallel servers cannot corrupt each other's writes
//   - one torn line (a process killed mid-append) costs one line, not the file
//   - unknown event types survive, so the format can grow without migration

import assert from 'assert';
import { mkdtempSync, rmSync, readFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendEvent, readAllEvents, eventFiles, eventsDir } from '../scripts/lib/events.mjs';

const root = mkdtempSync(join(tmpdir(), 'c33d-events-'));
let checks = 0;
const ok = (label, cond, extra) => { assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); checks++; };

// ---- append and read back ---------------------------------------------------
appendEvent(root, 5173, { type: 'session', sessionId: 'a', model: 'qwen3.5:cloud' });
appendEvent(root, 5173, { type: 'turn', sessionId: 'a', nodeCount: 12 });
const first = readAllEvents(root);
ok('events read back', first.events.length === 2);
ok('timestamps are filled in', !!first.events[0].ts);
ok('the port travels with the event', first.events[0].port === 5173);
ok('payload survives intact', first.events[1].nodeCount === 12);

// ---- append-only: earlier lines are never touched ---------------------------
const file = eventFiles(root)[0];
const snapshot = readFileSync(file, 'utf8');
appendEvent(root, 5173, { type: 'message', sessionId: 'a', role: 'system', content: 'compile error' });
ok('a new write only adds — the existing bytes are unchanged',
  readFileSync(file, 'utf8').startsWith(snapshot));

// ---- parallel servers write to separate files -------------------------------
appendEvent(root, 5174, { type: 'turn', sessionId: 'b', nodeCount: 40 });
appendEvent(root, 5175, { type: 'turn', sessionId: 'c', nodeCount: 7 });
ok('each server owns a file, so appends cannot interleave', eventFiles(root).length === 3);
const all = readAllEvents(root);
ok('reading merges every server', all.events.length === 5);
ok('the merge is in time order',
  all.events.every((e, i) => i === 0 || String(all.events[i - 1].ts) <= String(e.ts)));

// A large payload is exactly the case where interleaved appends would corrupt
// a shared file — per-server files make the size irrelevant.
const big = { type: 'turn', sessionId: 'd', nodes: Array.from({ length: 2000 }, (_, i) => ({ id: `n${i}` })) };
appendEvent(root, 5176, big);
const withBig = readAllEvents(root);
ok('a 2000-node snapshot round-trips as one line',
  withBig.events.find(e => e.sessionId === 'd')?.nodes.length === 2000);
ok('the big write did not disturb the other files', withBig.events.length === 6);

// ---- a torn line costs one line, not the history ---------------------------
appendFileSync(join(eventsDir(root), '2099-01-01-9999.jsonl'), '{"ts":"2099-01-01T00:00:00Z","type":"turn"\n', 'utf8');
const torn = readAllEvents(root);
ok('the truncated line is reported', torn.problems.length === 1, JSON.stringify(torn.problems));
ok('every other event still reads', torn.events.length === 6);

// ---- forward compatibility --------------------------------------------------
appendEvent(root, 5173, { type: 'something-invented-later', payload: { x: 1 } });
const later = readAllEvents(root);
ok('an unknown event type is preserved verbatim',
  later.events.some(e => e.type === 'something-invented-later' && e.payload.x === 1));

// ---- failure to log must never throw into the caller ------------------------
const res = appendEvent('/definitely/not/a/writable/path', 1, { type: 'turn' });
ok('an unwritable location does not throw', res && res.type === 'turn');

rmSync(root, { recursive: true, force: true });
console.log(`test_event_log: all ${checks} contracts PASS`);
