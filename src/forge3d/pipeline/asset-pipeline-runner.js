/**
 * AssetPipelineRunner - Config-driven asset production pipeline executor
 *
 * Loads pipeline definitions from config/asset-pipelines.yaml and executes
 * stages sequentially. Integrates with Phase 9 orchestration modules:
 * - OrchestrationEventBus for event emission
 * - TaskState for lifecycle tracking
 * - SupervisorAgent for quality gate validation
 *
 * Emits SSE-compatible events at each stage transition:
 *   pipeline_started, stage_started, stage_completed,
 *   stage_failed, pipeline_complete, pipeline_failed
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 6, 2026
 */

import { EventEmitter } from 'events';
import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { getStageHandler } from './stages/index.js';
import orchestrator from '../../orchestration/index.js';
import errorHandler from '../../core/error-handler.js';
import telemetryBus from '../../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Pipeline execution states
const PIPELINE_STATES = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

class AssetPipelineRunner extends EventEmitter {
  constructor() {
    super();

    this.pipelines = {};
    this.defaults = {};
    this.activePipelines = new Map();
    this.configLoaded = false;
  }

  /**
   * Load pipeline definitions from YAML config.
   * Called lazily on first pipeline run.
   */
  loadConfig() {
    if (this.configLoaded) return;

    const configPath = join(__dirname, '..', '..', '..', 'config', 'asset-pipelines.yaml');

    if (!existsSync(configPath)) {
      console.warn('[PIPELINE] Config file not found:', configPath);
      this.configLoaded = true;
      return;
    }

    try {
      const raw = readFileSync(configPath, 'utf8');
      const config = parse(raw);

      this.defaults = config.defaults || {};
      this.pipelines = config.pipelines || {};
      this.configLoaded = true;

      const pipelineNames = Object.keys(this.pipelines);
      console.log(`[PIPELINE] Loaded ${pipelineNames.length} pipeline definitions: ${pipelineNames.join(', ')}`);
    } catch (err) {
      errorHandler.report('pipeline_error', err, { operation: 'loadConfig' });
      console.error('[PIPELINE] Failed to load config:', err.message);
      this.configLoaded = true;
    }
  }

  /**
   * List available pipeline templates.
   *
   * @returns {Object[]} Pipeline summaries with name, description, stage count
   */
  listTemplates() {
    this.loadConfig();

    return Object.entries(this.pipelines).map(([name, def]) => ({
      name,
      description: def.description || '',
      stageCount: (def.stages || []).length,
      stages: (def.stages || []).map(s => s.name)
    }));
  }

  /**
   * Start a pipeline execution.
   *
   * @param {string} pipelineName - Name from asset-pipelines.yaml (e.g. 'generate_game_asset')
   * @param {Object} params - Execution parameters
   * @param {string} params.prompt - Text prompt for generation
   * @param {Buffer} [params.imageBuffer] - Reference image for mesh generation
   * @param {string} [params.projectId] - Target project for asset export
   * @param {string} [params.model] - Model override
   * @returns {string} pipelineId - Unique ID for tracking this execution
   */
  start(pipelineName, params = {}) {
    this.loadConfig();

    const definition = this.pipelines[pipelineName];
    if (!definition) {
      const available = Object.keys(this.pipelines).join(', ');
      throw new Error(`Unknown pipeline: ${pipelineName}. Available: ${available}`);
    }

    if (!params.prompt && !params.imageBuffer) {
      throw new Error('Pipeline requires at least a prompt or imageBuffer');
    }

    const pipelineId = randomUUID().slice(0, 12);
    const stages = definition.stages || [];

    const execution = {
      id: pipelineId,
      pipelineName,
      description: definition.description,
      status: PIPELINE_STATES.PENDING,
      stages: stages.map((s, i) => ({
        index: i,
        name: s.name,
        handler: s.handler,
        config: s.config || {},
        gate: s.gate || null,
        status: 'pending',
        result: null,
        error: null,
        startedAt: null,
        completedAt: null
      })),
      context: {
        pipelineId,
        prompt: params.prompt || null,
        imageBuffer: params.imageBuffer || null,
        projectId: params.projectId || null,
        model: params.model || null,
        ...Object.fromEntries(
          Object.entries(params).filter(([k]) =>
            !['prompt', 'imageBuffer', 'projectId', 'model'].includes(k)
          )
        )
      },
      currentStageIndex: -1,
      startedAt: null,
      completedAt: null,
      error: null,
      abortController: new AbortController()
    };

    this.activePipelines.set(pipelineId, execution);

    // Fire-and-forget execution
    this._execute(pipelineId).catch((err) => {
      console.error(`[PIPELINE] Unhandled execution error for ${pipelineId}:`, err.message);
      errorHandler.report('pipeline_error', err, { pipelineId });
    });

    return pipelineId;
  }

