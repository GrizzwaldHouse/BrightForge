/**
 * HandoffProtocol - Agent handoff orchestration
 *
 * Manages deterministic task handoff between Claude and Ollama with:
 * - Pre-handoff supervisor audits
 * - State serialization and validation
 * - Ownership transfer tracking
 * - Handoff event timeline
 *
 * Pause Flow: snapshot -> audit -> transition to paused -> emit event
 * Resume Flow: load state -> validate schema -> transition to active -> emit event
 *
 * STATUS: Implemented. Depends on taskState, supervisor, eventBus (from task #2, #3).
 * TODO(P1): Add handoff queue for multiple pending handoffs
 * TODO(P2): Add handoff cancellation (abort in-progress handoff)
 * TODO(P2): Add handoff metrics (time between pause/resume, success rate)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-03-02
 */

import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);

/**
 * Custom error class for handoff-specific failures.
 */
class HandoffError extends Error {
  /**
   * @param {string} message - Error message
   * @param {string} taskId - Task ID
   * @param {string} code - Error code
   * @param {Object} [details={}] - Additional details
   */
  constructor(message, taskId, code, details = {}) {
    super(message);
    this.name = 'HandoffError';
    this.taskId = taskId;
    this.code = code;
    this.details = details;
  }
}

class HandoffProtocol {
  /**
   * @param {TaskState} taskState - Task state manager
   * @param {SupervisorAgent} supervisor - For pre-handoff audits
   * @param {OrchestrationEventBus} eventBus - For handoff events
   * @param {Object} [config={}] - From orchestration.yaml handoff section
   */
  constructor(taskState, supervisor, eventBus, config = {}) {
    this.taskState = taskState;
    this.supervisor = supervisor;
    this.eventBus = eventBus;

    // Default config
    this.config = {
      require_audit: config.require_audit !== false,
      min_confidence: config.min_confidence || 0.5,
      max_handoffs_per_task: config.max_handoffs_per_task || 10
    };

    console.log('[HANDOFF] Initialized with config:', this.config);
  }

  /**
   * Pause a task for handoff to another agent.
   *
   * @param {string} taskId - Task to pause
   * @param {string} currentAgent - Agent initiating the pause
   * @param {string} [reason=''] - Why the handoff is happening
   * @returns {Object} Handoff package
   * @throws {HandoffError} If audit fails and require_audit is true
   */
  pause(taskId, currentAgent, reason = '') {
    try {
      console.log(`[HANDOFF] Pausing task ${taskId} (agent: ${currentAgent}, reason: ${reason})`);

      // 1. Take snapshot of current state
      const snapshot = this.taskState.snapshot(taskId);
      if (!snapshot) {
        throw new HandoffError(
          `Task not found: ${taskId}`,
          taskId,
          'TASK_NOT_FOUND',
          { agent: currentAgent }
        );
      }

      // Verify the task is in a valid state to pause
      if (snapshot.status !== 'active') {
        throw new HandoffError(
          `Task ${taskId} is not active (status: ${snapshot.status})`,
          taskId,
          'INVALID_STATUS',
          { currentStatus: snapshot.status }
        );
      }

      // 2. Run pre-handoff supervisor audit
      let auditResult = null;
      if (this.config.require_audit) {
        auditResult = this.supervisor.audit(taskId, snapshot);

        // Check if audit passes minimum confidence
        if (auditResult.confidence_score < this.config.min_confidence) {
          throw new HandoffError(
            `Audit failed: confidence ${auditResult.confidence_score.toFixed(2)} below minimum ${this.config.min_confidence}`,
            taskId,
            'AUDIT_FAILED',
            { auditResult, snapshot }
          );
        }

        console.log(`[HANDOFF] Pre-handoff audit: ${auditResult.overall_result} (${auditResult.confidence_score.toFixed(2)})`);
      } else {
        console.log('[HANDOFF] Audit disabled, skipping');
      }

      // 3. Check handoff count limit
      const handoffHistory = this.getHistory(taskId);
      if (handoffHistory.length >= this.config.max_handoffs_per_task) {
        throw new HandoffError(
          `Task ${taskId} has reached max handoffs limit (${this.config.max_handoffs_per_task})`,
          taskId,
          'MAX_HANDOFFS_EXCEEDED',
          { handoffCount: handoffHistory.length }
        );
      }

      // 4. Transition to paused state
      const pausedAt = new Date().toISOString();
      this.taskState.transition(taskId, 'paused', currentAgent, {
        reason,
        paused_at: pausedAt
      });

      // 5. Emit handoff event
      this.eventBus.emit('task_paused', {
        agent: currentAgent,
        taskId,
        payload: {
          reason,
          paused_at: pausedAt,
          next_action: snapshot.next_action,
          audit_passed: auditResult ? auditResult.overall_result === 'pass' : null
        }
      });

      // 6. Build handoff package
      const handoffPackage = {
        task_id: taskId,
        snapshot,
        audit_result: auditResult,
        paused_at: pausedAt,
        paused_by: currentAgent,
        reason,
        next_action: snapshot.next_action
      };

      console.log(`[HANDOFF] Task ${taskId} paused successfully`);
      return handoffPackage;
    } catch (err) {
      if (err instanceof HandoffError) {
        errorHandler.report('handoff_error', err, {
          taskId,
          agent: currentAgent,
          code: err.code,
          operation: 'pause'
        });
        throw err;
      } else {
        errorHandler.report('handoff_error', err, { taskId, agent: currentAgent, operation: 'pause' });
        throw new HandoffError(
          `Failed to pause task: ${err.message}`,
          taskId,
          'PAUSE_FAILED',
          { originalError: err.message }
        );
      }
    }
  }

