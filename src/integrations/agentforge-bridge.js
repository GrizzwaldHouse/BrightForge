/**
 * AgentForge Bridge — OwlWatcher outbound transport + node registration
 *
 * Connects BrightForge (MUSCLES + UI) to AgentForge's NERVOUS_SYSTEM layer.
 * All integration is gated behind config flags so this module is a no-op
 * when neither owlwatcher.enabled nor registration.enabled is true.
 *
 * Config: config/agentforge-bridge.yaml
 * Event contracts: config/event-contracts.yaml
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-05-08
 */

import { WebSocket } from 'ws';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parse } from 'yaml';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../config/agentforge-bridge.yaml');
const CONTRACTS_PATH = join(__dirname, '../../config/event-contracts.yaml');

// Circuit breaker states
const CB_CLOSED = 'CLOSED';
const CB_OPEN = 'OPEN';
const CB_HALF_OPEN = 'HALF_OPEN';

class AgentForgeBridge {
  constructor() {
    this._config = null;
    this._forwardedTypes = new Set();
    this._initialized = false;
    this._ws = null;
    this._registered = false;
    this._heartbeatTimer = null;
    this._reconnectTimer = null;
    this._reconnectAttempts = 0;

    // Circuit breaker state
    this._cbState = CB_CLOSED;
    this._cbFailures = 0;
    this._cbResetTimer = null;

    // Telemetry
    this._forwardedCount = 0;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  init() {
    if (this._initialized) return;

    try {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      this._config = parse(raw);
    } catch (err) {
      console.warn('[AGENTFORGE-BRIDGE] Config not found — bridge disabled:', err.message);
      return;
    }

    // Load forwarded event types from contracts config
    try {
      const contractsRaw = readFileSync(CONTRACTS_PATH, 'utf8');
      const contracts = parse(contractsRaw);
      const outboundKeys = Object.keys(contracts.outbound || {});
      // Also include any internal event types listed in the bridge config
      const bridgeForwarded = this._config.forwarded_event_types || [];
      for (const t of [...outboundKeys, ...bridgeForwarded]) {
        this._forwardedTypes.add(t);
      }
    } catch (_err) {
      // Fall back to bridge config list only
      for (const t of (this._config.forwarded_event_types || [])) {
        this._forwardedTypes.add(t);
      }
    }

    this._initialized = true;

    const owlCfg = this._config.owlwatcher || {};
    const regCfg = this._config.registration || {};

    if (owlCfg.enabled) {
      this._connectOwlWatcher();
    }

    if (regCfg.enabled) {
      this._register();
    }

    console.log('[AGENTFORGE-BRIDGE] Initialized. OwlWatcher:', owlCfg.enabled ? 'enabled' : 'disabled',
      '| Registration:', regCfg.enabled ? 'enabled' : 'disabled');
  }

  shutdown() {
    if (!this._initialized) return;
    this._stopHeartbeat();
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._cbResetTimer) {
      clearTimeout(this._cbResetTimer);
      this._cbResetTimer = null;
    }
    if (this._ws) {
      this._ws.terminate();
      this._ws = null;
    }
    this._registered = false;
    console.log('[AGENTFORGE-BRIDGE] Shutdown complete.');
  }

  /**
   * Forward an event to OwlWatcher if the event type is in the contract list.
   * No-op when disabled or circuit is open.
   *
   * @param {string} type - Event type key (e.g. 'BRIGHTFORGE_PLAN_APPLIED')
   * @param {Object} payload
   */
  forwardEvent(type, payload) {
    if (!this._initialized) return;
    if (!this._config.owlwatcher?.enabled) return;
    if (!this._forwardedTypes.has(type)) return;
    if (this._cbState === CB_OPEN) return;

    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;

    try {
      const envelope = {
        source: this._config.node?.id || 'brightforge',
        type,
        payload,
        timestamp: new Date().toISOString()
      };
      this._ws.send(JSON.stringify(envelope));
      this._forwardedCount++;
      this._cbFailures = 0; // Reset on success
      telemetryBus.emit('forge3d', { event: 'agentforge_event_forwarded', type });
    } catch (err) {
      this._onForwardFailure(err, type);
    }
  }

