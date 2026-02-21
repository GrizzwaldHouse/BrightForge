/**
 * BrightForge Express Server
 *
 * HTTP API for the coding agent. Serves:
 * - /api/chat/* - Chat and plan management
 * - /api/sessions/* - Session history
 * - /api/config - Provider config (sanitized)
 * - /api/health - Health check
 * - / - Static frontend from public/
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { SessionStore } from './session-store.js';
import { chatRoutes } from './routes/chat.js';
import { sessionRoutes } from './routes/sessions.js';
import { configRoutes } from './routes/config.js';
import { errorRoutes } from './routes/errors.js';
import { metricsRoutes } from './routes/metrics.js';
import designRoutes from './routes/design.js';
import forge3dRoutes from './routes/forge3d.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(options = {}) {
  const app = express();
  const store = new SessionStore({ timeoutMs: options.sessionTimeout || 30 * 60 * 1000 });

  // ModelBridge is NOT started here on purpose.
  // Python takes 30s+ to start (model loading), so we use lazy-init in forge3d routes.
  // The bridge starts on first forge3d tab visit via ensureInit() in routes/forge3d.js.

  console.log('[SERVER] Creating Express server...');

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // CORS for local development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // Attach store to all requests
  app.use((req, res, next) => {
    req.store = store;
    req.sessionsDir = options.sessionsDir || join(__dirname, '../../sessions');
    next();
  });

  // API routes
  app.use('/api/chat', chatRoutes());
  app.use('/api/sessions', sessionRoutes());
  app.use('/api/errors', errorRoutes());
  app.use('/api/metrics', metricsRoutes());
  app.use('/api/design', designRoutes);
  app.use('/api/forge3d', forge3dRoutes);
  app.use('/api', configRoutes());

  // Static frontend
  const publicDir = join(__dirname, '../../public');
  app.use(express.static(publicDir));

  // SPA fallback - serve index.html for non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(publicDir, 'index.html'));
    } else {
      res.status(404).json({ error: 'Not found' });
    }
  });

  // Error handling middleware (enhanced with observer-pattern error reporting)
  app.use((err, req, res, _next) => {
    console.error(`[SERVER] Error: ${err.message}`);
    const errorId = errorHandler.report('server_error', err, {
      method: req.method,
      path: req.path,
      body: req.body
    });
    res.status(500).json({
      error: 'Internal server error',
      message: err.message,
      errorId
    });
  });

  console.log('[SERVER] Server configured with routes and middleware');

  return { app, store };
}

export default createServer;
