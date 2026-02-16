/**
 * ModelDownloader - AI Model Download Manager for ForgePipeline
 *
 * Manages downloading AI models from Hugging Face Hub.
 * Tracks progress, supports resume via HTTP Range headers,
 * verifies completeness with .download_complete markers.
 *
 * STATUS: New in Phase 8 Week 4. Core download logic complete,
 *         but not yet tested against live HuggingFace downloads.
 *
 * TODO(P0): Test downloadModel() end-to-end with real HuggingFace repos
 * TODO(P0): Verify InstantMesh and SDXL actual file lists match repo contents
 *           (current files[] may be incomplete — diffusers downloads many shards)
 * TODO(P1): Add SHA-256 content hash verification (currently hashes file sizes only)
 * TODO(P1): Coordinate with python/setup.py — it has its own download logic;
 *           decide single source of truth for model downloads
 * TODO(P1): Add download speed throttling option for metered connections
 * TODO(P2): Support HuggingFace auth token for gated models
 * TODO(P2): Docker container fallback for environments where native setup fails
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 16, 2026
 */

import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { createHash } from 'crypto';
import {
  existsSync, mkdirSync, statSync,
  writeFileSync, readFileSync, unlinkSync,
  readdirSync, rmSync, renameSync, createWriteStream
} from 'fs';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROJECT_ROOT = join(__dirname, '..', '..');
const DEFAULT_MODELS_DIR = join(PROJECT_ROOT, 'data', 'models');
const HF_DOWNLOAD_BASE = 'https://huggingface.co';
const PROGRESS_INTERVAL = 2000; // Emit progress every 2 seconds

class ModelDownloader extends EventEmitter {
  constructor() {
    super();
    this.modelsDir = DEFAULT_MODELS_DIR;

    // Known models with metadata
    this.models = new Map([
      ['instantmesh', {
        name: 'InstantMesh',
        repo: 'TencentARC/InstantMesh',
        description: 'Single image to 3D mesh generation',
        files: ['model.safetensors'],
        totalSize: 1_500_000_000
      }],
      ['sdxl', {
        name: 'Stable Diffusion XL',
        repo: 'stabilityai/stable-diffusion-xl-base-1.0',
        description: 'Text to image generation',
        files: ['model_index.json', 'scheduler/scheduler_config.json'],
        totalSize: 7_000_000_000
      }]
    ]);

    // Active download tracking: modelName -> { controller, progress }
    this.activeDownloads = new Map();

    // Completed/failed download history
    this.downloadHistory = [];
  }

  /**
   * Initialize the downloader: create directories, scan existing models.
   */
  async initialize() {
    console.log('[DOWNLOAD] Initializing model downloader...');

    // Ensure models directory exists
    if (!existsSync(this.modelsDir)) {
      mkdirSync(this.modelsDir, { recursive: true });
      console.log(`[DOWNLOAD] Created models directory: ${this.modelsDir}`);
    }

    // Scan for existing models
    const installed = this.getInstalledModels();
    const installedCount = installed.filter(m => m.installed).length;
    console.log(`[DOWNLOAD] Models directory: ${this.modelsDir}`);
    console.log(`[DOWNLOAD] Known models: ${this.models.size}, installed: ${installedCount}`);

    return true;
  }

  /**
   * Get status of all known models.
   * @returns {Array<{name: string, installed: boolean, size: number, completedAt: string|null}>}
   */
  getInstalledModels() {
    const results = [];

    for (const [key, model] of this.models) {
      const modelDir = join(this.modelsDir, key);
      const marker = join(modelDir, '.download_complete');
      const installed = existsSync(marker);

      let size = 0;
      let completedAt = null;

      if (installed) {
        try {
          const markerStat = statSync(marker);
          completedAt = markerStat.mtime.toISOString();
        } catch (_e) {
          // Marker exists but can't stat — still counts as installed
        }

        // Sum file sizes in model directory
        try {
          size = this._getDirSize(modelDir);
        } catch (_e) {
          // Directory might have permission issues
        }
      }

      results.push({
        name: model.name,
        key,
        installed,
        size,
        completedAt
      });
    }

    return results;
  }

