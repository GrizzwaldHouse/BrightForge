/**
 * PlannerAgent - Task decomposition and execution planning
 *
 * Analyzes task prompts, breaks them into ordered subtasks with
 * dependencies, and produces structured execution plans for the
 * Builder agent pipeline.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

class PlannerAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Planner';
    this.type = 'pipeline';
    this.status = 'idle'; // idle | planning | complete | error
    this.currentPlan = null;
  }

  /**
   * Decompose a task into subtasks with dependencies.
   * @param {string} prompt - User task description
   * @param {Object} context - { files, projectRoot }
   * @returns {{ planId, subtasks: [{ id, title, description, dependencies, agent, phase }], summary }}
   */
  async plan(prompt, context = {}) {
    this.status = 'planning';
    const planId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('agent_action', { agent: this.name, action: 'plan' });

    try {
      console.log(`[PLANNER] Decomposing task: ${prompt.substring(0, 80)}...`);
      this.emit('plan_start', { planId, prompt });

      // Heuristic-based task decomposition
      const subtasks = this._decompose(prompt, context);

      const plan = {
        planId,
        prompt,
        subtasks,
        summary: `Decomposed into ${subtasks.length} subtasks`,
        createdAt: new Date().toISOString()
      };

      this.currentPlan = plan;
      this.status = 'complete';

      endTimer({ planId, subtaskCount: subtasks.length, status: 'success' });

      this.emit('plan_complete', plan);
      console.log(`[PLANNER] Plan ${planId} created with ${subtasks.length} subtasks`);

      return plan;
    } catch (err) {
      this.status = 'error';
      endTimer({ planId, status: 'failed', error: err.message });
      errorHandler.report('agent_error', err, { agent: this.name, planId, prompt });
      this.emit('plan_error', { planId, error: err.message });
      throw err;
    }
  }

  _decompose(prompt, context) {
    // Heuristic decomposition based on keywords
    const subtasks = [];
    const lower = prompt.toLowerCase();
    let order = 0;

    // Analysis phase
    subtasks.push({
      id: randomUUID().slice(0, 8),
      order: order++,
      title: 'Analyze requirements',
      description: `Analyze task: ${prompt.substring(0, 100)}`,
      dependencies: [],
      agent: 'Planner',
      phase: 'analysis',
      status: 'pending'
    });

    // Design phase if complex
    const isComplex = lower.includes('refactor') || lower.includes('architecture') ||
      lower.includes('system') || lower.includes('pipeline') ||
      (context.files && context.files.length > 5);

    if (isComplex) {
      subtasks.push({
        id: randomUUID().slice(0, 8),
        order: order++,
        title: 'Design architecture',
        description: 'Design approach and component structure',
        dependencies: [subtasks[0].id],
        agent: 'Planner',
        phase: 'design',
        status: 'pending'
      });
    }

    // Implementation phase
    subtasks.push({
      id: randomUUID().slice(0, 8),
      order: order++,
      title: 'Implement changes',
      description: 'Execute code changes based on plan',
      dependencies: [subtasks[subtasks.length - 1].id],
      agent: 'Builder',
      phase: 'implementation',
      status: 'pending'
    });

    // Test phase
    const implId = subtasks[subtasks.length - 1].id;
    subtasks.push({
      id: randomUUID().slice(0, 8),
      order: order++,
      title: 'Run tests',
      description: 'Execute unit and lint tests',
      dependencies: [implId],
      agent: 'Tester',
      phase: 'validation',
      status: 'pending'
    });

    // Review phase
    const testId = subtasks[subtasks.length - 1].id;
    subtasks.push({
      id: randomUUID().slice(0, 8),
      order: order++,
      title: 'Code review',
      description: 'Review changes and audit quality',
      dependencies: [testId],
      agent: 'Reviewer',
      phase: 'validation',
      status: 'pending'
    });

    return subtasks;
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      currentPlan: this.currentPlan ? {
        planId: this.currentPlan.planId,
        subtaskCount: this.currentPlan.subtasks.length,
        createdAt: this.currentPlan.createdAt
      } : null
    };
  }

  reset() {
    this.status = 'idle';
    this.currentPlan = null;
    console.log('[PLANNER] Reset to idle state');
  }
}

