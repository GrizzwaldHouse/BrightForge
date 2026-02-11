/**
 * LLCApp Express Server
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
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createServer(options = {}) {
  const app = express();
  const store = new SessionStore({ timeoutMs: options.sessionTimeout || 30 * 60 * 1000 });

  console.log('[SERVER] Creating Express server...');

  // Middleware
  app.use(express.json({ limit: '1mb' }));

  // CORS for local development
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
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
  app.use((err, req, res, next) => {
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
