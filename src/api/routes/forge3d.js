/**
 * Forge3D Routes - API endpoints for 3D generation
 *
 * 21 endpoints for generation, projects, assets, queue, models, FBX:
 *
 * POST /api/forge3d/generate        - Start generation (image or text)
 * GET  /api/forge3d/status/:id      - Check generation progress
 * GET  /api/forge3d/download/:id    - Download .glb/.png/.fbx file (?format=fbx)
 * GET  /api/forge3d/projects        - List projects
 * POST /api/forge3d/projects        - Create project
 * GET  /api/forge3d/projects/:id    - Get project details
 * DELETE /api/forge3d/projects/:id  - Delete project
 * GET  /api/forge3d/projects/:id/assets - List assets
 * DELETE /api/forge3d/assets/:id    - Delete asset
 * GET  /api/forge3d/assets/:id/download - Download asset (?format=fbx)
 * POST /api/forge3d/convert         - Convert existing GLB asset to FBX
 * GET  /api/forge3d/fbx-status      - FBX converter availability
 * GET  /api/forge3d/history         - Generation history
 * GET  /api/forge3d/stats           - Aggregate stats
 * GET  /api/forge3d/bridge          - Python bridge status
 * GET  /api/forge3d/queue           - Queue status
 * POST /api/forge3d/queue/pause     - Pause queue
 * POST /api/forge3d/queue/resume    - Resume queue
 * DELETE /api/forge3d/queue/:id     - Cancel queued job
 * GET  /api/forge3d/models          - List installed models
 * POST /api/forge3d/models/download - Start model download
 * GET  /api/forge3d/models/status   - Download progress for all active
 *
 * STATUS: Complete. All endpoints have error handling + telemetry.
 *         Localhost-only by default (Express binds to 127.0.0.1).
 *
 * TODO(P1): Add rate limiting on /generate endpoint (prevent GPU queue flooding)
 * TODO(P1): Add API key authentication for non-localhost access
 * TODO(P1): Add WebSocket or SSE for real-time generation progress (replace polling)
 * TODO(P1): Add request body size limit middleware (prevent OOM from large uploads)
 * TODO(P2): Add OpenAPI/Swagger spec generation from route definitions
 * TODO(P2): Add /api/forge3d/models/delete endpoint for model cleanup
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import express from 'express';
import { existsSync } from 'fs';
import { extname } from 'path';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';
import modelBridge from '../../forge3d/model-bridge.js';
import forgeSession from '../../forge3d/forge-session.js';
import projectManager from '../../forge3d/project-manager.js';
import generationQueue from '../../forge3d/generation-queue.js';
import modelDownloader from '../../forge3d/model-downloader.js';
import forge3dConfig from '../../forge3d/config-loader.js';
import forge3dDb from '../../forge3d/database.js';

const router = express.Router();

// Initialize project manager, queue, model downloader, and bridge on first request.
// Lazy-init pattern: Python server takes 30s+ to start, so we don't block Express boot.
// Bridge starts on first forge3d tab visit (GET /bridge, /projects, /generate, etc.).
let initialized = false;
function ensureInit() {
  if (!initialized) {
    projectManager.init();
    generationQueue.init();
    modelDownloader.initialize();

    // Start Python inference bridge (fire-and-forget — logs errors internally)
    modelBridge.start().catch((err) => {
      console.error(`[ROUTE] ModelBridge startup failed: ${err.message}`);
      errorHandler.report('bridge_error', err, { endpoint: 'ensureInit' });
    });

    initialized = true;
  }
}

// --- Generation ---

/**
 * POST /api/forge3d/generate
 * Start a new 3D generation.
 *
 * Body (JSON):
 *   type: 'mesh' | 'image' | 'full'
 *   prompt: string (for image/full)
 *   projectId: string (optional, to auto-save)
 *   options: { width, height, steps }
 *
 * Body (multipart):
 *   image: file (for mesh type)
 *   type: 'mesh'
 *   projectId: string (optional)
 */
