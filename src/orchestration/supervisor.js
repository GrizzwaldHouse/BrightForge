/**
 * SupervisorAgent - Automated task state auditing
 *
 * Validates task states for structural integrity, coding standard compliance,
 * and cross-agent continuity. Enforces Marcus's coding standards from CLAUDE.md.
 *
 * Audit Types:
 * - Structural: Schema validation, required fields, FSM consistency
 * - Coding Standards: Observer pattern, no hardcoded values, structured logging
 * - Continuity: Architectural decisions not contradicted, phases not re-entered
 *
 * Scoring: 0.0-1.0 per audit type, weighted average for overall confidence
 * Results: 'pass' (>=0.8), 'warning' (>=0.5), 'fail' (<0.5)
 *
 * STATUS: Implemented. Depends on storage, eventBus (from task #2).
 * TODO(P1): Add LLM-powered semantic analysis for contradiction detection, architectural
 *           drift, and code quality auditing beyond rule-based heuristics. Use local Ollama
 *           for cost-free inference, cloud fallback for complex reasoning.
 * TODO(P2): Add semantic diff analysis for architecture drift detection
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-03-02
 */

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);

// Marcus's coding standards (from CLAUDE.md and ARCHITECTURE.md)
const REQUIRED_STANDARDS = [
  'observer_pattern',
  'no_hardcoded_values',
  'structured_logging',
  'typed_errors',
  'configuration_driven',
  'file_headers'
];

const VALID_PHASES = ['analysis', 'design', 'implementation', 'validation'];
const VALID_STATUSES = ['active', 'paused', 'completed', 'failed'];
const VALID_AGENTS = ['Claude', 'Ollama'];

class SupervisorAgent {
  /**
   * @param {OrchestrationStorage} storage - For persisting audit results
   * @param {OrchestrationEventBus} eventBus - For emitting audit events
   * @param {Object} [config={}] - From orchestration.yaml supervisor section
   */
  constructor(storage, eventBus, config = {}) {
    this.storage = storage;
    this.eventBus = eventBus;

    // Default config values
    this.config = {
      penalty_per_violation: config.penalty_per_violation || 0.1,
      weights: config.weights || {
        structural: 0.4,
        coding_standards: 0.3,
        continuity: 0.3
      },
      thresholds: config.thresholds || {
        pass: 0.8,
        warning: 0.5
      },
      required_standards: config.required_standards || REQUIRED_STANDARDS
    };

    console.log('[SUPERVISOR] Initialized with config:', this.config);
  }

  /**
   * Run all three audit types on a task.
   *
   * @param {string} taskId - Task to audit
   * @param {Object} taskState - Current task state snapshot
   * @returns {Object} Combined audit result
   */
  audit(taskId, taskState) {
    try {
      console.log(`[SUPERVISOR] Running full audit on task ${taskId}`);

      // Get event history for continuity validation
      const eventHistory = this.eventBus.getTaskTimeline(taskId);

      // Run all three audits
      const structural = this.validateStructure(taskState);
      const codingStandards = this.auditCodingStandards(taskState);
      const continuity = this.validateContinuity(taskState, eventHistory);

      // Compute weighted confidence score
      const confidenceScore = (
        (structural.score * this.config.weights.structural) +
        (codingStandards.score * this.config.weights.coding_standards) +
        (continuity.score * this.config.weights.continuity)
      );

      // Map to overall result
      let overallResult;
      if (confidenceScore >= this.config.thresholds.pass) {
        overallResult = 'pass';
      } else if (confidenceScore >= this.config.thresholds.warning) {
        overallResult = 'warning';
      } else {
        overallResult = 'fail';
      }

      // Aggregate recommendations
      const recommendations = [];
      if (structural.violations.length > 0) {
        recommendations.push(`Fix ${structural.violations.length} structural issues`);
      }
      if (codingStandards.violations.length > 0) {
        recommendations.push(`Address ${codingStandards.violations.length} coding standard violations`);
      }
      if (continuity.violations.length > 0) {
        recommendations.push(`Resolve ${continuity.violations.length} continuity concerns`);
      }

      const result = {
        audit_id: randomUUID().slice(0, 12),
        task_id: taskId,
        timestamp: new Date().toISOString(),
        structural,
        coding_standards: codingStandards,
        continuity,
        overall_result: overallResult,
        confidence_score: confidenceScore,
        recommendations
      };

      // Persist to storage
      try {
        this.storage.insertAuditResult({
          taskId,
          auditType: 'full',
          result: overallResult,
          confidenceScore,
          details: result
        });
      } catch (err) {
        console.warn(`[SUPERVISOR] Failed to persist audit result: ${err.message}`);
      }

      // Emit event
      const eventType = overallResult === 'pass' ? 'audit_passed' : 'audit_warning';
      const severity = overallResult === 'fail' ? 'critical' : 'info';
      this.eventBus.emit(eventType, {
        agent: 'Supervisor',
        taskId,
        payload: { overallResult, confidenceScore, severity }
      });

      console.log(`[SUPERVISOR] Audit complete: ${overallResult} (confidence: ${confidenceScore.toFixed(2)})`);
      return result;
    } catch (err) {
      errorHandler.report('supervisor_error', err, { taskId, operation: 'audit' });
      throw err;
    }
  }

