/**
 * Failure Classifier
 *
 * Maps errors and HTTP responses into typed failure categories with
 * deterministic outcomes. Every failure receives:
 *   - category: typed string from FAILURE_CATEGORIES
 *   - reason: human-readable explanation
 *   - recoverable: boolean (whether healing should be attempted)
 *   - retryable: boolean (whether retry is the right strategy)
 *   - correlationId: tracing UUID
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

export const FAILURE_CATEGORIES = {
  VALIDATION_ERROR: 'validation_error',           // 400: bad request body
  CONTRACT_MISMATCH: 'contract_mismatch',         // response shape unexpected
  DEPENDENCY_FAILURE: 'dependency_failure',       // 503: bridge/LLM down
  TIMEOUT: 'timeout',                             // request exceeded time limit
  RATE_LIMITED: 'rate_limited_expected',          // 429: expected backoff
  SSE_RACE_CONDITION: 'sse_race_condition',       // SSE stream closed before first event
  SERVER_ERROR: 'server_error',                   // 500: unhandled exception
  NOT_FOUND: 'not_found',                         // 404: resource missing
  CONFLICT: 'conflict',                           // 409: state conflict
  SANDBOX_VIOLATION: 'sandbox_violation',         // blocked by sandbox
  UNKNOWN: 'unknown'
};

// Healing strategy for each category
const HEALING_STRATEGIES = {
  [FAILURE_CATEGORIES.VALIDATION_ERROR]:     { recoverable: false, retryable: false, action: 'fail_fast' },
  [FAILURE_CATEGORIES.CONTRACT_MISMATCH]:    { recoverable: false, retryable: false, action: 'halt_and_log' },
  [FAILURE_CATEGORIES.DEPENDENCY_FAILURE]:   { recoverable: true,  retryable: true,  action: 'retry_or_fallback' },
  [FAILURE_CATEGORIES.TIMEOUT]:              { recoverable: true,  retryable: true,  action: 'retry_with_backoff' },
  [FAILURE_CATEGORIES.RATE_LIMITED]:         { recoverable: true,  retryable: true,  action: 'backoff_and_retry' },
  [FAILURE_CATEGORIES.SSE_RACE_CONDITION]:   { recoverable: true,  retryable: false, action: 'mark_non_blocking' },
  [FAILURE_CATEGORIES.SERVER_ERROR]:         { recoverable: false, retryable: false, action: 'halt_and_log' },
  [FAILURE_CATEGORIES.NOT_FOUND]:            { recoverable: false, retryable: false, action: 'fail_fast' },
  [FAILURE_CATEGORIES.CONFLICT]:             { recoverable: false, retryable: false, action: 'fail_fast' },
  [FAILURE_CATEGORIES.SANDBOX_VIOLATION]:    { recoverable: false, retryable: false, action: 'halt_and_log' },
  [FAILURE_CATEGORIES.UNKNOWN]:              { recoverable: false, retryable: false, action: 'halt_and_log' }
};

class FailureClassifier {
  /**
   * Classify an HTTP response result (from the harness or route handler).
   *
   * @param {Object} ctx
   * @param {number} ctx.status - HTTP status code
   * @param {boolean} ctx.timedOut - True if request timed out
   * @param {boolean} ctx.hung - True if request exceeded hang threshold
   * @param {string} [ctx.error] - Error message
   * @param {Object} [ctx.body] - Parsed response body
   * @param {string} [ctx.correlationId] - Existing correlation ID (optional)
   * @returns {FailureRecord}
   */
  classifyHttpResult(ctx) {
    const correlationId = ctx.correlationId || randomUUID();
    const { status, timedOut, hung, error, body } = ctx;

    let category = FAILURE_CATEGORIES.UNKNOWN;
    let reason = error || 'No reason provided';

    if (timedOut || hung) {
      category = FAILURE_CATEGORIES.TIMEOUT;
      reason = 'Request timed out or hung';
    } else if (status === 400) {
      const bodyError = body?.error || '';
      if (bodyError === 'invalid_request' || bodyError === 'validation_error') {
        category = FAILURE_CATEGORIES.VALIDATION_ERROR;
      } else {
        category = FAILURE_CATEGORIES.VALIDATION_ERROR;
      }
      reason = body?.reason || body?.error || 'Bad request';
    } else if (status === 404) {
      category = FAILURE_CATEGORIES.NOT_FOUND;
      reason = body?.error || 'Resource not found';
    } else if (status === 409) {
      category = FAILURE_CATEGORIES.CONFLICT;
      reason = body?.error || 'State conflict';
    } else if (status === 429) {
      category = FAILURE_CATEGORIES.RATE_LIMITED;
      reason = 'Rate limit exceeded';
    } else if (status === 500) {
      category = FAILURE_CATEGORIES.SERVER_ERROR;
      reason = body?.error || 'Internal server error';
    } else if (status === 503) {
      const bodyError = body?.error || '';
      if (bodyError === 'dependency_unavailable' || bodyError.includes('bridge') || bodyError.includes('not ready')) {
        category = FAILURE_CATEGORIES.DEPENDENCY_FAILURE;
        reason = body?.reason || body?.error || 'Dependency unavailable';
      } else {
        category = FAILURE_CATEGORIES.DEPENDENCY_FAILURE;
        reason = body?.error || 'Service unavailable';
      }
    } else if (status === 0) {
      category = FAILURE_CATEGORIES.DEPENDENCY_FAILURE;
      reason = 'No response received — service may be down';
    }

    return this._buildRecord(category, reason, correlationId);
  }

  /**
   * Classify a JS Error object (from orchestration, agent, or pipeline code).
   *
   * @param {Error} err
   * @param {Object} [ctx] - Additional context
   * @param {string} [ctx.correlationId]
   * @param {string} [ctx.source] - Which component threw (e.g. 'bridge', 'llm', 'tester')
   * @returns {FailureRecord}
   */
  classifyError(err, ctx = {}) {
    const correlationId = ctx.correlationId || randomUUID();
    const msg = err.message || String(err);

    let category = FAILURE_CATEGORIES.UNKNOWN;
    let reason = msg;

    if (msg.includes('ETIMEDOUT') || msg.includes('timed out') || msg.includes('timeout')) {
      category = FAILURE_CATEGORIES.TIMEOUT;
      reason = `Operation timed out: ${msg}`;
    } else if (msg.includes('ECONNREFUSED') || msg.includes('not running') || msg.includes('unavailable') || msg.includes('bridge')) {
      category = FAILURE_CATEGORIES.DEPENDENCY_FAILURE;
      reason = `Dependency connection failed: ${msg}`;
    } else if (msg.includes('Path escape') || msg.includes('not allowed') || msg.includes('SANDBOX')) {
      category = FAILURE_CATEGORIES.SANDBOX_VIOLATION;
      reason = `Sandbox policy violation: ${msg}`;
    } else if (msg.includes('rate limit') || msg.includes('429')) {
      category = FAILURE_CATEGORIES.RATE_LIMITED;
      reason = `Rate limited: ${msg}`;
    } else if (msg.includes('contract') || msg.includes('shape') || msg.includes('unexpected field')) {
      category = FAILURE_CATEGORIES.CONTRACT_MISMATCH;
      reason = `Contract violation: ${msg}`;
    } else if (msg.includes('required') || msg.includes('invalid') || msg.includes('missing field')) {
      category = FAILURE_CATEGORIES.VALIDATION_ERROR;
      reason = `Validation failed: ${msg}`;
    }

    return this._buildRecord(category, reason, correlationId);
  }

  /**
   * Check whether a harness result represents a false-positive 202.
   * A 202 is false-positive if the follow-up status call shows failure.
   *
   * @param {Object} submitResult - Result of the submit call (202)
   * @param {Object} statusResult - Result of follow-up status call
   * @returns {{ isFalsePositive: boolean, category: string, reason: string }}
   */
  detectFalsePositive202(submitResult, statusResult) {
    if (submitResult.status !== 202) {
      return { isFalsePositive: false, category: null, reason: null };
    }

    const statusBody = statusResult.body || {};
    const jobStatus = statusBody.status || statusBody.state || '';

    if (statusResult.status === 500 || statusResult.status === 503) {
      return {
        isFalsePositive: true,
        category: FAILURE_CATEGORIES.DEPENDENCY_FAILURE,
        reason: `202 accepted but status endpoint returned ${statusResult.status}`
      };
    }

    if (jobStatus === 'failed' || jobStatus === 'error') {
      return {
        isFalsePositive: true,
        category: FAILURE_CATEGORIES.SERVER_ERROR,
        reason: `202 accepted but job failed immediately: ${statusBody.error || jobStatus}`
      };
    }

    return { isFalsePositive: false, category: null, reason: null };
  }

  _buildRecord(category, reason, correlationId) {
    const strategy = HEALING_STRATEGIES[category] || HEALING_STRATEGIES[FAILURE_CATEGORIES.UNKNOWN];

    return {
      category,
      reason,
      correlationId,
      recoverable: strategy.recoverable,
      retryable: strategy.retryable,
      action: strategy.action,
      classifiedAt: new Date().toISOString()
    };
  }
}

