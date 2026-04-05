/**
 * Security API Routes
 *
 * Endpoints:
 * - GET /api/security/status  - Watcher state
 * - GET /api/security/audit   - Recent audit entries
 * - GET /api/security/alerts  - Active security alerts
 * - POST /api/security/scan   - Trigger manual directory scan
 * - POST /api/security/dismiss/:alertId - Dismiss a specific alert
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { Router } from 'express';
import fileWatcher from '../../security/file-watcher.js';

export function securityRoutes() {
  const router = Router();

  /**
   * GET /api/security/status
   * Return watcher state: watching, directory, file count, last event, alert count.
   */
  router.get('/status', (_req, res) => {
    try {
      const status = fileWatcher.getStatus();
      res.json(status);
    } catch (err) {
      console.error(`[ROUTE] /api/security/status error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/security/audit
   * Return recent audit log entries.
   * Query: ?limit=100
   */
  router.get('/audit', (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 100, 1000);
      const entries = fileWatcher.getAuditLog(limit);
      res.json({ entries, count: entries.length });
    } catch (err) {
      console.error(`[ROUTE] /api/security/audit error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/security/alerts
   * Return active (non-dismissed) security alerts.
   */
  router.get('/alerts', (_req, res) => {
    try {
      const alerts = fileWatcher.getAlerts();
      res.json({ alerts, count: alerts.length });
    } catch (err) {
      console.error(`[ROUTE] /api/security/alerts error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/security/scan
   * Trigger a full directory scan.
   * Body: { directory: string }
   */
  router.post('/scan', (req, res) => {
    try {
      const { directory } = req.body || {};
      if (!directory || typeof directory !== 'string') {
        return res.status(400).json({ error: 'directory is required' });
      }

      // Basic path traversal protection
      if (directory.includes('..')) {
        return res.status(400).json({ error: 'Path traversal not allowed' });
      }

      const result = fileWatcher.scan(directory);
      res.json(result);
    } catch (err) {
      console.error(`[ROUTE] /api/security/scan error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/security/dismiss/:alertId
   * Dismiss a specific security alert.
   */
  router.post('/dismiss/:alertId', (req, res) => {
    try {
      const { alertId } = req.params;
      const dismissed = fileWatcher.dismissAlert(alertId);
      if (dismissed) {
        res.json({ dismissed: true, alertId });
      } else {
        res.status(404).json({ error: 'Alert not found', alertId });
      }
    } catch (err) {
      console.error(`[ROUTE] /api/security/dismiss error: ${err.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  console.log('[ROUTE] Security routes registered');

  return router;
}

export default securityRoutes;
