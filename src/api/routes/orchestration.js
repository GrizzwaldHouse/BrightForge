// orchestration.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-15
// Purpose: API endpoints for orchestration runtime

import express from 'express';
import orchestrator from '../../orchestration/index.js';

/**
 * Create Express router for orchestration endpoints.
 * @returns {express.Router} Router instance
 */
export function createOrchestrationRoutes() {
  const router = express.Router();

  // GET /api/orchestration/status - Get orchestration runtime status
  router.get('/status', async (req, res) => {
    try {
      const status = orchestrator.getStatus();
      res.json(status);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to get status:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/orchestration/task - Create new orchestration task
  router.post('/task', async (req, res) => {
    try {
      const { taskName, agent, phase, nextAction } = req.body;

      if (!taskName || !agent) {
        return res.status(400).json({ error: 'taskName and agent are required' });
      }

      const task = orchestrator.taskState.create({
        taskName,
        agent,
        phase,
        nextAction
      });

      res.json(task);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to create task:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/orchestration/tasks - List all tasks with optional filters
  router.get('/tasks', async (req, res) => {
    try {
      const filters = {
        status: req.query.status,
        agent: req.query.agent,
        limit: req.query.limit ? parseInt(req.query.limit, 10) : 50
      };

      // Remove undefined filters
      Object.keys(filters).forEach(key => filters[key] === undefined && delete filters[key]);

      const tasks = orchestrator.taskState.list(filters);
      res.json(tasks);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to list tasks:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/orchestration/task/:id - Get single task by ID
  router.get('/task/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const task = orchestrator.taskState.load(id);

      if (!task) {
        return res.status(404).json({ error: 'Task not found' });
      }

      res.json(task);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to get task:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // PATCH /api/orchestration/task/:id - Update task
  router.patch('/task/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      const task = orchestrator.taskState.update(id, updates);
      res.json(task);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to update task:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/orchestration/handoff - Initiate handoff between agents
  router.post('/handoff', async (req, res) => {
    try {
      const { taskId, fromAgent, toAgent, reason } = req.body;

      if (!taskId || !fromAgent || !toAgent) {
        return res.status(400).json({ error: 'taskId, fromAgent, and toAgent are required' });
      }

      // First pause the task with current agent
      const pauseResult = orchestrator.handoff.pause(taskId, fromAgent, reason || 'Manual handoff');

      // Then resume with new agent
      const resumeResult = orchestrator.handoff.resume(taskId, toAgent);

      res.json({
        status: 'success',
        pauseResult,
        resumeResult
      });
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to initiate handoff:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/orchestration/handoff/history/:taskId - Get handoff history for task
  router.get('/handoff/history/:taskId', async (req, res) => {
    try {
      const { taskId } = req.params;
      const history = orchestrator.handoff.getHistory(taskId);
      res.json(history);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to get handoff history:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/orchestration/agents - List registered agents
  router.get('/agents', async (req, res) => {
    try {
      const agents = orchestrator.storage.listAgents();
      res.json(agents);
    } catch (err) {
      console.error('[ORCH-ROUTES] Failed to list agents:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Self-test
if (process.argv.includes('--test')) {
  console.log('[ORCH-ROUTES] Self-test: creating routes');
  const _router = createOrchestrationRoutes();
  console.log('[ORCH-ROUTES] ✓ Routes created successfully');
  console.log('[ORCH-ROUTES] Available routes:');
  console.log('  GET  /api/orchestration/status');
  console.log('  POST /api/orchestration/task');
  console.log('  GET  /api/orchestration/tasks');
  console.log('  GET  /api/orchestration/task/:id');
  console.log('  PATCH /api/orchestration/task/:id');
  console.log('  POST /api/orchestration/handoff');
  console.log('  GET  /api/orchestration/handoff/history/:taskId');
  console.log('  GET  /api/orchestration/agents');
}
