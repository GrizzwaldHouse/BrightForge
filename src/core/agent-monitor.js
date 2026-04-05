/**
 * AgentMonitor - Provider health state tracking
 *
 * Tracks provider states: active (processing), loaded (ready), sleeping (idle >60s).
 * Subscribes to telemetryBus for state transitions.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import telemetryBus from './telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SLEEP_THRESHOLD_MS = 60000; // 60 seconds

class AgentMonitor extends EventEmitter {
  constructor() {
    super();
    this.providers = new Map(); // providerName -> { state, lastUsed, requestCount, totalLatency, errorCount, successCount }
    this._checkInterval = null;
  }

  /**
   * Initialize monitoring - subscribe to telemetry events.
   */
  init() {
    // Listen for LLM request completions
    telemetryBus.on('llm_request', (data) => {
      if (!data || !data.provider) return;
      this._recordActivity(data.provider, data);
    });

    // Start periodic state check (every 15s)
    this._checkInterval = setInterval(() => this._checkStates(), 15000);

    console.log('[AGENT-MONITOR] Initialized');
  }

  /**
   * Record provider activity.
   */
  _recordActivity(providerName, data) {
    if (!this.providers.has(providerName)) {
      this.providers.set(providerName, {
        state: 'active',
        lastUsed: Date.now(),
        requestCount: 0,
        totalLatency: 0,
        errorCount: 0,
        successCount: 0
      });
    }

    const provider = this.providers.get(providerName);
    const prevState = provider.state;

    provider.state = 'active';
    provider.lastUsed = Date.now();
    provider.requestCount++;

    if (data.duration) {
      provider.totalLatency += data.duration;
    }

    if (data.status === 'success') {
      provider.successCount++;
    } else if (data.status === 'failed') {
      provider.errorCount++;
    }

    if (prevState !== 'active') {
      this.emit('agent_state_changed', {
        provider: providerName,
        from: prevState,
        to: 'active',
        timestamp: new Date().toISOString()
      });
      telemetryBus.emit('agent_state_changed', {
        provider: providerName,
        from: prevState,
        to: 'active'
      });
    }
  }

  /**
   * Check all providers for state transitions.
   */
  _checkStates() {
    const now = Date.now();
    for (const [name, provider] of this.providers.entries()) {
      const idle = now - provider.lastUsed;

      if (provider.state === 'active' && idle > 5000) {
        provider.state = 'loaded';
        this.emit('agent_state_changed', { provider: name, from: 'active', to: 'loaded' });
        telemetryBus.emit('agent_state_changed', { provider: name, from: 'active', to: 'loaded' });
      } else if (provider.state === 'loaded' && idle > SLEEP_THRESHOLD_MS) {
        provider.state = 'sleeping';
        this.emit('agent_state_changed', { provider: name, from: 'loaded', to: 'sleeping' });
        telemetryBus.emit('agent_state_changed', { provider: name, from: 'loaded', to: 'sleeping' });
      }

      // Performance warnings
      if (provider.requestCount > 10) {
        const errorRate = provider.errorCount / provider.requestCount;
        if (errorRate > 0.5) {
          this.emit('agent_performance_warning', {
            provider: name,
            errorRate: Math.round(errorRate * 100),
            requestCount: provider.requestCount
          });
        }
      }
    }
  }

  /**
   * Get snapshot of all agent/provider states.
   */
  getAgentStates() {
    const states = {};
    for (const [name, provider] of this.providers.entries()) {
      states[name] = {
        state: provider.state,
        lastUsed: new Date(provider.lastUsed).toISOString(),
        requestCount: provider.requestCount,
        avgLatency: provider.requestCount > 0
          ? Math.round(provider.totalLatency / provider.requestCount)
          : 0,
        errorRate: provider.requestCount > 0
          ? Math.round((provider.errorCount / provider.requestCount) * 100)
          : 0,
        successCount: provider.successCount,
        errorCount: provider.errorCount
      };
    }
    return states;
  }

  /**
   * Shutdown monitoring.
   */
  shutdown() {
    if (this._checkInterval) {
      clearInterval(this._checkInterval);
      this._checkInterval = null;
    }
    console.log('[AGENT-MONITOR] Shut down');
  }
}

const agentMonitor = new AgentMonitor();
export default agentMonitor;
export { AgentMonitor };

// Self-test
if (process.argv.includes('--test') && process.argv[1]?.endsWith('agent-monitor.js')) {
  console.log('[AGENT-MONITOR] Running self-test...\n');

  const monitor = new AgentMonitor();

  // Test 1: Record activity
  console.log('[TEST] Test 1: Record activity...');
  monitor._recordActivity('groq', { status: 'success', duration: 500 });
  const states = monitor.getAgentStates();
  console.assert(states.groq, 'Should have groq state');
  console.assert(states.groq.state === 'active', 'Should be active');
  console.assert(states.groq.requestCount === 1, 'Should have 1 request');
  console.assert(states.groq.avgLatency === 500, 'Avg latency should be 500');
  console.log('[TEST] Record activity: PASSED');

  // Test 2: Error tracking
  console.log('\n[TEST] Test 2: Error tracking...');
  monitor._recordActivity('cerebras', { status: 'failed', duration: 100 });
  monitor._recordActivity('cerebras', { status: 'success', duration: 200 });
  const cerebrasState = monitor.getAgentStates().cerebras;
  console.assert(cerebrasState.errorCount === 1, 'Should have 1 error');
  console.assert(cerebrasState.successCount === 1, 'Should have 1 success');
  console.assert(cerebrasState.errorRate === 50, 'Error rate should be 50%');
  console.log('[TEST] Error tracking: PASSED');

  // Test 3: State transitions (simulated)
  console.log('\n[TEST] Test 3: State transitions...');
  // Force lastUsed to 10 seconds ago
  monitor.providers.get('groq').lastUsed = Date.now() - 10000;
  monitor._checkStates();
  console.assert(monitor.providers.get('groq').state === 'loaded', 'Should transition to loaded');

  // Force lastUsed to 2 minutes ago
  monitor.providers.get('groq').lastUsed = Date.now() - 120000;
  monitor._checkStates();
  console.assert(monitor.providers.get('groq').state === 'sleeping', 'Should transition to sleeping');
  console.log('[TEST] State transitions: PASSED');

  // Test 4: Empty states
  console.log('\n[TEST] Test 4: Empty monitor...');
  const emptyMonitor = new AgentMonitor();
  const emptyStates = emptyMonitor.getAgentStates();
  console.assert(Object.keys(emptyStates).length === 0, 'Should be empty');
  console.log('[TEST] Empty monitor: PASSED');

  monitor.shutdown();
  console.log('\n[TEST] All 4 tests PASSED!');
  console.log('AgentMonitor test PASSED');
  process.exit(0);
}
