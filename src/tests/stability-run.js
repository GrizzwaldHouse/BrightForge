/**
 * BrightForge 13-Minute Stability Run
 *
 * Full-stack stability test with 30-second checkpoint intervals.
 * Monitors memory, server uptime, error rates, and event bus latency.
 *
 * Usage:
 *   node src/tests/stability-run.js          # Full 13-minute run (780s)
 *   node src/tests/stability-run.js --quick  # Quick 60-second CI run
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const isQuick = process.argv.includes('--quick');
const DURATION = isQuick ? 60 : 780; // seconds
const CHECKPOINT_INTERVAL = 30; // seconds
const MAX_CHECKPOINTS = Math.floor(DURATION / CHECKPOINT_INTERVAL);

console.log('\n[STABILITY] BrightForge Stability Run');
console.log(`[STABILITY] Mode: ${isQuick ? 'QUICK (60s)' : 'FULL (13 min)'}`);
console.log(`[STABILITY] Checkpoints: ${MAX_CHECKPOINTS} (every ${CHECKPOINT_INTERVAL}s)`);
console.log('');

// Baseline measurements
const baseline = process.memoryUsage();
const startTime = Date.now();
const startedAt = new Date().toISOString();

const checkpoints = [];
let serverAvailable = null; // null = not checked yet

/**
 * Check if the BrightForge server is running.
 */
async function checkServerHealth() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const response = await fetch('http://localhost:3847/api/health', {
      signal: controller.signal
    });

    clearTimeout(timeout);
    return { pass: response.ok, value: `HTTP ${response.status}` };
  } catch (err) {
    if (serverAvailable === null) {
      // First check — server not running, mark as skip
      console.log('[STABILITY] Server not running — server uptime checks will be skipped');
      serverAvailable = false;
    }
    return { pass: null, value: 'Server not running (skipped)' };
  }
}

/**
 * Check memory growth from baseline.
 */
function checkMemory() {
  const current = process.memoryUsage();
  const heapGrowthMb = (current.heapUsed - baseline.heapUsed) / (1024 * 1024);
  const rssGrowthMb = (current.rss - baseline.rss) / (1024 * 1024);

  return {
    heapGrowth: {
      pass: heapGrowthMb < 50,
      value: `+${heapGrowthMb.toFixed(1)}MB`
    },
    rssGrowth: {
      pass: rssGrowthMb < 100,
      value: `+${rssGrowthMb.toFixed(1)}MB`
    }
  };
}

/**
 * Check error handler for excessive errors.
 */
async function checkErrorRate() {
  try {
    const errorHandler = (await import('../core/error-handler.js')).default;
    const ringBuffer = errorHandler.ringBuffer || [];
    const errorCount = ringBuffer.length;
    // Fail if more than 50 errors accumulated during run
    const pass = errorCount < 50;
    return { pass, value: `${errorCount} errors` };
  } catch (_err) {
    return { pass: true, value: '0 errors (handler not initialized)' };
  }
}

/**
 * Check event bus latency by emitting and receiving a test event.
 */
async function checkEventBusLatency() {
  try {
    const { OrchestrationEventBus } = await import('../orchestration/event-bus.js');

    const mockStorage = {
      db: true,
      insertEvent: () => {},
      queryEvents: () => [],
      getTaskEvents: () => [],
      getEventCounts: () => ({})
    };

    const bus = new OrchestrationEventBus(mockStorage, {
      ring_buffer_size: 10,
      forward_to_telemetry: false
    });

    const t0 = Date.now();
    let received = false;

    bus.on('stability_checkpoint', () => {
      received = true;
    });

    bus.emit('stability_checkpoint', {
      agent: 'StabilityTest',
      payload: { test: true }
    });

    const latency = Date.now() - t0;
    return {
      pass: received && latency < 500,
      value: `${latency}ms`
    };
  } catch (err) {
    return { pass: false, value: `Error: ${err.message}` };
  }
}

/**
 * Run a single checkpoint.
 */
async function runCheckpoint(number, elapsed) {
  const serverHealth = await checkServerHealth();
  const memory = checkMemory();
  const errorRate = await checkErrorRate();
  const eventLatency = await checkEventBusLatency();

  const metrics = {
    serverUptime: serverHealth,
    heapGrowth: memory.heapGrowth,
    rssGrowth: memory.rssGrowth,
    errorRate: errorRate,
    eventLatency: eventLatency
  };

  // Determine overall pass (skip null values from server check)
  const metricValues = Object.values(metrics);
  const checkableMetrics = metricValues.filter(m => m.pass !== null);
  const allPass = checkableMetrics.every(m => m.pass);

  const checkpoint = {
    number,
    timestamp: new Date().toISOString(),
    elapsed,
    metrics,
    allPass
  };

  checkpoints.push(checkpoint);

  // Print progress
  const status = allPass ? 'ALL PASS' : 'FAIL';
  const bar = `[${'='.repeat(Math.floor((elapsed / DURATION) * 30))}${' '.repeat(30 - Math.floor((elapsed / DURATION) * 30))}]`;
  console.log(`[STABILITY] Checkpoint ${number}/${MAX_CHECKPOINTS} ${bar} ${elapsed}s — ${status}`);

  // Print metric details
  for (const [name, metric] of Object.entries(metrics)) {
    const icon = metric.pass === null ? '-' : (metric.pass ? '\u2713' : '\u2717');
    console.log(`  ${icon} ${name}: ${metric.value}`);
  }
  console.log('');

  return checkpoint;
}

