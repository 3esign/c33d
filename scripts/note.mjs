// Attach a note to the most recent session. Stored, never sent to a model.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, addComment, latestSessionId } from './lib/db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
openDb(root);
const body = process.argv.slice(2).join(' ').trim();
if (!body) { console.error('Nothing to write.'); process.exit(1); }

const sid = latestSessionId();
addComment({ sessionId: sid, body, tag: 'note' });
console.log(sid ? `Noted against ${sid}` : 'Noted (no session yet — kept unattached).');
console.log(`  "${body}"`);
