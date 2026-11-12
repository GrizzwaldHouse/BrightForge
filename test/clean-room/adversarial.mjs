// Phase 07 adversarial checks against the isolated server (through the loopback sidecar).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
const B = process.argv[2]; const OUT = process.argv[3];
const R = []; const T = { 'x-brightforge-test': 'true' }; // documented rate-limit bypass, loopback only
const approve = (j) => req('POST', '/api/chat/approve', { body: { sessionId: j?.sessionId, planId: j?.plan?.id || 'current', action: 'apply' } });
const rec = (area, name, expect, actual, pass, note = '') => { R.push({ area, name, expect, actual, verdict: pass ? 'PASS' : 'FAIL', note }); console.log(pass ? 'PASS' : 'FAIL', area, '|', name, '|', actual); };
const sh = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
const mode = (m) => sh('exec', 'bf-sidecar', 'node', '-e', `fetch('http://127.0.0.1:11434/__mode/${m}').then(r=>r.text()).then(console.log)`);
const req = async (method, path, { body, raw, headers = {}, timeout = 20000 } = {}) => {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(B + path, { method, signal: ctl.signal, headers: { ...T, ...(body || raw ? { 'content-type': 'application/json' } : {}), ...headers }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const text = await r.text(); let json; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, text: text.slice(0, 300), json, headers: r.headers };
  } catch (e) { return { status: 0, text: String(e.name || e.message) }; } finally { clearTimeout(t); }
};
const alive = async () => (await req('GET', '/api/health')).status === 200;
const fexists = (p) => { try { sh('exec', 'bf-server', 'test', '-e', p); return true; } catch { return false; } };

