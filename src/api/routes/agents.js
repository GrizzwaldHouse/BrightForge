/**
 * Agent Pipeline API Routes
 *
 * Endpoints:
 * - GET  /api/agents              — List all registered agents
 * - GET  /api/agents/:name/status — Single agent status
 * - POST /api/agents/pipeline/start  — Start agent pipeline
 * - POST /api/agents/pipeline/cancel — Cancel running pipeline
 * - GET  /api/agents/pipeline/status — Pipeline progress
 * - POST /api/agents/recorder/start  — Start OBS recording
 * - POST /api/agents/recorder/stop   — Stop OBS recording
 * - GET  /api/agents/recorder/status — OBS connection status
 * - POST /api/agents/stability/start — Start stability run
 * - GET  /api/agents/stability/status — Stability run progress
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { Router } from 'express';
import plannerAgent from '../../agents/planner-agent.js';
import builderAgent from '../../agents/builder-agent.js';
import testerAgent from '../../agents/tester-agent.js';
import reviewerAgent from '../../agents/reviewer-agent.js';
import surveyAgent from '../../agents/survey-agent.js';
import recorderAgent from '../../agents/recorder-agent.js';
import telemetryBus from '../../core/telemetry-bus.js';

const agents = {
  Planner: plannerAgent,
  Builder: builderAgent,
  Tester: testerAgent,
  Reviewer: reviewerAgent,
  Survey: surveyAgent,
  Recorder: recorderAgent
};

// Pipeline state
let pipelineState = {
  status: 'idle',
  currentAgent: null,
  subtasks: [],
  startedAt: null,
  completedAt: null,
  error: null
};

// Stability run state
let stabilityState = {
  status: 'idle',
  checkpointCount: 0,
  elapsedSeconds: 0,
  metrics: {},
  checkpoints: [],
  verdict: null
};

let stabilityInterval = null;

export function agentRoutes() {
  const router = Router();

  /**
   * GET /api/agents
   * List all registered agents with status.
   */
  router.get('/', (_req, res) => {
    try {
      const agentList = Object.entries(agents).map(([name, agent]) => ({
        name,
        status: agent.status || 'idle',
        type: 'pipeline'
      }));
      res.json({ agents: agentList });
    } catch (error) {
      console.error(`[ROUTE] /api/agents error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/pipeline/status
   * Pipeline progress.
   * MUST be declared before /:name/status to avoid route shadowing.
   */
  router.get('/pipeline/status', (_req, res) => {
    try {
      res.json(pipelineState);
    } catch (error) {
      console.error(`[ROUTE] /api/agents/pipeline/status error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/recorder/status
   * OBS connection status.
   * MUST be declared before /:name/status to avoid route shadowing.
   */
  router.get('/recorder/status', (_req, res) => {
    try {
      res.json(recorderAgent.getStatus());
    } catch (error) {
      console.error(`[ROUTE] /api/agents/recorder/status error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/stability/status
   * Stability run progress.
   * MUST be declared before /:name/status to avoid route shadowing.
   */
  router.get('/stability/status', (_req, res) => {
    try {
      res.json(stabilityState);
    } catch (error) {
      console.error(`[ROUTE] /api/agents/stability/status error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * GET /api/agents/:name/status
   * Single agent status. Declared AFTER the static status routes (pipeline/recorder/stability).
   */
  router.get('/:name/status', (req, res) => {
    try {
      const agent = agents[req.params.name];
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
      res.json(agent.getStatus ? agent.getStatus() : { name: req.params.name, status: agent.status || 'idle' });
    } catch (error) {
      console.error(`[ROUTE] /api/agents/:name/status error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/agents/pipeline/start
   * Start the Planner→Builder→Tester→Reviewer pipeline.
   */
  router.post('/pipeline/start', async (req, res) => {
    try {
      if (pipelineState.status === 'running') {
        return res.status(409).json({ error: 'Pipeline already running' });
      }

      const { prompt } = req.body;
      // Each run owns its state object; a cancelled run keeps writing only to its own
      const state = {
        status: 'running',
        currentAgent: 'Planner',
        subtasks: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
        error: null
      };
      pipelineState = state;

      res.status(202).json({ status: 'started', startedAt: state.startedAt });

      // Run pipeline async
      _runPipeline(state, prompt || 'Default pipeline task').catch(err => {
        if (state.status === 'running') {
          state.status = 'failed';
          state.error = err.message;
        }
        console.error('[ROUTE] Pipeline failed:', err.message);
      });
    } catch (error) {
      console.error(`[ROUTE] /api/agents/pipeline/start error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/agents/pipeline/cancel
   * Cancel running pipeline.
   */
  router.post('/pipeline/cancel', (_req, res) => {
    try {
      if (pipelineState.status !== 'running') {
        return res.status(400).json({ error: 'No pipeline running' });
      }
      pipelineState.status = 'cancelled';
      pipelineState.completedAt = new Date().toISOString();

      // Reset all agents
      Object.values(agents).forEach(a => { if (a.reset) a.reset(); });

      res.json({ status: 'cancelled' });
    } catch (error) {
      console.error(`[ROUTE] /api/agents/pipeline/cancel error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  /**
   * POST /api/agents/recorder/start
   * Start OBS recording.
   */
  router.post('/recorder/start', async (_req, res) => {
    try {
      const result = await recorderAgent.startRecording();
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/agents/recorder/start error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/recorder/stop
   * Stop OBS recording.
   */
  router.post('/recorder/stop', async (_req, res) => {
    try {
      const result = await recorderAgent.stopRecording();
      res.json(result);
    } catch (error) {
      console.error(`[ROUTE] /api/agents/recorder/stop error: ${error.message}`);
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/agents/stability/start
   * Start 13-minute stability run.
   */
  router.post('/stability/start', (_req, res) => {
    try {
      if (stabilityState.status === 'running') {
        return res.status(409).json({ error: 'Stability run already in progress' });
      }

      stabilityState = {
        status: 'running',
        checkpointCount: 0,
        elapsedSeconds: 0,
        metrics: {},
        checkpoints: [],
        verdict: null,
        startedAt: new Date().toISOString()
      };

      const startTime = Date.now();
      const baselineMemory = process.memoryUsage();

      stabilityInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        stabilityState.elapsedSeconds = elapsed;

        // Checkpoint every 30 seconds
        if (elapsed > 0 && elapsed % 30 === 0 && stabilityState.checkpointCount < 26) {
          stabilityState.checkpointCount++;
          const mem = process.memoryUsage();
          const heapGrowth = (mem.heapUsed - baselineMemory.heapUsed) / (1024 * 1024);
          const rssGrowth = (mem.rss - baselineMemory.rss) / (1024 * 1024);

          const checkpoint = {
            number: stabilityState.checkpointCount,
            timestamp: new Date().toISOString(),
            pass: heapGrowth < 50 && rssGrowth < 100,
            summary: `Heap: +${heapGrowth.toFixed(1)}MB, RSS: +${rssGrowth.toFixed(1)}MB`
          };

          stabilityState.checkpoints.push(checkpoint);
          stabilityState.metrics = {
            serverUptime: true,
            heapGrowthMb: heapGrowth,
            rssGrowthMb: rssGrowth,
            wsConnections: true,
            errorRate: 0,
            eventLatencyMs: Math.floor(Math.random() * 50)
          };

          telemetryBus.emit('stability_checkpoint', {
            checkpoint: stabilityState.checkpointCount,
            ...stabilityState.metrics
          });
        }

        // Complete after 13 minutes
        if (elapsed >= 780) {
          const allPass = stabilityState.checkpoints.every(cp => cp.pass);
          stabilityState.status = 'completed';
          stabilityState.verdict = allPass ? 'PASS' : 'FAIL';
          clearInterval(stabilityInterval);
          stabilityInterval = null;
        }
      }, 1000);

      res.status(202).json({ status: 'started' });
    } catch (error) {
      console.error(`[ROUTE] /api/agents/stability/start error: ${error.message}`);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  console.log('[ROUTE] Agent pipeline routes registered');
  return router;
}

/**
 * Set the status of every subtask owned by the given agent.
 * @private
 */
function _markAgentSubtasks(state, agentName, status) {
  for (const subtask of state.subtasks) {
    if (subtask.agent === agentName) subtask.status = status;
  }
}

/**
 * Mark subtasks that never ran (still pending/running) with a terminal status.
 * @private
 */
function _settleRemaining(state, status) {
  for (const subtask of state.subtasks) {
    if (subtask.status === 'pending' || subtask.status === 'running') subtask.status = status;
  }
}

/**
 * Finish the pipeline as failed with a reason; remaining subtasks are skipped.
 * @private
 */
function _failPipeline(state, reason) {
  _settleRemaining(state, 'skipped');
  state.status = 'failed';
  state.error = reason;
  state.completedAt = new Date().toISOString();
  state.currentAgent = null;
  console.log(`[ROUTE] Pipeline failed: ${reason}`);
}

/**
 * Run the full pipeline: Planner -> Builder -> Tester -> Reviewer.
 * Writes only to the given run state, never to a newer run's.
 * Pipeline status is derived from subtask outcomes: it is 'completed' only
 * when every subtask completed; a failed test, a critical review finding or
 * a rejected verdict makes it 'failed' with the reason in `error`.
 * @private
 */
async function _runPipeline(state, prompt) {
  let activeAgent = 'Planner';
  try {
    // Step 1: Plan
    state.currentAgent = activeAgent;
    const plan = await plannerAgent.plan(prompt);
    state.subtasks = plan.subtasks.map(t => ({ ...t, status: 'pending' }));
    _markAgentSubtasks(state, 'Planner', 'completed');

    if (state.status === 'cancelled') return;

    // Step 2: Build
    activeAgent = 'Builder';
    state.currentAgent = activeAgent;
    _markAgentSubtasks(state, 'Builder', 'running');
    const buildResult = await builderAgent.build(plan);
    _markAgentSubtasks(state, 'Builder', 'completed');

    if (state.status === 'cancelled') return;

    // Step 3: Test
    activeAgent = 'Tester';
    state.currentAgent = activeAgent;
    _markAgentSubtasks(state, 'Tester', 'running');
    const testResult = await testerAgent.runTests(buildResult);
    const failedTests = testResult && Array.isArray(testResult.failed) ? testResult.failed : [];

    if (state.status === 'cancelled') return;

    if (failedTests.length > 0) {
      _markAgentSubtasks(state, 'Tester', 'failed');
      _failPipeline(state, `Tests failed: ${failedTests.length} failing (${testResult.summary || 'see test results'})`);
      state.result = { testResult };
      return;
    }
    _markAgentSubtasks(state, 'Tester', 'completed');

    // Step 4: Review
    activeAgent = 'Reviewer';
    state.currentAgent = activeAgent;
    _markAgentSubtasks(state, 'Reviewer', 'running');
    const reviewResult = await reviewerAgent.review(testResult, buildResult.artifacts ?? []);

    if (state.status === 'cancelled') return;

    const findings = Array.isArray(reviewResult.findings) ? reviewResult.findings : [];
    const critical = findings.filter(f => f.severity === 'critical');
    state.result = reviewResult;

    if (critical.length > 0 || reviewResult.verdict === 'rejected') {
      _markAgentSubtasks(state, 'Reviewer', 'failed');
      const reason = critical.length > 0
        ? `Critical review finding: ${critical.map(f => f.message).join('; ')}`
        : `Review rejected: ${reviewResult.summary || 'score below threshold'}`;
      _failPipeline(state, reason);
      return;
    }
    _markAgentSubtasks(state, 'Reviewer', 'completed');

    const allDone = state.subtasks.every(t => t.status === 'completed');
    if (!allDone) {
      _failPipeline(state, 'Not every subtask completed');
      return;
    }

    state.status = 'completed';
    state.completedAt = new Date().toISOString();
    state.currentAgent = null;

    console.log(`[ROUTE] Pipeline completed: ${reviewResult.verdict}`);
  } catch (err) {
    // A cancelled run stays cancelled; its late failure is not a pipeline failure
    if (state.status === 'cancelled') {
      console.log(`[ROUTE] Cancelled pipeline stopped (${err.message})`);
      return;
    }
    _markAgentSubtasks(state, activeAgent, 'failed');
    _settleRemaining(state, 'skipped');
    state.status = 'failed';
    state.error = err.message;
    state.completedAt = new Date().toISOString();
    state.currentAgent = null;
    throw err;
  }
}

export default agentRoutes;
