// user-load-test.js
// Developer: Marcus Daley
// Date: 2026-04-16
// Purpose: Multi-user load test that simulates realistic BrightForge user sessions concurrently.
//   Covers: health check, WebSocket connect, chat turn + SSE stream, memory read/write,
//   project memory, agent list, forge3d queue, skills, metrics, cost, design, pipeline detect.
//   Run: node src/tests/user-load-test.js [--users N] [--delay MS] [--verbose] [--scenario SCENARIO]
//   Scenarios: smoke (3u/30s), load (20u/2min), stress (50u/2min), soak (10u/5min), massive (1000u/5min)
//
//   Concurrency model:
//   - Users are launched in waves (default: 50 per wave, 200ms between waves)
//   - A semaphore limits max concurrent in-flight sessions (default: 50)
//   - 429 rate-limit responses are recorded as data, not errors — they show the server ceiling
//   - Live progress ticker updates every 2 seconds

import http from 'http';
import https from 'https';
import { WebSocket } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { writeFileSync, mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'http://localhost:3847';
const DEFAULT_WS_URL = 'ws://localhost:3847/ws/events';
const DEFAULT_PROJECT_PATH = join(__dirname, '..', '..', 'examples', 'hello-world').replace(/\\/g, '/');

// ─── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
};
const hasFlag = (flag) => args.includes(flag);

const SCENARIO = getArg('--scenario', 'smoke');
const BASE_URL = getArg('--url', DEFAULT_BASE_URL);
const WS_URL = getArg('--ws', DEFAULT_WS_URL);
const VERBOSE = hasFlag('--verbose');

// Scenario configs
// waveSize: users launched per wave | waveDelayMs: ms between waves | concurrency: max simultaneous
const SCENARIOS = {
  smoke:   { users: 3,    waveSize: 3,   waveDelayMs: 500,  durationMs: 30_000,   concurrency: 3,   label: 'Smoke   (3 users / 30s)' },
  load:    { users: 20,   waveSize: 10,  waveDelayMs: 200,  durationMs: 120_000,  concurrency: 20,  label: 'Load    (20 users / 2min)' },
  stress:  { users: 50,   waveSize: 10,  waveDelayMs: 200,  durationMs: 120_000,  concurrency: 50,  label: 'Stress  (50 users / 2min)' },
  soak:    { users: 10,   waveSize: 5,   waveDelayMs: 500,  durationMs: 300_000,  concurrency: 10,  label: 'Soak    (10 users / 5min)' },
  massive: { users: 1000, waveSize: 50,  waveDelayMs: 200,  durationMs: 300_000,  concurrency: 50,  label: 'Massive (1000 users / 5min)' }
};

const scenarioCfg = SCENARIOS[SCENARIO] || SCENARIOS.smoke;
const USER_COUNT   = parseInt(getArg('--users',      String(scenarioCfg.users)), 10);
const DELAY_MS     = parseInt(getArg('--delay',      String(scenarioCfg.waveDelayMs)), 10);
const DURATION_MS  = parseInt(getArg('--duration',   String(scenarioCfg.durationMs)), 10);
const CONCURRENCY  = parseInt(getArg('--concurrency', String(scenarioCfg.concurrency)), 10);
const WAVE_SIZE    = parseInt(getArg('--wave-size',   String(scenarioCfg.waveSize)), 10);

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

