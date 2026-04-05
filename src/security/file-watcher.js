/**
 * FileWatcher - Security file integrity monitoring
 *
 * Watches project directories for file changes, credential exposure,
 * and integrity violations using SHA256 hashing. Emits telemetry events
 * and writes audit entries to a JSONL log.
 *
 * Features:
 * - Native fs.watch recursive monitoring
 * - SHA256 file hash tracking
 * - Credential file change detection
 * - Silence threshold alerting
 * - JSONL audit log with size rotation
 * - Telemetry and error handler integration
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { createHash, randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync, appendFileSync } from 'fs';
import { watch } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, extname, basename, relative } from 'path';
import { parse } from 'yaml';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class FileWatcher {
  constructor() {
    this.config = null;
    this.watcher = null;
    this.watching = false;
    this.directory = null;
    this.fileHashes = new Map();
    this.alerts = [];
    this.lastEventTime = null;
    this.silenceTimer = null;
    this._loadConfig();
  }

  /**
   * Load configuration from config/security.yaml.
   * @private
   */
  _loadConfig() {
    try {
      const configPath = join(__dirname, '../../config/security.yaml');
      if (existsSync(configPath)) {
        const raw = readFileSync(configPath, 'utf8');
        const parsed = parse(raw);
        this.config = parsed.file_watcher || {};
      } else {
        console.warn('[SECURITY] config/security.yaml not found, using defaults');
        this.config = {};
      }
    } catch (err) {
      console.error(`[SECURITY] Failed to load config: ${err.message}`);
      this.config = {};
    }

    // Apply defaults
    this.config.watch_extensions = this.config.watch_extensions || ['.js', '.py', '.ts', '.jsx', '.json', '.env', '.yaml', '.md'];
    this.config.ignore_dirs = this.config.ignore_dirs || ['node_modules', '.git', '__pycache__', 'dist', 'build', 'data', '.brightforge-backup'];
    this.config.credential_patterns = this.config.credential_patterns || ['.env', 'credentials', 'secret', 'api_key', 'token', '.pem', '.key'];
    this.config.hash_algorithm = this.config.hash_algorithm || 'sha256';
    this.config.silence_threshold_seconds = this.config.silence_threshold_seconds || 120;
    this.config.audit_log = this.config.audit_log || 'sessions/security-audit.jsonl';
    this.config.max_audit_size_mb = this.config.max_audit_size_mb || 5;
  }

  /**
   * Compute SHA256 hash for a file.
   * @private
   * @param {string} filePath - Absolute path to the file
   * @returns {string|null} Hex hash or null on error
   */
  _hashFile(filePath) {
    try {
      const content = readFileSync(filePath);
      return createHash(this.config.hash_algorithm).update(content).digest('hex');
    } catch (_err) {
      return null;
    }
  }

  /**
   * Check if a path should be ignored.
   * @private
   * @param {string} filePath - Absolute or relative path
   * @returns {boolean}
   */
  _shouldIgnore(filePath) {
    const parts = filePath.split(/[\\/]/);
    for (const dir of this.config.ignore_dirs) {
      if (parts.includes(dir)) return true;
    }
    const ext = extname(filePath);
    const name = basename(filePath);
    // For dotfiles like .env, extname returns '' but the name itself is the extension
    const effectiveExt = ext || name;
    if (effectiveExt && !this.config.watch_extensions.includes(effectiveExt)) return true;
    return false;
  }

  /**
   * Check if a file matches credential patterns.
   * @private
   * @param {string} filePath - File path to check
   * @returns {boolean}
   */
  _isCredentialFile(filePath) {
    const name = basename(filePath).toLowerCase();
    const lower = filePath.toLowerCase();
    for (const pattern of this.config.credential_patterns) {
      if (name.includes(pattern.toLowerCase()) || lower.includes(pattern.toLowerCase())) {
        return true;
      }
    }
    return false;
  }

  /**
   * Write an audit entry to the JSONL log.
   * @private
   * @param {Object} entry - Audit entry to write
   */
  _writeAuditEntry(entry) {
    try {
      const logPath = join(__dirname, '../../', this.config.audit_log);
      const logDir = dirname(logPath);
      if (!existsSync(logDir)) {
        mkdirSync(logDir, { recursive: true });
      }

      // Check file size and rotate if needed
      if (existsSync(logPath)) {
        const stats = statSync(logPath);
        const sizeMb = stats.size / (1024 * 1024);
        if (sizeMb >= this.config.max_audit_size_mb) {
          const rotatedPath = logPath + '.old';
          try {
            writeFileSync(rotatedPath, readFileSync(logPath));
            writeFileSync(logPath, '');
            console.log('[SECURITY] Audit log rotated');
          } catch (rotErr) {
            console.error(`[SECURITY] Audit log rotation failed: ${rotErr.message}`);
          }
        }
      }

      appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error(`[SECURITY] Failed to write audit entry: ${err.message}`);
      errorHandler.report('file_watcher_error', err, { action: 'write_audit' });
    }
  }

  /**
   * Add a security alert.
   * @private
   * @param {string} severity - 'info', 'warning', 'critical'
   * @param {string} message - Alert message
   * @param {Object} [context={}] - Additional context
   * @returns {string} Alert ID
   */
  _addAlert(severity, message, context = {}) {
    const alert = {
      id: randomUUID().slice(0, 12),
      severity,
      message,
      timestamp: new Date().toISOString(),
      dismissed: false,
      context
    };
    this.alerts.push(alert);
    console.log(`[SECURITY] Alert (${severity}): ${message}`);
    return alert.id;
  }

  /**
   * Handle a file change event from fs.watch.
   * @private
   * @param {string} eventType - 'rename' or 'change'
   * @param {string} filename - Relative file path from watched directory
   */
  _handleFileEvent(eventType, filename) {
    if (!filename || this._shouldIgnore(filename)) return;

    const fullPath = join(this.directory, filename);
    const now = new Date();
    this.lastEventTime = now.toISOString();

    // Reset silence timer
    this._resetSilenceTimer();

    // Check if file still exists (might have been deleted)
    let fileExists = false;
    try {
      statSync(fullPath);
      fileExists = true;
    } catch (_e) {
      // File was deleted
    }

    const relPath = relative(this.directory, fullPath);
    const auditEntry = {
      timestamp: now.toISOString(),
      event: eventType,
      file: relPath,
      exists: fileExists
    };

    if (fileExists) {
      const newHash = this._hashFile(fullPath);
      const oldHash = this.fileHashes.get(relPath);

      auditEntry.hash = newHash;

      if (oldHash && newHash && oldHash !== newHash) {
        // Hash mismatch - file was modified
        auditEntry.previousHash = oldHash;
        auditEntry.hashChanged = true;

        telemetryBus.emit('security_hash_mismatch', {
          file: relPath,
          oldHash: oldHash.slice(0, 12),
          newHash: newHash.slice(0, 12)
        });
      }

      if (newHash) {
        this.fileHashes.set(relPath, newHash);
      }

      // Check for credential file exposure
      if (this._isCredentialFile(fullPath)) {
        auditEntry.credentialExposure = true;
        this._addAlert('critical', `Credential file modified: ${relPath}`, { file: relPath });
        telemetryBus.emit('security_credential_exposed', { file: relPath });
      }
    } else {
      // File deleted
      this.fileHashes.delete(relPath);
      auditEntry.action = 'deleted';
    }

    // Emit general file change telemetry
    telemetryBus.emit('security_file_changed', {
      event: eventType,
      file: relPath,
      exists: fileExists
    });

    this._writeAuditEntry(auditEntry);
  }

  /**
   * Reset the silence threshold timer.
   * @private
   */
  _resetSilenceTimer() {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
    }
    const thresholdMs = this.config.silence_threshold_seconds * 1000;
    this.silenceTimer = setTimeout(() => {
      this._addAlert('info', `No file activity for ${this.config.silence_threshold_seconds}s`, {
        lastEvent: this.lastEventTime
      });
    }, thresholdMs);
  }

  /**
   * Start watching a directory for file changes.
   * @param {string} directory - Absolute path to the directory to watch
   */
  start(directory) {
    if (this.watching) {
      console.warn('[SECURITY] Already watching, call stop() first');
      return;
    }

    if (!existsSync(directory)) {
      console.error(`[SECURITY] Directory does not exist: ${directory}`);
      errorHandler.report('security_error', new Error('Watch directory not found'), { directory });
      return;
    }

    this.directory = directory;
    console.log(`[SECURITY] Starting file watcher on: ${directory}`);

    try {
      this.watcher = watch(directory, { recursive: true }, (eventType, filename) => {
        try {
          this._handleFileEvent(eventType, filename);
        } catch (err) {
          errorHandler.report('file_watcher_error', err, { eventType, filename });
        }
      });

      this.watcher.on('error', (err) => {
        console.error(`[SECURITY] Watcher error: ${err.message}`);
        errorHandler.report('file_watcher_error', err, { directory });
      });

      this.watching = true;
      this.lastEventTime = new Date().toISOString();
      this._resetSilenceTimer();

      console.log('[SECURITY] File watcher started');
      telemetryBus.emit('security_file_changed', { action: 'watcher_started', directory });
    } catch (err) {
      console.error(`[SECURITY] Failed to start watcher: ${err.message}`);
      errorHandler.report('security_error', err, { directory });
    }
  }

  /**
   * Stop the file watcher.
   */
  stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    this.watching = false;
    console.log('[SECURITY] File watcher stopped');
  }

  /**
   * Get the current watcher status.
   * @returns {Object} Status object
   */
  getStatus() {
    return {
      watching: this.watching,
      directory: this.directory,
      fileCount: this.fileHashes.size,
      lastEvent: this.lastEventTime,
      alertCount: this.alerts.filter(a => !a.dismissed).length,
      config: {
        extensions: this.config.watch_extensions,
        ignoreDirs: this.config.ignore_dirs,
        silenceThreshold: this.config.silence_threshold_seconds
      }
    };
  }

  /**
   * Get active (non-dismissed) security alerts.
   * @returns {Array} Active alerts
   */
  getAlerts() {
    return this.alerts.filter(a => !a.dismissed);
  }

  /**
   * Dismiss a specific alert by ID.
   * @param {string} alertId - The alert ID to dismiss
   * @returns {boolean} True if alert was found and dismissed
   */
  dismissAlert(alertId) {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.dismissed = true;
      console.log(`[SECURITY] Alert dismissed: ${alertId}`);
      return true;
    }
    return false;
  }

  /**
   * Get recent audit log entries.
   * @param {number} [limit=100] - Maximum entries to return
   * @returns {Array} Audit entries (newest first)
   */
  getAuditLog(limit = 100) {
    try {
      const logPath = join(__dirname, '../../', this.config.audit_log);
      if (!existsSync(logPath)) {
        return [];
      }
      const content = readFileSync(logPath, 'utf8').trim();
      if (!content) return [];
      const lines = content.split('\n');
      const entries = [];
      const start = Math.max(0, lines.length - limit);
      for (let i = lines.length - 1; i >= start; i--) {
        try {
          entries.push(JSON.parse(lines[i]));
        } catch (_e) {
          // Skip malformed lines
        }
      }
      return entries;
    } catch (err) {
      console.error(`[SECURITY] Failed to read audit log: ${err.message}`);
      return [];
    }
  }

  /**
   * Perform a full directory scan, hashing all eligible files.
   * @param {string} directory - Directory to scan
   * @returns {Object} Scan results { filesScanned, credentialFiles, duration }
   */
  scan(directory) {
    const startTime = Date.now();
    let filesScanned = 0;
    const credentialFiles = [];

    const scanDir = (dir) => {
      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch (_err) {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(dir, entry.name);

        if (entry.isDirectory()) {
          if (!this.config.ignore_dirs.includes(entry.name)) {
            scanDir(fullPath);
          }
          continue;
        }

        if (entry.isFile()) {
          const ext = extname(entry.name);
          const effectiveExt = ext || entry.name;
          if (!this.config.watch_extensions.includes(effectiveExt)) continue;

          const relPath = relative(directory, fullPath);
          const hash = this._hashFile(fullPath);
          if (hash) {
            this.fileHashes.set(relPath, hash);
            filesScanned++;
          }

          if (this._isCredentialFile(fullPath)) {
            credentialFiles.push(relPath);
            this._addAlert('warning', `Credential file found during scan: ${relPath}`, { file: relPath });
            telemetryBus.emit('security_credential_exposed', { file: relPath, source: 'scan' });
          }
        }
      }
    };

    console.log(`[SECURITY] Scanning directory: ${directory}`);
    scanDir(directory);

    const duration = Date.now() - startTime;
    const result = { filesScanned, credentialFiles, duration };

    console.log(`[SECURITY] Scan complete: ${filesScanned} files in ${duration}ms`);

    this._writeAuditEntry({
      timestamp: new Date().toISOString(),
      event: 'full_scan',
      directory,
      filesScanned,
      credentialFiles: credentialFiles.length,
      duration
    });

    return result;
  }
}

