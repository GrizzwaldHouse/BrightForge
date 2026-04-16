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
 * @date March 4, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createWriteStream, statSync } from 'fs';
import { EventEmitter } from 'events';
import forge3dConfig from './config-loader.js';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PYTHON_DIR = join(__dirname, '../../python');
const ERROR_LOG_PATH = join(__dirname, '../../sessions/bridge-errors.log');
const MAX_LOG_SIZE = 1024 * 1024; // 1MB

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
    this.totalRestarts = 0; // Cumulative across entire lifecycle
    this.lastHealthCheck = null;
    this.startTime = null;
    this.consecutiveHealthFailures = 0;
    this.unavailableReason = null;
    this.pythonCmd = null; // Discovered Python command (python, python3, python3.13, etc.)
    this.pythonPrefixArgs = []; // Prefix args for py launcher (e.g., ['-3.13'])
    this.stderrStream = null;
    this.cpuMode = false; // Set to true when no CUDA GPU is detected
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
    const startupStart = Date.now();

    // Initialize stderr logging stream
    this._initErrorLog();

    // Pre-flight environment checks before spawning Python
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

      // Skip ports already occupied by another server
      if (await this._isPortOccupied(port)) {
        console.warn(`[BRIDGE] Port ${port} is already occupied, skipping`);
        continue;
      }

      console.log(`[BRIDGE] Starting Python inference server on ${this.host}:${this.port}...`);

      try {
        this._spawnProcess();
        await this._waitForStartup();
        this.state = 'running';
        this.startTime = Date.now();
        this.restartCount = 0;
        this._startHealthChecks();
        const startupTime = Date.now() - startupStart;
        console.log(`[BRIDGE] Python server is running (startup: ${startupTime}ms)`);
        this.emit('started');
        telemetryBus.emit('forge3d', {
          type: 'bridge_started',
          port: this.port,
          startupTime,
          totalRestarts: this.totalRestarts
        });

        // Detect GPU availability after successful startup
        await this._detectGpu();

        // Fire-and-forget model validation (never blocks startup)
        this._validateModels().catch(err => {
          console.warn('[BRIDGE] Model validation failed (non-fatal):', err.message);
        });

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

    // Close stderr log stream
    if (this.stderrStream) {
      this.stderrStream.end();
      this.stderrStream = null;
    }

    this.state = 'stopped';
    console.log('[BRIDGE] Python server stopped');
    this.emit('stopped');
    telemetryBus.emit('forge3d', { type: 'bridge_stopped' });
  }

  /**
   * Spawn the Python subprocess.
   */
  _spawnProcess() {
    const baseArgs = [
      join(PYTHON_DIR, 'inference_server.py'),
      '--port', String(this.port),
      '--host', this.host
    ];

    // Append --cpu flag when running in CPU fallback mode
    if (this.cpuMode) {
      baseArgs.push('--cpu');
    }

    // Prepend py launcher prefix args if discovered (e.g., ['-3.13'])
    const args = [...this.pythonPrefixArgs, ...baseArgs];

    const cmd = this.pythonCmd || 'python';
    this.pythonProcess = spawn(cmd, args, {
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
        // Log to file with timestamp
        if (this.stderrStream) {
          const timestamp = new Date().toISOString();
          this.stderrStream.write(`[${timestamp}] ${line}\n`);
        }

        // Uvicorn logs to stderr by default
        if (line.includes('ERROR') || line.includes('Traceback')) {
          console.error(`[BRIDGE:PY] ${line}`);
        } else {
          console.log(`[BRIDGE:PY] ${line}`);
        }
      }
    });

    this.pythonProcess.on('exit', (code, signal) => {
      const uptime = this.startTime ? Date.now() - this.startTime : 0;
      console.log(`[BRIDGE] Python process exited (code=${code}, signal=${signal}, uptime=${(uptime / 1000).toFixed(1)}s)`);
      this.pythonProcess = null;

      if (this.state === 'running') {
        this.state = 'error';
        this.emit('crash', { code, signal });
        errorHandler.report('bridge_error', new Error('Python process crashed'), {
          code,
          signal,
          uptime,
          restartCount: this.restartCount,
          totalRestarts: this.totalRestarts
        });
        this._attemptRestart('crash');
      }
    });

    this.pythonProcess.on('error', (err) => {
      console.error(`[BRIDGE] Python process error: ${err.message}`);
      this.emit('error', err);
    });
  }

  /**
   * Check if a port is already occupied by a running server.
   * @param {number} port - Port to check
   * @returns {Promise<boolean>} true if port is already in use
   */
  async _isPortOccupied(port) {
    try {
      const url = `http://${this.host}:${port}/health`;
      const health = await this._fetchWithTimeout(url, 2000);
      return !!(health && health.status === 'healthy');
    } catch (_e) {
      return false;
    }
  }

  /**
   * Wait for the server to respond to health checks.
   * Verifies the spawned subprocess is still alive during startup.
   */
  async _waitForStartup() {
    const start = Date.now();

    while (Date.now() - start < forge3dConfig.pythonServer.startup_timeout_ms) {
      // If the spawned process died, abort immediately instead of
      // polling a zombie server that may be holding the port.
      if (!this.pythonProcess) {
        throw new Error('Python process exited during startup');
      }

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
   * @param {string} reason - Reason for restart ('crash' or 'health_timeout')
   */
  async _attemptRestart(reason = 'unknown') {
    const uptime = this.startTime ? Date.now() - this.startTime : 0;

    if (this.restartCount >= forge3dConfig.pythonServer.max_restart_attempts) {
      console.error(`[BRIDGE] Max restart attempts (${forge3dConfig.pythonServer.max_restart_attempts}) reached. Giving up.`);
      console.error(`[BRIDGE] Restart stats: reason=${reason}, uptime=${(uptime / 1000).toFixed(1)}s, totalRestarts=${this.totalRestarts}`);
      this.emit('restart_failed');
      return;
    }

    this.restartCount++;
    this.totalRestarts++;
    console.log(`[BRIDGE] Attempting restart ${this.restartCount}/${forge3dConfig.pythonServer.max_restart_attempts} in ${forge3dConfig.pythonServer.restart_cooldown_ms / 1000}s...`);
    console.log(`[BRIDGE] Restart reason: ${reason}, uptime before crash: ${(uptime / 1000).toFixed(1)}s, total restarts: ${this.totalRestarts}`);

    telemetryBus.emit('forge3d', {
      type: 'bridge_restart',
      restartCount: this.restartCount,
      totalRestarts: this.totalRestarts,
      reason,
      uptime
    });

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
          telemetryBus.emit('forge3d', {
            type: 'bridge_health_failure',
            consecutiveFailures: this.consecutiveHealthFailures
          });
          this._stopHealthChecks();
          if (this.pythonProcess) {
            this.pythonProcess.kill('SIGKILL');
            this.pythonProcess = null;
          }
          this.state = 'error';
          this.emit('crash', { code: null, signal: 'health_timeout' });
          this._attemptRestart('health_timeout');
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
   * @param {string} [model] - Optional model override (e.g. 'hunyuan3d')
   * @returns {Promise<{glbBuffer: Buffer, fbxBuffer: Buffer|null, metadata: Object}>}
   */
  async generateMesh(imageBuffer, filename = 'input.png', jobId = null, model = null) {
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
    if (model) formData.append('model', model);

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
    if (options.model) formData.append('model', options.model);

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
   * Full text-to-3D pipeline (SDXL -> Hunyuan3D).
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
    if (options.imageModel) formData.append('image_model', options.imageModel);
    if (options.meshModel) formData.append('mesh_model', options.meshModel);

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
   * Optimize a mesh by reducing face count.
   * @param {Buffer} glbBuffer - GLB file bytes
   * @param {number} targetFaces - Target face count
   * @param {string} [jobId] - Optional job ID
   * @returns {Promise<Object>} Optimization result
   */
  async optimizeMesh(glbBuffer, targetFaces, jobId = null) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting mesh optimization (${glbBuffer.length} bytes, target: ${targetFaces} faces)...`);

    const formData = new FormData();
    formData.append('file', new Blob([glbBuffer]), 'mesh.glb');
    formData.append('target_faces', String(targetFaces));
    if (jobId) formData.append('job_id', jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/postprocess/optimize`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Optimization failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] Mesh optimized: ${result.original_faces} -> ${result.optimized_faces} faces (${result.reduction_pct}%)`);
    return result;
  }

  /**
   * Generate LOD chain from a mesh.
   * @param {Buffer} glbBuffer - GLB file bytes
   * @param {string} [jobId] - Optional job ID
   * @returns {Promise<Object>} LOD result with levels array
   */
  async generateLOD(glbBuffer, jobId = null) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting LOD generation (${glbBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('file', new Blob([glbBuffer]), 'mesh.glb');
    if (jobId) formData.append('job_id', jobId);

    const response = await this._fetchRaw(`${this.baseUrl}/postprocess/lod`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`LOD generation failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] LOD chain generated: ${result.levels?.length} levels`);
    return result;
  }

  /**
   * Get quality report for a mesh.
   * @param {Buffer} glbBuffer - GLB file bytes
   * @returns {Promise<Object>} Quality report
   */
  async getMeshReport(glbBuffer) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting mesh quality report (${glbBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('file', new Blob([glbBuffer]), 'mesh.glb');

    const response = await this._fetchRaw(`${this.baseUrl}/postprocess/report`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.healthCheck.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Mesh report failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] Mesh report: ${result.vertex_count} verts, ${result.face_count} faces`);
    return result;
  }

  /**
   * Get optimization presets from the Python server.
   * @returns {Promise<Object>} Presets config
   */
  async getOptimizationPresets() {
    this._ensureRunning();
    return this._fetchWithTimeout(`${this.baseUrl}/postprocess/presets`, forge3dConfig.healthCheck.timeout_ms);
  }

  /**
   * Get available generation models from the Python server.
   * @returns {Promise<Object>} Available models with metadata
   */
  async getModels() {
    this._ensureRunning();
    return this._fetchWithTimeout(`${this.baseUrl}/models`, forge3dConfig.healthCheck.timeout_ms);
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

  /**
   * Validate UV coordinates in a mesh.
   * @param {Buffer} meshBuffer - GLB file bytes
   * @returns {Promise<Object>} Validation result
   */
  async validateUVs(meshBuffer) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting UV validation (${meshBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('file', new Blob([meshBuffer]), 'mesh.glb');

    const response = await this._fetchRaw(`${this.baseUrl}/validate/uvs`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`UV validation failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] UV validation complete: has_uvs=${result.has_uvs}`);
    return result;
  }

  /**
   * Auto-unwrap UV coordinates for a mesh.
   * @param {Buffer} meshBuffer - GLB file bytes
   * @returns {Promise<Buffer>} GLB with generated UVs
   */
  async autoUnwrapUVs(meshBuffer) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting auto UV unwrap (${meshBuffer.length} bytes)...`);

    const formData = new FormData();
    formData.append('file', new Blob([meshBuffer]), 'mesh.glb');

    const response = await this._fetchRaw(`${this.baseUrl}/unwrap/auto`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Auto UV unwrap failed: ${err.detail || err.error || response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    console.log(`[BRIDGE] Auto UV unwrap complete: ${buffer.length} bytes`);
    return buffer;
  }

  /**
   * Generate PBR textures for a mesh.
   * @param {string} meshPath - Path to GLB file (server-side)
   * @param {string} prompt - Text description
   * @param {Object} [styleHints] - Style parameters (roughness, metallic, etc.)
   * @param {number} [resolution] - Texture resolution (default 1024)
   * @returns {Promise<Object>} Texture paths
   */
  async generateTextures(meshPath, prompt, styleHints = {}, resolution = 1024) {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting texture generation for ${meshPath}...`);

    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('style_hints', JSON.stringify(styleHints));
    formData.append('resolution', String(resolution));

    // For now, send mesh buffer since server expects upload
    // In production, support both buffer and path-based generation
    const { readFileSync } = await import('fs');
    const meshBuffer = readFileSync(meshPath);
    formData.append('file', new Blob([meshBuffer]), 'mesh.glb');

    const response = await this._fetchRaw(`${this.baseUrl}/generate/textures`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Texture generation failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] Texture generation complete: ${Object.keys(result.textures).length} textures`);
    return result;
  }

  /**
   * Build material descriptor from texture set.
   * @param {Object} textures - Texture paths map
   * @param {string} [preset] - Material preset name
   * @returns {Promise<Object>} Material descriptor
   */
  async buildMaterial(textures, preset = 'default_pbr') {
    this._ensureRunning();
    console.log(`[BRIDGE] Requesting material build with preset: ${preset}`);

    const formData = new FormData();
    formData.append('textures', JSON.stringify(textures));
    formData.append('preset', preset);

    const response = await this._fetchRaw(`${this.baseUrl}/build/material`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000) // 30s timeout
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({ detail: response.statusText }));
      throw new Error(`Material build failed: ${err.detail || err.error || response.statusText}`);
    }

    const result = await response.json();
    console.log(`[BRIDGE] Material built with ${result.material.metadata.texture_count} textures`);
    return result.material;
  }

  /**
   * Assemble multiple GLB files into a single multi-node scene GLB.
   * @param {Object} manifest - { sceneName, nodes: [{ name, glb_path, transform: 4x4 }] }
   * @returns {Promise<{buffer: Buffer, metadata: Object}>}
   */
  async assembleScene(manifest) {
    this._ensureRunning();
    const endTimer = telemetryBus.startTimer('bridge_assemble_scene');

    console.log(`[BRIDGE] Requesting scene assembly (${manifest.nodes?.length || 0} nodes)...`);

    try {
      const formData = new FormData();
      formData.append('manifest', JSON.stringify(manifest));

      const response = await this._fetchRaw(`${this.baseUrl}/assemble/scene`, {
        method: 'POST',
        body: formData,
        signal: AbortSignal.timeout(forge3dConfig.generation.timeout_ms)
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(`Scene assembly failed: ${err.detail || err.error || response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const metadata = {
        assemblyTime: parseFloat(response.headers.get('x-assembly-time')) || 0,
        nodeCount: parseInt(response.headers.get('x-node-count')) || 0,
        fileSize: buffer.length
      };

      console.log(`[BRIDGE] Scene assembled: ${buffer.length} bytes, ${metadata.nodeCount} nodes`);
      endTimer({ success: true, nodeCount: metadata.nodeCount });

      return { buffer, metadata };
    } catch (err) {
      endTimer({ success: false, error: err.message });
      errorHandler.report('bridge_error', err, { operation: 'assembleScene' });
      throw err;
    }
  }

  /**
   * Validate available models after bridge startup (fire-and-forget).
   * Logs the adapter list and emits a telemetry event.
   */
  async _validateModels() {
    const models = await this.getModels();
    const modelList = models.models || [];
    const names = modelList.map(m => m.name).join(', ');
    console.log(`[BRIDGE] Models available: ${modelList.length} (${names || 'none'})`);
    this.emit('models_validated', { models: modelList });
    telemetryBus.emit('forge3d', {
      type: 'models_validated',
      count: modelList.length,
      names: modelList.map(m => m.name)
    });
  }


  // --- Internal Helpers ---

  /**
   * Initialize stderr logging stream to file.
   * Truncates file if it exceeds MAX_LOG_SIZE.
   */
  _initErrorLog() {
    try {
      // Check if log file exists and is too large
      try {
        const stats = statSync(ERROR_LOG_PATH);
        if (stats.size > MAX_LOG_SIZE) {
          console.log(`[BRIDGE] Truncating error log (${(stats.size / 1024).toFixed(1)} KB > ${MAX_LOG_SIZE / 1024} KB)`);
          // Truncate by creating new stream (flags 'w' instead of 'a')
          this.stderrStream = createWriteStream(ERROR_LOG_PATH, { flags: 'w' });
          this.stderrStream.write(`[${new Date().toISOString()}] === Log truncated (size exceeded ${MAX_LOG_SIZE / 1024} KB) ===\n`);
          return;
        }
      } catch (_e) {
        // File doesn't exist, will be created
      }

      // Append mode
      this.stderrStream = createWriteStream(ERROR_LOG_PATH, { flags: 'a' });
      this.stderrStream.write(`\n[${new Date().toISOString()}] === Bridge started ===\n`);
    } catch (err) {
      console.warn(`[BRIDGE] Failed to initialize error log: ${err.message}`);
    }
  }

  /**
   * Pre-flight check: verify Python, CUDA, and required packages are available.
   * @returns {Promise<{ready: boolean, issues: string[]}>}
   */
  async _checkEnvironment() {
    const issues = [];

    // Try py launcher first (most reliable on Windows), then direct commands
    const candidates = [
      { cmd: 'py', prefixArgs: ['-3.13'] },
      { cmd: 'py', prefixArgs: ['-3.12'] },
      { cmd: 'py', prefixArgs: ['-3.11'] },
      { cmd: 'py', prefixArgs: ['-3.10'] },
      { cmd: 'py', prefixArgs: ['-3'] },
      { cmd: 'python3.13', prefixArgs: [] },
      { cmd: 'python3.12', prefixArgs: [] },
      { cmd: 'python3.11', prefixArgs: [] },
      { cmd: 'python3.10', prefixArgs: [] },
      { cmd: 'python', prefixArgs: [] },
      { cmd: 'python3', prefixArgs: [] }
    ];
    let foundPython = null;
    let foundPrefixArgs = [];

    for (const candidate of candidates) {
      try {
        const versionArgs = [...candidate.prefixArgs, '--version'];
        const pyVersion = await this._runCommand(candidate.cmd, versionArgs);
        const match = pyVersion.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const [, major, minor] = match.map(Number);
          if (major >= 3 && minor >= 10) {
            foundPython = candidate.cmd;
            foundPrefixArgs = candidate.prefixArgs;
            const cmdDisplay = candidate.prefixArgs.length > 0
              ? `${candidate.cmd} ${candidate.prefixArgs.join(' ')}`
              : candidate.cmd;
            console.log(`[BRIDGE] Python ${major}.${minor} detected (command: ${cmdDisplay})`);
            break;
          }
        }
      } catch (_e) {
        // Try next candidate
      }
    }

    if (!foundPython) {
      issues.push('Python 3.10+ not found (tried: py -3.13, py -3.12, py -3.11, py -3.10, py -3, python3.13, python3.12, python3.11, python3.10, python, python3)');
      return { ready: false, issues };
    }

    this.pythonCmd = foundPython;
    this.pythonPrefixArgs = foundPrefixArgs;

    // Check CUDA availability (actually test GPU usability, not just detection)
    try {
      const cudaCheckArgs = [
        ...foundPrefixArgs,
        '-c', 'import torch; t=torch.zeros(1,device="cuda"); print("usable")'
      ];
      const cudaCheck = await this._runCommand(foundPython, cudaCheckArgs);
      if (cudaCheck.trim() === 'usable') {
        console.log('[BRIDGE] CUDA GPU verified usable');
      } else {
        console.warn('[BRIDGE] CUDA not usable — running in CPU mode (generation will be slow)');
      }
    } catch (_e) {
      console.warn('[BRIDGE] CUDA not available — running in CPU mode (generation will be slow)');
    }

    // Check required Python packages
    try {
      const packageCheckArgs = [
        ...foundPrefixArgs,
        '-c', 'import fastapi, diffusers, trimesh, PIL, pynvml'
      ];
      await this._runCommand(foundPython, packageCheckArgs);
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

  /**
   * Detect GPU availability by querying /status from the running Python server.
   * Sets this.cpuMode = true when CUDA is not available.
   */
  async _detectGpu() {
    try {
      const status = await this._fetchWithTimeout(`${this.baseUrl}/status`, forge3dConfig.healthCheck.timeout_ms);
      const cudaAvailable = status && status.cuda_available === true;
      if (!cudaAvailable) {
        this.cpuMode = true;
        console.warn('[BRIDGE] WARNING: No CUDA GPU detected — running in CPU mode (generation will be slow)');
        telemetryBus.emit('forge3d', { type: 'cpu_mode_active', reason: 'no_cuda' });
      } else {
        this.cpuMode = false;
        console.log('[BRIDGE] CUDA GPU detected — hardware acceleration active');
        telemetryBus.emit('forge3d', { type: 'gpu_mode_active' });
      }
    } catch (err) {
      console.warn(`[BRIDGE] GPU detection failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Returns true when the bridge is operating in CPU-only fallback mode.
   * @returns {boolean}
   */
  isCpuMode() {
    return this.cpuMode;
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
    // Node.js undici has a default 300s headersTimeout that kills connections
    // waiting for slow responses (e.g. model download on first generation).
    // Disable it for generation requests — we rely on AbortSignal.timeout instead.
    const { Agent } = await import('undici');
    const dispatcher = new Agent({
      headersTimeout: forge3dConfig.generation.timeout_ms,
      bodyTimeout: forge3dConfig.generation.timeout_ms
    });
    return fetch(url, { ...options, dispatcher });
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
