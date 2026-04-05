/** Continuous Generation Loop Test
 *
 * 20-cycle sequential world generation test that exercises the full
 * generate_world pipeline. Self-contained: spawns its own Express server,
 * runs 20 cycles, validates lifecycle + DB sync + SSE events + cleanup,
 * tracks per-cycle metrics, detects memory leaks, and tears down.
 *
 * Usage: node src/forge3d/continuous-gen-test.js
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { createServer } from '../api/server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3899;
const API_BASE = `http://localhost:${PORT}/api`;
const WORLD_API = `${API_BASE}/world`;
const TOTAL_CYCLES = 20;
const POLL_TIMEOUT_MS = 60000;
const MEMORY_LEAK_THRESHOLD_MB = 50;

// Test header to bypass rate limiting (see rate-limit.js skip function)
const TEST_HEADERS = { 'X-BrightForge-Test': 'true' };

// Per-cycle metrics storage
const cycleMetrics = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(url, options = {}) {
  options.headers = { ...TEST_HEADERS, ...(options.headers || {}) };
  const response = await fetch(url, options);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const data = await response.json();
    return { response, data };
  }
  const text = await response.text();
  return { response, data: { raw: text } };
}

async function generateWorld(params) {
  const { response, data } = await fetchJson(`${WORLD_API}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return { response, data };
}

async function getWorldStatus(worldId) {
  return fetchJson(`${WORLD_API}/${worldId}`);
}

async function deleteWorld(worldId) {
  return fetchJson(`${WORLD_API}/${worldId}`, { method: 'DELETE' });
}

async function pollUntilDone(worldId, maxWaitMs = POLL_TIMEOUT_MS) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const { data } = await getWorldStatus(worldId);
    const status = data?.world?.status;
    if (status === 'complete' || status === 'failed') {
      return data;
    }
    await sleep(1000);
  }
  // Timeout - return last known state
  const { data } = await getWorldStatus(worldId);
  return data;
}

/**
 * Collect SSE events from a world's stream, with timeout.
 * Returns array of parsed event objects.
 */
