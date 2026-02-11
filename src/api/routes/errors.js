/**
 * Error API Routes
 *
 * Endpoints:
 * - GET /api/errors/recent - Get recent errors from ring buffer
 * - GET /api/errors/diagnostics - Get system diagnostics
 * - POST /api/errors/clear - Clear error buffer
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import errorHandler from '../../core/error-handler.js';

export function errorRoutes() {
  const router = Router();

  /**
   * GET /api/errors/recent
   * Return recent errors from the in-memory ring buffer.
   * Query params:
   *   limit (default: 20) - Max number of errors to return
   *   category - Optional filter by error category
   */
  router.get('/recent', (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 20;
      const category = req.query.category || null;

      const errors = errorHandler.getRecentErrors(limit, category);

      res.json({
        errors,
        count: errors.length,
        limit,
        category: category || 'all'
      });
    } catch (error) {
      console.error(`[ROUTE] /api/errors/recent error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * GET /api/errors/diagnostics
   * Return system diagnostics: uptime, memory, error counts, etc.
   */
  router.get('/diagnostics', (req, res) => {
    try {
      const diagnostics = errorHandler.getDiagnostics();

      res.json(diagnostics);
    } catch (error) {
      console.error(`[ROUTE] /api/errors/diagnostics error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  /**
   * POST /api/errors/clear
   * Clear the in-memory error ring buffer and reset counters.
   */
  router.post('/clear', (req, res) => {
    try {
      errorHandler.clearErrors();

      res.json({
        status: 'cleared',
        message: 'Error buffer and counters reset'
      });
    } catch (error) {
      console.error(`[ROUTE] /api/errors/clear error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  });

  console.log('[ROUTE] Error routes registered');

  return router;
}

export default errorRoutes;
