/**
 * Forge3D End-to-End Test (Phase 18-D)
 *
 * Exercises the full model-bridge path: server start → POST /generate →
 * poll /status → verify terminal state. Skips cleanly when Python is
 * unavailable (hardware-gated — RTX 5080 / CPU fallback required).
 *
 * Usage:
 *   node src/tests/forge3d-e2e.js           # uses default port 3847
 *   PORT=3848 node src/tests/forge3d-e2e.js
 *
 * Exit codes:
 *   0 — all tests passed, or skipped because Python is unavailable
 *   1 — test failure
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 2026
 */

const BASE_URL = `http://127.0.0.1:${process.env.PORT || 3847}`;
const POLL_INTERVAL_MS = 2000;
const POLL_MAX_ATTEMPTS = 300; // 10 minutes — matches generation.timeout_ms in forge3d.yaml

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  ✓ ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`  ✗ ${name}: ${err?.message || err}`);
}

async function get(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  return { status: res.status, body: await res.json() };
}

/**
 * Poll GET /api/forge3d/status/:id until state is terminal or timeout.
 */
async function pollStatus(sessionId) {
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    const { body } = await get(`/api/forge3d/status/${sessionId}`);
    if (body.state === 'complete' || body.state === 'failed') return body;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Timeout: session ${sessionId} did not reach terminal state in ${POLL_MAX_ATTEMPTS}s`);
}

// --- Tests ---

async function testServerReachable() {
  const { status, body } = await get('/api/health');
  if (status !== 200) throw new Error(`/api/health returned ${status}`);
  if (!body.status) throw new Error('Missing status field in health response');
}

async function testBridgeStatusEndpoint() {
  const { status, body } = await get('/api/forge3d/bridge');
  if (status !== 200) throw new Error(`/api/forge3d/bridge returned ${status}`);
  if (!body.bridge) throw new Error('Missing bridge field');
  return body.bridge.state;
}

async function testQueueStatusEndpoint() {
  const { status, body } = await get('/api/forge3d/queue');
  if (status !== 200) throw new Error(`/api/forge3d/queue returned ${status}`);
  if (typeof body.queuedCount !== 'number') throw new Error('Missing queuedCount');
  if (typeof body.deadLetterCount !== 'number') throw new Error('Missing deadLetterCount field (18-A regression)');
}

async function testExportEndpoint() {
  const res = await fetch(`${BASE_URL}/api/forge3d/export`);
  if (res.status !== 200) throw new Error(`/api/forge3d/export returned ${res.status}`);
  const body = await res.json();
  if (body.version !== 1) throw new Error('Export version mismatch');
  if (!body.tables || !body.tables.projects) throw new Error('Export missing tables.projects');
  if (!body.exportedAt) throw new Error('Export missing exportedAt timestamp');
}

async function testPruneEndpoint() {
  const { status, body } = await post('/api/forge3d/history/prune', { daysToKeep: 9999 });
  if (status !== 200) throw new Error(`/api/forge3d/history/prune returned ${status}`);
  if (typeof body.pruned !== 'number') throw new Error('Missing pruned count in response');
}

async function testSSETerminalStateFix(sessionId) {
  // Open SSE stream for a completed session; should receive a terminal frame immediately.
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('SSE terminal-state: no terminal frame within 5s')), 5000);

    const ctrl = new AbortController();
    fetch(`${BASE_URL}/api/forge3d/stream/${sessionId}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status !== 200) {
          clearTimeout(timeout);
          ctrl.abort();
          return reject(new Error(`SSE stream returned ${res.status}`));
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';

        let streaming = true;
        while (streaming) {
          const { done, value } = await reader.read();
          if (done) { streaming = false; break; }
          buf += decoder.decode(value, { stream: true });

          // Parse SSE frames
          const frames = buf.split('\n\n');
          for (const frame of frames) {
            const dataLine = frame.split('\n').find((l) => l.startsWith('data:'));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(5).trim());
              if (payload.done || payload.failed) {
                clearTimeout(timeout);
                ctrl.abort();
                return resolve();
              }
            } catch (_e) { /* keep reading */ }
          }
          buf = frames[frames.length - 1];
        }

        clearTimeout(timeout);
        ctrl.abort();
        resolve();
      })
      .catch((err) => {
        clearTimeout(timeout);
        if (err.name === 'AbortError') return resolve();
        reject(err);
      });
  });
}