  /**
   * Check if a specific model is installed (has .download_complete marker).
   * @param {string} modelName - Model key (e.g. 'instantmesh')
   * @returns {boolean}
   */
  isModelInstalled(modelName) {
    const modelDir = join(this.modelsDir, modelName);
    const marker = join(modelDir, '.download_complete');
    return existsSync(marker);
  }

  /**
   * Download all files for a model from HuggingFace.
   * @param {string} modelName - Model key (e.g. 'instantmesh')
   * @returns {Promise<boolean>} true if download completed successfully
   */
  async downloadModel(modelName) {
    const model = this.models.get(modelName);
    if (!model) {
      throw new Error(`Unknown model: ${modelName}`);
    }

    if (this.activeDownloads.has(modelName)) {
      throw new Error(`Download already in progress for ${modelName}`);
    }

    if (this.isModelInstalled(modelName)) {
      console.log(`[DOWNLOAD] ${model.name} is already installed`);
      return true;
    }

    const modelDir = join(this.modelsDir, modelName);
    if (!existsSync(modelDir)) {
      mkdirSync(modelDir, { recursive: true });
    }

    const controller = new AbortController();
    const progress = {
      model: modelName,
      filesTotal: model.files.length,
      filesCompleted: 0,
      currentFile: null,
      bytesDownloaded: 0,
      totalBytes: model.totalSize,
      speed: 0,
      eta: 0,
      startedAt: new Date().toISOString()
    };

    this.activeDownloads.set(modelName, { controller, progress });

    console.log(`[DOWNLOAD] Starting download: ${model.name} (${model.files.length} files)`);
    telemetryBus.emit('forge3d_download_start', {
      model: modelName,
      files: model.files.length,
      totalSize: model.totalSize
    });

    try {
      for (const file of model.files) {
        if (controller.signal.aborted) {
          throw new Error('Download cancelled');
        }

        progress.currentFile = file;
        await this._downloadFile(modelName, model.repo, file, modelDir, controller, progress);
        progress.filesCompleted++;
      }

      // Create .download_complete marker with SHA-256 hash of file listing
      const hash = this._computeMarkerHash(modelDir, model.files);
      const marker = join(modelDir, '.download_complete');
      writeFileSync(marker, JSON.stringify({
        model: modelName,
        repo: model.repo,
        files: model.files,
        hash,
        completedAt: new Date().toISOString()
      }, null, 2), 'utf8');

      console.log(`[DOWNLOAD] ${model.name} download complete`);
      telemetryBus.emit('forge3d_download_complete', {
        model: modelName,
        duration: Date.now() - new Date(progress.startedAt).getTime()
      });

      this.downloadHistory.push({
        model: modelName,
        status: 'completed',
        completedAt: new Date().toISOString()
      });

      this.emit('download_complete', { model: modelName });
      return true;

    } catch (err) {
      const wasCancelled = controller.signal.aborted;
      const status = wasCancelled ? 'cancelled' : 'failed';

      console.error(`[DOWNLOAD] ${model.name} download ${status}: ${err.message}`);
      telemetryBus.emit('forge3d_download_failed', {
        model: modelName,
        error: err.message,
        cancelled: wasCancelled
      });
      errorHandler.report('forge3d_error', err, {
        operation: 'model_download',
        model: modelName
      });

      this.downloadHistory.push({
        model: modelName,
        status,
        error: err.message,
        failedAt: new Date().toISOString()
      });

      this.emit('download_failed', { model: modelName, error: err.message });
      return false;

    } finally {
      this.activeDownloads.delete(modelName);
    }
  }

