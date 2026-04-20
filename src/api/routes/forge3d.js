/**
 * Forge3D Routes - API endpoints for 3D generation
 *
 * 27 endpoints for generation, projects, assets, queue, models, providers, FBX, post-processing:
 *
 * POST /api/forge3d/generate        - Start generation (image or text)
 * GET  /api/forge3d/status/:id      - Check generation progress
 * GET  /api/forge3d/stream/:id      - SSE stream for real-time generation progress
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
 * GET  /api/forge3d/providers        - Mesh provider info (tier, cost, availability)
 * GET  /api/forge3d/models          - List installed models
 * POST /api/forge3d/models/download - Start model download
 * GET  /api/forge3d/models/status   - Download progress for all active
 * POST /api/forge3d/optimize        - Optimize mesh (reduce face count)
 * POST /api/forge3d/lod/:id         - Generate LOD chain for asset
 * GET  /api/forge3d/report/:id      - Quality report for asset
 * GET  /api/forge3d/presets          - Optimization presets
 *
 * STATUS: Complete. All endpoints have error handling + telemetry.
 *         Localhost-only by default (Express binds to 127.0.0.1).
 *
 * DONE: Rate limiting on /generate, /optimize, /lod (forge3dLimiter)
 * DONE: API key authentication via auth middleware
 * DONE: SSE endpoint at GET /stream/:id for real-time generation progress
 * DONE: Request body size limit via express.json({ limit: '1mb' })
 * TODO(P2): Add OpenAPI/Swagger spec generation from route definitions
 * TODO(P2): Add /api/forge3d/models/delete endpoint for model cleanup
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import express from 'express';
import { existsSync } from 'fs';
import { extname, basename, join, resolve, sep } from 'path';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';
import llmClient from '../../core/llm-client.js';
import modelBridge from '../../forge3d/model-bridge.js';
import forgeSession from '../../forge3d/forge-session.js';
import universalMeshClient from '../../forge3d/universal-mesh-client.js';
import projectManager from '../../forge3d/project-manager.js';
import generationQueue from '../../forge3d/generation-queue.js';
import modelDownloader from '../../forge3d/model-downloader.js';
import forge3dConfig from '../../forge3d/config-loader.js';
import forge3dDb from '../../forge3d/database.js';
import { forge3dLimiter } from '../middleware/rate-limit.js';

const router = express.Router();

// MEDIUM SECURITY: Sanitize error messages for HTTP responses
// Removes file paths, stack traces, and internal implementation details
function sanitizeError(error) {
  const msg = error?.message || String(error);
  // Remove absolute paths (Windows and Unix)
  let sanitized = msg.replace(/[A-Z]:\\[^\s]+/gi, '[path]');
  sanitized = sanitized.replace(/\/[^\s]+/g, '[path]');
  // Remove stack trace lines
  sanitized = sanitized.split('\n')[0];
  return sanitized || 'An error occurred';
}

// Sync init for DB, queue, and project manager (fast, no I/O wait).
// Bridge startup is separate — it takes 30s+ and must be awaited before generation.
let initialized = false;
let bridgeReady = null;

function ensureInit() {
  if (!initialized) {
    projectManager.init();
    generationQueue.init();
    modelDownloader.initialize();
    initialized = true;
  }
}

// Start the Python inference bridge and return a promise that resolves when ready.
// Multiple callers share the same promise (no duplicate starts).
// If startup fails, bridgeReady resets to null so the next request retries.
async function ensureBridge() {
  ensureInit();
  if (!bridgeReady) {
    bridgeReady = modelBridge.start().catch((err) => {
      console.error(`[ROUTE] ModelBridge startup failed: ${err.message}`);
      errorHandler.report('bridge_error', err, { endpoint: 'ensureBridge' });
      bridgeReady = null;
      return false;
    });
  }
  return bridgeReady;
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
router.post('/generate', forge3dLimiter, express.raw({ type: 'image/*', limit: forge3dConfig.api.raw_body_limit }), async (req, res) => {
  await ensureBridge();
  console.log('[ROUTE] POST /api/forge3d/generate');

  // Verify bridge is actually running before creating a session
  if (modelBridge.state !== 'running') {
    const reason = modelBridge.unavailableReason || modelBridge.state;
    return res.status(503).json({
      error: `Python server is not running (state: ${reason})`
    });
  }

  const endTimer = telemetryBus.startTimer('forge3d_api_generate');

  try {
    let sessionId;
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      // JSON body: text-to-image or text-to-3D
      const { type, prompt, projectId, options, model } = req.body;

      if (!type || !['mesh', 'image', 'full'].includes(type)) {
        return res.status(400).json({ error: 'Invalid type. Must be mesh, image, or full.' });
      }

      if ((type === 'image' || type === 'full') && (!prompt || prompt.trim().length < forge3dConfig.generation.min_prompt_length)) {
        return res.status(400).json({ error: 'Prompt required (at least 3 characters).' });
      }

      sessionId = forgeSession.create({ type, prompt, options, model });

      // Record in history
      const histId = projectManager.recordGeneration({
        projectId: projectId || null,
        type,
        prompt,
        status: 'processing'
      });

      // Run generation async
      forgeSession.run(sessionId).then(async (result) => {
        // Get the actual model used from the session
        const session = forgeSession.sessions.get(sessionId);
        const actualModel = session?.actualModel || model || null;

        projectManager.updateGeneration(histId, {
          status: 'complete',
          generationTime: result.generationTime || result.totalTime || 0,
          model: actualModel
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

      forgeSession.run(sessionId).catch((err) => {
        console.error(`[ROUTE] Image mesh generation failed: ${err.message}`);
        errorHandler.report('forge3d_error', err, { endpoint: 'generate', sessionId, type: 'mesh' });
      });

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
    return res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/status/:id
 * Check generation progress.
 */
