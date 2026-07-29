// Attach a note to the most recent session. Stored, never sent to a model.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, addComment, latestSessionId, VERDICTS } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
openDb(root);
const args = process.argv.slice(2);
// --verdict OK|WEAK|FAIL grades the session as well as recording the text.
const vi = args.indexOf('--verdict');
let verdict = null;
if (vi !== -1) { verdict = String(args[vi + 1] ?? '').toUpperCase(); args.splice(vi, 2); }
if (verdict && !VERDICTS.includes(verdict)) {
  console.error(`Verdict must be one of ${VERDICTS.join(', ')} — got "${verdict}".`);
  process.exit(1);
}
const body = args.join(' ').trim();
if (!body) { console.error('Nothing to write.'); process.exit(1); }

const sid = latestSessionId();
addComment({ sessionId: sid, body, tag: verdict ?? 'note' });
console.log(sid ? `Noted against ${sid}` : 'Noted (no session yet — kept unattached).');
console.log(`  "${body}"${verdict ? `   verdict: ${verdict}` : ''}`);
