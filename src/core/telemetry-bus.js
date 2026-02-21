/**
 * TelemetryBus - Observability event hub for BrightForge
 *
 * EventEmitter-based telemetry system tracking:
 * - LLM requests (provider, tokens, cost, latency)
 * - Plan operations (generation, apply, rollback)
 * - Session lifecycle (creation, approval, rejection)
 * - Performance metrics (P50, P95, P99 latencies)
 *
 * Ring buffers keep last 100 events per category for /api/metrics endpoint.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';

class TelemetryBus extends EventEmitter {
  constructor() {
    super();

    // Ring buffers (last 100 events per category)
    this.ringBuffers = {
      llmRequests: [],
      operations: [],
      sessions: [],
      performance: [],
      forge3d: []
    };

    this.ringBufferSize = 100;

    // Aggregate counters
    this.counters = {
      llmRequests: 0,
      operations: 0,
      sessions: 0,
      providers: {} // per-provider stats: { groq: { requests: 0, tokens: 0, cost: 0, failures: 0 } }
    };

    // Latency tracking arrays for percentile calculation
    this.latencyStats = {
      llm: [],        // LLM request latencies
      apply: [],      // Apply operation latencies
      plan: []        // Plan generation latencies
    };

    this.startTime = Date.now();
  }

  /**
   * Emit a telemetry event. Updates buffers, counters, and broadcasts to listeners.
   *
   * @param {string} category - Event category (llm_request, plan_generated, apply_operation, etc.)
   * @param {Object} data - Event-specific data (provider, duration, tokens, cost, status, etc.)
   * @returns {string} eventId - Unique ID for this event
   */
  emit(category, data) {
    const eventId = randomUUID().slice(0, 12);

    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      category,
      ...data
    };

    // 1. Route to appropriate ring buffer
    this._routeEvent(event);

    // 2. Update aggregate counters
    this._updateCounters(event);

    // 3. Emit to EventEmitter listeners
    super.emit(category, event);
    super.emit('all', event);

    return eventId;
  }

  /**
   * Start a timer for an operation. Returns endTimer() function to call when done.
   *
   * @param {string} category - Category for latency tracking (llm_request, plan_generated, apply_operation)
   * @param {Object} metadata - Additional metadata (provider, operation type, etc.)
   * @returns {Function} endTimer(additionalData) - Call when operation completes
   */
  startTimer(category, metadata = {}) {
    const startTime = Date.now();

    return (additionalData = {}) => {
      const duration = Date.now() - startTime;

      // Track latency in appropriate stats array
      const statsKey = this._getStatsKey(category);
      if (statsKey && this.latencyStats[statsKey]) {
        this.latencyStats[statsKey].push(duration);
        // Keep only last 1000 measurements
        if (this.latencyStats[statsKey].length > 1000) {
          this.latencyStats[statsKey].shift();
        }
      }

      // Emit event with duration
      return this.emit(category, {
        ...metadata,
        ...additionalData,
        duration
      });
    };
  }

  /**
   * Get metrics snapshot for /api/metrics endpoint.
   *
   * @returns {Object} Metrics snapshot with counters, latencies, recent events
   */
  getMetrics() {
    const uptime = Math.floor((Date.now() - this.startTime) / 1000);

    return {
      uptime,
      timestamp: new Date().toISOString(),
      counters: {
        llmRequests: this.counters.llmRequests,
        operations: this.counters.operations,
        sessions: this.counters.sessions
      },
      providers: this._getProviderStats(),
      latency: {
        llm: this._calculatePercentiles(this.latencyStats.llm),
        apply: this._calculatePercentiles(this.latencyStats.apply),
        plan: this._calculatePercentiles(this.latencyStats.plan)
      },
      recentEvents: {
        llmRequests: this.ringBuffers.llmRequests.slice(-10).reverse(),
        operations: this.ringBuffers.operations.slice(-10).reverse(),
        sessions: this.ringBuffers.sessions.slice(-10).reverse(),
        forge3d: this.ringBuffers.forge3d.slice(-10).reverse()
      }
    };
  }

  /**
   * Calculate percentiles (P50, P95, P99) from latency array.
   * @private
   */
  _calculatePercentiles(latencyArray) {
    if (!latencyArray || latencyArray.length === 0) {
      return { p50: 0, p95: 0, p99: 0, count: 0 };
    }

    const sorted = [...latencyArray].sort((a, b) => a - b);
    const count = sorted.length;

    // Use Math.ceil for proper percentile calculation
    const p50Index = Math.ceil(count * 0.50) - 1;
    const p95Index = Math.ceil(count * 0.95) - 1;
    const p99Index = Math.ceil(count * 0.99) - 1;

    return {
      p50: sorted[Math.max(0, p50Index)] || 0,
      p95: sorted[Math.max(0, p95Index)] || 0,
      p99: sorted[Math.max(0, p99Index)] || 0,
      count
    };
  }

  /**
   * Get per-provider aggregated stats.
   * @private
   */
  _getProviderStats() {
    const stats = {};

    for (const [provider, data] of Object.entries(this.counters.providers)) {
      stats[provider] = {
        requests: data.requests || 0,
        tokens: data.tokens || 0,
        cost: (data.cost || 0).toFixed(4),
        failures: data.failures || 0,
        successRate: data.requests > 0
          ? ((data.requests - (data.failures || 0)) / data.requests * 100).toFixed(1) + '%'
          : '0%'
      };
    }

    return stats;
  }

  /**
   * Route event to appropriate ring buffer.
   * @private
   */
  _routeEvent(event) {
    let targetBuffer = null;

    // Map category to buffer
    if (event.category === 'llm_request' || event.category === 'llm_success' || event.category === 'llm_failure') {
      targetBuffer = this.ringBuffers.llmRequests;
    } else if (event.category === 'plan_generated' || event.category === 'apply_operation' || event.category === 'rollback_operation') {
      targetBuffer = this.ringBuffers.operations;
    } else if (event.category === 'session_created' || event.category === 'plan_approved' || event.category === 'plan_rejected') {
      targetBuffer = this.ringBuffers.sessions;
    } else if (event.category === 'performance_metric') {
      targetBuffer = this.ringBuffers.performance;
    } else if (event.category.startsWith('forge3d_')) {
      targetBuffer = this.ringBuffers.forge3d;
    } else {
      // Unknown category - add to performance buffer as catch-all
      targetBuffer = this.ringBuffers.performance;
    }

    if (targetBuffer) {
      targetBuffer.push(event);
      if (targetBuffer.length > this.ringBufferSize) {
        targetBuffer.shift();
      }
    }
  }

  /**
   * Update aggregate counters based on event.
   * @private
   */
  _updateCounters(event) {
    // Increment category counters
    if (event.category === 'llm_request' || event.category === 'llm_success' || event.category === 'llm_failure') {
      this.counters.llmRequests++;

      // Update per-provider stats
      if (event.provider) {
        if (!this.counters.providers[event.provider]) {
          this.counters.providers[event.provider] = {
            requests: 0,
            tokens: 0,
            cost: 0,
            failures: 0
          };
        }

        const providerStats = this.counters.providers[event.provider];
        providerStats.requests++;

        if (event.tokens) {
          providerStats.tokens += event.tokens;
        }

        if (event.cost) {
          providerStats.cost += event.cost;
        }

        if (event.status === 'failed' || event.category === 'llm_failure') {
          providerStats.failures++;
        }
      }
    } else if (event.category === 'plan_generated' || event.category === 'apply_operation' || event.category === 'rollback_operation') {
      this.counters.operations++;
    } else if (event.category === 'session_created' || event.category === 'plan_approved' || event.category === 'plan_rejected') {
      this.counters.sessions++;
    }
  }

  /**
   * Map event category to latency stats key.
   * @private
   */
  _getStatsKey(category) {
    if (category === 'llm_request' || category === 'llm_success' || category === 'llm_failure') {
      return 'llm';
    } else if (category === 'apply_operation' || category === 'rollback_operation') {
      return 'apply';
    } else if (category === 'plan_generated') {
      return 'plan';
    }
    return null;
  }

  /**
   * Clear all telemetry data (useful for testing).
   */
  clear() {
    this.ringBuffers = {
      llmRequests: [],
      operations: [],
      sessions: [],
      performance: [],
      forge3d: []
    };

    this.counters = {
      llmRequests: 0,
      operations: 0,
      sessions: 0,
      providers: {}
    };

    this.latencyStats = {
      llm: [],
      apply: [],
      plan: []
    };

    console.log('[TELEMETRY] Cleared all data');
  }
}

