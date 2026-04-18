/**
 * Model Intelligence API Routes
 *
 * Mounted at /api/models — scan, inventory, and SSE streaming
 * for the Model Intelligence subsystem.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { Router } from 'express';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import modelIntelligence from '../../model-intelligence/index.js';
import { EVENT_TYPES } from '../../model-intelligence/event-types.js';
import errorHandler from '../../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = Router();

// Lazy init: ensure ModelIntelligence is initialized before handling requests
let initPromise = null;
async function ensureInit() {
  if (!initPromise) {
    initPromise = modelIntelligence.init().catch(err => {
      console.error(`[MODEL-ROUTES] Init failed: ${err.message}`);
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

/**
 * GET /api/models/status
 * Return system status (initialized, last scan, file count)
 */
router.get('/status', async (req, res) => {
  try {
    await ensureInit();
    const status = modelIntelligence.getStatus();
    res.json(status);
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /status' });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * POST /api/models/scan
 * Start a scan. Body: { type: 'instant'|'deep', dirs: [...] }
 * Returns 202 with scanId.
 */
router.post('/scan', async (req, res) => {
  try {
    await ensureInit();
    const { type = 'instant', dirs = [] } = req.body || {};

    if (type !== 'instant' && type !== 'deep') {
      return res.status(400).json({ error: 'Invalid scan type. Use "instant" or "deep".' });
    }

    if (type === 'deep' && (!Array.isArray(dirs) || dirs.length === 0)) {
      return res.status(400).json({ error: 'Deep scan requires a non-empty dirs array.' });
    }

    // Fire-and-forget: start scan and return immediately
    const scanPromise = modelIntelligence.runScan(type, dirs);

    // Return immediately with pending status
    res.status(202).json({
      status: 'started',
      type,
      message: `${type} scan started. Use GET /api/models/scan/history or /api/models/stream to track progress.`
    });

    // Let the scan complete in the background
    scanPromise.catch(err => {
      errorHandler.report('model_intel_error', err, { route: 'POST /scan', type });
    });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'POST /scan' });
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

/**
 * GET /api/models/scan/history
 * Get scan history (paginated)
 */
router.get('/scan/history', async (req, res) => {
  try {
    await ensureInit();
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const history = modelIntelligence.getScanHistory(limit);
    res.json({ history, count: history.length });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /scan/history' });
    res.status(500).json({ error: 'Failed to get scan history' });
  }
});

/**
 * GET /api/models/scan/:id
 * Get scan status/results by ID
 */
router.get('/scan/:id', async (req, res) => {
  try {
    await ensureInit();
    const scan = modelIntelligence._db?.getScan(req.params.id);
    if (!scan) {
      return res.status(404).json({ error: 'Scan not found' });
    }
    res.json(scan);
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /scan/:id' });
    res.status(500).json({ error: 'Failed to get scan' });
  }
});

/**
 * GET /api/models/inventory
 * Combined inventory summary
 */
router.get('/inventory', async (req, res) => {
  try {
    await ensureInit();
    const inventory = modelIntelligence.getInventory();
    const stats = modelIntelligence.getStatus().stats;
    res.json({ ...inventory, stats });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /inventory' });
    res.status(500).json({ error: 'Failed to get inventory' });
  }
});

/**
 * GET /api/models/inventory/files
 * Model files list (with optional ?source=ollama filter)
 */
router.get('/inventory/files', async (req, res) => {
  try {
    await ensureInit();
    const filters = {};
    if (req.query.source) filters.source = req.query.source;
    if (req.query.extension) filters.extension = req.query.extension;
    if (req.query.format) filters.format = req.query.format;
    if (req.query.limit) filters.limit = req.query.limit;

    const files = modelIntelligence._db?.getModelFiles(filters) ?? [];
    res.json({ files, count: files.length });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /inventory/files' });
    res.status(500).json({ error: 'Failed to get model files' });
  }
});

/**
 * GET /api/models/inventory/runtimes
 * Runtime inventory
 */
router.get('/inventory/runtimes', async (req, res) => {
  try {
    await ensureInit();
    const runtimes = modelIntelligence._db?.getRuntimes() ?? [];
    res.json({ runtimes, count: runtimes.length });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /inventory/runtimes' });
    res.status(500).json({ error: 'Failed to get runtimes' });
  }
});

/**
 * GET /api/models/inventory/storage
 * Storage topology
 */
router.get('/inventory/storage', async (req, res) => {
  try {
    await ensureInit();
    const storage = modelIntelligence._db?.getStorageVolumes() ?? [];
    res.json({ storage, count: storage.length });
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'GET /inventory/storage' });
    res.status(500).json({ error: 'Failed to get storage' });
  }
});

/**
 * GET /api/models/stream
 * SSE endpoint for real-time scan events
 */
router.get('/stream', async (req, res) => {
  try {
    await ensureInit();
  } catch (err) {
    return res.status(500).json({ error: 'ModelIntelligence not available' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  res.write('data: {"type":"connected"}\n\n');

  const listeners = {};
  for (const eventType of Object.values(EVENT_TYPES)) {
    const handler = (data) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    listeners[eventType] = handler;
    modelIntelligence._scanner?.on(eventType, handler);
  }

  // Heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write('data: {"type":"heartbeat"}\n\n');
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    for (const [eventType, handler] of Object.entries(listeners)) {
      modelIntelligence._scanner?.off(eventType, handler);
    }
  });
});

/**
 * POST /api/models/export
 * Export inventory as downloadable JSON
 */
router.post('/export', async (req, res) => {
  try {
    await ensureInit();
    const inventory = modelIntelligence.getInventory();
    const status = modelIntelligence.getStatus();

    const exportData = {
      exported_at: new Date().toISOString(),
      version: '1.0.0',
      status,
      inventory
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename=model-intelligence-export.json');
    res.json(exportData);
  } catch (err) {
    errorHandler.report('model_intel_error', err, { route: 'POST /export' });
    res.status(500).json({ error: 'Failed to export inventory' });
  }
});

export default router;
