/**
 * Skill Orchestrator API Routes
 *
 * Endpoints:
 * - GET  /api/skills           — List skills (optionally filter by status)
 * - GET  /api/skills/registry  — Full registry dump
 * - GET  /api/skills/stats     — Usage statistics
 * - GET  /api/skills/usage     — Markdown usage log
 * - GET  /api/skills/:name     — Get single skill content
 * - POST /api/skills/load      — Load skills for a task
 * - POST /api/skills/prune     — Trigger skill pruning
 * - POST /api/skills/archive   — Archive old cached skills
 * - POST /api/skills/scan      — Re-scan skill directories
 * - POST /api/skills/sync      — Sync from GitHub remote
 * - POST /api/skills/handoff   — Generate handoff state
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 5, 2026
 */

import { Router } from 'express';
import skillOrchestrator from '../../core/skill-orchestrator.js';

export function skillRoutes() {
  const router = Router();

  /**
   * GET /api/skills
   * List skills, optionally filtered by status.
   * Query: ?status=active|cached|archived
   */
  router.get('/', (req, res) => {
    try {
      const filter = {};
      if (req.query.status) filter.status = req.query.status;
      const registry = skillOrchestrator.getRegistry(filter);
      const skills = Object.entries(registry).map(([name, entry]) => ({
        name,
        ...entry
      }));
      res.json({ skills, count: skills.length });
    } catch (error) {
      console.error(`[ROUTE] /api/skills error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/skills/registry
   * Full registry dump.
   */
  router.get('/registry', (_req, res) => {
    try {
      res.json(skillOrchestrator.getRegistry());
    } catch (error) {
      console.error(`[ROUTE] /api/skills/registry error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/skills/stats
   * Usage statistics.
   */
  router.get('/stats', (_req, res) => {
    try {
      res.json(skillOrchestrator.getStats());
    } catch (error) {
      console.error(`[ROUTE] /api/skills/stats error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/skills/usage
   * Get the markdown usage log.
   */
  router.get('/usage', (_req, res) => {
    try {
      const log = skillOrchestrator.getUsageLog();
      res.type('text/markdown').send(log);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/usage error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/skills/:name
   * Get single skill content by name.
   */
  router.get('/:name', (req, res) => {
    try {
      const result = skillOrchestrator.getSkillContent(req.params.name);
      if (!result.found) {
        return res.status(404).json({ error: 'Skill not found' });
      }
      res.json({ name: req.params.name, content: result.content, path: result.path });
    } catch (error) {
      console.error(`[ROUTE] /api/skills/:name error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/load
   * Load skills for a task.
   * Body: { skills: string[] }
   */
  router.post('/load', (req, res) => {
    try {
      const { skills } = req.body;
      if (!Array.isArray(skills) || skills.length === 0) {
        return res.status(400).json({ error: 'skills must be a non-empty array of skill names' });
      }
      const result = skillOrchestrator.loadForTask(skills);
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/load error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/prune
   * Trigger skill pruning.
   * Body: { force?: boolean }
   */
  router.post('/prune', (req, res) => {
    try {
      const result = skillOrchestrator.prune({ force: req.body.force === true });
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/prune error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/archive
   * Archive old cached skills.
   */
  router.post('/archive', (_req, res) => {
    try {
      const result = skillOrchestrator.archive();
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/archive error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/scan
   * Re-scan skill directories.
   */
  router.post('/scan', (_req, res) => {
    try {
      const result = skillOrchestrator.scan();
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/scan error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/sync
   * Sync skills from GitHub remote.
   */
  router.post('/sync', (_req, res) => {
    try {
      const result = skillOrchestrator.syncFromGitHub();
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/skills/sync error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/skills/handoff
   * Generate handoff state for agent continuity.
   */
  router.post('/handoff', (_req, res) => {
    try {
      const path = skillOrchestrator.writeHandoff();
      res.json({ status: 'written', path });
    } catch (error) {
      console.error(`[ROUTE] /api/skills/handoff error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  console.log('[ROUTE] Skill orchestrator routes registered');
  return router;
}

export default skillRoutes;
