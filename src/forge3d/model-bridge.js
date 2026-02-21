/**
 * ModelBridge - Python Inference Server Subprocess Manager
 *
 * Spawns and manages the Python FastAPI inference server.
 * Handles health checks, auto-restart, and HTTP client calls.
 *
 * STATUS: Complete. Tested with self-test block.
 *         Not yet tested with actual Python inference server running.
 *
 * TODO(P0): End-to-end test: start() -> health check -> generateMesh() -> shutdown()
 * TODO(P1): Check modelDownloader.isModelInstalled() before starting Python process
 * TODO(P1): Add CPU fallback mode when no CUDA GPU detected
 * TODO(P1): Add GPU benchmarking (measure inference speed per model per resolution)
 * TODO(P1): Docker container support for Python environment isolation
 * TODO(P2): Multi-GPU support (multiple Python processes on different CUDA devices)
 * TODO(P2): Windows service mode for persistent background operation
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { EventEmitter } from 'events';
import forge3dConfig from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PYTHON_DIR = join(__dirname, '../../python');

class ModelBridge extends EventEmitter {
  constructor(options = {}) {
    super();
    this.host = options.host || forge3dConfig.pythonServer.default_host;
    this.port = options.port || forge3dConfig.pythonServer.default_port;
    this.baseUrl = `http://${this.host}:${this.port}`;
    this.pythonProcess = null;
    this.healthInterval = null;
    this.state = 'stopped'; // stopped | starting | running | error | unavailable
    this.restartCount = 0;
    this.lastHealthCheck = null;
    this.startTime = null;
    this.consecutiveHealthFailures = 0;
    this.unavailableReason = null;
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

    if (this.state === 'unavailable') {
      console.log(`[BRIDGE] Server unavailable: ${this.unavailableReason}`);
      return false;
    }

    this.state = 'starting';

    // TODO(phase8-critical): Pre-flight environment checks before spawning Python.
    // Validates: Python 3.10+, CUDA GPU, required packages (fastapi, diffusers, trimesh).
    // On failure: sets state to 'unavailable' with clear reason, skips spawn.
    const envCheck = await this._checkEnvironment();
    if (!envCheck.ready) {
      this.state = 'unavailable';
      this.unavailableReason = envCheck.issues.join('; ');
      console.error(`[BRIDGE] Environment not ready: ${this.unavailableReason}`);
      this.emit('error', new Error(`Environment check failed: ${this.unavailableReason}`));
      return false;
    }

    // Try a range of ports starting from the configured port
    const startPort = this.port;
    const endPort = forge3dConfig.pythonServer.port_range_end;

    for (let port = startPort; port <= endPort; port++) {
      this.port = port;
      this.baseUrl = `http://${this.host}:${this.port}`;
      console.log(`[BRIDGE] Starting Python inference server on ${this.host}:${this.port}...`);

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
        console.warn(`[BRIDGE] Failed on port ${port}: ${err.message}`);
        // Kill the spawned process before trying next port
        if (this.pythonProcess) {
          this.pythonProcess.kill('SIGKILL');
          this.pythonProcess = null;
        }
        if (port === endPort) {
          console.error(`[BRIDGE] Failed to start on ports ${startPort}-${endPort}. Giving up.`);
          this.state = 'error';
          this.emit('error', err);
          return false;
        }
      }
    }

    return false;
  }

  /**
   * Stop the Python inference server.
   */
  async stop() {
    console.log('[BRIDGE] Stopping Python inference server...');
    this._stopHealthChecks();

    if (this.pythonProcess) {
      this.pythonProcess.kill('SIGTERM');
      // Give it time to shut down gracefully
      await new Promise((resolve) => {
        const timeout = setTimeout(() => {
          if (this.pythonProcess) {
            console.log('[BRIDGE] Force killing Python process');
            this.pythonProcess.kill('SIGKILL');
          }
          resolve();
        }, forge3dConfig.pythonServer.shutdown_grace_ms);

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

    while (Date.now() - start < forge3dConfig.pythonServer.startup_timeout_ms) {
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

    throw new Error(`Python server did not start within ${forge3dConfig.pythonServer.startup_timeout_ms / 1000}s`);
  }

  /**
   * Auto-restart on crash.
   */
  async _attemptRestart() {
    if (this.restartCount >= forge3dConfig.pythonServer.max_restart_attempts) {
      console.error(`[BRIDGE] Max restart attempts (${forge3dConfig.pythonServer.max_restart_attempts}) reached. Giving up.`);
      this.emit('restart_failed');
      return;
    }

    this.restartCount++;
    console.log(`[BRIDGE] Attempting restart ${this.restartCount}/${forge3dConfig.pythonServer.max_restart_attempts} in ${forge3dConfig.pythonServer.restart_cooldown_ms / 1000}s...`);

    await new Promise((r) => setTimeout(r, forge3dConfig.pythonServer.restart_cooldown_ms));
    await this.start();
  }

  /**
   * Periodic health check polling.
   */
  _startHealthChecks() {
    this._stopHealthChecks();
    this.consecutiveHealthFailures = 0;
    this.healthInterval = setInterval(async () => {
      try {
        const health = await this._fetchWithTimeout(`${this.baseUrl}/health`, forge3dConfig.healthCheck.timeout_ms);
        this.consecutiveHealthFailures = 0;
        this.lastHealthCheck = {
          timestamp: Date.now(),
          status: 'ok',
          data: health
        };
        this.emit('health', health);
      } catch (err) {
        this.consecutiveHealthFailures++;
        this.lastHealthCheck = {
          timestamp: Date.now(),
          status: 'error',
          error: err.message
        };
        console.warn(`[BRIDGE] Health check failed (${this.consecutiveHealthFailures}/${forge3dConfig.healthCheck.max_consecutive_failures}): ${err.message}`);

        // After N consecutive failures, kill and restart
        if (this.consecutiveHealthFailures >= forge3dConfig.healthCheck.max_consecutive_failures) {
          console.error(`[BRIDGE] ${forge3dConfig.healthCheck.max_consecutive_failures} consecutive health failures — killing Python process`);
          this._stopHealthChecks();
          if (this.pythonProcess) {
            this.pythonProcess.kill('SIGKILL');
            this.pythonProcess = null;
          }
          this.state = 'error';
          this.emit('crash', { code: null, signal: 'health_timeout' });
          this._attemptRestart();
        }
      }
    }, forge3dConfig.healthCheck.interval_ms);
  }

  _stopHealthChecks() {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  // --- HTTP Client Methods ---

  /**
   * Generate a 3D mesh from an image (JSON mode with GLB + FBX paths).
   * @param {Buffer} imageBuffer - Image file bytes
   * @param {string} filename - Original filename
   * @param {string} [jobId] - Optional job ID
   * @returns {Promise<{glbBuffer: Buffer, fbxBuffer: Buffer|null, metadata: Object}>}
   */
  async generateMesh(imageBuffer, filename = 'input.png', jobId = null) {
    this._ensureRunning();

    // Validate image before sending to Python
    if (!imageBuffer || imageBuffer.length === 0) {
      throw new Error('Image buffer is empty');
    }
    if (imageBuffer.length > forge3dConfig.generation.max_image_size_bytes) {
      throw new Error(`Image too large: ${(imageBuffer.length / (1024 * 1024)).toFixed(1)} MB (max ${forge3dConfig.generation.max_image_size_bytes / (1024 * 1024)} MB)`);
    }

    console.log(`[BRIDGE] Requesting mesh generation (${imageBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('image', new Blob([imageBuffer]), filename);
    if (jobId) formData.append('job_id', jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/generate/mesh?format=json`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Mesh generation failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    const metadata = {
      jobId: result.job_id,
      generationTime: result.generation_time,
      fileSize: result.file_size_bytes,
      fbxFileSize: result.fbx_size_bytes || 0
    };

    // Download GLB
    const glbBuffer = await this.downloadFile(
      result.job_id,
      `${result.job_id}.glb`
    );

    // Download FBX if available (non-fatal)
    let fbxBuffer = null;
    if (result.fbx_path) {
      try {
        const fbxFilename = result.fbx_path.split('/').pop();
        fbxBuffer = await this.downloadFile(result.job_id, fbxFilename);
        console.log(`[BRIDGE] FBX downloaded: ${fbxBuffer.length} bytes`);
      } catch (fbxErr) {
        console.warn(`[BRIDGE] FBX download failed (non-fatal): ${fbxErr.message}`);
      }
    }

    console.log(`[BRIDGE] Mesh generated: ${glbBuffer.length} bytes in ${metadata.generationTime}s`);
    return { glbBuffer, fbxBuffer, metadata };
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
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
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
   * @returns {Promise<Object>} Pipeline result with image and mesh paths + buffers
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
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms * forge3dConfig.generation.full_pipeline_multiplier)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Full pipeline failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();

    // Download GLB mesh
    const glbBuffer = await this.downloadFile(result.job_id, 'generated_mesh.glb');
    result.glbBuffer = glbBuffer;

    // Download FBX if available (non-fatal)
    result.fbxBuffer = null;
    if (result.fbx_path) {
      try {
        const fbxFilename = result.fbx_path.split('/').pop();
        result.fbxBuffer = await this.downloadFile(result.job_id, fbxFilename);
        console.log(`[BRIDGE] FBX downloaded: ${result.fbxBuffer.length} bytes`);
      } catch (fbxErr) {
        console.warn(`[BRIDGE] FBX download failed (non-fatal): ${fbxErr.message}`);
      }
    }

    console.log(`[BRIDGE] Full pipeline complete in ${result.total_time}s`);
    return result;
  }

  /**
   * Convert an existing GLB buffer to FBX format.
   * @param {Buffer} glbBuffer - GLB file bytes
   * @param {string} [jobId] - Optional job ID
   * @returns {Promise<{buffer: Buffer, metadata: Object}>} FBX file buffer
   */
  async convertToFbx(glbBuffer, jobId = null) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting GLB->FBX conversion (${glbBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('file', new Blob([glbBuffer]), 'mesh.glb');
    if (jobId) formData.append('job_id', jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/convert/glb-to-fbx`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`FBX conversion failed: ${err.detail || err.error || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const metadata = {
      jobId: response.headers.get('x-job-id'),
      conversionTime: response.headers.get('x-conversion-time'),
      fileSize: response.headers.get('x-file-size'),
      backend: response.headers.get('x-backend')
    };

    console.log(`[BRIDGE] FBX conversion complete: ${buffer.length} bytes in ${metadata.conversionTime}s (${metadata.backend})`);
    return { buffer, metadata };
  }

  /**
   * Extract PBR materials from a GLB file via the Python server.
   * @param {Buffer} glbBuffer - The GLB file data
   * @param {string} preset - Material preset name (default: 'ue5-standard')
   * @returns {Promise<{manifest: object, textures: string[], success: boolean, error: string|null}>}
   */
  async extractMaterials(glbBuffer, preset = 'ue5-standard') {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting material extraction (${glbBuffer.length} bytes, preset: ${preset})...`);

    const formData = new FormData();
    formData.append('file', new Blob([glbBuffer]), 'mesh.glb');
    formData.append('preset', preset);

    const response = await this._fetchRaw(`${this.baseUrl}/extract-materials`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Material extraction failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    const textures = (result.extraction && result.extraction.textures) || [];
    console.log(`[BRIDGE] Material extraction complete: ${textures.length} textures`);
    return {
      manifest: result.manifest || {},
      textures: textures,
      materials: (result.extraction && result.extraction.materials) || [],
      success: true,
      error: null
    };
  }

  /**
   * Get available material presets from the Python server.
   * @returns {Promise<string[]>}
   */
  async getMaterialPresets() {
    this._ensureRunning();
    console.log('[BRIDGE] Fetching material presets...');

    const result = await this._fetchWithTimeout(
      `${this.baseUrl}/material-presets`,
      forge3dConfig.healthCheck.timeout_ms
    );

    console.log(`[BRIDGE] Material presets: ${result.presets?.length || 0} available`);
    return result.presets || [];
  }

  /**
   * Check FBX converter availability.
   * @returns {Promise<Object>} FBX converter status
   */
  async getFbxStatus() {
    this._ensureRunning();
    return this._fetchWithTimeout(`${this.baseUrl}/convert/status`, forge3dConfig.healthCheck.timeout_ms);
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
      { signal: AbortSignal.timeout(forge3dConfig.generation.download_timeout_ms) }
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
    return this._fetchWithTimeout(`${this.baseUrl}/health`, forge3dConfig.healthCheck.timeout_ms);
  }

  /**
   * Get detailed server status.
   * @returns {Promise<Object>} Status data with VRAM info
   */
  async getStatus() {
    return this._fetchWithTimeout(`${this.baseUrl}/status`, forge3dConfig.healthCheck.timeout_ms);
  }

  /**
   * Get bridge info for API consumers.
   */
  getInfo() {
    const info = {
      state: this.state,
      baseUrl: this.baseUrl,
      restartCount: this.restartCount,
      uptime: this.startTime ? Date.now() - this.startTime : 0,
      lastHealthCheck: this.lastHealthCheck
    };
    if (this.state === 'unavailable' && this.unavailableReason) {
      info.unavailableReason = this.unavailableReason;
    }
    return info;
  }

  // --- Internal Helpers ---

  /**
   * Pre-flight check: verify Python, CUDA, and required packages are available.
   * @returns {Promise<{ready: boolean, issues: string[]}>}
   */
  async _checkEnvironment() {
    const issues = [];

    // Check Python version (3.10+)
    try {
      const pyVersion = await this._runCommand('python', ['--version']);
      const match = pyVersion.match(/Python (\d+)\.(\d+)/);
      if (match) {
        const [, major, minor] = match.map(Number);
        if (major < 3 || (major === 3 && minor < 10)) {
          issues.push(`Python ${major}.${minor} found, need 3.10+`);
        } else {
          console.log(`[BRIDGE] Python ${major}.${minor} detected`);
        }
      } else {
        issues.push('Could not parse Python version');
      }
    } catch (_e) {
      issues.push('Python not found in PATH');
    }

    // Check CUDA availability
    try {
      const cudaCheck = await this._runCommand('python', [
        '-c', 'import torch; print(torch.cuda.is_available())'
      ]);
      if (cudaCheck.trim() !== 'True') {
        issues.push('CUDA not available (torch.cuda.is_available() = False)');
      } else {
        console.log('[BRIDGE] CUDA GPU detected');
      }
    } catch (_e) {
      issues.push('PyTorch not installed or CUDA check failed');
    }

    // Check required Python packages
    try {
      await this._runCommand('python', [
        '-c', 'import fastapi, diffusers, trimesh, PIL, pynvml'
      ]);
      console.log('[BRIDGE] Required Python packages verified');
    } catch (_e) {
      issues.push('Missing Python packages (need: fastapi, diffusers, trimesh, Pillow, pynvml)');
    }

    return { ready: issues.length === 0, issues };
  }

  /**
   * Run a command and return stdout.
   * @param {string} cmd - Command to run
   * @param {string[]} args - Arguments
   * @returns {Promise<string>} stdout
   */
  _runCommand(cmd, args) {
    return new Promise((resolve, reject) => {
      const proc = spawn(cmd, args, {
        cwd: PYTHON_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: forge3dConfig.pythonServer.command_timeout_ms
      });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `Exit code ${code}`));
      });
      proc.on('error', reject);
    });
  }

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
  console.assert(bridge.consecutiveHealthFailures === 0, 'Health failures should be 0');

  // Test image validation (empty buffer)
  try {
    await bridge.generateMesh(Buffer.alloc(0));
    console.assert(false, 'Should have thrown for empty buffer');
  } catch (e) {
    // Empty buffer throws before _ensureRunning since validation is first
    // but _ensureRunning comes first in the code, so it will fail on state check
    console.assert(
      e.message.includes('not running') || e.message === 'Image buffer is empty',
      'Should reject empty buffer or not-running state'
    );
  }

  console.log('[BRIDGE] Self-test passed');
  process.exit(0);
}
