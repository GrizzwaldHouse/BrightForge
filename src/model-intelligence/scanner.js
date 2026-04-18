/**
 * Model Intelligence Scanner - Core discovery engine
 *
 * Scans known locations (Ollama, HuggingFace, LM Studio),
 * detects runtimes, maps storage volumes, and classifies model files.
 * Extends EventEmitter for real-time progress events.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import { dirname, join, basename, extname } from 'path';
import { openSync, readSync, closeSync, readdirSync, statSync, existsSync } from 'fs';
import { readdir, stat } from 'fs/promises';
import { execFile } from 'child_process';
import { randomUUID } from 'crypto';
import configLoader from './config-loader.js';
import modelDb from './database.js';
import {
  EVENT_TYPES,
  scanStarted,
  scanProgress,
  fileDetected,
  fileClassified,
  runtimeDetected,
  storageDetected,
  scanCompleted,
  scanFailed
} from './event-types.js';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class ModelScanner extends EventEmitter {
  constructor() {
    super();
    this._scanning = false;
  }

  /**
   * Run an instant scan of known model locations only.
   * Fast: checks Ollama, HuggingFace, LM Studio dirs + detects runtimes + volumes.
   */
  async runInstantScan() {
    if (this._scanning) {
      throw new Error('Scan already in progress');
    }

    this._scanning = true;
    const scanId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('model_intel_scan', { scanType: 'instant' });

    modelDb.insertScan({ id: scanId, type: 'instant' });
    this.emit(EVENT_TYPES.SCAN_STARTED, scanStarted(scanId, 'instant'));
    console.log(`[MODEL-SCAN] Instant scan started: ${scanId}`);

    let filesFound = 0;
    let runtimesFound = 0;
    let errors = 0;

    try {
      // Phase 1: Detect runtimes
      this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, 'runtimes', 0, 4));
      runtimesFound = await this._detectRuntimes(scanId);

      // Phase 2: Scan Ollama models
      this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, 'ollama', 1, 4));
      const ollamaCount = await this._scanOllamaModels(scanId);
      filesFound += ollamaCount;

      // Phase 3: Scan HuggingFace cache
      this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, 'huggingface', 2, 4));
      const hfCount = await this._scanHuggingFaceCache(scanId);
      filesFound += hfCount;

      // Phase 4: Scan LM Studio models
      this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, 'lmstudio', 3, 4));
      const lmsCount = await this._scanLMStudioModels(scanId);
      filesFound += lmsCount;

      // Phase 5: Detect storage volumes
      this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, 'storage', 4, 4));
      await this._detectStorageVolumes(scanId);

      // Complete
      const stats = { filesFound, runtimesFound, errors };
      modelDb.updateScan(scanId, { status: 'completed', files_found: filesFound, runtimes_found: runtimesFound, errors });
      this.emit(EVENT_TYPES.SCAN_COMPLETED, scanCompleted(scanId, stats));
      endTimer({ status: 'success', filesFound, runtimesFound });
      console.log(`[MODEL-SCAN] Instant scan completed: ${filesFound} files, ${runtimesFound} runtimes`);

      return { scanId, ...stats };
    } catch (err) {
      errors++;
      modelDb.updateScan(scanId, { status: 'failed', files_found: filesFound, errors });
      this.emit(EVENT_TYPES.SCAN_FAILED, scanFailed(scanId, err));
      endTimer({ status: 'failed' });
      errorHandler.report('model_intel_error', err, { scanId, scanType: 'instant' });
      console.error(`[MODEL-SCAN] Instant scan failed: ${err.message}`);
      throw err;
    } finally {
      this._scanning = false;
    }
  }

  /**
   * Run a deep scan on specified directories (recursive walk).
   */
  async runDeepScan(dirs = []) {
    if (this._scanning) {
      throw new Error('Scan already in progress');
    }

    this._scanning = true;
    const scanId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('model_intel_scan', { scanType: 'deep' });
    const extensions = configLoader.getExtensions();

    modelDb.insertScan({ id: scanId, type: 'deep', metadata: { dirs } });
    this.emit(EVENT_TYPES.SCAN_STARTED, scanStarted(scanId, 'deep'));
    console.log(`[MODEL-SCAN] Deep scan started: ${scanId} (${dirs.length} dirs)`);

    let filesFound = 0;
    let errors = 0;

    try {
      for (let i = 0; i < dirs.length; i++) {
        const dir = dirs[i];
        this.emit(EVENT_TYPES.SCAN_PROGRESS, scanProgress(scanId, `scanning:${dir}`, i, dirs.length));

        try {
          const files = await this._walkDirectory(dir, extensions);
          for (const filePath of files) {
            try {
              const info = await this._classifyModelFile(filePath);
              modelDb.upsertModelFile({
                path: filePath,
                filename: basename(filePath),
                extension: extname(filePath).toLowerCase(),
                size_bytes: info.size,
                format: info.format,
                architecture: info.architecture,
                quantization: info.quantization,
                source: 'unknown'
              });
              filesFound++;
              this.emit(EVENT_TYPES.FILE_DETECTED, fileDetected(scanId, filePath, info.size));
              this.emit(EVENT_TYPES.FILE_CLASSIFIED, fileClassified(scanId, filePath, info.format, 'unknown'));
            } catch (fileErr) {
              errors++;
              console.warn(`[MODEL-SCAN] Error classifying ${filePath}: ${fileErr.message}`);
            }
          }
        } catch (dirErr) {
          errors++;
          console.warn(`[MODEL-SCAN] Error walking ${dir}: ${dirErr.message}`);
        }
      }

      const stats = { filesFound, errors };
      modelDb.updateScan(scanId, { status: 'completed', files_found: filesFound, errors });
      this.emit(EVENT_TYPES.SCAN_COMPLETED, scanCompleted(scanId, stats));
      endTimer({ status: 'success', filesFound });
      console.log(`[MODEL-SCAN] Deep scan completed: ${filesFound} files`);

      return { scanId, ...stats };
    } catch (err) {
      errors++;
      modelDb.updateScan(scanId, { status: 'failed', files_found: filesFound, errors });
      this.emit(EVENT_TYPES.SCAN_FAILED, scanFailed(scanId, err));
      endTimer({ status: 'failed' });
      errorHandler.report('model_intel_error', err, { scanId, scanType: 'deep' });
      console.error(`[MODEL-SCAN] Deep scan failed: ${err.message}`);
      throw err;
    } finally {
      this._scanning = false;
    }
  }

  /**
   * Scan Ollama models via API and manifest files.
   */
  async _scanOllamaModels(scanId) {
    const locations = configLoader.getKnownLocations();
    const ollamaConfig = locations.ollama;
    let count = 0;

    // Try Ollama API first
    try {
      const apiUrl = ollamaConfig?.api_url || 'http://127.0.0.1:11434';
      const response = await fetch(`${apiUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });

      if (response.ok) {
        const data = await response.json();
        const models = data.models || [];

        for (const model of models) {
          const sizeBytes = model.size || 0;
          const name = model.name || 'unknown';

          // Determine quantization from model name
          const quantization = this._extractQuantization(name);

          modelDb.upsertModelFile({
            path: `ollama://${name}`,
            filename: name,
            extension: '.gguf',
            size_bytes: sizeBytes,
            format: 'GGUF',
            architecture: model.details?.family || null,
            parameter_count: model.details?.parameter_size || null,
            quantization,
            source: 'ollama'
          });
          count++;
          this.emit(EVENT_TYPES.FILE_DETECTED, fileDetected(scanId, `ollama://${name}`, sizeBytes));
          this.emit(EVENT_TYPES.FILE_CLASSIFIED, fileClassified(scanId, `ollama://${name}`, 'GGUF', 'ollama'));
        }

        console.log(`[MODEL-SCAN] Ollama API: found ${models.length} models`);
      }
    } catch (err) {
      console.warn(`[MODEL-SCAN] Ollama API unavailable: ${err.message}`);
    }

    // Also scan blob directory for raw files
    const blobDir = ollamaConfig?.blob_dir;
    if (blobDir && existsSync(blobDir)) {
      try {
        const entries = readdirSync(blobDir);
        for (const entry of entries) {
          const fullPath = join(blobDir, entry);
          try {
            const stats = statSync(fullPath);
            if (stats.isFile() && stats.size > (configLoader.getConfig().scanner?.min_model_size || 1048576)) {
              // Only count blobs not already found via API
              const existing = modelDb.getModelFiles({ source: 'ollama' });
              const alreadyFound = existing.some(f => f.path === fullPath);
              if (!alreadyFound) {
                modelDb.upsertModelFile({
                  path: fullPath,
                  filename: entry,
                  extension: '',
                  size_bytes: stats.size,
                  format: 'GGUF',
                  source: 'ollama'
                });
                count++;
              }
            }
          } catch (_e) {
            // Skip inaccessible files
          }
        }
      } catch (err) {
        console.warn(`[MODEL-SCAN] Error scanning Ollama blobs: ${err.message}`);
      }
    }

    return count;
  }

  /**
   * Scan HuggingFace hub cache directory.
   */
  async _scanHuggingFaceCache(scanId) {
    const locations = configLoader.getKnownLocations();
    const cacheDir = locations.huggingface?.cache_dir;
    const extensions = configLoader.getExtensions();
    let count = 0;

    if (!cacheDir || !existsSync(cacheDir)) {
      console.log('[MODEL-SCAN] HuggingFace cache not found, skipping');
      return 0;
    }

    try {
      const modelDirs = readdirSync(cacheDir).filter(d => d.startsWith('models--'));

      for (const modelDir of modelDirs) {
        const snapshotsDir = join(cacheDir, modelDir, 'snapshots');
        if (!existsSync(snapshotsDir)) continue;

        const snapshots = readdirSync(snapshotsDir);
        for (const snapshot of snapshots) {
          const snapshotPath = join(snapshotsDir, snapshot);
          try {
            const files = readdirSync(snapshotPath);
            for (const file of files) {
              const ext = extname(file).toLowerCase();
              if (!extensions.includes(ext)) continue;

              const fullPath = join(snapshotPath, file);
              try {
                const stats = statSync(fullPath);
                if (!stats.isFile()) continue;

                const info = await this._classifyModelFile(fullPath);
                const _modelName = modelDir.replace('models--', '').replace(/--/g, '/');

                modelDb.upsertModelFile({
                  path: fullPath,
                  filename: file,
                  extension: ext,
                  size_bytes: stats.size,
                  format: info.format,
                  architecture: info.architecture,
                  quantization: info.quantization,
                  source: 'huggingface'
                });
                count++;
                this.emit(EVENT_TYPES.FILE_DETECTED, fileDetected(scanId, fullPath, stats.size));
                this.emit(EVENT_TYPES.FILE_CLASSIFIED, fileClassified(scanId, fullPath, info.format, 'huggingface'));
              } catch (_e) {
                // Skip inaccessible files
              }
            }
          } catch (_e) {
            // Skip inaccessible snapshot dirs
          }
        }
      }

      console.log(`[MODEL-SCAN] HuggingFace cache: found ${count} model files`);
    } catch (err) {
      console.warn(`[MODEL-SCAN] Error scanning HuggingFace cache: ${err.message}`);
    }

    return count;
  }

  /**
   * Scan LM Studio models directory.
   */
  async _scanLMStudioModels(scanId) {
    const locations = configLoader.getKnownLocations();
    const modelsDir = locations.lmstudio?.models_dir;
    const extensions = configLoader.getExtensions();
    let count = 0;

    if (!modelsDir || !existsSync(modelsDir)) {
      console.log('[MODEL-SCAN] LM Studio models not found, skipping');
      return 0;
    }

    try {
      const files = await this._walkDirectory(modelsDir, extensions);

      for (const filePath of files) {
        try {
          const stats = statSync(filePath);
          const info = await this._classifyModelFile(filePath);

          modelDb.upsertModelFile({
            path: filePath,
            filename: basename(filePath),
            extension: extname(filePath).toLowerCase(),
            size_bytes: stats.size,
            format: info.format,
            architecture: info.architecture,
            quantization: info.quantization,
            source: 'lmstudio'
          });
          count++;
          this.emit(EVENT_TYPES.FILE_DETECTED, fileDetected(scanId, filePath, stats.size));
          this.emit(EVENT_TYPES.FILE_CLASSIFIED, fileClassified(scanId, filePath, info.format, 'lmstudio'));
        } catch (_e) {
          // Skip inaccessible files
        }
      }

      console.log(`[MODEL-SCAN] LM Studio: found ${count} model files`);
    } catch (err) {
      console.warn(`[MODEL-SCAN] Error scanning LM Studio: ${err.message}`);
    }

    return count;
  }

  /**
   * Detect installed AI runtimes (Ollama, Python, LM Studio).
   */
  async _detectRuntimes(scanId) {
    const runtimeDefs = configLoader.getRuntimes();
    let count = 0;

    for (const [_key, def] of Object.entries(runtimeDefs)) {
      for (const cmd of (def.check_commands || [])) {
        try {
          const result = await this._execCommand(cmd[0], cmd.slice(1));
          const version = this._parseVersion(result.stdout || result.stderr || '');

          modelDb.upsertRuntime({
            name: def.name,
            version,
            path: cmd[0],
            status: 'active'
          });
          count++;
          this.emit(EVENT_TYPES.RUNTIME_DETECTED, runtimeDetected(scanId, def.name, version, cmd[0]));
          console.log(`[MODEL-SCAN] Runtime detected: ${def.name} ${version}`);
          break; // Found this runtime, move to next
        } catch (_err) {
          // Command not found or failed, try next
        }
      }
    }

    return count;
  }

  /**
   * Detect storage volumes (Windows: C, D, E drives).
   */
  async _detectStorageVolumes(scanId) {
    const storageConfig = configLoader.getStorageConfig();
    const volumes = storageConfig.volumes || ['C', 'D', 'E'];

    for (const letter of volumes) {
      try {
        const result = await this._execCommand('powershell', [
          '-NoProfile', '-Command',
          `Get-Volume -DriveLetter ${letter} | Select-Object DriveLetter,FileSystemLabel,Size,SizeRemaining,FileSystem | ConvertTo-Json`
        ]);

        const info = JSON.parse(result.stdout);
        const totalBytes = info.Size || 0;
        const freeBytes = info.SizeRemaining || 0;

        modelDb.upsertStorageVolume({
          letter,
          label: info.FileSystemLabel || '',
          total_bytes: totalBytes,
          free_bytes: freeBytes,
          fs_type: info.FileSystem || 'NTFS'
        });

        this.emit(EVENT_TYPES.STORAGE_DETECTED, storageDetected(
          scanId, letter, info.FileSystemLabel || '', totalBytes, freeBytes
        ));
        console.log(`[MODEL-SCAN] Volume ${letter}: ${(totalBytes / 1e9).toFixed(1)}GB total, ${(freeBytes / 1e9).toFixed(1)}GB free`);
      } catch (err) {
        console.warn(`[MODEL-SCAN] Could not detect volume ${letter}: ${err.message}`);
      }
    }
  }

  /**
   * Recursively walk a directory for files matching given extensions.
   */
  async _walkDirectory(dir, extensions) {
    const excludeDirs = configLoader.getStorageConfig().exclude_dirs || [];
    const minSize = configLoader.getConfig().scanner?.min_model_size || 1048576;
    const results = [];

    async function walk(currentDir) {
      let entries;
      try {
        entries = await readdir(currentDir, { withFileTypes: true });
      } catch (_e) {
        return; // Skip inaccessible directories
      }

      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (excludeDirs.includes(entry.name)) continue;
          await walk(join(currentDir, entry.name));
        } else if (entry.isFile()) {
          const ext = extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            const fullPath = join(currentDir, entry.name);
            try {
              const stats = await stat(fullPath);
              if (stats.size >= minSize) {
                results.push(fullPath);
              }
            } catch (_e) {
              // Skip inaccessible files
            }
          }
        }
      }
    }

    await walk(dir);
    return results;
  }

  /**
   * Classify a model file by reading its header or inferring from name/extension.
   */
  async _classifyModelFile(filePath) {
    const ext = extname(filePath).toLowerCase();
    const name = basename(filePath).toLowerCase();
    let size = 0;

    try {
      const stats = statSync(filePath);
      size = stats.size;
    } catch (_e) {
      // Size unknown
    }

    const result = {
      format: this._extensionToFormat(ext),
      architecture: null,
      quantization: null,
      size
    };

    // Try to extract quantization from filename
    result.quantization = this._extractQuantization(name);

    // For GGUF files, read exactly 4 bytes to check header magic
    if (ext === '.gguf' && existsSync(filePath)) {
      let fd2 = -1;
      try {
        fd2 = openSync(filePath, 'r');
        const buf = Buffer.alloc(4);
        const bytesRead = readSync(fd2, buf, 0, 4, 0);
        if (bytesRead >= 4 && buf.toString('ascii', 0, 4) === 'GGUF') {
          result.format = 'GGUF';
        }
      } catch (_e) {
        // Keep extension-based format
      } finally {
        if (fd2 >= 0) { try { closeSync(fd2); } catch (_e) { /* best-effort */ } }
      }
    }

    return result;
  }

  /**
   * Map file extension to format name.
   */
  _extensionToFormat(ext) {
    const map = {
      '.gguf': 'GGUF',
      '.safetensors': 'SafeTensors',
      '.bin': 'PyTorch',
      '.pt': 'PyTorch',
      '.pth': 'PyTorch',
      '.onnx': 'ONNX',
      '.pb': 'TensorFlow',
      '.h5': 'TensorFlow',
      '.pkl': 'Pickle',
      '.mlmodel': 'CoreML',
      '.ggml': 'GGML'
    };
    return map[ext] || 'Unknown';
  }

  /**
   * Extract quantization level from model name/filename.
   */
  _extractQuantization(name) {
    const lower = name.toLowerCase();
    // Common GGUF quantization patterns
    const patterns = [
      /q[0-9]_k_[sml]/i,
      /q[0-9]_[0-9]/i,
      /q[0-9]_k/i,
      /iq[0-9]_[a-z]+/i,
      /bf16/i,
      /fp16/i,
      /(?<![a-z])f16/i,
      /(?<![a-z])f32/i,
      /int8/i,
      /int4/i
    ];

    for (const pattern of patterns) {
      const match = lower.match(pattern);
      if (match) return match[0].toUpperCase();
    }

    return null;
  }

  /**
   * Parse version string from command output.
   */
  _parseVersion(output) {
    const match = output.match(/(\d+\.\d+[.\d]*)/);
    return match ? match[1] : 'unknown';
  }

  /**
   * Execute a command and return { stdout, stderr }.
   */
  _execCommand(cmd, args = [], timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: stdout.toString().trim(), stderr: stderr.toString().trim() });
        }
      });
    });
  }

  /**
   * Check if a scan is currently in progress.
   */
  get isScanning() {
    return this._scanning;
  }
}