// Make a JSON HTTP request, returns {status, body, ms}
function httpRequest(method, url, body = null, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const options = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {})
      }
    };

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const ms = Date.now() - start;
        let json = null;
        try { json = JSON.parse(data); } catch (_e) { json = data; }
        resolve({ status: res.statusCode, body: json, ms });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout after ${timeoutMs}ms: ${method} ${url}`));
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// Read SSE stream until 'complete', 'failed', or 'cancelled' event, or timeout
function readSseStream(sessionId, timeoutMs = 45_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const url = `${BASE_URL}/api/chat/stream/${sessionId}`;
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const events = [];
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      resolve({ events, ms: Date.now() - start, ...result });
    };

    const req = lib.request({
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname,
      method: 'GET',
      headers: { Accept: 'text/event-stream' }
    }, (res) => {
      // SSE parser — handles multi-line event blocks (event: / data: pairs)
      // BrightForge sends:  event: complete\ndata: {...}\n\n
      let buf = '';
      let currentEventType = null;

      const parseBuffer = (flush = false) => {
        const lines = buf.split('\n');
        // Keep last incomplete line unless flushing
        buf = flush ? '' : (lines.pop() || '');

        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (trimmed.startsWith('event: ')) {
            currentEventType = trimmed.slice(7).trim();
          } else if (trimmed.startsWith('data: ')) {
            try {
              const payload = JSON.parse(trimmed.slice(6));
              // Merge SSE event type into payload for uniform handling
              const evt = { ...payload, _sseType: currentEventType || payload.type };
              events.push(evt);
              currentEventType = null;
              // Terminal events: SSE type OR status field OR type field
              const terminal = evt._sseType || evt.type || evt.status;
              if (['complete', 'failed', 'cancelled', 'pending_approval', 'no_changes'].includes(terminal)) {
                req.destroy();
                const success = ['complete', 'pending_approval', 'no_changes'].includes(terminal);
                finish({ finalEvent: terminal, success });
              }
            } catch (_e) { /* non-JSON data line */ }
          }
        }
      };

      res.on('data', (chunk) => {
        buf += chunk.toString();
        parseBuffer(false);
      });
      res.on('end', () => {
        parseBuffer(true);
        // After full flush, check if a terminal event arrived
        const terminalEvt = events.find((e) => {
          const t = e._sseType || e.type || e.status;
          return ['complete', 'failed', 'cancelled', 'pending_approval', 'no_changes'].includes(t);
        });
        if (terminalEvt) {
          const t = terminalEvt._sseType || terminalEvt.type || terminalEvt.status;
          finish({ finalEvent: t, success: ['complete', 'pending_approval', 'no_changes'].includes(t) });
        } else {
          finish({ finalEvent: 'stream_end', success: false });
        }
      });
      res.on('error', (e) => finish({ finalEvent: 'stream_error', success: false, error: e.message }));
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      finish({ finalEvent: 'timeout', success: false });
    });

    req.on('error', (e) => finish({ finalEvent: 'request_error', success: false, error: e.message }));
    req.end();
  });
}

// ─── Semaphore (concurrency limiter) ─────────────────────────────────────────

// Limits max simultaneous in-flight user sessions to avoid OOM and thundering herd
class Semaphore {
  constructor(maxConcurrent) {
    this._max = maxConcurrent;
    this._count = 0;
    this._queue = [];
  }

  acquire() {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (this._count < this._max) {
          this._count++;
          resolve();
        } else {
          this._queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }

  release() {
    this._count--;
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      next();
    }
  }

  get active() { return this._count; }
  get waiting() { return this._queue.length; }
}

// ─── Metrics collector ────────────────────────────────────────────────────────

class Metrics {
  constructor() {
    this.results = [];
    this.errors = [];
    this.rateLimited = 0;   // count of 429 responses
    this.completed = 0;     // users fully finished
    this.startTime = Date.now();
  }

  record(step, userId, ms, status, ok, detail = '') {
    if (status === 429) this.rateLimited++;
    this.results.push({ step, userId, ms, status, ok, detail, ts: Date.now() });
    if (VERBOSE) {
      const icon = ok ? '✓' : '✗';
      const tag = status === 429 ? ' [RATE LIMITED]' : '';
      process.stdout.write(`\n  [U${String(userId).padStart(4,'0')}] ${icon} ${step} ${ms}ms (${status})${tag} ${detail}`);
    }
  }

  error(step, userId, message) {
    this.errors.push({ step, userId, message, ts: Date.now() });
    if (VERBOSE) {
      process.stdout.write(`\n  [U${String(userId).padStart(4,'0')}] ERR ${step}: ${message}`);
    }
  }

  finishUser() { this.completed++; }

  // Live progress line — printed on a ticker
  progressLine(active, waiting, total) {
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(0);
    const totalR = this.results.length;
    const passes = this.results.filter((r) => r.ok).length;
    const rate = totalR > 0 ? Math.round((passes / totalR) * 100) : 0;
    const rps = totalR > 0 ? (totalR / Math.max(1, (Date.now() - this.startTime) / 1000)).toFixed(1) : 0;
    return `  [${elapsed}s] done=${this.completed}/${total} active=${active} queued=${waiting} ` +
           `steps=${totalR} pass=${rate}% rps=${rps} 429s=${this.rateLimited}`;
  }

  summary() {
    const byStep = {};
    for (const r of this.results) {
      if (!byStep[r.step]) byStep[r.step] = { count: 0, pass: 0, fail: 0, times: [], rateLimited: 0 };
      byStep[r.step].count++;
      r.ok ? byStep[r.step].pass++ : byStep[r.step].fail++;
      byStep[r.step].times.push(r.ms);
      if (r.status === 429) byStep[r.step].rateLimited++;
    }

    const rows = Object.entries(byStep).map(([step, s]) => {
      const sorted = [...s.times].sort((a, b) => a - b);
      const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
      const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
      const p99 = sorted[Math.floor(sorted.length * 0.99)] || 0;
      const avg = Math.round(s.times.reduce((a, b) => a + b, 0) / s.times.length);
      const rate = Math.round((s.pass / s.count) * 100);
      return { step, count: s.count, pass: s.pass, fail: s.fail, rate, avg, p50, p95, p99, rateLimited: s.rateLimited };
    });

    return { rows, errors: this.errors, totalResults: this.results.length };
  }
}

// ─── User session simulation ──────────────────────────────────────────────────

// Simulates one user's full session lifecycle
async function simulateUser(userId, metrics, stopSignal, semaphore) {
  await semaphore.acquire();
  const log = (msg) => VERBOSE && process.stdout.write(`\n  [U${String(userId).padStart(4, '0')}] ${msg}`);
  log('Starting session');

  // T1: Health check
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/health`);
    // 429 on health = rate limit hit, count it but don't fail the user
    metrics.record('health_check', userId, r.ms, r.status, r.status === 200 || r.status === 429);
  } catch (e) {
    metrics.error('health_check', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T2: Metrics read
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/metrics`);
    metrics.record('metrics_read', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('metrics_read', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T3: Config read
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/config`);
    metrics.record('config_read', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('config_read', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T4: Sessions list
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/sessions`);
    metrics.record('sessions_list', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('sessions_list', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T5: Agent list
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/agents`);
    const ok = r.status === 200 && Array.isArray(r.body?.agents);
    metrics.record('agents_list', userId, r.ms, r.status, ok);
  } catch (e) {
    metrics.error('agents_list', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T6: Skills list
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/skills`);
    metrics.record('skills_list', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('skills_list', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T7: Cost summary
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/cost`);
    metrics.record('cost_read', userId, r.ms, r.status, r.status === 200 || r.status === 404);
  } catch (e) {
    metrics.error('cost_read', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T8: Forge3D queue
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/forge3d/queue`);
    metrics.record('forge3d_queue', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('forge3d_queue', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T9: Forge3D projects list
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/forge3d/projects`);
    metrics.record('forge3d_projects', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('forge3d_projects', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T10: Project memory read
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/memory?projectPath=${encodeURIComponent(DEFAULT_PROJECT_PATH)}`);
    metrics.record('memory_read', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('memory_read', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T11: Pipeline detect
  try {
    const r = await httpRequest('POST', `${BASE_URL}/api/chat/pipeline/detect`, {
      message: 'build a landing page with a hero image and some 3D elements'
    });
    metrics.record('pipeline_detect', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('pipeline_detect', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T12: Model intelligence status
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/models/status`);
    metrics.record('model_intel_status', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('model_intel_status', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T13: Security watcher status
  try {
    const r = await httpRequest('GET', `${BASE_URL}/api/security/status`);
    metrics.record('security_status', userId, r.ms, r.status, r.status === 200);
  } catch (e) {
    metrics.error('security_status', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T14: WebSocket connect and heartbeat
  try {
    const wsStart = Date.now();
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL);
      let connected = false;
      const timeout = setTimeout(() => {
        ws.terminate();
        reject(new Error('WS connect timeout'));
      }, 5000);

      ws.on('open', () => {
        connected = true;
        clearTimeout(timeout);
        // Register as a test client
        ws.send(JSON.stringify({ type: 'register', source: `test-user-${userId}`, channel: 'system' }));
        // Wait briefly for any response then close
        setTimeout(() => { ws.close(); }, 500);
      });

      ws.on('close', () => {
        const ms = Date.now() - wsStart;
        metrics.record('websocket_connect', userId, ms, connected ? 101 : 0, connected);
        resolve();
      });

      ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  } catch (e) {
    metrics.error('websocket_connect', userId, e.message);
  }

  if (stopSignal.stopped) return;

  // T15: Chat turn + SSE stream (the main user flow)
  try {
    const taskStart = Date.now();
    const tasks = [
      `add a comment saying "User ${userId} was here" to README.md`,
      `add a simple greeting function called hello${userId}`,
      `add a variable called user${userId}Count set to ${userId}`
    ];
    const task = tasks[userId % tasks.length];

    const turnRes = await httpRequest('POST', `${BASE_URL}/api/chat/turn`, {
      message: task,
      projectPath: DEFAULT_PROJECT_PATH
    });

    if (turnRes.status !== 202) {
      metrics.record('chat_turn_start', userId, turnRes.ms, turnRes.status, false,
        `Expected 202 got ${turnRes.status}`);
    } else {
      metrics.record('chat_turn_start', userId, turnRes.ms, turnRes.status, true);

      const sessionId = turnRes.body?.sessionId;
      if (sessionId) {
        const sseResult = await readSseStream(sessionId, 45_000);
        const totalMs = Date.now() - taskStart;

        metrics.record('chat_sse_stream', userId, sseResult.ms, 200,
          sseResult.success || sseResult.finalEvent === 'complete',
          `final=${sseResult.finalEvent} events=${sseResult.events.length}`);

        // T16: If plan generated, approve it
        if (sseResult.success && sseResult.events.some((e) => e.type === 'complete')) {
          const approveRes = await httpRequest('POST', `${BASE_URL}/api/chat/approve`, {
            sessionId,
            projectPath: DEFAULT_PROJECT_PATH
          });
          metrics.record('chat_approve', userId, approveRes.ms, approveRes.status,
            approveRes.status === 200 || approveRes.status === 202,
            `total_flow=${totalMs}ms`);
        }
      }
    }
  } catch (e) {
    metrics.error('chat_turn_full', userId, e.message);
  }

  log('Session complete');
  semaphore.release();
  metrics.finishUser();
}

// ─── Main runner ──────────────────────────────────────────────────────────────

async function run() {
  const label = scenarioCfg.label || `Custom (${USER_COUNT} users)`;
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  BrightForge Load Test');
  console.log(`║  Scenario:    ${label}`);
  console.log(`║  Users:       ${USER_COUNT}`);
  console.log(`║  Concurrency: ${CONCURRENCY} (max simultaneous sessions)`);
  console.log(`║  Wave size:   ${WAVE_SIZE} users every ${DELAY_MS}ms`);
  console.log(`║  Duration:    ${DURATION_MS / 1000}s max`);
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // Pre-flight: verify server is up
  try {
    const health = await httpRequest('GET', `${BASE_URL}/api/health`, null, 5_000);
    if (health.status !== 200 && health.status !== 429) {
      console.error(`✗ Server not healthy (${health.status}). Start it with: npm run server`);
      process.exit(1);
    }
    console.log(`✓ Server reachable (${health.ms}ms, status=${health.status})\n`);
  } catch (e) {
    console.error(`✗ Cannot reach server at ${BASE_URL}: ${e.message}`);
    console.error('  Start it with: npm run server');
    process.exit(1);
  }

  const metrics = new Metrics();
  const stopSignal = { stopped: false };
  const semaphore = new Semaphore(CONCURRENCY);
  const startTime = Date.now();

  // Stop after DURATION_MS
  const stopTimer = setTimeout(() => {
    stopSignal.stopped = true;
    console.log('\n  [!] Duration limit reached — stopping new users');
  }, DURATION_MS);

  // Live progress ticker (every 2s)
  const ticker = setInterval(() => {
    process.stdout.write('\r' + metrics.progressLine(semaphore.active, semaphore.waiting, USER_COUNT) + '   ');
  }, 2_000);

  // Wave-based launch: WAVE_SIZE users every DELAY_MS ms
  const userPromises = [];
  let launched = 0;

  while (launched < USER_COUNT && !stopSignal.stopped) {
    const waveEnd = Math.min(launched + WAVE_SIZE, USER_COUNT);
    for (let i = launched; i < waveEnd; i++) {
      const userId = i + 1;
      userPromises.push(simulateUser(userId, metrics, stopSignal, semaphore));
    }
    launched = waveEnd;
    if (launched < USER_COUNT && !stopSignal.stopped) {
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n  All ${USER_COUNT} users queued. Waiting for completion...\n`);
  await Promise.allSettled(userPromises);

  clearInterval(ticker);
  clearTimeout(stopTimer);

  const elapsed = Date.now() - startTime;
  process.stdout.write('\r' + ' '.repeat(120) + '\r');
  console.log(`  Done. Elapsed: ${(elapsed / 1000).toFixed(1)}s  |  Rate limited: ${metrics.rateLimited} requests\n`);

  // ─── Print report ──────────────────────────────────────────────────────────

  const { rows, errors } = metrics.summary();

  console.log('┌──────────────────────────────────────────────────────────────────────────┐');
  console.log('│  Step                      Count   Pass   Fail  Rate    Avg    P95    P99 │');
  console.log('├──────────────────────────────────────────────────────────────────────────┤');

  for (const row of rows) {
    const name    = row.step.padEnd(26);
    const count   = String(row.count).padStart(6);
    const pass    = String(row.pass).padStart(6);
    const fail    = String(row.fail).padStart(6);
    const rate    = `${row.rate}%`.padStart(5);
    const avg     = `${row.avg}ms`.padStart(7);
    const p95     = `${row.p95}ms`.padStart(7);
    const p99     = `${row.p99}ms`.padStart(7);
    const rl      = row.rateLimited > 0 ? ` 429x${row.rateLimited}` : '';
    const ok      = row.fail === 0 ? '✓' : row.rate >= 70 ? '⚠' : '✗';
    console.log(`│ ${ok} ${name} ${count} ${pass} ${fail} ${rate} ${avg} ${p95} ${p99}${rl.padEnd(7)} │`);
  }

  console.log('└──────────────────────────────────────────────────────────────────────────┘');

  // Errors summary (capped to first 20 for readability at 1000-user scale)
  if (errors.length > 0) {
    const shown = errors.slice(0, 20);
    console.log(`\n  Errors (${errors.length} total${errors.length > 20 ? ', showing first 20' : ''}):`);
    for (const e of shown) {
      console.log(`    [U${String(e.userId).padStart(4,'0')}] ${e.step}: ${e.message}`);
    }
  }

  // ─── Overall verdict ───────────────────────────────────────────────────────

  const totalSteps    = rows.reduce((s, r) => s + r.count, 0);
  const totalPass     = rows.reduce((s, r) => s + r.pass, 0);
  const totalFail     = rows.reduce((s, r) => s + r.fail, 0);
  const overallRate   = Math.round((totalPass / totalSteps) * 100);
  const chatRow       = rows.find((r) => r.step === 'chat_turn_start');
  const sseRow        = rows.find((r) => r.step === 'chat_sse_stream');
  const avgChatMs     = chatRow?.avg || 0;
  const p99SseMs      = sseRow?.p99 || 0;

  console.log('\n  ─── Verdict ───────────────────────────────────────────');
  console.log(`  Total users:     ${USER_COUNT}`);
  console.log(`  Total steps:     ${totalSteps}`);
  console.log(`  Pass rate:       ${overallRate}%  (${totalPass} pass / ${totalFail} fail)`);
  console.log(`  Rate limited:    ${metrics.rateLimited} requests (429s)`);
  console.log(`  Avg chat turn:   ${avgChatMs}ms`);
  console.log(`  P99 SSE stream:  ${p99SseMs}ms`);
  console.log(`  Errors:          ${errors.length}`);
  console.log(`  Elapsed:         ${(elapsed / 1000).toFixed(1)}s`);
  console.log(`  Throughput:      ${(totalSteps / (elapsed / 1000)).toFixed(1)} steps/sec`);

  const VERDICT = overallRate >= 90 ? 'PASS' : overallRate >= 70 ? 'WARN' : 'FAIL';
  console.log(`\n  ${VERDICT === 'PASS' ? '✓' : VERDICT === 'WARN' ? '⚠' : '✗'} VERDICT: ${VERDICT}\n`);

  // ─── Write JSON report ─────────────────────────────────────────────────────

  const reportDir = join(__dirname, '..', '..', 'data');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const reportPath = join(reportDir, 'load-test-report.json');
  writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    scenario: SCENARIO,
    config: { users: USER_COUNT, concurrency: CONCURRENCY, waveSize: WAVE_SIZE, waveDelayMs: DELAY_MS, durationMs: DURATION_MS },
    elapsed,
    summary: { totalSteps, totalPass, totalFail, overallRate, verdict: VERDICT },
    steps: rows,
    errors
  }, null, 2));

  console.log('  Report saved: data/load-test-report.json\n');

  process.exit(VERDICT === 'FAIL' ? 1 : 0);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Entry point ──────────────────────────────────────────────────────────────

run().catch((e) => {
  console.error('[LOAD-TEST] Fatal:', e);
  process.exit(1);
});
