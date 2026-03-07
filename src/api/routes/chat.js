/**
 * Chat API Routes
 *
 * Endpoints:
 * - POST /api/chat/turn - Start plan generation (returns 202 for SSE, or sync with ?sync=true)
 * - GET /api/chat/stream/:sessionId - SSE stream for real-time generation progress
 * - POST /api/chat/cancel/:sessionId - Cancel in-flight generation
 * - POST /api/chat/approve - Approve/reject pending plan
 * - POST /api/chat/rollback - Rollback last applied plan
 * - GET /api/chat/status/:id - Get session status
 * - POST /api/chat/upgrade - Re-run on higher-tier provider
 * - POST /api/chat/pipeline/detect - Analyze prompt for multi-domain intent
 * - POST /api/chat/pipeline/execute - Execute creative pipeline
 * - GET /api/chat/timeline - Git checkpoint timeline
 * - POST /api/chat/revert/:commitHash - Revert a git checkpoint
 * - GET /api/chat/diff/:commitHash - Get diff for a commit
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { Router } from 'express';
import { WebSession } from '../web-session.js';
import gitCheckpointer from '../../core/git-checkpointer.js';
import llmClient from '../../core/llm-client.js';
import pipelineDetector from '../../core/pipeline-detector.js';
import creativePipeline from '../../core/creative-pipeline.js';
import { chatLimiter } from '../middleware/rate-limit.js';

export function chatRoutes() {
  const router = Router();

  /**
   * Helper: get or create a session from request.
   */
  function getOrCreateSession(req, sessionId, projectRoot) {
    if (sessionId && req.store.has(sessionId)) {
      console.log(`[ROUTE] Using existing session: ${sessionId.slice(0, 8)}`);
      return req.store.get(sessionId);
    }
    const session = new WebSession({
      projectRoot: projectRoot || process.cwd(),
      sessionsDir: req.sessionsDir
    });
    req.store.set(session.id, session);
    console.log(`[ROUTE] Created new session: ${session.id.slice(0, 8)}`);
    return session;
  }

  /**
   * POST /api/chat/turn
   * Start plan generation.
   * With ?sync=true: awaits completion and returns result (backward compatible).
   * Without: returns 202 immediately, stream progress via GET /stream/:sessionId.
   * Body: { sessionId?, message, projectRoot? }
   */
  router.post('/turn', chatLimiter, async (req, res) => {
    try {
      const { sessionId, message, projectRoot } = req.body;
      const sync = req.query.sync === 'true';

      if (!message || typeof message !== 'string') {
        return res.status(400).json({
          error: 'Missing or invalid message field'
        });
      }

      console.log(`[ROUTE] /api/chat/turn - message: "${message.slice(0, 50)}..." sync=${sync}`);

      const session = getOrCreateSession(req, sessionId, projectRoot);

      if (sync) {
        // Backward compatible: await full result
        const result = await session.generatePlan(message);
        return res.json({
          ...result,
          sessionId: session.id,
          history: session.getHistory()
        });
      }

      // Fire-and-forget: start generation and return 202
      session.startGeneration(message);

      res.status(202).json({
        sessionId: session.id,
        status: 'generating',
        message: 'Generation started. Connect to SSE stream for progress.'
      });

    } catch (error) {
      console.error(`[ROUTE] /api/chat/turn error: ${error.message}`);
      res.status(500).json({
        error: 'Internal server error'
      });
    }
  });

  /**
   * GET /api/chat/stream/:sessionId
   * SSE stream for real-time plan generation progress.
   * Events: provider_trying, complete, failed, cancelled
   */
  router.get('/stream/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    const session = req.store.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // SSE headers
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });
    res.flushHeaders();

    const send = (event, data) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // Heartbeat keepalive every 15s
    const heartbeat = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 15000);

    // If generation already completed before client connected, send result immediately
    if (!session._generating && session.pendingPlan) {
      send('complete', {
        sessionId,
        plan: session.sanitizePlan(session.pendingPlan),
        status: 'pending_approval',
        message: 'Plan ready for review.',
        cost: session.pendingPlan.cost || 0,
        totalCost: session.totalCost
      });
      clearInterval(heartbeat);
      res.end();
      return;
    }

    // Listen for generation events
    const onProviderTrying = (data) => {
      if (data.sessionId === sessionId) send('provider_trying', data);
    };

    const onProviderFailed = (data) => {
      if (data.sessionId === sessionId) send('provider_failed', data);
    };

    const onComplete = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        send('complete', data);
        cleanup();
        res.end();
      }
    };

    const onFailed = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        send('failed', data);
        cleanup();
        res.end();
      }
    };

    const onCancelled = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        send('cancelled', data);
        cleanup();
        res.end();
      }
    };

    // Pipeline events (from CreativePipeline via session)
    const onPipelineStepStart = (data) => {
      if (data.sessionId === sessionId || !data.sessionId) send('pipeline_step_start', data);
    };
    const onPipelineStepComplete = (data) => {
      if (data.sessionId === sessionId || !data.sessionId) send('pipeline_step_complete', data);
    };
    const onPipelineComplete = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        send('pipeline_complete', data);
        cleanup();
        res.end();
      }
    };
    const onPipelineFailed = (data) => {
      if (data.sessionId === sessionId) {
        clearInterval(heartbeat);
        send('pipeline_failed', data);
        cleanup();
        res.end();
      }
    };

    const cleanup = () => {
      clearInterval(heartbeat);
      session.off('plan:provider_trying', onProviderTrying);
      session.off('plan:provider_failed', onProviderFailed);
      session.off('plan:complete', onComplete);
      session.off('plan:failed', onFailed);
      session.off('plan:cancelled', onCancelled);
      session.off('pipeline:step_start', onPipelineStepStart);
      session.off('pipeline:step_complete', onPipelineStepComplete);
      session.off('pipeline:complete', onPipelineComplete);
      session.off('pipeline:failed', onPipelineFailed);
      creativePipeline.off('pipeline:step_start', onPipelineStepStart);
      creativePipeline.off('pipeline:step_complete', onPipelineStepComplete);
    };

    session.on('plan:provider_trying', onProviderTrying);
    session.on('plan:provider_failed', onProviderFailed);
    session.on('plan:complete', onComplete);
    session.on('plan:failed', onFailed);
    session.on('plan:cancelled', onCancelled);
    session.on('pipeline:complete', onPipelineComplete);
    session.on('pipeline:failed', onPipelineFailed);

    // Also listen on the global pipeline for step events
    creativePipeline.on('pipeline:step_start', onPipelineStepStart);
    creativePipeline.on('pipeline:step_complete', onPipelineStepComplete);

    // Clean up on client disconnect
    req.on('close', cleanup);
  });

  /**
   * POST /api/chat/cancel/:sessionId
   * Cancel an in-flight generation.
   */
  router.post('/cancel/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    const session = req.store.get(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const cancelled = session.cancel();
    res.json({
      status: cancelled ? 'cancelled' : 'not_generating',
      sessionId
    });
  });

  /**
   * POST /api/chat/approve
   * Approve or reject a pending plan.
   * Body: { sessionId, planId?, action: "apply"|"reject" }
   * Returns: { status, applied, failed, errors, cost, provider, model }
   */
  router.post('/approve', chatLimiter, async (req, res) => {
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
        error: 'Internal server error'
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
        error: 'Internal server error'
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
        error: 'Internal server error'
      });
    }
  });

  /**
   * GET /api/chat/timeline
   * Get chronological list of BrightForge git checkpoints.
   * Query: ?projectRoot=...&limit=50
   */
  router.get('/timeline', (req, res) => {
    try {
      const projectRoot = req.query.projectRoot || process.cwd();
      const limit = parseInt(req.query.limit) || 50;

      const timeline = gitCheckpointer.getTimeline(projectRoot, limit);
      res.json({ timeline, projectRoot });
    } catch (error) {
      console.error(`[ROUTE] /api/chat/timeline error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/chat/revert/:commitHash
   * Revert a specific BrightForge checkpoint.
   * Body: { projectRoot? }
   */
  router.post('/revert/:commitHash', (req, res) => {
    try {
      const { commitHash } = req.params;
      const projectRoot = req.body.projectRoot || process.cwd();

      if (!commitHash || commitHash.length < 7) {
        return res.status(400).json({ error: 'Invalid commit hash' });
      }

      const result = gitCheckpointer.revert(projectRoot, commitHash);

      if (result.success) {
        res.json({ status: 'reverted', commitHash });
      } else {
        res.status(400).json({ status: 'failed', error: result.error });
      }
    } catch (error) {
      console.error(`[ROUTE] /api/chat/revert error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/chat/diff/:commitHash
   * Get diff for a specific commit.
   * Query: ?projectRoot=...
   */
  router.get('/diff/:commitHash', (req, res) => {
    try {
      const { commitHash } = req.params;
      const projectRoot = req.query.projectRoot || process.cwd();

      const diff = gitCheckpointer.getDiff(projectRoot, commitHash);
      res.json({ diff, commitHash });
    } catch (error) {
      console.error(`[ROUTE] /api/chat/diff error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/chat/pipeline/detect
   * Analyze a message for multi-domain intent.
   * Body: { message }
   * Returns: { isPipeline, domains, steps, confidence }
   */
  router.post('/pipeline/detect', (req, res) => {
    try {
      const { message } = req.body;
      if (!message) {
        return res.status(400).json({ error: 'Missing message field' });
      }

      const analysis = pipelineDetector.analyze(message);
      res.json(analysis);
    } catch (error) {
      console.error(`[ROUTE] /api/chat/pipeline/detect error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/chat/pipeline/execute
   * Execute a creative pipeline for a multi-domain prompt.
   * Body: { sessionId?, message, projectRoot? }
   * Returns: 202 with sessionId, stream progress via SSE.
   */
  router.post('/pipeline/execute', chatLimiter, async (req, res) => {
    try {
      const { sessionId, message, projectRoot } = req.body;

      if (!message) {
        return res.status(400).json({ error: 'Missing message field' });
      }

      console.log(`[ROUTE] /api/chat/pipeline/execute - "${message.slice(0, 50)}..."`);

      const session = getOrCreateSession(req, sessionId, projectRoot);

      // Run pipeline in background
      const pipelinePromise = creativePipeline.execute(
        message,
        projectRoot || process.cwd(),
        { signal: session._abortController?.signal }
      );

      // Store pipeline reference on session
      session._pipelinePromise = pipelinePromise;

      res.status(202).json({
        sessionId: session.id,
        status: 'pipeline_started',
        message: 'Creative pipeline started. Connect to SSE stream for progress.'
      });

      // Handle pipeline completion asynchronously
      pipelinePromise.then(result => {
        session.totalCost += result.totalCost || 0;
        session.emit('pipeline:complete', {
          sessionId: session.id,
          ...result
        });
      }).catch(error => {
        session.emit('pipeline:failed', {
          sessionId: session.id,
          message: error.message
        });
      });

    } catch (error) {
      console.error(`[ROUTE] /api/chat/pipeline/execute error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/chat/upgrade
   * Re-run the last prompt on a specific (higher-tier) provider.
   * Body: { sessionId, targetProvider }
   */
  router.post('/upgrade', async (req, res) => {
    try {
      const { sessionId, targetProvider } = req.body;

      if (!sessionId) {
        return res.status(400).json({ error: 'Missing sessionId field' });
      }
      if (!targetProvider) {
        return res.status(400).json({ error: 'Missing targetProvider field' });
      }

      const session = req.store.get(sessionId);
      if (!session) {
        return res.status(404).json({ error: 'Session not found' });
      }

      // Get the last user message from history
      const history = session.getHistory();
      const lastUserMsg = [...history].reverse().find(m => m.role === 'user');
      if (!lastUserMsg) {
        return res.status(400).json({ error: 'No previous user message to upgrade' });
      }

      console.log(`[ROUTE] /api/chat/upgrade - session: ${sessionId.slice(0, 8)}, provider: ${targetProvider}`);

      // Check provider availability
      if (!llmClient.isProviderAvailable(targetProvider)) {
        return res.status(400).json({ error: `Provider ${targetProvider} is not available` });
      }

      // Re-generate plan using forced provider
      const plan = await session.masterAgent.run(lastUserMsg.content, session.projectRoot, {
        forceProvider: targetProvider
      });

      plan.id = `${Date.now()}-upgrade`;
      session.pendingPlan = plan;
      session.plans.push(plan);
      session.totalCost += plan.cost || 0;

      const responseMsg = plan.operations?.length > 0
        ? `Upgraded plan (${targetProvider}) with ${plan.operations.length} file operation(s).`
        : 'No file operations generated from upgraded provider.';

      session.history.addAssistant(responseMsg);

      res.json({
        plan: session.sanitizePlan(plan),
        status: plan.operations?.length > 0 ? 'pending_approval' : 'no_changes',
        message: responseMsg,
        provider: plan.provider,
        model: plan.model,
        cost: plan.cost || 0,
        previousCost: session.plans.length > 1
          ? session.plans[session.plans.length - 2].cost || 0
          : 0,
        totalCost: session.totalCost
      });

    } catch (error) {
      console.error(`[ROUTE] /api/chat/upgrade error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  console.log('[ROUTE] Chat routes registered');

  return router;
}

export default chatRoutes;
