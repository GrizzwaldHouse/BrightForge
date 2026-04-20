/**
 * Debug Routes - Pipeline telemetry and diagnostics
 *
 * GET /api/debug/pipeline - Real-time pipeline telemetry snapshot
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 22, 2026
 */

import express from 'express';
import assetPipelineRunner from '../../forge3d/pipeline/asset-pipeline-runner.js';
import telemetryBus from '../../core/telemetry-bus.js';

// Introspect an Express app's router stack and return a flat route list.
function extractRoutes(app) {
  const routes = [];
  const stack = app?._router?.stack || [];

  function walk(layer, prefix) {
    if (layer.route) {
      const methods = Object.keys(layer.route.methods).map(m => m.toUpperCase());
      routes.push({ method: methods.join(','), path: prefix + (layer.route.path || '') });
    } else if (layer.name === 'router' && layer.handle?.stack) {
      const mountPath = layer.regexp.source
        .replace('\\/?', '').replace('(?=\\/|$)', '').replace(/\\\//g, '/').replace(/\^|\$/g, '');
      layer.handle.stack.forEach(child => walk(child, prefix + mountPath));
    }
  }

  stack.forEach(layer => walk(layer, ''));
  return routes;
}

const router = express.Router();

// Ring buffer for recent completed pipelines (max 50)
const recentCompleted = [];
const MAX_RECENT = 50;

// Listen for pipeline completion events
telemetryBus.on('pipeline_complete', (data) => {
  recentCompleted.push({
    id: data.pipelineId || data.id,
    pipelineName: data.pipelineName || data.pipeline || 'unknown',
    status: 'completed',
    duration: data.duration || data.durationMs || 0,
    stageCount: data.stageCount || data.stages?.length || 0,
    completedAt: new Date().toISOString()
  });
  if (recentCompleted.length > MAX_RECENT) recentCompleted.shift();
});

// Listen for pipeline failure events
telemetryBus.on('pipeline_failed', (data) => {
  recentCompleted.push({
    id: data.pipelineId || data.id,
    pipelineName: data.pipelineName || data.pipeline || 'unknown',
    status: 'failed',
    duration: data.duration || data.durationMs || 0,
    stageCount: data.stageCount || data.stages?.length || 0,
    completedAt: new Date().toISOString()
  });
  if (recentCompleted.length > MAX_RECENT) recentCompleted.shift();
});

/**
 * GET /api/debug/routes
 * Returns a flat map of all registered Express routes with method and path.
 * Detects precedence conflicts where a parameterized route shadows a static one.
 */
router.get('/routes', (req, res) => {
  try {
    const app = req.app;
    const routes = extractRoutes(app);

    // Detect shadowing: a param route (/:x) at depth N appearing before a static at same depth
    const conflicts = [];
    for (let i = 0; i < routes.length; i++) {
      const a = routes[i];
      const aSegments = a.path.split('/');
      for (let j = i + 1; j < routes.length; j++) {
        const b = routes[j];
        if (a.method !== b.method) continue;
        const bSegments = b.path.split('/');
        if (aSegments.length !== bSegments.length) continue;
        const aHasParam = aSegments.some(s => s.startsWith(':'));
        const bIsStatic = bSegments.every(s => !s.startsWith(':'));
        if (aHasParam && bIsStatic) {
          const match = aSegments.every((s, idx) => s.startsWith(':') || s === bSegments[idx]);
          if (match) {
            conflicts.push({ shadower: a, shadowed: b });
          }
        }
      }
    }

    res.json({ routes, conflicts, routeCount: routes.length, conflictCount: conflicts.length });
  } catch (err) {
    console.error('[DEBUG] Route map error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/debug/pipeline
 * Returns real-time pipeline telemetry snapshot.
 */
router.get('/pipeline', (_req, res) => {
  try {
    if (!assetPipelineRunner || typeof assetPipelineRunner.listActive !== 'function') {
      return res.json({ active: [], recentCompleted: [], stats: { totalRuns: 0, successRate: 0, avgDurationMs: 0, activePipelineCount: 0 }, memory: process.memoryUsage(), uptime: Math.floor(process.uptime()) });
    }
    // Active pipelines with enriched details
    const activeList = assetPipelineRunner.listActive();
    const active = activeList.map((p) => {
      const status = assetPipelineRunner.getStatus(p.id);
      const startedAt = status?.startedAt || p.startedAt;
      const elapsedMs = startedAt
        ? Date.now() - new Date(startedAt).getTime()
        : 0;

      return {
        id: p.id,
        pipelineName: p.pipelineName,
        status: p.status,
        currentStage: status?.stages?.[p.currentStageIndex]?.name || null,
        stages: status?.stages?.map(s => s.name) || [],
        elapsedMs,
        startedAt: startedAt || null
      };
    });

    // Stats from recentCompleted ring buffer
    const totalRuns = recentCompleted.length;
    const successCount = recentCompleted.filter(r => r.status === 'completed').length;
    const successRate = totalRuns > 0 ? successCount / totalRuns : 0;
    const avgDurationMs = totalRuns > 0
      ? Math.round(recentCompleted.reduce((sum, r) => sum + r.duration, 0) / totalRuns)
      : 0;

    const mem = process.memoryUsage();

    res.json({
      active,
      recentCompleted: recentCompleted.slice().reverse(),
      stats: {
        totalRuns,
        successRate,
        avgDurationMs,
        activePipelineCount: active.length
      },
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        rss: mem.rss,
        external: mem.external
      },
      uptime: Math.floor(process.uptime())
    });
  } catch (err) {
    console.error('[DEBUG] Pipeline telemetry error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