const plannerAgent = new PlannerAgent();
export default plannerAgent;
export { PlannerAgent };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing PlannerAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new PlannerAgent();
    if (agent.name !== 'Planner') throw new Error('Name should be Planner');
    if (agent.status !== 'idle') throw new Error('Initial status should be idle');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Plan generation
    console.log('\n[TEST] Test 2: Plan generation...');
    let planStartEmitted = false;
    let planCompleteEmitted = false;

    agent.on('plan_start', () => { planStartEmitted = true; });
    agent.on('plan_complete', () => { planCompleteEmitted = true; });

    const plan = await agent.plan('create a new API endpoint', { files: [], projectRoot: './test' });

    if (!plan.planId) throw new Error('Plan should have planId');
    if (!plan.subtasks || plan.subtasks.length === 0) throw new Error('Plan should have subtasks');
    if (plan.subtasks.length !== 4) throw new Error(`Expected 4 subtasks for simple task, got ${plan.subtasks.length}`);
    if (!planStartEmitted) throw new Error('plan_start event should be emitted');
    if (!planCompleteEmitted) throw new Error('plan_complete event should be emitted');
    if (agent.status !== 'complete') throw new Error('Status should be complete');
    console.log('[TEST] Plan generation: PASSED');

    // Test 3: Complex task decomposition
    console.log('\n[TEST] Test 3: Complex task decomposition...');
    const complexPlan = await agent.plan('refactor the architecture', { files: new Array(10), projectRoot: './test' });

    if (complexPlan.subtasks.length !== 5) throw new Error(`Expected 5 subtasks for complex task, got ${complexPlan.subtasks.length}`);

    // Verify design phase is included
    const hasDesignPhase = complexPlan.subtasks.some(t => t.phase === 'design');
    if (!hasDesignPhase) throw new Error('Complex task should include design phase');
    console.log('[TEST] Complex task decomposition: PASSED');

    // Test 4: Subtask structure
    console.log('\n[TEST] Test 4: Subtask structure...');
    const firstTask = plan.subtasks[0];
    if (!firstTask.id) throw new Error('Subtask should have id');
    if (typeof firstTask.order !== 'number') throw new Error('Subtask should have order');
    if (!firstTask.title) throw new Error('Subtask should have title');
    if (!firstTask.description) throw new Error('Subtask should have description');
    if (!Array.isArray(firstTask.dependencies)) throw new Error('Subtask should have dependencies array');
    if (!firstTask.agent) throw new Error('Subtask should have agent');
    if (!firstTask.phase) throw new Error('Subtask should have phase');
    if (!firstTask.status) throw new Error('Subtask should have status');
    console.log('[TEST] Subtask structure: PASSED');

    // Test 5: getStatus
    console.log('\n[TEST] Test 5: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Planner') throw new Error('Status should include name');
    if (status.status !== 'complete') throw new Error('Status should be complete');
    if (!status.currentPlan) throw new Error('Status should include currentPlan');
    if (status.currentPlan.planId !== complexPlan.planId) throw new Error('Status planId mismatch');
    console.log('[TEST] getStatus: PASSED');

    // Test 6: Reset
    console.log('\n[TEST] Test 6: Reset...');
    agent.reset();
    if (agent.status !== 'idle') throw new Error('Status should be idle after reset');
    if (agent.currentPlan !== null) throw new Error('currentPlan should be null after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 7: Error handling
    console.log('\n[TEST] Test 7: Error handling...');
    let errorEmitted = false;
    agent.on('plan_error', () => { errorEmitted = true; });

    // Force an error by breaking _decompose
    const originalDecompose = agent._decompose;
    agent._decompose = () => { throw new Error('Test error'); };

    try {
      await agent.plan('error test', {});
      throw new Error('Should have thrown error');
    } catch (err) {
      if (err.message !== 'Test error') throw err;
      if (!errorEmitted) throw new Error('plan_error event should be emitted');
      if (agent.status !== 'error') throw new Error('Status should be error');
    }

    // Restore
    agent._decompose = originalDecompose;
    console.log('[TEST] Error handling: PASSED');

    console.log('\n[TEST] All 7 tests PASSED!');
    console.log('PlannerAgent test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
