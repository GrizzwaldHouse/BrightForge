/**
 * Self-Healing Orchestrator (Phase 16)
 *
 * Wraps any async operation with:
 *   1. pre_execution_guard — validates preconditions before start
 *   2. execution_wrapper   — injects correlationId, emits lifecycle events
 *   3. failure_classifier  — typed failure on every error
 *   4. healing_engine      — applies config-driven healing rules
 *   5. retry_orchestrator  — bounded retries with exponential backoff
 *   6. observability       — all actions logged with correlationId to failures.json
 *
 * Every execution returns a HealingResult with full timeline.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { randomUUID } from 'crypto';
import { readFileSync, existsSync, mkdirSync, appendFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import failureClassifier from './failure-classifier.js';
import telemetryBus from './telemetry-bus.js';
import errorHandler from './error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load healing rules from config (no hardcoded values in code)
const CONFIG_PATH = join(__dirname, '../../config/healing-rules.json');
const healingRules = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
const RULES = healingRules.rules;
const GLOBAL = healingRules.global;

// Ensure logs directory exists
const LOG_DIR = join(__dirname, '../../logs');
const FAILURE_LOG = join(LOG_DIR, 'failures.json');
if (!existsSync(LOG_DIR)) {
  mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Append a failure record to the persistent failure log (newline-delimited JSON).
 */
function logFailure(record) {
  try {
    appendFileSync(FAILURE_LOG, JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    console.error('[HEALING] Failed to write failure log:', err.message);
  }
}

/**
 * Sleep for `ms` milliseconds.
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Compute retry delay with exponential backoff and cap.
 */
function computeDelay(rule, attempt) {
  const base = rule.retryDelayMs || 1000;
  const multiplier = rule.backoffMultiplier || 2.0;
  const max = rule.maxDelayMs || 30000;
  return Math.min(base * Math.pow(multiplier, attempt - 1), max);
}

class SelfHealingOrchestrator {
  /**
   * Execute an operation with full self-healing wrapping.
   *
   * @param {Object} opts
   * @param {string} opts.name - Human-readable operation name (for logging)
   * @param {Function} opts.operation - Async function to execute: async (correlationId) => result
   * @param {Object} [opts.guards] - Precondition checks (name → async () => boolean)
   * @param {string} [opts.correlationId] - Existing correlation ID (generated if omitted)
   * @param {Object} [opts.context] - Additional context for telemetry
   * @returns {Promise<HealingResult>}
   */
  async execute({ name, operation, guards = {}, correlationId, context = {} }) {
    const id = correlationId || randomUUID();
    const timeline = [];
    const startedAt = new Date().toISOString();

    const record = (event, detail = {}) => {
      const entry = { event, correlationId: id, timestamp: new Date().toISOString(), ...detail };
      timeline.push(entry);
      telemetryBus.emit('healing_event', entry);
      console.log(`[HEALING] [${id.slice(0, 8)}] ${event}`, detail.reason || detail.action || '');
    };

    record('execution_started', { name, context });

    // 1. Pre-execution guard
    for (const [guardName, check] of Object.entries(guards)) {
      try {
        const ok = await check();
        if (!ok) {
          const failure = failureClassifier.classifyError(
            new Error(`Precondition failed: ${guardName}`),
            { correlationId: id }
          );
          record('guard_failed', { guardName, ...failure });
          logFailure({ name, ...failure, timeline });

          return {
            success: false,
            correlationId: id,
            name,
            failure,
            timeline,
            startedAt,
            completedAt: new Date().toISOString(),
            attempts: 0
          };
        }
        record('guard_passed', { guardName });
      } catch (err) {
        const failure = failureClassifier.classifyError(err, { correlationId: id });
        record('guard_error', { guardName, ...failure });
        logFailure({ name, ...failure, timeline });

        return {
          success: false,
          correlationId: id,
          name,
          failure,
          timeline,
          startedAt,
          completedAt: new Date().toISOString(),
          attempts: 0
        };
      }
    }

    // 2. Execute with retry orchestration
    let attempt = 0;
    let lastFailure = null;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      attempt++;
      record('attempt_started', { attempt });

      try {
        const endTimer = telemetryBus.startTimer('healing_exec', { name, attempt });
        const result = await operation(id);
        endTimer({ success: true, attempt });

        record('attempt_succeeded', { attempt });

        return {
          success: true,
          correlationId: id,
          name,
          result,
          failure: null,
          timeline,
          startedAt,
          completedAt: new Date().toISOString(),
          attempts: attempt
        };

      } catch (err) {
        const failure = failureClassifier.classifyError(err, { correlationId: id });
        lastFailure = failure;

        record('attempt_failed', {
          attempt,
          category: failure.category,
          reason: failure.reason,
          action: failure.action
        });

        // 3. Apply healing strategy
        const rule = RULES[failure.category] || RULES.unknown;
        const healed = await this._applyHealing(rule, failure, attempt, id, record);

        if (!healed) {
          // Exhausted — log and return failure
          logFailure({ name, ...failure, attempts: attempt, timeline });
          errorHandler.report('orchestration_error', err, {
            correlationId: id,
            name,
            category: failure.category,
            attempts: attempt
          });

          return {
            success: false,
            correlationId: id,
            name,
            failure: { ...failure, attempts: attempt },
            timeline,
            startedAt,
            completedAt: new Date().toISOString(),
            attempts: attempt
          };
        }

        // Check global retry budget
        if (attempt >= GLOBAL.maxGlobalRetries) {
          record('global_retry_budget_exhausted', { maxRetries: GLOBAL.maxGlobalRetries });
          logFailure({ name, ...failure, attempts: attempt, timeline });
          return {
            success: false,
            correlationId: id,
            name,
            failure: { ...lastFailure, attempts: attempt },
            timeline,
            startedAt,
            completedAt: new Date().toISOString(),
            attempts: attempt
          };
        }
      }
    }
  }

  /**
   * Apply healing strategy for a failure. Returns true if retry should proceed.
   * @private
   */
  async _applyHealing(rule, failure, attempt, correlationId, record) {
    const action = rule.action;
    const maxRetries = rule.maxRetries || 0;

    switch (action) {
    case 'fail_fast':
      record('healing_action', { action: 'fail_fast', category: failure.category });
      return false;

    case 'halt_and_log':
      record('healing_action', { action: 'halt_and_log', category: failure.category });
      return false;

    case 'mark_non_blocking':
      record('healing_action', { action: 'mark_non_blocking', category: failure.category });
      return false;

    case 'retry_or_fallback':
    case 'retry_with_backoff':
    case 'backoff_and_retry': {
      if (attempt > maxRetries) {
        record('healing_action', { action: 'retries_exhausted', attempt, maxRetries });
        return false;
      }
      const delay = computeDelay(rule, attempt);
      record('healing_action', { action: 'retrying', attempt, delayMs: delay, maxRetries });
      await sleep(delay);
      return true;
    }

    default:
      record('healing_action', { action: 'unknown_action_halt', action_received: action });
      return false;
    }
  }
}