// Export singleton
const telemetryBus = new TelemetryBus();
export { TelemetryBus, telemetryBus };
export default telemetryBus;

// --test block (only runs when this file is the direct entry point)
if (process.argv.includes('--test') && process.argv[1]?.endsWith('telemetry-bus.js')) {
  console.log('Testing TelemetryBus...\n');

  try {
    // Test 1: Event emission works
    console.log('[TEST] Test 1: Event emission...');
    const bus = new TelemetryBus();

    let capturedEvent = null;
    bus.on('llm_request', (event) => { capturedEvent = event; });

    const eventId = bus.emit('llm_request', { provider: 'groq', tokens: 100, cost: 0.001, status: 'success' });

    if (!eventId) throw new Error('emit() should return an eventId');
    if (!capturedEvent) throw new Error('Listener should have been called');
    if (capturedEvent.category !== 'llm_request') throw new Error('Event category mismatch');
    if (capturedEvent.provider !== 'groq') throw new Error('Event provider mismatch');
    console.log('[TEST] Event emission: PASSED');

    // Test 2: Ring buffer overflow (add 150 events, verify only last 100 kept)
    console.log('\n[TEST] Test 2: Ring buffer overflow...');
    bus.clear();

    for (let i = 0; i < 150; i++) {
      bus.emit('llm_request', { provider: 'groq', iteration: i });
    }

    if (bus.ringBuffers.llmRequests.length !== 100) {
      throw new Error(`Ring buffer should have 100 entries, got ${bus.ringBuffers.llmRequests.length}`);
    }

    // Verify oldest 50 were discarded (should start at iteration 50)
    const firstEntry = bus.ringBuffers.llmRequests[0];
    if (firstEntry.iteration !== 50) {
      throw new Error(`First entry should be iteration 50, got ${firstEntry.iteration}`);
    }

    console.log('[TEST] Ring buffer overflow: PASSED');

    // Test 3: Percentile calculation
    console.log('\n[TEST] Test 3: Percentile calculation...');
    bus.clear();

    // Add known latencies [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    // P50 (50th percentile) = ceil(10 * 0.50) - 1 = index 4 = 50
    // P95 (95th percentile) = ceil(10 * 0.95) - 1 = index 9 = 100
    // P99 (99th percentile) = ceil(10 * 0.99) - 1 = index 9 = 100
    const latencies = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    bus.latencyStats.llm = latencies;

    const percentiles = bus._calculatePercentiles(bus.latencyStats.llm);

    if (percentiles.p50 !== 50) throw new Error(`P50 should be 50, got ${percentiles.p50}`);
    if (percentiles.p95 !== 100) throw new Error(`P95 should be 100, got ${percentiles.p95}`);
    if (percentiles.p99 !== 100) throw new Error(`P99 should be 100, got ${percentiles.p99}`);
    if (percentiles.count !== 10) throw new Error(`Count should be 10, got ${percentiles.count}`);

    console.log('[TEST] Percentile calculation: PASSED');

    // Test 4: Provider stats aggregation
    console.log('\n[TEST] Test 4: Provider stats aggregation...');
    bus.clear();

    bus.emit('llm_request', { provider: 'groq', tokens: 100, cost: 0.001, status: 'success' });
    bus.emit('llm_request', { provider: 'groq', tokens: 200, cost: 0.002, status: 'success' });
    bus.emit('llm_failure', { provider: 'groq', status: 'failed' });
    bus.emit('llm_request', { provider: 'ollama', tokens: 500, cost: 0, status: 'success' });

    const providerStats = bus._getProviderStats();

    if (!providerStats.groq) throw new Error('Groq stats should exist');
    if (providerStats.groq.requests !== 3) throw new Error(`Groq requests should be 3, got ${providerStats.groq.requests}`);
    if (providerStats.groq.tokens !== 300) throw new Error(`Groq tokens should be 300, got ${providerStats.groq.tokens}`);
    if (providerStats.groq.failures !== 1) throw new Error(`Groq failures should be 1, got ${providerStats.groq.failures}`);

    if (!providerStats.ollama) throw new Error('Ollama stats should exist');
    if (providerStats.ollama.requests !== 1) throw new Error(`Ollama requests should be 1, got ${providerStats.ollama.requests}`);

    console.log('[TEST] Provider stats aggregation: PASSED');

    // Test 5: Timer system
    console.log('\n[TEST] Test 5: Timer system...');
    bus.clear();

    const endTimer = bus.startTimer('llm_request', { provider: 'groq' });

    // Simulate some work
    await new Promise(resolve => setTimeout(resolve, 10));

    const timerEventId = endTimer({ status: 'success', tokens: 100 });

    if (!timerEventId) throw new Error('endTimer should return an eventId');

    // Verify duration was recorded
    const timerEvent = bus.ringBuffers.llmRequests[bus.ringBuffers.llmRequests.length - 1];
    if (!timerEvent.duration) throw new Error('Timer event should have duration');
    if (timerEvent.duration < 10) throw new Error(`Duration should be >= 10ms, got ${timerEvent.duration}`);
    if (timerEvent.provider !== 'groq') throw new Error('Timer event should have metadata');
    if (timerEvent.status !== 'success') throw new Error('Timer event should have additional data');

    // Verify latency was tracked
    if (bus.latencyStats.llm.length !== 1) throw new Error('Latency should be tracked in llm array');
    if (bus.latencyStats.llm[0] !== timerEvent.duration) throw new Error('Latency mismatch');

    console.log('[TEST] Timer system: PASSED');

    // Test 6: getMetrics() returns valid snapshot
    console.log('\n[TEST] Test 6: getMetrics snapshot...');
    bus.clear();

    bus.emit('llm_request', { provider: 'groq', tokens: 100, cost: 0.001 });
    bus.emit('session_created', { sessionId: 'test-123' });
    bus.emit('plan_generated', { planId: 'plan-456' });

    const metrics = bus.getMetrics();

    if (typeof metrics.uptime !== 'number') throw new Error('Metrics should have uptime');
    if (!metrics.timestamp) throw new Error('Metrics should have timestamp');
    if (metrics.counters.llmRequests !== 1) throw new Error('LLM request counter mismatch');
    if (metrics.counters.sessions !== 1) throw new Error('Session counter mismatch');
    if (metrics.counters.operations !== 1) throw new Error('Operations counter mismatch');
    if (!metrics.providers) throw new Error('Metrics should have providers');
    if (!metrics.latency) throw new Error('Metrics should have latency');
    if (!metrics.recentEvents) throw new Error('Metrics should have recentEvents');

    console.log('[TEST] getMetrics snapshot: PASSED');

    // Test 7: clear() resets all data
    console.log('\n[TEST] Test 7: clear() resets data...');
    bus.clear();

    if (bus.ringBuffers.llmRequests.length !== 0) throw new Error('Ring buffer should be empty after clear');
    if (bus.counters.llmRequests !== 0) throw new Error('Counters should be 0 after clear');
    if (bus.latencyStats.llm.length !== 0) throw new Error('Latency stats should be empty after clear');
    if (Object.keys(bus.counters.providers).length !== 0) throw new Error('Provider stats should be empty after clear');

    console.log('[TEST] clear() resets data: PASSED');

    console.log('\n[TEST] All 7 tests PASSED!');
    console.log('TelemetryBus test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
