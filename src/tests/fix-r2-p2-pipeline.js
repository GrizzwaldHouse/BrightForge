/**
 * fix-r2-p2-pipeline.js - Acceptance tests for round-2 requirements R2-H1..H3.
 *
 *   R2-H1. Pipeline events carry the orchestration task id, are stored with it,
 *          and verifyIntegrity stays true on the reloaded row; an event for an
 *          unknown task id is stored without changing any hashed field.
 *   R2-H2. Terminal-status handling lives in the runner (start() hooks): a
 *          rejected _execute ends in a 'failed' record for scene, world and
 *          prototype, and 20 generate requests leave listener counts unchanged.
 *   R2-H3. Migration v12 is idempotent: a database that already has
 *          prototypes.pipeline_id but no v12 row opens without error.
 *
 * Isolation: temp directories only, no network, GPU or model.
 *
 * Run: node src/tests/fix-r2-p2-pipeline.js
 */

process.env.NODE_ENV = 'test';

import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import forge3dDb, { Forge3DDatabase } from '../forge3d/database.js';
import assetPipelineRunner, { AssetPipelineRunner } from '../forge3d/pipeline/asset-pipeline-runner.js';
import sceneRoutes from '../api/routes/scene.js';
import worldRoutes from '../api/routes/world.js';
import prototypeRoutes from '../api/routes/prototype.js';
import orchestrator from '../orchestration/index.js';
import { OrchestrationStorage } from '../orchestration/storage.js';
import { OrchestrationEventBus } from '../orchestration/event-bus.js';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const BASE = mkdtempSync(join(tmpdir(), 'bf-fix-r2-p2-'));
mkdirSync(join(BASE, 'db'), { recursive: true });
forge3dDb.dbPath = join(BASE, 'db', 'forge3d-r2-p2.db');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await sleep(10);
  }
  return !!fn();
}

function makeRunner() {
  const runner = new AssetPipelineRunner();
  runner.configLoaded = true;
  runner.pipelines = { demo: { description: 'demo', stages: [{ name: 'only', handler: 'noop' }] } };
  return runner;
}

// --- R2-H1 ---

async function testEventIntegrity() {
  console.log('\n[R2-H1] pipeline events keep a valid integrity hash');
  const storage = new OrchestrationStorage(join(BASE, 'orch.db'));
  storage.open();
  const bus = new OrchestrationEventBus(storage, {});

  const savedInit = orchestrator.initialized;
  const savedBus = orchestrator.eventBus;
  const savedTaskState = orchestrator.taskState;
  const origLog = console.log;
  try {
    orchestrator.initialized = true;
    orchestrator.eventBus = bus;
    orchestrator.taskState = {
      create: () => {
        storage.db.prepare("INSERT INTO task_states (task_id, task_name, status, current_agent, current_phase, state_json) VALUES ('orch-task-1', 'p', 'active', 'Claude', 'implementation', '{}')").run();
        return { task_id: 'orch-task-1' };
      },
      transition: () => {},
      update: () => {}
    };

    const runner = makeRunner();
    runner._executeStage = async () => true;
    console.log = () => {};
    const pipelineId = runner.start('demo', { prompt: 'integrity pipeline' });
    await waitFor(() => runner.getStatus(pipelineId)?.status === 'completed');
    console.log = origLog;

    const forTask = storage.queryEvents({ taskId: 'orch-task-1', limit: 50 });
    check(forTask.length >= 2, `events are queryable by the orchestration task id (got ${forTask.length})`);
    check(forTask.every((e) => e.payload.pipelineId === pipelineId), 'stored events keep the pipeline id in the payload');
    const reloaded = storage.queryEvents({ limit: 50 });
    check(reloaded.length > 0 && reloaded.every((e) => bus.verifyIntegrity(e)), 'verifyIntegrity is true for every reloaded pipeline event');

    // Defensive fallback: an unknown task id is not rewritten in any hashed field
    bus.emit('task_started', { agent: 'Claude', taskId: 'no-such-task', payload: { n: 1 } });
    const orphan = storage.queryEvents({ taskId: 'no-such-task', limit: 5 });
    check(orphan.length === 1, 'an event for an unknown task id is still stored and queryable');
    check(orphan[0] && orphan[0].task_id === 'no-such-task', 'the unknown task id is reported unchanged');
    check(orphan[0] && bus.verifyIntegrity(orphan[0]), 'verifyIntegrity is true for the unknown-task event after reload');
  } finally {
    console.log = origLog;
    orchestrator.initialized = savedInit;
    orchestrator.eventBus = savedBus;
    orchestrator.taskState = savedTaskState;
  }

  // Reopen the database: still verifies
  storage.close();
  const again = new OrchestrationStorage(join(BASE, 'orch.db'));
  again.open();
  const verifyBus = new OrchestrationEventBus(again, {});
  const all = again.queryEvents({ limit: 100 });
  check(all.length > 0 && all.every((e) => verifyBus.verifyIntegrity(e)), 'every event verifies after reopening the database');
  again.close();
}

// --- R2-H2 ---

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

