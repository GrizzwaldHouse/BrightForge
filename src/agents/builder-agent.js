/**
 * BuilderAgent - Central implementation hub
 *
 * Receives plans from PlannerAgent and executes subtasks in dependency
 * order. Can spawn Survey/Recorder agents as needed.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

class BuilderAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Builder';
    this.type = 'implementation';
    this.status = 'idle'; // idle | building | complete | error
    this.currentBuild = null;
    this.surveyCallbacks = [];
    this.recordingCallbacks = [];
  }

  /**
   * Execute a plan by processing subtasks in dependency order.
   * @param {Object} plan - Plan object from PlannerAgent
   * @param {Object} context - { files, projectRoot, options }
   * @returns {{ buildId, results: [], artifacts: [], summary }}
   */
  async build(plan, context = {}) {
    this.status = 'building';
    const buildId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('agent_action', { agent: this.name, action: 'build' });

    try {
      console.log(`[BUILDER] Starting build ${buildId} for plan ${plan.planId}`);
      this.emit('build_start', { buildId, planId: plan.planId });

      const results = [];
      const artifacts = [];

      // Filter subtasks assigned to Builder
      const mySubtasks = plan.subtasks.filter(t => t.agent === 'Builder');

      // Execute each subtask
      for (const subtask of mySubtasks) {
        this.emit('subtask_start', { buildId, subtaskId: subtask.id, title: subtask.title });
        console.log(`[BUILDER] Executing subtask: ${subtask.title}`);

        const subtaskResult = await this._executeSubtask(subtask, context);
        results.push(subtaskResult);

        if (subtaskResult.artifacts) {
          artifacts.push(...subtaskResult.artifacts);
        }

        this.emit('subtask_complete', { buildId, subtaskId: subtask.id, result: subtaskResult });
      }

      const build = {
        buildId,
        planId: plan.planId,
        results,
        artifacts,
        summary: `Executed ${mySubtasks.length} subtasks, created ${artifacts.length} artifacts`,
        createdAt: new Date().toISOString()
      };

      this.currentBuild = build;
      this.status = 'complete';

      endTimer({ buildId, subtaskCount: mySubtasks.length, artifactCount: artifacts.length, status: 'success' });

      this.emit('build_complete', build);
      console.log(`[BUILDER] Build ${buildId} complete: ${build.summary}`);

      return build;
    } catch (err) {
      this.status = 'error';
      endTimer({ buildId, status: 'failed', error: err.message });
      errorHandler.report('agent_error', err, { agent: this.name, buildId, planId: plan.planId });
      this.emit('build_error', { buildId, error: err.message });
      throw err;
    }
  }

  async _executeSubtask(subtask, _context) {
    // Simulate implementation work
    const startTime = Date.now();

    // Mock implementation - in real world would apply file changes
    const artifact = {
      type: 'file',
      path: `src/generated/${subtask.id}.js`,
      description: subtask.description
    };

    const duration = Date.now() - startTime;

    return {
      subtaskId: subtask.id,
      status: 'success',
      artifacts: [artifact],
      duration,
      message: `Completed: ${subtask.title}`
    };
  }

  /**
   * Request a survey from SurveyAgent.
   * @param {Array<string>} questions - Survey questions
   * @returns {Promise<string>} surveyId
   */
  async requestSurvey(questions) {
    console.log(`[BUILDER] Requesting survey with ${questions.length} questions`);
    const surveyId = randomUUID().slice(0, 8);

    // Emit request event - SurveyAgent would listen
    this.emit('survey_requested', { surveyId, questions });

    // Store callback for later
    return new Promise((resolve) => {
      this.surveyCallbacks.push({ surveyId, resolve });
      // Auto-resolve after timeout for testing
      setTimeout(() => resolve(surveyId), 100);
    });
  }

  /**
   * Request recording from RecorderAgent.
   * @param {Object} config - Recording configuration
   * @returns {Promise<string>} recordingId
   */
  async requestRecording(config = {}) {
    console.log('[BUILDER] Requesting recording');
    const recordingId = randomUUID().slice(0, 8);

    // Emit request event - RecorderAgent would listen
    this.emit('recording_requested', { recordingId, config });

    return new Promise((resolve) => {
      this.recordingCallbacks.push({ recordingId, resolve });
      // Auto-resolve after timeout for testing
      setTimeout(() => resolve(recordingId), 100);
    });
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      currentBuild: this.currentBuild ? {
        buildId: this.currentBuild.buildId,
        planId: this.currentBuild.planId,
        artifactCount: this.currentBuild.artifacts.length,
        createdAt: this.currentBuild.createdAt
      } : null
    };
  }

  reset() {
    this.status = 'idle';
    this.currentBuild = null;
    this.surveyCallbacks = [];
    this.recordingCallbacks = [];
    console.log('[BUILDER] Reset to idle state');
  }
}

