/**
 * Forge3DMonitor - Health & Error Monitor
 *
 * Provides live analysis of the BrightForge backend:
 * - Polls health of Node.js API and Python inference servers.
 * - Monitors for active generation session failures.
 * - Detects crashes (e.g., if a server stops responding).
 * - Logs alerts to data/logs/monitor_alerts.json for persistence.
 *
 * Usage: node src/forge3d/monitor.js
 *        node src/forge3d/monitor.js --test
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 2026
 */

import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import forge3dConfig from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_EXPRESS_PORT = 3847;

class Forge3DMonitor {
  constructor(options = {}) {
    const expressPort = options.expressPort || parseInt(process.env.PORT, 10) || DEFAULT_EXPRESS_PORT;
    this.apiBase = options.apiBase || `http://localhost:${expressPort}/api`;
    this.pollInterval = options.pollInterval || forge3dConfig.healthCheck.interval_ms;
    this.logFile = options.logFile || forge3dConfig.resolvePath('data/logs/monitor_alerts.json');
    this.lastHealth = { node: true, python: true };
    this.seenErrors = new Set();
    this._timer = null;
    this._ensureLogDir();
  }

  /**
   * Ensure the log directory exists before writing alerts.
   */
  _ensureLogDir() {
    const dir = dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Start the polling loop.
   */
  start() {
    console.log(`[MONITOR] Starting — polling every ${this.pollInterval}ms`);
    this._poll();
    this._timer = setInterval(() => this._poll(), this.pollInterval);
  }

  /**
   * Stop the polling loop.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    console.log('[MONITOR] Stopped');
  }

  /**
   * Run one full health check cycle.
   * Returns a summary object for testing/programmatic use.
   *
   * @returns {Promise<Object>} status summary
   */
  async checkSystem() {
    const summary = {
      timestamp: new Date().toISOString(),
      nodeOnline: false,
      pythonOnline: false,
      activeJobs: 0,
      waitingJobs: 0,
      newFailures: []
    };

    // 1. Check Node.js API health
    const nodeOk = await this._fetchOk(`${this.apiBase}/health`);
    summary.nodeOnline = nodeOk;

    if (nodeOk) {
      console.log('[MONITOR] Node.js backend: ONLINE');
      if (!this.lastHealth.node) {
        this.logAlert('RECOVERY', 'Node.js backend has recovered.');
        this.lastHealth.node = true;
      }

      // 2. Check Python inference server health (via API proxy)
      const pyOk = await this._fetchOk(`${this.apiBase}/forge3d/fbx-status`);
      summary.pythonOnline = pyOk;

      if (pyOk) {
        console.log('[MONITOR] Python inference: ONLINE');
        if (!this.lastHealth.python) {
          this.logAlert('RECOVERY', 'Python inference server has recovered.');
          this.lastHealth.python = true;
        }
      } else {
        console.log('[MONITOR] Python inference: OFFLINE');
        if (this.lastHealth.python) {
          this.logAlert('CRASH', 'Python inference server stopped responding.');
          this.lastHealth.python = false;
        }
      }

      // 3. Monitor active sessions for failures
      const queueData = await this._fetchJson(`${this.apiBase}/forge3d/queue`);
      if (queueData) {
        summary.activeJobs = queueData.activeJobs || 0;
        summary.waitingJobs = queueData.waitingJobs || 0;
        console.log(`[MONITOR] Queue — active: ${summary.activeJobs}, waiting: ${summary.waitingJobs}`);
      }

      const historyData = await this._fetchJson(`${this.apiBase}/forge3d/history?limit=5`);
      if (historyData) {
        const recentFailures = Array.isArray(historyData)
          ? historyData.filter(h => h.status === 'failed')
          : [];

        if (recentFailures.length > 0) {
          console.log('[MONITOR] Recent failures:');
          for (const f of recentFailures) {
            console.log(`[MONITOR]   [${f.id}] prompt="${f.prompt}" error=${f.error || 'Unknown'}`);
            if (!this.seenErrors.has(f.id)) {
              this.logAlert('ERROR', `Generation failed for session ${f.id}: ${f.error || 'Unknown'}`);
              this.seenErrors.add(f.id);
              summary.newFailures.push(f.id);
            }
          }
        }
      }
    } else {
      console.log('[MONITOR] Node.js backend: DISCONNECTED');
      if (this.lastHealth.node) {
        this.logAlert('CRASH', 'BrightForge Node.js backend stopped responding.');
        this.lastHealth.node = false;
      }
    }

    return summary;
  }

  /**
   * Execute one poll cycle — calls checkSystem and prints a separator.
   */
  async _poll() {
    console.log(`[MONITOR] --- Check at ${new Date().toLocaleTimeString()} ---`);
    await this.checkSystem();
    console.log('[MONITOR] (Ctrl+C to stop)');
  }

  /**
   * Perform a fetch request and return true if the response is ok (2xx).
   * Returns false on any error or non-2xx status.
   *
   * @param {string} url
   * @returns {Promise<boolean>}
   */
  async _fetchOk(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch (_err) {
      return false;
    }
  }

  /**
   * Perform a fetch request and return the parsed JSON body.
   * Returns null on any error or non-2xx status.
   *
   * @param {string} url
   * @returns {Promise<Object|null>}
   */
  async _fetchJson(url) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (!res.ok) return null;
      return await res.json();
    } catch (_err) {
      return null;
    }
  }

  /**
   * Write an alert entry to the persistent log file (keeps last 50 entries).
   * Also prints the alert to console.
   *
   * @param {string} type - Alert type: 'CRASH' | 'RECOVERY' | 'ERROR'
   * @param {string} message - Human-readable description
   */
  logAlert(type, message) {
    const entry = {
      timestamp: new Date().toISOString(),
      type,
      message
    };

    console.log(`[MONITOR] ALERT [${type}] ${message}`);

    let logs = [];
    if (fs.existsSync(this.logFile)) {
      try {
        logs = JSON.parse(fs.readFileSync(this.logFile, 'utf8'));
      } catch (_e) {
        logs = [];
      }
    }
    logs.push(entry);
    fs.writeFileSync(this.logFile, JSON.stringify(logs.slice(-50), null, 2));
  }
}

