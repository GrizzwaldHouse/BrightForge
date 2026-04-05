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
 * GET /api/debug/pipeline
 * Returns real-time pipeline telemetry snapshot.
 */
router.get('/pipeline', (_req, res) => {
  try {
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