const builderAgent = new BuilderAgent();
export default builderAgent;
export { BuilderAgent };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing BuilderAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new BuilderAgent();
    if (agent.name !== 'Builder') throw new Error('Name should be Builder');
    if (agent.status !== 'idle') throw new Error('Initial status should be idle');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Build execution
    console.log('\n[TEST] Test 2: Build execution...');
    let buildStartEmitted = false;
    let subtaskStartEmitted = false;
    let subtaskCompleteEmitted = false;
    let buildCompleteEmitted = false;

    agent.on('build_start', () => { buildStartEmitted = true; });
    agent.on('subtask_start', () => { subtaskStartEmitted = true; });
    agent.on('subtask_complete', () => { subtaskCompleteEmitted = true; });
    agent.on('build_complete', () => { buildCompleteEmitted = true; });

    const mockPlan = {
      planId: 'plan-123',
      subtasks: [
        { id: 'task-1', title: 'Task 1', agent: 'Builder', description: 'Test task 1' },
        { id: 'task-2', title: 'Task 2', agent: 'Builder', description: 'Test task 2' },
        { id: 'task-3', title: 'Task 3', agent: 'Tester', description: 'Test task 3' }
      ]
    };

    const build = await agent.build(mockPlan, { files: [], projectRoot: './test' });

    if (!build.buildId) throw new Error('Build should have buildId');
    if (build.planId !== 'plan-123') throw new Error('Build planId mismatch');
    if (build.results.length !== 2) throw new Error(`Expected 2 results (Builder tasks), got ${build.results.length}`);
    if (build.artifacts.length !== 2) throw new Error(`Expected 2 artifacts, got ${build.artifacts.length}`);
    if (!buildStartEmitted) throw new Error('build_start event should be emitted');
    if (!subtaskStartEmitted) throw new Error('subtask_start event should be emitted');
    if (!subtaskCompleteEmitted) throw new Error('subtask_complete event should be emitted');
    if (!buildCompleteEmitted) throw new Error('build_complete event should be emitted');
    if (agent.status !== 'complete') throw new Error('Status should be complete');
    console.log('[TEST] Build execution: PASSED');

    // Test 3: Result structure
    console.log('\n[TEST] Test 3: Result structure...');
    const firstResult = build.results[0];
    if (!firstResult.subtaskId) throw new Error('Result should have subtaskId');
    if (firstResult.status !== 'success') throw new Error('Result status should be success');
    if (!firstResult.artifacts) throw new Error('Result should have artifacts');
    if (typeof firstResult.duration !== 'number') throw new Error('Result should have duration');
    if (!firstResult.message) throw new Error('Result should have message');
    console.log('[TEST] Result structure: PASSED');

    // Test 4: requestSurvey
    console.log('\n[TEST] Test 4: requestSurvey...');
    let surveyRequested = false;
    agent.on('survey_requested', (data) => {
      surveyRequested = true;
      if (!data.surveyId) throw new Error('Survey request should have surveyId');
      if (!data.questions) throw new Error('Survey request should have questions');
    });

    const surveyId = await agent.requestSurvey(['Question 1', 'Question 2']);
    if (!surveyId) throw new Error('requestSurvey should return surveyId');
    if (!surveyRequested) throw new Error('survey_requested event should be emitted');
    console.log('[TEST] requestSurvey: PASSED');

    // Test 5: requestRecording
    console.log('\n[TEST] Test 5: requestRecording...');
    let recordingRequested = false;
    agent.on('recording_requested', (data) => {
      recordingRequested = true;
      if (!data.recordingId) throw new Error('Recording request should have recordingId');
    });

    const recordingId = await agent.requestRecording({ fps: 30 });
    if (!recordingId) throw new Error('requestRecording should return recordingId');
    if (!recordingRequested) throw new Error('recording_requested event should be emitted');
    console.log('[TEST] requestRecording: PASSED');

    // Test 6: getStatus
    console.log('\n[TEST] Test 6: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Builder') throw new Error('Status should include name');
    if (status.status !== 'complete') throw new Error('Status should be complete');
    if (!status.currentBuild) throw new Error('Status should include currentBuild');
    if (status.currentBuild.buildId !== build.buildId) throw new Error('Status buildId mismatch');
    console.log('[TEST] getStatus: PASSED');

    // Test 7: Reset
    console.log('\n[TEST] Test 7: Reset...');
    agent.reset();
    if (agent.status !== 'idle') throw new Error('Status should be idle after reset');
    if (agent.currentBuild !== null) throw new Error('currentBuild should be null after reset');
    if (agent.surveyCallbacks.length !== 0) throw new Error('surveyCallbacks should be empty after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 8: Error handling
    console.log('\n[TEST] Test 8: Error handling...');
    let errorEmitted = false;
    agent.on('build_error', () => { errorEmitted = true; });

    // Force an error
    const originalExecute = agent._executeSubtask;
    agent._executeSubtask = async () => { throw new Error('Test error'); };

    try {
      await agent.build(mockPlan, {});
      throw new Error('Should have thrown error');
    } catch (err) {
      if (err.message !== 'Test error') throw err;
      if (!errorEmitted) throw new Error('build_error event should be emitted');
      if (agent.status !== 'error') throw new Error('Status should be error');
    }

    // Restore
    agent._executeSubtask = originalExecute;
    console.log('[TEST] Error handling: PASSED');

    console.log('\n[TEST] All 8 tests PASSED!');
    console.log('BuilderAgent test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