// Export singleton
const fileWatcher = new FileWatcher();
export default fileWatcher;
export { FileWatcher };

// --test block
if (process.argv.includes('--test') && process.argv[1]?.endsWith('file-watcher.js')) {
  console.log('Testing FileWatcher...\n');

  const { mkdtempSync, rmSync, writeFileSync: writeFile } = await import('fs');
  const { tmpdir } = await import('os');
  const { join: joinPath } = await import('path');

  const tempDir = mkdtempSync(joinPath(tmpdir(), 'bf-security-test-'));
  console.log(`Test directory: ${tempDir}`);

  try {
    // Test 1: Constructor and config loading
    console.log('[TEST] Test 1: Constructor and config...');
    const watcher = new FileWatcher();
    if (!watcher.config) throw new Error('Config should be loaded');
    if (!Array.isArray(watcher.config.watch_extensions)) throw new Error('watch_extensions should be array');
    if (!Array.isArray(watcher.config.ignore_dirs)) throw new Error('ignore_dirs should be array');
    console.log('[TEST] Constructor and config: PASSED');

    // Test 2: File hashing
    console.log('\n[TEST] Test 2: File hashing...');
    const testFile = joinPath(tempDir, 'test.js');
    writeFile(testFile, 'console.log("hello");', 'utf8');
    const hash = watcher._hashFile(testFile);
    if (!hash) throw new Error('Hash should not be null');
    if (hash.length !== 64) throw new Error(`SHA256 hex should be 64 chars, got ${hash.length}`);
    // Same content should produce same hash
    const hash2 = watcher._hashFile(testFile);
    if (hash !== hash2) throw new Error('Same file should produce same hash');
    console.log('[TEST] File hashing: PASSED');

    // Test 3: Ignore logic
    console.log('\n[TEST] Test 3: Ignore logic...');
    if (!watcher._shouldIgnore('node_modules/express/index.js')) throw new Error('Should ignore node_modules');
    if (!watcher._shouldIgnore('.git/objects/abc')) throw new Error('Should ignore .git');
    if (!watcher._shouldIgnore('src/test.png')) throw new Error('Should ignore .png (not in watch_extensions)');
    if (watcher._shouldIgnore('src/main.js')) throw new Error('Should not ignore .js');
    console.log('[TEST] Ignore logic: PASSED');

    // Test 4: Credential detection
    console.log('\n[TEST] Test 4: Credential detection...');
    if (!watcher._isCredentialFile('.env')) throw new Error('.env should be detected');
    if (!watcher._isCredentialFile('.env.local')) throw new Error('.env.local should be detected');
    if (!watcher._isCredentialFile('server.pem')) throw new Error('.pem should be detected');
    if (!watcher._isCredentialFile('src/credentials.json')) throw new Error('credentials should be detected');
    if (watcher._isCredentialFile('src/main.js')) throw new Error('main.js should not be detected');
    console.log('[TEST] Credential detection: PASSED');

    // Test 5: Scan directory
    console.log('\n[TEST] Test 5: Directory scan...');
    const subDir = joinPath(tempDir, 'src');
    mkdirSync(subDir, { recursive: true });
    writeFile(joinPath(subDir, 'app.js'), 'const x = 1;', 'utf8');
    writeFile(joinPath(subDir, 'util.js'), 'const y = 2;', 'utf8');
    writeFile(joinPath(tempDir, '.env'), 'SECRET=abc123', 'utf8');

    const scanResult = watcher.scan(tempDir);
    if (scanResult.filesScanned < 3) throw new Error(`Should scan at least 3 files, got ${scanResult.filesScanned}`);
    if (scanResult.credentialFiles.length < 1) throw new Error('Should detect credential file');
    if (typeof scanResult.duration !== 'number') throw new Error('Should have duration');
    console.log('[TEST] Directory scan: PASSED');

    // Test 6: Alerts
    console.log('\n[TEST] Test 6: Alerts...');
    const alerts = watcher.getAlerts();
    if (alerts.length === 0) throw new Error('Should have alerts from scan');
    const alertId = alerts[0].id;
    const dismissed = watcher.dismissAlert(alertId);
    if (!dismissed) throw new Error('Should dismiss alert');
    const afterDismiss = watcher.getAlerts();
    if (afterDismiss.find(a => a.id === alertId)) throw new Error('Dismissed alert should not appear');
    console.log('[TEST] Alerts: PASSED');

    // Test 7: Status
    console.log('\n[TEST] Test 7: Status...');
    const status = watcher.getStatus();
    if (typeof status.watching !== 'boolean') throw new Error('Status should have watching flag');
    if (typeof status.fileCount !== 'number') throw new Error('Status should have fileCount');
    if (typeof status.alertCount !== 'number') throw new Error('Status should have alertCount');
    console.log('[TEST] Status: PASSED');

    // Test 8: Start and stop
    console.log('\n[TEST] Test 8: Start and stop...');
    watcher.start(tempDir);
    if (!watcher.watching) throw new Error('Should be watching after start');
    if (watcher.directory !== tempDir) throw new Error('Directory mismatch');
    watcher.stop();
    if (watcher.watching) throw new Error('Should not be watching after stop');
    console.log('[TEST] Start and stop: PASSED');

    console.log('\n[TEST] All 8 tests PASSED!');
    console.log('FileWatcher test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`\n[TEST] Cleaned up temp directory: ${tempDir}`);
  }
}