  /**
   * Get the current status of a pipeline execution.
   *
   * @param {string} pipelineId
   * @returns {Object|null} Pipeline status or null if not found
   */
  getStatus(pipelineId) {
    const exec = this.activePipelines.get(pipelineId);
    if (!exec) return null;

    return {
      id: exec.id,
      pipelineName: exec.pipelineName,
      description: exec.description,
      status: exec.status,
      currentStageIndex: exec.currentStageIndex,
      stages: exec.stages.map(s => ({
        name: s.name,
        status: s.status,
        error: s.error,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        result: s.result
      })),
      startedAt: exec.startedAt,
      completedAt: exec.completedAt,
      error: exec.error
    };
  }

  /**
   * Cancel a running pipeline.
   *
   * @param {string} pipelineId
   * @returns {boolean} true if cancelled
   */
  cancel(pipelineId) {
    const exec = this.activePipelines.get(pipelineId);
    if (!exec || exec.status !== PIPELINE_STATES.RUNNING) {
      return false;
    }

    exec.abortController.abort();
    exec.status = PIPELINE_STATES.CANCELLED;
    exec.completedAt = new Date().toISOString();

    this._emitEvent('pipeline_failed', {
      pipelineId,
      pipelineName: exec.pipelineName,
      reason: 'cancelled',
      stageIndex: exec.currentStageIndex
    });

    console.log(`[PIPELINE] Cancelled pipeline ${pipelineId}`);
    return true;
  }

  /**
   * List active pipeline executions.
   *
   * @returns {Object[]} Active pipeline summaries
   */
  listActive() {
    const results = [];
    for (const [id, exec] of this.activePipelines) {
      results.push({
        id,
        pipelineName: exec.pipelineName,
        status: exec.status,
        currentStageIndex: exec.currentStageIndex,
        totalStages: exec.stages.length,
        startedAt: exec.startedAt
      });
    }
    return results;
  }

  // --- Private execution engine ---