const selfHealingOrchestrator = new SelfHealingOrchestrator();
export default selfHealingOrchestrator;
export { SelfHealingOrchestrator };

// --test block
if (process.argv.includes('--test')) {
  console.log('\n[HEALING] Running self-test...\n');

  let passed = 0;
  let failed = 0;

  const assert = (label, condition) => {
    if (condition) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label}`); failed++; }
  };

  // 1. Successful operation passes through
  {
    const result = await selfHealingOrchestrator.execute({
      name: 'test_success',
      operation: async () => ({ value: 42 })
    });
    assert('success: result.success === true', result.success === true);
    assert('success: result.result.value === 42', result.result?.value === 42);
    assert('success: attempts === 1', result.attempts === 1);
    assert('success: correlationId is UUID', typeof result.correlationId === 'string');
    assert('success: timeline has events', result.timeline.length >= 2);
  }

  // 2. Non-retryable failure (validation_error) halts immediately
  {
    let callCount = 0;
    const result = await selfHealingOrchestrator.execute({
      name: 'test_validation_fail',
      operation: async () => {
        callCount++;
        throw new Error('missing required field: prompt');
      }
    });
    assert('validation: success === false', !result.success);
    assert('validation: category = validation_error', result.failure.category === 'validation_error');
    assert('validation: only 1 attempt (fail_fast)', callCount === 1);
  }

  // 3. Retryable failure (dependency_failure) retries up to maxRetries
  {
    let callCount = 0;
    const result = await selfHealingOrchestrator.execute({
      name: 'test_dependency_retry',
      operation: async () => {
        callCount++;
        if (callCount < 3) throw new Error('Python bridge is not running');
        return { recovered: true };
      }
    });
    assert('dependency: recovered after retries', result.success === true);
    assert('dependency: took 3 attempts', result.attempts === 3);
  }

  // 4. Guard failure prevents execution
  {
    let operationCalled = false;
    const result = await selfHealingOrchestrator.execute({
      name: 'test_guard',
      guards: { bridge_check: async () => false },
      operation: async () => { operationCalled = true; return {}; }
    });
    assert('guard: success === false', !result.success);
    assert('guard: operation never called', !operationCalled);
  }

  // 5. correlationId propagates through timeline
  {
    const myId = randomUUID();
    const result = await selfHealingOrchestrator.execute({
      name: 'test_correlation',
      correlationId: myId,
      operation: async (id) => ({ receivedId: id })
    });
    assert('correlation: ID propagated to operation', result.result?.receivedId === myId);
    assert('correlation: ID in timeline events', result.timeline.every(e => e.correlationId === myId));
  }

  // 6. Exhausted retries returns failure with attempt count
  {
    let _calls = 0;
    const result = await selfHealingOrchestrator.execute({
      name: 'test_exhausted_retries',
      operation: async () => {
        _calls++;
        throw new Error('ETIMEDOUT: always times out');
      }
    });
    assert('exhausted: success === false', !result.success);
    assert('exhausted: attempts > 1', result.attempts > 1);
    assert('exhausted: category = timeout', result.failure.category === 'timeout');
  }

  console.log(`\n[HEALING] ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}
