/**
 * clean-room-fixes.js - Regression tests for four clean-room repair fixes.
 *
 *   F1. Plan containment: DiffApplier.apply/rollback refuse plan paths that
 *       resolve outside the project root; PlanEngine.validate rejects a
 *       sibling directory that merely shares the root's name as a prefix.
 *   F2. GET /api/prototype/:id returns the prototype with its npcs, quests
 *       and interactions (the route used to call database methods that do
 *       not exist and answered 500).
 *   F3. DesignEngine.generateLayout calls llmClient.chat() with a system and
 *       a user message (it used to call a non-existent generate()).
 *   F4. A 'pipeline_failed' event for a scene/world/prototype pipeline marks
 *       the DB record 'failed' instead of leaving it 'analyzing'/'generating'.
 *
 * Isolation: temp directories only (mkdtemp, removed at the end); the
 * forge3d database singleton is pointed at a temp file before it is opened;
 * assetPipelineRunner.start is stubbed so no pipeline, model, GPU or network
 * is used; the LLM client is a fake object. Routes are mounted on a private
 * Express app on an ephemeral loopback port.
 *
 * Run: node src/tests/clean-room-fixes.js
 */

// The test header only bypasses rate limits under NODE_ENV=test (set before any request).
process.env.NODE_ENV = 'test';

import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import express from 'express';
import diffApplier from '../core/diff-applier.js';
import planEngine from '../core/plan-engine.js';
import gitCheckpointer from '../core/git-checkpointer.js';
import { DesignEngine } from '../core/design-engine.js';
import forge3dDb, { Forge3DDatabase } from '../forge3d/database.js';
import assetPipelineRunner from '../forge3d/pipeline/asset-pipeline-runner.js';
import sceneRoutes from '../api/routes/scene.js';
import worldRoutes from '../api/routes/world.js';
import prototypeRoutes from '../api/routes/prototype.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const BASE = mkdtempSync(join(tmpdir(), 'bf-clean-room-'));
// Keep git from discovering an enclosing repository above the temp dir, so
// DiffApplier's git checkpointing is a no-op and the backup path is exercised.
process.env.GIT_CEILING_DIRECTORIES = dirname(BASE);

// Point the forge3d DB singleton at a temp file before any route opens it.
const DB_DIR = join(BASE, 'db');
mkdirSync(DB_DIR, { recursive: true });
forge3dDb.dbPath = join(DB_DIR, 'forge3d-clean-room.db');

// --- F1: plan containment -------------------------------------------------

