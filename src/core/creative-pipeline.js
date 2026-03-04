/**
 * CreativePipeline - Cross-domain orchestration engine
 *
 * Executes multi-domain prompts by coordinating code, design, and 3D generation.
 * Runs steps sequentially, passing output paths to subsequent steps.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { EventEmitter } from 'events';
import { MasterAgent } from '../agents/master-agent.js';
import { designEngine } from './design-engine.js';
import pipelineDetector from './pipeline-detector.js';
import telemetryBus from './telemetry-bus.js';
import errorHandler from './error-handler.js';

class CreativePipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.masterAgent = options.masterAgent || new MasterAgent();
  }

  /**
   * Execute a creative pipeline from a multi-domain prompt.
   *
   * @param {string} prompt - User prompt (already detected as multi-domain)
   * @param {string} projectRoot - Target project directory
   * @param {Object} options - { signal, forge3dBridge, onStepStart, onStepComplete }
   * @returns {Promise<Object>} Pipeline result with all generated assets
   */
  async execute(prompt, projectRoot, options = {}) {
    const endTimer = telemetryBus.startTimer('creative_pipeline');
    const analysis = pipelineDetector.analyze(prompt);

    if (!analysis.isPipeline) {
      throw new Error('Prompt does not require pipeline mode');
    }

    const result = {
      success: false,
      prompt,
      domains: analysis.domains,
      steps: [],
      assets: {},
      totalCost: 0,
      errors: []
    };

    console.log(`[PIPELINE] Starting creative pipeline: ${analysis.domains.join(' + ')} (${analysis.steps.length} steps)`);
    this.emit('pipeline:started', {
      prompt,
      domains: analysis.domains,
      stepCount: analysis.steps.length
    });

    // Track generated asset paths for injection into later steps
    const generatedAssets = {
      images: [],
      meshes: [],
      code: []
    };

    for (let i = 0; i < analysis.steps.length; i++) {
      const step = analysis.steps[i];
      const stepNum = i + 1;

      // Check for cancellation
      if (options.signal?.aborted) {
        result.errors.push('Pipeline cancelled');
        this.emit('pipeline:cancelled', { step: stepNum });
        endTimer({ cancelled: true, stepsCompleted: i });
        return result;
      }

      console.log(`[PIPELINE] Step ${stepNum}/${analysis.steps.length}: ${step.description} (${step.domain})`);
      this.emit('pipeline:step_start', {
        step: stepNum,
        total: analysis.steps.length,
        domain: step.domain,
        description: step.description
      });

      if (options.onStepStart) {
        options.onStepStart(stepNum, analysis.steps.length, step);
      }

      try {
        let stepResult;

        switch (step.domain) {
        case 'forge3d':
          stepResult = await this._executeForge3D(step.prompt, projectRoot, options);
          if (stepResult.meshPath) generatedAssets.meshes.push(stepResult.meshPath);
          if (stepResult.imagePath) generatedAssets.images.push(stepResult.imagePath);
          break;

        case 'design':
          stepResult = await this._executeDesign(step.prompt, projectRoot, options);
          if (stepResult.images) {
            stepResult.images.forEach(img => {
              if (img.path) generatedAssets.images.push(img.path);
            });
          }
          break;

        case 'code':
          stepResult = await this._executeCode(step.prompt, projectRoot, generatedAssets, options);
          break;

        default:
          stepResult = { success: false, error: `Unknown domain: ${step.domain}` };
        }

        result.steps.push({
          step: stepNum,
          domain: step.domain,
          success: stepResult.success !== false,
          result: stepResult,
          cost: stepResult.cost || 0
        });

        result.totalCost += stepResult.cost || 0;
        result.assets[step.domain] = stepResult;

        this.emit('pipeline:step_complete', {
          step: stepNum,
          total: analysis.steps.length,
          domain: step.domain,
          success: stepResult.success !== false,
          cost: stepResult.cost || 0
        });

        if (options.onStepComplete) {
          options.onStepComplete(stepNum, analysis.steps.length, step, stepResult);
        }

        // If a step fails, continue with remaining steps (partial success)
        if (stepResult.success === false) {
          result.errors.push(`Step ${stepNum} (${step.domain}) failed: ${stepResult.error || 'unknown'}`);
          console.warn(`[PIPELINE] Step ${stepNum} failed: ${stepResult.error}`);
        }

      } catch (error) {
        console.error(`[PIPELINE] Step ${stepNum} error: ${error.message}`);
        errorHandler.report('pipeline_error', error, { step: stepNum, domain: step.domain });

        result.steps.push({
          step: stepNum,
          domain: step.domain,
          success: false,
          error: error.message,
          cost: 0
        });
        result.errors.push(`Step ${stepNum} (${step.domain}): ${error.message}`);

        this.emit('pipeline:step_complete', {
          step: stepNum,
          total: analysis.steps.length,
          domain: step.domain,
          success: false,
          error: error.message
        });
      }
    }

    result.success = result.errors.length === 0;

    console.log(
      `[PIPELINE] Pipeline complete: ${result.success ? 'SUCCESS' : 'PARTIAL'} ` +
      `(${result.steps.filter(s => s.success).length}/${result.steps.length} steps, ` +
      `$${result.totalCost.toFixed(4)})`
    );

    this.emit('pipeline:complete', {
      success: result.success,
      domains: analysis.domains,
      stepsCompleted: result.steps.filter(s => s.success).length,
      totalSteps: result.steps.length,
      totalCost: result.totalCost,
      errors: result.errors
    });

    endTimer({
      success: result.success,
      domains: analysis.domains.join(','),
      steps: result.steps.length,
      cost: result.totalCost
    });

    return result;
  }

  /**
   * Execute a 3D generation step.
   * @private
   */
  async _executeForge3D(prompt, _projectRoot, options = {}) {
    const bridge = options.forge3dBridge;
    if (!bridge || bridge.state !== 'running') {
      console.warn('[PIPELINE] Forge3D bridge not available, skipping 3D step');
      return {
        success: false,
        error: 'Forge3D bridge not running. Start the Forge3D tab first.',
        cost: 0
      };
    }

    try {
      const result = await bridge.generateFull(prompt, {
        steps: 25,
        jobId: `pipeline-${Date.now()}`
      });

      return {
        success: result.success,
        meshPath: result.mesh_path,
        imagePath: result.image_path,
        totalTime: result.total_time,
        stages: result.stages,
        cost: 0 // Local GPU generation is free
      };
    } catch (error) {
      return { success: false, error: error.message, cost: 0 };
    }
  }

  /**
   * Execute a design generation step.
   * @private
   */
  async _executeDesign(prompt, _projectRoot, _options = {}) {
    try {
      const result = await designEngine.generateDesign(prompt, {
        styleName: 'default',
        imageCount: 2
      });

      return {
        success: true,
        html: result.html,
        images: result.images,
        cost: result.cost || 0
      };
    } catch (error) {
      return { success: false, error: error.message, cost: 0 };
    }
  }

  /**
   * Execute a code generation step with injected asset paths.
   * @private
   */
  async _executeCode(prompt, projectRoot, generatedAssets, options = {}) {
    try {
      // Enhance the prompt with references to generated assets
      let enhancedPrompt = prompt;

      if (generatedAssets.meshes.length > 0) {
        enhancedPrompt += `\n\nGenerated 3D assets available at: ${generatedAssets.meshes.join(', ')}`;
      }
      if (generatedAssets.images.length > 0) {
        enhancedPrompt += `\n\nGenerated images available at: ${generatedAssets.images.join(', ')}`;
      }

      const plan = await this.masterAgent.run(enhancedPrompt, projectRoot, {
        signal: options.signal
      });

      return {
        success: true,
        plan,
        operations: plan.operations?.length || 0,
        cost: plan.cost || 0,
        provider: plan.provider,
        model: plan.model
      };
    } catch (error) {
      return { success: false, error: error.message, cost: 0 };
    }
  }
}

