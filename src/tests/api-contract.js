/**
 * api-contract.js - Request validation and error mapping contract.
 *
 * Builds the real Express app (state redirected to a temp dir) and checks:
 *   - /api/forge3d/generate rejects bad input with 400 before starting the
 *     Python bridge (non-string prompt, bad type, unsupported content type)
 *   - body-parser errors keep their client status: oversize JSON -> 413,
 *     malformed JSON -> 400 (they used to become 500)
 *   - the SSE terminal event has one shape for complete and failed, with
 *     done: true, a failed flag, and no result buffers
 *
 * No GPU, Python or network. Run: node src/tests/api-contract.js
 */

import { mkdtempSync, rmSync } from 'fs';
import { request } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';

const HTTP_BAD_REQUEST = 400;
const HTTP_PAYLOAD_TOO_LARGE = 413;
// Larger than the 1mb json_default in config/agent-config.yaml.
const OVERSIZE_BYTES = 2 * 1024 * 1024;

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

// http.request with agent: false so no keep-alive client socket outlives the
// test (open sockets at exit abort Node on Windows: UV_HANDLE_CLOSING).
function post(base, path, body, contentType = 'application/json') {
  return new Promise((resolve, reject) => {
    const req = request(`${base}${path}`, { method: 'POST', agent: false, headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) } }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_e) { json = null; }
        resolve({ status: res.statusCode, json });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function main() {
  const work = mkdtempSync(join(tmpdir(), 'bf-api-contract-'));
  process.env.BRIGHTFORGE_STATE_ROOT = work;

  const { terminalEvent } = await import('../forge3d/sse-events.js');
  const { summarizeForStatus } = await import('../forge3d/pipeline/asset-pipeline-runner.js');
  const { default: modelBridge } = await import('../forge3d/model-bridge.js');
  const { createServer } = await import('../api/server.js');
  const { app } = createServer({ sessionsDir: join(work, 'sessions') });

  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bridgeStateBefore = modelBridge.state;

  try {
    console.log('\n[1] /generate validation runs before the bridge starts');
    let r = await post(base, '/api/forge3d/generate', JSON.stringify({ type: 'image', prompt: 12345 }));
    check(r.status === HTTP_BAD_REQUEST && r.json?.error === 'Prompt must be a string.', `non-string prompt -> 400 (${r.status} ${r.json?.error})`);
    r = await post(base, '/api/forge3d/generate', 'hello', 'text/plain');
    check(r.status === HTTP_BAD_REQUEST && /Unsupported content type/.test(r.json?.error || ''), `text/plain -> 400 (${r.status})`);
    check(modelBridge.state === bridgeStateBefore, `bridge not started by invalid requests (${bridgeStateBefore} -> ${modelBridge.state})`);

    console.log('\n[2] Body parser errors keep their client status');
    r = await post(base, '/api/memory', '{"category": "code", "text": ');
    check(r.status === HTTP_BAD_REQUEST && r.json?.error === 'Malformed JSON body', `malformed JSON -> 400 (${r.status} ${r.json?.error})`);
    r = await post(base, '/api/memory', JSON.stringify({ category: 'code', text: 'x'.repeat(OVERSIZE_BYTES) }));
    check(r.status === HTTP_PAYLOAD_TOO_LARGE && r.json?.error === 'Request body too large', `oversize JSON -> 413 (${r.status} ${r.json?.error})`);

    console.log('\n[3] Retired placeholder pipeline routes say where the real API is');
    let g = await new Promise((resolve, reject) => {
      request(`${base}/api/forge3d/pipelines/abc`, { agent: false }, (res) => { let raw = ''; res.on('data', (c) => { raw += c; }); res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(raw) })); }).on('error', reject).end();
    });
    check(g.status === 410 && g.json?.status === 'GET /api/pipelines/:id', `GET /api/forge3d/pipelines/:id -> 410 (${g.status})`);
    g = await post(base, '/api/forge3d/pipelines/run', JSON.stringify({ pipeline: 'x', prompt: 'y' }));
    check(g.status === 410 && g.json?.run === 'POST /api/pipelines/run', `POST /api/forge3d/pipelines/run -> 410 (${g.status})`);

    console.log('\n[4] Pipeline status carries buffer sizes, not buffers');
    const summary = summarizeForStatus({ meshBuffer: Buffer.alloc(1000), lods: [{ buf: new Uint8Array(5), faces: 10 }], n: 1, s: 'x', z: null });
    check(summary.meshBuffer?.bytes === 1000 && summary.lods[0].buf.bytes === 5 && summary.lods[0].faces === 10, 'buffers become { bytes }');
    check(summary.n === 1 && summary.s === 'x' && summary.z === null, 'other values unchanged');
    const { default: telemetryBus } = await import('../core/telemetry-bus.js');
    telemetryBus.emit('forge3d_contract_probe', { result: { meshBuffer: Buffer.alloc(2048) } });
    const kept = telemetryBus.ringBuffers.forge3d[telemetryBus.ringBuffers.forge3d.length - 1];
    check(kept?.result?.meshBuffer?.bytes === 2048 && !Buffer.isBuffer(kept.result.meshBuffer), 'telemetry ring buffer keeps sizes, not buffers');

    console.log('\n[5] SSE terminal event shape');
    const done = terminalEvent('s1', { state: 'complete', progress: { percent: 100 }, hasResult: true, result: { meshBuffer: Buffer.alloc(8) } });
    const fail = terminalEvent('s2', { state: 'failed', error: 'boom' });
    check(done.done === true && done.failed === false && done.error === null, 'complete: done, not failed, no error');
    check(fail.done === true && fail.failed === true && fail.error === 'boom', 'failed: done, failed, error kept');
    check(!('result' in done) && !JSON.stringify(done).includes('meshBuffer'), 'no result buffers in the event');
    check(JSON.stringify(Object.keys(done).sort()) === JSON.stringify(Object.keys(fail).sort()), 'same keys for complete and failed');
    let threw = false;
    try { terminalEvent('s3', { state: 'generating_mesh' }); } catch (_e) { threw = true; }
    check(threw, 'non-terminal state is refused');
  } finally {
    await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    rmSync(work, { recursive: true, force: true });
  }

  console.log(`\n[API-CONTRACT] ${passed} passed, ${failed} failed`);
  // createServer() starts runtime services with their own timers; exit
  // explicitly once the HTTP server and its sockets are closed.
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[API-CONTRACT] Crashed:', err);
  process.exit(1);
});
