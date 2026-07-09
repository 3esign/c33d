import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'intelligence-log-middleware',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url === '/api/log' && req.method === 'POST') {
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', () => {
              try {
                const logEntry = JSON.parse(body);
                const logPath = path.join(process.cwd(), 'intelligence_log.json');
                let logs = [];
                if (fs.existsSync(logPath)) {
                  try {
                    logs = JSON.parse(fs.readFileSync(logPath, 'utf8'));
                  } catch (e) {
                    logs = [];
                  }
                }
                logs.push({
                  ...logEntry,
                  timestamp: new Date().toISOString()
                });
                fs.writeFileSync(logPath, JSON.stringify(logs, null, 2));
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
                fs.writeFileSync(filepath, body, 'utf8');
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
                fs.writeFileSync(filepath, body, 'utf8');
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
                fs.writeFileSync(filepath, body, 'utf8');
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
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(fs.existsSync(filepath) ? fs.readFileSync(filepath, 'utf8') : '[]');
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
                  try { results = JSON.parse(fs.readFileSync(filepath, 'utf8')); } catch (e) { results = []; }
                }
                results.push(JSON.parse(body));
                fs.writeFileSync(filepath, JSON.stringify(results, null, 2), 'utf8');
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
})