async function testPlanContainment() {
  console.log('\n[F1] Plan operations are contained to the project root');
  const base = join(BASE, 'f1');
  const root = join(base, 'proj');
  mkdirSync(join(root, 'sub'), { recursive: true });

  check(gitCheckpointer.isGitRepo(root) === false, 'temp project root is not seen as a git repo (no checkpoint side effects)');

  const plan = {
    id: 'clean-room-f1',
    task: 'containment',
    operations: [
      { type: 'create', filePath: '../escape.txt', modified: 'ESCAPED' },
      { type: 'create', filePath: 'sub/../../escape2.txt', modified: 'ESCAPED' },
      { type: 'create', filePath: '/abs-inside.txt', modified: 'ABS' },
      { type: 'create', filePath: 'ok.txt', modified: 'OK' }
    ]
  };
  const results = await diffApplier.apply(plan, root);

  check(!existsSync(join(base, 'escape.txt')), '"../escape.txt" is not written outside the root');
  check(!existsSync(join(base, 'escape2.txt')), '"sub/../../escape2.txt" is not written outside the root');
  check(results.failed === 2, `both escaping operations are counted as failed (failed=${results.failed})`);
  check(results.errors.filter((e) => e.includes('outside the project root')).length === 2, 'errors name the refused paths as outside the project root');
  check(existsSync(join(root, 'ok.txt')) && readFileSync(join(root, 'ok.txt'), 'utf8') === 'OK', '"ok.txt" is created inside the root');
  check(existsSync(join(root, 'abs-inside.txt')), '"/abs-inside.txt" is joined under the root');
  check(results.applied === 2, `the two contained operations are applied (applied=${results.applied})`);
  check(plan.status === 'failed', 'plan is marked failed when an operation is refused');

  console.log('\n[F1] PlanEngine.validate rejects a sibling sharing the root prefix');
  const vBase = join(BASE, 'f1v');
  mkdirSync(join(vBase, 'p1'), { recursive: true });
  mkdirSync(join(vBase, 'p10'), { recursive: true });
  const v = planEngine.validate({ operations: [{ type: 'create', filePath: '../p10/a.txt' }] }, join(vBase, 'p1'));
  check(v.valid === false && v.errors.some((e) => e.includes('escape project root')), '"../p10/a.txt" from root ".../p1" is reported as escaping');
  const vOk = planEngine.validate({ operations: [{ type: 'create', filePath: 'inner/a.txt' }] }, join(vBase, 'p1'));
  check(vOk.valid === true, 'a normal relative path inside the root still validates');

  console.log('\n[F1] Rollback does not touch paths outside the root');
  const rBase = join(BASE, 'f1r');
  const rRoot = join(rBase, 'proj');
  mkdirSync(rRoot, { recursive: true });
  writeFileSync(join(rBase, 'victim.txt'), 'keep', 'utf8');
  writeFileSync(join(rBase, 'victim2.txt'), 'original', 'utf8');
  writeFileSync(join(rBase, 'victim2.txt.brightforge-backup'), 'attacker', 'utf8');
  const rPlan = {
    id: 'clean-room-f1-rollback',
    operations: [
      { type: 'create', filePath: '../victim.txt', modified: '' },
      { type: 'modify', filePath: '../victim2.txt', modified: '' }
    ]
  };
  const r = await diffApplier.rollback(rPlan, rRoot);
  check(existsSync(join(rBase, 'victim.txt')) && readFileSync(join(rBase, 'victim.txt'), 'utf8') === 'keep', 'rollback of create "../victim.txt" leaves the outside file in place');
  check(readFileSync(join(rBase, 'victim2.txt'), 'utf8') === 'original', 'rollback of modify "../victim2.txt" does not overwrite the outside file from a backup');
  check(existsSync(join(rBase, 'victim2.txt.brightforge-backup')), 'the outside backup file is not consumed');
  check(r.restored === 0 && r.errors.filter((e) => e.includes('outside the project root')).length === 2, `both rollback operations are refused (restored=${r.restored})`);
}

// --- F3: design engine uses chat() ---------------------------------------

async function testDesignChat() {
  console.log('\n[F3] DesignEngine.generateLayout uses llmClient.chat()');
  const engine = new DesignEngine();
  const calls = [];
  engine.llmClient = {
    chat: async (messages, options) => {
      calls.push({ messages, options });
      return { content: '```html\n<html>ok</html>\n```', cost: 0 };
    }
  };

  let result = null;
  let error = null;
  try {
    result = await engine.generateLayout('a test landing page', [{ role: 'hero', path: 'hero.png', alt: 'hero' }], 'style guide text');
  } catch (err) {
    error = err;
  }
  check(error === null, `generateLayout does not throw${error ? ` (${error.message})` : ''}`);
  check(result?.html === '<html>ok</html>', 'HTML is extracted from the fenced code block');
  check(result?.cost === 0, 'cost is taken from the chat response');
  check(calls.length === 1, `chat() is called once (calls=${calls.length})`);
  const msgs = calls[0]?.messages || [];
  check(msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user', 'chat() receives a system message then a user message');
  check(typeof msgs[0]?.content === 'string' && msgs[0].content.length > 0, 'system message carries the design system prompt');
  check(typeof msgs[1]?.content === 'string' && msgs[1].content.includes('a test landing page') && msgs[1].content.includes('hero.png'), 'user message carries the brief and image paths');
  check(calls[0]?.options?.task === 'code_generation', 'chat() is called with a task option');
}

// --- HTTP helpers for F2 / F4 --------------------------------------------

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/scene', sceneRoutes);
  app.use('/api/world', worldRoutes);
  app.use('/api/prototype', prototypeRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

async function request(server, method, path, body) {
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    // The test header (from loopback) bypasses the 2/min forge3d rate limit
    headers: { 'Content-Type': 'application/json', 'x-brightforge-test': 'true' },
    body: body ? JSON.stringify(body) : undefined
  });
  let json = null;
  try { json = await res.json(); } catch (_e) { /* non-JSON body */ }
  return { status: res.status, json };
}