  getStatus() {
    return {
      initialized: this._initialized,
      owlwatcherEnabled: this._config?.owlwatcher?.enabled || false,
      registrationEnabled: this._config?.registration?.enabled || false,
      owlwatcherConnected: this._ws?.readyState === WebSocket.OPEN,
      registered: this._registered,
      circuitState: this._cbState,
      forwardedCount: this._forwardedCount,
      reconnectAttempts: this._reconnectAttempts
    };
  }

  // ─── OwlWatcher WebSocket ─────────────────────────────────────────────────

  _connectOwlWatcher() {
    const owlCfg = this._config.owlwatcher;
    const url = this._resolveEnv(owlCfg.url);

    if (!url) {
      console.warn('[AGENTFORGE-BRIDGE] owlwatcher.url not set — skipping WS connection.');
      return;
    }

    try {
      this._ws = new WebSocket(url);

      this._ws.on('open', () => {
        console.log('[AGENTFORGE-BRIDGE] OwlWatcher connected:', url);
        this._reconnectAttempts = 0;
        this._cbState = CB_CLOSED;
        this._cbFailures = 0;
        telemetryBus.emit('forge3d', { event: 'agentforge_owlwatcher_connected' });
      });

      this._ws.on('close', () => {
        console.warn('[AGENTFORGE-BRIDGE] OwlWatcher disconnected.');
        this._ws = null;
        this._scheduleReconnect();
      });

      this._ws.on('error', (err) => {
        console.warn('[AGENTFORGE-BRIDGE] OwlWatcher WS error:', err.message);
        errorHandler.report('handoff_error', err, { source: 'owlwatcher_ws' });
      });

    } catch (err) {
      console.warn('[AGENTFORGE-BRIDGE] Failed to create WS:', err.message);
      errorHandler.report('handoff_error', err, { source: 'owlwatcher_connect' });
      this._scheduleReconnect();
    }
  }

  _scheduleReconnect() {
    const owlCfg = this._config.owlwatcher || {};
    const maxAttempts = owlCfg.max_reconnect_attempts || 10;
    if (this._reconnectAttempts >= maxAttempts) {
      console.warn('[AGENTFORGE-BRIDGE] Max reconnect attempts reached — giving up.');
      return;
    }
    const delay = owlCfg.reconnect_delay_ms || 5000;
    this._reconnectAttempts++;
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      this._connectOwlWatcher();
    }, delay);
  }

  // ─── Node Registration ────────────────────────────────────────────────────

  async _register() {
    const regCfg = this._config.registration || {};
    const url = this._resolveEnv(regCfg.supervisor_url);
    if (!url) {
      console.warn('[AGENTFORGE-BRIDGE] registration.supervisor_url not set — skipping registration.');
      return;
    }

    const token = process.env[regCfg.auth_token_env] || '';
    const nodeCfg = this._config.node || {};

    const body = JSON.stringify({
      id: nodeCfg.id,
      role: nodeCfg.role,
      secondary_roles: nodeCfg.secondary_roles || [],
      version: nodeCfg.version,
      capabilities: nodeCfg.capabilities || []
    });

    try {
      const res = await fetch(`${url}/nodes/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body,
        signal: AbortSignal.timeout(5000)
      });

      if (res.ok) {
        this._registered = true;
        console.log('[AGENTFORGE-BRIDGE] Node registered with SupervisorOrchestrator.');
        this._startHeartbeat();
        telemetryBus.emit('forge3d', { event: 'agentforge_node_registered', nodeId: nodeCfg.id });
      } else {
        console.warn('[AGENTFORGE-BRIDGE] Registration failed:', res.status);
      }
    } catch (err) {
      console.warn('[AGENTFORGE-BRIDGE] Registration error:', err.message);
      errorHandler.report('handoff_error', err, { source: 'node_registration' });
    }
  }

  _startHeartbeat() {
    const regCfg = this._config.registration || {};
    const interval = regCfg.heartbeat_interval_ms || 30000;
    this._heartbeatTimer = setInterval(() => this._sendHeartbeat(), interval);
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
  }

  async _sendHeartbeat() {
    const regCfg = this._config.registration || {};
    const url = this._resolveEnv(regCfg.supervisor_url);
    if (!url || !this._registered) return;

    const token = process.env[regCfg.auth_token_env] || '';
    const nodeId = this._config.node?.id || 'brightforge';

    try {
      await fetch(`${url}/nodes/${nodeId}/heartbeat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ timestamp: new Date().toISOString(), status: 'healthy' }),
        signal: AbortSignal.timeout(regCfg.heartbeat_timeout_ms || 5000)
      });
    } catch (_err) {
      // Heartbeat failures are non-fatal; supervisor will detect staleness
    }
  }

  // ─── Circuit Breaker ──────────────────────────────────────────────────────

  _onForwardFailure(err, type) {
    this._cbFailures++;
    const threshold = this._config.circuit_breaker?.failure_threshold || 5;

    if (this._cbFailures >= threshold && this._cbState === CB_CLOSED) {
      this._cbState = CB_OPEN;
      console.warn('[AGENTFORGE-BRIDGE] Circuit breaker OPEN after', this._cbFailures, 'failures.');
      errorHandler.report('handoff_error', err, { source: 'circuit_breaker', type });

      const resetMs = this._config.circuit_breaker?.reset_timeout_ms || 60000;
      this._cbResetTimer = setTimeout(() => {
        this._cbState = CB_HALF_OPEN;
        console.log('[AGENTFORGE-BRIDGE] Circuit breaker HALF_OPEN — probing.');
      }, resetMs);
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  _resolveEnv(value) {
    if (!value) return null;
    return value.replace(/\$\{([^}]+)\}/g, (_match, key) => process.env[key] || '');
  }
}

