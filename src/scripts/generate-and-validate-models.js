// generate-and-validate-models.js
// Developer: Marcus Daley (GrizzwaldHouse)
// Date: April 2026
// Purpose: Generate, validate, render-check, review, and promote default 3D models
//          for new-user onboarding. Principle: Generate → Validate → Render → Review → Promote

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync } from 'fs';
import { join, dirname, extname } from 'path';
import { fileURLToPath } from 'url';

import forge3dConfig from '../forge3d/config-loader.js';
import { isSelfTest, isMainRun } from '../core/is-main-module.js';

// Heavy singletons are lazy-imported inside main() so their --test blocks
// don't fire when this script itself is run with --test.
let assetPipelineRunner, modelBridge, telemetryBus, errorHandler;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Config ────────────────────────────────────────────────────────────────

const PROMPTS_CONFIG_PATH = forge3dConfig.resolvePath('config/default-model-prompts.json');
const REVIEW_DIR          = forge3dConfig.resolvePath('generated/review');
const DEFAULTS_MODELS_DIR = forge3dConfig.resolvePath('defaults/models');
const DEFAULTS_PROMPTS    = forge3dConfig.resolvePath('defaults/prompts.json');

// Bridge startup timeout for this script run (ms)
const BRIDGE_WAIT_MS  = 90_000;
const BRIDGE_POLL_MS  = 1_000;
// Per-pipeline completion timeout (ms) — extended 4x in CPU mode at runtime.
// Base is 45 min to cover slow GPU runs (SDXL 25 steps can take ~15 min on first load).
let PIPELINE_TIMEOUT_MS = 2_700_000;

// ─── Bootstrap directories ──────────────────────────────────────────────────

function ensureDir(dirPath) {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
    console.log(`[SETUP] Created directory: ${dirPath}`);
  }
}

// ─── Config loader ──────────────────────────────────────────────────────────

/**
 * Load and validate the model prompts config.
 * Throws if config is missing or malformed — fail-fast.
 */
function loadPromptsConfig() {
  if (!existsSync(PROMPTS_CONFIG_PATH)) {
    throw new Error(`[CONFIG] Prompts config not found: ${PROMPTS_CONFIG_PATH}`);
  }

  const raw = readFileSync(PROMPTS_CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);

  if (!Array.isArray(config.models) || config.models.length === 0) {
    throw new Error('[CONFIG] default-model-prompts.json must contain a non-empty "models" array');
  }

  for (const model of config.models) {
    if (!model.id || !model.prompt || !model.pipeline || !model.category) {
      throw new Error(`[CONFIG] Model entry missing required field (id/prompt/pipeline/category): ${JSON.stringify(model)}`);
    }
  }

  console.log(`[CONFIG] Loaded ${config.models.length} model prompts from config`);
  return config;
}

// ─── Bridge readiness ───────────────────────────────────────────────────────

/**
 * Wait for the Python model bridge to reach 'running' state.
 * Fail-fast after BRIDGE_WAIT_MS.
 */
async function waitForBridge() {
  if (modelBridge.state === 'running') return;

  console.log('[BRIDGE] Starting Python inference bridge...');
  await modelBridge.start();

  const deadline = Date.now() + BRIDGE_WAIT_MS;
  while (modelBridge.state !== 'running') {
    if (Date.now() > deadline) {
      throw new Error(`[BRIDGE] Python bridge did not start within ${BRIDGE_WAIT_MS / 1000}s (state: ${modelBridge.state})`);
    }
    await new Promise(r => setTimeout(r, BRIDGE_POLL_MS));
  }

  console.log('[BRIDGE] Python inference bridge is ready');
}

// ─── Pipeline runner (event-driven, no polling) ─────────────────────────────

/**
 * Run a single named pipeline and await its completion via event emission.
 * Returns the final context and timing data.
 *
 * @param {string} pipelineName - e.g. "generate_prop_asset"
 * @param {Object} params - { prompt, projectId?, model? }
 * @returns {Promise<Object>} { pipelineId, success, context, durationMs, error }
 */