// --- F2: prototype status route ------------------------------------------

async function testPrototypeStatus(server) {
  console.log('\n[F2] GET /api/prototype/:id returns npcs, quests and interactions');

  // Static check: every forge3dDb.<method>() the route calls exists on the class
  const src = readFileSync(join(ROOT, 'src', 'api', 'routes', 'prototype.js'), 'utf8');
  const called = [...new Set([...src.matchAll(/forge3dDb\.([A-Za-z_]\w*)\s*\(/g)].map((m) => m[1]))];
  const missing = called.filter((name) => typeof Forge3DDatabase.prototype[name] !== 'function');
  check(called.length > 0 && missing.length === 0, `every forge3dDb method called in prototype.js exists${missing.length ? ` (missing: ${missing.join(', ')})` : ''}`);

  forge3dDb.open();
  const proto = forge3dDb.createPrototype({ name: 'Clean room proto', prompt: 'a small village', genre: 'rpg' });
  const npc = forge3dDb.createNPC({ prototypeId: proto.id, name: 'Elder', role: 'quest_giver', behavior: 'idle' });
  forge3dDb.createQuest({ prototypeId: proto.id, title: 'Fetch water', objectives: [{ desc: 'Fill bucket', type: 'collect' }], npcGiverId: npc.id });
  forge3dDb.createInteraction({ prototypeId: proto.id, targetNode: 'well-1', type: 'pickup_item', parameters: { item: 'bucket' } });

  const res = await request(server, 'GET', `/api/prototype/${proto.id}`);
  check(res.status === 200, `status 200 (got ${res.status}${res.json?.error ? `: ${res.json.error}` : ''})`);
  check(res.json?.prototype?.id === proto.id, 'body contains the prototype');
  check(Array.isArray(res.json?.npcs) && res.json.npcs.length === 1 && res.json.npcs[0].name === 'Elder', 'npcs array holds the NPC');
  check(Array.isArray(res.json?.quests) && res.json.quests.length === 1 && res.json.quests[0].title === 'Fetch water', 'quests array holds the quest');
  check(Array.isArray(res.json?.interactions) && res.json.interactions.length === 1 && res.json.interactions[0].target_node === 'well-1', 'interactions array holds the interaction');

  const missingRes = await request(server, 'GET', '/api/prototype/does-not-exist');
  check(missingRes.status === 404, `unknown prototype id answers 404 (got ${missingRes.status})`);
}

// --- F4: failed pipelines mark the record failed -------------------------

async function testFailedPipelines(server) {
  console.log('\n[F4] pipeline_failed marks scene/world/prototype records failed');

  const originalStart = assetPipelineRunner.start;
  let counter = 0;
  const started = [];
  assetPipelineRunner.start = (name, params) => {
    counter++;
    const id = `clean-room-pl-${counter}`;
    started.push({ name, params, id });
    return id;
  };

  const kinds = [
    { kind: 'scene', path: '/api/scene/generate', idKey: 'sceneId', get: (id) => forge3dDb.getScene(id), running: 'analyzing' },
    { kind: 'world', path: '/api/world/generate', idKey: 'worldId', get: (id) => forge3dDb.getWorld(id), running: 'generating' },
    { kind: 'prototype', path: '/api/prototype/generate', idKey: 'prototypeId', get: (id) => forge3dDb.getPrototype(id), running: 'generating' }
  ];

  try {
    for (const k of kinds) {
      const baseFailed = assetPipelineRunner.listenerCount('pipeline_failed');
      const baseComplete = assetPipelineRunner.listenerCount('pipeline_complete');

      // Failure path
      const res = await request(server, 'POST', k.path, { prompt: `clean room ${k.kind} failure` });
      const recordId = res.json?.[k.idKey];
      const pipelineId = res.json?.pipelineId;
      check(res.status === 202 && recordId && pipelineId, `${k.kind}: generate answers 202 with ids (got ${res.status})`);
      check(k.get(recordId)?.status === k.running, `${k.kind}: record starts as '${k.running}'`);

      assetPipelineRunner.emit('pipeline_failed', { pipelineId: 'some-other-pipeline', failedStage: 'x', error: 'unrelated' });
      check(k.get(recordId)?.status === k.running, `${k.kind}: a failure for another pipeline does not change the record`);

      assetPipelineRunner.emit('pipeline_failed', { pipelineId, failedStage: 'analyze', stageIndex: 0, error: `${k.kind} stage exploded` });
      const rec = k.get(recordId);
      check(rec?.status === 'failed', `${k.kind}: record status becomes 'failed' (got '${rec?.status}')`);
      check(rec?.error === `${k.kind} stage exploded`, `${k.kind}: the pipeline error is stored on the record`);
      check(assetPipelineRunner.listenerCount('pipeline_failed') === baseFailed && assetPipelineRunner.listenerCount('pipeline_complete') === baseComplete, `${k.kind}: route listeners are removed after the pipeline ends`);

      // Success path must not be marked failed
      const ok = await request(server, 'POST', k.path, { prompt: `clean room ${k.kind} success` });
      const okId = ok.json?.[k.idKey];
      assetPipelineRunner.emit('pipeline_complete', { pipelineId: ok.json?.pipelineId, stagesCompleted: 3, context: {} });
      check(ok.status === 202 && k.get(okId)?.status !== 'failed', `${k.kind}: pipeline_complete does not mark the record failed`);
      check(assetPipelineRunner.listenerCount('pipeline_failed') === baseFailed, `${k.kind}: listeners are removed after pipeline_complete`);
    }

    // Cancellation is reported as pipeline_failed with a reason and no error
    const c = await request(server, 'POST', '/api/world/generate', { prompt: 'clean room world cancel' });
    assetPipelineRunner.emit('pipeline_failed', { pipelineId: c.json?.pipelineId, reason: 'cancelled', stageIndex: 1 });
    const cw = forge3dDb.getWorld(c.json?.worldId);
    check(cw?.status === 'failed' && cw?.error === 'cancelled', `world: a cancelled pipeline is recorded as failed with reason (got '${cw?.status}', '${cw?.error}')`);

    check(started.some((s) => s.name === 'generate_scene') && started.some((s) => s.name === 'generate_world') && started.some((s) => s.name === 'generate_prototype'), 'routes start the expected pipelines (stubbed)');
  } finally {
    assetPipelineRunner.start = originalStart;
  }
}

async function main() {
  console.log('[CLEAN-ROOM] Regression tests for clean-room fixes...');
  let server = null;
  try {
    await testPlanContainment();
    await testDesignChat();
    server = await startApp();
    await testPrototypeStatus(server);
    await testFailedPipelines(server);
    check(forge3dDb.dbPath.startsWith(BASE), 'forge3d DB used the temp path (repository data untouched)');
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  } finally {
    if (server) await closeServer(server);
    try { forge3dDb.close(); } catch (_e) { /* best-effort */ }
    rmSync(BASE, { recursive: true, force: true });
  }

  console.log(`\n[CLEAN-ROOM] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[CLEAN-ROOM] Crashed:', err);
  process.exit(1);
});