  /**
   * Cancel an active download.
   * @param {string} modelName - Model key
   * @returns {boolean} true if a download was cancelled
   */
  async cancelDownload(modelName) {
    const active = this.activeDownloads.get(modelName);
    if (!active) {
      console.log(`[DOWNLOAD] No active download for ${modelName}`);
      return false;
    }

    console.log(`[DOWNLOAD] Cancelling download: ${modelName}`);
    active.controller.abort();

    // Clean up temp files
    const modelDir = join(this.modelsDir, modelName);
    this._cleanupTempFiles(modelDir);

    return true;
  }

  /**
   * Get current download progress or null if not downloading.
   * @param {string} modelName - Model key
   * @returns {Object|null} Progress data
   */
  getDownloadProgress(modelName) {
    const active = this.activeDownloads.get(modelName);
    if (!active) {
      return null;
    }
    return { ...active.progress };
  }

  /**
   * Verify a model's integrity by checking files and .download_complete marker.
   * @param {string} modelName - Model key
   * @returns {Promise<{valid: boolean, details: Object}>}
   */
  async verifyModel(modelName) {
    const model = this.models.get(modelName);
    if (!model) {
      return { valid: false, details: { error: `Unknown model: ${modelName}` } };
    }

    const modelDir = join(this.modelsDir, modelName);
    const marker = join(modelDir, '.download_complete');

    if (!existsSync(marker)) {
      return { valid: false, details: { error: 'No .download_complete marker' } };
    }

    // Check each expected file exists
    const missingFiles = [];
    for (const file of model.files) {
      const filePath = join(modelDir, file);
      if (!existsSync(filePath)) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length > 0) {
      return {
        valid: false,
        details: { error: 'Missing files', missingFiles }
      };
    }

    // Verify hash matches
    const currentHash = this._computeMarkerHash(modelDir, model.files);
    let markerData = {};
    try {
      markerData = JSON.parse(readFileSync(marker, 'utf8'));
    } catch (_e) {
      // Old-style marker (just 'ok') — still valid if files exist
      return { valid: true, details: { hashVerified: false, legacy: true } };
    }

    const hashMatch = markerData.hash === currentHash;

    return {
      valid: true,
      details: {
        hashVerified: hashMatch,
        completedAt: markerData.completedAt || null,
        files: model.files.length
      }
    };
  }

  /**
   * Delete a model's files and marker.
   * @param {string} modelName - Model key
   * @returns {Promise<boolean>}
   */
  async deleteModel(modelName) {
    if (this.activeDownloads.has(modelName)) {
      throw new Error(`Cannot delete ${modelName} while download is in progress`);
    }

    const modelDir = join(this.modelsDir, modelName);
    if (!existsSync(modelDir)) {
      console.log(`[DOWNLOAD] Model directory does not exist: ${modelName}`);
      return false;
    }

    console.log(`[DOWNLOAD] Deleting model: ${modelName}`);
    rmSync(modelDir, { recursive: true, force: true });
    console.log(`[DOWNLOAD] Deleted: ${modelDir}`);

    return true;
  }

  /**
   * Cancel all active downloads and clean up.
   */
  async shutdown() {
    console.log(`[DOWNLOAD] Shutting down (${this.activeDownloads.size} active downloads)`);

    for (const [modelName, active] of this.activeDownloads) {
      console.log(`[DOWNLOAD] Cancelling: ${modelName}`);
      active.controller.abort();
    }

    this.activeDownloads.clear();
    console.log('[DOWNLOAD] Shutdown complete');
  }

  // --- Internal Helpers ---

