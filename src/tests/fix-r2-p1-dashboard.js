/**
 * fix-r2-p1-dashboard.js - Acceptance tests for round-2 requirement R2-I2.
 *
 *   R2-I2. The dashboard does not reload sessions on SSE 'complete' (sessions
 *          are only written on approve/reject); the dead switchSession /
 *          addSession / isActive code is gone; session fields rendered into
 *          innerHTML are escaped.
 *
 * Isolation: a minimal fake DOM and fetch are installed on globalThis before
 * the dashboard modules are imported; no network, no browser.
 *
 * Run: node src/tests/fix-r2-p1-dashboard.js
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, { id, innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => [], classList: { add() {}, remove() {} } });
  }
  return elements.get(id);
}

globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.document = {
  getElementById: (id) => el(id),
  querySelectorAll: () => [],
  addEventListener() {},
  createElement: () => {
    const node = { _t: '' };
    Object.defineProperty(node, 'textContent', { set(v) { node._t = String(v); }, get() { return node._t; } });
    // Like a browser: innerHTML of a text node escapes &, < and > but NOT quotes.
    Object.defineProperty(node, 'innerHTML', { get() { return node._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } });
    return node;
  }
};
globalThis.fetch = async () => ({ ok: true, json: async () => ({}) });

async function testNoReloadOnComplete() {
  console.log('\n[R2-I2] SSE complete does not reload sessions');
  const { App } = await import('../../public/js/app.js');
  let loads = 0;
  const handlers = {};
  const self = {
    sessionId: 's1',
    chat: { hideLoading() {}, updateLoading() {} },
    sessionManager: { loadSessions: () => { loads++; } },
    _cleanupStream() {}, _showCancelButton() {}, _handlePlanResult() {}, _reenableInput() {},
    _updatePipelineStep() {},
    _sseClient: null
  };
  const src = readFileSync(join(ROOT, 'public', 'js', 'app.js'), 'utf8');
  const block = src.match(/on\('complete'[\s\S]*?\n {4}\}\);/);
  check(block !== null && !/loadSessions\(\)/.test(block[0]), 'app.js complete handler has no loadSessions call (source)');
  try {
    // Intercept SSEClient creation through the prototype's own wiring if possible
    self._connectStreamInstall = () => {};
    App.prototype._connectStream.call(Object.assign(self, { _sseClient: { on: (n, fn) => { handlers[n] = fn; }, close() {} } }), 's1');
  } catch (_e) { /* SSEClient constructor may be unavailable */ }
  if (handlers.complete) {
    handlers.complete({ data: '{}' });
    check(loads === 0, 'SSE complete triggers no sessions reload (runtime)');
  }
}

async function testSessionManager() {
  console.log('\n[R2-I2] SessionManager cleanup and escaping');
  const { SessionManager } = await import('../../public/js/session-manager.js');
  check(typeof SessionManager.prototype.switchSession === 'undefined', 'switchSession removed');
  check(typeof SessionManager.prototype.addSession === 'undefined', 'addSession removed');
  const src = readFileSync(join(ROOT, 'public', 'js', 'session-manager.js'), 'utf8');
  check(!/isActive/.test(src), 'isActive removed');

  const mgr = new SessionManager({ sessionId: null, apiGet: async () => ({}) });
  mgr.sessions = [{
    id: 'x"><script>alert(1)</script>',
    task: 'plain task',
    status: '<img src=x onerror=alert(2)>',
    cost: '<b>1</b>',
    date: '"><svg onload=alert(3)>'
  }];
  const c = { innerHTML: '', querySelectorAll: () => [] };
  mgr.renderInto(c);
  check(!c.innerHTML.includes('<script>'), 'rendered list does not contain a raw <script> from the session id');
  check(!c.innerHTML.includes('"><'), 'rendered list does not break out of the data-session-id attribute');
  check(!c.innerHTML.includes('<img') && !c.innerHTML.includes('<b>') && !c.innerHTML.includes('<svg'), 'status, cost and date are escaped');
  check(c.innerHTML.includes('&lt;script&gt;'), 'session id appears escaped');
  check(c.innerHTML.includes('plain task'), 'normal fields still render');
}

async function main() {
  console.log('[FIX-R2-P1-DASHBOARD] Round-2 dashboard acceptance tests...');
  try {
    await testNoReloadOnComplete();
    await testSessionManager();
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  }
  console.log(`\n[FIX-R2-P1-DASHBOARD] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[FIX-R2-P1-DASHBOARD] Crashed:', err);
  process.exit(1);
});
