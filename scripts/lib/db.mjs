// ---------------------------------------------------------------------------
// C33D SESSION STORE — every interaction, automatically, in one SQLite file.
//
// WHY
// Until now the record of what the models actually did lived in two places:
// intelligence_log.json (one row per run, overwritten wholesale) and whatever
// you remembered to click Export on (JSONs/*.json). Both are lossy in the same
// direction — they lose the failures. A run that blacks out never gets
// exported, and the runs that matter most for improving the system are exactly
// the ones nobody saves.
//
// This stores everything as it happens: every turn, every message, every run,
// with the graph state at each step. Nothing to click.
//
// WHY SQLITE, AND WHY IT NEEDS NO MERGE STEP
// `node:sqlite` ships inside Node 22 — no npm install, no native build, no
// Windows toolchain. In WAL mode several processes can write concurrently and
// SQLite serialises them properly. So five dev servers on five ports all write
// to ONE database and the "merge" problem disappears: there is nothing to
// merge, because there was never more than one file.
//
// (Contrast the old /api/log: read-modify-write with no lock. Two servers
// finishing together silently lost a row, and a read landing mid-write could
// wipe the whole history.)
// ---------------------------------------------------------------------------

import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SCHEMA_VERSION = 1;

let db = null;
let dbPath = null;

/** Open (and if needed create) the store. Safe to call repeatedly. */
export function openDb(root = process.cwd()) {
  if (db) return db;
  dbPath = join(root, 'data', 'c33d.db');
  if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);

  // WAL is what makes concurrent servers safe. busy_timeout means a writer
  // waits its turn instead of throwing SQLITE_BUSY under contention.
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    -- A named point in the project's history. Everything captured after a tag
    -- is comparable against everything captured before it.
    CREATE TABLE IF NOT EXISTS versions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      tag        TEXT UNIQUE NOT NULL,
      git_sha    TEXT,
      note       TEXT,
      created_at TEXT NOT NULL
    );

    -- One row per app instance working on one design.
    CREATE TABLE IF NOT EXISTS sessions (
      id             TEXT PRIMARY KEY,
      started_at     TEXT NOT NULL,
      updated_at     TEXT,
      port           INTEGER,
      model          TEXT,
      provider       TEXT,
      version_tag    TEXT,
      first_prompt   TEXT,
      final_nodes    INTEGER DEFAULT 0,
      final_edges    INTEGER DEFAULT 0,
      final_isolated INTEGER DEFAULT 0,
      turn_count     INTEGER DEFAULT 0,
      comment        TEXT,
      verdict        TEXT,
      source         TEXT DEFAULT 'live'   -- 'live' | 'imported'
    );

    -- One row per graph change: the timeline, permanently.
    CREATE TABLE IF NOT EXISTS turns (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      turn_index     INTEGER,
      at             TEXT NOT NULL,
      trigger        TEXT,
      label          TEXT,
      node_count     INTEGER,
      edge_count     INTEGER,
      isolated_count INTEGER,
      added_nodes    INTEGER DEFAULT 0,
      removed_nodes  INTEGER DEFAULT 0,
      changed_nodes  INTEGER DEFAULT 0,
      added_edges    INTEGER DEFAULT 0,
      removed_edges  INTEGER DEFAULT 0,
      details        TEXT,
      nodes_json     TEXT,
      edges_json     TEXT
    );

    -- The conversation, including every system message. This is where the
    -- error taxonomy lives — it is the most analytically valuable table.
    CREATE TABLE IF NOT EXISTS messages (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      role       TEXT,
      content    TEXT,
      at         TEXT,
      PRIMARY KEY (session_id, seq)
    );

    -- One row per model call — the successor to intelligence_log.json.
    CREATE TABLE IF NOT EXISTS runs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id  TEXT REFERENCES sessions(id) ON DELETE SET NULL,
      at          TEXT NOT NULL,
      port        INTEGER,
      model       TEXT,
      request     TEXT,
      success     INTEGER,
      response_ms INTEGER,
      node_count  INTEGER,
      edge_count  INTEGER,
      error       TEXT,
      version_tag TEXT
    );

    -- Your notes. Never shown to a model, never part of the conversation.
    CREATE TABLE IF NOT EXISTS comments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
      turn_id    INTEGER,
      body       TEXT NOT NULL,
      tag        TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turns_session   ON turns(session_id);
    CREATE INDEX IF NOT EXISTS idx_msgs_session    ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_runs_at         ON runs(at);
    CREATE INDEX IF NOT EXISTS idx_runs_model      ON runs(model);
    CREATE INDEX IF NOT EXISTS idx_sessions_model  ON sessions(model);
    CREATE INDEX IF NOT EXISTS idx_sessions_ver    ON sessions(version_tag);
  `);

  db.prepare('INSERT OR IGNORE INTO meta(key, value) VALUES(?, ?)')
    .run('schema_version', String(SCHEMA_VERSION));
  return db;
}

export function dbFile() { return dbPath; }

/** The tag new records are stamped with — the most recent version row. */
export function currentVersionTag() {
  const d = openDb();
  const row = d.prepare('SELECT tag FROM versions ORDER BY id DESC LIMIT 1').get();
  return row?.tag ?? null;
}

export function addVersion({ tag, gitSha = null, note = null }) {
  const d = openDb();
  d.prepare('INSERT OR IGNORE INTO versions(tag, git_sha, note, created_at) VALUES(?,?,?,?)')
    .run(tag, gitSha, note, new Date().toISOString());
  return currentVersionTag();
}

/** Create the session row on first sight; afterwards only fill in blanks. */
export function upsertSession(s) {
  const d = openDb();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT INTO sessions (id, started_at, updated_at, port, model, provider, version_tag, first_prompt, source)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      updated_at   = excluded.updated_at,
      model        = COALESCE(excluded.model, sessions.model),
      provider     = COALESCE(excluded.provider, sessions.provider),
      port         = COALESCE(excluded.port, sessions.port),
      first_prompt = COALESCE(sessions.first_prompt, excluded.first_prompt)
  `).run(
    s.id, s.startedAt ?? now, now, s.port ?? null, s.model ?? null,
    s.provider ?? null, s.versionTag ?? currentVersionTag(), s.firstPrompt ?? null,
    s.source ?? 'live',
  );
  return s.id;
}

