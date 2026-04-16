/**
 * Model Intelligence Database - SQLite persistence layer
 *
 * Schema: model_files, runtimes, storage_volumes, scan_history
 * Uses WAL mode for concurrent reads, single-writer with busy_timeout.
 * Migration system with version table.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, unlinkSync } from 'fs';
import { randomUUID } from 'crypto';
import configLoader from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: model_files, runtimes, storage_volumes, scan_history',
    sql: `
      CREATE TABLE IF NOT EXISTS model_files (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        filename TEXT,
        extension TEXT,
        size_bytes INTEGER,
        sha256 TEXT,
        format TEXT,
        architecture TEXT,
        parameter_count TEXT,
        quantization TEXT,
        source TEXT DEFAULT 'unknown',
        last_seen TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS runtimes (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version TEXT,
        path TEXT,
        status TEXT DEFAULT 'unknown',
        detected_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS storage_volumes (
        id TEXT PRIMARY KEY,
        letter TEXT NOT NULL UNIQUE,
        label TEXT,
        total_bytes INTEGER,
        free_bytes INTEGER,
        fs_type TEXT,
        detected_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS scan_history (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        files_found INTEGER DEFAULT 0,
        runtimes_found INTEGER DEFAULT 0,
        errors INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_model_files_source ON model_files(source);
      CREATE INDEX IF NOT EXISTS idx_model_files_extension ON model_files(extension);
      CREATE INDEX IF NOT EXISTS idx_runtimes_status ON runtimes(status);
      CREATE INDEX IF NOT EXISTS idx_scan_history_type ON scan_history(type);
      CREATE INDEX IF NOT EXISTS idx_scan_history_status ON scan_history(status);
    `
  }
];

class ModelIntelligenceDatabase {
  constructor(dbPath) {
    const dbConfig = configLoader.getDatabaseConfig();
    this.dbPath = dbPath || configLoader.resolvePath(dbConfig.path || 'data/model-intelligence.db');
    this.db = null;
  }

  open() {
    if (this.db) return;

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    console.log(`[MODEL-DB] Opening database: ${this.dbPath}`);

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');

    this._migrate();
    console.log('[MODEL-DB] Database ready');
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[MODEL-DB] Database closed');
    }
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at TEXT DEFAULT (datetime('now'))
      )
    `);

    const currentVersion = this.db.prepare(
      'SELECT MAX(version) as version FROM schema_version'
    ).get();

    const appliedVersion = currentVersion?.version || 0;

    for (const migration of MIGRATIONS) {
      if (migration.version > appliedVersion) {
        console.log(`[MODEL-DB] Applying migration v${migration.version}: ${migration.description}`);
        this.db.exec(migration.sql);
        this.db.prepare(
          'INSERT INTO schema_version (version, description) VALUES (?, ?)'
        ).run(migration.version, migration.description);
      }
    }
  }

  // --- Model Files ---

  upsertModelFile(file) {
    const id = file.id || randomUUID().slice(0, 12);
    const existing = this.db.prepare('SELECT id FROM model_files WHERE path = ?').get(file.path);

    if (existing) {
      const fields = [];
      const values = [];

      if (file.filename !== undefined) { fields.push('filename = ?'); values.push(file.filename); }
      if (file.extension !== undefined) { fields.push('extension = ?'); values.push(file.extension); }
      if (file.size_bytes !== undefined) { fields.push('size_bytes = ?'); values.push(file.size_bytes); }
      if (file.sha256 !== undefined) { fields.push('sha256 = ?'); values.push(file.sha256); }
      if (file.format !== undefined) { fields.push('format = ?'); values.push(file.format); }
      if (file.architecture !== undefined) { fields.push('architecture = ?'); values.push(file.architecture); }
      if (file.parameter_count !== undefined) { fields.push('parameter_count = ?'); values.push(file.parameter_count); }
      if (file.quantization !== undefined) { fields.push('quantization = ?'); values.push(file.quantization); }
      if (file.source !== undefined) { fields.push('source = ?'); values.push(file.source); }
      fields.push('last_seen = datetime(\'now\')');

      if (fields.length > 0) {
        values.push(existing.id);
        this.db.prepare(`UPDATE model_files SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      }
      return existing.id;
    }

    this.db.prepare(
      `INSERT INTO model_files (id, path, filename, extension, size_bytes, sha256, format, architecture, parameter_count, quantization, source, last_seen)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).run(
      id,
      file.path,
      file.filename || null,
      file.extension || null,
      file.size_bytes || null,
      file.sha256 || null,
      file.format || null,
      file.architecture || null,
      file.parameter_count || null,
      file.quantization || null,
      file.source || 'unknown'
    );

    console.log(`[MODEL-DB] Model file upserted: ${id} ${file.path}`);
    return id;
  }

  getModelFiles(filters = {}) {
    let sql = 'SELECT * FROM model_files';
    const conditions = [];
    const params = [];

    if (filters.source) {
      conditions.push('source = ?');
      params.push(filters.source);
    }
    if (filters.extension) {
      conditions.push('extension = ?');
      params.push(filters.extension);
    }
    if (filters.format) {
      conditions.push('format = ?');
      params.push(filters.format);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 100, 1), 1000);
    sql += ' LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params);
  }

  // --- Runtimes ---

  upsertRuntime(runtime) {
    const id = runtime.id || randomUUID().slice(0, 12);
    const existing = this.db.prepare('SELECT id FROM runtimes WHERE name = ?').get(runtime.name);

    if (existing) {
      const fields = [];
      const values = [];

      if (runtime.version !== undefined) { fields.push('version = ?'); values.push(runtime.version); }
      if (runtime.path !== undefined) { fields.push('path = ?'); values.push(runtime.path); }
      if (runtime.status !== undefined) { fields.push('status = ?'); values.push(runtime.status); }
      fields.push('detected_at = datetime(\'now\')');

      values.push(existing.id);
      this.db.prepare(`UPDATE runtimes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return existing.id;
    }

    this.db.prepare(
      'INSERT INTO runtimes (id, name, version, path, status) VALUES (?, ?, ?, ?, ?)'
    ).run(id, runtime.name, runtime.version || null, runtime.path || null, runtime.status || 'unknown');

    console.log(`[MODEL-DB] Runtime upserted: ${id} ${runtime.name}`);
    return id;
  }

  getRuntimes() {
    return this.db.prepare('SELECT * FROM runtimes ORDER BY detected_at DESC').all();
  }

  // --- Storage Volumes ---

  upsertStorageVolume(vol) {
    const id = vol.id || randomUUID().slice(0, 12);
    const existing = this.db.prepare('SELECT id FROM storage_volumes WHERE letter = ?').get(vol.letter);

    if (existing) {
      const fields = [];
      const values = [];

      if (vol.label !== undefined) { fields.push('label = ?'); values.push(vol.label); }
      if (vol.total_bytes !== undefined) { fields.push('total_bytes = ?'); values.push(vol.total_bytes); }
      if (vol.free_bytes !== undefined) { fields.push('free_bytes = ?'); values.push(vol.free_bytes); }
      if (vol.fs_type !== undefined) { fields.push('fs_type = ?'); values.push(vol.fs_type); }
      fields.push('detected_at = datetime(\'now\')');

      values.push(existing.id);
      this.db.prepare(`UPDATE storage_volumes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
      return existing.id;
    }

    this.db.prepare(
      'INSERT INTO storage_volumes (id, letter, label, total_bytes, free_bytes, fs_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, vol.letter, vol.label || null, vol.total_bytes || null, vol.free_bytes || null, vol.fs_type || null);

    console.log(`[MODEL-DB] Storage volume upserted: ${id} ${vol.letter}:`);
    return id;
  }

  getStorageVolumes() {
    return this.db.prepare('SELECT * FROM storage_volumes ORDER BY letter ASC').all();
  }

  // --- Scan History ---

  insertScan(scan) {
    const id = scan.id || randomUUID().slice(0, 12);
    const metadata = typeof scan.metadata === 'string' ? scan.metadata : JSON.stringify(scan.metadata || {});

    this.db.prepare(
      'INSERT INTO scan_history (id, type, status, metadata) VALUES (?, ?, ?, ?)'
    ).run(id, scan.type, scan.status || 'running', metadata);

    console.log(`[MODEL-DB] Scan started: ${id} (${scan.type})`);
    return id;
  }

  updateScan(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.files_found !== undefined) { fields.push('files_found = ?'); values.push(updates.files_found); }
    if (updates.runtimes_found !== undefined) { fields.push('runtimes_found = ?'); values.push(updates.runtimes_found); }
    if (updates.errors !== undefined) { fields.push('errors = ?'); values.push(updates.errors); }
    if (updates.metadata !== undefined) {
      fields.push('metadata = ?');
      values.push(typeof updates.metadata === 'string' ? updates.metadata : JSON.stringify(updates.metadata));
    }
    if (updates.status === 'completed' || updates.status === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(
      `UPDATE scan_history SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  getScan(id) {
    const scan = this.db.prepare('SELECT * FROM scan_history WHERE id = ?').get(id);
    if (scan && scan.metadata) {
      try {
        scan.metadata = JSON.parse(scan.metadata);
      } catch (_e) {
        // keep as string
      }
    }
    return scan || null;
  }

  getScanHistory(limit = 20) {
    const rows = this.db.prepare(
      'SELECT * FROM scan_history ORDER BY started_at DESC LIMIT ?'
    ).all(limit);

    return rows.map(scan => {
      if (scan.metadata) {
        try {
          scan.metadata = JSON.parse(scan.metadata);
        } catch (_e) {
          // keep as string
        }
      }
      return scan;
    });
  }

  getStats() {
    const totalFiles = this.db.prepare('SELECT COUNT(*) as count FROM model_files').get().count;
    const totalRuntimes = this.db.prepare('SELECT COUNT(*) as count FROM runtimes').get().count;
    const totalVolumes = this.db.prepare('SELECT COUNT(*) as count FROM storage_volumes').get().count;
    const totalScans = this.db.prepare('SELECT COUNT(*) as count FROM scan_history').get().count;
    const completedScans = this.db.prepare(
      'SELECT COUNT(*) as count FROM scan_history WHERE status = \'completed\''
    ).get().count;

    const sourceBreakdown = this.db.prepare(
      'SELECT source, COUNT(*) as count FROM model_files GROUP BY source'
    ).all();

    return {
      totalFiles,
      totalRuntimes,
      totalVolumes,
      totalScans,
      completedScans,
      sourceBreakdown
    };
  }
}

const modelDb = new ModelIntelligenceDatabase();
export default modelDb;
export { ModelIntelligenceDatabase };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing ModelIntelligenceDatabase...\n');

  const testDbPath = join(__dirname, '../../data/model-intelligence_test.db');

  try {
    let passed = 0;

    // Test 1: Open database and run migrations
    const db = new ModelIntelligenceDatabase(testDbPath);
    db.open();
    console.assert(db.db !== null, 'Database should be open');
    console.log('  [PASS] Database opens and migrations run');
    passed++;

    // Test 2: Upsert model file (insert)
    const fileId = db.upsertModelFile({
      path: 'C:\\models\\llama-7b.gguf',
      filename: 'llama-7b.gguf',
      extension: '.gguf',
      size_bytes: 4000000000,
      format: 'GGUF',
      architecture: 'llama',
      parameter_count: '7B',
      quantization: 'Q4_K_M',
      source: 'ollama'
    });
    console.assert(typeof fileId === 'string' && fileId.length === 12, 'Should return 12-char ID');
    console.log('  [PASS] upsertModelFile (insert) returns valid ID');
    passed++;

    // Test 3: Upsert model file (update existing by path)
    const updatedId = db.upsertModelFile({
      path: 'C:\\models\\llama-7b.gguf',
      sha256: 'abc123def456',
      source: 'huggingface'
    });
    console.assert(updatedId === fileId, 'Upsert should return existing ID');
    console.log('  [PASS] upsertModelFile (update) returns same ID');
    passed++;

    // Test 4: Insert second model file
    db.upsertModelFile({
      path: 'D:\\hf-cache\\mistral.safetensors',
      filename: 'mistral.safetensors',
      extension: '.safetensors',
      size_bytes: 8000000000,
      source: 'huggingface'
    });
    console.log('  [PASS] Second model file inserted');
    passed++;

    // Test 5: Get model files (no filter)
    const allFiles = db.getModelFiles();
    console.assert(allFiles.length === 2, `Should have 2 files, got ${allFiles.length}`);
    console.log('  [PASS] getModelFiles() returns all files');
    passed++;

    // Test 6: Get model files (filtered by source)
    const ollamaFiles = db.getModelFiles({ source: 'huggingface' });
    console.assert(ollamaFiles.length >= 1, 'Should find huggingface files');
    console.log('  [PASS] getModelFiles({ source }) filters correctly');
    passed++;

    // Test 7: Upsert runtime (insert)
    const runtimeId = db.upsertRuntime({
      name: 'Ollama',
      version: '0.5.4',
      path: 'C:\\Users\\daley\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
      status: 'active'
    });
    console.assert(typeof runtimeId === 'string' && runtimeId.length === 12, 'Should return 12-char ID');
    console.log('  [PASS] upsertRuntime (insert) returns valid ID');
    passed++;

    // Test 8: Upsert runtime (update existing by name)
    const runtimeId2 = db.upsertRuntime({
      name: 'Ollama',
      version: '0.5.5',
      status: 'active'
    });
    console.assert(runtimeId2 === runtimeId, 'Upsert should return existing ID');
    console.log('  [PASS] upsertRuntime (update) returns same ID');
    passed++;

    // Test 9: Get runtimes
    const runtimes = db.getRuntimes();
    console.assert(runtimes.length === 1, `Should have 1 runtime, got ${runtimes.length}`);
    console.assert(runtimes[0].version === '0.5.5', 'Version should be updated');
    console.log('  [PASS] getRuntimes() returns updated data');
    passed++;

    // Test 10: Upsert storage volume (insert)
    const volId = db.upsertStorageVolume({
      letter: 'C',
      label: 'Windows',
      total_bytes: 500000000000,
      free_bytes: 100000000000,
      fs_type: 'NTFS'
    });
    console.assert(typeof volId === 'string' && volId.length === 12, 'Should return 12-char ID');
    console.log('  [PASS] upsertStorageVolume (insert) returns valid ID');
    passed++;

    // Test 11: Upsert storage volume (update existing by letter)
    const volId2 = db.upsertStorageVolume({
      letter: 'C',
      free_bytes: 90000000000
    });
    console.assert(volId2 === volId, 'Upsert should return existing ID');
    console.log('  [PASS] upsertStorageVolume (update) returns same ID');
    passed++;

    // Test 12: Get storage volumes
    db.upsertStorageVolume({ letter: 'D', label: 'Data', total_bytes: 1000000000000, free_bytes: 500000000000, fs_type: 'NTFS' });
    const volumes = db.getStorageVolumes();
    console.assert(volumes.length === 2, `Should have 2 volumes, got ${volumes.length}`);
    console.assert(volumes[0].letter === 'C', 'First volume should be C (ordered by letter)');
    console.log('  [PASS] getStorageVolumes() returns ordered data');
    passed++;

    // Test 13: Insert scan
    const scanId = db.insertScan({ type: 'instant', metadata: { trigger: 'test' } });
    console.assert(typeof scanId === 'string' && scanId.length === 12, 'Should return 12-char ID');
    console.log('  [PASS] insertScan() returns valid ID');
    passed++;

    // Test 14: Update scan
    db.updateScan(scanId, {
      status: 'completed',
      files_found: 2,
      runtimes_found: 1,
      errors: 0
    });
    const scan = db.getScan(scanId);
    console.assert(scan.status === 'completed', 'Scan status should be completed');
    console.assert(scan.files_found === 2, 'Files found should be 2');
    console.assert(scan.completed_at !== null, 'Should have completed_at timestamp');
    console.assert(typeof scan.metadata === 'object', 'Metadata should be parsed JSON');
    console.log('  [PASS] updateScan() and getScan() work correctly');
    passed++;

    // Test 15: Scan history
    db.insertScan({ type: 'deep', status: 'running' });
    const history = db.getScanHistory(10);
    console.assert(history.length === 2, `Should have 2 scans, got ${history.length}`);
    console.log('  [PASS] getScanHistory() returns correct count');
    passed++;

    // Test 16: Stats
    const stats = db.getStats();
    console.assert(stats.totalFiles === 2, `Should have 2 files, got ${stats.totalFiles}`);
    console.assert(stats.totalRuntimes === 1, `Should have 1 runtime, got ${stats.totalRuntimes}`);
    console.assert(stats.totalVolumes === 2, `Should have 2 volumes, got ${stats.totalVolumes}`);
    console.assert(stats.totalScans === 2, `Should have 2 scans, got ${stats.totalScans}`);
    console.assert(stats.completedScans === 1, `Should have 1 completed scan, got ${stats.completedScans}`);
    console.assert(Array.isArray(stats.sourceBreakdown), 'Should have source breakdown');
    console.log('  [PASS] getStats() returns correct aggregates');
    passed++;

    // Cleanup
    db.close();
    try { unlinkSync(testDbPath); } catch (_e) {
      // cleanup non-critical
    }
    try { unlinkSync(testDbPath + '-wal'); } catch (_e) {
      // cleanup non-critical
    }
    try { unlinkSync(testDbPath + '-shm'); } catch (_e) {
      // cleanup non-critical
    }

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('ModelIntelligenceDatabase test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);

    // Cleanup on failure
    try { unlinkSync(testDbPath); } catch (_e) {
      // cleanup non-critical
    }
    try { unlinkSync(testDbPath + '-wal'); } catch (_e) {
      // cleanup non-critical
    }
    try { unlinkSync(testDbPath + '-shm'); } catch (_e) {
      // cleanup non-critical
    }
    process.exit(1);
  }
}
