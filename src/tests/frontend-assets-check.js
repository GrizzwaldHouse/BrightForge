/**
 * frontend-assets-check.js - Deterministic checks for dashboard assets.
 *
 *   1. index.html loads no remote <script src> (no CDN, no @latest).
 *   2. Every import-map entry and vendored script is served by the real
 *      server with HTTP 200 and a JavaScript content type, including the
 *      OrbitControls / GLTFLoader modules the viewer imports.
 *   3. The served three.js version equals the version pinned in
 *      package.json and package-lock.json.
 *
 * Run: node src/tests/frontend-assets-check.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { spawn } from 'child_process';
import { createServer as createNetServer } from 'net';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
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
    const timer = setTimeout(() => resolve({ child, ready: false }), 60000);
    const onData = (d) => { out += d; if (out.includes('Listening on')) { clearTimeout(timer); resolve({ child, ready: true }); } };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', () => { clearTimeout(timer); resolve({ child, ready: false }); });
  });
}

async function main() {
  console.log('[FRONTEND-ASSETS] Running checks...');
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');

  console.log('\n[1] No remote scripts in index.html');
  const remote = [...html.matchAll(/<script[^>]*\bsrc="(https?:)?\/\/[^"]*"/g)].map((m) => m[0]);
  check(remote.length === 0, `no remote <script src> (${remote.length ? remote.join(' ') : 'none'})`);
  check(!/@latest/.test(html), 'no @latest references');

  console.log('\n[2] Import map and vendored scripts are served');
  const mapMatch = html.match(/<script type="importmap">([\s\S]*?)<\/script>/);
  check(Boolean(mapMatch), 'index.html declares an import map');
  const imports = mapMatch ? JSON.parse(mapMatch[1]).imports : {};
  const urls = new Set();
  for (const [key, target] of Object.entries(imports)) {
    if (key.endsWith('/')) {
      urls.add(`${target}controls/OrbitControls.js`);
      urls.add(`${target}loaders/GLTFLoader.js`);
      urls.add(`${target}utils/BufferGeometryUtils.js`);
    } else {
      urls.add(target);
    }
  }
  urls.add('/vendor/three/build/three.core.js');
  for (const m of html.matchAll(/<script[^>]*\bsrc="(\/vendor\/[^"]+)"/g)) urls.add(m[1]);

  const port = await freePort();
  const srv = await startServer(port);
  try {
    check(srv.ready, 'server started');
    if (srv.ready) {
      for (const url of urls) {
        const res = await fetch(`http://127.0.0.1:${port}${url}`);
        const type = res.headers.get('content-type') || '';
        check(res.status === 200 && /javascript/.test(type), `${url} -> ${res.status} ${type.split(';')[0]}`);
      }
      const missing = await fetch(`http://127.0.0.1:${port}/vendor/three/build/does-not-exist.js`);
      check(missing.status === 404, 'unknown vendor file -> 404 (no SPA fallback)');
      const pkgJson = await fetch(`http://127.0.0.1:${port}/vendor/three/package.json`);
      const pkgBody = await pkgJson.text();
      check(pkgJson.status === 404 && !pkgBody.includes('"name"'), `package directory itself is not exposed (${pkgJson.status})`);

      console.log('\n[3] Served version equals pinned version');
      const served = await (await fetch(`http://127.0.0.1:${port}/vendor/three/build/three.core.js`)).text();
      const rev = served.match(/REVISION\s*=\s*'(\d+)'/)?.[1];
      const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
      const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
      const declared = pkg.dependencies?.three;
      const locked = lock.packages?.['node_modules/three']?.version;
      check(/^\d+\.\d+\.\d+$/.test(declared || ''), `three is pinned exactly in package.json (${declared})`);
      check(declared === locked, `package.json (${declared}) matches package-lock.json (${locked})`);
      check(rev && locked && locked.split('.')[1] === rev, `served REVISION ${rev} matches locked ${locked}`);
    }
  } finally {
    srv.child.kill('SIGTERM');
  }

  console.log(`\n[FRONTEND-ASSETS] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FRONTEND-ASSETS] Crashed:', err);
  process.exit(1);
});
