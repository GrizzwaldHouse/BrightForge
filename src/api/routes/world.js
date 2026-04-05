/** World Routes - API endpoints for AI World Generator (Phase 15)
 *
 * 6 endpoints for world generation, status, streaming, download, and management:
 *
 * POST /api/world/generate        - Start world generation (returns 202)
 * GET  /api/world/list            - List worlds (filter by projectId, status)
 * GET  /api/world/:id             - World status + regions
 * GET  /api/world/:id/stream      - SSE for generation progress
 * GET  /api/world/:id/download    - Download world package
 * DELETE /api/world/:id           - Delete world
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { Router } from 'express';
import { readFileSync, existsSync } from 'fs';
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

// Sanitize error messages for HTTP responses (matches forge3d.js pattern)
function sanitizeError(error) {
  const msg = error?.message || String(error);
  let sanitized = msg.replace(/[A-Z]:\\[^\s]+/gi, '[path]');
  sanitized = sanitized.replace(/\/[^\s]+/g, '[path]');
  sanitized = sanitized.split('\n')[0];
  return sanitized || 'An error occurred';
}

// Ensure database is open
let initialized = false;
function ensureInit() {
  if (!initialized) {
    forge3dDb.open();
    initialized = true;
  }
}

// --- World Generation ---

/**
 * POST /api/world/generate
 * Start world generation pipeline.
 * Body: { prompt: string, projectId?: string, worldSize?: 'small'|'medium'|'large', worldType?: string }
 * Returns 202 with worldId and pipelineId.
 */