async function testGenerateImageAndPoll() {
  // POST a text-to-image generation
  const { status, body } = await post('/api/forge3d/generate', {
    type: 'image',
    prompt: 'a simple red cube on a white background'
  });

  if (status !== 202) throw new Error(`/generate returned ${status}: ${body.error || ''}`);
  if (!body.sessionId) throw new Error('Missing sessionId in generate response');

  const finalStatus = await pollStatus(body.sessionId);

  if (finalStatus.state !== 'complete') {
    throw new Error(`Generation ended with state=${finalStatus.state}, error=${finalStatus.error}`);
  }

  // Verify the completed session has a downloadable result
  const downloadRes = await fetch(`${BASE_URL}/api/forge3d/download/${body.sessionId}`);
  if (downloadRes.status !== 200) {
    throw new Error(`Download returned ${downloadRes.status} for completed session`);
  }

  const contentType = downloadRes.headers.get('content-type') || '';
  if (!contentType.includes('image/png') && !contentType.includes('model/gltf')) {
    throw new Error(`Unexpected content-type: ${contentType}`);
  }

  return body.sessionId;
}

// --- Runner ---

async function run() {
  console.log('[FORGE3D-E2E] Phase 18-D end-to-end test\n');

  // 1. Server must be reachable
  try {
    await testServerReachable();
    pass('Server reachable at /api/health');
  } catch (err) {
    console.error(`[FORGE3D-E2E] Server not reachable at ${BASE_URL} — is brightforge-server.js running?`);
    console.error(`  ${err.message}`);
    process.exit(1);
  }

  // 2. Bridge status
  let bridgeState;
  try {
    bridgeState = await testBridgeStatusEndpoint();
    pass(`Bridge status endpoint OK (state=${bridgeState})`);
  } catch (err) {
    fail('Bridge status endpoint', err);
  }

  // 3. Queue status — always runs
  try {
    await testQueueStatusEndpoint();
    pass('Queue status includes deadLetterCount (18-A)');
  } catch (err) {
    fail('Queue status endpoint', err);
  }

  // 4. Export — always runs
  try {
    await testExportEndpoint();
    pass('DB export endpoint returns valid dump (18-B)');
  } catch (err) {
    fail('DB export endpoint', err);
  }

  // 5. Prune — always runs
  try {
    await testPruneEndpoint();
    pass('History prune endpoint returns pruned count (18-B)');
  } catch (err) {
    fail('History prune endpoint', err);
  }

  // 6. Python-gated tests: skip if bridge is not running
  if (bridgeState !== 'running') {
    console.log(`\n[FORGE3D-E2E] [SKIP] Python bridge is ${bridgeState || 'offline'} — skipping generation tests`);
    console.log('[FORGE3D-E2E] To enable: start the server and ensure Python + PyTorch are installed.\n');
  } else {
    // 6a. Full generation poll
    let completedSessionId;
    try {
      completedSessionId = await testGenerateImageAndPoll();
      pass('POST /generate → poll /status → complete + download (18-D)');
    } catch (err) {
      fail('Generation end-to-end', err);
    }

    // 6b. SSE terminal-state fix — needs a completed session
    if (completedSessionId) {
      try {
        await testSSETerminalStateFix(completedSessionId);
        pass('SSE /stream sends terminal frame for already-complete session (18-C)');
      } catch (err) {
        fail('SSE terminal-state fix', err);
      }
    }
  }

  // Summary
  console.log(`\n[FORGE3D-E2E] Results: ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('[FORGE3D-E2E] Unexpected error:', err.message);
  process.exit(1);
});
