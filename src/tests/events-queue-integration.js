/**
 * events-queue-integration.js - Deterministic integration tests for
 * event routing and dead-letter handling.
 *
 *   1. Dead letter: a job whose generation always fails (injected failure,
 *      no GPU) ends in status 'dead_letter' after max_retries, is counted
 *      in getStatus().deadLetterCount, and can be requeued manually.
 *   2. WebSocket bridge: a real server is started; client A sends an
 *      orchestration event over /ws/events, the server forwards it to the
 *      OrchestrationEventBus, and client B receives the bridged broadcast.
 *      A client on the old path '/' is rejected.
 *
 * Run: node src/tests/events-queue-integration.js
 */

import { mkdtempSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import { createServer as createNetServer } from 'net';
import { fileURLToPath } from 'url';
import WebSocket from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

function waitFor(emitter, event, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    emitter.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
}

async function testDeadLetter() {
  console.log('\n[1] Dead-letter transition (injected failure)');
  const dir = mkdtempSync(join(tmpdir(), 'bf-dlq-'));
  const { default: forge3dDb } = await import('../forge3d/database.js');
  const { default: forgeSession } = await import('../forge3d/forge-session.js');
  const { default: forge3dConfig } = await import('../forge3d/config-loader.js');
  const { default: queue } = await import('../forge3d/generation-queue.js');

  forge3dDb.dbPath = join(dir, 'forge3d-test.db');
  let attempts = 0;
  let failNext = true;
  const originalCreate = forgeSession.create.bind(forgeSession);
  const originalRun = forgeSession.run.bind(forgeSession);
  forgeSession.create = () => `test-session-${attempts}`;
  forgeSession.run = async () => {
    attempts++;
    if (failNext) throw new Error('injected generation failure');
    return { generationTime: 1 };
  };

  try {
    queue.init();
    const maxRetries = forge3dConfig.queue.max_retries;
    const job = queue.enqueue({ type: 'image', prompt: 'dead-letter fixture' });
    const jobId = job.id || job.jobId;
    const dl = await waitFor(queue, 'dead_letter', 30000);
    check(dl.jobId === jobId, 'dead_letter event emitted for the job');
    check(attempts === maxRetries + 1, `job attempted ${maxRetries + 1} times (got ${attempts})`);
    check(forge3dDb.getHistoryEntry(jobId).status === 'dead_letter', 'history status is dead_letter');
    check(queue.getStatus().deadLetterCount === 1, 'getStatus().deadLetterCount === 1');

    failNext = false;
    const requeued = queue.retryDeadLetter(jobId);
    check(requeued === true, 'retryDeadLetter() requeues the job');
    await waitFor(queue, 'complete', 30000);
    check(forge3dDb.getHistoryEntry(jobId).status === 'complete', 'manual retry completes the job');
    check(queue.getStatus().deadLetterCount === 0, 'deadLetterCount back to 0');
  } catch (err) {
    check(false, `dead-letter flow threw: ${err.message}`);
  } finally {
    forgeSession.create = originalCreate;
    forgeSession.run = originalRun;
    try { queue.shutdown?.(); } catch (_e) { /* best-effort */ }
    try { forge3dDb.close?.(); } catch (_e) { /* best-effort */ }
    rmSync(dir, { recursive: true, force: true });
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function startServer(port) {
  return new Promise((resolve) => {
    const env = { ...process.env, PORT: String(port), NODE_ENV: 'test' };
    delete env.BRIGHTFORGE_API_KEY;
    delete env.BRIGHTFORGE_HOST;
    const child = spawn(process.execPath, [join(ROOT, 'bin', 'brightforge-server.js')], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const timer = setTimeout(() => resolve({ child, ready: false, out }), 60000);
    const onData = (d) => {
      out += d;
      if (out.includes('WebSocket: ws://')) { clearTimeout(timer); resolve({ child, ready: true, out }); }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => { clearTimeout(timer); resolve({ child, ready: false, out }); });
  });
}

function openWs(url) {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    const t = setTimeout(() => { ws.terminate(); resolve({ ws: null, error: 'timeout' }); }, 5000);
    ws.once('open', () => { clearTimeout(t); resolve({ ws }); });
    ws.once('error', (e) => { clearTimeout(t); resolve({ ws: null, error: e.message }); });
  });
}

function nextMessage(ws, predicate, ms) {
  return new Promise((resolve) => {
    const t = setTimeout(() => { ws.off('message', onMsg); resolve(null); }, ms);
    function onMsg(raw) {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(msg)) { clearTimeout(t); ws.off('message', onMsg); resolve(msg); }
    }
    ws.on('message', onMsg);
  });
}

async function testWsBridge() {
  console.log('\n[2] WebSocket <-> OrchestrationEventBus bridge (real server)');
  const port = await freePort();
  const srv = await startServer(port);
  try {
    check(srv.ready, 'server started and attached the WebSocket bus');
    if (!srv.ready) { console.log(srv.out.slice(-600)); return; }
    check(!srv.out.includes('Orchestration event bus unavailable'), 'orchestration bus passed to attach()');

    const wrongPath = await openWs(`ws://127.0.0.1:${port}/`);
    check(wrongPath.ws === null, 'old path "/" is not a WebSocket endpoint');

    const a = await openWs(`ws://127.0.0.1:${port}/ws/events`);
    const b = await openWs(`ws://127.0.0.1:${port}/ws/events`);
    check(Boolean(a.ws && b.ws), 'two clients connect on /ws/events');
    if (!a.ws || !b.ws) return;

    for (const [ws, name, channel] of [[a.ws, 'test-sender', 'agents'], [b.ws, 'test-ui', 'ui']]) {
      const reg = nextMessage(ws, (m) => m.type === 'registered', 5000);
      ws.send(JSON.stringify({ type: 'register', source: name, channel }));
      check(Boolean(await reg), `${name} registered`);
    }

    const bridged = nextMessage(b.ws, (m) => m.type === 'event' && m.source === 'orchestration' && m.payload?.eventType === 'task_started', 8000);
    a.ws.send(JSON.stringify({
      type: 'event', source: 'test-sender', target: 'all', channel: 'agents',
      payload: { eventType: 'task_started', agent: 'Claude', taskId: 'ws-bridge-test', data: { probe: true } }
    }));
    const msg = await bridged;
    check(Boolean(msg), 'client B received the event bridged from the orchestration bus');
    check(msg?.payload?.eventType === 'task_started' && typeof msg?.payload?.eventId === 'string', 'bridged payload uses eventType and carries an eventId');

    a.ws.close();
    b.ws.close();
  } finally {
    await new Promise((resolve) => {
      if (srv.child.exitCode !== null) return resolve();
      srv.child.once('exit', resolve);
      srv.child.kill('SIGTERM');
      setTimeout(() => { try { srv.child.kill('SIGKILL'); } catch (_e) { /* gone */ } }, 5000);
    });
  }
}

async function testClientPaths() {
  console.log('\n[3] Dashboard WebSocket clients use /ws/events');
  const { readdirSync, readFileSync } = await import('fs');
  const dir = join(ROOT, 'public', 'js');
  const offenders = [];
  let count = 0;
  for (const name of readdirSync(dir).filter((n) => n.endsWith('.js'))) {
    const text = readFileSync(join(dir, name), 'utf8');
    for (const m of text.matchAll(/new WebSocket\(([^)]*)\)/g)) {
      count++;
      if (!m[1].includes('/ws/events')) offenders.push(`${name}: ${m[1].trim()}`);
    }
  }
  check(count > 0, `found ${count} WebSocket client(s) in public/js`);
  check(offenders.length === 0, `all clients target /ws/events${offenders.length ? ` (offenders: ${offenders.join('; ')})` : ''}`);
}

async function main() {
  console.log('[EVENTS-QUEUE] Running integration tests...');
  await testDeadLetter();
  await testWsBridge();
  await testClientPaths();
  console.log(`\n[EVENTS-QUEUE] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[EVENTS-QUEUE] Crashed:', err);
  process.exit(1);
});