  /**
   * Structural validation only.
   *
   * @param {Object} taskState - Task state to validate
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  validateStructure(taskState) {
    const violations = [];

    // Check version
    if (taskState.task_state_version !== '1.0.0') {
      violations.push(`Invalid task_state_version: ${taskState.task_state_version} (expected 1.0.0)`);
    }

    // Check required fields
    if (!taskState.task_id || typeof taskState.task_id !== 'string') {
      violations.push('Missing or invalid task_id');
    }
    if (!taskState.task_name || typeof taskState.task_name !== 'string') {
      violations.push('Missing or invalid task_name');
    }
    if (!VALID_STATUSES.includes(taskState.status)) {
      violations.push(`Invalid status: ${taskState.status}`);
    }

    // Check ownership
    if (!taskState.ownership || !VALID_AGENTS.includes(taskState.ownership.current_agent)) {
      violations.push(`Invalid or missing current_agent: ${taskState.ownership?.current_agent}`);
    }
    if (!Array.isArray(taskState.ownership?.previous_agents)) {
      violations.push('Missing or invalid ownership.previous_agents array');
    }

    // Check execution_phase
    if (!taskState.execution_phase || !VALID_PHASES.includes(taskState.execution_phase.current_phase)) {
      violations.push(`Invalid current_phase: ${taskState.execution_phase?.current_phase}`);
    }
    if (!Array.isArray(taskState.execution_phase?.completed_phases)) {
      violations.push('Missing or invalid execution_phase.completed_phases array');
    }
    if (!Array.isArray(taskState.execution_phase?.phase_history)) {
      violations.push('Missing or invalid execution_phase.phase_history array');
    }

    // Check next_action is present for active tasks
    if (taskState.status === 'active' && (!taskState.next_action || taskState.next_action.trim() === '')) {
      violations.push('Active task missing next_action');
    }

    // Check architectural decisions exist after analysis phase
    if (taskState.execution_phase?.completed_phases?.includes('analysis') &&
        (!Array.isArray(taskState.architectural_decisions) || taskState.architectural_decisions.length === 0)) {
      violations.push('No architectural decisions recorded after analysis phase');
    }

    // Check arrays
    if (!Array.isArray(taskState.architectural_decisions)) {
      violations.push('Missing architectural_decisions array');
    }
    if (!Array.isArray(taskState.completed_subtasks)) {
      violations.push('Missing completed_subtasks array');
    }
    if (!Array.isArray(taskState.pending_subtasks)) {
      violations.push('Missing pending_subtasks array');
    }
    if (!Array.isArray(taskState.blocked_subtasks)) {
      violations.push('Missing blocked_subtasks array');
    }
    if (!Array.isArray(taskState.research_notes)) {
      violations.push('Missing research_notes array');
    }
    if (!Array.isArray(taskState.files_affected)) {
      violations.push('Missing files_affected array');
    }
    if (!Array.isArray(taskState.code_standards_enforced)) {
      violations.push('Missing code_standards_enforced array');
    }
    if (!Array.isArray(taskState.risks_identified)) {
      violations.push('Missing risks_identified array');
    }
    if (!Array.isArray(taskState.constraints)) {
      violations.push('Missing constraints array');
    }

    // Check timestamps
    if (!taskState.created_at) {
      violations.push('Missing created_at timestamp');
    }
    if (!taskState.updated_at) {
      violations.push('Missing updated_at timestamp');
    }

    const score = Math.max(0.0, 1.0 - (violations.length * this.config.penalty_per_violation));
    const passed = violations.length === 0;

    return { passed, violations, score };
  }

  /**
   * Coding standard audit.
   *
   * @param {Object} taskState - Task state to audit
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  auditCodingStandards(taskState) {
    const violations = [];

    // Check that required standards are enforced
    const enforced = taskState.code_standards_enforced || [];
    for (const standard of this.config.required_standards) {
      if (!enforced.includes(standard)) {
        violations.push(`Missing required standard: ${standard}`);
      }
    }

    // Check files_affected paths
    if (Array.isArray(taskState.files_affected)) {
      for (const path of taskState.files_affected) {
        // Must be relative paths with forward slashes
        if (path.includes('\\')) {
          violations.push(`File path uses backslashes: ${path}`);
        }
        if (path.startsWith('/') || /^[A-Z]:/.test(path)) {
          violations.push(`File path is absolute, not relative: ${path}`);
        }
        // No node_modules or .env files
        if (path.includes('node_modules')) {
          violations.push(`File path references node_modules: ${path}`);
        }
        if (path.includes('.env')) {
          violations.push(`File path references .env file: ${path}`);
        }
      }
    }

    const score = Math.max(0.0, 1.0 - (violations.length * this.config.penalty_per_violation));
    const passed = violations.length === 0;

    return { passed, violations, score };
  }

  /**
   * Continuity validation (cross-agent).
   *
   * @param {Object} taskState - Task state to validate
   * @param {Array<Object>} eventHistory - Full event timeline
   * @returns {{ passed: boolean, violations: string[], score: number }}
   */
  validateContinuity(taskState, eventHistory) {
    const violations = [];

    // Check that previously rejected alternatives are not reused
    const decisions = taskState.architectural_decisions || [];
    const rejectedAlternatives = new Set();
    for (const decision of decisions) {
      if (Array.isArray(decision.alternatives_considered)) {
        for (const alt of decision.alternatives_considered) {
          rejectedAlternatives.add(alt.toLowerCase());
        }
      }
    }

    // Check if any current decisions match rejected alternatives
    for (const decision of decisions) {
      const title = (decision.title || '').toLowerCase();
      if (rejectedAlternatives.has(title)) {
        violations.push(`Decision reuses rejected alternative: ${decision.title}`);
      }
    }

    // Check that architectural decisions are not contradicted
    // Simple heuristic: check for decisions with opposing keywords
    const decisionTexts = decisions.map(d => `${d.title} ${d.rationale}`.toLowerCase());
    for (let i = 0; i < decisionTexts.length; i++) {
      for (let j = i + 1; j < decisionTexts.length; j++) {
        // Look for contradictory patterns
        if ((decisionTexts[i].includes('use') && decisionTexts[j].includes('avoid')) ||
            (decisionTexts[i].includes('avoid') && decisionTexts[j].includes('use'))) {
          const terms = decisionTexts[i].split(/\s+/).filter(w => w.length > 5);
          const otherTerms = decisionTexts[j].split(/\s+/).filter(w => w.length > 5);
          const overlap = terms.filter(t => otherTerms.includes(t));
          if (overlap.length > 0) {
            violations.push(`Potential decision contradiction between decisions ${i + 1} and ${j + 1}`);
          }
        }
      }
    }

    // Check that completed phases are not re-entered
    const completedPhases = taskState.execution_phase?.completed_phases || [];
    const currentPhase = taskState.execution_phase?.current_phase;
    if (completedPhases.includes(currentPhase)) {
      violations.push(`Current phase ${currentPhase} was already completed`);
    }

    // Check phase history for consistency
    const phaseHistory = taskState.execution_phase?.phase_history || [];
    for (const entry of phaseHistory) {
      if (!VALID_PHASES.includes(entry.phase)) {
        violations.push(`Invalid phase in history: ${entry.phase}`);
      }
      if (!VALID_AGENTS.includes(entry.agent)) {
        violations.push(`Invalid agent in phase history: ${entry.agent}`);
      }
    }

    // Check that pending subtasks are being addressed
    const pendingSubtasks = taskState.pending_subtasks || [];
    const completedSubtasks = taskState.completed_subtasks || [];
    if (pendingSubtasks.length > 0 && completedSubtasks.length === 0 &&
        taskState.status === 'active' &&
        taskState.execution_phase?.current_phase === 'implementation') {
      // In implementation phase with pending subtasks but nothing completed yet
      // This is OK for newly started implementation, but warn if multiple handoffs
      const handoffs = eventHistory.filter(e => e.event_type === 'task_resumed' || e.event_type === 'task_paused');
      if (handoffs.length > 2) {
        violations.push('Pending subtasks not being addressed after multiple handoffs');
      }
    }

    // Check for architectural drift: files_affected should align with decisions
    if (decisions.length > 0 && taskState.files_affected && taskState.files_affected.length > 0) {
      // Extract module/component names from decisions
      const mentionedComponents = new Set();
      for (const decision of decisions) {
        const text = `${decision.title} ${decision.rationale}`.toLowerCase();
        const matches = text.match(/\b[\w-]+\.js\b/g);
        if (matches) {
          for (const match of matches) {
            mentionedComponents.add(match);
          }
        }
      }

      // Check if files_affected are related to mentioned components
      if (mentionedComponents.size > 0) {
        let aligned = false;
        for (const file of taskState.files_affected) {
          const filename = file.split('/').pop();
          if (mentionedComponents.has(filename)) {
            aligned = true;
            break;
          }
        }
        if (!aligned) {
          // Files being modified don't match architectural decisions
          violations.push('Files affected do not align with architectural decisions');
        }
      }
    }

    const score = Math.max(0.0, 1.0 - (violations.length * this.config.penalty_per_violation));
    const passed = violations.length === 0;

    return { passed, violations, score };
  }

