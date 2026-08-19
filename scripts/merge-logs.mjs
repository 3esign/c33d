// Merge per-port intelligence logs back into intelligence_log.json.
//
// Each dev server past the first writes intelligence_log.<port>.json so that
// parallel servers never overwrite each other. This folds them back together,
// de-duplicating on a hash of the FULL entry and sorting by time. (The old
// timestamp|model|request key silently dropped parallel runs of the same
// prompt landing in the same second — exactly what dev-multi produces.) It
// never deletes anything: merged side-files are renamed to .merged-<stamp>.
import { readdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const mainPath = join(root, 'intelligence_log.json');
const read = (p) => { try { const v = JSON.parse(readFileSync(p, 'utf8')); return Array.isArray(v) ? v : []; } catch { return []; } };

const sides = readdirSync(root).filter(f => /^intelligence_log\.\d+\.json$/.test(f));
if (sides.length === 0) { console.log('No per-port logs to merge. Nothing to do.'); process.exit(0); }

const main = read(mainPath);
if (existsSync(mainPath)) copyFileSync(mainPath, `${mainPath}.backup-${Date.now()}`);

// Two entries are the same run only if EVERY field matches — same-second
// same-prompt runs from parallel servers differ in responseTimeMs/counts and
// must all survive the merge.
const keyOf = (r) => createHash('sha1').update(JSON.stringify(r)).digest('hex');
const seen = new Set(main.map(keyOf));
let added = 0;
for (const f of sides) {
  for (const r of read(join(root, f))) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k); main.push(r); added++;
  }
  console.log(`  merged ${f}`);
}
main.sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
writeFileSync(mainPath, JSON.stringify(main, null, 2));
for (const f of sides) renameSync(join(root, f), join(root, `${f}.merged-${Date.now()}`));
console.log(`\nintelligence_log.json now has ${main.length} records (+${added} merged from ${sides.length} port log(s)).`);
console.log('A timestamped backup of the previous file was kept. Side files renamed to .merged-*');
