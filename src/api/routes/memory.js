/**
 * Project Memory API Routes
 *
 * Endpoints:
 * - GET /api/memory - Get current project memory
 * - POST /api/memory/convention - Add a convention
 * - DELETE /api/memory/convention/:category/:index - Remove a convention
 * - POST /api/memory/clear - Clear all project memory
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { Router } from 'express';
import projectMemory from '../../core/project-memory.js';

export function memoryRoutes() {
  const router = Router();

  /**
   * GET /api/memory
   * Get current project memory.
   * Query: ?projectRoot=...
   */
  router.get('/', (req, res) => {
    try {
      const projectRoot = req.query.projectRoot || process.cwd();
      projectMemory.load(projectRoot);
      res.json(projectMemory.getData());
    } catch (error) {
      console.error(`[ROUTE] /api/memory error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  /**
   * POST /api/memory/convention
   * Add a convention to project memory.
   * Body: { projectRoot?, category: "code"|"design"|"forge3d", text: string }
   */
  router.post('/convention', (req, res) => {
    try {
      const { projectRoot, category, text } = req.body;

      if (!category || !['code', 'design', 'forge3d'].includes(category)) {
        return res.status(400).json({ error: 'Invalid category (must be code, design, or forge3d)' });
      }

      if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Missing or invalid text field' });
      }

      projectMemory.load(projectRoot || process.cwd());
      projectMemory.addConvention(category, text);

      res.json({ status: 'added', category, text });
    } catch (error) {
      console.error(`[ROUTE] /api/memory/convention error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  /**
   * DELETE /api/memory/convention/:category/:index
   * Remove a convention by category and index.
   * Query: ?projectRoot=...
   */
  router.delete('/convention/:category/:index', (req, res) => {
    try {
      const { category, index } = req.params;
      const projectRoot = req.query.projectRoot || process.cwd();

      projectMemory.load(projectRoot);
      const removed = projectMemory.removeConvention(category, parseInt(index));

      if (removed) {
        res.json({ status: 'removed', category, index: parseInt(index) });
      } else {
        res.status(404).json({ error: 'Convention not found' });
      }
    } catch (error) {
      console.error(`[ROUTE] /api/memory/convention delete error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  /**
   * POST /api/memory/clear
   * Clear all project memory.
   * Body: { projectRoot? }
   */
  router.post('/clear', (req, res) => {
    try {
      const projectRoot = req.body.projectRoot || process.cwd();
      projectMemory.load(projectRoot);
      projectMemory.clear();
      res.json({ status: 'cleared' });
    } catch (error) {
      console.error(`[ROUTE] /api/memory/clear error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  console.log('[ROUTE] Memory routes registered');
  return router;
}

export default memoryRoutes;