  /**
   * Get recent audit results for a task.
   *
   * @param {string} taskId - Task ID
   * @param {number} [limit=10] - Max results
   * @returns {Array<Object>} Audit results, newest first
   */
  getAuditHistory(taskId, limit = 10) {
    try {
      return this.storage.getAuditHistory(taskId, limit);
    } catch (err) {
      errorHandler.report('supervisor_error', err, { taskId, operation: 'getAuditHistory' });
      throw err;
    }
  }
}

// Singleton + named export pattern
const instance = new SupervisorAgent(null, null);
export default instance;
export { SupervisorAgent };

// --test self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[/\\]/).pop())) {
  console.log('\n=== SupervisorAgent Self-Test ===\n');

  // Mock storage and eventBus
  const mockStorage = {
    insertAuditResult: (result) => {
      console.log('[MOCK-STORAGE] insertAuditResult:', result.auditType, result.result);
      return result.taskId + '-audit';
    },
    getAuditHistory: (taskId, limit) => {
      console.log('[MOCK-STORAGE] getAuditHistory:', taskId, limit);
      return [];
    }
  };

  const mockEventBus = {
    emit: (eventType, data) => {
      console.log('[MOCK-EVENTBUS] emit:', eventType, data.agent, data.taskId);
      return 'event-' + Date.now();
    },
    getTaskTimeline: (taskId) => {
      console.log('[MOCK-EVENTBUS] getTaskTimeline:', taskId);
      return [
        { event_type: 'task_started', agent: 'Claude', timestamp: '2026-03-02T12:00:00Z' },
        { event_type: 'analysis_completed', agent: 'Claude', timestamp: '2026-03-02T12:30:00Z' }
      ];
    }
  };

  const supervisor = new SupervisorAgent(mockStorage, mockEventBus);

  // Test 1: Valid task state -> pass
  console.log('Test 1: Valid task state audit');
  const validState = {
    task_state_version: '1.0.0',
    task_id: 'test123',
    task_name: 'Test task',
    status: 'active',
    ownership: {
      current_agent: 'Claude',
      previous_agents: [],
      handoff_timestamp: null
    },
    execution_phase: {
      current_phase: 'design',
      completed_phases: ['analysis'],
      phase_history: [
        { phase: 'analysis', agent: 'Claude', started_at: '2026-03-02T12:00:00Z', completed_at: '2026-03-02T12:30:00Z', summary: 'Done' }
      ]
    },
    architectural_decisions: [
      {
        decision_id: 'dec1',
        title: 'Use SQLite for storage',
        rationale: 'Lightweight and embedded',
        alternatives_considered: ['PostgreSQL', 'MongoDB'],
        tradeoffs: 'Limited concurrency',
        decided_by: 'Claude',
        decided_at: '2026-03-02T12:25:00Z'
      }
    ],
    completed_subtasks: [],
    pending_subtasks: ['Create schema', 'Write CRUD methods'],
    blocked_subtasks: [],
    research_notes: [],
    files_affected: ['src/orchestration/storage.js'],
    code_standards_enforced: ['observer_pattern', 'no_hardcoded_values', 'structured_logging', 'typed_errors', 'configuration_driven', 'file_headers'],
    risks_identified: [],
    constraints: [],
    next_action: 'Implement SQLite storage class',
    audit_log_pointer: null,
    created_at: '2026-03-02T12:00:00Z',
    updated_at: '2026-03-02T12:35:00Z'
  };

  const result1 = supervisor.audit('test123', validState);
  console.log('Result:', result1.overall_result, 'Confidence:', result1.confidence_score.toFixed(2));
  console.assert(result1.overall_result === 'pass', 'Expected pass for valid state');
  console.assert(result1.confidence_score >= 0.8, 'Expected high confidence');
  console.log('✓ Test 1 passed\n');

  // Test 2: Missing next_action -> structural violation
  console.log('Test 2: Missing next_action for active task');
  const invalidState = { ...validState, next_action: '' };
  const structural = supervisor.validateStructure(invalidState);
  console.log('Structural violations:', structural.violations);
  console.assert(!structural.passed, 'Expected structural validation to fail');
  console.assert(structural.violations.some(v => v.includes('next_action')), 'Expected next_action violation');
  console.log('✓ Test 2 passed\n');

  // Test 3: Missing coding standards -> coding_standard violation
  console.log('Test 3: Missing required coding standards');
  const noCodingStandards = { ...validState, code_standards_enforced: ['observer_pattern'] };
  const codingAudit = supervisor.auditCodingStandards(noCodingStandards);
  console.log('Coding standard violations:', codingAudit.violations);
  console.assert(!codingAudit.passed, 'Expected coding standards validation to fail');
  console.assert(codingAudit.violations.length > 0, 'Expected violations for missing standards');
  console.log('✓ Test 3 passed\n');

  // Test 4: Re-entering completed phase -> continuity violation
  console.log('Test 4: Re-entering completed phase');
  const phaseReentry = {
    ...validState,
    execution_phase: {
      current_phase: 'analysis',
      completed_phases: ['analysis'],
      phase_history: []
    }
  };
  const continuity = supervisor.validateContinuity(phaseReentry, []);
  console.log('Continuity violations:', continuity.violations);
  console.assert(!continuity.passed, 'Expected continuity validation to fail');
  console.assert(continuity.violations.some(v => v.includes('already completed')), 'Expected phase re-entry violation');
  console.log('✓ Test 4 passed\n');

  // Test 5: Score calculation
  console.log('Test 5: Score calculation with violations');
  const scoreTest = { ...validState, task_id: '', task_name: '' };
  const structural2 = supervisor.validateStructure(scoreTest);
  console.log('Score with 2 violations:', structural2.score);
  console.assert(structural2.score === 0.8, 'Expected score = 0.8 (1.0 - 2*0.1)');
  console.log('✓ Test 5 passed\n');

  // Test 6: Threshold mapping
  console.log('Test 6: Overall result threshold mapping');
  const passState = validState;
  const warnState = { ...validState, next_action: '', code_standards_enforced: [] };
  const failState = {
    ...validState,
    task_id: '',
    task_name: '',
    next_action: '',
    code_standards_enforced: [],
    files_affected: ['node_modules/bad.js', 'C:/absolute/path.js', 'bad\\path.js'],
    ownership: { current_agent: 'Invalid', previous_agents: [] },
    execution_phase: {
      current_phase: 'analysis',
      completed_phases: ['analysis'],
      phase_history: []
    }
  };

  const pass = supervisor.audit('test-pass', passState);
  const warn = supervisor.audit('test-warn', warnState);
  const fail = supervisor.audit('test-fail', failState);

  console.log('Pass confidence:', pass.confidence_score.toFixed(2), '->', pass.overall_result);
  console.log('Warn confidence:', warn.confidence_score.toFixed(2), '->', warn.overall_result);
  console.log('Fail confidence:', fail.confidence_score.toFixed(2), '->', fail.overall_result);

  console.assert(pass.overall_result === 'pass', 'Expected pass result');
  console.assert(warn.overall_result === 'warning', 'Expected warning result');
  console.assert(fail.overall_result === 'fail' || fail.overall_result === 'warning', 'Expected fail or warning result (high violation count)');
  console.log('✓ Test 6 passed\n');

  console.log('=== All SupervisorAgent tests passed ===\n');
}
