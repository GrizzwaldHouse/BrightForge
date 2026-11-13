/**
 * fix-c-core.js - Acceptance tests for workstream C (R-C1, R-C2, R-C3).
 *
 *   R-C1. Design generation reports partial failure: warnings + imagesFailed
 *         when some images fail, a 502 with a clear error when all fail.
 *   R-C2. Design code generation routes through the 'code_generation' task,
 *         which must exist in config/llm-providers.yaml.
 *   R-C3. PlanEngine.validate and DiffApplier agree on absolute plan paths:
 *         both treat "/x.txt" as relative to the project root; "../x" is
 *         rejected by both.
 *
 * Isolation: temp directories only (removed at the end); fake image and LLM
 * clients; no network. The design router is mounted on a private Express app
 * on an ephemeral loopback port.
 *
 * Run: node src/tests/fix-c-core.js
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import express from 'express';
import { parse } from 'yaml';
import diffApplier from '../core/diff-applier.js';
import planEngine from '../core/plan-engine.js';
import { designEngine } from '../core/design-engine.js';
import designRoutes from '../api/routes/design.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const BASE = mkdtempSync(join(tmpdir(), 'bf-fix-c-'));
// Keep git from discovering an enclosing repository above the temp dir.
process.env.GIT_CEILING_DIRECTORIES = dirname(BASE);

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

function fakeLlm(calls) {
  return {
    chat: async (messages, options) => {
      calls.push({ messages, options });
      return { content: '```html\n<html>ok</html>\n```', cost: 0 };
    }
  };
}

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/design', designRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function post(server, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-brightforge-test': 'true' },
    body: JSON.stringify(body)
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON body */ }
  return { status: res.status, json };
}

// --- R-C1 ------------------------------------------------------------------

async function testPartialFailure() {
  console.log('\n[R-C1] Design generation reports image failures');
  const originalImage = designEngine.imageClient;
  const originalLlm = designEngine.llmClient;
  const calls = [];
  designEngine.llmClient = fakeLlm(calls);
  const server = await startApp();
  try {
    // Engine level: all fail -> still produces the layout (R2-I1 amends R-C1)
    designEngine.imageClient = fakeImageClient(0);
    let err = null;
    let allFailed = null;
    try { allFailed = await designEngine.generateDesign('a landing page', { imageCount: 2 }); } catch (e) { err = e; }
    check(err === null && allFailed?.imagesFailed === 2 && allFailed?.warnings?.length > 0, `engine returns a text-only design with warnings when all images fail${err ? ` (${err.message})` : ''}`);

    // Engine level: some fail -> warnings + imagesFailed
    designEngine.imageClient = fakeImageClient(1);
    let design = null;
    err = null;
    try { design = await designEngine.generateDesign('a landing page', { imageCount: 3 }); } catch (e) { err = e; }
    check(err === null, `engine does not throw on partial failure${err ? ` (${err.message})` : ''}`);
    check(design?.images?.length === 1 && design?.imagesFailed === 2, `engine reports imagesFailed=2 (got ${design?.imagesFailed})`);
    check(Array.isArray(design?.warnings) && design.warnings.length > 0, 'engine reports warnings');

    // Route level: all fail -> 200 with warnings (R2-I1 amends R-C1)
    designEngine.imageClient = fakeImageClient(0);
    let r = await post(server, '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 2 } });
    check(r.status === 200, `route answers 200 when all images fail (got ${r.status})`);
    check(r.json?.success === true && r.json?.imagesFailed === 2 && r.json?.warnings?.length > 0, 'route body carries imagesFailed and warnings');

    // Route level: partial -> 200 + warnings
    designEngine.imageClient = fakeImageClient(1);
    r = await post(server, '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 3 } });
    check(r.status === 200 && r.json?.success === true, `route answers 200 on partial failure (got ${r.status})`);
    check(r.json?.imagesFailed === 2 && Array.isArray(r.json?.warnings) && r.json.warnings.length > 0, 'route response includes imagesFailed and warnings');

    // Route level: layout (LLM) failure -> 502 (R2-I1: the only 502)
    designEngine.imageClient = fakeImageClient(5);
    designEngine.llmClient = { chat: async () => { throw new Error('fake llm down'); } };
    r = await post(server, '/api/design/generate', { prompt: 'a landing page', options: { imageCount: 1 } });
    check(r.status === 502 && r.json?.success !== true, `route answers 502 on layout failure (got ${r.status})`);
  } finally {
    designEngine.imageClient = originalImage;
    designEngine.llmClient = originalLlm;
    await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  }
}

// --- R-C2 ------------------------------------------------------------------

async function testTaskRouting() {
  console.log('\n[R-C2] Design layout uses an existing task');
  const originalLlm = designEngine.llmClient;
  const calls = [];
  designEngine.llmClient = fakeLlm(calls);
  try {
    await designEngine.generateLayout('brief', [{ role: 'hero', path: 'h.png', alt: 'h' }], 'style');
    const task = calls[0]?.options?.task;
    check(task === 'code_generation', `chat() receives task 'code_generation' (got '${task}')`);
    const cfg = parse(readFileSync(join(ROOT, 'config', 'llm-providers.yaml'), 'utf8'));
    check(Boolean(cfg.task_routing && cfg.task_routing[task]), `task '${task}' exists in config/llm-providers.yaml task_routing`);
  } finally {
    designEngine.llmClient = originalLlm;
  }
}

// --- R-C3 ------------------------------------------------------------------

async function testAbsolutePaths() {
  console.log('\n[R-C3] PlanEngine.validate and DiffApplier agree on absolute paths');
  const root = join(BASE, 'c3', 'proj');
  mkdirSync(root, { recursive: true });

  const absPlan = { operations: [{ type: 'create', filePath: '/abs.txt', modified: 'ABS' }] };
  const v = planEngine.validate(absPlan, root);
  check(v.valid === true, `validate accepts "/abs.txt" (errors: ${JSON.stringify(v.errors)})`);

  await diffApplier.apply({ id: 'fix-c-abs', task: 'abs', operations: absPlan.operations }, root);
  check(existsSync(join(root, 'abs.txt')) && readFileSync(join(root, 'abs.txt'), 'utf8') === 'ABS', 'apply writes "/abs.txt" inside the root');

  const upPlan = { operations: [{ type: 'create', filePath: '../x.txt', modified: 'X' }] };
  const v2 = planEngine.validate(upPlan, root);
  check(v2.valid === false && v2.errors.some((e) => /escape/i.test(e)), 'validate rejects "../x.txt"');
  await diffApplier.apply({ id: 'fix-c-up', task: 'up', operations: upPlan.operations }, root);
  check(!existsSync(join(BASE, 'c3', 'x.txt')), 'apply does not write "../x.txt" outside the root');
}

async function main() {
  console.log('[FIX-C] Acceptance tests for workstream C...');
  try {
    await testPartialFailure();
    await testTaskRouting();
    await testAbsolutePaths();
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  } finally {
    rmSync(BASE, { recursive: true, force: true });
  }
  console.log(`\n[FIX-C] ${passed} passed, ${failed} failed`);
  // Exit explicitly: singleton timers in imported modules keep the loop alive.
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FIX-C] Crashed:', err);
  process.exit(1);
});
