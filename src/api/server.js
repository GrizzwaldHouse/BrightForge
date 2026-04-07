/**
 * BrightForge Express Server
 *
 * HTTP API for the coding agent. Serves:
 * - /api/chat/* - Chat and plan management
 * - /api/sessions/* - Session history
 * - /api/agents/* - Agent pipeline, recorder, stability
 * - /api/config - Provider config (sanitized)
 * - /api/health - Health check
 * - / - Static frontend from public/
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import express from 'express';
import helmet from 'helmet';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';
import { SessionStore } from './session-store.js';
import { chatRoutes } from './routes/chat.js';
import { sessionRoutes } from './routes/sessions.js';
import { configRoutes } from './routes/config.js';
import { errorRoutes } from './routes/errors.js';
import { metricsRoutes } from './routes/metrics.js';
import designRoutes from './routes/design.js';
import forge3dRoutes from './routes/forge3d.js';
import sceneRoutes from './routes/scene.js';
import worldRoutes from './routes/world.js';
import prototypeRoutes from './routes/prototype.js';
import playtestRoutes from './routes/playtest.js';
import { memoryRoutes } from './routes/memory.js';
import { costRoutes } from './routes/cost.js';
import pipelineRoutes from './routes/pipelines.js';
import debugRoutes from './routes/debug.js';
import { securityRoutes } from './routes/security.js';
import { agentHealthRoutes } from './routes/agent-health.js';
import { skillRoutes } from './routes/skills.js';
import { agentRoutes } from './routes/agents.js';
import { authMiddleware } from './middleware/auth.js';
import { generalLimiter } from './middleware/rate-limit.js';
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

  // Load security config for CORS origins
  let allowedOrigins = ['http://localhost:3847'];
  try {
    const configPath = join(__dirname, '../../config/agent-config.yaml');
    const raw = readFileSync(configPath, 'utf8');
    const config = parse(raw);
    if (config.security?.cors_origins) {
      allowedOrigins = config.security.cors_origins;
    }
  } catch (_e) {
    // Use defaults
  }

  // 1. Security headers (helmet)
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  }));

  // 2. Body parser
  app.use(express.json({ limit: '1mb' }));

  // 3. CORS — config-driven allowed origins
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin || allowedOrigins.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin || allowedOrigins[0]);
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // 4. Bearer token auth (disabled when BRIGHTFORGE_API_KEY not set)
  app.use(authMiddleware);

  // 5. General rate limit on all /api/* routes
  app.use('/api', generalLimiter);

  // 6. Attach store to all requests
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
  app.use('/api/scene', sceneRoutes);
  app.use('/api/world', worldRoutes);
  app.use('/api/prototype', prototypeRoutes);
  app.use('/api/playtest', playtestRoutes);
  app.use('/api/memory', memoryRoutes());
  app.use('/api/cost', costRoutes());
  app.use('/api/pipelines', pipelineRoutes);
  app.use('/api/debug', debugRoutes);
  app.use('/api/skills', skillRoutes());
  app.use('/api/agents', agentRoutes());
  app.use('/api/security', securityRoutes());
  app.use('/api/health', agentHealthRoutes());
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

  // Error handling middleware (sanitized — no stack traces in response)
  app.use((err, req, res, _next) => {
    console.error(`[SERVER] Error: ${err.message}`);
    const errorId = errorHandler.report('server_error', err, {
      method: req.method,
      path: req.path,
      body: req.body
    });
    res.status(500).json({
      error: 'Internal server error',
      errorId
    });
  });

  console.log('[SERVER] Server configured with routes and middleware');

  return { app, store };
}

export default createServer;
