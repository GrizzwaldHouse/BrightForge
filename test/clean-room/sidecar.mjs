// Test-only sidecar: shares the server container's network namespace.
// 1) TCP forwarder 0.0.0.0:8080 -> 127.0.0.1:3847 (lets the browser reach a loopback-bound server)
// 2) Fake Ollama on 127.0.0.1:11434 that returns a fixed, valid plan (no real inference)
import net from 'node:net';
import http from 'node:http';
net.createServer((c) => {
  const u = net.connect(3847, '127.0.0.1');
  c.pipe(u).pipe(c);
  c.on('error', () => u.destroy()); u.on('error', () => c.destroy());
}).listen(8080, '0.0.0.0');
const PLAN = [
  '## SUMMARY', 'Add a hello file (fake model output).', '',
  '## FILE: hello.txt', '## ACTION: create', '## DESCRIPTION: fixture file',
  '```text', 'hello from the fake model', '```'
].join('\n');
const calls = []; let mode = 'ok';
const TRAVERSAL = PLAN.replace('## FILE: hello.txt', '## FILE: ../escape.txt');
const ABSOLUTE = PLAN.replace('## FILE: hello.txt', '## FILE: /tmp/abs-escape.txt');
http.createServer((req, res) => {
  let b = ''; req.on('data', (d) => { b += d; });
  req.on('end', () => {
    calls.push({ m: req.method, u: req.url, t: Date.now() });
    if (req.url === '/__calls') { res.end(JSON.stringify(calls)); return; }
    if (req.url.startsWith('/__mode/')) { mode = req.url.slice(8); res.end(mode); return; }
    if (req.url === '/api/tags') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ models: [{ name: 'fake:1b' }] })); return;
    }
    if (req.url.endsWith('/chat/completions')) {
      if (mode === 'slow') return; // never answers
      if (mode === 'malformed') { res.setHeader('Content-Type', 'application/json'); res.end('{"choices": [ trunc'); return; }
      if (mode === 'empty') { res.setHeader('Content-Type', 'application/json'); res.end('{"choices": []}'); return; }
      if (mode === 'http500') { res.statusCode = 500; res.end('{"error":"boom"}'); return; }
      const content = mode === 'traversal' ? TRAVERSAL : mode === 'absolute' ? ABSOLUTE : mode === 'garbage' ? 'no plan here, just prose' : PLAN;
      let model = 'fake:1b'; try { model = JSON.parse(b).model || model; } catch { /* ignore */ }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ model, choices: [{ message: { role: 'assistant', content } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } })); return;
    }
    res.statusCode = 404; res.end();
  });
}).listen(11434, '127.0.0.1');
console.log('[SIDECAR] ready');
