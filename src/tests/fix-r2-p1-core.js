/**
 * fix-r2-p1-core.js - Acceptance tests for round-2 requirements R2-F1, R2-F2,
 * R2-G1 and R2-I1.
 *
 *   R2-F1. No code path reads a file outside the project root because of a
 *          plan path (MasterAgent, WebSession); escaping operations are
 *          marked refused and carry no original/diff content.
 *   R2-F2. A plan whose operations were all refused ends 'refused', with the
 *          reasons in errors and no rollback entry; resolveInsideRoot accepts
 *          paths under a filesystem root.
 *   R2-G1. Agent pipeline runs are isolated; a cancelled run never writes
 *          into a newer run and stays 'cancelled'.
 *   R2-I1. Design generation still produces the layout when every image
 *          fails (200 + imagesRequested/imagesFailed/warnings); a layout
 *          failure is the only 502.
 *
 * Isolation: temp directories only (removed at the end); stub LLM, image and
 * agent objects; no network. Routers are mounted on private Express apps on
 * ephemeral loopback ports.
 *
 * Run: node src/tests/fix-r2-p1-core.js
 */

process.env.NODE_ENV = 'test';

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, sep } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import diffApplier, { resolveInsideRoot } from '../core/diff-applier.js';
import { MasterAgent } from '../agents/master-agent.js';
import { WebSession } from '../api/web-session.js';
import { designEngine } from '../core/design-engine.js';
import designRoutes from '../api/routes/design.js';
import agentRoutes from '../api/routes/agents.js';
import plannerAgent from '../agents/planner-agent.js';
import builderAgent from '../agents/builder-agent.js';
import testerAgent from '../agents/tester-agent.js';
import reviewerAgent from '../agents/reviewer-agent.js';

const SECRET = 'TOP-SECRET-BYTES-9f3a';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const BASE = mkdtempSync(join(tmpdir(), 'bf-fix-r2-p1-'));
// Keep git from discovering an enclosing repository above the temp dir.
process.env.GIT_CEILING_DIRECTORIES = dirname(BASE);

function startApp(mount, router) {
  const app = express();
  app.use(express.json());
  app.use(mount, router);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function call(server, method, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-brightforge-test': 'true' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON body */ }
  return { status: res.status, json };
}

function closeServer(server) {
  return new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(10);
  }
  return false;
}

function makeProject(name) {
  const base = join(BASE, name);
  const root = join(base, 'proj');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(base, 'secret.txt'), SECRET, 'utf8');
  writeFileSync(join(root, 'inside.txt'), 'inside content\n', 'utf8');
  return { base, root };
}

// --- R2-F1 ------------------------------------------------------------------

async function testNoLeak() {
  console.log('\n[R2-F1] Escaping plan paths are never read');
  const { base, root } = makeProject('f1');

  const llmText = [
    '## SUMMARY',
    'escape attempt',
    '',
    '## FILE: ../secret.txt',
    '## ACTION: modify',
    '## DESCRIPTION: read the secret',
    '```',
    'replaced',
    '```',
    '',
    '## FILE: ../secret.txt',
    '## ACTION: delete',
    '## DESCRIPTION: delete the secret',
    '```',
    'x',
    '```',
    '',
    '## FILE: inside.txt',
    '## ACTION: modify',
    '## DESCRIPTION: legit change',
    '```',
    'inside changed',
    '```',
    ''
  ].join('\n');

  const master = new MasterAgent({ llmClient: { getUsageSummary: () => ({ budget_remaining: 1 }) } });
  master.localAgent.generatePlan = async () => ({ content: llmText, provider: 'fake', model: 'fake', cost: 0 });
  master.cloudAgent.generatePlan = master.localAgent.generatePlan;

  const plan = await master.run('fix a typo', root);
  const blob = JSON.stringify(plan);
  check(!blob.includes(SECRET), 'returned plan contains none of the secret bytes');

  const escaping = plan.operations.filter((op) => op.filePath === '../secret.txt');
  check(escaping.length === 2, 'both escaping operations are present in the plan');
  check(escaping.every((op) => op.refused === true), 'escaping operations are marked refused');
  check(escaping.every((op) => op.original === null || op.original === undefined), 'escaping operations carry no original');
  check(escaping.every((op) => !/-{3}|\+{3}|@@/.test(String(op.diff || '')) || !String(op.diff).includes(SECRET)), 'escaping operations carry no diff of the secret');

  const legit = plan.operations.find((op) => op.filePath === 'inside.txt');
  check(legit && !legit.refused && legit.original === 'inside content\n', 'in-root modify still loads its original');
  check(existsSync(join(base, 'secret.txt')) && readFileSync(join(base, 'secret.txt'), 'utf8') === SECRET, 'secret file untouched');

  // WebSession.sanitizePlan must not surface content either
  const session = new WebSession({ projectRoot: root, sessionsDir: join(base, 'sessions') });
  const sanitized = session.sanitizePlan(plan);
  check(!JSON.stringify(sanitized).includes(SECRET), 'sanitized plan contains none of the secret bytes');
  check(sanitized.operations.filter((o) => o.file === '../secret.txt').every((o) => o.refused === true), 'sanitized escaping operations are marked refused');

  check(typeof resolveInsideRoot === 'function', 'resolveInsideRoot is exported from diff-applier');
}

