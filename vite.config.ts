import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'

// ---------------------------------------------------------------------------
// Local-API protection shared by both dev middlewares.
//
// The dev server doubles as the app's de-facto backend, so any page open in
// the same browser could otherwise POST to it. A browser always attaches an
// Origin header to cross-origin requests; same-origin fetches and local tools
// (curl, the scripts/ CLIs) send none. Policy: no Origin → allow; an Origin
// whose host is not this machine's loopback → refuse to mutate anything.
// ---------------------------------------------------------------------------
const originAllowed = (req: any): boolean => {
  const origin = req.headers?.origin as string | undefined
  if (!origin) return true
  try {
    const host = new URL(origin).hostname
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

const forbid = (res: any, message: string) => {
  res.statusCode = 403
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

// The Ollama proxy forwards wherever x-ollama-target points, which would make
// it an open relay (blind SSRF) for any page that can reach this server.
// Only plain-http loopback and RFC1918 targets are allowed; 169.254.* is
// rejected explicitly — that range is link-local and, on cloud machines, the
// metadata service that hands out credentials. Returns the normalized target
// prefix (localhost mapped to 127.0.0.1, trailing slash stripped) or null.
const resolveOllamaTarget = (raw: string): string | null => {
  let u: URL
  try { u = new URL(raw) } catch { return null }
  if (u.protocol !== 'http:') return null
  const host = u.hostname
  if (/^169\.254\./.test(host)) return null // link-local / cloud metadata — never
  const isLocal =
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(host) ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(host)
  if (!isLocal) return null
  const mapped = host === 'localhost' ? '127.0.0.1' : host
  return `http://${mapped}${u.port ? `:${u.port}` : ''}${u.pathname.replace(/\/$/, '')}`
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // ---------------------------------------------------------------------
      // SESSION STORE (Jul 29): every turn, message and run is written to
      // data/c33d.db as it happens — no Export click, and failures are kept
      // rather than lost. SQLite in WAL mode serialises concurrent writers, so
      // several dev servers on several ports share ONE database and there is
      // no merge step at all.
      //
      // All of it is fire-and-forget from the client: a store that is slow or
      // missing must never slow down or break the app.
      // ---------------------------------------------------------------------
      name: 'c33d-session-store',
      configureServer(server) {
        const port = server.config.server.port ?? 5173;
        let store: any = null;
        let ev: any = null;
        const load = async () => {
          if (store) return store;
          try {
            store = await import('./scripts/lib/db.mjs');
            ev = await import('./scripts/lib/events.mjs');
            store.openDb(process.cwd());
            console.log(`[store] data/c33d.db ready (port ${port})`);
          } catch (err: any) {
            console.warn(`[store] disabled — ${err?.message}`);
            store = { disabled: true };
          }
          return store;
        };

        const readJson = (req: any) => new Promise<any>((resolve) => {
          let body = '';
          req.on('data', (c: any) => { body += c; });
          req.on('end', () => { try { resolve(JSON.parse(body || '{}')); } catch { resolve({}); } });
        });

        server.middlewares.use(async (req, res, next) => {
          const url = String(req.url || '');

          // Cross-origin mutation gate for the whole local /api surface.
          if (url.startsWith('/api/') && req.method === 'POST' && !originAllowed(req)) {
            return forbid(res, 'cross-origin requests may not modify local data');
          }

          if (url.startsWith('/api/ollama-proxy')) {
            const targetPath = url.replace(/^\/api\/ollama-proxy/, '') || '/';
            const rawTargetHost = (req.headers['x-ollama-target'] as string) || 'http://127.0.0.1:11434';
            const targetHost = resolveOllamaTarget(rawTargetHost);
            if (!targetHost) {
              return forbid(res, `x-ollama-target must be an http:// URL on localhost or a private (RFC1918) address — got "${rawTargetHost}"`);
            }
            const destUrl = `${targetHost}${targetPath}`;

            let bodyBuffers: Buffer[] = [];
            req.on('data', (chunk: Buffer) => { bodyBuffers.push(chunk); });
            req.on('end', async () => {
              try {
                const bodyBuffer = Buffer.concat(bodyBuffers);
                const fetchOpts: RequestInit = {
                  method: req.method,
                  headers: {
                    'Content-Type': (req.headers['content-type'] as string) || 'application/json',
                  },
                  body: req.method !== 'GET' && req.method !== 'HEAD' ? bodyBuffer : undefined,
                };
                const upstream = await fetch(destUrl, fetchOpts);
                res.statusCode = upstream.status;
                res.setHeader('Content-Type', upstream.headers.get('content-type') || 'application/json');
                const arrayBuf = await upstream.arrayBuffer();
                res.end(Buffer.from(arrayBuf));
              } catch (err: any) {
                res.statusCode = 502;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Ollama proxy error connecting to ${destUrl}: ${err.message}` }));
              }
            });
            return;
          }

          if (url.startsWith('/api/claude-cli-bridge') && req.method === 'POST') {
            const data = await readJson(req);
            const prompt = data.prompt || '';
            const systemPrompt = data.systemPrompt || '';

            try {
              const claudePath = path.join(process.env.USERPROFILE || '', '.local', 'bin', 'claude.exe');
              const exe = fs.existsSync(claudePath) ? claudePath : 'claude';
              // Never pass the prompt in args on Windows — it exceeds the 8191 char limit (ENAMETOOLONG).
              // Passing -p with stdin piping handles arbitrarily large system + user prompts safely!
              const args = ['-p', '--output-format', 'text'];

              const proc = spawn(exe, args, {
                shell: false,
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe'],
              });

              let stdout = '';
              let stderr = '';

              proc.stdout.on('data', (c) => { stdout += c.toString(); });
              proc.stderr.on('data', (c) => { stderr += c.toString(); });

              proc.on('close', (code) => {
                if (code === 0) {
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ text: stdout.trim() }));
                } else {
                  res.statusCode = 500;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: stderr || `Claude Code exited with code ${code}` }));
                }
              });

              proc.on('error', (err) => {
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: `Failed to spawn Claude Code CLI: ${err.message}` }));
              });

              const fullPayload = systemPrompt
                ? `SYSTEM INSTRUCTIONS:\n${systemPrompt}\n\nUSER REQUEST:\n${prompt}`
                : prompt;

              proc.stdin.write(fullPayload);
              proc.stdin.end();
            } catch (err: any) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err.message }));
            }
            return;
          }

          if (!url.startsWith('/api/store/')) return next();

          const ok = (payload: any = { ok: true }) => {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(payload));
          };

          const s = await load();
          if (s.disabled) return ok({ ok: false, disabled: true });

          try {
            // The append-only log is written FIRST and is the source of truth;
            // the index is updated second and is disposable (db-rebuild.mjs
            // reconstructs it from these lines). If indexing ever throws, the
            // record still exists on disk.
            const kinds: Record<string, (b: any) => any> = {
              '/api/store/turn':    (b) => ({ ...b, type: 'turn' }),
              '/api/store/message': (b) => ({ ...b, type: 'message' }),
              '/api/store/comment': (b) => ({ ...b, type: 'comment', sessionId: b.sessionId ?? s.latestSessionId() }),
              '/api/store/session': (b) => ({ ...b, type: 'session' }),
            };
            if (kinds[url] && req.method === 'POST') {
              const event = kinds[url](await readJson(req));
              const written = ev.appendEvent(process.cwd(), port, event);
              try {
                if (event.type === 'turn')    return ok({ ok: true, turnId: s.addTurn({ ...written, port }) });
                if (event.type === 'message') s.addMessage(written);
                if (event.type === 'comment') s.addComment(written);
                if (event.type === 'session') s.upsertSession({ ...written, port });
              } catch (indexErr: any) {
                // Logged, not fatal: the event is safe on disk and a rebuild
                // will pick it up.
                console.warn(`[store] indexing ${event.type} failed: ${indexErr?.message}`);
                return ok({ ok: true, indexed: false });
              }
              return ok();
            }
            if (url === '/api/store/stats' && req.method === 'GET') {
              return ok(s.stats());
            }
          } catch (err: any) {
            // Never surface a storage problem to the app.
            console.warn(`[store] ${url} failed: ${err?.message}`);
            return ok({ ok: false, error: err?.message });
          }
          return ok({ ok: false, error: 'unknown store endpoint' });
        });
      },
    },
    {
      name: 'intelligence-log-middleware',
      configureServer(server) {
        // PARALLEL-SAFE LOGGING (Jul 29)
        //
        // /api/log is read-modify-write with no lock. With ONE dev server that
        // is fine. With several running at once — the normal setup for testing
        // models side by side — two runs that finish together both read the
        // same array, both append, both write, and one result is silently lost.
        // Worse, a read that lands mid-write throws, and the old `catch { logs
        // = [] }` then wrote an EMPTY array back: one unlucky interleave would
        // erase the entire history (954 records as of today).
        //
        // Fix, in order of importance:
        //   1. every server past the first writes its OWN file, so parallel
        //      servers never contend at all. Merge with `npm run logs:merge`.
        //   2. an unreadable log is quarantined, never overwritten.
        //   3. writes go to a temp file and are renamed into place, so a
        //      reader never sees a half-written file.
        const serverPort = server.config.server.port ?? 5173;
        const logFileName = serverPort === 5173
          ? 'intelligence_log.json'
          : `intelligence_log.${serverPort}.json`;

        server.middlewares.use((req, res, next) => {
          // Cross-origin mutation gate (also enforced by the session-store
          // middleware ahead of this one; kept here so this plugin is safe
          // even if the plugin order changes).
          if (String(req.url || '').startsWith('/api/') && req.method === 'POST' && !originAllowed(req)) {
            return forbid(res, 'cross-origin requests may not modify local data');
          }
          if (req.url === '/api/log' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const logEntry = JSON.parse(body);
                const logPath = path.join(process.cwd(), logFileName);
                let logs: any[] = [];
                if (fs.existsSync(logPath)) {
                  try {
                    logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                    if (!Array.isArray(logs)) throw new Error('log root is not an array');
                  } catch (readErr: any) {
                    // NEVER start a fresh array over an existing file — that is
                    // how a whole history disappears. Move it aside instead.
                    const quarantine = `${logPath}.unreadable-${Date.now()}`;
                    try { fs.renameSync(logPath, quarantine); } catch { /* best effort */ }
                    console.error(
                      `[intelligence-log] ${logFileName} could not be parsed (${readErr?.message}). ` +
                      `Moved to ${path.basename(quarantine)}; starting a new file. Nothing was deleted.`,
                    );
                    logs = [];
                  }
                }
                logs.push({
                  ...logEntry,
                  timestamp: new Date().toISOString()
                });
                const tmpPath = `${logPath}.tmp-${process.pid}`;
                fs.writeFileSync(tmpPath, JSON.stringify(logs, null, 2));
                fs.renameSync(tmpPath, logPath);

                // Same record into the store, where it can actually be queried
                // alongside the turns and messages of the session it came from.
                Promise.all([import('./scripts/lib/db.mjs'), import('./scripts/lib/events.mjs')])
                  .then(([m, e]) => {
                    const rec = { ...logEntry, type: 'run', sessionId: logEntry.sessionId ?? null };
                    e.appendEvent(process.cwd(), serverPort, rec);   // source of truth
                    m.openDb(process.cwd());
                    m.addRun({ ...rec, port: serverPort });           // index
                  })
                  .catch(() => { /* store optional — never break logging */ });
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else if (req.url === '/api/guidelines' && req.method === 'GET') {
            const filepath = path.join(process.cwd(), '.agents', 'AGENTS.md');
            try {
              if (fs.existsSync(filepath)) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end(fs.readFileSync(filepath, 'utf8'));
              } else {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'text/plain; charset=utf-8');
                res.end('');
              }
            } catch (err: any) {
              res.statusCode = 500;
              res.end(err.message);
            }
          } else if (req.url === '/api/guidelines' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const filepath = path.join(process.cwd(), '.agents', 'AGENTS.md');
              const dir = path.dirname(filepath);
              try {
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                // tmp + rename, like the log above: a reader (or a crash
                // mid-write) must never see a half-written file.
                const tmpPath = `${filepath}.tmp-${process.pid}`;
                fs.writeFileSync(tmpPath, body, 'utf8');
                fs.renameSync(tmpPath, filepath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else if (req.url === '/api/dynamic-knowledge' && req.method === 'GET') {
            const filepath = path.join(process.cwd(), '.agents', 'KNOWLEDGE.json');
            try {
              if (fs.existsSync(filepath)) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(fs.readFileSync(filepath, 'utf8'));
              } else {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end('[]');
              }
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else if (req.url === '/api/dynamic-knowledge' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const filepath = path.join(process.cwd(), '.agents', 'KNOWLEDGE.json');
              const dir = path.dirname(filepath);
              try {
                if (!fs.existsSync(dir)) {
                  fs.mkdirSync(dir, { recursive: true });
                }
                const tmpPath = `${filepath}.tmp-${process.pid}`;
                fs.writeFileSync(tmpPath, body, 'utf8');
                fs.renameSync(tmpPath, filepath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else if ((req.url === '/api/examples' || req.url === '/api/macros') && req.method === 'GET') {
            // Success library / macro library (JSON array files in .agents/)
            const fname = req.url === '/api/examples' ? 'EXAMPLES.json' : 'MACROS.json';
            const filepath = path.join(process.cwd(), '.agents', fname);
            try {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : '[]');
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else if ((req.url === '/api/examples' || req.url === '/api/macros') && req.method === 'POST') {
            const fname = req.url === '/api/examples' ? 'EXAMPLES.json' : 'MACROS.json';
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const filepath = path.join(process.cwd(), '.agents', fname);
              const dir = path.dirname(filepath);
              try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const tmpPath = `${filepath}.tmp-${process.pid}`;
                fs.writeFileSync(tmpPath, body, 'utf8');
                fs.renameSync(tmpPath, filepath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else if (req.url === '/api/eval-results' && req.method === 'GET') {
            const filepath = path.join(process.cwd(), '.agents', 'EVAL_RESULTS.json');
            try {
              let raw = fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : '[]';
              try {
                JSON.parse(raw);
              } catch (readErr: any) {
                // Same rule as the intelligence log: an unreadable history is
                // quarantined, never served broken and never reset in place.
                const quarantine = `${filepath}.unreadable-${Date.now()}`;
                try { fs.renameSync(filepath, quarantine); } catch { /* best effort */ }
                console.error(
                  `[eval-results] EVAL_RESULTS.json could not be parsed (${readErr?.message}). ` +
                  `Moved to ${path.basename(quarantine)}; serving an empty list. Nothing was deleted.`,
                );
                raw = '[]';
              }
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(raw);
            } catch (err: any) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: err.message }));
            }
          } else if (req.url === '/api/eval-results' && req.method === 'POST') {
            // Appends a single result entry
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              const filepath = path.join(process.cwd(), '.agents', 'EVAL_RESULTS.json');
              const dir = path.dirname(filepath);
              try {
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                let results = [];
                if (fs.existsSync(filepath)) {
                  try {
                    results = JSON.parse(fs.readFileSync(filepath, 'utf8'));
                    if (!Array.isArray(results)) throw new Error('eval-results root is not an array');
                  } catch (readErr: any) {
                    // NEVER start a fresh array over an existing file — that is
                    // how the (gitignored, backup-less) eval history disappears.
                    // Quarantine it and start clean, exactly like /api/log.
                    const quarantine = `${filepath}.unreadable-${Date.now()}`;
                    try { fs.renameSync(filepath, quarantine); } catch { /* best effort */ }
                    console.error(
                      `[eval-results] EVAL_RESULTS.json could not be parsed (${readErr?.message}). ` +
                      `Moved to ${path.basename(quarantine)}; starting a new file. Nothing was deleted.`,
                    );
                    results = [];
                  }
                }
                results.push(JSON.parse(body));
                const tmpPath = `${filepath}.tmp-${process.pid}`;
                fs.writeFileSync(tmpPath, JSON.stringify(results, null, 2), 'utf8');
                fs.renameSync(tmpPath, filepath);
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ success: true }));
              } catch (err: any) {
                res.statusCode = 500;
                res.end(JSON.stringify({ error: err.message }));
              }
            });
          } else {
            next();
          }
        });
      }
    }
  ],
  server: {
    watch: {
      // -----------------------------------------------------------------
      // Do not restart the dev server when the app writes its own records.
      //
      // Every turn writes data/c33d.db (plus -wal/-shm), data/events/*.jsonl,
      // intelligence_log*.json and .agents/*. All of those live inside the
      // project root, so without this list the watcher sees each write,
      // reloads the page mid-prompt, and the prompt is lost. With several
      // instances sharing one database, ONE window's write reloaded ALL of
      // them. These paths are data, never source: nothing here needs HMR.
      // -----------------------------------------------------------------
      ignored: [
        '**/data/**',
        '**/intelligence_log*.json',
        '**/.agents/**',
        '**/results/**',
        '**/Screenshots/**',
        '**/JSONs/**',
        '**/archive/**',
        '**/scratch/**',
        '**/dist/**',
      ],
    },
  },
})