router.post('/generate', forge3dLimiter, (req, res) => {
  ensureInit();
  console.log('[WORLD] POST /api/world/generate');
  const endTimer = telemetryBus.startTimer('world_api_generate');

  try {
    const { prompt, projectId, worldSize, worldType } = req.body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      endTimer({ error: 'invalid_prompt' });
      return res.status(400).json({ error: 'Prompt is required (at least 3 characters)' });
    }

    if (prompt.length > 2000) {
      endTimer({ error: 'prompt_too_long' });
      return res.status(400).json({ error: 'Prompt must be under 2000 characters' });
    }

    // Validate worldSize enum
    const validSizes = ['small', 'medium', 'large'];
    const sanitizedSize = validSizes.includes(worldSize) ? worldSize : 'medium';

    // Sanitize prompt into a short name for the world
    const sanitizedName = prompt.slice(0, 60).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();

    // Create world record in DB
    const world = forge3dDb.createWorld({
      projectId: projectId || null,
      name: sanitizedName,
      prompt: prompt.trim(),
      worldSize: sanitizedSize,
      worldType: worldType || 'open_world'
    });

    // Start pipeline (fire-and-forget)
    const pipelineId = assetPipelineRunner.start('generate_world', {
      prompt: prompt.trim(),
      projectId: projectId || null,
      worldId: world.id,
      worldSize: sanitizedSize,
      worldType: worldType || 'open_world'
    });

    // Update world with pipeline ID and set status to generating
    forge3dDb.updateWorld(world.id, {
      pipelineId,
      status: 'generating'
    });

    // Sync DB status when pipeline completes or fails
    const onPipelineComplete = (data) => {
      if (data.pipelineId === pipelineId) {
        try {
          forge3dDb.updateWorld(world.id, { status: 'complete' });
        } catch (dbErr) {
          console.warn(`[WORLD] DB status sync failed: ${dbErr.message}`);
        }
        assetPipelineRunner.off('pipeline_complete', onPipelineComplete);
        assetPipelineRunner.off('pipeline_failed', onPipelineFailed);
      }
    };
    const onPipelineFailed = (data) => {
      if (data.pipelineId === pipelineId) {
        try {
          forge3dDb.updateWorld(world.id, { status: 'failed' });
        } catch (dbErr) {
          console.warn(`[WORLD] DB status sync failed: ${dbErr.message}`);
        }
        assetPipelineRunner.off('pipeline_complete', onPipelineComplete);
        assetPipelineRunner.off('pipeline_failed', onPipelineFailed);
      }
    };
    assetPipelineRunner.on('pipeline_complete', onPipelineComplete);
    assetPipelineRunner.on('pipeline_failed', onPipelineFailed);

    endTimer({ worldId: world.id, pipelineId });

    return res.status(202).json({
      worldId: world.id,
      pipelineId,
      status: 'generating',
      statusUrl: `/api/world/${world.id}`,
      streamUrl: `/api/world/${world.id}/stream`
    });
  } catch (err) {
    console.error(`[WORLD] Generate error: ${err.message}`);
    errorHandler.report('world_error', err, { endpoint: 'generate' });
    endTimer({ error: err.message });
    return res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- List Worlds ---
// NOTE: /list must be registered BEFORE /:id to avoid Express matching "list" as an :id param

/**
 * GET /api/world/list
 * List worlds with optional filters.
 * Query: ?projectId=x&status=x&limit=N
 */
router.get('/list', (req, res) => {
  ensureInit();

  try {
    const options = {
      projectId: req.query.projectId || null,
      status: req.query.status || null,
      // Clamp limit to safe range (LS-019)
      limit: Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100)
    };

    const worlds = forge3dDb.listWorlds(options);
    res.json({ worlds });
  } catch (err) {
    console.error(`[WORLD] List error: ${err.message}`);
    errorHandler.report('world_error', err, { endpoint: 'list' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- World Status ---

/**
 * GET /api/world/:id
 * Get world status and associated regions.
 */
router.get('/:id', (req, res) => {
  ensureInit();
  const worldId = req.params.id;

  try {
    const world = forge3dDb.getWorld(worldId);
    if (!world) {
      return res.status(404).json({ error: 'World not found' });
    }

    const regions = forge3dDb.getWorldRegions(worldId);

    // Include pipeline status if active
    let pipelineStatus = null;
    if (world.pipeline_id) {
      pipelineStatus = assetPipelineRunner.getStatus(world.pipeline_id);
    }

    res.json({ world, regions, pipelineStatus });
  } catch (err) {
    console.error(`[WORLD] Status error: ${err.message}`);
    errorHandler.report('world_error', err, { endpoint: 'status', worldId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- SSE Stream ---

/**
 * GET /api/world/:id/stream
 * SSE stream for real-time world generation progress.
 * Events: stage_started, stage_completed, stage_failed,
 *         pipeline_complete, pipeline_failed
 */
router.get('/:id/stream', (req, res) => {
  ensureInit();
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  const worldId = req.params.id;
  const world = forge3dDb.getWorld(worldId);

  if (!world || !world.pipeline_id) {
    res.write(`data: ${JSON.stringify({ error: 'World or pipeline not found' })}\n\n`);
    res.end();
    return;
  }

  const pipelineId = world.pipeline_id;

  // If pipeline already finished before SSE connected, send result immediately
  const pipelineStatus = assetPipelineRunner.getStatus(pipelineId);
  if (pipelineStatus && (pipelineStatus.status === 'completed' || pipelineStatus.status === 'failed')) {
    res.write(`data: ${JSON.stringify({ pipelineId, worldId, status: pipelineStatus.status, done: true })}\n\n`);
    res.end();
    return;
  }

  // Fallback: check DB status if pipeline entry is already cleaned up
  if (!pipelineStatus) {
    const freshWorld = forge3dDb.getWorld(worldId);
    if (freshWorld && (freshWorld.status === 'complete' || freshWorld.status === 'failed')) {
      res.write(`data: ${JSON.stringify({ pipelineId, worldId, status: freshWorld.status, done: true })}\n\n`);
      res.end();
      return;
    }
  }

  // Heartbeat keepalive every 15s
  const heartbeat = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  // Safety timeout — close SSE after 10 minutes to prevent stuck connections
  const sseTimeout = setTimeout(() => {
    cleanup();
    res.write(`data: ${JSON.stringify({ worldId, timeout: true, done: true })}\n\n`);
    res.end();
  }, 600000);

  // Filter pipeline events to this world's pipeline
  const onEvent = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, worldId })}\n\n`);
    }
  };

  const onComplete = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, worldId, done: true })}\n\n`);
      cleanup();
      res.end();
    }
  };

  const cleanup = () => {
    clearInterval(heartbeat);
    clearTimeout(sseTimeout);
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

  // Re-check pipeline status after attaching listeners to catch race condition
  // where pipeline completed between initial check and listener registration
  const recheck = assetPipelineRunner.getStatus(pipelineId);
  if (recheck && (recheck.status === 'completed' || recheck.status === 'failed')) {
    res.write(`data: ${JSON.stringify({ pipelineId, worldId, status: recheck.status, done: true })}\n\n`);
    cleanup();
    res.end();
    return;
  }

  req.on('close', cleanup);
});

// --- Download ---

/**
 * GET /api/world/:id/download
 * Download the world package for a completed world.
 */
router.get('/:id/download', (req, res) => {
  ensureInit();
  const worldId = req.params.id;

  try {
    const world = forge3dDb.getWorld(worldId);
    if (!world) {
      return res.status(404).json({ error: 'World not found' });
    }

    if (world.status !== 'complete') {
      return res.status(400).json({ error: `World is not complete (status: ${world.status})` });
    }

    if (!world.export_path || !existsSync(world.export_path)) {
      return res.status(404).json({ error: 'World package file not found on disk' });
    }

    const safeName = world.name.replace(/[<>:"/\\|?*]/g, '_');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${safeName}_world.zip"`);

    const buffer = readFileSync(world.export_path);
    res.send(buffer);
  } catch (err) {
    console.error(`[WORLD] Download error: ${err.message}`);
    errorHandler.report('world_error', err, { endpoint: 'download', worldId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Delete ---

/**
 * DELETE /api/world/:id
 * Delete a world and its associated regions (cascade).
 */
router.delete('/:id', (req, res) => {
  ensureInit();
  const worldId = req.params.id;

  try {
    const world = forge3dDb.getWorld(worldId);
    if (!world) {
      return res.status(404).json({ error: 'World not found' });
    }

    // Cancel pipeline if still running
    if (world.pipeline_id) {
      assetPipelineRunner.cancel(world.pipeline_id);
    }

    const deleted = forge3dDb.deleteWorld(worldId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete world' });
    }

    res.json({ deleted: true, worldId });
  } catch (err) {
    console.error(`[WORLD] Delete error: ${err.message}`);
    errorHandler.report('world_error', err, { endpoint: 'delete', worldId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

export default router;

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[WORLD] Running route self-test...');

  // Verify router has expected routes
  const routes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  });

  console.log(`[WORLD] Registered routes: ${routes.length}`);
  for (const r of routes) {
    console.log(`  ${r}`);
  }

  // Verify expected routes exist
  console.assert(routes.some((r) => r.includes('POST') && r.includes('/generate')), 'Should have POST /generate');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id')), 'Should have GET /:id');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/list')), 'Should have GET /list');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id/stream')), 'Should have GET /:id/stream');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id/download')), 'Should have GET /:id/download');
  console.assert(routes.some((r) => r.includes('DELETE') && r.includes('/:id')), 'Should have DELETE /:id');

  // Verify sanitizeError works
  const sanitized = sanitizeError(new Error('File at C:\\Users\\test\\file.js failed'));
  console.assert(!sanitized.includes('C:\\'), 'Should remove Windows paths');
  console.assert(sanitized.includes('[path]'), 'Should replace with [path]');

  const sanitizedUnix = sanitizeError(new Error('File at /home/user/file.js failed'));
  console.assert(!sanitizedUnix.includes('/home'), 'Should remove Unix paths');

  console.log('[WORLD] Route self-test passed');
  process.exit(0);
}