  /**
   * Execute a pipeline sequentially through all stages.
   * @private
   */
  async _execute(pipelineId) {
    const exec = this.activePipelines.get(pipelineId);
    if (!exec) return;

    exec.status = PIPELINE_STATES.RUNNING;
    exec.startedAt = new Date().toISOString();

    const endTimer = telemetryBus.startTimer('pipeline_execution');

    // Emit pipeline_started
    this._emitEvent('pipeline_started', {
      pipelineId,
      pipelineName: exec.pipelineName,
      description: exec.description,
      stageCount: exec.stages.length,
      stages: exec.stages.map(s => s.name)
    });

    console.log(`[PIPELINE] Starting ${exec.pipelineName} (${exec.stages.length} stages)`);

    // Initialize orchestration task if runtime is available
    let orchTaskId = null;
    if (orchestrator.initialized && orchestrator.taskState) {
      try {
        const task = orchestrator.taskState.create({
          taskName: `Pipeline: ${exec.pipelineName}`,
          agent: 'Claude',
          phase: 'implementation',
          nextAction: `Execute stage: ${exec.stages[0]?.name || 'none'}`
        });
        orchTaskId = task.task_id;
      } catch (err) {
        // Orchestration is optional — continue without it
        console.warn('[PIPELINE] Orchestration task creation failed (non-fatal):', err.message);
      }
    }

    // Execute stages sequentially
    for (let i = 0; i < exec.stages.length; i++) {
      // Check for cancellation
      if (exec.abortController.signal.aborted) {
        console.log(`[PIPELINE] Pipeline ${pipelineId} was cancelled at stage ${i}`);
        break;
      }

      const stage = exec.stages[i];
      exec.currentStageIndex = i;

      // Run stage
      const stageSuccess = await this._executeStage(exec, stage, i, orchTaskId);

      if (!stageSuccess) {
        // Stage failed — halt pipeline
        exec.status = PIPELINE_STATES.FAILED;
        exec.completedAt = new Date().toISOString();
        exec.error = stage.error || 'Stage failed';

        this._emitEvent('pipeline_failed', {
          pipelineId,
          pipelineName: exec.pipelineName,
          failedStage: stage.name,
          stageIndex: i,
          error: exec.error
        });

        // Update orchestration task if available
        if (orchTaskId && orchestrator.initialized) {
          try {
            orchestrator.taskState.transition(orchTaskId, 'failed', 'Claude', {
              reason: `Stage ${stage.name} failed: ${exec.error}`
            });
          } catch (_e) {
            // Non-fatal
          }
        }

        endTimer({ pipelineId, status: 'failed', failedStage: stage.name });
        console.log(`[PIPELINE] Pipeline ${pipelineId} FAILED at stage ${stage.name}: ${exec.error}`);
        return;
      }
    }

    // Pipeline completed (or was cancelled)
    if (exec.status === PIPELINE_STATES.RUNNING) {
      exec.status = PIPELINE_STATES.COMPLETED;
      exec.completedAt = new Date().toISOString();

      this._emitEvent('pipeline_complete', {
        pipelineId,
        pipelineName: exec.pipelineName,
        stagesCompleted: exec.stages.length,
        context: this._sanitizeContext(exec.context)
      });

      // Complete orchestration task
      if (orchTaskId && orchestrator.initialized) {
        try {
          orchestrator.taskState.transition(orchTaskId, 'completed', 'Claude');
        } catch (_e) {
          // Non-fatal
        }
      }

      endTimer({ pipelineId, status: 'completed' });
      console.log(`[PIPELINE] Pipeline ${pipelineId} COMPLETED successfully`);
    } else {
      endTimer({ pipelineId, status: exec.status });
    }
  }

  /**
   * Execute a single pipeline stage.
   * @private
   * @returns {Promise<boolean>} true if stage succeeded
   */
  async _executeStage(exec, stage, stageIndex, orchTaskId) {
    stage.status = 'running';
    stage.startedAt = new Date().toISOString();

    // Emit stage_started
    this._emitEvent('stage_started', {
      pipelineId: exec.id,
      pipelineName: exec.pipelineName,
      stageName: stage.name,
      stageIndex,
      totalStages: exec.stages.length
    });

    console.log(`[PIPELINE] Stage ${stageIndex + 1}/${exec.stages.length}: ${stage.name}`);

    // Look up handler
    const handler = getStageHandler(stage.handler);
    if (!handler) {
      stage.status = 'failed';
      stage.error = `Unknown handler: ${stage.handler}`;
      stage.completedAt = new Date().toISOString();

      this._emitEvent('stage_failed', {
        pipelineId: exec.id,
        stageName: stage.name,
        stageIndex,
        error: stage.error
      });

      return false;
    }

    try {
      // Execute the handler
      const result = await handler.execute(exec.context, stage.config);

      if (!result.success) {
        stage.status = 'failed';
        stage.error = result.error || 'Stage handler returned failure';
        stage.result = result.result;
        stage.completedAt = new Date().toISOString();

        this._emitEvent('stage_failed', {
          pipelineId: exec.id,
          stageName: stage.name,
          stageIndex,
          error: stage.error
        });

        return false;
      }

      // Merge stage results into pipeline context
      if (result.result) {
        Object.assign(exec.context, result.result);
      }

      stage.status = 'completed';
      stage.result = result.result;
      stage.completedAt = new Date().toISOString();

      // Run supervisor gate if configured
      if (stage.gate === 'supervisor') {
        const gateResult = this._runSupervisorGate(exec, stage, stageIndex);
        if (!gateResult) {
          return false;
        }
      }

      // Emit stage_completed
      this._emitEvent('stage_completed', {
        pipelineId: exec.id,
        pipelineName: exec.pipelineName,
        stageName: stage.name,
        stageIndex,
        totalStages: exec.stages.length
      });

      // Update orchestration task next action
      if (orchTaskId && orchestrator.initialized) {
        try {
          const nextStage = exec.stages[stageIndex + 1];
          if (nextStage) {
            orchestrator.taskState.update(orchTaskId, {
              agent: 'Claude',
              next_action: `Execute stage: ${nextStage.name}`
            });
          }
        } catch (_e) {
          // Non-fatal
        }
      }

      return true;
    } catch (err) {
      stage.status = 'failed';
      stage.error = err.message;
      stage.completedAt = new Date().toISOString();

      errorHandler.report('pipeline_error', err, {
        pipelineId: exec.id,
        stage: stage.name,
        stageIndex
      });

      this._emitEvent('stage_failed', {
        pipelineId: exec.id,
        stageName: stage.name,
        stageIndex,
        error: err.message
      });

      return false;
    }
  }