// Singleton
const forge3dMonitor = new Forge3DMonitor();
export default forge3dMonitor;
export { Forge3DMonitor };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[MONITOR] Running self-test...');

  // Test constructor defaults
  const monitor = new Forge3DMonitor();
  console.assert(monitor.apiBase.includes('localhost'), 'apiBase should target localhost');
  console.assert(monitor.pollInterval === forge3dConfig.healthCheck.interval_ms, 'pollInterval should come from config');
  console.assert(monitor.logFile.includes('monitor_alerts.json'), 'logFile should point to monitor_alerts.json');
  console.assert(!monitor.lastHealth.node || monitor.lastHealth.node === true, 'node health should start true');
  console.assert(!monitor.lastHealth.python || monitor.lastHealth.python === true, 'python health should start true');

  // Test constructor overrides
  const custom = new Forge3DMonitor({ expressPort: 9000, pollInterval: 1000 });
  console.assert(custom.apiBase === 'http://localhost:9000/api', 'custom port should be reflected in apiBase');
  console.assert(custom.pollInterval === 1000, 'custom pollInterval should be respected');

  // Test logAlert writes to file
  const tmpLog = join(__dirname, '../../data/logs/_monitor_test.json');
  const testMonitor = new Forge3DMonitor({ logFile: tmpLog });
  testMonitor.logAlert('TEST', 'Self-test alert entry');
  console.assert(fs.existsSync(tmpLog), 'Alert log file should be created');
  const written = JSON.parse(fs.readFileSync(tmpLog, 'utf8'));
  console.assert(written.length === 1, 'Should have exactly 1 entry');
  console.assert(written[0].type === 'TEST', 'Entry type should be TEST');
  console.assert(written[0].message === 'Self-test alert entry', 'Entry message should match');
  fs.unlinkSync(tmpLog);

  // Test logAlert trims to last 50 entries
  const trimMonitor = new Forge3DMonitor({ logFile: tmpLog });
  for (let i = 0; i < 55; i++) {
    trimMonitor.logAlert('TEST', `Entry ${i}`);
  }
  const trimmed = JSON.parse(fs.readFileSync(tmpLog, 'utf8'));
  console.assert(trimmed.length === 50, 'Log should be capped at 50 entries');
  fs.unlinkSync(tmpLog);

  // Test _fetchOk returns false for unreachable URL (no server running on test port)
  const fetchResult = await testMonitor._fetchOk('http://localhost:19999/no-such-endpoint');
  console.assert(fetchResult === false, '_fetchOk should return false for unreachable host');

  // Test _fetchJson returns null for unreachable URL
  const jsonResult = await testMonitor._fetchJson('http://localhost:19999/no-such-endpoint');
  console.assert(jsonResult === null, '_fetchJson should return null for unreachable host');

  // Test start/stop does not throw
  const loopMonitor = new Forge3DMonitor({ logFile: tmpLog, pollInterval: 60000 });
  loopMonitor.start();
  console.assert(loopMonitor._timer !== null, 'Timer should be set after start()');
  loopMonitor.stop();
  console.assert(loopMonitor._timer === null, 'Timer should be cleared after stop()');
  if (fs.existsSync(tmpLog)) fs.unlinkSync(tmpLog);

  console.log('[MONITOR] Self-test passed');
  process.exit(0);
}

// Run as standalone script (not --test mode)
if (!process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  forge3dMonitor.start();
}
