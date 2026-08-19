// ---------------------------------------------------------------------------
// Ask the store questions.
//
//   node scripts/db-query.mjs                  → overview
//   node scripts/db-query.mjs models           → per-model outcomes
//   node scripts/db-query.mjs errors           → what the compiler said, ranked
//   node scripts/db-query.mjs regressions      → sessions that ended worse than they peaked
//   node scripts/db-query.mjs compare v1 v2 → two versions side by side
//   node scripts/db-query.mjs sessions [n]     → the n most recent
//   node scripts/db-query.mjs sql "SELECT ..." → anything else
//
// The point of the store is that the last form exists: questions you have not
// thought of yet do not require a new script.
// ---------------------------------------------------------------------------

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, stats, dbFile } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const db = openDb(root);
// This script only ever answers questions, and db.bat advertises it as
// read-only — make that true at the engine level. query_only applies to the
// whole connection (stats() shares it), so a pasted DELETE/UPDATE in the
// "Run your own SQL" menu errors instead of silently destroying the index.
db.exec('PRAGMA query_only = ON');
const [cmd = 'overview', ...rest] = process.argv.slice(2);

const table = (rows) => (rows.length ? console.table(rows) : console.log('  (no rows)'));

switch (cmd) {
  case 'overview': {
    const s = stats();
    console.log(`\nStore: ${dbFile()}`);
    console.log(`  sessions ${s.sessions} · turns ${s.turns} · messages ${s.messages} · runs ${s.runs} · your comments ${s.comments}\n`);
    console.log('Versions:');
    table(s.versions);
    console.log('\nOutcomes by model:');
    table(s.byModel);
    console.log('\nYour verdicts:');
    table(db.prepare(`SELECT version_tag, verdict, COUNT(*) n FROM sessions
                      WHERE verdict IS NOT NULL GROUP BY version_tag, verdict
                      ORDER BY version_tag, n DESC`).all());
    console.log('\nTry:  node scripts/db-query.mjs errors   |   regressions   |   compare v1 v2\n');
    break;
  }

  case 'models':
    table(db.prepare(`
      SELECT model,
             COUNT(*) sessions,
             SUM(CASE WHEN verdict='OK'   THEN 1 ELSE 0 END) ok,
             SUM(CASE WHEN verdict='WEAK' THEN 1 ELSE 0 END) weak,
             SUM(CASE WHEN verdict='FAIL' THEN 1 ELSE 0 END) fail,
             SUM(CASE WHEN final_nodes=0  THEN 1 ELSE 0 END) blackouts,
             ROUND(AVG(final_nodes),1)    avg_nodes,
             ROUND(AVG(final_isolated),1) avg_isolated,
             ROUND(AVG(turn_count),1)     avg_turns
      FROM sessions WHERE model IS NOT NULL GROUP BY model ORDER BY sessions DESC`).all());
    break;

  case 'errors': {
    // Normalise quoted names and numbers so the same defect groups together.
    const rows = db.prepare(`
      SELECT content FROM messages
      WHERE role='system' AND (content LIKE '%compile failed%' OR content LIKE '%not valid JSON%'
        OR content LIKE '%Engine fault%' OR content LIKE '%INPUT SOCKET%' OR content LIKE '%matched NO%')`).all();
    const sig = new Map();
    for (const r of rows) {
      const k = String(r.content).split('\n')[0]
        .replace(/"[^"]{0,50}"/g, '"X"').replace(/\d+/g, 'N').slice(0, 95);
      sig.set(k, (sig.get(k) ?? 0) + 1);
    }
    table([...sig.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25)
      .map(([signature, count]) => ({ count, signature })));
    break;
  }

  case 'regressions': {
    // Sessions whose best turn beat their last turn: work that was built and
    // then destroyed. Progress proxy = (wired nodes, edges).
    const out = [];
    for (const s of db.prepare(`SELECT id, model, verdict, comment FROM sessions WHERE turn_count >= 3`).all()) {
      const ts = db.prepare(`SELECT node_count n, edge_count e, isolated_count i FROM turns
                             WHERE session_id=? AND trigger != 'export' ORDER BY id`).all(s.id);
      if (ts.length < 3) continue;
      const score = (t) => (t.n - t.i) * 100000 + t.e;
      const best = Math.max(...ts.map(score));
      const final = score(ts[ts.length - 1]);
      if (best > final) {
        const bi = ts.findIndex(t => score(t) === best);
        out.push({
          session: s.id.replace('import:c33d-graph-', ''),
          model: String(s.model ?? '').replace(':cloud', ''),
          peak: `t${bi + 1}: ${ts[bi].n}n/${ts[bi].e}e`,
          final: `${ts[ts.length - 1].n}n/${ts[ts.length - 1].e}e`,
          lost_nodes: (ts[bi].n - ts[bi].i) - (ts[ts.length - 1].n - ts[ts.length - 1].i),
          verdict: s.verdict,
        });
      }
    }
    console.log(`${out.length} sessions ended worse than they peaked:\n`);
    table(out.sort((a, b) => b.lost_nodes - a.lost_nodes));
    break;
  }

  case 'compare': {
    const [a, b] = rest;
    if (!a || !b) { console.log('usage: compare <tagA> <tagB>'); break; }
    table(db.prepare(`
      SELECT version_tag,
             COUNT(*) sessions,
             SUM(CASE WHEN final_nodes=0 THEN 1 ELSE 0 END) blackouts,
             ROUND(100.0*SUM(CASE WHEN final_nodes=0 THEN 1 ELSE 0 END)/COUNT(*),1) blackout_pct,
             SUM(CASE WHEN verdict='OK' THEN 1 ELSE 0 END) ok,
             ROUND(100.0*SUM(CASE WHEN verdict='OK' THEN 1 ELSE 0 END)/
                   NULLIF(SUM(CASE WHEN verdict IS NOT NULL THEN 1 ELSE 0 END),0),1) ok_pct,
             ROUND(AVG(final_nodes),1) avg_nodes,
             ROUND(AVG(final_isolated),1) avg_isolated,
             ROUND(AVG(turn_count),1) avg_turns
      FROM sessions WHERE version_tag IN (?,?) GROUP BY version_tag`).all(a, b));
    break;
  }

  case 'sessions':
    table(db.prepare(`
      SELECT substr(id,1,34) id, model, turn_count turns, final_nodes n, final_edges e,
             final_isolated iso, verdict, substr(IFNULL(comment,''),1,40) comment
      FROM sessions ORDER BY updated_at DESC LIMIT ?`).all(Number(rest[0] ?? 20)));
    break;

  case 'comments':
    table(db.prepare(`SELECT c.created_at, substr(c.session_id,1,30) session, c.tag,
                             substr(c.body,1,70) note
                      FROM comments c ORDER BY c.id DESC LIMIT ?`).all(Number(rest[0] ?? 30)));
    break;

  case 'sql':
    try { table(db.prepare(rest.join(' ')).all()); }
    catch (e) { console.error('SQL error:', e.message); process.exitCode = 1; }
    break;

  default:
    console.log('Unknown command. Try: overview | models | errors | regressions | compare A B | sessions | comments | sql "..."');
    process.exitCode = 1;
}
