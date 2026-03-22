/** Scene Routes - API endpoints for AI Scene Generator
 *
 * 8 endpoints for scene generation, status, streaming, download, and management:
 *
 * POST /api/scene/generate        - Start scene generation (returns 202)
 * GET  /api/scene/:id             - Scene status + assets
 * GET  /api/scene/:id/stream      - SSE for generation progress
 * GET  /api/scene/list            - List scenes (filter by projectId, status)
 * GET  /api/scene/:id/download    - Download assembled GLB
 * GET  /api/scene/:id/descriptor  - Download scene descriptor JSON
 * DELETE /api/scene/:id           - Delete scene
 * GET  /api/scene/:id/assets      - Get individual asset details
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

// --- Scene Generation ---

/**
 * POST /api/scene/generate
 * Start scene generation pipeline.
 * Body: { prompt: string, projectId?: string, maxAssets?: number }
 * Returns 202 with sceneId and pipelineId.
 */
router.post('/generate', forge3dLimiter, (req, res) => {
  ensureInit();
  console.log('[SCENE] POST /api/scene/generate');
  const endTimer = telemetryBus.startTimer('scene_api_generate');

  try {
    const { prompt, projectId, maxAssets } = req.body;

    // Validate prompt
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) {
      endTimer({ error: 'invalid_prompt' });
      return res.status(400).json({ error: 'Prompt is required (at least 3 characters)' });
    }

    if (prompt.length > 2000) {
      endTimer({ error: 'prompt_too_long' });
      return res.status(400).json({ error: 'Prompt must be under 2000 characters' });
    }

    // Sanitize prompt into a short name for the scene
    const sanitizedName = prompt.slice(0, 60).replace(/[<>:"/\\|?*\n\r]/g, '_').trim();

    // Create scene record in DB
    const scene = forge3dDb.createScene({
      projectId: projectId || null,
      name: sanitizedName,
      prompt: prompt.trim(),
      sceneType: 'outdoor'
    });

    // Clamp maxAssets to safe range at API boundary
    const clampedMaxAssets = Math.min(Math.max(parseInt(maxAssets, 10) || 10, 1), 20);

    // Start pipeline (fire-and-forget)
    const pipelineId = assetPipelineRunner.start('generate_scene', {
      prompt: prompt.trim(),
      projectId: projectId || null,
      sceneId: scene.id,
      maxAssets: clampedMaxAssets
    });

    // Update scene with pipeline ID and set status to analyzing
    forge3dDb.updateScene(scene.id, {
      pipelineId,
      status: 'analyzing'
    });

    endTimer({ sceneId: scene.id, pipelineId });

    return res.status(202).json({
      sceneId: scene.id,
      pipelineId,
      status: 'analyzing',
      statusUrl: `/api/scene/${scene.id}`,
      streamUrl: `/api/scene/${scene.id}/stream`
    });
  } catch (err) {
    console.error(`[SCENE] Generate error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'generate' });
    endTimer({ error: err.message });
    return res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- List Scenes ---
// NOTE: /list must be registered BEFORE /:id to avoid Express matching "list" as an :id param

/**
 * GET /api/scene/list
 * List scenes with optional filters.
 * Query: ?projectId=x&status=x&limit=N
 */
router.get('/list', (req, res) => {
  ensureInit();

  try {
    const options = {
      projectId: req.query.projectId || null,
      status: req.query.status || null,
      limit: parseInt(req.query.limit) || 50
    };

    const scenes = forge3dDb.listScenes(options);
    res.json({ scenes });
  } catch (err) {
    console.error(`[SCENE] List error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'list' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Scene Status ---

/**
 * GET /api/scene/:id
 * Get scene status and associated assets.
 */
router.get('/:id', (req, res) => {
  ensureInit();
  const sceneId = req.params.id;

  try {
    const scene = forge3dDb.getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    const assets = forge3dDb.getSceneAssets(sceneId);

    // Include pipeline status if active
    let pipelineStatus = null;
    if (scene.pipeline_id) {
      pipelineStatus = assetPipelineRunner.getStatus(scene.pipeline_id);
    }

    res.json({ scene, assets, pipelineStatus });
  } catch (err) {
    console.error(`[SCENE] Status error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'status', sceneId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- SSE Stream ---

/**
 * GET /api/scene/:id/stream
 * SSE stream for real-time scene generation progress.
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

  const sceneId = req.params.id;
  const scene = forge3dDb.getScene(sceneId);

  if (!scene || !scene.pipeline_id) {
    res.write(`data: ${JSON.stringify({ error: 'Scene or pipeline not found' })}\n\n`);
    res.end();
    return;
  }

  const pipelineId = scene.pipeline_id;

  // Heartbeat keepalive every 15s
  const heartbeat = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  // Filter pipeline events to this scene's pipeline
  const onEvent = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, sceneId })}\n\n`);
    }
  };

  const onComplete = (data) => {
    if (data.pipelineId === pipelineId) {
      clearInterval(heartbeat);
      res.write(`data: ${JSON.stringify({ ...data, sceneId, done: true })}\n\n`);
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
 * GET /api/scene/:id/download
 * Download the assembled GLB file for a completed scene.
 */
router.get('/:id/download', (req, res) => {
  ensureInit();
  const sceneId = req.params.id;

  try {
    const scene = forge3dDb.getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    if (scene.status !== 'complete') {
      return res.status(400).json({ error: `Scene is not complete (status: ${scene.status})` });
    }

    if (!scene.assembled_path || !existsSync(scene.assembled_path)) {
      return res.status(404).json({ error: 'Assembled GLB file not found on disk' });
    }

    const safeName = scene.name.replace(/[<>:"/\\|?*]/g, '_');
    res.set('Content-Type', 'model/gltf-binary');
    res.set('Content-Disposition', `attachment; filename="${safeName}.glb"`);

    const buffer = readFileSync(scene.assembled_path);
    res.send(buffer);
  } catch (err) {
    console.error(`[SCENE] Download error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'download', sceneId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Descriptor ---

/**
 * GET /api/scene/:id/descriptor
 * Download the scene descriptor JSON (graph + asset references).
 */
router.get('/:id/descriptor', (req, res) => {
  ensureInit();
  const sceneId = req.params.id;

  try {
    const scene = forge3dDb.getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    if (scene.descriptor_path && existsSync(scene.descriptor_path)) {
      const descriptor = readFileSync(scene.descriptor_path, 'utf8');
      res.set('Content-Type', 'application/json');
      return res.send(descriptor);
    }

    // Fallback: build descriptor from DB data (omit internal file paths)
    const assets = forge3dDb.getSceneAssets(sceneId);
    const descriptor = {
      sceneId: scene.id,
      name: scene.name,
      prompt: scene.prompt,
      sceneType: scene.scene_type,
      status: scene.status,
      sceneGraph: scene.scene_graph,
      assets: assets.map((a) => ({
        id: a.id,
        nodeId: a.node_id,
        nodeName: a.node_name,
        prompt: a.prompt,
        position: { x: a.position_x, y: a.position_y, z: a.position_z },
        rotation: { x: a.rotation_x, y: a.rotation_y, z: a.rotation_z },
        scale: { x: a.scale_x, y: a.scale_y, z: a.scale_z },
        status: a.status,
        fileSize: a.file_size
      })),
      assembledSize: scene.assembled_size,
      generationTime: scene.generation_time,
      createdAt: scene.created_at,
      completedAt: scene.completed_at,
      downloadUrl: `/api/scene/${scene.id}/download`
    };

    res.json(descriptor);
  } catch (err) {
    console.error(`[SCENE] Descriptor error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'descriptor', sceneId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Delete ---

/**
 * DELETE /api/scene/:id
 * Delete a scene and its associated assets (cascade).
 */
router.delete('/:id', (req, res) => {
  ensureInit();
  const sceneId = req.params.id;

  try {
    const scene = forge3dDb.getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    // Cancel pipeline if still running
    if (scene.pipeline_id) {
      assetPipelineRunner.cancel(scene.pipeline_id);
    }

    const deleted = forge3dDb.deleteScene(sceneId);
    if (!deleted) {
      return res.status(500).json({ error: 'Failed to delete scene' });
    }

    res.json({ deleted: true, sceneId });
  } catch (err) {
    console.error(`[SCENE] Delete error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'delete', sceneId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Individual Asset Details ---

/**
 * GET /api/scene/:id/assets
 * Get individual asset details for a scene.
 */
router.get('/:id/assets', (req, res) => {
  ensureInit();
  const sceneId = req.params.id;

  try {
    const scene = forge3dDb.getScene(sceneId);
    if (!scene) {
      return res.status(404).json({ error: 'Scene not found' });
    }

    const assets = forge3dDb.getSceneAssets(sceneId);
    res.json({ sceneId, assets });
  } catch (err) {
    console.error(`[SCENE] Assets error: ${err.message}`);
    errorHandler.report('scene_error', err, { endpoint: 'assets', sceneId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

export default router;

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[SCENE] Running route self-test...');

  // Verify router has expected routes
  const routes = [];
  router.stack.forEach((layer) => {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).join(',').toUpperCase();
      routes.push(`${methods} ${layer.route.path}`);
    }
  });

  console.log(`[SCENE] Registered routes: ${routes.length}`);
  for (const r of routes) {
    console.log(`  ${r}`);
  }

  // Verify expected routes exist
  console.assert(routes.some((r) => r.includes('POST') && r.includes('/generate')), 'Should have POST /generate');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/:id')), 'Should have GET /:id');
  console.assert(routes.some((r) => r.includes('GET') && r.includes('/list')), 'Should have GET /list');
  console.assert(routes.some((r) => r.includes('DELETE') && r.includes('/:id')), 'Should have DELETE /:id');

  // Verify sanitizeError works
  const sanitized = sanitizeError(new Error('File at C:\\Users\\test\\file.js failed'));
  console.assert(!sanitized.includes('C:\\'), 'Should remove Windows paths');
  console.assert(sanitized.includes('[path]'), 'Should replace with [path]');

  const sanitizedUnix = sanitizeError(new Error('File at /home/user/file.js failed'));
  console.assert(!sanitizedUnix.includes('/home'), 'Should remove Unix paths');

  console.log('[SCENE] Route self-test passed');
  process.exit(0);
}
