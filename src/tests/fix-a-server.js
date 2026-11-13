/**
 * fix-a-server.js - Acceptance tests for workstream A (server) fixes.
 *
 *   R-A1. Rate limiter is keyed on the peer address: loopback peers get the
 *         higher limit, remote peers keep the base limit; the real general
 *         limiter does not 429 a dashboard-sized burst from loopback.
 *   R-A2. The x-brightforge-test header skips limits only when NODE_ENV=test.
 *   R-A3. Graceful shutdown stops accepting connections, lets an in-flight
 *         request finish, and exits 0 (also exits 0 at the drain timeout).
 *
 * Isolation: private Express/http servers on ephemeral loopback ports, no
 * network, no database, no timers left running.
 *
 * Run: node src/tests/fix-a-server.js
 */

import http from 'http';
import express from 'express';
import * as rateLimitModule from '../api/middleware/rate-limit.js';
import * as serverModule from '../api/server.js';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function get(port, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', headers, agent: false }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}

async function burst(port, count, headers) {
  let limited = 0;
  for (let i = 0; i < count; i++) {
    const res = await get(port, headers);
    if (res.status === 429) limited++;
  }
  return limited;
}

// Build an app with one limiter; peerAddress overrides the socket peer when set.
async function limitedApp(limiter, peerAddress) {
  const app = express();
  if (peerAddress) {
    app.use((req, _res, next) => {
      Object.defineProperty(req.socket, 'remoteAddress', { value: peerAddress, configurable: true });
      next();
    });
  }
  app.use(limiter);
  app.get('/', (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  const port = await listen(server);
  return { server, port };
}

function close(server) {
  return new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); });
}

async function testRateLimitPeers() {
  console.log('[FIX-A] R-A1 limiter keyed on peer address');
  const general = await limitedApp(rateLimitModule.generalLimiter);
  check(await burst(general.port, 100) === 0, 'real generalLimiter: 100 loopback requests in a minute yield no 429');
  await close(general.server);

  const { createLimiter } = rateLimitModule;
  check(typeof createLimiter === 'function', 'createLimiter is exported');
  if (typeof createLimiter !== 'function') return;

  const loop = await limitedApp(createLimiter(3, 'Test', { loopbackMax: 10 }));
  check(await burst(loop.port, 10) === 0, 'loopback peer: 10 requests (above base 3) are not limited');
  check(await burst(loop.port, 1) === 1, 'loopback peer: request 11 is limited');
  await close(loop.server);

  const remote = await limitedApp(createLimiter(3, 'Test', { loopbackMax: 10 }), '203.0.113.5');
  check(await burst(remote.port, 3) === 0, 'remote peer: first 3 requests pass');
  check(await burst(remote.port, 1) === 1, 'remote peer: request 4 is limited at base limit');
  await close(remote.server);

  // X-Forwarded-For must not make a remote peer look local
  const spoof = await limitedApp(createLimiter(3, 'Test', { loopbackMax: 10 }), '203.0.113.5');
  const limited = await burst(spoof.port, 5, { 'x-forwarded-for': '127.0.0.1' });
  check(limited === 2, 'remote peer spoofing X-Forwarded-For stays on the base limit');
  await close(spoof.server);
}

async function testTestHeader() {
  console.log('[FIX-A] R-A2 test header gated on NODE_ENV=test');
  const { createLimiter } = rateLimitModule;
  if (typeof createLimiter !== 'function') { check(false, 'createLimiter available'); return; }
  const savedEnv = process.env.NODE_ENV;
  const header = { 'x-brightforge-test': 'true' };
  try {
    delete process.env.NODE_ENV;
    const a = await limitedApp(createLimiter(2, 'Test'));
    check(await burst(a.port, 5, header) === 3, 'NODE_ENV unset: header from loopback is still limited');
    await close(a.server);

    process.env.NODE_ENV = 'production';
    const p = await limitedApp(createLimiter(2, 'Test'));
    check(await burst(p.port, 5, header) === 3, 'NODE_ENV=production: header is still limited');
    await close(p.server);

    process.env.NODE_ENV = 'test';
    const b = await limitedApp(createLimiter(2, 'Test'));
    check(await burst(b.port, 5, header) === 0, 'NODE_ENV=test: header from loopback skips the limit');
    check(await burst(b.port, 5) === 3, 'NODE_ENV=test: requests without the header are still limited');
    await close(b.server);

    const r = await limitedApp(createLimiter(2, 'Test'), '203.0.113.5');
    check(await burst(r.port, 5, header) === 3, 'NODE_ENV=test: header from a remote peer is still limited');
    await close(r.server);
  } finally {
    if (savedEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = savedEnv;
  }
}

async function testGracefulShutdown() {
  console.log('[FIX-A] R-A3 graceful shutdown');
  const { createGracefulShutdown } = serverModule;
  check(typeof createGracefulShutdown === 'function', 'createGracefulShutdown is exported');
  if (typeof createGracefulShutdown !== 'function') return;

  // In-flight request finishes, exit code 0, new connections refused
  const server = http.createServer((_req, res) => {
    setTimeout(() => { res.end('done'); }, 600);
  });
  const port = await listen(server);
  const exits = [];
  let closedHook = 0;
  const shutdown = createGracefulShutdown(server, {
    timeoutMs: 5000,
    onClosed: () => { closedHook++; },
    exit: (code) => exits.push(code)
  });
  const pending = get(port);
  await new Promise((r) => setTimeout(r, 150));
  shutdown('SIGTERM');
  shutdown('SIGTERM');
  const res = await pending;
  check(res.status === 200 && res.body === 'done', 'request pending at SIGTERM receives its response');
  await new Promise((r) => setTimeout(r, 100));
  check(exits.length === 1 && exits[0] === 0, 'process exits once with code 0 after drain');
  check(closedHook === 1, 'cleanup hook runs once after the server closed');
  let refused = false;
  try { await get(port); } catch (_e) { refused = true; }
  check(refused, 'new connections are refused after shutdown starts');

  // A request that never finishes: exit 0 at the drain timeout
  const stuck = http.createServer(() => { /* never responds */ });
  const stuckPort = await listen(stuck);
  const stuckExits = [];
  const stuckShutdown = createGracefulShutdown(stuck, { timeoutMs: 300, exit: (code) => stuckExits.push(code) });
  const stuckReq = http.get({ host: '127.0.0.1', port: stuckPort, path: '/', agent: false });
  stuckReq.on('error', () => { /* connection is cut at timeout */ });
  await new Promise((r) => setTimeout(r, 100));
  const t0 = Date.now();
  stuckShutdown('SIGINT');
  await new Promise((r) => setTimeout(r, 600));
  check(stuckExits.length === 1 && stuckExits[0] === 0, 'stuck request: exits 0 at the drain timeout');
  check(Date.now() - t0 >= 300, 'stuck request: waits for the drain window before exiting');
  stuckReq.destroy();
}

async function main() {
  console.log('[FIX-A] Workstream A acceptance tests...');
  try {
    await testRateLimitPeers();
    await testTestHeader();
    await testGracefulShutdown();
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  }
  console.log(`\n[FIX-A] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
  // express-rate-limit memory stores hold timers; exit explicitly
  setTimeout(() => process.exit(process.exitCode), 50);
}

main().catch((err) => {
  console.error('[FIX-A] Crashed:', err);
  process.exit(1);
});