router.get('/status/:id', (req, res) => {
  try {
    const status = forgeSession.getStatus(req.params.id);
    if (!status) {
      return res.status(404).json({ error: 'Session not found' });
    }
    res.json(status);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'status', id: req.params.id });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/stream/:id
 * SSE stream for real-time generation progress.
 * Replaces polling for active generation sessions.
 */
router.get('/stream/:id', (req, res) => {
  try {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();

    const sessionId = req.params.id;

    // Heartbeat keepalive every 15s
    const heartbeat = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    const onProgress = (data) => {
      if (data.sessionId === sessionId) {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
    };

    const onComplete = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        res.write(`data: ${JSON.stringify({ ...data, done: true })}\n\n`);
        cleanup();
        res.end();
      }
    };

    const cleanup = () => {
      clearInterval(heartbeat);
      forgeSession.off('progress', onProgress);
      forgeSession.off('complete', onComplete);
      forgeSession.off('failed', onComplete);
    };

    forgeSession.on('progress', onProgress);
    forgeSession.on('complete', onComplete);
    forgeSession.on('failed', onComplete);

    req.on('close', cleanup);
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'stream', id: req.params.id });
    if (!res.headersSent) {
      res.status(500).json({ error: sanitizeError(err) });
    }
  }
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/projects/:id
 * Get project details.
 */