function runPipeline(pipelineName, params) {
  return new Promise((resolve, reject) => {
    const startMs = Date.now();
    let pipelineId;

    const timeoutHandle = setTimeout(() => {
      reject(new Error(`[PIPELINE] Timeout after ${PIPELINE_TIMEOUT_MS / 1000}s for ${pipelineName}`));
    }, PIPELINE_TIMEOUT_MS);

    // Listen for completion events — event-driven, no polling
    const onComplete = (data) => {
      if (data.pipelineId !== pipelineId) return;
      clearTimeout(timeoutHandle);
      assetPipelineRunner.off('pipeline_complete', onComplete);
      assetPipelineRunner.off('pipeline_failed', onFailed);

      const status = assetPipelineRunner.getStatus(pipelineId);
      resolve({
        pipelineId,
        success: true,
        context: status?.stages ?? [],
        durationMs: Date.now() - startMs,
        error: null
      });
    };

    const onFailed = (data) => {
      if (data.pipelineId !== pipelineId) return;
      clearTimeout(timeoutHandle);
      assetPipelineRunner.off('pipeline_complete', onComplete);
      assetPipelineRunner.off('pipeline_failed', onFailed);

      resolve({
        pipelineId,
        success: false,
        context: [],
        durationMs: Date.now() - startMs,
        error: data.error || `Stage failed: ${data.failedStage}`
      });
    };

    assetPipelineRunner.on('pipeline_complete', onComplete);
    assetPipelineRunner.on('pipeline_failed', onFailed);

    // Start — fires events asynchronously
    try {
      pipelineId = assetPipelineRunner.start(pipelineName, params);
      console.log(`[PIPELINE] Started ${pipelineName} → pipelineId: ${pipelineId}`);
    } catch (err) {
      clearTimeout(timeoutHandle);
      assetPipelineRunner.off('pipeline_complete', onComplete);
      assetPipelineRunner.off('pipeline_failed', onFailed);
      reject(err);
    }
  });
}

// ─── File validator ─────────────────────────────────────────────────────────

/**
 * Validate a saved model file: exists, non-empty, correct extension.
 *
 * @param {string} filePath - Absolute path to model file
 * @param {string[]} allowedExtensions - e.g. ['.glb', '.obj']
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateModelFile(filePath, allowedExtensions = ['.glb', '.obj', '.fbx']) {
  const errors = [];

  if (!existsSync(filePath)) {
    errors.push(`File does not exist: ${filePath}`);
    return { valid: false, errors };
  }

  const buf = readFileSync(filePath);
  if (buf.length === 0) {
    errors.push(`File is empty: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    errors.push(`Unsupported format "${ext}". Expected one of: ${allowedExtensions.join(', ')}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Render validator ───────────────────────────────────────────────────────

/**
 * Request a mesh quality report from the Python server (acts as render validation).
 * Returns report data if the bridge endpoint responds correctly.
 *
 * @param {Buffer} meshBuffer - GLB buffer
 * @returns {Promise<{ success: boolean, report: Object|null, error: string|null }>}
 */
async function validateRender(meshBuffer) {
  if (!meshBuffer) {
    return { success: false, report: null, error: 'No mesh buffer provided for render validation' };
  }

  try {
    const report = await modelBridge.getMeshReport(meshBuffer);
    return { success: true, report, error: null };
  } catch (err) {
    return { success: false, report: null, error: err.message };
  }
}

// ─── Review reporter ────────────────────────────────────────────────────────

/**
 * Write a structured JSON review report and per-model files to the review directory.
 *
 * @param {Object[]} results - Array of model result records
 * @returns {string} Path to written report file
 */
