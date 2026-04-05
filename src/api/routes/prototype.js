/** Prototype Routes - API endpoints for AI Gameplay & Prototype Generator (Phase 16)
 *
 * 6 endpoints for gameplay prototype generation, status, streaming, download, and management:
 *
 * POST /api/prototype/generate        - Start gameplay prototype generation (returns 202)
 * GET  /api/prototype/list            - List prototypes (filter by worldId, status)
 * GET  /api/prototype/:id             - Prototype status + NPCs + quests + interactions
 * GET  /api/prototype/:id/stream      - SSE for generation progress
 * GET  /api/prototype/:id/download    - Download prototype bundle
 * DELETE /api/prototype/:id           - Delete prototype
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

// --- Prototype Generation ---

/**
 * POST /api/prototype/generate
 * Start gameplay prototype generation pipeline.
 * Body: { prompt: string, worldId?: string, genre?: string }
 * Returns 202 with prototypeId and pipelineId.
 */
router.post('/generate', forge3dLimiter, (req, res) => {
  ensureInit();
  console.log('[PROTOTYPE] POST /api/prototype/generate');
  const endTimer = telemetryBus.startTimer('prototype_api_generate');

  try {
    const { prompt, worldId, genre } = req.body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      endTimer({ error: 'invalid_prompt' });
      return res.status(400).json({ error: 'Prompt is required (at least 3 characters)' });
    }

    if (prompt.length > 2000) {
      endTimer({ error: 'prompt_too_long' });
      return res.status(400).json({ error: 'Prompt must be under 2000 characters' });
    }

    // Validate genre (optional)
    const validGenres = ['rpg', 'fps', 'puzzle', 'platformer', 'adventure', 'survival', 'strategy'];
    const sanitizedGenre = validGenres.includes(genre) ? genre : null;

    // Sanitize prompt into a short name for the prototype
    const sanitizedName = prompt.slice(0, 60).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();

    // Create prototype record in DB
    const prototype = forge3dDb.createPrototype({
      worldId: worldId || null,
      name: sanitizedName,
      prompt: prompt.trim(),
      genre: sanitizedGenre
    });

    // Start pipeline (fire-and-forget)
    const pipelineId = assetPipelineRunner.start('generate_prototype', {
      prompt: prompt.trim(),
      worldId: worldId || null,
      prototypeId: prototype.id,
      genre: sanitizedGenre
    });

    // Update prototype with pipeline ID and set status to generating
    forge3dDb.updatePrototype(prototype.id, {
      pipelineId,
      status: 'generating'
    });

    endTimer({ prototypeId: prototype.id, pipelineId });

    return res.status(202).json({
      prototypeId: prototype.id,
      pipelineId,
      status: 'generating',
      statusUrl: `/api/prototype/${prototype.id}`,
      streamUrl: `/api/prototype/${prototype.id}/stream`
    });
  } catch (err) {
    console.error(`[PROTOTYPE] Generate error: ${err.message}`);
    errorHandler.report('prototype_error', err, { endpoint: 'generate' });
    endTimer({ error: err.message });
    return res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- List Prototypes ---
// NOTE: /list must be registered BEFORE /:id to avoid Express matching "list" as an :id param

/**
 * GET /api/prototype/list
 * List prototypes with optional filters.
 * Query: ?worldId=x&status=x&limit=N
 */
router.get('/list', (req, res) => {
  ensureInit();

  try {
    const options = {
      worldId: req.query.worldId || null,
      status: req.query.status || null,
      // Clamp limit to safe range (LS-019)
      limit: Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100)
    };

    const prototypes = forge3dDb.listPrototypes(options);
    res.json({ prototypes });
  } catch (err) {
    console.error(`[PROTOTYPE] List error: ${err.message}`);
    errorHandler.report('prototype_error', err, { endpoint: 'list' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Prototype Status ---

/**
 * GET /api/prototype/:id
 * Get prototype status and associated NPCs, quests, and interactions.
 */
router.get('/:id', (req, res) => {
  ensureInit();
  const prototypeId = req.params.id;

  try {
    const prototype = forge3dDb.getPrototype(prototypeId);
    if (!prototype) {
      return res.status(404).json({ error: 'Prototype not found' });
    }

    const npcs = forge3dDb.getNPCsByPrototype(prototypeId);
    const quests = forge3dDb.getQuestsByPrototype(prototypeId);
    const interactions = forge3dDb.getInteractionsByPrototype(prototypeId);

    // Include pipeline status if active
    let pipelineStatus = null;
    if (prototype.pipeline_id) {
      pipelineStatus = assetPipelineRunner.getStatus(prototype.pipeline_id);
    }

    res.json({ prototype, npcs, quests, interactions, pipelineStatus });
  } catch (err) {
    console.error(`[PROTOTYPE] Status error: ${err.message}`);
    errorHandler.report('prototype_error', err, { endpoint: 'status', prototypeId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- SSE Stream ---

/**
 * GET /api/prototype/:id/stream
 * SSE stream for real-time prototype generation progress.
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

  const prototypeId = req.params.id;
  const prototype = forge3dDb.getPrototype(prototypeId);

  if (!prototype || !prototype.pipeline_id) {
    res.write(`data: ${JSON.stringify({ error: 'Prototype or pipeline not found' })}\n\n`);
    res.end();
    return;
  }

  const pipelineId = prototype.pipeline_id;

  // Heartbeat keepalive every 15s
  const heartbeat = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  // Filter pipeline events to this prototype's pipeline
  const onEvent = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, prototypeId })}\n\n`);
    }
  };

  const onComplete = (data) => {
    if (data.pipelineId === pipelineId) {
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ ...data, prototypeId, done: true })}\n\n`);
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

// --- Download ---

/**
 * GET /api/prototype/:id/download
 * Download the prototype bundle for a completed prototype.
 */
router.get('/:id/download', (req, res) => {
  ensureInit();
  const prototypeId = req.params.id;

  try {
    const prototype = forge3dDb.getPrototype(prototypeId);
    if (!prototype) {
      return res.status(404).json({ error: 'Prototype not found' });
    }

    if (prototype.status !== 'complete') {
      return res.status(400).json({ error: `Prototype is not complete (status: ${prototype.status})` });
    }

    if (!prototype.bundle_path || !existsSync(prototype.bundle_path)) {
      return res.status(404).json({ error: 'Prototype bundle file not found on disk' });
    }

    const safeName = prototype.name.replace(/[<>:"/\\|?*]/g, '_');
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', `attachment; filename="${safeName}_prototype.zip"`);

    const buffer = readFileSync(prototype.bundle_path);
    res.send(buffer);
  } catch (err) {
    console.error(`[PROTOTYPE] Download error: ${err.message}`);
    errorHandler.report('prototype_error', err, { endpoint: 'download', prototypeId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Delete ---

/**
 * DELETE /api/prototype/:id
 * Delete a prototype and its associated NPCs, quests, and interactions (cascade).
 */
router.delete('/:id', (req, res) => {
  ensureInit();
  const prototypeId = req.params.id;

  try {
    const prototype = forge3dDb.getPrototype(prototypeId);
    if (!prototype) {
      return res.status(404).json({ error: 'Prototype not found' });
    }

    // Cancel pipeline if still running
    if (prototype.pipeline_id) {
      assetPipelineRunner.cancel(prototype.pipeline_id);
    }

    const deleted = forge3dDb.deletePrototype(prototypeId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete prototype' });
    }

    res.json({ deleted: true, prototypeId });
  } catch (err) {
    console.error(`[PROTOTYPE] Delete error: ${err.message}`);
    errorHandler.report('prototype_error', err, { endpoint: 'delete', prototypeId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

export default router;

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[PROTOTYPE] Running route self-test...');

  // Verify router has expected routes
  const routes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  });

  console.log(`[PROTOTYPE] Registered routes: ${routes.length}`);
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

  console.log('[PROTOTYPE] Route self-test passed');
  process.exit(0);
}