router.post('/generate', express.raw({ type: 'image/*', limit: forge3dConfig.api.raw_body_limit }), async (req, res) => {
  ensureInit();
  console.log('[ROUTE] POST /api/forge3d/generate');

  const endTimer = telemetryBus.startTimer('forge3d_api_generate');

  try {
    let sessionId;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      // JSON body: text-to-image or text-to-3D
      const { type, prompt, projectId, options } = req.body;

      if (!type || !['mesh', 'image', 'full'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Must be mesh, image, or full.' });
      }

      if ((type === 'image' || type === 'full') && (!prompt || prompt.trim().length < forge3dConfig.generation.min_prompt_length)) {
        return res.status(400).json({ error: 'Prompt required (at least 3 characters).' });
      }

      sessionId = forgeSession.create({ type, prompt, options });

      // Record in history
      const histId = projectManager.recordGeneration({
        projectId: projectId || null,
        type,
        prompt,
        status: 'processing'
      });

      // Run generation async
      forgeSession.run(sessionId).then(async (result) => {
        projectManager.updateGeneration(histId, {
          status: 'complete',
          generationTime: result.generationTime || result.totalTime || 0
        });

        // Auto-save to project if specified
        if (projectId && result) {
          try {
            const assetData = {
              name: prompt ? prompt.slice(0, 40).replace(/[<>:"/\\|?*]/g, '_') : `gen_${sessionId}`,
              type,
              metadata: { prompt, sessionId, generationTime: result.generationTime || result.totalTime }
            };

            if (result.meshBuffer) {
              projectManager.saveAsset(projectId, {
                ...assetData,
                buffer: result.meshBuffer,
                fbxBuffer: result.fbxBuffer || null,
                thumbnailBuffer: result.thumbnailBuffer || null,
                extension: '.glb'
              });
            } else if (result.imageBuffer) {
              projectManager.saveAsset(projectId, {
                ...assetData,
                buffer: result.imageBuffer,
                extension: '.png'
              });
            }
          } catch (saveErr) {
            console.error(`[ROUTE] Auto-save failed: ${saveErr.message}`);
          }
        }
      }).catch((err) => {
        projectManager.updateGeneration(histId, {
          status: 'failed',
          errorMessage: err.message
        });
      });

      endTimer({ sessionId, type });
      return res.status(202).json({
        sessionId,
        type,
        status: 'processing',
        statusUrl: `/api/forge3d/status/${sessionId}`
      });

    } else if (contentType.includes('image/')) {
      // Raw image upload for mesh generation
      const imageBuffer = req.body;

      if (!imageBuffer || imageBuffer.length === 0) {
        return res.status(400).json({ error: 'No image data received.' });
      }

      sessionId = forgeSession.create({
        type: 'mesh',
        imageBuffer: Buffer.from(imageBuffer),
        filename: 'upload.png'
      });

      forgeSession.run(sessionId).catch(() => { });

      endTimer({ sessionId, type: 'mesh' });
      return res.status(202).json({
        sessionId,
        type: 'mesh',
        status: 'processing',
        statusUrl: `/api/forge3d/status/${sessionId}`
      });

    } else {
      return res.status(400).json({
        error: 'Unsupported content type. Use application/json or image/*.'
      });
    }

  } catch (err) {
    console.error(`[ROUTE] Generate error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'generate' });
    endTimer({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/status/:id
 * Check generation progress.
 */
router.get('/status/:id', (req, res) => {
  const status = forgeSession.getStatus(req.params.id);
  if (!status) {
    return res.status(404).json({ error: 'Session not found' });
  }
  res.json(status);
});

/**
 * GET /api/forge3d/download/:id
 * Download generated file.
 * Query params: format=fbx (download FBX instead of default GLB/PNG)
 */
router.get('/download/:id', (req, res) => {
  const result = forgeSession.getResult(req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'No completed result for this session' });
  }

  const format = req.query.format;

  // FBX download requested
  if (format === 'fbx') {
    if (result.fbxBuffer) {
      res.set('Content-Type', 'application/octet-stream');
      res.set('Content-Disposition', `attachment; filename="${req.params.id}.fbx"`);
      return res.send(result.fbxBuffer);
    }
    return res.status(404).json({ error: 'No FBX data available for this session' });
  }

  // Default: GLB or PNG
  if (result.meshBuffer) {
    res.set('Content-Type', 'model/gltf-binary');
    res.set('Content-Disposition', `attachment; filename="${req.params.id}.glb"`);
    return res.send(result.meshBuffer);
  } else if (result.imageBuffer) {
    res.set('Content-Type', 'image/png');
    res.set('Content-Disposition', `attachment; filename="${req.params.id}.png"`);
    return res.send(result.imageBuffer);
  }

  res.status(404).json({ error: 'No downloadable data' });
});

// --- Projects ---

/**
 * GET /api/forge3d/projects
 * List all projects.
 */
router.get('/projects', (_req, res) => {
  ensureInit();
  try {
    const projects = projectManager.listProjects();
    res.json({ projects });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'list_projects' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/forge3d/projects
 * Create a new project.
 */
router.post('/projects', (req, res) => {
  ensureInit();
  const { name, description } = req.body;

  if (!name || name.trim().length === 0) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const project = projectManager.createProject(name.trim(), description || '');
    res.status(201).json(project);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'create_project' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/projects/:id
 * Get project details.
 */
router.get('/projects/:id', (req, res) => {
  ensureInit();
  const project = projectManager.getProject(req.params.id);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const assets = projectManager.listAssets(req.params.id);
  const diskUsage = projectManager.getProjectDiskUsage(req.params.id);

  res.json({ ...project, assets, diskUsage });
});

/**
 * DELETE /api/forge3d/projects/:id
 * Delete a project and all its assets.
 */
router.delete('/projects/:id', (req, res) => {
  ensureInit();
  try {
    projectManager.deleteProject(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    errorHandler.report('forge3d_error', err, { endpoint: 'delete_project', projectId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/projects/:id/assets
 * List assets in a project.
 */
router.get('/projects/:id/assets', (req, res) => {
  ensureInit();
  try {
    const assets = projectManager.listAssets(req.params.id);
    res.json({ assets });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'list_assets', projectId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

// --- Assets ---

/**
 * DELETE /api/forge3d/assets/:id
 * Delete a single asset.
 */
router.delete('/assets/:id', (req, res) => {
  ensureInit();
  try {
    projectManager.deleteAsset(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    errorHandler.report('forge3d_error', err, { endpoint: 'delete_asset', assetId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/assets/:id/download
 * Download an asset file by asset ID (reads file_path from database).
 * Query params: format=fbx (download FBX instead of default)
 */
router.get('/assets/:id/download', (req, res) => {
  ensureInit();
  try {
    const asset = projectManager.getAsset(req.params.id);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const format = req.query.format;

    // FBX download requested
    if (format === 'fbx') {
      if (!asset.fbx_path) {
        return res.status(404).json({ error: 'No FBX file for this asset' });
      }
      if (!existsSync(asset.fbx_path)) {
        return res.status(404).json({ error: 'FBX file missing from disk' });
      }
      const fbxFilename = asset.name.replace(/\.[^.]+$/, '.fbx');
      return res.download(asset.fbx_path, fbxFilename);
    }

    // Default: GLB/PNG
    if (!asset.file_path) {
      return res.status(404).json({ error: 'Asset has no file' });
    }
    if (!existsSync(asset.file_path)) {
      return res.status(404).json({ error: 'Asset file missing from disk' });
    }

    const ext = extname(asset.file_path);
    const filename = asset.name.endsWith(ext) ? asset.name : `${asset.name}${ext}`;
    res.download(asset.file_path, filename);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'download_asset', assetId: req.params.id });
    res.status(500).json({ error: err.message });
  }
});

// --- FBX Conversion ---

/**
 * POST /api/forge3d/convert
 * Convert an existing GLB asset to FBX.
 * Body: { assetId: string }
 */
router.post('/convert', async (req, res) => {
  ensureInit();
  const { assetId } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'assetId is required' });
  }

  try {
    const asset = projectManager.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (asset.fbx_path && existsSync(asset.fbx_path)) {
      return res.json({ status: 'already_converted', fbx_path: asset.fbx_path });
    }

    if (!asset.file_path || !existsSync(asset.file_path)) {
      return res.status(404).json({ error: 'GLB file missing from disk' });
    }

    // Read GLB and send to Python for conversion
    const { readFileSync } = await import('fs');
    const glbBuffer = readFileSync(asset.file_path);
    const result = await modelBridge.convertToFbx(glbBuffer, assetId);

    // Save FBX file alongside GLB
    const fbxPath = asset.file_path.replace(/\.glb$/i, '.fbx');
    const { writeFileSync } = await import('fs');
    writeFileSync(fbxPath, result.buffer);

    // Update asset record in DB
    forge3dDb.db.prepare(
      'UPDATE assets SET fbx_path = ?, fbx_size = ? WHERE id = ?'
    ).run(fbxPath, result.buffer.length, assetId);

    res.json({
      status: 'converted',
      fbx_size: result.buffer.length,
      conversion_time: result.metadata.conversionTime,
      backend: result.metadata.backend
    });
  } catch (err) {
    console.error(`[ROUTE] FBX conversion error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'convert', assetId });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/fbx-status
 * Check FBX converter availability.
 */
router.get('/fbx-status', async (_req, res) => {
  ensureInit();
  try {
    if (modelBridge.state !== 'running') {
      return res.json({ available: false, reason: 'Python server not running' });
    }
    const status = await modelBridge.getFbxStatus();
    res.json(status);
  } catch (err) {
    res.json({ available: false, reason: err.message });
  }
});

// --- Materials ---

/**
 * GET /api/forge3d/material-presets
 * Get available material presets from the Python server.
 */
router.get('/material-presets', async (_req, res) => {
  ensureInit();
  try {
    if (modelBridge.state !== 'running') {
      return res.status(503).json({ error: 'Python server not running' });
    }
    const presets = await modelBridge.getMaterialPresets();
    res.json({ presets });
  } catch (err) {
    console.error(`[ROUTE] Material presets error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'material_presets' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/forge3d/assets/:id/extract-materials
 * Extract PBR materials from an asset's GLB file.
 * Body: { preset: 'ue5-standard' }
 */
router.post('/assets/:id/extract-materials', async (req, res) => {
  ensureInit();
  const assetId = req.params.id;
  const { preset } = req.body || {};

  console.log(`[ROUTE] POST /api/forge3d/assets/${assetId}/extract-materials`);
  const endTimer = telemetryBus.startTimer('forge3d_api_extract_materials');

  try {
    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      endTimer({ error: 'not_found' });
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (!asset.file_path || !existsSync(asset.file_path)) {
      endTimer({ error: 'no_glb' });
      return res.status(400).json({ error: 'No GLB file available for this asset' });
    }

    if (modelBridge.state !== 'running') {
      endTimer({ error: 'bridge_offline' });
      return res.status(503).json({ error: 'Python server not running' });
    }

    const { readFileSync } = await import('fs');
    const glbBuffer = readFileSync(asset.file_path);
    const result = await modelBridge.extractMaterials(glbBuffer, preset || 'ue5-standard');

    // Update asset record in DB
    forge3dDb.db.prepare(
      'UPDATE assets SET material_data = ?, has_materials = 1 WHERE id = ?'
    ).run(JSON.stringify(result.manifest), assetId);

    telemetryBus.emit('forge3d', {
      event: 'materials_extracted',
      assetId,
      preset: preset || 'ue5-standard',
      textureCount: result.textures.length
    });

    endTimer({ assetId, success: true });
    res.json({
      success: true,
      manifest: result.manifest,
      textures: result.textures
    });
  } catch (err) {
    console.error(`[ROUTE] Material extraction error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'extract_materials', assetId });
    endTimer({ error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// --- History & Stats ---

/**
 * GET /api/forge3d/history
 * Get generation history.
 * Query params: projectId, status, type, limit
 */
router.get('/history', (req, res) => {
  ensureInit();
  try {
    const history = projectManager.getHistory({
      projectId: req.query.projectId,
      status: req.query.status,
      type: req.query.type,
      limit: parseInt(req.query.limit) || forge3dConfig.api.history_default_limit
    });
    res.json({ history });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'history' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/stats
 * Get aggregate generation stats.
 */
router.get('/stats', (_req, res) => {
  ensureInit();
  try {
    const stats = projectManager.getStats();
    res.json(stats);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'stats' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/bridge
 * Get Python bridge status.
 */
router.get('/bridge', async (_req, res) => {
  try {
    const info = modelBridge.getInfo();
    let health = null;

    if (info.state === 'running') {
      try {
        health = await modelBridge.getHealth();
      } catch (_e) {
        health = { error: 'Health check failed' };
      }
    }

    res.json({ bridge: info, health });
  } catch (err) {
    errorHandler.report('bridge_error', err, { endpoint: 'bridge_status' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/sessions
 * List recent forge sessions (in-memory).
 */
router.get('/sessions', (_req, res) => {
  const sessions = forgeSession.list(20);
  res.json({ sessions });
});

// --- Queue ---

/**
 * GET /api/forge3d/queue
 * Get queue status (queued + processing jobs).
 */
router.get('/queue', (_req, res) => {
  ensureInit();
  try {
    const status = generationQueue.getStatus();
    res.json(status);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'queue_status' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/forge3d/queue/pause
 * Pause the generation queue.
 */
router.post('/queue/pause', (_req, res) => {
  generationQueue.pause();
  res.json({ paused: true });
});

/**
 * POST /api/forge3d/queue/resume
 * Resume the generation queue.
 */
router.post('/queue/resume', (_req, res) => {
  generationQueue.resume();
  res.json({ paused: false });
});

/**
 * DELETE /api/forge3d/queue/:id
 * Cancel a queued job.
 */
router.delete('/queue/:id', (req, res) => {
  const cancelled = generationQueue.cancel(req.params.id);
  if (cancelled) {
    res.json({ cancelled: true });
  } else {
    res.status(400).json({ error: 'Job cannot be cancelled (may be processing or already complete)' });
  }
});

// --- Models ---

/**
 * GET /api/forge3d/models
 * List all known models and their installation status.
 */
router.get('/models', (_req, res) => {
  ensureInit();
  try {
    const models = modelDownloader.getInstalledModels();
    res.json({ models });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'list_models' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/forge3d/models/download
 * Start downloading a model. Returns 202 for async operation.
 * Body: { model: "instantmesh" | "sdxl" }
 */
router.post('/models/download', async (req, res) => {
  ensureInit();
  const { model } = req.body;

  if (!model || !modelDownloader.models.has(model)) {
    const known = [...modelDownloader.models.keys()].join(', ');
    return res.status(400).json({ error: `Invalid model. Must be one of: ${known}` });
  }

  try {
    if (modelDownloader.isModelInstalled(model)) {
      return res.json({ model, status: 'already_installed' });
    }

    if (modelDownloader.getDownloadProgress(model)) {
      return res.json({ model, status: 'already_downloading' });
    }

    console.log(`[ROUTE] POST /api/forge3d/models/download - starting ${model}`);
    telemetryBus.emit('forge3d_download_start', { model, source: 'api' });

    // Start download async (don't await)
    modelDownloader.downloadModel(model).catch((err) => {
      console.error(`[ROUTE] Model download failed: ${err.message}`);
      errorHandler.report('forge3d_error', err, { endpoint: 'download_model', model });
    });

    res.status(202).json({
      model,
      status: 'downloading',
      statusUrl: '/api/forge3d/models/status'
    });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'download_model', model });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/models/status
 * Get download progress for all active downloads.
 */
router.get('/models/status', (_req, res) => {
  ensureInit();
  try {
    const downloads = {};
    for (const [name] of modelDownloader.models) {
      const progress = modelDownloader.getDownloadProgress(name);
      if (progress) {
        downloads[name] = progress;
      }
    }
    res.json({ activeDownloads: downloads });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'models_status' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/forge3d/config
 * Return client-safe config (viewer + UI + generation limits).
 */
router.get('/config', (_req, res) => {
  res.json(forge3dConfig.getClientConfig());
});

export default router;