  /**
   * Resume a paused task with a new agent.
   *
   * @param {string} taskId - Task to resume
   * @param {string} newAgent - Agent taking over
   * @returns {Object} Resume package
   * @throws {HandoffError} If task is not paused or schema validation fails
   */
  resume(taskId, newAgent) {
    try {
      console.log(`[HANDOFF] Resuming task ${taskId} (new agent: ${newAgent})`);

      // 1. Load task state from storage
      const state = this.taskState.load(taskId);
      if (!state) {
        throw new HandoffError(
          `Task not found: ${taskId}`,
          taskId,
          'TASK_NOT_FOUND',
          { agent: newAgent }
        );
      }

      // 2. Verify task is paused
      if (state.status !== 'paused') {
        throw new HandoffError(
          `Task ${taskId} is not paused (status: ${state.status})`,
          taskId,
          'NOT_PAUSED',
          { currentStatus: state.status }
        );
      }

      // 3. Validate schema integrity
      const validation = this.taskState.validate(state);
      if (!validation.valid) {
        throw new HandoffError(
          `Schema validation failed: ${validation.errors.join(', ')}`,
          taskId,
          'SCHEMA_INVALID',
          { errors: validation.errors }
        );
      }

      // 4. Record previous agent
      const previousAgent = state.ownership.current_agent;
      console.log(`[HANDOFF] Transferring ownership: ${previousAgent} -> ${newAgent}`);

      // 5. Transition to active state with new ownership (single DB write)
      const resumedAt = new Date().toISOString();
      const updatedState = this.taskState.transition(taskId, 'active', newAgent, {
        resumed_at: resumedAt,
        previous_agent: previousAgent,
        ownership: {
          current_agent: newAgent,
          previous_agents: [...state.ownership.previous_agents, previousAgent],
          handoff_timestamp: resumedAt
        }
      });

      // 6. Emit resume event
      this.eventBus.emit('task_resumed', {
        agent: newAgent,
        taskId,
        payload: {
          resumed_at: resumedAt,
          previous_agent: previousAgent,
          next_action: updatedState.next_action
        }
      });

      // 7. Build resume package
      const resumePackage = {
        task_id: taskId,
        state: updatedState,
        previous_agent: previousAgent,
        resumed_at: resumedAt,
        resumed_by: newAgent,
        next_action: updatedState.next_action,
        pending_subtasks: updatedState.pending_subtasks,
        architectural_decisions: updatedState.architectural_decisions
      };

      console.log(`[HANDOFF] Task ${taskId} resumed successfully by ${newAgent}`);
      return resumePackage;
    } catch (err) {
      if (err instanceof HandoffError) {
        errorHandler.report('handoff_error', err, {
          taskId,
          agent: newAgent,
          code: err.code,
          operation: 'resume'
        });
        throw err;
      } else {
        errorHandler.report('handoff_error', err, { taskId, agent: newAgent, operation: 'resume' });
        throw new HandoffError(
          `Failed to resume task: ${err.message}`,
          taskId,
          'RESUME_FAILED',
          { originalError: err.message }
        );
      }
    }
  }

  /**
   * Get handoff history for a task (all pause/resume events).
   *
   * @param {string} taskId - Task ID
   * @returns {Array<Object>} Handoff events, chronologically ordered
   */
  getHistory(taskId) {
    try {
      const timeline = this.eventBus.getTaskTimeline(taskId);
      const handoffEvents = timeline.filter(event =>
        event.event_type === 'task_paused' || event.event_type === 'task_resumed'
      );
      return handoffEvents;
    } catch (err) {
      console.warn(`[HANDOFF] Failed to get history for ${taskId}: ${err.message}`);
      return [];
    }
  }