// --- R2-F2 ------------------------------------------------------------------

async function testRefusedStatus() {
  console.log('\n[R2-F2] All-refused plan ends refused; filesystem root accepted');
  const { base, root } = makeProject('f2');

  // Direct DiffApplier
  const plan = {
    id: 'p-refused',
    task: 'escape',
    operations: [
      { type: 'create', filePath: '../escape.txt', modified: 'ESCAPED' },
      { type: 'modify', filePath: '../secret.txt', modified: 'ESCAPED' }
    ]
  };
  const res = await diffApplier.apply(plan, root);
  check(plan.status === 'refused', `DiffApplier: all-refused plan status is refused (got ${plan.status})`);
  check(res.applied === 0 && res.errors.length === 2 && res.errors.every((e) => /outside the project root/.test(e)), 'DiffApplier: reasons are in errors');
  check(!existsSync(join(base, 'escape.txt')), 'DiffApplier: nothing written outside the root');

  // Mixed plan is not 'refused'
  const mixed = {
    id: 'p-mixed',
    task: 'mixed',
    operations: [
      { type: 'create', filePath: '../escape.txt', modified: 'ESCAPED' },
      { type: 'create', filePath: 'ok.txt', modified: 'OK' }
    ]
  };
  await diffApplier.apply(mixed, root);
  check(mixed.status !== 'refused' && mixed.status !== 'applied', `mixed plan is neither refused nor applied (got ${mixed.status})`);

  // Through WebSession.approvePlan
  const sessionsDir = join(base, 'sessions');
  const session = new WebSession({ projectRoot: root, sessionsDir });
  session.pendingPlan = {
    id: 'web-refused',
    task: 'escape',
    cost: 0,
    operations: [{ type: 'create', filePath: '../escape2.txt', modified: 'ESCAPED' }]
  };
  const out = await session.approvePlan('web-refused');
  check(out.status === 'refused', `approvePlan reports refused (got ${out.status})`);
  check(Array.isArray(out.errors) && out.errors.length > 0 && /outside the project root/.test(out.errors[0]), 'approvePlan carries the refusal reasons in errors');
  check(!existsSync(join(base, 'escape2.txt')), 'nothing written outside the root via approvePlan');
  const logged = existsSync(sessionsDir) ? readdirSync(sessionsDir).filter((f) => f.endsWith('.json')) : [];
  check(logged.length === 0, 'no session/rollback entry is recorded for a refused plan');
  const rb = await session.rollbackLast();
  check(rb.status === 'error', `rollbackLast has nothing to roll back (got ${rb.status})`);

  // resolveInsideRoot at a filesystem root
  const fsRoot = sep;
  check(resolveInsideRoot(fsRoot, 'a.txt') === `${fsRoot}a.txt`, 'resolveInsideRoot: root "/" with a.txt is allowed');
  check(resolveInsideRoot(fsRoot, 'sub/b.txt') !== null, 'resolveInsideRoot: root "/" with nested path is allowed');
  check(resolveInsideRoot(root, '../x') === null, 'resolveInsideRoot: ../x still rejected under a normal root');
  check(resolveInsideRoot(root, 'a.txt') === join(root, 'a.txt'), 'resolveInsideRoot: normal in-root path allowed');
}