async function testRunnerFailure() {
  console.log('\n[R2-H2] a rejected _execute ends in a failed record');
  const runner = makeRunner();
  runner._execute = async () => { throw new Error('boom from execute'); };
  const events = [];
  runner.on('pipeline_failed', (e) => events.push(e));
  const hookCalls = [];
  const origErr = console.error;
  console.error = () => {};
  let id;
  try {
    id = runner.start('demo', { prompt: 'x' }, { onFailed: (e) => hookCalls.push(e) });
    await waitFor(() => events.length > 0);
  } finally {
    console.error = origErr;
  }
  check(events.length === 1 && /boom from execute/.test(String(events[0].error)), 'pipeline_failed is emitted with the error');
  check(runner.getStatus(id)?.status === 'failed', `runner status becomes failed (got ${runner.getStatus(id)?.status})`);
  check(hookCalls.length === 1 && hookCalls[0].pipelineId === id, 'onFailed hook is called exactly once');
}

async function testRoutes(server) {
  console.log('\n[R2-H2] routes: failed record and no listener accumulation');
  const origExecute = assetPipelineRunner._execute;
  const savedLoaded = assetPipelineRunner.configLoaded;
  const savedPipelines = assetPipelineRunner.pipelines;
  assetPipelineRunner.configLoaded = true;
  assetPipelineRunner.pipelines = {
    generate_scene: { stages: [{ name: 's', handler: 'noop' }] },
    generate_world: { stages: [{ name: 's', handler: 'noop' }] },
    generate_prototype: { stages: [{ name: 's', handler: 'noop' }] }
  };
  const origErr = console.error;
  const origLog = console.log;
  const quiet = () => {};
  try {
    // Rejection -> failed record for each route
    assetPipelineRunner._execute = async () => { throw new Error('stage exploded'); };
    console.error = quiet;
    console.log = quiet;
    const cases = [
      { name: 'scene', path: '/api/scene/generate', idKey: 'sceneId', get: (id) => forge3dDb.getScene(id) },
      { name: 'world', path: '/api/world/generate', idKey: 'worldId', get: (id) => forge3dDb.getWorld(id) },
      { name: 'prototype', path: '/api/prototype/generate', idKey: 'prototypeId', get: (id) => forge3dDb.getPrototype(id) }
    ];
    for (const c of cases) {
      const res = await post(server, c.path, { prompt: `failing ${c.name} generation` });
      const id = res.json?.[c.idKey];
      await waitFor(() => c.get(id)?.status === 'failed');
      console.log = origLog;
      check(res.status === 202, `${c.name}: generate answers 202 (got ${res.status})`);
      check(c.get(id)?.status === 'failed', `${c.name}: record becomes failed after _execute rejects (got ${c.get(id)?.status})`);
      console.log = quiet;
    }

    // Hanging pipelines: 20 requests per route must not add listeners
    assetPipelineRunner._execute = () => new Promise(() => {});
    const counts = () => ['pipeline_failed', 'pipeline_complete', 'all'].map((n) => assetPipelineRunner.listenerCount(n));
    const before = counts();
    for (const c of cases) {
      for (let i = 0; i < 20; i++) {
        await post(server, c.path, { prompt: `listener probe ${c.name} ${i}` });
      }
    }
    const after = counts();
    console.log = origLog;
    check(JSON.stringify(before) === JSON.stringify(after), `listener counts unchanged after 60 requests (before ${before}, after ${after})`);
  } finally {
    console.error = origErr;
    console.log = origLog;
    assetPipelineRunner._execute = origExecute;
    assetPipelineRunner.configLoaded = savedLoaded;
    assetPipelineRunner.pipelines = savedPipelines;
  }
}

// --- R2-H3 ---

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

async function testMigrationIdempotent() {
  console.log('\n[R2-H3] migration v12 is idempotent');
  const path = join(BASE, 'db', 'partial.db');
  const first = new Forge3DDatabase(path);
  first.open();
  check(hasColumn(first.db, 'prototypes', 'pipeline_id'), 'fresh database has the column');
  // Partial application: column exists, v12 row and index are missing
  first.db.exec('DROP INDEX IF EXISTS idx_prototypes_pipeline;');
  first.db.prepare('DELETE FROM schema_version WHERE version >= 12').run();
  first.close();

  let opened = null;
  let error = null;
  try {
    opened = new Forge3DDatabase(path);
    opened.open();
  } catch (err) {
    error = err;
  }
  check(error === null, `database with the column but no v12 row opens without error${error ? ` (${error.message})` : ''}`);
  if (opened && opened.db) {
    check(opened.db.prepare('SELECT 1 FROM schema_version WHERE version = 12').get() !== undefined, 'v12 is recorded after the re-run');
    check(hasColumn(opened.db, 'prototypes', 'pipeline_id'), 'column still present');
    opened.close();
  }
}

async function guarded(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(false, `${name} threw: ${err.stack || err.message}`);
  }
}

async function main() {
  console.log('[FIX-R2-P2] Acceptance tests for R2-H1..H3...');
  let server = null;
  try {
    await guarded('R2-H1', testEventIntegrity);
    await guarded('R2-H3', testMigrationIdempotent);
    forge3dDb.open();
    server = await startApp();
    await guarded('R2-H2 runner', testRunnerFailure);
    await guarded('R2-H2 routes', () => testRoutes(server));
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  } finally {
    if (server) {
      await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
    try { forge3dDb.close(); } catch (_e) { /* best-effort */ }
    rmSync(BASE, { recursive: true, force: true });
  }
  console.log(`\n[FIX-R2-P2] ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('[FIX-R2-P2] Crashed:', err);
  process.exit(1);
});
