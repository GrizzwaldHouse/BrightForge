/** Playtest Routes - API endpoints for AI Playtest & Balancing Engine (Phase 17)
 *
 * 4 endpoints for running AI playtests and retrieving reports:
 *
 * POST /api/playtest/run           - Run AI playtest simulation on prototype
 * GET  /api/playtest/list          - List playtest runs
 * GET  /api/playtest/:id/report    - Get playtest report + balance suggestions
 * GET  /api/playtest/:id/stream    - SSE for playtest progress
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import forge3dDb from '../../forge3d/database.js';
import assetPipelineRunner from '../../forge3d/pipeline/asset-pipeline-runner.js';
import { forge3dLimiter } from '../middleware/rate-limit.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

const VALID_AGENT_TYPES = ['explorer', 'quest_focused', 'speedrunner'];

function sanitizeError(error) {
  const msg = error?.message || String(error);
  let sanitized = msg.replace(/[A-Z]:\\[^\s]+/gi, '[path]');
  sanitized = sanitized.replace(/\/[^\s]+/g, '[path]');
  sanitized = sanitized.split('\n')[0];
  return sanitized || 'An error occurred';
}

let initialized = false;
function ensureInit() {
  if (!initialized) {
    forge3dDb.open();
    initialized = true;
  }
}

// --- Run Playtest ---

/**
 * POST /api/playtest/run
 * Start AI playtest simulation on a completed prototype.
 * Body: { prototypeId: string, agentTypes?: string[], maxTicks?: number }
 * Returns 202 with playtestId and pipelineId.
 */