const scanner = new ModelScanner();
export { ModelScanner };
export default scanner;

// --test block
if (process.argv.includes('--test') && process.argv[1]?.endsWith('scanner.js')) {
  console.log('Testing ModelScanner...\n');

  try {
    let passed = 0;

    // Test 1: Scanner extends EventEmitter
    console.log('[TEST] Test 1: Scanner is EventEmitter...');
    const testScanner = new ModelScanner();
    if (!(testScanner instanceof EventEmitter)) throw new Error('Should extend EventEmitter');
    console.log('[TEST] Test 1: PASSED');
    passed++;

    // Test 2: isScanning property
    console.log('\n[TEST] Test 2: isScanning property...');
    if (testScanner.isScanning !== false) throw new Error('Should not be scanning initially');
    console.log('[TEST] Test 2: PASSED');
    passed++;

    // Test 3: Event emission works
    console.log('\n[TEST] Test 3: Event emission...');
    let captured = null;
    testScanner.on(EVENT_TYPES.SCAN_STARTED, (data) => { captured = data; });
    testScanner.emit(EVENT_TYPES.SCAN_STARTED, scanStarted('test-001', 'instant'));
    if (!captured) throw new Error('Event listener should have been called');
    if (captured.scanId !== 'test-001') throw new Error('Event data mismatch');
    console.log('[TEST] Test 3: PASSED');
    passed++;

    // Test 4: _extensionToFormat mapping
    console.log('\n[TEST] Test 4: Extension-to-format mapping...');
    if (testScanner._extensionToFormat('.gguf') !== 'GGUF') throw new Error('GGUF mapping failed');
    if (testScanner._extensionToFormat('.safetensors') !== 'SafeTensors') throw new Error('SafeTensors mapping failed');
    if (testScanner._extensionToFormat('.onnx') !== 'ONNX') throw new Error('ONNX mapping failed');
    if (testScanner._extensionToFormat('.xyz') !== 'Unknown') throw new Error('Unknown mapping failed');
    console.log('[TEST] Test 4: PASSED');
    passed++;

    // Test 5: _extractQuantization
    console.log('\n[TEST] Test 5: Quantization extraction...');
    if (testScanner._extractQuantization('llama-7b-q4_k_m.gguf') !== 'Q4_K_M') throw new Error('Q4_K_M extraction failed');
    if (testScanner._extractQuantization('model-f16.safetensors') !== 'F16') throw new Error('F16 extraction failed');
    if (testScanner._extractQuantization('model-bf16.bin') !== 'BF16') throw new Error('BF16 extraction failed');
    if (testScanner._extractQuantization('model-plain.bin') !== null) throw new Error('Should return null for no quantization');
    console.log('[TEST] Test 5: PASSED');
    passed++;

    // Test 6: _parseVersion
    console.log('\n[TEST] Test 6: Version parsing...');
    if (testScanner._parseVersion('ollama version 0.5.4') !== '0.5.4') throw new Error('Version parse failed');
    if (testScanner._parseVersion('Python 3.14.2') !== '3.14.2') throw new Error('Python version parse failed');
    if (testScanner._parseVersion('no version here') !== 'unknown') throw new Error('Should return unknown');
    console.log('[TEST] Test 6: PASSED');
    passed++;

    // Test 7: _classifyModelFile on nonexistent file
    console.log('\n[TEST] Test 7: Classify nonexistent file...');
    const info = await testScanner._classifyModelFile('C:\\fake\\model.gguf');
    if (info.format !== 'GGUF') throw new Error('Should classify by extension');
    if (info.size !== 0) throw new Error('Size should be 0 for missing file');
    console.log('[TEST] Test 7: PASSED');
    passed++;

    // Test 8: Concurrent scan prevention
    console.log('\n[TEST] Test 8: Concurrent scan prevention...');
    testScanner._scanning = true;
    try {
      await testScanner.runInstantScan();
      throw new Error('Should have thrown');
    } catch (err) {
      if (err.message !== 'Scan already in progress') throw new Error('Wrong error message');
    }
    testScanner._scanning = false;
    console.log('[TEST] Test 8: PASSED');
    passed++;

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('ModelScanner test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