  /**
   * Check if a task is eligible for handoff.
   *
   * @param {string} taskId - Task ID
   * @returns {{ eligible: boolean, reason: string }}
   */
  canHandoff(taskId) {
    try {
      const state = this.taskState.load(taskId);
      if (!state) {
        return { eligible: false, reason: 'Task not found' };
      }

      if (state.status === 'completed' || state.status === 'failed') {
        return { eligible: false, reason: `Task is ${state.status}` };
      }

      const handoffHistory = this.getHistory(taskId);
      if (handoffHistory.length >= this.config.max_handoffs_per_task) {
        return { eligible: false, reason: `Max handoffs limit (${this.config.max_handoffs_per_task}) reached` };
      }

      return { eligible: true, reason: 'Task is eligible for handoff' };
    } catch (err) {
      return { eligible: false, reason: `Error checking eligibility: ${err.message}` };
    }
  }
}

// Singleton + named export pattern
const instance = new HandoffProtocol(null, null, null);
export default instance;
export { HandoffProtocol, HandoffError };

// --test self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[/\\]/).pop())) {
  console.log('\n=== HandoffProtocol Self-Test ===\n');

  // Mock dependencies
  let mockTaskState = {
    tasks: new Map(),
    snapshot: function(taskId) {
      const task = this.tasks.get(taskId);
      return task ? JSON.parse(JSON.stringify(task)) : null;
    },
    load: function(taskId) {
      return this.tasks.get(taskId) || null;
    },
    transition: function(taskId, newStatus, agent, metadata) {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error('Task not found');
      task.status = newStatus;
      task.ownership.current_agent = agent;
      if (metadata && metadata.ownership) {
        task.ownership = metadata.ownership;
      }
      return task;
    },
    validate: function(state) {
      if (!state.task_id || !state.status) {
        return { valid: false, errors: ['Missing required fields'] };
      }
      return { valid: true, errors: [] };
    }
  };

  const mockSupervisor = {
    audit: (_taskId, _state) => {
      console.log('[MOCK-SUPERVISOR] Running audit');
      return {
        overall_result: 'pass',
        confidence_score: 0.85,
        structural: { passed: true, violations: [], score: 1.0 },
        coding_standards: { passed: true, violations: [], score: 1.0 },
        continuity: { passed: true, violations: [], score: 1.0 }
      };
    }
  };

  const mockEventBus = {
    events: [],
    emit: function(eventType, data) {
      console.log('[MOCK-EVENTBUS] emit:', eventType, data.agent, data.taskId);
      this.events.push({ event_type: eventType, ...data });
      return 'event-' + Date.now();
    },
    getTaskTimeline: function(taskId) {
      return this.events.filter(e => e.taskId === taskId);
    }
  };

  const handoff = new HandoffProtocol(mockTaskState, mockSupervisor, mockEventBus);

  // Create test task
  const testTask = {
    task_id: 'handoff-test',
    task_name: 'Test Handoff',
    status: 'active',
    ownership: {
      current_agent: 'Claude',
      previous_agents: [],
      handoff_timestamp: null
    },
    next_action: 'Continue implementation',
    pending_subtasks: ['Task 1', 'Task 2'],
    architectural_decisions: []
  };
  mockTaskState.tasks.set('handoff-test', testTask);

  // Test 1: Successful pause
  console.log('Test 1: Pause active task');
  const pauseResult = handoff.pause('handoff-test', 'Claude', 'Switching to local model');
  console.log('Pause result:', pauseResult.paused_by, pauseResult.paused_at);
  console.assert(pauseResult.task_id === 'handoff-test', 'Expected correct task ID');
  console.assert(pauseResult.paused_by === 'Claude', 'Expected paused by Claude');
  console.assert(pauseResult.audit_result.overall_result === 'pass', 'Expected audit to pass');
  const task1 = mockTaskState.tasks.get('handoff-test');
  console.assert(task1.status === 'paused', 'Expected task to be paused');
  console.log('✓ Test 1 passed\n');

  // Test 2: Successful resume
  console.log('Test 2: Resume paused task');
  const resumeResult = handoff.resume('handoff-test', 'Ollama');
  console.log('Resume result:', resumeResult.resumed_by, resumeResult.previous_agent);
  console.assert(resumeResult.task_id === 'handoff-test', 'Expected correct task ID');
  console.assert(resumeResult.resumed_by === 'Ollama', 'Expected resumed by Ollama');
  console.assert(resumeResult.previous_agent === 'Claude', 'Expected previous agent Claude');
  const task2 = mockTaskState.tasks.get('handoff-test');
  console.assert(task2.status === 'active', 'Expected task to be active');
  console.assert(task2.ownership.current_agent === 'Ollama', 'Expected current agent Ollama');
  console.assert(task2.ownership.previous_agents.includes('Claude'), 'Expected Claude in previous agents');
  console.log('✓ Test 2 passed\n');

  // Test 3: Pause completed task -> error
  console.log('Test 3: Pause completed task (should fail)');
  const completedTask = { ...testTask, task_id: 'completed-test', status: 'completed' };
  mockTaskState.tasks.set('completed-test', completedTask);
  try {
    handoff.pause('completed-test', 'Claude', 'Test');
    console.assert(false, 'Should have thrown error');
  } catch (err) {
    console.log('Expected error:', err.message);
    console.assert(err instanceof HandoffError, 'Expected HandoffError');
    console.assert(err.code === 'INVALID_STATUS', 'Expected INVALID_STATUS code');
  }
  console.log('✓ Test 3 passed\n');

  // Test 4: Resume non-paused task -> error
  console.log('Test 4: Resume active task (should fail)');
  const activeTask = { ...testTask, task_id: 'active-test', status: 'active' };
  mockTaskState.tasks.set('active-test', activeTask);
  try {
    handoff.resume('active-test', 'Ollama');
    console.assert(false, 'Should have thrown error');
  } catch (err) {
    console.log('Expected error:', err.message);
    console.assert(err instanceof HandoffError, 'Expected HandoffError');
    console.assert(err.code === 'NOT_PAUSED', 'Expected NOT_PAUSED code');
  }
  console.log('✓ Test 4 passed\n');

  // Test 5: Audit failure blocks handoff (if require_audit=true)
  console.log('Test 5: Pause with failing audit');
  const badSupervisor = {
    audit: () => ({
      overall_result: 'fail',
      confidence_score: 0.3,
      structural: { passed: false, violations: ['Error'], score: 0.3 }
    })
  };
  const strictHandoff = new HandoffProtocol(mockTaskState, badSupervisor, mockEventBus, { require_audit: true, min_confidence: 0.5 });
  const failTask = { ...testTask, task_id: 'fail-test', status: 'active' };
  mockTaskState.tasks.set('fail-test', failTask);
  try {
    strictHandoff.pause('fail-test', 'Claude', 'Test');
    console.assert(false, 'Should have thrown error');
  } catch (err) {
    console.log('Expected error:', err.message);
    console.assert(err instanceof HandoffError, 'Expected HandoffError');
    console.assert(err.code === 'AUDIT_FAILED', 'Expected AUDIT_FAILED code');
  }
  console.log('✓ Test 5 passed\n');

  // Test 6: Full round-trip (create -> pause -> resume)
  console.log('Test 6: Full handoff round-trip');
  const roundTripTask = {
    task_id: 'roundtrip',
    task_name: 'Round Trip Test',
    status: 'active',
    ownership: { current_agent: 'Claude', previous_agents: [], handoff_timestamp: null },
    next_action: 'Continue work',
    pending_subtasks: [],
    architectural_decisions: []
  };
  mockTaskState.tasks.set('roundtrip', roundTripTask);

  const pause6 = handoff.pause('roundtrip', 'Claude', 'Test handoff');
  console.log('Paused:', pause6.paused_by);
  const resume6 = handoff.resume('roundtrip', 'Ollama');
  console.log('Resumed:', resume6.resumed_by);
  const final = mockTaskState.tasks.get('roundtrip');
  console.assert(final.status === 'active', 'Expected active status after resume');
  console.assert(final.ownership.current_agent === 'Ollama', 'Expected Ollama as current agent');
  console.assert(final.ownership.previous_agents.includes('Claude'), 'Expected Claude in history');
  console.log('✓ Test 6 passed\n');

  // Test 7: Handoff history
  console.log('Test 7: Get handoff history');
  const history = handoff.getHistory('roundtrip');
  console.log('History events:', history.length);
  console.assert(history.length >= 2, 'Expected at least 2 events (pause + resume)');
  console.assert(history.some(e => e.event_type === 'task_paused'), 'Expected task_paused event');
  console.assert(history.some(e => e.event_type === 'task_resumed'), 'Expected task_resumed event');
  console.log('✓ Test 7 passed\n');

  // Test 8: canHandoff eligibility check
  console.log('Test 8: Check handoff eligibility');
  const eligible1 = handoff.canHandoff('roundtrip');
  console.log('Eligible:', eligible1.eligible, '-', eligible1.reason);
  console.assert(eligible1.eligible === true, 'Active task should be eligible');

  const eligible2 = handoff.canHandoff('completed-test');
  console.log('Completed task eligible:', eligible2.eligible, '-', eligible2.reason);
  console.assert(eligible2.eligible === false, 'Completed task should not be eligible');

  const eligible3 = handoff.canHandoff('nonexistent');
  console.log('Nonexistent task eligible:', eligible3.eligible, '-', eligible3.reason);
  console.assert(eligible3.eligible === false, 'Nonexistent task should not be eligible');
  console.log('✓ Test 8 passed\n');

  console.log('=== All HandoffProtocol tests passed ===\n');
}
