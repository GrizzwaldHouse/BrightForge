/**
 * Sessions API Routes
 *
 * Endpoints:
 * - GET /api/sessions - List recent sessions from SessionLog
 * - GET /api/sessions/:id - Get specific session details
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import { SessionLog } from '../../core/session-log.js';

export function sessionRoutes() {
  const router = Router();
  const sessionLog = new SessionLog();

  /**
   * GET /api/sessions
   * List recent session logs from disk.
   * Query params: limit (default: 10)
   * Returns: { sessions: Array<Object> }
   */
  router.get('/', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 10;

      console.log(`[ROUTE] /api/sessions - loading recent sessions (limit: ${limit})`);

      const sessions = await sessionLog.loadRecent(req.sessionsDir, limit);

      res.json({
        sessions,
        count: sessions.length,
        limit
      });

    } catch (error) {
      console.error(`[ROUTE] /api/sessions error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/sessions/:id
   * Get a specific session by plan ID.
   * Returns: { session: Object } or 404
   */
  router.get('/:id', async (req, res) => {
    try {
      const { id } = req.params;

      console.log(`[ROUTE] /api/sessions/:id - loading session: ${id}`);

      // Load all recent sessions and find matching ID
      const sessions = await sessionLog.loadRecent(req.sessionsDir, 100);
      const session = sessions.find(s => s.id === id);

      if (!session) {
        return res.status(404).json({
          error: 'Session not found',
          message: `No session found with ID: ${id}`
        });
      }

      res.json({ session });

    } catch (error) {
      console.error(`[ROUTE] /api/sessions/:id error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  console.log('[ROUTE] Sessions routes registered');

  return router;
}

export default sessionRoutes;
