/**
 * Forge3D Routes - API endpoints for 3D generation
 *
 * POST /api/forge3d/generate        - Start generation (image or text)
 * GET  /api/forge3d/status/:id      - Check generation progress
 * GET  /api/forge3d/download/:id    - Download .glb or .png file
 * GET  /api/forge3d/projects        - List projects
 * POST /api/forge3d/projects        - Create project
 * GET  /api/forge3d/projects/:id    - Get project details
 * DELETE /api/forge3d/projects/:id  - Delete project
 * GET  /api/forge3d/projects/:id/assets - List assets
 * DELETE /api/forge3d/assets/:id    - Delete asset
 * GET  /api/forge3d/history         - Generation history
 * GET  /api/forge3d/stats           - Aggregate stats
 * GET  /api/forge3d/bridge          - Python bridge status
 * GET  /api/forge3d/queue           - Queue status
 * POST /api/forge3d/queue/pause     - Pause queue
 * POST /api/forge3d/queue/resume    - Resume queue
 * DELETE /api/forge3d/queue/:id     - Cancel queued job
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import express from 'express';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';
import modelBridge from '../../forge3d/model-bridge.js';
import forgeSession from '../../forge3d/forge-session.js';
import projectManager from '../../forge3d/project-manager.js';
import generationQueue from '../../forge3d/generation-queue.js';

const router = express.Router();

// Initialize project manager and queue on first request
let initialized = false;
function ensureInit() {
  if (!initialized) {
    projectManager.init();
    generationQueue.init();
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
router.post('/generate', express.raw({ type: 'image/*', limit: '20mb' }), async (req, res) => {
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

      if ((type === 'image' || type === 'full') && (!prompt || prompt.trim().length < 3)) {
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

      forgeSession.run(sessionId).catch(() => {});

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
 */
router.get('/download/:id', (req, res) => {
  const result = forgeSession.getResult(req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'No completed result for this session' });
  }

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
      limit: parseInt(req.query.limit) || 50
    });
    res.json({ history });
  } catch (err) {
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

export default router;