export function addTurn(t) {
  const d = openDb();
  upsertSession({ id: t.sessionId, port: t.port, model: t.model, provider: t.provider });
  const df = t.diff ?? {};
  const info = d.prepare(`
    INSERT INTO turns (session_id, turn_index, at, trigger, label, node_count, edge_count,
      isolated_count, added_nodes, removed_nodes, changed_nodes, added_edges, removed_edges,
      details, nodes_json, edges_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    t.sessionId, t.turnIndex ?? null, t.at ?? new Date().toISOString(),
    t.trigger ?? null, (t.label ?? '').slice(0, 300),
    t.nodeCount ?? 0, t.edgeCount ?? 0, t.isolatedCount ?? 0,
    len(df.addedNodes), len(df.removedNodes), len(df.changedNodes),
    num(df.addedEdges), num(df.removedEdges),
    t.details ? JSON.stringify(t.details) : null,
    t.nodes ? JSON.stringify(t.nodes) : null,
    t.edges ? JSON.stringify(t.edges) : null,
  );
  d.prepare(`
    UPDATE sessions SET final_nodes = ?, final_edges = ?, final_isolated = ?,
      turn_count = (SELECT COUNT(*) FROM turns WHERE session_id = ?), updated_at = ?
    WHERE id = ?
  `).run(t.nodeCount ?? 0, t.edgeCount ?? 0, t.isolatedCount ?? 0,
         t.sessionId, new Date().toISOString(), t.sessionId);
  return Number(info.lastInsertRowid);
}

export function addMessage(m) {
  const d = openDb();
  upsertSession({ id: m.sessionId });
  d.prepare(`INSERT OR REPLACE INTO messages (session_id, seq, role, content, at)
             VALUES (?,?,?,?,?)`)
    .run(m.sessionId, m.seq, m.role ?? null, m.content ?? '', m.at ?? new Date().toISOString());
  // The first user message is the prompt that defines the session.
  if (m.role === 'user') {
    d.prepare(`UPDATE sessions SET first_prompt = COALESCE(first_prompt, ?) WHERE id = ?`)
      .run(String(m.content ?? '').slice(0, 500), m.sessionId);
  }
}

export function addRun(r) {
  const d = openDb();
  if (r.sessionId) upsertSession({ id: r.sessionId, model: r.model, port: r.port });
  d.prepare(`
    INSERT INTO runs (session_id, at, port, model, request, success, response_ms,
                      node_count, edge_count, error, version_tag)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    r.sessionId ?? null, r.at ?? new Date().toISOString(), r.port ?? null,
    r.model ?? null, r.request ?? null, r.success ? 1 : 0, r.responseTimeMs ?? null,
    r.nodeCount ?? null, r.edgeCount ?? null, r.error ?? null,
    r.versionTag ?? currentVersionTag(),
  );
}

/** A note attached to a session. Stored, never sent anywhere. */
export function addComment({ sessionId = null, turnId = null, body, tag = null }) {
  const d = openDb();
  d.prepare('INSERT INTO comments (session_id, turn_id, body, tag, created_at) VALUES (?,?,?,?,?)')
    .run(sessionId, turnId, String(body), tag, new Date().toISOString());
  if (sessionId) {
    d.prepare('UPDATE sessions SET comment = ? WHERE id = ?').run(String(body), sessionId);
  }
}

export function latestSessionId() {
  const d = openDb();
  // updated_at is an ISO string with millisecond resolution, so two sessions
  // touched in the same millisecond tie — which made "attach my note to the
  // most recent session" non-deterministic under parallel servers, exactly the
  // case this is for. rowid breaks the tie by insertion order.
  return d.prepare(`SELECT id FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT 1`)
    .get()?.id ?? null;
}

export function stats() {
  const d = openDb();
  const one = (sql, ...a) => d.prepare(sql).get(...a);
  return {
    dbPath,
    versions: d.prepare('SELECT tag, created_at, note FROM versions ORDER BY id DESC LIMIT 5').all(),
    sessions: one('SELECT COUNT(*) c FROM sessions').c,
    turns: one('SELECT COUNT(*) c FROM turns').c,
    messages: one('SELECT COUNT(*) c FROM messages').c,
    runs: one('SELECT COUNT(*) c FROM runs').c,
    comments: one('SELECT COUNT(*) c FROM comments').c,
    byModel: d.prepare(`
      SELECT model,
             COUNT(*)                                   AS sessions,
             SUM(CASE WHEN final_nodes = 0 THEN 1 ELSE 0 END) AS blackouts,
             ROUND(AVG(final_nodes), 1)                 AS avg_nodes,
             ROUND(AVG(final_isolated), 1)              AS avg_isolated
      FROM sessions WHERE model IS NOT NULL
      GROUP BY model ORDER BY sessions DESC
    `).all(),
  };
}

const len = (v) => (Array.isArray(v) ? v.length : 0);
const num = (v) => (typeof v === 'number' ? v : len(v));
