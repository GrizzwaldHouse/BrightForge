/**
 * security-regression.js - End-to-end regression tests for P0 security fixes.
 *
 * Starts the real server (bin/brightforge-server.js) as a child process on
 * a free port and checks:
 *   1. Default bind is loopback; the server is not reachable on a LAN address.
 *   2. Non-loopback bind without BRIGHTFORGE_API_KEY refuses to start.
 *   3. With a key: protected routes return 401 without / 200 with the token;
 *      the public health endpoint stays open.
 *   4. Without a key: a non-loopback peer is rejected by the auth middleware.
 *   5. POST /api/chat/revert/:commitHash never executes shell metacharacters.
 *
 * Run: node src/tests/security-regression.js
 * No network access, no API keys and no GPU are required.
 */

import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir, networkInterfaces } from 'os';
import { createServer as createNetServer, connect } from 'net';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import { authMiddleware } from '../api/middleware/auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SERVER = join(ROOT, 'bin', 'brightforge-server.js');
const STARTUP_TIMEOUT_MS = 60000;

let passed = 0;
let failed = 0;
let skipped = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}
function skip(label) { skipped++; console.log(`  SKIP: ${label}`); }

function freePort() {
  return new Promise((resolve, reject) => {
    const s = createNetServer();
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
    s.on('error', reject);
  });
}

function baseEnv(extra = {}) {
  const env = { ...process.env, NODE_ENV: 'test', ...extra };
  delete env.BRIGHTFORGE_API_KEY;
  delete env.BRIGHTFORGE_HOST;
  return { ...env, ...extra };
}

function startServer(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SERVER], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let settled = false;
    const done = (result) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ child, out, ...result }); } };
    const timer = setTimeout(() => done({ ready: false, reason: 'timeout' }), STARTUP_TIMEOUT_MS);
    const onData = (d) => { out += d; if (out.includes('Listening on')) done({ ready: true }); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => done({ ready: false, exitCode: code }));
  });
}

function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null) return resolve();
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => { try { child.kill('SIGKILL'); } catch (_e) { /* already gone */ } }, 5000);
  });
}

function canConnect(host, port) {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const t = setTimeout(() => { sock.destroy(); resolve(false); }, 2000);
    sock.on('connect', () => { clearTimeout(t); sock.destroy(); resolve(true); });
    sock.on('error', () => { clearTimeout(t); resolve(false); });
  });
}

function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

async function testDefaultBind() {
  console.log('\n[1] Default bind is loopback');
  const port = await freePort();
  const srv = await startServer(baseEnv({ PORT: String(port) }));
  try {
    check(srv.ready, 'server starts with no configuration');
    if (!srv.ready) { console.log(srv.out.slice(-800)); return; }
    check(await canConnect('127.0.0.1', port), 'reachable on 127.0.0.1');
    const lan = lanAddress();
    if (lan) check(!(await canConnect(lan, port)), `not reachable on LAN address ${lan}`);
    else skip('no non-loopback interface in this environment');
    const res = await fetch(`http://127.0.0.1:${port}/api/forge3d/queue`);
    check(res.status === 200, 'loopback client allowed when no key is set (local dev mode)');
  } finally {
    await stop(srv.child);
  }
}

async function testRefuseInsecureBind() {
  console.log('\n[2] Non-loopback bind without API key is refused');
  const port = await freePort();
  const srv = await startServer(baseEnv({ PORT: String(port), BRIGHTFORGE_HOST: '0.0.0.0' }));
  try {
    check(!srv.ready && srv.exitCode === 1, 'process exits with code 1');
    check(/without BRIGHTFORGE_API_KEY/.test(srv.out), 'error message names BRIGHTFORGE_API_KEY');
  } finally {
    await stop(srv.child);
  }
}

async function testKeyAuth() {
  console.log('\n[3] API key enforcement');
  const port = await freePort();
  const key = randomBytes(24).toString('hex');
  const srv = await startServer(baseEnv({ PORT: String(port), BRIGHTFORGE_HOST: '0.0.0.0', BRIGHTFORGE_API_KEY: key }));
  try {
    check(srv.ready, 'server starts on 0.0.0.0 when a key is set');
    if (!srv.ready) { console.log(srv.out.slice(-800)); return; }
    const url = `http://127.0.0.1:${port}`;
    check((await fetch(`${url}/api/forge3d/queue`)).status === 401, 'protected route without token -> 401');
    check((await fetch(`${url}/api/forge3d/queue`, { headers: { Authorization: 'Bearer wrong' } })).status === 401, 'wrong token -> 401');
    check((await fetch(`${url}/api/forge3d/queue`, { headers: { Authorization: `Bearer ${key}` } })).status === 200, 'correct token -> 200');
    check((await fetch(`${url}/api/health`)).status === 200, 'public /api/health stays open');
  } finally {
    await stop(srv.child);
  }
}

function testRemotePeerWithoutKey() {
  console.log('\n[4] No key: non-loopback peer rejected by middleware');
  const saved = process.env.BRIGHTFORGE_API_KEY;
  delete process.env.BRIGHTFORGE_API_KEY;
  try {
    const run = (remoteAddress) => {
      let status = null;
      let nextCalled = false;
      const req = { path: '/api/forge3d/projects', method: 'GET', headers: {}, socket: { remoteAddress } };
      const res = { status(c) { status = c; return this; }, json() { return this; } };
      authMiddleware(req, res, () => { nextCalled = true; });
      return { status, nextCalled };
    };
    const remote = run('10.1.2.3');
    check(remote.status === 403 && !remote.nextCalled, 'remote peer 10.1.2.3 -> 403');
    const mapped = run('::ffff:127.0.0.1');
    check(mapped.nextCalled, 'IPv4-mapped loopback peer allowed');
  } finally {
    if (saved !== undefined) process.env.BRIGHTFORGE_API_KEY = saved;
  }
}

async function testRevertInjection() {
  console.log('\n[5] Revert endpoint does not execute shell metacharacters');
  const dir = mkdtempSync(join(tmpdir(), 'bf-sec-'));
  const repo = join(dir, 'repo');
  const sentinel = join(dir, 'PWNED');
  execFileSync('git', ['init', '-q', repo]);
  execFileSync('git', ['-C', repo, 'config', 'user.email', 't@t']);
  execFileSync('git', ['-C', repo, 'config', 'user.name', 't']);
  writeFileSync(join(repo, 'a.txt'), 'a');
  execFileSync('git', ['-C', repo, 'add', '-A']);
  execFileSync('git', ['-C', repo, 'commit', '-q', '-m', 'init']);

  const port = await freePort();
  const srv = await startServer(baseEnv({ PORT: String(port) }));
  try {
    check(srv.ready, 'server starts');
    if (!srv.ready) return;
    const payloads = [`HEAD;touch ${sentinel}`, `$(touch ${sentinel})`, `\`touch ${sentinel}\``, `abcdef0|touch ${sentinel}`];
    for (const p of payloads) {
      const res = await fetch(`http://127.0.0.1:${port}/api/chat/revert/${encodeURIComponent(p)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectRoot: repo })
      });
      check(res.status === 400, `payload rejected with 400: ${p.slice(0, 24)}...`);
    }
    check(!existsSync(sentinel), 'sentinel file was never created');
  } finally {
    await stop(srv.child);
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  console.log('[SECURITY] Running security regression tests...');
  await testDefaultBind();
  await testRefuseInsecureBind();
  await testKeyAuth();
  testRemotePeerWithoutKey();
  await testRevertInjection();
  console.log(`\n[SECURITY] ${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[SECURITY] Crashed:', err);
  process.exit(1);
});