  /**
   * Download a single file from HuggingFace with progress tracking.
   * @private
   */
  async _downloadFile(modelName, repo, filename, modelDir, controller, progress) {
    const url = `${HF_DOWNLOAD_BASE}/${repo}/resolve/main/${filename}`;
    const destPath = join(modelDir, filename);
    const tempPath = destPath + '.tmp';

    // Ensure subdirectory exists for nested files like scheduler/scheduler_config.json
    const destDir = dirname(destPath);
    if (!existsSync(destDir)) {
      mkdirSync(destDir, { recursive: true });
    }

    // Check for partial download (resume support)
    let startByte = 0;
    if (existsSync(tempPath)) {
      const tempStat = statSync(tempPath);
      startByte = tempStat.size;
      console.log(`[DOWNLOAD] Resuming ${filename} from byte ${startByte}`);
    }

    const headers = {};
    if (startByte > 0) {
      headers['Range'] = `bytes=${startByte}-`;
    }

    console.log(`[DOWNLOAD] Downloading: ${filename} from ${repo}`);

    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: 'follow'
    });

    if (!response.ok && response.status !== 206) {
      throw new Error(`HTTP ${response.status} downloading ${filename}: ${response.statusText}`);
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
    const totalFileBytes = startByte + contentLength;

    // Stream to temp file
    const writer = createWriteStream(tempPath, { flags: startByte > 0 ? 'a' : 'w' });
    const reader = response.body.getReader();

    let bytesWritten = startByte;
    let lastProgressTime = Date.now();
    let lastProgressBytes = startByte;

    try {
      let done = false;
      while (!done) {
        const result = await reader.read();
        done = result.done;
        const value = result.value;
        if (done) break;

        writer.write(Buffer.from(value));
        bytesWritten += value.byteLength;
        progress.bytesDownloaded += value.byteLength;

        // Emit progress at intervals
        const now = Date.now();
        if (now - lastProgressTime >= PROGRESS_INTERVAL) {
          const elapsed = (now - lastProgressTime) / 1000;
          const bytesSinceLastProgress = bytesWritten - lastProgressBytes;
          const speed = bytesSinceLastProgress / elapsed;
          const remaining = totalFileBytes - bytesWritten;
          const eta = speed > 0 ? Math.ceil(remaining / speed) : 0;

          progress.speed = speed;
          progress.eta = eta;

          this.emit('download_progress', {
            model: modelName,
            file: filename,
            bytesDownloaded: bytesWritten,
            totalBytes: totalFileBytes,
            speed,
            eta
          });

          telemetryBus.emit('forge3d_download_progress', {
            model: modelName,
            file: filename,
            percent: totalFileBytes > 0
              ? Math.round(bytesWritten / totalFileBytes * 100)
              : 0
          });

          lastProgressTime = now;
          lastProgressBytes = bytesWritten;
        }
      }
    } finally {
      writer.end();
      await new Promise((resolve) => writer.on('finish', resolve));
    }

    // Rename temp file to final destination
    renameSync(tempPath, destPath);
    console.log(`[DOWNLOAD] Completed: ${filename} (${bytesWritten} bytes)`);
  }

  /**
   * Compute SHA-256 hash of file listing for the marker.
   * @private
   */
  _computeMarkerHash(modelDir, files) {
    const hash = createHash('sha256');
    for (const file of files) {
      const filePath = join(modelDir, file);
      if (existsSync(filePath)) {
        const stat = statSync(filePath);
        hash.update(`${file}:${stat.size}`);
      } else {
        hash.update(`${file}:missing`);
      }
    }
    return hash.digest('hex');
  }

  /**
   * Get total size of a directory in bytes.
   * @private
   */
  _getDirSize(dirPath) {
    let total = 0;
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isFile()) {
        total += statSync(fullPath).size;
      } else if (entry.isDirectory()) {
        total += this._getDirSize(fullPath);
      }
    }
    return total;
  }

  /**
   * Clean up .tmp files in a model directory.
   * @private
   */
  _cleanupTempFiles(modelDir) {
    if (!existsSync(modelDir)) return;

    try {
      const entries = readdirSync(modelDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.tmp')) {
          unlinkSync(join(modelDir, entry.name));
          console.log(`[DOWNLOAD] Cleaned up temp file: ${entry.name}`);
        }
      }
    } catch (err) {
      console.warn(`[DOWNLOAD] Cleanup error: ${err.message}`);
    }
  }
}

