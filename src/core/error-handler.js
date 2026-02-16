/**
 * ErrorHandler - Observer-pattern error handling with crash diagnostics
 *
 * Centralized error broadcasting using EventEmitter. Listeners can
 * subscribe to specific error categories or 'all' events.
 *
 * Features:
 * - Error event broadcasting by category
 * - In-memory ring buffer for recent error queries
 * - Persistent JSONL logging to sessions/errors.jsonl
 * - Crash report generation on fatal errors
 * - Process-level handlers (uncaughtException, unhandledRejection)
 * - Exponential backoff retry tracking
 *
 * Categories: provider_error, plan_error, apply_error, session_error, server_error, fatal, forge3d_error, bridge_error, gpu_error
 * Severity:   warning, error, fatal
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { EventEmitter } from 'events';
import { appendFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import telemetryBus from './telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VALID_CATEGORIES = ['provider_error', 'plan_error', 'apply_error', 'session_error', 'server_error', 'fatal', 'forge3d_error', 'bridge_error', 'gpu_error'];
const VALID_SEVERITIES = ['warning', 'error', 'fatal'];

class ErrorHandler extends EventEmitter {
  constructor() {
    super();

    this.ringBuffer = [];
    this.ringBufferSize = 100;
    this.logFilePath = null;
    this.sessionsDir = null;
    this.crashReportsEnabled = true;
    this.initialized = false;
    this.startTime = Date.now();

    // Retry tracking: { key: { attempts: 0, lastAttempt: 0 } }
    this.retryState = new Map();

    // Error counters for diagnostics
    this.errorCounts = {
      total: 0,
      byCategory: {},
      bySeverity: {}
    };
  }

  /**
   * Initialize the error handler with session directory and config.
   * Registers process-level handlers for uncaught errors.
   *
   * @param {string} sessionsDir - Path to sessions directory
   * @param {Object} [config] - Optional configuration override
   */
  initialize(sessionsDir, config = {}) {
    if (this.initialized) {
      console.warn('[ERROR-HANDLER] Already initialized, skipping');
      return;
    }

    this.sessionsDir = sessionsDir;
    this.ringBufferSize = config.ring_buffer_size || 100;
    this.crashReportsEnabled = config.crash_reports !== false;

    // Ensure sessions directory exists
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
    }

    // Set up JSONL log file path
    const logFile = config.log_file || 'errors.jsonl';
    this.logFilePath = logFile.startsWith('/')
      ? logFile
      : join(sessionsDir, logFile.replace('sessions/', ''));

    // Register process-level handlers
    this._registerProcessHandlers();

    this.initialized = true;
    console.log(`[ERROR-HANDLER] Initialized (buffer: ${this.ringBufferSize}, log: ${this.logFilePath})`);
  }

  /**
   * Report an error. Logs to buffer, JSONL, and emits events.
   *
   * @param {string} category - Error category (provider_error, plan_error, etc.)
   * @param {Error|string} error - The error object or message string
   * @param {Object} [context={}] - Additional context (provider, sessionId, etc.)
   * @returns {string} errorId - Unique ID for this error entry
   */
  report(category, error, context = {}) {
    const errorId = randomUUID().slice(0, 12);
    const severity = category === 'fatal' ? 'fatal' : (context.severity || 'error');

    const entry = {
      id: errorId,
      timestamp: new Date().toISOString(),
      category: VALID_CATEGORIES.includes(category) ? category : 'server_error',
      severity: VALID_SEVERITIES.includes(severity) ? severity : 'error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      context,
      pid: process.pid
    };

    // 1. Add to ring buffer
    this.ringBuffer.push(entry);
    if (this.ringBuffer.length > this.ringBufferSize) {
      this.ringBuffer.shift();
    }

    // 2. Update counters
    this.errorCounts.total++;
    this.errorCounts.byCategory[category] = (this.errorCounts.byCategory[category] || 0) + 1;
    this.errorCounts.bySeverity[severity] = (this.errorCounts.bySeverity[severity] || 0) + 1;

    // 3. Append to JSONL file
    if (this.logFilePath) {
      try {
        appendFileSync(this.logFilePath, JSON.stringify(entry) + '\n', 'utf8');
      } catch (fileError) {
        // Don't recurse — just log to console
        console.error(`[ERROR-HANDLER] Failed to write JSONL: ${fileError.message}`);
      }
    }

    // 4. Emit events: specific category + 'all'
    this.emit(category, entry);
    this.emit('all', entry);

    // 5. If fatal, write crash report
    if (severity === 'fatal' && this.crashReportsEnabled) {
      this.writeCrashReport(error, entry);
    }

    return errorId;
  }

  /**
   * Register a listener for a specific error category.
   * Use 'all' to listen for every error.
   *
   * @param {string} category - Category to listen for, or 'all'
   * @param {Function} callback - Function called with error entry
   */
  onError(category, callback) {
    this.on(category, callback);
  }

  /**
   * Remove a listener for a specific error category.
   *
   * @param {string} category - Category to remove listener from
   * @param {Function} callback - The listener function to remove
   */
  offError(category, callback) {
    this.off(category, callback);
  }

  /**
   * Get recent errors from the ring buffer.
   *
   * @param {number} [limit=20] - Max entries to return
   * @param {string} [category] - Optional category filter
   * @returns {Array} Recent error entries (newest first)
   */
  getRecentErrors(limit = 20, category = null) {
    let errors = [...this.ringBuffer];

    if (category) {
      errors = errors.filter(e => e.category === category);
    }

    // Newest first
    return errors.reverse().slice(0, limit);
  }

  /**
   * Get system diagnostics: uptime, memory, error counts, top categories.
   *
   * @returns {Object} Diagnostics report
   */
  getDiagnostics() {
    const mem = process.memoryUsage();

    return {
      uptime: Math.floor((Date.now() - this.startTime) / 1000),
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
        heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
        heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`
      },
      errors: {
        total: this.errorCounts.total,
        byCategory: { ...this.errorCounts.byCategory },
        bySeverity: { ...this.errorCounts.bySeverity },
        recentCount: this.ringBuffer.length
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Write a crash report to disk on fatal errors.
   * Enhanced with telemetry snapshot, memory pressure, and provider health.
   *
   * @param {Error} error - The fatal error
   * @param {Object} [entry] - The error entry from report()
   */
  writeCrashReport(error, entry = null) {
    if (!this.sessionsDir) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = join(this.sessionsDir, `crash-report-${timestamp}.json`);

    // Get memory usage for enhanced diagnostics
    const memUsage = process.memoryUsage();
    const heapPercentUsed = (memUsage.heapUsed / memUsage.heapTotal * 100).toFixed(1);

    const report = {
      timestamp: new Date().toISOString(),
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        code: error?.code
      },
      triggerEntry: entry || null,
      recentErrors: this.ringBuffer.slice(-10),
      process: {
        pid: process.pid,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        argv: process.argv
      },
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers,
        heapPercentUsed: `${heapPercentUsed}%`
      },
      errorCounts: { ...this.errorCounts },
      providerHealth: this._snapshotProviderHealth(),
      telemetry: this._snapshotTelemetry()
    };

    try {
      writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
      console.error(`[ERROR-HANDLER] Crash report written: ${reportPath}`);
    } catch (writeError) {
      console.error(`[ERROR-HANDLER] Failed to write crash report: ${writeError.message}`);
    }
  }

  /**
   * Snapshot provider health status for crash reports.
   * Uses telemetryBus provider stats.
   * @private
   * @returns {Object} Provider health snapshot
   */
  _snapshotProviderHealth() {
    try {
      const metrics = telemetryBus.getMetrics();
      return {
        providers: metrics.providers || {}
      };
    } catch (err) {
      return { error: `Failed to snapshot provider health: ${err.message}` };
    }
  }

  /**
   * Snapshot telemetry metrics for crash reports.
   * @private
   * @returns {Object} Telemetry snapshot
   */
  _snapshotTelemetry() {
    try {
      const metrics = telemetryBus.getMetrics();

      return {
        counters: metrics.counters || {},
        latency: metrics.latency || {},
        providers: metrics.providers || {},
        recentLLM: (metrics.recentEvents?.llmRequests || []).slice(-5),
        recentOps: (metrics.recentEvents?.operations || []).slice(-5)
      };
    } catch (err) {
      return { error: `Failed to snapshot telemetry: ${err.message}` };
    }
  }

  /**
   * Check if a retry should be attempted for a given key.
   * Implements exponential backoff.
   *
   * @param {string} key - Unique retry key (e.g. provider name)
   * @param {number} [maxAttempts=3] - Maximum retry attempts
   * @param {number} [baseBackoffMs=1000] - Base backoff in milliseconds
   * @returns {boolean} Whether retry should be attempted
   */
  shouldRetry(key, maxAttempts = 3, baseBackoffMs = 1000) {
    const state = this.retryState.get(key) || { attempts: 0, lastAttempt: 0 };

    if (state.attempts >= maxAttempts) {
      return false;
    }

    // Check exponential backoff: baseMs * 2^attempts
    const backoff = baseBackoffMs * Math.pow(2, state.attempts);
    const elapsed = Date.now() - state.lastAttempt;

    if (elapsed < backoff) {
      return false;
    }

    // Update state
    state.attempts++;
    state.lastAttempt = Date.now();
    this.retryState.set(key, state);

    return true;
  }

  /**
   * Reset retry counter for a key (call on success).
   *
   * @param {string} key - Retry key to reset
   */
  resetRetry(key) {
    this.retryState.delete(key);
  }

  /**
   * Clear all recent errors from the ring buffer.
   */
  clearErrors() {
    this.ringBuffer = [];
    this.errorCounts = {
      total: 0,
      byCategory: {},
      bySeverity: {}
    };
    console.log('[ERROR-HANDLER] Errors cleared');
  }

  /**
   * Register process-level handlers for uncaught errors.
   * @private
   */
  _registerProcessHandlers() {
    process.on('uncaughtException', (error) => {
      console.error(`[ERROR-HANDLER] Uncaught exception: ${error.message}`);
      this.report('fatal', error, { source: 'uncaughtException' });

      // Give time for async writes, then exit
      setTimeout(() => process.exit(1), 500);
    });

    process.on('unhandledRejection', (reason) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      console.error(`[ERROR-HANDLER] Unhandled rejection: ${error.message}`);
      this.report('server_error', error, { source: 'unhandledRejection', severity: 'error' });
    });

    console.log('[ERROR-HANDLER] Process handlers registered (uncaughtException, unhandledRejection)');
  }
}

// Export singleton
const errorHandler = new ErrorHandler();
export { ErrorHandler, errorHandler };
export default errorHandler;

// --test block (only runs when this file is the direct entry point)
if (process.argv.includes('--test') && process.argv[1]?.endsWith('error-handler.js')) {
  console.log('Testing ErrorHandler...\n');

  const { mkdtempSync, rmSync, readFileSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join: joinPath } = await import('path');

  const tempDir = mkdtempSync(joinPath(tmpdir(), 'llcapp-error-test-'));
  console.log(`Test directory: ${tempDir}`);

  try {
    // Test 1: Initialize
    console.log('[TEST] Test 1: Initialize...');
    const handler = new ErrorHandler();
    handler.initialize(tempDir, { ring_buffer_size: 5, crash_reports: true });

    if (!handler.initialized) throw new Error('Handler should be initialized');
    if (handler.ringBufferSize !== 5) throw new Error(`Buffer size should be 5, got ${handler.ringBufferSize}`);
    console.log('[TEST] Initialize: PASSED');

    // Test 2: Report an error and check ring buffer
    console.log('\n[TEST] Test 2: Report + ring buffer...');
    const errorId = handler.report('provider_error', new Error('Test provider failure'), { provider: 'groq' });

    if (!errorId) throw new Error('report() should return an errorId');
    if (handler.ringBuffer.length !== 1) throw new Error(`Ring buffer should have 1 entry, got ${handler.ringBuffer.length}`);
    if (handler.ringBuffer[0].category !== 'provider_error') throw new Error('Category mismatch');
    if (handler.ringBuffer[0].context.provider !== 'groq') throw new Error('Context.provider mismatch');
    console.log('[TEST] Report + ring buffer: PASSED');

    // Test 3: Event emission (observer pattern)
    console.log('\n[TEST] Test 3: Event emission (observer pattern)...');
    let capturedEvent = null;
    let capturedAllEvent = null;

    handler.onError('plan_error', (entry) => { capturedEvent = entry; });
    handler.onError('all', (entry) => { capturedAllEvent = entry; });

    handler.report('plan_error', new Error('Plan failed'), { sessionId: 'test-123' });

    if (!capturedEvent) throw new Error('Category listener should have been called');
    if (capturedEvent.category !== 'plan_error') throw new Error('Captured event category mismatch');
    if (!capturedAllEvent) throw new Error('"all" listener should have been called');
    if (capturedAllEvent.category !== 'plan_error') throw new Error('All-event category mismatch');
    console.log('[TEST] Event emission: PASSED');

    // Test 4: Ring buffer overflow
    console.log('\n[TEST] Test 4: Ring buffer overflow (size=5)...');
    for (let i = 0; i < 10; i++) {
      handler.report('server_error', new Error(`Error ${i}`));
    }
    // Buffer was size 5; we had 2 from tests 2/3 + 10 = 12 total, but should cap at 5
    if (handler.ringBuffer.length !== 5) throw new Error(`Ring buffer should be capped at 5, got ${handler.ringBuffer.length}`);
    console.log('[TEST] Ring buffer overflow: PASSED');

    // Test 5: getRecentErrors with category filter
    console.log('\n[TEST] Test 5: getRecentErrors + filter...');
    const allRecent = handler.getRecentErrors(100);
    const serverOnly = handler.getRecentErrors(100, 'server_error');

    if (allRecent.length !== 5) throw new Error(`Should have 5 recent, got ${allRecent.length}`);
    // All 5 in buffer are server_error (the last 5 of the 10 we added, plus the initial two were pushed out)
    // Actually: 2 initial (provider_error + plan_error) + 10 server_error = 12 total, buffer keeps last 5 → all 5 are server_error
    if (serverOnly.length !== 5) throw new Error(`Should have 5 server_error, got ${serverOnly.length}`);
    console.log('[TEST] getRecentErrors: PASSED');

    // Test 6: JSONL persistence
    console.log('\n[TEST] Test 6: JSONL persistence...');
    const logContent = readFileSync(handler.logFilePath, 'utf8');
    const lines = logContent.trim().split('\n');
    // 1 (test 2) + 1 (test 3) + 10 (test 4) = 12 entries
    if (lines.length !== 12) throw new Error(`JSONL should have 12 entries, got ${lines.length}`);
    const firstEntry = JSON.parse(lines[0]);
    if (!firstEntry.id || !firstEntry.timestamp || !firstEntry.category) throw new Error('JSONL entry missing fields');
    console.log('[TEST] JSONL persistence: PASSED');

    // Test 7: getDiagnostics
    console.log('\n[TEST] Test 7: getDiagnostics...');
    const diag = handler.getDiagnostics();
    if (typeof diag.uptime !== 'number') throw new Error('Diagnostics should have uptime');
    if (!diag.memory.rss) throw new Error('Diagnostics should have memory.rss');
    if (diag.errors.total !== 12) throw new Error(`Total errors should be 12, got ${diag.errors.total}`);
    console.log('[TEST] getDiagnostics: PASSED');

    // Test 8: Crash report (non-fatal triggered manually)
    console.log('\n[TEST] Test 8: Crash report...');
    handler.writeCrashReport(new Error('Test crash'));
    const crashFiles = (await import('fs')).readdirSync(tempDir).filter(f => f.startsWith('crash-report-'));
    if (crashFiles.length === 0) throw new Error('Crash report should have been written');
    const crashContent = JSON.parse(readFileSync(joinPath(tempDir, crashFiles[0]), 'utf8'));
    if (!crashContent.error || !crashContent.process) throw new Error('Crash report missing fields');
    console.log('[TEST] Crash report: PASSED');

    // Test 9: Retry logic (exponential backoff)
    console.log('\n[TEST] Test 9: Retry logic...');
    // Fresh key, maxAttempts=3
    const canRetry1 = handler.shouldRetry('test-key', 3, 0);
    if (!canRetry1) throw new Error('Attempt 1 should be allowed');

    const canRetry2 = handler.shouldRetry('test-key', 3, 0);
    if (!canRetry2) throw new Error('Attempt 2 should be allowed');

    const canRetry3 = handler.shouldRetry('test-key', 3, 0);
    if (!canRetry3) throw new Error('Attempt 3 should be allowed');

    const canRetry4 = handler.shouldRetry('test-key', 3, 0);
    if (canRetry4) throw new Error('Attempt 4 should be blocked (max=3)');

    handler.resetRetry('test-key');
    const canRetryAfterReset = handler.shouldRetry('test-key', 3, 0);
    if (!canRetryAfterReset) throw new Error('Should retry after reset');
    console.log('[TEST] Retry logic: PASSED');

    // Test 10: clearErrors
    console.log('\n[TEST] Test 10: clearErrors...');
    handler.clearErrors();
    if (handler.ringBuffer.length !== 0) throw new Error('Ring buffer should be empty after clear');
    if (handler.errorCounts.total !== 0) throw new Error('Error count should be 0 after clear');
    console.log('[TEST] clearErrors: PASSED');

    console.log('\n[TEST] All 10 tests PASSED!');
    console.log('ErrorHandler test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`\n[TEST] Cleaned up temp directory: ${tempDir}`);
  }
}