router.post('/run', forge3dLimiter, (req, res) => {
  ensureInit();
  console.log('[PLAYTEST] POST /api/playtest/run');
  const endTimer = telemetryBus.startTimer('playtest_api_run');

  try {
    const { prototypeId, agentTypes, maxTicks } = req.body;

    if (!prototypeId || typeof prototypeId !== 'string') {
      endTimer({ error: 'invalid_prototypeId' });
      return res.status(400).json({ error: 'prototypeId is required' });
    }

    // Verify prototype exists and is complete
    const prototype = forge3dDb.getPrototype(prototypeId);
    if (!prototype) {
      endTimer({ error: 'not_found' });
      return res.status(404).json({ error: 'Prototype not found' });
    }

    if (prototype.status !== 'complete') {
      endTimer({ error: 'not_complete' });
      return res.status(400).json({ error: `Prototype is not complete (status: ${prototype.status})` });
    }

    // Validate agent types
    let validAgentTypes = ['explorer', 'quest_focused', 'speedrunner'];
    if (Array.isArray(agentTypes) && agentTypes.length > 0) {
      const invalid = agentTypes.filter(t => !VALID_AGENT_TYPES.includes(t));
      if (invalid.length > 0) {
        endTimer({ error: 'invalid_agent_types' });
        return res.status(400).json({ error: `Invalid agent types: ${invalid.join(', ')}. Valid: ${VALID_AGENT_TYPES.join(', ')}` });
      }
      validAgentTypes = agentTypes;
    }

    // Validate maxTicks
    const validMaxTicks = Math.min(Math.max(parseInt(maxTicks) || 1000, 10), 10000);

    // Create playtest run in DB
    const run = forge3dDb.createPlaytestRun({
      prototypeId,
      agentCount: validAgentTypes.length,
      agentTypes: validAgentTypes,
      maxTicks: validMaxTicks
    });

    // Start pipeline (fire-and-forget)
    const pipelineId = assetPipelineRunner.start('run_playtest', {
      prompt: `playtest:${prototypeId}`,
      prototypeId,
      playtestRunId: run.id,
      agentTypes: validAgentTypes,
      maxTicks: validMaxTicks
    });

    // Update run with pipeline ID
    forge3dDb.updatePlaytestRun(run.id, {
      pipelineId,
      status: 'simulating'
    });

    endTimer({ playtestId: run.id, pipelineId });

    return res.status(202).json({
      playtestId: run.id,
      pipelineId,
      status: 'simulating',
      statusUrl: `/api/playtest/${run.id}/report`,
      streamUrl: `/api/playtest/${run.id}/stream`
    });
  } catch (err) {
    console.error(`[PLAYTEST] Run error: ${err.message}`);
    errorHandler.report('playtest_error', err, { endpoint: 'run' });
    endTimer({ error: err.message });
    return res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- List Playtest Runs ---

/**
 * GET /api/playtest/list
 * List playtest runs with optional filters.
 * Query: ?prototypeId=x&status=x&limit=N
 */
router.get('/list', (req, res) => {
  ensureInit();

  try {
    const options = {
      prototypeId: req.query.prototypeId || null,
      status: req.query.status || null,
      limit: Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100)
    };

    const runs = forge3dDb.listPlaytestRuns(options);
    res.json({ runs });
  } catch (err) {
    console.error(`[PLAYTEST] List error: ${err.message}`);
    errorHandler.report('playtest_error', err, { endpoint: 'list' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Playtest Report ---

/**
 * GET /api/playtest/:id/report
 * Get the full playtest report and balance suggestions.
 */
router.get('/:id/report', (req, res) => {
  ensureInit();
  const playtestId = req.params.id;

  try {
    const run = forge3dDb.getPlaytestRun(playtestId);
    if (!run) {
      return res.status(404).json({ error: 'Playtest run not found' });
    }

    const report = forge3dDb.getPlaytestReportByRunId(playtestId);

    res.json({
      run,
      report: report ? report.report_json : null,
      suggestions: report ? report.suggestions_json : null
    });
  } catch (err) {
    console.error(`[PLAYTEST] Report error: ${err.message}`);
    errorHandler.report('playtest_error', err, { endpoint: 'report', playtestId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- SSE Stream ---

/**
 * GET /api/playtest/:id/stream
 * SSE stream for real-time playtest progress.
 */
router.get('/:id/stream', (req, res) => {
  ensureInit();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  const playtestId = req.params.id;
  const run = forge3dDb.getPlaytestRun(playtestId);

  if (!run || !run.pipeline_id) {
    res.write(`data: ${JSON.stringify({ error: 'Playtest run or pipeline not found' })}\n\n`);
    res.end();
    return;
  }

  const pipelineId = run.pipeline_id;

  const heartbeat = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  const onEvent = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, playtestId })}\n\n`);
    }
  };

  const onComplete = (data) => {
    if (data.pipelineId === pipelineId) {
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ ...data, playtestId, done: true })}\n\n`);
      cleanup();
      res.end();
    }
  };

  const cleanup = () => {
    clearInterval(heartbeat);
    assetPipelineRunner.off('stage_started', onEvent);
    assetPipelineRunner.off('stage_completed', onEvent);
    assetPipelineRunner.off('stage_failed', onEvent);
    assetPipelineRunner.off('pipeline_complete', onComplete);
    assetPipelineRunner.off('pipeline_failed', onComplete);
  };

  assetPipelineRunner.on('stage_started', onEvent);
  assetPipelineRunner.on('stage_completed', onEvent);
  assetPipelineRunner.on('stage_failed', onEvent);
  assetPipelineRunner.on('pipeline_complete', onComplete);
  assetPipelineRunner.on('pipeline_failed', onComplete);

  req.on('close', cleanup);
});

export default router;

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[PLAYTEST] Running route self-test...');

  // Verify router has expected routes
  const routes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  });

  console.log(`[PLAYTEST] Registered routes: ${routes.length}`);
  for (const r of routes) {
    console.log(`  ${r}`);
  }

  console.assert(routes.some((r) => r.includes('POST') && r.includes('/run')), 'Should have POST /run');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/list')), 'Should have GET /list');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id/report')), 'Should have GET /:id/report');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id/stream')), 'Should have GET /:id/stream');

  // Verify sanitizeError
  const sanitized = sanitizeError(new Error('File at C:\\Users\\test\\file.js failed'));
  console.assert(!sanitized.includes('C:\\'), 'Should remove Windows paths');
  console.assert(sanitized.includes('[path]'), 'Should replace with [path]');

  const sanitizedUnix = sanitizeError(new Error('File at /home/user/file.js failed'));
  console.assert(!sanitizedUnix.includes('/home'), 'Should remove Unix paths');

  console.log('[PLAYTEST] Route self-test passed');
  process.exit(0);
}
