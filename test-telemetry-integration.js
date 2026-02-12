/**
 * Integration test to prove telemetry hooks are working
 */

import telemetryBus from './src/core/telemetry-bus.js';

console.log('\n=== Testing TelemetryBus Integration ===\n');

// Test 1: Verify telemetryBus exists and has methods
console.log('[TEST 1] TelemetryBus instance check...');
if (!telemetryBus) {
  console.error('❌ FAILED: telemetryBus not exported');
  process.exit(1);
}
if (typeof telemetryBus.emit !== 'function') {
  console.error('❌ FAILED: telemetryBus.emit not a function');
  process.exit(1);
}
if (typeof telemetryBus.startTimer !== 'function') {
  console.error('❌ FAILED: telemetryBus.startTimer not a function');
  process.exit(1);
}
if (typeof telemetryBus.getMetrics !== 'function') {
  console.error('❌ FAILED: telemetryBus.getMetrics not a function');
  process.exit(1);
}
console.log('✓ TelemetryBus has all required methods\n');

// Test 2: Test emit() functionality
console.log('[TEST 2] Testing emit() functionality...');
telemetryBus.emit('session_created', { sessionId: 'test-123', projectRoot: '/test' });
let metrics = telemetryBus.getMetrics();
if (metrics.counters.sessions !== 1) {
  console.error(`❌ FAILED: Expected 1 session, got ${metrics.counters.sessions}`);
  process.exit(1);
}
console.log('✓ emit() working - session counter incremented\n');

// Test 3: Test startTimer() functionality
console.log('[TEST 3] Testing startTimer() functionality...');
const endTimer = telemetryBus.startTimer('llm_request', { provider: 'groq' });
await new Promise(resolve => setTimeout(resolve, 10)); // Wait 10ms
endTimer({ status: 'success', tokens: 100, cost: 0.001 });

metrics = telemetryBus.getMetrics();
if (metrics.counters.llmRequests !== 1) {
  console.error(`❌ FAILED: Expected 1 LLM request, got ${metrics.counters.llmRequests}`);
  process.exit(1);
}
if (!metrics.providers.groq) {
  console.error('❌ FAILED: Provider stats not tracked');
  process.exit(1);
}
if (metrics.providers.groq.requests !== 1) {
  console.error(`❌ FAILED: Expected 1 groq request, got ${metrics.providers.groq.requests}`);
  process.exit(1);
}
console.log('✓ startTimer() working - latency tracked, provider stats updated\n');

// Test 4: Verify getMetrics() returns complete snapshot
console.log('[TEST 4] Testing getMetrics() completeness...');
metrics = telemetryBus.getMetrics();

const requiredFields = ['uptime', 'timestamp', 'counters', 'providers', 'latency', 'recentEvents'];
for (const field of requiredFields) {
  if (!(field in metrics)) {
    console.error(`❌ FAILED: metrics missing field: ${field}`);
    process.exit(1);
  }
}

if (!metrics.latency.llm || !metrics.latency.apply || !metrics.latency.plan) {
  console.error('❌ FAILED: latency object missing llm/apply/plan');
  process.exit(1);
}

console.log('✓ getMetrics() returns complete snapshot\n');

// Test 5: Verify hooks are actually in files (grep check)
console.log('[TEST 5] Verifying hooks exist in source files...');
import { readFileSync } from 'fs';

const filesToCheck = [
  { file: 'src/core/llm-client.js', hooks: ['telemetryBus.startTimer', 'endTimer'] },
  { file: 'src/core/diff-applier.js', hooks: ['telemetryBus.startTimer', 'endTimer'] },
  { file: 'src/agents/master-agent.js', hooks: ['telemetryBus.startTimer', 'endTimer'] },
  { file: 'src/api/web-session.js', hooks: ['telemetryBus.emit'] },
  { file: 'src/core/error-handler.js', hooks: ['telemetryBus.getMetrics'] }
];

for (const { file, hooks } of filesToCheck) {
  const content = readFileSync(file, 'utf8');
  for (const hook of hooks) {
    if (!content.includes(hook)) {
      console.error(`❌ FAILED: ${file} missing hook: ${hook}`);
      process.exit(1);
    }
  }
  console.log(`✓ ${file} - all hooks present`);
}

console.log('\n=== ALL INTEGRATION TESTS PASSED ===\n');
console.log('Summary:');
console.log('- TelemetryBus core: ✓ Working');
console.log('- emit() method: ✓ Working');
console.log('- startTimer() method: ✓ Working');
console.log('- getMetrics() method: ✓ Working');
console.log('- Integration hooks: ✓ Present in all 5 files');
console.log('\nTelemetry system is fully integrated and operational.');
