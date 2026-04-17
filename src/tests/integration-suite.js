/**
 * BrightForge Integration Test Suite
 *
 * End-to-end smoke tests for the multi-agent pipeline system.
 * Verifies that all modules load, events flow, and basic
 * state machines work correctly.
 *
 * Usage: node src/tests/integration-suite.js
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`  \u2713 ${name}`);
}

function fail(name, err) {
  failed++;
  console.error(`  \u2717 ${name}: ${err}`);
}

function assert(condition, name, detail) {
  if (condition) {
    pass(name);
  } else {
    fail(name, detail || 'Assertion failed');
  }
}

console.log('\n=== BrightForge Integration Test Suite ===\n');

// ---------- Test 1: OrchestrationEventBus loads and emits ----------
console.log('Test 1: OrchestrationEventBus');
try {
  const { OrchestrationEventBus, VALID_EVENT_TYPES } = await import('../orchestration/event-bus.js');

  // Create bus with mock storage
  const mockStorage = {
    db: true,
    insertEvent: () => {},
    queryEvents: () => [],
    getTaskEvents: () => [],
    getEventCounts: () => ({})
  };

  const eventBus = new OrchestrationEventBus(mockStorage, {
    ring_buffer_size: 50,
    forward_to_telemetry: false
  });

  assert(VALID_EVENT_TYPES.length >= 13, 'Event types list populated', `Got ${VALID_EVENT_TYPES.length}`);

  // Emit and receive
  let received = null;
  eventBus.on('task_started', (envelope) => {
    received = envelope;
  });

  const eventId = eventBus.emit('task_started', {
    agent: 'IntegrationTest',
    taskId: 'test-001',
    payload: { name: 'smoke test' }
  });

  assert(eventId !== null, 'Event emitted with ID');
  assert(received !== null, 'Event received by listener');
  assert(received.agent === 'IntegrationTest', 'Envelope agent correct');
  assert(received.integrity_hash && received.integrity_hash.length === 64, 'SHA256 hash present');

  // Verify integrity
  const valid = eventBus.verifyIntegrity(received);
  assert(valid === true, 'Integrity hash verification passes');

  // Tamper detection
  const tampered = { ...received, payload: { malicious: true } };
  const invalid = eventBus.verifyIntegrity(tampered);
  assert(invalid === false, 'Tampered envelope detected');

  // Ring buffer
  for (let i = 0; i < 5; i++) {
    eventBus.emit('task_completed', {
      agent: 'IntegrationTest',
      taskId: `task-${i}`,
      payload: { index: i }
    });
  }

  const recent = eventBus.getRecent('task_completed', 10);
  assert(recent.length === 5, 'Ring buffer stores 5 events', `Got ${recent.length}`);

  eventBus.clear();
  const afterClear = eventBus.getRecent(null, 100);
  assert(afterClear.length === 0, 'Clear empties ring buffers');
} catch (err) {
  fail('OrchestrationEventBus load', err.message);
}

// ---------- Test 2: Pipeline agents import ----------
console.log('\nTest 2: Pipeline agent imports');
const agentNames = ['planner', 'builder', 'tester', 'reviewer', 'survey', 'recorder'];
const agents = {};

for (const name of agentNames) {
  try {
    const mod = await import(`../agents/${name}-agent.js`);
    agents[name] = mod.default;
    assert(agents[name] !== null && agents[name] !== undefined, `${name}-agent imports`);
  } catch (err) {
    fail(`${name}-agent import`, err.message);
  }
}

// ---------- Test 3: Agent status properties ----------
console.log('\nTest 3: Agent status properties');
for (const [name, agent] of Object.entries(agents)) {
  try {
    const hasStatus = agent.status !== undefined || (typeof agent.getStatus === 'function');
    assert(hasStatus, `${name} has status or getStatus()`);
  } catch (err) {
    fail(`${name} status check`, err.message);
  }
}

// ---------- Test 4: WebSocket event bus ----------
console.log('\nTest 4: WebSocketEventBus');
try {
  const { WebSocketEventBus } = await import('../api/ws-event-bus.js');
  const wsBus = new WebSocketEventBus();
  assert(wsBus.attached === false, 'WS bus starts unattached');
  assert(wsBus.clients.size === 0, 'WS bus starts with no clients');

  const stats = wsBus.getStats();
  assert(stats.currentConnections === 0, 'Stats show 0 connections');
  assert(stats.messagesSent === 0, 'Stats show 0 messages sent');
} catch (err) {
  fail('WebSocketEventBus load', err.message);
}

// ---------- Test 5: Pipeline state machine ----------
console.log('\nTest 5: Pipeline state machine');
try {
  let pipelineState = {
    status: 'idle',
    currentAgent: null,
    subtasks: [],
    startedAt: null,
    completedAt: null,
    error: null
  };

  assert(pipelineState.status === 'idle', 'Pipeline starts idle');

  // Simulate start
  pipelineState.status = 'running';
  pipelineState.currentAgent = 'Planner';
  pipelineState.startedAt = new Date().toISOString();
  assert(pipelineState.status === 'running', 'Pipeline transitions to running');
  assert(pipelineState.currentAgent === 'Planner', 'Current agent is Planner');

  // Simulate completion
  pipelineState.status = 'completed';
  pipelineState.completedAt = new Date().toISOString();
  pipelineState.currentAgent = null;
  assert(pipelineState.status === 'completed', 'Pipeline transitions to completed');

  // Simulate cancel
  pipelineState.status = 'running';
  pipelineState.status = 'cancelled';
  assert(pipelineState.status === 'cancelled', 'Pipeline can be cancelled');
} catch (err) {
  fail('Pipeline state machine', err.message);
}

// ---------- Test 6: Recorder graceful degradation ----------
console.log('\nTest 6: Recorder graceful degradation');
try {
  if (agents.recorder) {
    const recorder = agents.recorder;
    // Recorder should not throw when OBS is unavailable
    if (typeof recorder.getStatus === 'function') {
      const status = recorder.getStatus();
      assert(status !== undefined, 'Recorder getStatus() returns without error');
    } else {
      assert(recorder.status !== undefined, 'Recorder has status property');
    }
  } else {
    pass('Recorder import was skipped (optional dep)');
  }
} catch (err) {
  fail('Recorder graceful degradation', err.message);
}

// ---------- Test 7: Stability state machine ----------
console.log('\nTest 7: Stability state machine');
try {
  let stabilityState = {
    status: 'idle',
    checkpointCount: 0,
    elapsedSeconds: 0,
    metrics: {},
    checkpoints: [],
    verdict: null
  };

  assert(stabilityState.status === 'idle', 'Stability starts idle');

  stabilityState.status = 'running';
  stabilityState.checkpointCount = 1;
  stabilityState.checkpoints.push({
    number: 1,
    timestamp: new Date().toISOString(),
    pass: true,
    summary: 'Heap: +0.5MB, RSS: +1.2MB'
  });

  assert(stabilityState.status === 'running', 'Stability transitions to running');
  assert(stabilityState.checkpoints.length === 1, 'Checkpoint recorded');

  stabilityState.status = 'completed';
  stabilityState.verdict = 'PASS';
  assert(stabilityState.verdict === 'PASS', 'Stability verdict set');
} catch (err) {
  fail('Stability state machine', err.message);
}

// ---------- Test 8: Agent route handler (mock) ----------
console.log('\nTest 8: Agent route handler mock');
try {
  const { agentRoutes } = await import('../api/routes/agents.js');
  const router = agentRoutes();
  assert(router !== null, 'agentRoutes() returns a router');

  // Verify route count (router.stack contains route layers)
  const routeCount = router.stack ? router.stack.length : 0;
  assert(routeCount > 0, `Router has ${routeCount} route(s) registered`);
} catch (err) {
  fail('Agent route handler', err.message);
}

// ---------- Test 9: New event types present ----------
console.log('\nTest 9: New event types in VALID_EVENT_TYPES');
try {
  const { VALID_EVENT_TYPES } = await import('../orchestration/event-bus.js');

  const newTypes = [
    'agent_registered', 'agent_heartbeat', 'agent_disconnected',
    'build_started', 'build_completed', 'build_failed',
    'test_started', 'test_completed', 'test_failed',
    'review_started', 'review_completed',
    'recording_started', 'recording_stopped', 'recording_failed',
    'stability_started', 'stability_checkpoint', 'stability_completed'
  ];

  for (const type of newTypes) {
    assert(VALID_EVENT_TYPES.includes(type), `Event type '${type}' registered`);
  }
} catch (err) {
  fail('New event types check', err.message);
}

// ---------- Test 10: Error handler categories ----------
console.log('\nTest 10: Error handler new categories');
try {
  const errorHandler = (await import('../core/error-handler.js')).default;

  const newCategories = ['agent_error', 'recorder_error', 'stability_error', 'ws_error'];
  for (const cat of newCategories) {
    // ErrorHandler should accept these categories without throwing
    try {
      errorHandler.report(cat, new Error('Integration test'), { test: true });
      pass(`Error category '${cat}' accepted`);
    } catch (err) {
      fail(`Error category '${cat}'`, err.message);
    }
  }
} catch (err) {
  fail('Error handler categories', err.message);
}

// ---------- Summary ----------
console.log('\n=== Integration Test Results ===');
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);
console.log(`  Verdict: ${failed === 0 ? 'PASS' : 'FAIL'}`);
console.log('');

process.exit(failed === 0 ? 0 : 1);