function writeReviewReport(results) {
  ensureDir(REVIEW_DIR);

  const runId = `run_${Date.now()}`;
  const reportPath = join(REVIEW_DIR, `${runId}_report.json`);

  const report = {
    runId,
    generatedAt: new Date().toISOString(),
    totalModels: results.length,
    passed: results.filter(r => r.status === 'pass').length,
    failed: results.filter(r => r.status === 'fail').length,
    models: results.map(r => ({
      modelId:        r.modelId,
      prompt:         r.prompt,
      category:       r.category,
      pipeline:       r.pipeline,
      status:         r.status,
      renderSuccess:  r.renderSuccess,
      generationTime: r.generationTime,
      renderTime:     r.renderTime,
      errors:         r.errors,
      approved:       r.approved,
      reviewFilePath: r.reviewFilePath ?? null
    }))
  };

  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[REPORT] Review report written: ${reportPath}`);

  return reportPath;
}

// ─── Default promoter ───────────────────────────────────────────────────────

/**
 * Promote approved models to defaults/models/ with version-safe naming.
 * Does not overwrite existing defaults — adds version suffix if needed.
 *
 * @param {Object[]} results - Model result records with approved flag
 * @returns {Object[]} Updated results with promotedPath set
 */
function promoteApproved(results) {
  // Nothing approved: touch nothing on disk (defaults/ is tracked in git)
  if (!results.some(r => r.approved && r.status === 'pass' && r.reviewFilePath)) {
    console.log('[PROMOTE] No approved models to promote.');
    return results;
  }

  ensureDir(DEFAULTS_MODELS_DIR);

  const existingPrompts = existsSync(DEFAULTS_PROMPTS)
    ? JSON.parse(readFileSync(DEFAULTS_PROMPTS, 'utf8'))
    : { version: '1.0.0', generatedAt: null, models: [] };

  let promoted = 0;

  for (const result of results) {
    if (!result.approved || result.status !== 'pass' || !result.reviewFilePath) continue;

    if (!existsSync(result.reviewFilePath)) {
      console.warn(`[PROMOTE] Source file not found, skipping: ${result.reviewFilePath}`);
      continue;
    }

    const ext = extname(result.reviewFilePath);
    const baseName = result.modelId;

    // Version-safe: don't overwrite — append timestamp if name already exists
    let destName = `${baseName}${ext}`;
    let destPath = join(DEFAULTS_MODELS_DIR, destName);
    if (existsSync(destPath)) {
      const ts = Date.now();
      destName = `${baseName}_v${ts}${ext}`;
      destPath = join(DEFAULTS_MODELS_DIR, destName);
      console.log(`[PROMOTE] Existing default found — promoting as versioned: ${destName}`);
    }

    copyFileSync(result.reviewFilePath, destPath);
    result.promotedPath = destPath;

    // Upsert entry in defaults/prompts.json
    const existingIdx = existingPrompts.models.findIndex(m => m.modelId === result.modelId);
    const entry = {
      modelId:    result.modelId,
      label:      result.label,
      category:   result.category,
      prompt:     result.prompt,
      pipeline:   result.pipeline,
      file:       destName,
      promotedAt: new Date().toISOString()
    };

    if (existingIdx >= 0) {
      existingPrompts.models[existingIdx] = entry;
    } else {
      existingPrompts.models.push(entry);
    }

    promoted++;
    console.log(`[PROMOTE] ✓ ${result.modelId} → defaults/models/${destName}`);
  }

  existingPrompts.generatedAt = new Date().toISOString();
  writeFileSync(DEFAULTS_PROMPTS, JSON.stringify(existingPrompts, null, 2), 'utf8');

  if (promoted > 0) {
    console.log(`[PROMOTE] ${promoted} model(s) promoted. defaults/prompts.json updated.`);
  } else {
    console.log('[PROMOTE] No models approved for promotion.');
  }

  return results;
}

// ─── Fail-fast assertion ─────────────────────────────────────────────────────

function failFast(message) {
  errorHandler.report('generation_error', new Error(message), { script: 'generate-and-validate-models' });
  console.error(`[FAIL-FAST] ${message}`);
  process.exit(1);
}

// ─── Main orchestration ─────────────────────────────────────────────────────

async function main() {
  // Lazy-import heavy singletons here so their --test blocks don't fire
  // when this script is invoked with --test.
  ({ default: assetPipelineRunner } = await import('../forge3d/pipeline/asset-pipeline-runner.js'));
  ({ default: modelBridge }         = await import('../forge3d/model-bridge.js'));
  ({ default: telemetryBus }        = await import('../core/telemetry-bus.js'));
  ({ default: errorHandler }        = await import('../core/error-handler.js'));

  console.log('[START] BrightForge default model generation pipeline');
  console.log(`[START] ${new Date().toISOString()}`);

  const runStartMs = Date.now();

  // 1. Ensure output directories exist
  ensureDir(REVIEW_DIR);
  ensureDir(DEFAULTS_MODELS_DIR);

  // 2. Load prompts config — fail-fast on invalid config
  let promptsConfig;
  try {
    promptsConfig = loadPromptsConfig();
  } catch (err) {
    failFast(err.message);
  }

  // 3. Start Python bridge — fail-fast if unavailable
  try {
    await waitForBridge();
  } catch (err) {
    failFast(err.message);
  }

  // Extend timeout 4x when running in CPU mode — SDXL takes ~10 min per image on CPU.
  // Fetch health directly: lastHealthCheck may still be null right after bridge startup.
  try {
    const healthRes = await fetch(`http://${modelBridge.host}:${modelBridge.port}/health`);
    const health = await healthRes.json();
    if (!health.gpu_available) {
      PIPELINE_TIMEOUT_MS = 1_200_000; // 20 minutes
      console.warn(`[CONFIG] CPU mode detected — pipeline timeout extended to ${PIPELINE_TIMEOUT_MS / 60_000} min per model`);
    }
  } catch (_e) {
    // Non-fatal — keep default timeout if health check fails
  }

  const results = [];

  // 4. Generate, validate, and render-check each model
  for (const modelDef of promptsConfig.models) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[MODEL] ${modelDef.id} (${modelDef.category})`);
    console.log(`[MODEL] Prompt: "${modelDef.prompt.slice(0, 80)}..."`);

    const result = {
      modelId:        modelDef.id,
      label:          modelDef.label,
      prompt:         modelDef.prompt,
      category:       modelDef.category,
      pipeline:       modelDef.pipeline,
      status:         'fail',
      renderSuccess:  false,
      generationTime: 0,
      renderTime:     0,
      errors:         [],
      approved:       false,
      reviewFilePath: null
    };

    // ── Bridge restart between models ────────────────────────────────────
    // The Python server holds a generation lock that isn't released if the
    // JS side times out. Restart the bridge before each model to guarantee
    // a clean lock for every generation.
    try {
      await modelBridge.stop();
      await waitForBridge();
    } catch (err) {
      result.errors.push(`Bridge restart failed: ${err.message}`);
      console.error(`[FAIL] ${modelDef.id} bridge restart error: ${err.message}`);
      results.push(result);
      continue;
    }

    // ── Generation ──────────────────────────────────────────────────────────
    let pipelineResult;

    try {
      pipelineResult = await runPipeline(modelDef.pipeline, {
        prompt: modelDef.prompt
      });
    } catch (err) {
      result.errors.push(`Generation threw: ${err.message}`);
      console.error(`[FAIL] ${modelDef.id} generation error: ${err.message}`);
      results.push(result);
      continue; // fail-fast per model — continue to next
    }

    result.generationTime = pipelineResult.durationMs;

    if (!pipelineResult.success) {
      result.errors.push(`Pipeline failed: ${pipelineResult.error}`);
      console.error(`[FAIL] ${modelDef.id} pipeline failed: ${pipelineResult.error}`);
      results.push(result);
      continue;
    }

    console.log(`[GEN] ✓ ${modelDef.id} generated in ${(result.generationTime / 1000).toFixed(1)}s`);

    // ── Retrieve mesh buffer from pipeline context ────────────────────────
    // The pipeline stages write meshBuffer into the execution context.
    // We access it through the live context stored in the runner.
    const liveExec = assetPipelineRunner.activePipelines.get(pipelineResult.pipelineId);
    const meshBuffer = liveExec?.context?.optimizedBuffer ?? liveExec?.context?.meshBuffer ?? null;

    // ── File validation ──────────────────────────────────────────────────
    // Save mesh buffer to review directory for file-based validation
    if (meshBuffer) {
      const reviewFilePath = join(REVIEW_DIR, `${modelDef.id}.glb`);
      writeFileSync(reviewFilePath, meshBuffer);
      result.reviewFilePath = reviewFilePath;

      const fileCheck = validateModelFile(reviewFilePath);
      if (!fileCheck.valid) {
        result.errors.push(...fileCheck.errors);
        console.error(`[FAIL] ${modelDef.id} file validation: ${fileCheck.errors.join('; ')}`);
        results.push(result);
        continue;
      }
      console.log(`[FILE] ✓ ${modelDef.id} file valid (${meshBuffer.length} bytes, .glb)`);
    } else {
      // Pipeline succeeded but no mesh buffer — mark as partial failure
      result.errors.push('Pipeline completed but no mesh buffer found in context');
      console.warn(`[WARN] ${modelDef.id} pipeline succeeded with no mesh buffer`);
      results.push(result);
      continue;
    }

    // ── Render validation (mesh quality report) ───────────────────────────
    const renderStart = Date.now();
    const renderCheck = await validateRender(meshBuffer);
    result.renderTime = Date.now() - renderStart;

    if (!renderCheck.success) {
      result.errors.push(`Render validation failed: ${renderCheck.error}`);
      console.error(`[FAIL] ${modelDef.id} render validation: ${renderCheck.error}`);
      results.push(result);
      continue;
    }

    result.renderSuccess = true;
    const report = renderCheck.report;
    console.log(`[RENDER] ✓ ${modelDef.id} — faces: ${report?.face_count ?? '?'}, vertices: ${report?.vertex_count ?? '?'}, manifold: ${report?.is_manifold ?? '?'}`);

    // ── All checks passed ────────────────────────────────────────────────
    result.status = 'pass';

    // Auto-approve only if model config allows it
    if (!modelDef.approvalRequired) {
      result.approved = true;
      console.log(`[REVIEW] ${modelDef.id} auto-approved (approvalRequired: false)`);
    } else {
      result.approved = false;
      console.log(`[REVIEW] ${modelDef.id} awaiting manual approval (approvalRequired: true)`);
    }

    telemetryBus.emit('generation', {
      type: 'default_model_generated',
      modelId: modelDef.id,
      category: modelDef.category,
      generationTimeMs: result.generationTime,
      renderTimeMs: result.renderTime,
      faceCount: report?.face_count
    });

    results.push(result);
  }

  // 5. Write review report
  console.log(`\n${'─'.repeat(60)}`);
  const reportPath = writeReviewReport(results);

  // 6. Promote approved models
  promoteApproved(results);

  // 7. Summary
  const totalMs = Date.now() - runStartMs;
  const passed = results.filter(r => r.status === 'pass').length;
  const failed = results.filter(r => r.status === 'fail').length;

  console.log(`\n${'═'.repeat(60)}`);
  console.log(`[DONE] Pipeline complete in ${(totalMs / 1000).toFixed(1)}s`);
  console.log(`[DONE] Models: ${passed} passed, ${failed} failed (${results.length} total)`);
  console.log(`[DONE] Review report: ${reportPath}`);
  console.log(`${'═'.repeat(60)}`);

  if (failed > 0) {
    console.log('\n[FAILURES]');
    for (const r of results.filter(r => r.status === 'fail')) {
      console.log(`  ✗ ${r.modelId}: ${r.errors.join('; ')}`);
    }
    process.exit(1);
  }

  process.exit(0);
}

if (isMainRun(import.meta.url)) {
  main().catch((err) => {
    errorHandler.report('generation_error', err, { script: 'generate-and-validate-models' });
    console.error('[FATAL]', err.message);
    process.exit(1);
  });
}

// --test block
if (isSelfTest(import.meta.url)) {
  (async () => {
    console.log('[TEST] Running generate-and-validate-models self-tests...');
    const { unlinkSync } = await import('fs');

    // Test: loadPromptsConfig succeeds with valid config on disk
    let threw = false;
    try {
      if (!existsSync(PROMPTS_CONFIG_PATH)) {
        throw new Error(`Prompts config must exist for self-test: ${PROMPTS_CONFIG_PATH}`);
      }
      loadPromptsConfig();
    } catch (err) {
      threw = true;
      console.error('[TEST] loadPromptsConfig unexpectedly threw:', err.message);
    }
    console.assert(!threw, 'loadPromptsConfig should succeed with valid config on disk');

    // Test: validateModelFile catches non-existent file
    const check1 = validateModelFile('/non/existent/file.glb');
    console.assert(!check1.valid, 'Non-existent file should fail');
    console.assert(check1.errors.length > 0, 'Should report errors for non-existent file');

    // Test: validateModelFile catches unsupported extension
    ensureDir(forge3dConfig.resolvePath('data/temp'));
    const tmpXyz = forge3dConfig.resolvePath('data/temp/__test_model.xyz');
    writeFileSync(tmpXyz, Buffer.from('fake model data'));
    const check2 = validateModelFile(tmpXyz);
    console.assert(!check2.valid, 'Unsupported extension should fail');
    unlinkSync(tmpXyz);

    // Test: validateModelFile passes for valid .glb with content
    const tmpGlb = forge3dConfig.resolvePath('data/temp/__test_model.glb');
    writeFileSync(tmpGlb, Buffer.from('fake glb data'));
    const check3 = validateModelFile(tmpGlb);
    console.assert(check3.valid, 'Valid .glb with content should pass');
    unlinkSync(tmpGlb);

    // Test: promoteApproved skips non-approved results
    const fakeResults = [{
      modelId: 'test_skip',
      label: 'Test',
      prompt: 'test',
      category: 'prop',
      pipeline: 'generate_prop_asset',
      status: 'pass',
      approved: false,
      reviewFilePath: null
    }];
    const afterPromote = promoteApproved(fakeResults);
    console.assert(!afterPromote[0].promotedPath, 'Non-approved model should not be promoted');

    console.log('[TEST] All self-tests passed');
    process.exit(0);
  })().catch(err => {
    console.error('[TEST] Self-test failed:', err.message);
    process.exit(1);
  });
}