const failureClassifier = new FailureClassifier();
export default failureClassifier;
export { FailureClassifier };

// --test block
const __fcFilename = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] === __fcFilename) {
  console.log('\n[FAILURE-CLASSIFIER] Running self-test...\n');

  let passed = 0;
  let failed = 0;

  const assert = (label, condition) => {
    if (condition) { console.log(`  ✓ ${label}`); passed++; }
    else { console.error(`  ✗ ${label}`); failed++; }
  };

  // HTTP classification
  const r400 = failureClassifier.classifyHttpResult({ status: 400, body: { error: 'invalid_request', reason: 'prompt required' } });
  assert('400 → validation_error', r400.category === 'validation_error');
  assert('400 → not recoverable', !r400.recoverable);
  assert('400 → fail_fast action', r400.action === 'fail_fast');

  const r429 = failureClassifier.classifyHttpResult({ status: 429 });
  assert('429 → rate_limited_expected', r429.category === 'rate_limited_expected');
  assert('429 → retryable', r429.retryable);

  const r500 = failureClassifier.classifyHttpResult({ status: 500, body: { error: 'crash' } });
  assert('500 → server_error', r500.category === 'server_error');
  assert('500 → not recoverable', !r500.recoverable);

  const r503 = failureClassifier.classifyHttpResult({ status: 503, body: { error: 'dependency_unavailable', reason: 'bridge down' } });
  assert('503 → dependency_failure', r503.category === 'dependency_failure');
  assert('503 → recoverable', r503.recoverable);
  assert('503 → retry_or_fallback', r503.action === 'retry_or_fallback');

  const rTimeout = failureClassifier.classifyHttpResult({ status: 0, timedOut: true });
  assert('timedOut → timeout', rTimeout.category === 'timeout');
  assert('timeout → retryable', rTimeout.retryable);

  // Error classification
  const eTimeout = failureClassifier.classifyError(new Error('ETIMEDOUT: connection timed out'));
  assert('ETIMEDOUT error → timeout', eTimeout.category === 'timeout');

  const eBridge = failureClassifier.classifyError(new Error('Python bridge is not running'));
  assert('bridge error → dependency_failure', eBridge.category === 'dependency_failure');

  const eSandbox = failureClassifier.classifyError(new Error('[SANDBOX] Path escape blocked'));
  assert('sandbox error → sandbox_violation', eSandbox.category === 'sandbox_violation');
  assert('sandbox → not recoverable', !eSandbox.recoverable);

  // False positive 202 detection
  const fp = failureClassifier.detectFalsePositive202(
    { status: 202 },
    { status: 200, body: { status: 'failed', error: 'model crashed' } }
  );
  assert('false positive 202 detected', fp.isFalsePositive);
  assert('false positive category = server_error', fp.category === 'server_error');

  const noFp = failureClassifier.detectFalsePositive202(
    { status: 202 },
    { status: 200, body: { status: 'processing' } }
  );
  assert('no false positive when still processing', !noFp.isFalsePositive);

  // correlationId always present
  const r = failureClassifier.classifyHttpResult({ status: 404 });
  assert('correlationId is UUID', typeof r.correlationId === 'string' && r.correlationId.length === 36);

  console.log(`\n[FAILURE-CLASSIFIER] ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}