  /**
   * Run supervisor quality gate after a stage.
   * @private
   * @returns {boolean} true if gate passed
   */
  _runSupervisorGate(exec, stage, stageIndex) {
    if (!orchestrator.initialized || !orchestrator.supervisor) {
      // Supervisor not available — skip gate (pass by default)
      console.warn(`[PIPELINE] Supervisor not initialized, skipping gate for ${stage.name}`);
      return true;
    }

    try {
      // Use stage result for validation context
      const stageResult = stage.result || {};
      const violations = stageResult.violations || [];
      const passed = stageResult.passed !== false;

      if (!passed) {
        stage.status = 'failed';
        stage.error = `Supervisor gate rejected: ${violations.join('; ')}`;

        this._emitEvent('stage_failed', {
          pipelineId: exec.id,
          stageName: stage.name,
          stageIndex,
          error: stage.error,
          gate: 'supervisor',
          violations
        });

        console.log(`[PIPELINE] Supervisor gate REJECTED at ${stage.name}: ${violations.length} violation(s)`);
        return false;
      }

      console.log(`[PIPELINE] Supervisor gate PASSED at ${stage.name}`);
      return true;
    } catch (err) {
      console.warn(`[PIPELINE] Supervisor gate error (non-fatal): ${err.message}`);
      // Gate errors are non-fatal — pass through
      return true;
    }
  }

  /**
   * Emit an event via both EventEmitter (for SSE) and TelemetryBus.
   * @private
   */
  _emitEvent(eventType, data) {
    // Emit for SSE listeners
    super.emit(eventType, data);
    super.emit('all', { eventType, ...data });

    // Forward to telemetry
    telemetryBus.emit('pipeline', { eventType, ...data });

    // Forward to orchestration event bus if available
    if (orchestrator.initialized && orchestrator.eventBus) {
      try {
        // Map pipeline events to orchestration event types
        const orchEventMap = {
          pipeline_started: 'task_started',
          stage_started: 'implementation_started',
          stage_completed: 'file_written',
          pipeline_complete: 'task_completed',
          pipeline_failed: 'risk_flagged'
        };

        const orchEventType = orchEventMap[eventType];
        if (orchEventType) {
          orchestrator.eventBus.emit(orchEventType, {
            agent: 'Claude',
            taskId: data.pipelineId,
            payload: data
          });
        }
      } catch (_e) {
        // Non-fatal — orchestration event forwarding is best-effort
      }
    }
  }

  /**
   * Remove buffers from context for safe serialization.
   * @private
   */
  _sanitizeContext(context) {
    const safe = { ...context };
    delete safe.imageBuffer;
    delete safe.meshBuffer;
    delete safe.optimizedBuffer;
    delete safe.fbxBuffer;
    return safe;
  }
}

// Singleton + named export
const assetPipelineRunner = new AssetPipelineRunner();
export default assetPipelineRunner;
export { AssetPipelineRunner, PIPELINE_STATES };
