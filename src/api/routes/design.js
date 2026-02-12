/**
 * Design Routes - API endpoints for design generation
 *
 * POST /api/design/generate - Generate design from prompt
 * POST /api/design/approve - Save/export design
 * POST /api/design/cancel - Discard pending design
 * GET /api/design/status/:id - Check generation progress
 * GET /api/design/styles - List available styles
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import express from 'express';
import { designEngine } from '../../core/design-engine.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const router = express.Router();

// In-memory storage for pending designs (keyed by session ID)
const pendingDesigns = new Map();

/**
 * POST /api/design/generate
 * Generate design from prompt
 */
router.post('/generate', async (req, res) => {
  const { prompt, style, options } = req.body;

  if (!prompt) {
    return res.status(400).json({ error: 'Missing required field: prompt' });
  }

  const sessionId = req.sessionID || `design-${Date.now()}`;
  console.log(`[ROUTE] POST /api/design/generate - sessionId: ${sessionId}`);

  const endTimer = telemetryBus.startTimer('design_api_generate', { sessionId });

  try {
    // Generate design
    const design = await designEngine.generateDesign(prompt, {
      styleName: style || 'default',
      ...options
    });

    // Store pending design
    pendingDesigns.set(sessionId, design);

    // Return preview data (without full HTML to save bandwidth)
    res.json({
      success: true,
      sessionId,
      preview: {
        images: design.images.map(img => ({
          path: img.path,
          provider: img.provider,
          role: img.role,
          alt: img.alt
        })),
        style: design.style,
        cost: design.cost,
        htmlLength: design.html.length,
        timestamp: design.timestamp
      }
    });

    endTimer({ status: 'success' });
  } catch (error) {
    console.error(`[ROUTE] Design generation error: ${error.message}`);
    errorHandler.report('design_api_error', error, { prompt, sessionId });
    endTimer({ status: 'failed', error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/design/approve
 * Save/export design
 */
router.post('/approve', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required field: sessionId' });
  }

  console.log(`[ROUTE] POST /api/design/approve - sessionId: ${sessionId}`);

  const design = pendingDesigns.get(sessionId);
  if (!design) {
    return res.status(404).json({ error: 'Design not found or already expired' });
  }

  try {
    // Export design to disk
    const outputPath = await designEngine.exportDesign(design);

    // Remove from pending
    pendingDesigns.delete(sessionId);

    res.json({
      success: true,
      outputPath
    });

    telemetryBus.emit('design_exported', { sessionId, outputPath });
  } catch (error) {
    console.error(`[ROUTE] Design export error: ${error.message}`);
    errorHandler.report('design_export_error', error, { sessionId });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/design/cancel
 * Discard pending design
 */
router.post('/cancel', async (req, res) => {
  const { sessionId } = req.body;

  if (!sessionId) {
    return res.status(400).json({ error: 'Missing required field: sessionId' });
  }

  console.log(`[ROUTE] POST /api/design/cancel - sessionId: ${sessionId}`);

  if (pendingDesigns.has(sessionId)) {
    pendingDesigns.delete(sessionId);
  }

  res.json({ success: true });
  telemetryBus.emit('design_cancelled', { sessionId });
});

/**
 * GET /api/design/status/:id
 * Check generation progress (for async implementations)
 */
router.get('/status/:id', (req, res) => {
  const sessionId = req.params.id;
  console.log(`[ROUTE] GET /api/design/status/${sessionId}`);

  const design = pendingDesigns.get(sessionId);
  if (!design) {
    return res.json({
      status: 'not_found',
      exists: false
    });
  }

  res.json({
    status: 'ready',
    exists: true,
    preview: {
      images: design.images.length,
      style: design.style,
      cost: design.cost
    }
  });
});

/**
 * GET /api/design/styles
 * List available styles
 */
router.get('/styles', (req, res) => {
  console.log('[ROUTE] GET /api/design/styles');

  try {
    const styles = designEngine.getAvailableStyles();
    res.json({
      success: true,
      styles: styles.map(name => ({
        name,
        label: name.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      }))
    });
  } catch (error) {
    console.error(`[ROUTE] Error listing styles: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Cleanup old pending designs every 30 minutes
setInterval(() => {
  const now = Date.now();
  const timeout = 30 * 60 * 1000; // 30 minutes

  for (const [sessionId, design] of pendingDesigns.entries()) {
    const age = now - new Date(design.timestamp).getTime();
    if (age > timeout) {
      console.log(`[ROUTE] Cleaning up expired design: ${sessionId}`);
      pendingDesigns.delete(sessionId);
    }
  }
}, 30 * 60 * 1000);

export default router;