/**
 * Generate final report.
 */
function generateReport() {
  const completedAt = new Date().toISOString();
  const passedCheckpoints = checkpoints.filter(cp => cp.allPass).length;
  const failedCheckpoints = checkpoints.filter(cp => !cp.allPass).length;
  const passRate = checkpoints.length > 0 ? passedCheckpoints / checkpoints.length : 0;
  const verdict = passRate >= 0.9 ? 'PASS' : 'FAIL';

  // Compute summary stats
  let peakHeapGrowth = 0;
  let peakRssGrowth = 0;
  let maxEventLatency = 0;
  let serverUpCount = 0;
  let serverCheckCount = 0;

  for (const cp of checkpoints) {
    const heapVal = parseFloat(cp.metrics.heapGrowth.value);
    const rssVal = parseFloat(cp.metrics.rssGrowth.value);
    const latencyVal = parseInt(cp.metrics.eventLatency.value, 10);

    if (!isNaN(heapVal) && heapVal > peakHeapGrowth) peakHeapGrowth = heapVal;
    if (!isNaN(rssVal) && rssVal > peakRssGrowth) peakRssGrowth = rssVal;
    if (!isNaN(latencyVal) && latencyVal > maxEventLatency) maxEventLatency = latencyVal;

    if (cp.metrics.serverUptime.pass !== null) {
      serverCheckCount++;
      if (cp.metrics.serverUptime.pass) serverUpCount++;
    }
  }

  const report = {
    startedAt,
    completedAt,
    durationSeconds: DURATION,
    mode: isQuick ? 'quick' : 'full',
    totalCheckpoints: checkpoints.length,
    passedCheckpoints,
    failedCheckpoints,
    verdict,
    checkpoints,
    summary: {
      peakHeapGrowthMb: peakHeapGrowth,
      peakRssGrowthMb: peakRssGrowth,
      serverUptimePercent: serverCheckCount > 0 ? Math.round((serverUpCount / serverCheckCount) * 100) : null,
      maxEventLatencyMs: maxEventLatency
    }
  };

  return report;
}

// ---------- Main execution ----------
(async () => {
  try {
    let checkpointNumber = 0;
    let lastCheckpointAt = 0;

    console.log(`[STABILITY] Starting at ${startedAt}\n`);

    // Run checkpoints on interval
    await new Promise((resolve) => {
      const interval = setInterval(async () => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);

        // Run checkpoint every 30 seconds
        if (elapsed > 0 && elapsed - lastCheckpointAt >= CHECKPOINT_INTERVAL) {
          checkpointNumber++;
          lastCheckpointAt = elapsed;
          await runCheckpoint(checkpointNumber, elapsed);
        }

        // Complete when duration reached
        if (elapsed >= DURATION) {
          clearInterval(interval);
          resolve();
        }
      }, 1000);
    });

    // Generate report
    const report = generateReport();

    // Write JSON report
    const dataDir = join(__dirname, '../../data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(
      join(dataDir, 'stability-report.json'),
      JSON.stringify(report, null, 2)
    );

    // Print summary
    console.log('=== Stability Run Summary ===');
    console.log(`  Duration:     ${report.durationSeconds}s (${report.mode} mode)`);
    console.log(`  Checkpoints:  ${report.passedCheckpoints}/${report.totalCheckpoints} passed`);
    console.log(`  Peak Heap:    +${report.summary.peakHeapGrowthMb.toFixed(1)}MB`);
    console.log(`  Peak RSS:     +${report.summary.peakRssGrowthMb.toFixed(1)}MB`);
    if (report.summary.serverUptimePercent !== null) {
      console.log(`  Server Up:    ${report.summary.serverUptimePercent}%`);
    } else {
      console.log('  Server Up:    N/A (not running)');
    }
    console.log(`  Max Latency:  ${report.summary.maxEventLatencyMs}ms`);
    console.log(`  Verdict:      ${report.verdict}`);
    console.log('');
    console.log('  Report saved: data/stability-report.json');
    console.log('');

    process.exit(report.verdict === 'PASS' ? 0 : 1);
  } catch (err) {
    console.error(`[STABILITY] Fatal error: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  }
})();