// --- R2-G1 ------------------------------------------------------------------

function deferred() {
  let resolve; let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function planOf(tag) {
  return {
    subtasks: [
      { id: `${tag}-1`, agent: 'Planner', title: tag },
      { id: `${tag}-2`, agent: 'Builder', title: tag },
      { id: `${tag}-3`, agent: 'Tester', title: tag },
      { id: `${tag}-4`, agent: 'Reviewer', title: tag }
    ]
  };
}

async function testPipelineIsolation() {
  console.log('\n[R2-G1] Pipeline runs are isolated');
  const saved = {
    plan: plannerAgent.plan, build: builderAgent.build, run: testerAgent.runTests, review: reviewerAgent.review
  };
  const server = await startApp('/api/agents', agentRoutes());
  try {
    // Scenario A: first run's planner resolves LATE, after cancel + second run
    const planGate1 = deferred();
    const buildGate2 = deferred();
    let planCalls = 0;
    plannerAgent.plan = () => {
      planCalls++;
      return planCalls === 1 ? planGate1.promise : Promise.resolve(planOf('run2'));
    };
    builderAgent.build = () => buildGate2.promise;
    testerAgent.runTests = async () => ({ failed: [], passed: ['t'], summary: 'ok' });
    reviewerAgent.review = async () => ({ verdict: 'approved', findings: [], summary: 'ok' });

    let r = await call(server, 'POST', '/api/agents/pipeline/start', { prompt: 'one' });
    check(r.status === 202, 'run 1 starts');
    r = await call(server, 'POST', '/api/agents/pipeline/cancel');
    check(r.status === 200, 'run 1 cancelled');
    r = await call(server, 'POST', '/api/agents/pipeline/start', { prompt: 'two' });
    check(r.status === 202, 'run 2 starts after the cancel');
    check(await waitFor(async () => (await call(server, 'GET', '/api/agents/pipeline/status')).json.subtasks.some((s) => s.id === 'run2-1')), 'run 2 has its subtasks');

    const before = (await call(server, 'GET', '/api/agents/pipeline/status')).json;
    planGate1.resolve(planOf('run1'));
    await sleep(100);
    const after = (await call(server, 'GET', '/api/agents/pipeline/status')).json;
    check(after.subtasks.every((s) => s.id.startsWith('run2-')), 'late completion of run 1 did not replace run 2 subtasks');
    check(after.status === 'running' && before.status === 'running', `run 2 is still running (got ${after.status})`);
    check(JSON.stringify(after.subtasks) === JSON.stringify(before.subtasks), 'run 2 subtask statuses unchanged by run 1');

    // finish run 2 normally
    buildGate2.resolve({ artifacts: [] });
    check(await waitFor(async () => (await call(server, 'GET', '/api/agents/pipeline/status')).json.status === 'completed'), 'run 2 completes');

    // Scenario B: a cancelled run whose stage then throws stays cancelled
    const buildGate3 = deferred();
    plannerAgent.plan = async () => planOf('run3');
    builderAgent.build = () => buildGate3.promise;
    r = await call(server, 'POST', '/api/agents/pipeline/start', { prompt: 'three' });
    check(r.status === 202, 'run 3 starts');
    check(await waitFor(async () => (await call(server, 'GET', '/api/agents/pipeline/status')).json.subtasks.length > 0), 'run 3 reaches the builder');
    await call(server, 'POST', '/api/agents/pipeline/cancel');
    buildGate3.reject(new Error('builder blew up after cancel'));
    await sleep(100);
    const cancelled = (await call(server, 'GET', '/api/agents/pipeline/status')).json;
    check(cancelled.status === 'cancelled', `cancelled run stays cancelled (got ${cancelled.status})`);
    check(!cancelled.error, 'cancelled run carries no failure error');
  } finally {
    plannerAgent.plan = saved.plan;
    builderAgent.build = saved.build;
    testerAgent.runTests = saved.run;
    reviewerAgent.review = saved.review;
    await closeServer(server);
  }
}

// --- R2-I1 ------------------------------------------------------------------

function fakeImageClient(failAfter) {
  let n = 0;
  return {
    generate: async () => {
      n++;
      if (n > failAfter) throw new Error('fake image provider down');
      return { path: `img${n}.png`, provider: 'fake', cost: 0 };
    }
  };
}

async function testDesignOffline() {
  console.log('\n[R2-I1] Text-only design when every image fails');
  const originalImage = designEngine.imageClient;
  const originalLlm = designEngine.llmClient;
  designEngine.llmClient = { chat: async () => ({ content: '```html\n<html><body>layout-ok</body></html>\n```', cost: 0 }) };
  const server = await startApp('/api/design', designRoutes);
  try {
    designEngine.imageClient = fakeImageClient(0);
    let design = null;
    let err = null;
    try { design = await designEngine.generateDesign('a landing page', { imageCount: 2 }); } catch (e) { err = e; }
    check(err === null, `engine does not throw when all images fail${err ? ` (${err.message})` : ''}`);
    check(typeof design?.html === 'string' && design.html.includes('layout-ok'), 'engine still returns the layout html');
    check(design?.imagesRequested === 2 && design?.imagesFailed === 2, `engine reports imagesRequested=2 imagesFailed=2 (got ${design?.imagesRequested}/${design?.imagesFailed})`);
    check(Array.isArray(design?.warnings) && design.warnings.length > 0, 'engine reports warnings');

    let r = await call(server, 'POST', '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 2 } });
    check(r.status === 200 && r.json?.success === true, `route answers 200 when all images fail (got ${r.status})`);
    check(r.json?.imagesRequested === 2 && r.json?.imagesFailed === 2, 'route reports imagesRequested and imagesFailed');
    check(Array.isArray(r.json?.warnings) && r.json.warnings.length > 0, 'route success carries warnings');
    check(r.json?.preview?.htmlLength > 0, 'route preview has html');

    // partial failure behaves the same
    designEngine.imageClient = fakeImageClient(1);
    r = await call(server, 'POST', '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 3 } });
    check(r.status === 200 && r.json?.imagesRequested === 3 && r.json?.imagesFailed === 2 && r.json.warnings.length > 0, 'partial failure: 200 with counts and warnings');

    // no failures: no warnings
    designEngine.imageClient = fakeImageClient(9);
    r = await call(server, 'POST', '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 2 } });
    check(r.status === 200 && r.json?.imagesFailed === 0 && r.json.warnings.length === 0, 'no failure: no warnings');

    // layout failure is the 5xx (502)
    designEngine.imageClient = fakeImageClient(0);
    designEngine.llmClient = { chat: async () => { throw new Error('fake llm down'); } };
    r = await call(server, 'POST', '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 1 } });
    check(r.status === 502 && r.json?.success !== true, `layout failure answers 502 (got ${r.status})`);
  } finally {
    designEngine.imageClient = originalImage;
    designEngine.llmClient = originalLlm;
    await closeServer(server);
  }
}

async function main() {
  console.log('[FIX-R2-P1-CORE] Round-2 acceptance tests...');
  try {
    await testNoLeak();
    await testRefusedStatus();
    await testPipelineIsolation();
    await testDesignOffline();
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  }
  try { rmSync(BASE, { recursive: true, force: true }); } catch (_e) { /* best effort */ }
  console.log(`\n[FIX-R2-P1-CORE] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
  // rate-limit stores / sockets hold timers; exit explicitly
  setTimeout(() => process.exit(process.exitCode), 50);
}

main().catch((err) => {
  console.error('[FIX-R2-P1-CORE] Crashed:', err);
  process.exit(1);
});
