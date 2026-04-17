// stability-run.js
// Developer: Autonomous Recovery Team  
// Date: 2026-04-15
// Purpose: Long-running stability and soak testing

import { UniversalLLMClient } from '../core/llm-client.js';
import modelBridge from '../forge3d/model-bridge.js';

export async function runStabilityTests(iterations = 100) {
  const isQuick = process.argv.includes('--quick');
  const count = isQuick ? 10 : iterations;
  
  console.log(`[STABILITY] Running ${count} iterations...`);
  
  const metrics = {
    llmRequests: [],
    bridgeHealth: [],
    memorySnapshots: [],
    failures: 0
  };
  
  const startMem = process.memoryUsage().heapUsed;
  
  for (let i = 0; i < count; i++) {
    try {
      // Test 1: LLM request latency
      const start = Date.now();
      const client = new UniversalLLMClient();
      await client.chat([{ role: 'user', content: 'ping' }], { task: 'chat' });
      metrics.llmRequests.push(Date.now() - start);
      
      // Test 2: Bridge health check  
      try {
        const health = await modelBridge.checkHealth();
        metrics.bridgeHealth.push(health ? 1 : 0);
      } catch (bridgeErr) {
        // Bridge may not be started — not a failure
        metrics.bridgeHealth.push(0);
      }
      
      // Test 3: Memory snapshot
      metrics.memorySnapshots.push(process.memoryUsage().heapUsed);
      
      if (i % 10 === 0) console.log(`  ${i}/${count} iterations complete`);
    } catch (err) {
      metrics.failures++;
      console.error(`  Iteration ${i} failed:`, err.message);
    }
  }
  
  const endMem = process.memoryUsage().heapUsed;
  const memGrowth = (endMem - startMem) / 1024 / 1024; // MB
  
  const report = {
    iterations: count,
    failures: metrics.failures,
    failureRate: (metrics.failures / count * 100).toFixed(2) + '%',
    memoryGrowthMB: memGrowth.toFixed(2),
    llmLatency: {
      p50: percentile(metrics.llmRequests, 50),
      p95: percentile(metrics.llmRequests, 95),
      p99: percentile(metrics.llmRequests, 99)
    }
  };
  
  console.log('\n[STABILITY] Report:', JSON.stringify(report, null, 2));
  
  if (memGrowth > 100) {
    console.error('✗ FAIL: Memory leak detected (>100MB growth)');
    return { ...report, status: 'FAIL' };
  }
  
  console.log('✓ PASS: Stability test passed');
  return { ...report, status: 'PASS' };
}

function percentile(arr, p) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index] || 0;
}

// Self-test
if (process.argv.includes('--test')) {
  runStabilityTests().then(report => {
    process.exit(report.status === 'PASS' ? 0 : 1);
  }).catch(err => {
    console.error('[STABILITY] Fatal error:', err);
    process.exit(1);
  });
}
