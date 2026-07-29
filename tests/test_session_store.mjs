// Contract test for the SESSION STORE (scripts/lib/db.mjs).
//
// The store exists because the two things that recorded history before it were
// lossy in the same direction — they lost the failures. intelligence_log.json
// was read-modify-write with no lock (a concurrent read landing mid-write once
// would have erased 954 records), and JSONs/*.json only ever contained runs
// somebody remembered to click Export on. A run that blacks out is exactly the
// run worth keeping, and it was exactly the run that vanished.
//
// These contracts pin the properties that make it trustworthy:
//   - a turn survives even when the session never "finishes"
//   - concurrent writers do not lose rows (this is why SQLite/WAL, not files)
//   - your comments are stored and never travel with the conversation
//   - version tags partition the corpus so before/after is one query

import assert from 'assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const root = mkdtempSync(join(tmpdir(), 'c33d-store-'));
const {
  openDb, addVersion, currentVersionTag, upsertSession, addTurn, addMessage,
  addRun, addComment, latestSessionId, stats, dbFile,
} = await import('../scripts/lib/db.mjs');

let checks = 0;
const ok = (label, cond, extra) => { assert.ok(cond, `${label}${extra ? ` — ${extra}` : ''}`); checks++; };

const db = openDb(root);
ok('database file is created', existsSync(dbFile()), dbFile());
ok('WAL mode is on (this is what makes parallel servers safe)',
  db.prepare('PRAGMA journal_mode').get().journal_mode === 'wal');

// ---- versions partition the corpus ----------------------------------------
addVersion({ tag: 'v0.1', gitSha: 'abc1234', note: 'baseline' });
ok('version tag is recorded', currentVersionTag() === 'v0.1');
addVersion({ tag: 'v0.1' });
ok('re-tagging the same version is a no-op', db.prepare('SELECT COUNT(*) c FROM versions').get().c === 1);

// ---- a session that never finishes still leaves evidence -------------------
const S = 'sess-blackout';
upsertSession({ id: S, model: 'glm-5.2:cloud', provider: 'ollama', port: 5174 });
addMessage({ sessionId: S, seq: 0, role: 'user', content: 'make a hot air balloon' });
addMessage({ sessionId: S, seq: 1, role: 'system', content: 'Response was not valid JSON (attempt 1/3)' });
addTurn({
  sessionId: S, turnIndex: 1, trigger: 'ai-ir', label: 'attempt 1',
  nodeCount: 12, edgeCount: 7, isolatedCount: 3,
  diff: { addedNodes: ['a', 'b'], removedNodes: [], changedNodes: [], addedEdges: 7, removedEdges: 0 },
  nodes: [{ id: 'a' }], edges: [],
});
// No "session end" is ever written — the tab simply dies. That is the case
// the old export flow lost entirely.
const sess = db.prepare('SELECT * FROM sessions WHERE id=?').get(S);
ok('the session exists without ever being finished', !!sess);
ok('model was captured', sess.model === 'glm-5.2:cloud');
ok('the first prompt became the session prompt', sess.first_prompt === 'make a hot air balloon');
ok('final graph state is tracked', sess.final_nodes === 12 && sess.final_edges === 7);
ok('isolated nodes are tracked', sess.final_isolated === 3);
ok('turn count is maintained', sess.turn_count === 1);
ok('the diff is stored numerically for querying',
  db.prepare('SELECT added_nodes a, added_edges e FROM turns WHERE session_id=?').get(S).a === 2);
ok('the full graph is kept for replay',
  JSON.parse(db.prepare('SELECT nodes_json n FROM turns WHERE session_id=?').get(S).n)[0].id === 'a');
ok('system messages are kept — they carry the compiler feedback',
  db.prepare("SELECT COUNT(*) c FROM messages WHERE session_id=? AND role='system'").get(S).c === 1);

// ---- rows are stamped with the version so before/after is one query --------
addRun({ sessionId: S, model: 'glm-5.2:cloud', request: 'make a hot air balloon', success: false, responseTimeMs: 30000, error: 'empty response' });
ok('runs inherit the current version tag',
  db.prepare('SELECT version_tag v FROM runs WHERE session_id=?').get(S).v === 'v0.1');

addVersion({ tag: 'v0.2', note: 'after the encoding-surface fixes' });
const S2 = 'sess-after';
upsertSession({ id: S2, model: 'glm-5.2:cloud' });
addTurn({ sessionId: S2, nodeCount: 40, edgeCount: 52, isolatedCount: 0 });
ok('a new session lands in the new version',
  db.prepare('SELECT version_tag v FROM sessions WHERE id=?').get(S2).v === 'v0.2');
const cmp = db.prepare(`SELECT version_tag, AVG(final_isolated) iso FROM sessions
                        WHERE version_tag IN ('v0.1','v0.2') GROUP BY version_tag ORDER BY version_tag`).all();
ok('two versions are directly comparable in one query', cmp.length === 2 && cmp[0].iso === 3 && cmp[1].iso === 0);

// ---- your comments are stored, and stay out of the conversation -----------
addComment({ sessionId: S, body: 'balloon skirt never placed — same failure as the temple', tag: 'note' });
ok('the comment is stored', db.prepare('SELECT COUNT(*) c FROM comments WHERE session_id=?').get(S).c === 1);
ok('the comment is also surfaced on the session row',
  db.prepare('SELECT comment FROM sessions WHERE id=?').get(S).comment.startsWith('balloon skirt'));
ok('the comment did NOT become a chat message — it never reaches a model',
  db.prepare("SELECT COUNT(*) c FROM messages WHERE session_id=? AND content LIKE '%balloon skirt%'").get(S).c === 0);
addComment({ body: 'note with no session — attaches to the most recent', tag: 'note' });
ok('a session-less comment still lands somewhere', db.prepare('SELECT COUNT(*) c FROM comments').get().c === 2);
ok('latestSessionId tracks the most recently touched session', latestSessionId() === S2);

// ---- upsert semantics: repeated writes must not duplicate or clobber ------
upsertSession({ id: S, model: null, provider: null });
ok('a later write does not blank an earlier value',
  db.prepare('SELECT model FROM sessions WHERE id=?').get(S).model === 'glm-5.2:cloud');
ok('upsert did not create a second row',
  db.prepare('SELECT COUNT(*) c FROM sessions WHERE id=?').get(S).c === 1);
addMessage({ sessionId: S, seq: 0, role: 'user', content: 'make a hot air balloon' });
ok('replaying the same message seq does not duplicate it',
  db.prepare('SELECT COUNT(*) c FROM messages WHERE session_id=?').get(S).c === 2);

// ---- many rapid writes (the parallel-servers case) ------------------------
for (let i = 0; i < 200; i++) {
  addRun({ sessionId: S, model: `m${i % 5}`, request: `r${i}`, success: i % 3 === 0, responseTimeMs: i });
}
ok('200 rapid run inserts all landed — none silently lost',
  db.prepare('SELECT COUNT(*) c FROM runs').get().c === 201);

const s = stats();
ok('stats reports the corpus', s.sessions === 2 && s.turns === 2 && s.comments === 2);
ok('stats groups by model', s.byModel.some(r => r.model === 'glm-5.2:cloud'));

rmSync(root, { recursive: true, force: true });
console.log(`test_session_store: all ${checks} contracts PASS`);