const agentforgeBridge = new AgentForgeBridge();
export default agentforgeBridge;
export { AgentForgeBridge };

// ─── Self-test ────────────────────────────────────────────────────────────

if (process.argv.includes('--test')) {
  console.log('[AGENTFORGE-BRIDGE] Running self-test...');

  // Test 1: init() with no config file (should not throw)
  const bridge = new AgentForgeBridge();
  bridge.init();
  console.log('[AGENTFORGE-BRIDGE] Test 1 PASS: init() with missing config is a no-op');

  // Test 2: forwardEvent no-op when not initialized
  let threw = false;
  try {
    bridge.forwardEvent('BRIGHTFORGE_PLAN_APPLIED', { task_id: 'test-123' });
  } catch (_err) {
    threw = true;
  }
  console.log(threw ? '[AGENTFORGE-BRIDGE] Test 2 FAIL' : '[AGENTFORGE-BRIDGE] Test 2 PASS: forwardEvent no-op when uninitialized');

  // Test 3: getStatus() structure
  const status = bridge.getStatus();
  const hasFields = ['initialized', 'owlwatcherConnected', 'registered', 'circuitState', 'forwardedCount']
    .every(k => k in status);
  console.log(hasFields ? '[AGENTFORGE-BRIDGE] Test 3 PASS: getStatus() has expected fields'
    : '[AGENTFORGE-BRIDGE] Test 3 FAIL: getStatus() missing fields');

  // Test 4: circuit breaker state machine
  const cbBridge = new AgentForgeBridge();
  cbBridge._initialized = true;
  cbBridge._config = { circuit_breaker: { failure_threshold: 2, reset_timeout_ms: 100 } };
  const fakeErr = new Error('WS send failed');
  cbBridge._onForwardFailure(fakeErr, 'TEST_EVENT');
  cbBridge._onForwardFailure(fakeErr, 'TEST_EVENT');
  const cbOpen = cbBridge._cbState === CB_OPEN;
  console.log(cbOpen ? '[AGENTFORGE-BRIDGE] Test 4 PASS: circuit breaker opens after threshold'
    : '[AGENTFORGE-BRIDGE] Test 4 FAIL: circuit breaker did not open');
  if (cbBridge._cbResetTimer) clearTimeout(cbBridge._cbResetTimer);

  console.log('[AGENTFORGE-BRIDGE] Self-test complete.');
  process.exit(0);
}
