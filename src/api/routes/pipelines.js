/**
 * Pipeline Routes - API endpoints for asset pipeline orchestration
 *
 * POST /api/pipelines/run          - Start a pipeline execution
 * GET  /api/pipelines/:id          - Get pipeline status
 * GET  /api/pipelines/stream/:id   - SSE stream for real-time pipeline progress
 * POST /api/pipelines/:id/cancel   - Cancel a running pipeline
 * GET  /api/pipelines/templates    - List available pipeline templates
 * GET  /api/pipelines/active       - List active pipeline executions
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 6, 2026
 */

import express from 'express';
import assetPipelineRunner from '../../forge3d/pipeline/asset-pipeline-runner.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';
import modelBridge from '../../forge3d/model-bridge.js';

const router = express.Router();

/**
 * GET /api/pipelines/templates
 * List available pipeline templates from asset-pipelines.yaml.
 */
router.get('/templates', (_req, res) => {
  try {
    const templates = assetPipelineRunner.listTemplates();
    res.json({ templates });
  } catch (err) {
    errorHandler.report('pipeline_error', err, { endpoint: 'templates' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/pipelines/active
 * List currently active pipeline executions.
 */
router.get('/active', (_req, res) => {
  try {
    const active = assetPipelineRunner.listActive();
    res.json({ pipelines: active });
  } catch (err) {
    errorHandler.report('pipeline_error', err, { endpoint: 'active' });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pipelines/run
 * Start a pipeline execution.
 *
 * Body:
 *   pipeline: string (pipeline template name)
 *   prompt: string (generation prompt)
 *   projectId: string (optional, target project for export)
 *   model: string (optional, model override)
 */
router.post('/run', (req, res) => {
  const { pipeline, prompt, projectId, model } = req.body;

  if (!pipeline) {
    return res.status(400).json({ error: 'invalid_request', reason: '"pipeline" is required' });
  }

  if (!prompt) {
    return res.status(400).json({ error: 'invalid_request', reason: '"prompt" is required' });
  }

  // Preflight: check if Forge3D bridge is available when pipeline requires it
  const templates = assetPipelineRunner.listTemplates ? assetPipelineRunner.listTemplates() : [];
  const template = templates.find(t => t.name === pipeline || t.id === pipeline);
  const needsBridge = !template || template.requires_bridge !== false;

  if (needsBridge && modelBridge.state !== 'running') {
    const reason = modelBridge.unavailableReason || modelBridge.state || 'not started';
    return res.status(503).json({
      error: 'dependency_unavailable',
      reason: `Forge3D Python bridge is not running (state: ${reason})`
    });
  }

  console.log(`[ROUTE:PIPELINE] POST /api/pipelines/run pipeline=${pipeline}`);
  const endTimer = telemetryBus.startTimer('pipeline_api_run');

  try {
    const pipelineId = assetPipelineRunner.start(pipeline, {
      prompt,
      projectId: projectId || null,
      model: model || null
    });

    endTimer({ pipelineId, pipeline });

    res.status(202).json({
      pipelineId,
      pipeline,
      status: 'running',
      statusUrl: `/api/pipelines/${pipelineId}`,
      streamUrl: `/api/pipelines/stream/${pipelineId}`
    });
  } catch (err) {
    console.error(`[ROUTE:PIPELINE] Run error: ${err.message}`);
    errorHandler.report('pipeline_error', err, { endpoint: 'run', pipeline });
    endTimer({ error: err.message });
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/pipelines/:id
 * Get current status of a pipeline execution.
 */
router.get('/:id', (req, res) => {
  const status = assetPipelineRunner.getStatus(req.params.id);

  if (!status) {
    return res.status(404).json({ error: 'Pipeline execution not found' });
  }

  res.json(status);
});

/**
 * GET /api/pipelines/stream/:id
 * SSE stream for real-time pipeline progress.
 * Events: pipeline_started, stage_started, stage_completed,
 *         stage_failed, pipeline_complete, pipeline_failed
 */
router.get('/stream/:id', (req, res) => {
  const pipelineId = req.params.id;

  // Verify pipeline exists
  const status = assetPipelineRunner.getStatus(pipelineId);
  if (!status) {
    return res.status(404).json({ error: 'Pipeline execution not found' });
  }

  // Set up SSE
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  // Send current status immediately
  res.write(`data: ${JSON.stringify({ eventType: 'status', ...status })}\n\n`);

  // Heartbeat keepalive
  const heartbeat = setInterval(() => {
    res.write(':keepalive\n\n');
  }, 15000);

  // Listen for pipeline events
  const onEvent = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const onComplete = (data) => {
    if (data.pipelineId === pipelineId) {
      res.write(`data: ${JSON.stringify({ ...data, done: true })}\n\n`);
      cleanup();
      res.end();
    }
  };

  const cleanup = () => {
    clearInterval(heartbeat);
    assetPipelineRunner.off('stage_started', onEvent);
    assetPipelineRunner.off('stage_completed', onEvent);
    assetPipelineRunner.off('stage_failed', onEvent);
    assetPipelineRunner.off('pipeline_started', onEvent);
    assetPipelineRunner.off('pipeline_complete', onComplete);
    assetPipelineRunner.off('pipeline_failed', onComplete);
  };

  assetPipelineRunner.on('stage_started', onEvent);
  assetPipelineRunner.on('stage_completed', onEvent);
  assetPipelineRunner.on('stage_failed', onEvent);
  assetPipelineRunner.on('pipeline_started', onEvent);
  assetPipelineRunner.on('pipeline_complete', onComplete);
  assetPipelineRunner.on('pipeline_failed', onComplete);

  // Clean up on disconnect
  req.on('close', cleanup);
});

/**
 * POST /api/pipelines/:id/cancel
 * Cancel a running pipeline.
 */
router.post('/:id/cancel', (req, res) => {
  const cancelled = assetPipelineRunner.cancel(req.params.id);

  if (!cancelled) {
    return res.status(400).json({
      error: 'Pipeline cannot be cancelled (not running or not found)'
    });
  }

  res.json({ cancelled: true, pipelineId: req.params.id });
});

export function pipelineRoutes() {
  return router;
}

export default router;