// Singleton
const modelDownloader = new ModelDownloader();
export default modelDownloader;
export { ModelDownloader };

// --test block (guarded so imports don't trigger it)
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[DOWNLOAD] Running self-test...\n');

  try {
    // Test 1: Instantiation
    console.log('[TEST] Test 1: Instantiation...');
    const downloader = new ModelDownloader();
    console.assert(downloader.models.size === 2, 'Should have 2 known models');
    console.assert(downloader.activeDownloads.size === 0, 'Should have no active downloads');
    console.assert(downloader.downloadHistory.length === 0, 'Should have empty history');
    console.log('[TEST] Instantiation: PASSED');

    // Test 2: Initialize
    console.log('\n[TEST] Test 2: Initialize...');
    await downloader.initialize();
    console.assert(existsSync(downloader.modelsDir), 'Models directory should exist');
    console.log('[TEST] Initialize: PASSED');

    // Test 3: getInstalledModels
    console.log('\n[TEST] Test 3: getInstalledModels...');
    const installed = downloader.getInstalledModels();
    console.assert(Array.isArray(installed), 'Should return array');
    console.assert(installed.length === 2, `Should list 2 models, got ${installed.length}`);
    for (const model of installed) {
      console.assert(typeof model.name === 'string', 'Model should have name');
      console.assert(typeof model.installed === 'boolean', 'Model should have installed flag');
      console.log(`  ${model.key}: installed=${model.installed}`);
    }
    console.log('[TEST] getInstalledModels: PASSED');

    // Test 4: isModelInstalled
    console.log('\n[TEST] Test 4: isModelInstalled...');
    const instantmeshInstalled = downloader.isModelInstalled('instantmesh');
    console.assert(typeof instantmeshInstalled === 'boolean', 'Should return boolean');
    console.log(`  instantmesh installed: ${instantmeshInstalled}`);
    console.log('[TEST] isModelInstalled: PASSED');

    // Test 5: getDownloadProgress (no active download)
    console.log('\n[TEST] Test 5: getDownloadProgress (idle)...');
    const progress = downloader.getDownloadProgress('instantmesh');
    console.assert(progress === null, 'Should return null when no download active');
    console.log('[TEST] getDownloadProgress: PASSED');

    // Test 6: verifyModel
    console.log('\n[TEST] Test 6: verifyModel...');
    const verification = await downloader.verifyModel('instantmesh');
    console.assert(typeof verification.valid === 'boolean', 'Should have valid flag');
    console.assert(typeof verification.details === 'object', 'Should have details');
    console.log(`  instantmesh valid: ${verification.valid}`);
    console.log('[TEST] verifyModel: PASSED');

    // Test 7: Unknown model errors
    console.log('\n[TEST] Test 7: Unknown model handling...');
    try {
      await downloader.downloadModel('nonexistent');
      throw new Error('Should have thrown for unknown model');
    } catch (err) {
      console.assert(err.message.includes('Unknown model'), `Expected 'Unknown model' error, got: ${err.message}`);
    }
    const unknownVerify = await downloader.verifyModel('nonexistent');
    console.assert(unknownVerify.valid === false, 'Unknown model should not be valid');
    console.log('[TEST] Unknown model handling: PASSED');

    // Test 8: Shutdown
    console.log('\n[TEST] Test 8: Shutdown...');
    await downloader.shutdown();
    console.assert(downloader.activeDownloads.size === 0, 'Active downloads should be empty after shutdown');
    console.log('[TEST] Shutdown: PASSED');

    console.log('\n[TEST] All 8 tests PASSED!');
    console.log('[DOWNLOAD] Self-test passed');
    process.exit(0);

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
