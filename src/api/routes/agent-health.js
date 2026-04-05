/**
 * Agent Health API Routes
 *
 * Endpoints for monitoring provider/agent states and system diagnostics.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { Router } from 'express';
import agentMonitor from '../../core/agent-monitor.js';
import errorHandler from '../../core/error-handler.js';
import generationQueue from '../../forge3d/generation-queue.js';
import forge3dDb from '../../forge3d/database.js';

export function agentHealthRoutes() {
  const router = Router();

  /**
   * GET /agents - All agent/provider states
   */
  router.get('/agents', (_req, res) => {
    try {
      const states = agentMonitor.getAgentStates();
      res.json({
        agents: states,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[AGENT-HEALTH] /agents error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /diagnostics - System diagnostics
   */
  router.get('/diagnostics', (_req, res) => {
    try {
      const diag = errorHandler.getDiagnostics();

      // Queue may not be initialized yet (lazy-init on first Forge3D use)
      let queue = { paused: false, processing: false, queuedCount: 0, initialized: false };
      try {
        const queueStatus = generationQueue.getStatus();
        queue = {
          paused: queueStatus.paused,
          processing: queueStatus.processing,
          queuedCount: queueStatus.queuedCount,
          initialized: true
        };
      } catch (_e) {
        // DB not opened yet — return defaults
      }

      res.json({ ...diag, queue });
    } catch (error) {
      console.error(`[AGENT-HEALTH] /diagnostics error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /queue-priorities - Queue depth by priority tier
   */
  router.get('/queue-priorities', (_req, res) => {
    try {
      // Queue may not be initialized yet (lazy-init on first Forge3D use)
      let depths = { urgent: 0, normal: 0, background: 0 };
      try {
        depths = generationQueue.getQueueDepthByPriority();
      } catch (_e) {
        // DB not opened yet — return zeroes
      }

      res.json({
        priorities: depths,
        initialized: !!forge3dDb.db,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`[AGENT-HEALTH] /queue-priorities error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  console.log('[ROUTE] Agent health routes registered');
  return router;
}

export default agentHealthRoutes;