(async () => {
  // 1. Input validation
  let r = await req('POST', '/api/chat/turn', { body: {} }); rec('input', 'turn without message', '400', r.status, r.status === 400);
  r = await req('POST', '/api/chat/turn', { body: { message: 42 } }); rec('input', 'turn with numeric message', '400', r.status, r.status === 400);
  r = await req('POST', '/api/chat/turn', { raw: '{"message": "x",' }); rec('input', 'malformed JSON body', '400, no stack trace', `${r.status} ${r.text.slice(0, 80)}`, r.status === 400 && !/at .*\.js:\d+/.test(r.text));
  r = await req('POST', '/api/chat/turn', { raw: JSON.stringify({ message: 'x'.repeat(5 * 1024 * 1024) }) }); rec('input', '5 MB JSON body', '413', r.status, r.status === 413);
  r = await req('POST', '/api/chat/approve', { body: { sessionId: 'nope' } }); rec('input', 'approve unknown session', '4xx', r.status, r.status >= 400 && r.status < 500);
  r = await req('GET', '/api/forge3d/projects/%27%20OR%201%3D1--'); rec('input', 'SQL-ish project id', '404/400', r.status, [400, 404].includes(r.status));
  r = await req('GET', '/api/forge3d/download/..%2F..%2F..%2Fetc%2Fpasswd'); rec('input', 'download path traversal id', '4xx, no file contents', `${r.status}`, r.status >= 400 && r.status < 500 && !r.text.includes('root:'));
  r = await req('GET', '/api/forge3d/assets/1/textures/..%2F..%2F..%2Fetc%2Fpasswd'); rec('input', 'texture name traversal', '4xx, no file contents', `${r.status}`, r.status >= 400 && r.status < 500 && !r.text.includes('root:'));
  for (const h of ['HEAD', 'HEAD~1..HEAD', '--help', 'a'.repeat(5000), 'main']) { r = await req('POST', `/api/chat/revert/${encodeURIComponent(h)}`, { body: { projectRoot: '/tmp/demo' } }); rec('input', `revert ${h.slice(0, 20)}`, '400', r.status, r.status === 400 || r.status === 414 || r.status === 431); }
  rec('input', 'server alive after input tests', '200', await alive(), await alive());

  // 2. Plan safety (fake model returns unsafe paths)
  sh('exec', 'bf-server', 'mkdir', '-p', '/tmp/p1');
  for (const [m, target] of [['traversal', '/tmp/escape.txt'], ['absolute', '/tmp/abs-escape.txt']]) {
    mode(m); r = await req('POST', '/api/chat/turn?sync=true', { body: { message: 'x', projectRoot: '/tmp/p1' }, timeout: 30000 });
    const ops = r.json?.plan?.operations?.length ?? r.json?.operations?.length; const sid = r.json?.sessionId;
    const a = sid ? await approve(r.json) : { status: 'n/a' };
    rec('plan', `model proposes ${m} path`, 'rejected, nothing written outside project', `turn ${r.status} ops=${ops} approve=${a.status} ${(a.json?.error || a.json?.message || a.json?.status || '').toString().slice(0, 90)} written=${fexists(target)}`, !fexists(target), (r.json?.error || r.json?.validation?.errors || '').toString().slice(0, 120));
  }
  // R2: client-chosen projectRoot
  mode('ok'); sh('exec', 'bf-server', 'mkdir', '-p', '/tmp/elsewhere');
  r = await req('POST', '/api/chat/turn?sync=true', { body: { message: 'x', projectRoot: '/tmp/elsewhere' }, timeout: 30000 });
  if (r.json?.sessionId) await approve(r.json);
  rec('plan', 'request body chooses projectRoot (R2)', 'documented risk: write lands where the client says', `written=${fexists('/tmp/elsewhere/hello.txt')}`, fexists('/tmp/elsewhere/hello.txt'), 'Confirms R2: any directory writable by the server user. Loopback-only today');

  // 3. Malformed model responses and timeouts
  for (const m of ['malformed', 'empty', 'http500', 'garbage']) {
    mode(m); const t0 = Date.now(); r = await req('POST', '/api/chat/turn?sync=true', { body: { message: 'x', projectRoot: '/tmp/p1' }, timeout: 60000 });
    rec('provider', `model returns ${m}`, 'error reported, no crash', `${r.status} in ${Date.now() - t0} ms: ${(r.json?.error || r.json?.status || r.text).toString().slice(0, 80)}`, r.status !== 0 && (await alive()));
  }
  mode('slow'); let t0 = Date.now(); r = await req('POST', '/api/chat/turn?sync=true', { body: { message: 'x', projectRoot: '/tmp/p1' }, timeout: 120000 });
  rec('provider', 'model never answers (timeout)', 'error within OLLAMA_TIMEOUT_MS + fallback', `${r.status} after ${Date.now() - t0} ms: ${(r.json?.error || r.text).toString().slice(0, 80)}`, r.status !== 0 && Date.now() - t0 < 60000);

  // 4. Cancellation and SSE disconnect (slow model)
  r = await req('POST', '/api/chat/turn', { body: { message: 'x', projectRoot: '/tmp/p1' } }); const sid = r.json?.sessionId;
  const ctl = new AbortController(); const events = [];
  const sse = fetch(`${B}/api/chat/stream/${sid}`, { signal: ctl.signal, headers: T }).then(async (s) => { for await (const c of s.body) events.push(Buffer.from(c).toString()); }).catch(() => {});
  await new Promise((x) => setTimeout(x, 1500));
  const c = await req('POST', `/api/chat/cancel/${sid}`); await new Promise((x) => setTimeout(x, 1500));
  rec('session', 'cancel in-flight generation', 'cancelled event', `cancel ${c.status}; events: ${events.join('').match(/event: \w+/g)?.join(',') || 'none'}`, c.status === 200 && /cancel/.test(events.join('')));
  ctl.abort(); await sse; rec('session', 'SSE client disconnects mid-stream', 'server alive', await alive(), await alive());

  // 5. Concurrent session isolation
  mode('ok'); sh('exec', 'bf-server', 'mkdir', '-p', '/tmp/a', '/tmp/b');
  const [ra, rb] = await Promise.all(['/tmp/a', '/tmp/b'].map((p) => req('POST', '/api/chat/turn?sync=true', { body: { message: `task for ${p}`, projectRoot: p }, timeout: 30000 })));
  await Promise.all([ra, rb].map((x) => approve(x.json)));
  const ha = ra.json?.history?.map((h) => h.content).join('|') || '';
  rec('session', 'two concurrent sessions', 'distinct ids, files in own roots, no history mixing', `ids differ=${ra.json?.sessionId !== rb.json?.sessionId} a=${fexists('/tmp/a/hello.txt')} b=${fexists('/tmp/b/hello.txt')} mix=${ha.includes('/tmp/b')}`, ra.json?.sessionId !== rb.json?.sessionId && fexists('/tmp/a/hello.txt') && fexists('/tmp/b/hello.txt') && !ha.includes('/tmp/b'));

  // 6. Rate limits (without the test header)
  const codes = []; for (let i = 0; i < 70; i++) codes.push((await req('GET', '/api/sessions', { headers: { 'x-brightforge-test': 'false' } })).status);
  rec('limits', '70 GETs in a burst', '429 after the 60/min limit', `200s=${codes.filter((x) => x === 200).length} 429s=${codes.filter((x) => x === 429).length}`, codes.includes(429));
  r = await req('GET', '/api/sessions'); rec('limits', 'x-brightforge-test header from loopback', 'bypasses limiter (by design, loopback only)', r.status, r.status === 200, 'Any local process can bypass rate limits with this header');

  // 7. Bounded load: 300 requests, concurrency 10
  const lat = []; let errs = 0; const queue = Array.from({ length: 300 }, (_, i) => i);
  await Promise.all(Array.from({ length: 10 }, async () => { while (queue.pop() !== undefined) { const s = Date.now(); const x = await req('GET', '/api/health'); lat.push(Date.now() - s); if (x.status !== 200) errs++; } }));
  lat.sort((a, b) => a - b); const pct = (q) => lat[Math.floor(q * (lat.length - 1))];
  rec('load', '300 x GET /api/health, 10 concurrent', '0 errors', `errors=${errs} p50=${pct(0.5)}ms p95=${pct(0.95)}ms max=${lat.at(-1)}ms`, errs === 0);

  // 8. Headers
  r = await req('GET', '/api/health'); rec('headers', 'security headers', 'X-Content-Type-Options, no X-Powered-By', `nosniff=${r.headers.get('x-content-type-options')} powered=${r.headers.get('x-powered-by')} csp=${!!r.headers.get('content-security-policy')}`, r.headers.get('x-content-type-options') === 'nosniff' && !r.headers.get('x-powered-by'), 'CSP absent is the known R6');

  fs.writeFileSync(`${OUT}/adversarial.json`, JSON.stringify(R, null, 2));
  console.log(`\n${R.filter((x) => x.verdict === 'PASS').length}/${R.length} PASS`);
})();
