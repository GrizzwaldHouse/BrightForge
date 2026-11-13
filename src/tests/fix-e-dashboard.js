/**
 * fix-e-dashboard.js - Acceptance tests for workstream E (dashboard).
 *
 *   R-E1. OrchestrationPanel accepts both a bare array and an {agents: []}
 *         (or {tasks: []}) response without throwing.
 *   R-E2. The Sessions tab lists real sessions (rendered by SessionManager
 *         into #sessions-tab-list) instead of a "coming soon" placeholder.
 *
 * Isolation: no network, no browser. A minimal fake DOM and fetch are
 * installed on globalThis before the dashboard modules are imported.
 *
 * Run: node src/tests/fix-e-dashboard.js
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

// --- Fake DOM ---------------------------------------------------------------

const elements = new Map();
function el(id) {
  if (!elements.has(id)) {
    elements.set(id, { id, innerHTML: '', textContent: '', addEventListener() {}, querySelectorAll: () => [], classList: { add() {}, remove() {} } });
  }
  return elements.get(id);
}

globalThis.window = globalThis;
globalThis.document = {
  getElementById: (id) => el(id),
  querySelectorAll: () => [],
  createElement: () => {
    const node = { _t: '' };
    Object.defineProperty(node, 'textContent', { set(v) { node._t = String(v); }, get() { return node._t; } });
    Object.defineProperty(node, 'innerHTML', { get() { return node._t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } });
    return node;
  }
};

let nextBody = null;
globalThis.fetch = async () => ({ ok: true, json: async () => nextBody });

const AGENTS = [{ name: 'planner-x', type: 'pipeline', status: 'idle' }];
const TASKS = [{ task_id: 't-1', task_name: 'demo task', status: 'active' }];

async function testOrchestration() {
  console.log('\n[R-E1] OrchestrationPanel response shapes');
  await import('../../public/js/orchestration-panel.js');
  const Panel = globalThis.window.OrchestrationPanel;
  check(typeof Panel === 'function', 'OrchestrationPanel is exposed on window');

  for (const [label, body] of [['array', AGENTS], ['{agents: []}', { agents: AGENTS }]]) {
    const panel = new Panel();
    nextBody = body;
    await panel.loadAgents();
    check(Array.isArray(panel.agents) && panel.agents.length === 1, `agents normalized to array (${label})`);
    check(el('agents-list').innerHTML.includes('planner-x'), `agent rendered (${label})`);
    check(!el('agents-list').innerHTML.includes('Failed to load'), `no load error shown (${label})`);
  }

  for (const [label, body] of [['array', TASKS], ['{tasks: []}', { tasks: TASKS }]]) {
    const panel = new Panel();
    nextBody = body;
    await panel.loadTasks();
    check(Array.isArray(panel.tasks) && panel.tasks.length === 1, `tasks normalized to array (${label})`);
    check(el('task-list').innerHTML.includes('demo task'), `task rendered (${label})`);
  }

  const empty = new Panel();
  nextBody = { agents: [] };
  await empty.loadAgents();
  check(el('agents-list').innerHTML.includes('No agents'), 'empty agent list shows empty message');
}

async function testSessionsTab() {
  console.log('\n[R-E2] Sessions tab');
  const html = readFileSync(join(ROOT, 'public', 'index.html'), 'utf8');
  const panelMatch = html.match(/data-panel="sessions"[\s\S]*?<div class="tab-panel"/);
  const panelHtml = panelMatch ? panelMatch[0] : '';
  check(panelHtml.length > 0, 'sessions tab panel found in index.html');
  check(!/coming soon/i.test(panelHtml), 'sessions tab no longer says "coming soon"');
  check(panelHtml.includes('id="sessions-tab-list"'), 'sessions tab has #sessions-tab-list container');

  const { SessionManager } = await import('../../public/js/session-manager.js');
  const mgr = new SessionManager({ sessionId: null, apiGet: async () => ({ sessions: [{ id: 's-42', task: 'build the widget', createdAt: new Date().toISOString() }] }) });
  await mgr.loadSessions();
  check(el('sessions-tab-list').innerHTML.includes('build the widget'), 'Sessions tab lists the session from /api/sessions');
  check(el('session-list').innerHTML.includes('build the widget'), 'sidebar still lists the session');
}

async function main() {
  console.log('[FIX-E] Dashboard acceptance tests...');
  try {
    await testOrchestration();
    await testSessionsTab();
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  }
  console.log(`\n[FIX-E] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[FIX-E] Crashed:', err);
  process.exit(1);
});
