/**
 * AgentForge API routes — inbound task intake + bridge status
 * Mounted at /api/agentforge in server.js
 *
 * POST /api/agentforge/task  — receive delegated task from AgentForge HEART
 * GET  /api/agentforge/status — bridge health and connection state
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-05-08
 */

import express from 'express';
import agentforgeBridge from '../../integrations/agentforge-bridge.js';
import errorHandler from '../../core/error-handler.js';

const router = express.Router();

// POST /api/agentforge/task
router.post('/task', async (req, res) => {
  // Token auth — only enforced when AGENTFORGE_NODE_TOKEN is set
  const expectedToken = process.env.AGENTFORGE_NODE_TOKEN;
  if (expectedToken) {
    const provided = req.headers['x-agentforge-token'];
    if (!provided || provided !== expectedToken) {
      return res.status(401).json({ error: 'Invalid or missing x-agentforge-token' });
    }
  }

  const { task_id, task_type, prompt, priority, deadline_ms, context } = req.body || {};

  if (!task_id || typeof task_id !== 'string') {
    return res.status(400).json({ error: 'task_id required' });
  }
  if (!prompt || typeof prompt !== 'string') {
    return res.status(400).json({ error: 'prompt required' });
  }

  console.log(`[AGENTFORGE-ROUTE] Task received: ${task_id} type=${task_type || 'unspecified'}`);

  // Forward BRIGHTFORGE_TASK_RECEIVED to OwlWatcher
  agentforgeBridge.forwardEvent('BRIGHTFORGE_TASK_RECEIVED', {
    task_id,
    node_id: 'brightforge',
    received_at: new Date().toISOString(),
    estimated_duration_ms: null
  });

  // Emit to OrchestrationEventBus if available
  try {
    const { default: orchestrator } = await import('../../orchestration/index.js');
    if (orchestrator.initialized && orchestrator.eventBus) {
      orchestrator.eventBus.emit('BRIGHTFORGE_TASK_RECEIVED', {
        agent: 'agentforge-bridge',
        payload: { task_id, task_type, priority, deadline_ms, context }
      });
    }
  } catch (_err) {
    // Orchestrator may not be available — non-fatal
  }

  res.status(202).json({ status: 'accepted', task_id });
});

// GET /api/agentforge/status
router.get('/status', (_req, res) => {
  try {
    res.json(agentforgeBridge.getStatus());
  } catch (err) {
    errorHandler.report('server_error', err, { route: 'GET /api/agentforge/status' });
    res.status(500).json({ error: err.message });
  }
});

export default router;
export { router as agentforgeRoutes };
