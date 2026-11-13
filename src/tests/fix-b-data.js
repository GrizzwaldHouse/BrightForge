/**
 * fix-b-data.js - Acceptance tests for workstream B (data).
 *
 *   R-B1. prototypes.pipeline_id (migration v12) is stored by updatePrototype
 *         and GET /api/prototype/:id returns a non-null pipelineStatus while
 *         the pipeline runner still holds the entry. The migration applies on
 *         a fresh database and on an existing (v11) database.
 *   R-B2. Orchestration events whose task id is a pipeline id (not a row in
 *         task_states) persist without "FOREIGN KEY constraint failed".
 *
 * Isolation: temp directories only; the forge3d DB singleton and a private
 * OrchestrationStorage point at temp files; assetPipelineRunner.start and
 * getStatus are stubbed; no network, GPU or model is used.
 *
 * Run: node src/tests/fix-b-data.js
 */

import { mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import forge3dDb, { Forge3DDatabase } from '../forge3d/database.js';
import assetPipelineRunner from '../forge3d/pipeline/asset-pipeline-runner.js';
import prototypeRoutes from '../api/routes/prototype.js';
import orchestrator from '../orchestration/index.js';
import { OrchestrationStorage } from '../orchestration/storage.js';
import { OrchestrationEventBus } from '../orchestration/event-bus.js';

let passed = 0;
let failed = 0;
function check(cond, label) {
  if (cond) { passed++; console.log(`  PASS: ${label}`); } else { failed++; console.log(`  FAIL: ${label}`); }
}

const BASE = mkdtempSync(join(tmpdir(), 'bf-fix-b-'));
mkdirSync(join(BASE, 'db'), { recursive: true });
forge3dDb.dbPath = join(BASE, 'db', 'forge3d-fix-b.db');

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
}

async function testMigration() {
  console.log('\n[R-B1] pipeline_id migration');
  const fresh = new Forge3DDatabase(join(BASE, 'db', 'fresh.db'));
  fresh.open();
  check(hasColumn(fresh.db, 'prototypes', 'pipeline_id'), 'fresh database has prototypes.pipeline_id');
  const p = fresh.createPrototype({ name: 'fresh', prompt: 'fresh proto', genre: 'rpg' });
  const updated = fresh.updatePrototype(p.id, { pipelineId: 'pl-fresh-1', status: 'generating' });
  check(updated?.pipeline_id === 'pl-fresh-1', `updatePrototype persists pipelineId (got ${updated?.pipeline_id})`);
  fresh.close();

  // Existing database: simulate one created before the migration
  const oldPath = join(BASE, 'db', 'old.db');
  const old = new Forge3DDatabase(oldPath);
  old.open();
  old.db.exec('DROP INDEX IF EXISTS idx_prototypes_pipeline; ALTER TABLE prototypes DROP COLUMN pipeline_id;');
  old.db.prepare('DELETE FROM schema_version WHERE version >= 12').run();
  const keep = old.createPrototype({ name: 'kept', prompt: 'kept proto', genre: 'rpg' });
  check(!hasColumn(old.db, 'prototypes', 'pipeline_id'), 'simulated pre-migration database lacks the column');
  old.close();

  const reopened = new Forge3DDatabase(oldPath);
  reopened.open();
  check(hasColumn(reopened.db, 'prototypes', 'pipeline_id'), 'migration adds the column to an existing database');
  check(reopened.getPrototype(keep.id)?.name === 'kept', 'existing rows survive the migration');
  const upd = reopened.updatePrototype(keep.id, { pipelineId: 'pl-old-1' });
  check(upd?.pipeline_id === 'pl-old-1', 'updatePrototype works on the migrated database');
  reopened.close();
}

function startApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/prototype', prototypeRoutes);
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function request(server, method, path, body) {
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

async function testStatusEndpoint(server) {
  console.log('\n[R-B1] GET /api/prototype/:id returns pipelineStatus');
  const origStart = assetPipelineRunner.start;
  const origStatus = assetPipelineRunner.getStatus;
  const live = new Map();
  assetPipelineRunner.start = (name) => {
    const id = `fix-b-pl-${live.size + 1}`;
    live.set(id, { id, pipelineName: name, status: 'running', currentStageIndex: 0, stages: [] });
    return id;
  };
  assetPipelineRunner.getStatus = (id) => live.get(id) || null;
  try {
    const gen = await request(server, 'POST', '/api/prototype/generate', { prompt: 'fix b prototype pipeline' });
    check(gen.status === 202 && gen.json?.pipelineId, `generate answers 202 with pipelineId (got ${gen.status})`);
    const rec = forge3dDb.getPrototype(gen.json?.prototypeId);
    check(rec?.pipeline_id === gen.json?.pipelineId, `record stores pipeline_id (got ${rec?.pipeline_id})`);

    const st = await request(server, 'GET', `/api/prototype/${gen.json?.prototypeId}`);
    check(st.status === 200, `status endpoint answers 200 (got ${st.status})`);
    check(st.json?.pipelineStatus !== null && st.json?.pipelineStatus !== undefined, 'pipelineStatus is non-null while the runner entry exists');
    check(st.json?.pipelineStatus?.id === gen.json?.pipelineId, 'pipelineStatus describes the started pipeline');

    live.clear();
    const gone = await request(server, 'GET', `/api/prototype/${gen.json?.prototypeId}`);
    check(gone.status === 200 && gone.json?.pipelineStatus === null, 'pipelineStatus is null once the runner entry is gone');
  } finally {
    assetPipelineRunner.start = origStart;
    assetPipelineRunner.getStatus = origStatus;
  }
}

async function testEventPersistence() {
  console.log('\n[R-B2] pipeline events persist without FK errors');
  const storage = new OrchestrationStorage(join(BASE, 'orch.db'));
  storage.open();
  const bus = new OrchestrationEventBus(storage, {});

  const errors = [];
  const origErr = console.error;
  console.error = (...args) => { errors.push(args.join(' ')); };
  const savedInit = orchestrator.initialized;
  const savedBus = orchestrator.eventBus;
  try {
    orchestrator.initialized = true;
    orchestrator.eventBus = bus;

    // A pipeline with a failing stage emits started -> stage_started -> failed
    const pipelineId = 'fix-b-failing-pipeline';
    assetPipelineRunner._emitEvent('pipeline_started', { pipelineId, pipelineName: 'x', stageCount: 1, stages: ['s'] });
    assetPipelineRunner._emitEvent('stage_started', { pipelineId, stageName: 's', stageIndex: 0 });
    assetPipelineRunner._emitEvent('pipeline_failed', { pipelineId, failedStage: 's', stageIndex: 0, error: 'boom' });
  } finally {
    console.error = origErr;
    orchestrator.initialized = savedInit;
    orchestrator.eventBus = savedBus;
  }

  check(!errors.some((e) => /FOREIGN KEY/i.test(e)), `no FOREIGN KEY error is logged${errors.length ? ` (${errors[0]})` : ''}`);
  const rows = storage.db.prepare('SELECT event_type, task_id, payload FROM orchestration_events').all();
  check(rows.length === 3, `all 3 pipeline events are stored (got ${rows.length})`);
  check(rows.every((r) => JSON.parse(r.payload).pipelineId === 'fix-b-failing-pipeline'), 'stored events keep the pipeline id in the payload');

  // A real task id must still be linked
  const task = storage.db.prepare("INSERT INTO task_states (task_id, task_name, status, current_agent, current_phase, state_json) VALUES ('real-task', 't', 'active', 'Claude', 'implementation', '{}')");
  let linked = false;
  try {
    task.run();
    bus.emit('task_started', { agent: 'Claude', taskId: 'real-task', payload: {} });
    linked = storage.db.prepare("SELECT COUNT(*) AS n FROM orchestration_events WHERE task_id = 'real-task'").get().n === 1;
  } catch (err) {
    console.log(`  note: ${err.message}`);
  }
  check(linked, 'an event for a real task keeps its task_id link');
  storage.close();
}

async function guarded(name, fn) {
  try {
    await fn();
  } catch (err) {
    check(false, `${name} threw: ${err.message}`);
  }
}

async function main() {
  console.log('[FIX-B] Acceptance tests for workstream B...');
  let server = null;
  try {
    await guarded('migration', testMigration);
    forge3dDb.open();
    server = await startApp();
    await guarded('status endpoint', () => testStatusEndpoint(server));
    await guarded('event persistence', testEventPersistence);
  } catch (err) {
    check(false, `suite threw: ${err.stack || err.message}`);
  } finally {
    if (server) {
      await new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
    }
    try { forge3dDb.close(); } catch (_e) { /* best-effort */ }
    rmSync(BASE, { recursive: true, force: true });
  }
  console.log(`\n[FIX-B] ${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error('[FIX-B] Crashed:', err);
  process.exit(1);
});