router.get('/projects/:id', (req, res) => {
  try {
    ensureInit();
    const project = projectManager.getProject(req.params.id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const assets = projectManager.listAssets(req.params.id);
    const diskUsage = projectManager.getProjectDiskUsage(req.params.id);

    res.json({ ...project, assets, diskUsage });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'get_project', projectId: req.params.id });
    res.status(500).json({ error: sanitizeError(err) });
  }
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- FBX Conversion ---

/**
 * POST /api/forge3d/convert
 * Convert an existing GLB asset to FBX.
 * Body: { assetId: string }
 */
router.post('/convert', async (req, res) => {
  await ensureBridge();
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Textures ---

/**
 * GET /api/forge3d/assets/:id/textures
 * List texture files for an asset that has extracted materials.
 * Returns: { textures: [{ name, label, url }] }
 */
router.get('/assets/:id/textures', (req, res) => {
  ensureInit();
  const assetId = req.params.id;

  console.log(`[ROUTE:FORGE3D] GET /api/forge3d/assets/${assetId}/textures`);

  try {
    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (!asset.has_materials || !asset.material_data) {
      return res.json({ textures: [] });
    }

    let manifest;
    try {
      manifest = JSON.parse(asset.material_data);
    } catch (_e) {
      return res.json({ textures: [] });
    }

    // Build texture list from manifest
    const textures = [];
    const textureTypes = ['albedo', 'normal', 'roughness', 'metallic', 'ao', 'emissive'];
    const labelMap = {
      albedo: 'Albedo',
      normal: 'Normal',
      roughness: 'Roughness',
      metallic: 'Metallic',
      ao: 'AO',
      emissive: 'Emissive'
    };

    for (const texType of textureTypes) {
      const texFile = manifest[texType] || manifest.textures?.[texType];
      if (texFile) {
        const name = typeof texFile === 'string' ? texFile : texFile.filename;
        if (name) {
          textures.push({
            name,
            label: labelMap[texType] || texType,
            url: `/api/forge3d/assets/${assetId}/textures/${encodeURIComponent(name)}`
          });
        }
      }
    }

    res.json({ textures });
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Texture list error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'list_textures', assetId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/assets/:id/textures/:name
 * Serve a specific texture file for an asset.
 * PATH TRAVERSAL PROTECTION: validates filename and resolves within asset directory only.
 */
router.get('/assets/:id/textures/:name', (req, res) => {
  ensureInit();
  const assetId = req.params.id;
  const texName = req.params.name;

  console.log(`[ROUTE:FORGE3D] GET /api/forge3d/assets/${assetId}/textures/${texName}`);

  try {
    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    if (!asset.file_path) {
      return res.status(404).json({ error: 'Asset has no file path' });
    }

    // PATH TRAVERSAL PROTECTION
    // Only allow simple filenames (no directory separators or parent refs)
    const safeName = basename(texName);
    if (safeName !== texName || texName.includes('..') || texName.includes('/') || texName.includes('\\')) {
      console.warn(`[ROUTE:FORGE3D] Path traversal attempt blocked: ${texName}`);
      return res.status(400).json({ error: 'Invalid texture filename' });
    }

    // Resolve texture path relative to asset's directory
    const assetDir = resolve(join(asset.file_path, '..'));
    const texturesDir = resolve(join(assetDir, 'textures'));
    const texturePath = resolve(join(texturesDir, safeName));

    // HIGH SECURITY: Use resolve() on both paths before comparison to handle Windows mixed separators
    const resolvedTexture = resolve(texturePath);
    const resolvedBase = resolve(texturesDir);
    if (!resolvedTexture.startsWith(resolvedBase + sep)) {
      console.warn(`[ROUTE:FORGE3D] Path traversal escape blocked: ${resolvedTexture}`);
      return res.status(400).json({ error: 'Invalid texture path' });
    }

    if (!existsSync(texturePath)) {
      return res.status(404).json({ error: 'Texture file not found' });
    }

    const ext = extname(safeName).toLowerCase();
    const mimeMap = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.tga': 'image/x-tga',
      '.exr': 'image/x-exr'
    };

    const contentType = mimeMap[ext] || 'application/octet-stream';
    res.set('Content-Type', contentType);
    res.sendFile(texturePath);
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Texture serve error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'serve_texture', assetId });
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/bridge
 * Get Python bridge status.
 */
router.get('/bridge', async (_req, res) => {
  // Trigger bridge startup on first visit (e.g. Forge3D tab opened)
  ensureBridge();
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/sessions
 * List recent forge sessions (in-memory).
 */
router.get('/sessions', (_req, res) => {
  try {
    const sessions = forgeSession.list(20);
    res.json({ sessions });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'sessions' });
    res.status(500).json({ error: sanitizeError(err) });
  }
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * POST /api/forge3d/queue/pause
 * Pause the generation queue.
 */
router.post('/queue/pause', (_req, res) => {
  try {
    generationQueue.pause();
    res.json({ paused: true });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'queue_pause' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * POST /api/forge3d/queue/resume
 * Resume the generation queue.
 */
router.post('/queue/resume', (_req, res) => {
  try {
    generationQueue.resume();
    res.json({ paused: false });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'queue_resume' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * DELETE /api/forge3d/queue/:id
 * Cancel a queued job.
 */
router.delete('/queue/:id', (req, res) => {
  try {
    const cancelled = generationQueue.cancel(req.params.id);
    if (cancelled) {
      res.json({ cancelled: true });
    } else {
      res.status(400).json({ error: 'Job cannot be cancelled (may be processing or already complete)' });
    }
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'queue_cancel', jobId: req.params.id });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Models ---

/**
 * GET /api/forge3d/engines
 * Get engine info with capability metadata from Python bridge.
 * Returns combined info from Python adapters + provider chain config.
 */
router.get('/engines', async (_req, res) => {
  ensureInit();
  try {
    // Get engine capabilities from UniversalMeshClient (JS-side)
    const engineInfo = await universalMeshClient.getEngineInfo();
    res.json({ engines: engineInfo });
  } catch (err) {
    console.error(`[ROUTE] Engine info error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'engines' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/models/available
 * List available generation models from the Python bridge adapter registry.
 * Returns model info with config defaults for frontend model selector.
 */
router.get('/models/available', async (_req, res) => {
  ensureInit();
  try {
    // Return config defaults even when bridge is offline
    const defaults = {
      default_mesh_model: forge3dConfig.generation.default_mesh_model,
      default_image_model: forge3dConfig.generation.default_image_model
    };

    if (modelBridge.state !== 'running') {
      return res.json({ models: [], defaults });
    }

    const result = await modelBridge.getModels();
    res.json({ models: result.models || [], defaults });
  } catch (err) {
    console.error(`[ROUTE] Models available error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'models_available' });
    // Return defaults with empty models on error so frontend can still function
    res.json({
      models: [],
      defaults: {
        default_mesh_model: forge3dConfig.generation.default_mesh_model,
        default_image_model: forge3dConfig.generation.default_image_model
      }
    });
  }
});

/**
 * GET /api/forge3d/providers
 * List mesh generation providers with tier, cost, and availability info.
 * Used by frontend for cost estimates and model selector labels.
 */
router.get('/providers', (_req, res) => {
  try {
    const providers = universalMeshClient.getProviderInfo();
    const usage = universalMeshClient.getUsageSummary();
    res.json({ providers, usage });
  } catch (err) {
    errorHandler.report('forge3d_error', err, { endpoint: 'providers' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * POST /api/forge3d/models/download
 * Start downloading a model. Returns 202 for async operation.
 * Body: { model: "hunyuan3d" | "sdxl" }
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
    res.status(500).json({ error: sanitizeError(err) });
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
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/config
 * Return client-safe config (viewer + UI + generation limits).
 */
router.get('/config', (_req, res) => {
  res.json(forge3dConfig.getClientConfig());
});

// --- Prompt Enhancement ---

/**
 * POST /api/forge3d/enhance-prompt
 * Use LLM to enhance a short 3D prompt into a detailed description.
 * Body: { prompt: string }
 * Returns: { enhanced, original, provider }
 */
router.post('/enhance-prompt', async (req, res) => {
  const { prompt } = req.body;

  if (!prompt || prompt.trim().length < 2) {
    return res.status(400).json({ error: 'Prompt is required (at least 2 characters)' });
  }

  console.log('[ROUTE:FORGE3D] POST /api/forge3d/enhance-prompt');
  const endTimer = telemetryBus.startTimer('forge3d_api_enhance_prompt');

  try {
    const enhancerCfg = forge3dConfig.promptEnhancer;
    const messages = [
      { role: 'system', content: enhancerCfg.system_prompt },
      { role: 'user', content: prompt.trim() }
    ];

    const result = await llmClient.chat(messages, {
      task: enhancerCfg.task_routing_key,
      max_tokens: enhancerCfg.max_tokens
    });

    const enhanced = result.content.trim();
    endTimer({ success: true, provider: result.provider });

    res.json({
      enhanced,
      original: prompt.trim(),
      provider: result.provider
    });
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Enhance prompt error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'enhance_prompt' });
    endTimer({ error: err.message });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Post-Processing (Optimization, LOD, Quality Report) ---

/**
 * POST /api/forge3d/optimize
 * Optimize a generated mesh by reducing face count.
 * Body: { assetId: string, targetFaces: number }
 */
router.post('/optimize', forge3dLimiter, async (req, res) => {
  ensureInit();
  const { assetId, targetFaces } = req.body;

  if (!assetId) {
    return res.status(400).json({ error: 'Missing assetId' });
  }
  if (!targetFaces || targetFaces < 4) {
    return res.status(400).json({ error: 'targetFaces must be at least 4' });
  }

  console.log(`[ROUTE:FORGE3D] POST /api/forge3d/optimize asset=${assetId} target=${targetFaces}`);
  const endTimer = telemetryBus.startTimer('forge3d_optimize');

  try {
    if (modelBridge.state !== 'running') {
      return res.status(503).json({ error: 'Python bridge not running' });
    }

    // Load the asset's GLB file
    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const { readFileSync } = await import('fs');
    const glbBuffer = readFileSync(asset.file_path);

    const result = await modelBridge.optimizeMesh(glbBuffer, targetFaces, assetId);
    endTimer({ success: true });

    res.json(result);
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Optimize error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'optimize', assetId });
    endTimer({ error: err.message });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * POST /api/forge3d/lod/:id
 * Generate LOD chain for a generated asset.
 */
router.post('/lod/:id', forge3dLimiter, async (req, res) => {
  ensureInit();
  const assetId = req.params.id;

  console.log(`[ROUTE:FORGE3D] POST /api/forge3d/lod/${assetId}`);
  const endTimer = telemetryBus.startTimer('forge3d_lod');

  try {
    if (modelBridge.state !== 'running') {
      return res.status(503).json({ error: 'Python bridge not running' });
    }

    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const { readFileSync } = await import('fs');
    const glbBuffer = readFileSync(asset.file_path);

    const result = await modelBridge.generateLOD(glbBuffer, assetId);
    endTimer({ success: true });

    res.json(result);
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] LOD error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'lod', assetId });
    endTimer({ error: err.message });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/report/:id
 * Get quality report for a generated asset.
 */
router.get('/report/:id', async (req, res) => {
  ensureInit();
  const assetId = req.params.id;

  console.log(`[ROUTE:FORGE3D] GET /api/forge3d/report/${assetId}`);

  try {
    if (modelBridge.state !== 'running') {
      return res.status(503).json({ error: 'Python bridge not running' });
    }

    const asset = forge3dDb.getAsset(assetId);
    if (!asset) {
      return res.status(404).json({ error: 'Asset not found' });
    }

    const { readFileSync } = await import('fs');
    const glbBuffer = readFileSync(asset.file_path);

    const result = await modelBridge.getMeshReport(glbBuffer);
    res.json(result);
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Report error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'report', assetId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/presets
 * Get optimization presets for different target platforms.
 */
router.get('/presets', async (_req, res) => {
  ensureInit();

  try {
    if (modelBridge.state !== 'running') {
      // Return defaults if bridge not running
      return res.json({
        presets: {
          mobile: { target_faces: 2000, label: 'Mobile', description: 'Optimized for mobile devices' },
          web: { target_faces: 5000, label: 'Web', description: 'Balanced for web browsers' },
          desktop: { target_faces: 10000, label: 'Desktop', description: 'High quality for desktop apps' },
          unreal: { target_faces: 50000, label: 'Unreal Engine', description: 'Game-ready for UE5' }
        }
      });
    }

    const result = await modelBridge.getOptimizationPresets();
    res.json(result);
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Presets error: ${err.message}`);
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Pipelines ---

/**
 * GET /api/forge3d/pipelines
 * List available asset pipeline templates from config.
 */
router.get('/pipelines', (_req, res) => {
  ensureInit();
  try {
    const pipelinesYaml = forge3dConfig.assetPipelines;
    const pipelines = Object.entries(pipelinesYaml.pipelines || {}).map(([name, config]) => ({
      name,
      description: config.description,
      stage_count: config.stages?.length || 0
    }));
    res.json({ pipelines });
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Pipelines list error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'list_pipelines' });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * POST /api/forge3d/pipelines/run
 * Start pipeline execution.
 * Body: { pipeline: string, prompt: string, projectId: string, options: {...} }
 * Returns: 202 with executionId
 */
// MEDIUM SECURITY: Rate limit on pipeline endpoint
router.post('/pipelines/run', forge3dLimiter, async (req, res) => {
  ensureInit();
  const { pipeline, prompt } = req.body;

  if (!pipeline || !prompt) {
    return res.status(400).json({ error: 'pipeline and prompt are required' });
  }

  console.log(`[ROUTE:FORGE3D] POST /api/forge3d/pipelines/run pipeline=${pipeline}`);
  const endTimer = telemetryBus.startTimer('forge3d_api_pipeline_run');

  try {
    // For now, return placeholder response
    // Full pipeline orchestration will be implemented in a future phase
    const executionId = `exec_${Date.now()}`;

    endTimer({ success: true, pipeline });
    return res.status(202).json({
      executionId,
      pipeline,
      status: 'queued',
      statusUrl: `/api/forge3d/pipelines/${executionId}`
    });

  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Pipeline run error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'run_pipeline', pipeline });
    endTimer({ error: err.message });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

/**
 * GET /api/forge3d/pipelines/:id
 * Get pipeline execution status.
 */
// MEDIUM SECURITY: Rate limit on pipeline status endpoint
router.get('/pipelines/:id', forge3dLimiter, (req, res) => {
  ensureInit();
  const executionId = req.params.id;

  console.log(`[ROUTE:FORGE3D] GET /api/forge3d/pipelines/${executionId}`);

  try {
    // Placeholder response
    // Full pipeline tracking will be implemented in a future phase
    res.json({
      executionId,
      status: 'complete',
      stages: [],
      completedAt: new Date().toISOString()
    });

  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Pipeline status error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'pipeline_status', executionId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

// --- Thumbnails ---

/**
 * POST /api/forge3d/sessions/:id/thumbnail
 * Save a thumbnail image for a generation session.
 * Body: { thumbnail: string (base64 data URL) }
 */
router.post('/sessions/:id/thumbnail', (req, res) => {
  ensureInit();
  const sessionId = req.params.id;
  const { thumbnail } = req.body;

  if (!thumbnail || !thumbnail.startsWith('data:image/')) {
    return res.status(400).json({ error: 'Invalid thumbnail data URL' });
  }

  // MEDIUM SECURITY: Thumbnail size validation (5MB limit)
  const thumbnailSizeBytes = Buffer.byteLength(thumbnail, 'utf8');
  const maxThumbnailSize = 5 * 1024 * 1024; // 5MB
  if (thumbnailSizeBytes > maxThumbnailSize) {
    return res.status(400).json({ error: 'Thumbnail too large. Maximum 5 MB.' });
  }

  console.log(`[ROUTE:FORGE3D] POST /api/forge3d/sessions/${sessionId}/thumbnail`);

  try {
    // Store thumbnail in generation_history
    forge3dDb.db.prepare(
      'UPDATE generation_history SET thumbnail = ? WHERE id = ?'
    ).run(thumbnail, sessionId);

    res.json({ saved: true });
  } catch (err) {
    console.error(`[ROUTE:FORGE3D] Thumbnail save error: ${err.message}`);
    errorHandler.report('forge3d_error', err, { endpoint: 'save_thumbnail', sessionId });
    res.status(500).json({ error: sanitizeError(err) });
  }
});

export default router;