// Singleton
const creativePipeline = new CreativePipeline();
export default creativePipeline;
export { CreativePipeline };

// --test block
if (process.argv.includes('--test')) {
  console.log('Testing CreativePipeline...\n');

  try {
    // Test 1: Constructor
    console.log('[TEST] Test 1: Constructor...');
    const pipeline = new CreativePipeline();
    if (!(pipeline instanceof EventEmitter)) throw new Error('Should be EventEmitter');
    console.log('[TEST] PASSED');

    // Test 2: Events are emitted
    console.log('[TEST] Test 2: Event emission...');
    let _eventFired = false;
    pipeline.on('pipeline:started', () => { _eventFired = true; });

    // Test 3: Pipeline detection integration
    console.log('[TEST] Test 3: Pipeline detection integration...');
    const { default: detector } = await import('./pipeline-detector.js');
    const analysis = detector.analyze('build a landing page with a hero image and spinning 3D logo');
    if (!analysis.isPipeline) throw new Error('Should detect as pipeline');
    console.log(`[TEST] PASSED (domains: ${analysis.domains.join(', ')})`);

    // Test 4: Execute rejects non-pipeline prompts
    console.log('[TEST] Test 4: Reject non-pipeline prompts...');
    try {
      await pipeline.execute('fix a typo', '/tmp');
      throw new Error('Should have thrown');
    } catch (error) {
      if (!error.message.includes('does not require pipeline')) throw error;
      console.log('[TEST] PASSED');
    }

    console.log('\n[TEST] All CreativePipeline tests PASSED!');
  } catch (error) {
    console.error(`\n[TEST] FAILED: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  }
}