async function collectSSEEvents(worldId, timeoutMs = 15000) {
  const events = [];
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${WORLD_API}/${worldId}/stream`, {
      signal: controller.signal,
      headers: { ...TEST_HEADERS, 'Accept': 'text/event-stream' }
    });

    if (!response.ok) {
      clearTimeout(timeoutId);
      return events;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let reading = true;

    while (reading) {
      const { done, value } = await reader.read();
      if (done) { reading = false; break; }

      buffer += decoder.decode(value, { stream: true });

      // Parse SSE data lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const parsed = JSON.parse(line.slice(6));
            events.push(parsed);
            if (parsed.done) {
              clearTimeout(timeoutId);
              controller.abort();
              return events;
            }
          } catch (_e) {
            // Skip non-JSON lines (keepalive comments)
          }
        }
      }
    }
  } catch (err) {
    if (err.name !== 'AbortError') {
      console.warn(`[CONTINUOUS] SSE collection error: ${err.message}`);
    }
  }

  clearTimeout(timeoutId);
  return events;
}

/**
 * Run a single generation cycle.
 * Returns { pass, status, dbStatus, duration, rssDelta, stageCount, error }
 */
async function runCycle(cycleNum) {
  const startRss = process.memoryUsage().rss;
  const startTime = Date.now();
  const prompt = `continuous test cycle ${cycleNum} ${Date.now()}`;

  let worldId = null;
  let pipelineId = null;
  let status = 'unknown';
  let dbStatus = 'unknown';
  let stageCount = 0;
  let pass = true;
  let error = null;

  try {
    // 1. Start generation
    const { response, data } = await generateWorld({
      prompt,
      worldSize: 'small'
    });

    if (response.status !== 202) {
      return {
        pass: false,
        status: 'start_failed',
        dbStatus: 'n/a',
        duration: Date.now() - startTime,
        rssDelta: 0,
        stageCount: 0,
        error: `Expected 202, got ${response.status}`
      };
    }

    worldId = data.worldId;
    pipelineId = data.pipelineId;

    // 2. Poll until done (max 60s)
    const finalData = await pollUntilDone(worldId, POLL_TIMEOUT_MS);
    status = finalData?.world?.status || 'unknown';
    dbStatus = status;

    // Count stages from pipeline status if available
    if (finalData?.pipelineStatus?.stages) {
      stageCount = finalData.pipelineStatus.stages.length;
    }

    // 3. Verify DB status is terminal
    if (status !== 'complete' && status !== 'failed') {
      pass = false;
      error = `Non-terminal DB status: ${status}`;
    }

    // 4. Verify SSE terminal event
    const events = await collectSSEEvents(worldId, 5000);
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (!lastEvent?.done) {
        pass = false;
        error = (error ? error + '; ' : '') + 'SSE final event missing done:true';
      }
    }
    // No events is acceptable (pipeline completed before SSE connect)

    // 5. Verify activePipelines cleanup (pipeline should be completed/failed)
    if (pipelineId) {
      const { data: statusCheck } = await getWorldStatus(worldId);
      const pipelineStatus = statusCheck?.pipelineStatus;
      if (pipelineStatus && pipelineStatus.status !== 'completed' && pipelineStatus.status !== 'failed') {
        pass = false;
        error = (error ? error + '; ' : '') + `Pipeline still active: ${pipelineStatus.status}`;
      }
    }

    // 6. Cleanup: delete the world
    if (worldId) {
      try {
        await deleteWorld(worldId);
      } catch (_e) {
        // Best effort cleanup
      }
    }
  } catch (err) {
    pass = false;
    error = err.message;

    // Attempt cleanup on error
    if (worldId) {
      try { await deleteWorld(worldId); } catch (_e) { /* best effort */ }
    }
  }

  const endRss = process.memoryUsage().rss;
  const duration = Date.now() - startTime;
  const rssDelta = (endRss - startRss) / (1024 * 1024);

  return { pass, status, dbStatus, duration, rssDelta, stageCount, error };
}

/**
 * Main test runner.
 */
async function runContinuousTest() {
  console.log('[CONTINUOUS] =============================================');
  console.log(`[CONTINUOUS] Continuous Generation Loop Test (${TOTAL_CYCLES} cycles)`);
  console.log('[CONTINUOUS] =============================================');
  console.log(`[CONTINUOUS] Target: ${API_BASE}`);
  console.log('');

  // Spawn self-contained server
  let server;
  try {
    const { app } = createServer();
    server = app.listen(PORT, () => {
      console.log(`[CONTINUOUS] Test server on port ${PORT}`);
    });

    // Wait for server to be ready
    await sleep(1000);
  } catch (err) {
    console.error(`[CONTINUOUS] Failed to start test server: ${err.message}`);
    process.exit(1);
  }

  // Pre-flight: health check
  try {
    const { response } = await fetchJson(`${API_BASE}/health`);
    if (!response.ok) {
      console.error('[CONTINUOUS] Server is not healthy. Aborting.');
      server.close();
      process.exit(1);
    }
    console.log('[CONTINUOUS] Server health OK');
  } catch (err) {
    console.error(`[CONTINUOUS] Cannot reach server at ${API_BASE}: ${err.message}`);
    server.close();
    process.exit(1);
  }

  console.log('');

  const rssStart = process.memoryUsage().rss / (1024 * 1024);
  const totalStart = Date.now();
  let passCount = 0;
  let failCount = 0;

  // Run 20 sequential cycles
  for (let i = 1; i <= TOTAL_CYCLES; i++) {
    const result = runCycle(i);
    const metrics = await result;
    cycleMetrics.push(metrics);

    if (metrics.pass) {
      passCount++;
    } else {
      failCount++;
    }

    const rssDeltaStr = metrics.rssDelta >= 0
      ? `+${metrics.rssDelta.toFixed(1)}MB`
      : `${metrics.rssDelta.toFixed(1)}MB`;

    const verdict = metrics.pass ? 'PASS' : 'FAIL';
    const errorStr = metrics.error ? ` | error: ${metrics.error}` : '';

    console.log(
      `[CONTINUOUS] CYCLE ${String(i).padStart(2)}/${TOTAL_CYCLES}`
      + ` | status: ${metrics.status}`
      + ` | db: ${metrics.dbStatus}`
      + ` | duration: ${metrics.duration}ms`
      + ` | rssDelta: ${rssDeltaStr}`
      + ` | ${verdict}${errorStr}`
    );

    // Brief pause between cycles to avoid hammering
    if (i < TOTAL_CYCLES) {
      await sleep(500);
    }
  }

  // Summary
  const totalDuration = (Date.now() - totalStart) / 1000;
  const avgDuration = Math.round(cycleMetrics.reduce((sum, m) => sum + m.duration, 0) / TOTAL_CYCLES);
  const rssEnd = process.memoryUsage().rss / (1024 * 1024);
  const rssTotalDelta = rssEnd - rssStart;
  const memoryLeakPass = rssTotalDelta < MEMORY_LEAK_THRESHOLD_MB;

  console.log('');
  console.log('[CONTINUOUS] =============================================');
  console.log(`[CONTINUOUS] SUMMARY: ${passCount}/${TOTAL_CYCLES} PASS`);
  console.log(`[CONTINUOUS] Total Duration: ${totalDuration.toFixed(1)}s`);
  console.log(`[CONTINUOUS] Avg Duration: ${avgDuration}ms`);
  console.log(
    `[CONTINUOUS] RSS Start: ${rssStart.toFixed(1)}MB`
    + ` | RSS End: ${rssEnd.toFixed(1)}MB`
    + ` | Delta: ${rssTotalDelta >= 0 ? '+' : ''}${rssTotalDelta.toFixed(1)}MB`
  );
  console.log(
    `[CONTINUOUS] Memory Leak Check: ${memoryLeakPass ? 'PASS' : 'FAIL'}`
    + ` (delta ${rssTotalDelta < 0 ? '' : '<'} ${MEMORY_LEAK_THRESHOLD_MB}MB threshold)`
  );
  console.log('[CONTINUOUS] =============================================');

  // Tear down server
  server.close();

  const allPassed = failCount === 0 && memoryLeakPass;
  process.exit(allPassed ? 0 : 1);
}

// Entry
runContinuousTest();
