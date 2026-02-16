/**
 * ModelBridge - Python Inference Server Subprocess Manager
 *
 * Spawns and manages the Python FastAPI inference server.
 * Handles health checks, auto-restart, and HTTP client calls.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PYTHON_DIR = join(__dirname, '../../python');
const DEFAULT_PORT = 8001;
const DEFAULT_HOST = '127.0.0.1';
const HEALTH_CHECK_INTERVAL = 10000; // 10 sec
const STARTUP_TIMEOUT = 30000; // 30 sec
const GENERATION_TIMEOUT = 180000; // 180 sec
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_COOLDOWN = 5000; // 5 sec

class ModelBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || DEFAULT_HOST;
    this.port = options.port || DEFAULT_PORT;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.pythonProcess = null;
    this.healthInterval = null;
    this.state = 'stopped'; // stopped | starting | running | error
    this.restartCount = 0;
    this.lastHealthCheck = null;
    this.startTime = null;
  }

  /**
   * Start the Python inference server subprocess.
   * @returns {Promise<boolean>} true if server started successfully
   */
  async start() {
    if (this.state === 'running') {
      console.log('[BRIDGE] Server already running');
      return true;
    }

    console.log(`[BRIDGE] Starting Python inference server on ${this.host}:${this.port}...`);
    this.state = 'starting';

    try {
      this._spawnProcess();
      await this._waitForStartup();
      this.state = 'running';
      this.startTime = Date.now();
      this.restartCount = 0;
      this._startHealthChecks();
      console.log('[BRIDGE] Python server is running');
      this.emit('started');
      return true;
    } catch (err) {
      console.error(`[BRIDGE] Failed to start: ${err.message}`);
      this.state = 'error';
      this.emit('error', err);
      return false;
    }
  }

  /**
   * Stop the Python inference server.
   */
  async stop() {
    console.log('[BRIDGE] Stopping Python inference server...');
    this._stopHealthChecks();

    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');
      // Give it 5 seconds to shut down gracefully
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.pythonProcess) {
            console.log('[BRIDGE] Force killing Python process');
            this.pythonProcess.kill('SIGKILL');
          }
          resolve();
        }, 5000);

        if (this.pythonProcess) {
          this.pythonProcess.on('exit', () => {
            clearTimeout(timeout);
            resolve();
          });
        } else {
          clearTimeout(timeout);
          resolve();
        }
      });
      this.pythonProcess = null;
    }

    this.state = 'stopped';
    console.log('[BRIDGE] Python server stopped');
    this.emit('stopped');
  }

  /**
   * Spawn the Python subprocess.
   */
  _spawnProcess() {
    const args = [
      join(PYTHON_DIR, 'inference_server.py'),
      '--port', String(this.port),
      '--host', this.host
    ];

    this.pythonProcess = spawn('python', args, {
      cwd: PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    this.pythonProcess.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        console.log(`[BRIDGE:PY] ${line}`);
      }
    });

    this.pythonProcess.stderr.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        // Uvicorn logs to stderr by default
        if (line.includes('ERROR') || line.includes('Traceback')) {
          console.error(`[BRIDGE:PY] ${line}`);
        } else {
          console.log(`[BRIDGE:PY] ${line}`);
        }
      }
    });

    this.pythonProcess.on('exit', (code, signal) => {
      console.log(`[BRIDGE] Python process exited (code=${code}, signal=${signal})`);
      this.pythonProcess = null;

      if (this.state === 'running') {
        this.state = 'error';
        this.emit('crash', { code, signal });
        this._attemptRestart();
      }
    });

    this.pythonProcess.on('error', (err) => {
      console.error(`[BRIDGE] Python process error: ${err.message}`);
      this.emit('error', err);
    });
  }

  /**
   * Wait for the server to respond to health checks.
   */
  async _waitForStartup() {
    const start = Date.now();

    while (Date.now() - start < STARTUP_TIMEOUT) {
      try {
        const health = await this._fetchWithTimeout(`${this.baseUrl}/health`, 3000);
        if (health && health.status === 'healthy') {
          return;
        }
      } catch (_e) {
        // Server not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(`Python server did not start within ${STARTUP_TIMEOUT / 1000}s`);
  }

  /**
   * Auto-restart on crash.
   */
  async _attemptRestart() {
    if (this.restartCount >= MAX_RESTART_ATTEMPTS) {
      console.error(`[BRIDGE] Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached. Giving up.`);
      this.emit('restart_failed');
      return;
    }

    this.restartCount++;
    console.log(`[BRIDGE] Attempting restart ${this.restartCount}/${MAX_RESTART_ATTEMPTS} in ${RESTART_COOLDOWN / 1000}s...`);

    await new Promise((r) => setTimeout(r, RESTART_COOLDOWN));
    await this.start();
  }

  /**
   * Periodic health check polling.
   */
  _startHealthChecks() {
    this._stopHealthChecks();
    this.healthInterval = setInterval(async () => {
      try {
        const health = await this._fetchWithTimeout(`${this.baseUrl}/health`, 5000);
        this.lastHealthCheck = {
          timestamp: Date.now(),
          status: 'ok',
          data: health
        };
        this.emit('health', health);
      } catch (err) {
        this.lastHealthCheck = {
          timestamp: Date.now(),
          status: 'error',
          error: err.message
        };
        console.warn(`[BRIDGE] Health check failed: ${err.message}`);
      }
    }, HEALTH_CHECK_INTERVAL);
  }

  _stopHealthChecks() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // --- HTTP Client Methods ---

  /**
   * Generate a 3D mesh from an image.
   * @param {Buffer} imageBuffer - Image file bytes
   * @param {string} filename - Original filename
   * @param {string} [jobId] - Optional job ID
   * @returns {Promise<{buffer: Buffer, headers: Object}>} GLB file buffer and response headers
   */
  async generateMesh(imageBuffer, filename = 'input.png', jobId = null) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting mesh generation (${imageBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer]), filename);
    if (jobId) formData.append('job_id', jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/generate/mesh`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Mesh generation failed: ${err.detail || err.error || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = {
      jobId: response.headers.get('x-job-id'),
      generationTime: response.headers.get('x-generation-time'),
      fileSize: response.headers.get('x-file-size')
    };

    console.log(`[BRIDGE] Mesh generated: ${buffer.length} bytes in ${headers.generationTime}s`);
    return { buffer, headers };
  }

  /**
   * Generate an image from a text prompt.
   * @param {string} prompt - Text description
   * @param {Object} [options] - width, height, steps, jobId
   * @returns {Promise<{buffer: Buffer, headers: Object}>} PNG file buffer
   */
  async generateImage(prompt, options = {}) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting image generation: "${prompt.slice(0, 80)}"`);

    const formData = new FormData();
    formData.append('prompt', prompt);
    if (options.width) formData.append('width', String(options.width));
    if (options.height) formData.append('height', String(options.height));
    if (options.steps) formData.append('steps', String(options.steps));
    if (options.jobId) formData.append('job_id', options.jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/generate/image`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Image generation failed: ${err.detail || err.error || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const headers = {
      jobId: response.headers.get('x-job-id'),
      generationTime: response.headers.get('x-generation-time'),
      fileSize: response.headers.get('x-file-size')
    };

    console.log(`[BRIDGE] Image generated: ${buffer.length} bytes in ${headers.generationTime}s`);
    return { buffer, headers };
  }

  /**
   * Full text-to-3D pipeline (SDXL -> InstantMesh).
   * @param {string} prompt - Text description
   * @param {Object} [options] - steps, jobId
   * @returns {Promise<Object>} Pipeline result with image and mesh paths
   */
  async generateFull(prompt, options = {}) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting full pipeline: "${prompt.slice(0, 80)}"`);

    const formData = new FormData();
    formData.append('prompt', prompt);
    if (options.steps) formData.append('steps', String(options.steps));
    if (options.jobId) formData.append('job_id', options.jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/generate/full`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(GENERATION_TIMEOUT * 2) // Full pipeline gets double timeout
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Full pipeline failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] Full pipeline complete in ${result.total_time}s`);
    return result;
  }

  /**
   * Download a generated file from the Python server.
   * @param {string} jobId - Job ID
   * @param {string} filename - File to download
   * @returns {Promise<Buffer>} File contents
   */
  async downloadFile(jobId, filename) {
    this._ensureRunning();

    const response = await this._fetchRaw(
      `${this.baseUrl}/download/${jobId}/${filename}`,
      { signal: AbortSignal.timeout(30000) }
    );

    if (!response.ok) {
      throw new Error(`Download failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  /**
   * Get server health status.
   * @returns {Promise<Object>} Health data
   */
  async getHealth() {
    return this._fetchWithTimeout(`${this.baseUrl}/health`, 5000);
  }

  /**
   * Get detailed server status.
   * @returns {Promise<Object>} Status data with VRAM info
   */
  async getStatus() {
    return this._fetchWithTimeout(`${this.baseUrl}/status`, 5000);
  }

  /**
   * Get bridge info for API consumers.
   */
  getInfo() {
    return {
      state: this.state,
      baseUrl: this.baseUrl,
      restartCount: this.restartCount,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      lastHealthCheck: this.lastHealthCheck
    };
  }

  // --- Internal Helpers ---

  _ensureRunning() {
    if (this.state !== 'running') {
      throw new Error(`Python server is not running (state: ${this.state})`);
    }
  }

  async _fetchWithTimeout(url, timeoutMs) {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    return response.json();
  }

  async _fetchRaw(url, options = {}) {
    return fetch(url, options);
  }
}

// Singleton
const modelBridge = new ModelBridge();
export default modelBridge;
export { ModelBridge };

// --test block (guarded so imports don't trigger it)
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[BRIDGE] Running self-test...');
  console.log('[BRIDGE] Testing ModelBridge instantiation...');

  const bridge = new ModelBridge({ port: 8099 });
  console.assert(bridge.state === 'stopped', 'Initial state should be stopped');
  console.assert(bridge.baseUrl === 'http://127.0.0.1:8099', 'URL should match port');
  console.assert(bridge.restartCount === 0, 'Restart count should be 0');

  const info = bridge.getInfo();
  console.assert(info.state === 'stopped', 'Info state should be stopped');
  console.assert(info.uptime === 0, 'Uptime should be 0');

  console.log('[BRIDGE] Self-test passed');
  process.exit(0);
}
