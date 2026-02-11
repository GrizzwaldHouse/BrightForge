/**
 * Chat API Routes
 *
 * Endpoints:
 * - POST /api/chat/turn - Generate plan from message
 * - POST /api/chat/approve - Approve/reject pending plan
 * - POST /api/chat/rollback - Rollback last applied plan
 * - GET /api/chat/status/:id - Get session status
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import { WebSession } from '../web-session.js';

export function chatRoutes() {
  const router = Router();

  /**
   * POST /api/chat/turn
   * Generate a plan from a user message.
   * Body: { sessionId?, message, projectRoot? }
   * Returns: { sessionId, plan, status, message, history }
   */
  router.post('/turn', async (req, res) => {
    try {
      const { sessionId, message, projectRoot } = req.body;

      if (!message || typeof message !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid message field'
        });
      }

      console.log(`[ROUTE] /api/chat/turn - message: "${message.slice(0, 50)}..."`);

      // Get or create session
      let session;
      if (sessionId && req.store.has(sessionId)) {
        session = req.store.get(sessionId);
        console.log(`[ROUTE] Using existing session: ${sessionId.slice(0, 8)}`);
      } else {
        session = new WebSession({
          projectRoot: projectRoot || process.cwd(),
          sessionsDir: req.sessionsDir
        });
        req.store.set(session.id, session);
        console.log(`[ROUTE] Created new session: ${session.id.slice(0, 8)}`);
      }

      // Generate plan
      const result = await session.generatePlan(message);

      // Return result with session info
      res.json({
        ...result,
        sessionId: session.id,
        history: session.getHistory()
      });

    } catch (error) {
      console.error(`[ROUTE] /api/chat/turn error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * POST /api/chat/approve
   * Approve or reject a pending plan.
   * Body: { sessionId, planId?, action: "apply"|"reject" }
   * Returns: { status, applied, failed, errors, cost, provider, model }
   */
  router.post('/approve', async (req, res) => {
    try {
      const { sessionId, planId, action } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId field' });
      }

      if (!action || !['apply', 'reject'].includes(action)) {
        return res.status(400).json({
          error: 'Invalid action field (must be "apply" or "reject")'
        });
      }

      console.log(`[ROUTE] /api/chat/approve - session: ${sessionId.slice(0, 8)}, action: ${action}`);

      // Get session
      const session = req.store.get(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          message: 'Session may have expired or does not exist'
        });
      }

      // Apply or reject
      let result;
      if (action === 'apply') {
        result = await session.approvePlan(planId);
      } else {
        result = await session.rejectPlan(planId);
      }

      res.json(result);

    } catch (error) {
      console.error(`[ROUTE] /api/chat/approve error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * POST /api/chat/rollback
   * Rollback the last applied plan in a session.
   * Body: { sessionId }
   * Returns: { status, restored, errors }
   */
  router.post('/rollback', async (req, res) => {
    try {
      const { sessionId } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId field' });
      }

      console.log(`[ROUTE] /api/chat/rollback - session: ${sessionId.slice(0, 8)}`);

      // Get session
      const session = req.store.get(sessionId);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          message: 'Session may have expired or does not exist'
        });
      }

      // Rollback
      const result = await session.rollbackLast();
      res.json(result);

    } catch (error) {
      console.error(`[ROUTE] /api/chat/rollback error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/chat/status/:id
   * Get the status of a session.
   * Returns: { id, projectRoot, createdAt, turns, totalCost, planCount, hasPendingPlan, lastActivity }
   */
  router.get('/status/:id', (req, res) => {
    try {
      const { id } = req.params;

      console.log(`[ROUTE] /api/chat/status/:id - session: ${id.slice(0, 8)}`);

      // Get session
      const session = req.store.get(id);
      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          message: 'Session may have expired or does not exist'
        });
      }

      const status = session.getStatus();
      res.json(status);

    } catch (error) {
      console.error(`[ROUTE] /api/chat/status/:id error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  console.log('[ROUTE] Chat routes registered');

  return router;
}

export default chatRoutes;
