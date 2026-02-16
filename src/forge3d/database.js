/**
 * Forge3D Database - SQLite persistence layer
 *
 * Schema: projects, assets, generation_history
 * Uses WAL mode for concurrent reads, single-writer with busy_timeout.
 * Migration system with version table.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_PATH = join(__dirname, '../../data/forge3d.db');

// Schema migrations
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: projects, assets, generation_history',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('mesh', 'image', 'full')),
        file_path TEXT,
        thumbnail_path TEXT,
        file_size INTEGER DEFAULT 0,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS generation_history (
        id TEXT PRIMARY KEY,
        asset_id TEXT,
        project_id TEXT,
        type TEXT NOT NULL CHECK (type IN ('mesh', 'image', 'full')),
        prompt TEXT,
        status TEXT NOT NULL DEFAULT 'queued'
          CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
        generation_time REAL,
        vram_usage_mb REAL,
        error_message TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_assets_project ON assets(project_id);
      CREATE INDEX IF NOT EXISTS idx_history_project ON generation_history(project_id);
      CREATE INDEX IF NOT EXISTS idx_history_status ON generation_history(status);
      CREATE INDEX IF NOT EXISTS idx_history_created ON generation_history(created_at);
    `
  }
];

class Forge3DDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    this.db = null;
  }

  /**
   * Open database connection and run migrations.
   */
  open() {
    if (this.db) return;

    // Ensure data directory exists
    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    console.log(`[DB] Opening database: ${this.dbPath}`);

    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('foreign_keys = ON');

    // Run migrations
    this._migrate();

    // Validate database integrity on startup
    const healthy = this.integrityCheck();
    if (healthy) {
      console.log('[DB] Integrity check passed');
    }

    console.log('[DB] Database ready');
  }

  /**
   * Close database connection.
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      console.log('[DB] Database closed');
    }
  }

  /**
   * Run schema migrations.
   */
  _migrate() {
    // Create migration tracking table
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
        console.log(`[DB] Applying migration v${migration.version}: ${migration.description}`);
        this.db.exec(migration.sql);
        this.db.prepare(
          'INSERT INTO schema_version (version, description) VALUES (?, ?)'
        ).run(migration.version, migration.description);
      }
    }
  }

  /**
   * Run integrity check.
   * @returns {boolean} true if database is healthy
   */
  integrityCheck() {
    const result = this.db.pragma('integrity_check');
    const ok = result[0]?.integrity_check === 'ok';
    if (!ok) {
      console.error('[DB] Integrity check FAILED:', result);
    }
    return ok;
  }

  // --- Projects ---

  createProject(name, description = '') {
    const id = randomUUID().slice(0, 12);
    this.db.prepare(
      'INSERT INTO projects (id, name, description) VALUES (?, ?, ?)'
    ).run(id, name, description);
    console.log(`[DB] Project created: ${id} "${name}"`);
    return this.getProject(id);
  }

  getProject(id) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
  }

  listProjects() {
    return this.db.prepare(
      'SELECT p.*, COUNT(a.id) as asset_count FROM projects p LEFT JOIN assets a ON a.project_id = p.id GROUP BY p.id ORDER BY p.updated_at DESC'
    ).all();
  }

  updateProject(id, updates) {
    const fields = [];
    const values = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }

    if (fields.length === 0) return this.getProject(id);

    fields.push('updated_at = datetime(\'now\')');
    values.push(id);

    this.db.prepare(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);

    return this.getProject(id);
  }

  deleteProject(id) {
    const result = this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    console.log(`[DB] Project deleted: ${id} (${result.changes} rows)`);
    return result.changes > 0;
  }

  // --- Assets ---

  createAsset(projectId, data) {
    const id = randomUUID().slice(0, 12);
    const metadata = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {});

    this.db.prepare(
      'INSERT INTO assets (id, project_id, name, type, file_path, thumbnail_path, file_size, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, data.name, data.type, data.filePath || null, data.thumbnailPath || null, data.fileSize || 0, metadata);

    // Update project timestamp
    this.db.prepare('UPDATE projects SET updated_at = datetime(\'now\') WHERE id = ?').run(projectId);

    console.log(`[DB] Asset created: ${id} "${data.name}" in project ${projectId}`);
    return this.getAsset(id);
  }

  getAsset(id) {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id = ?').get(id);
    if (asset && asset.metadata) {
      try { asset.metadata = JSON.parse(asset.metadata); } catch (_e) { /* keep as string */ }
    }
    return asset || null;
  }

  listAssets(projectId) {
    const assets = this.db.prepare(
      'SELECT * FROM assets WHERE project_id = ? ORDER BY created_at DESC'
    ).all(projectId);

    return assets.map((a) => {
      if (a.metadata) {
        try { a.metadata = JSON.parse(a.metadata); } catch (_e) { /* keep as string */ }
      }
      return a;
    });
  }

  deleteAsset(id) {
    const result = this.db.prepare('DELETE FROM assets WHERE id = ?').run(id);
    return result.changes > 0;
  }

  // --- Generation History ---

  createHistoryEntry(data) {
    const id = randomUUID().slice(0, 12);
    const metadata = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {});

    this.db.prepare(
      'INSERT INTO generation_history (id, asset_id, project_id, type, prompt, status, metadata) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.assetId || null, data.projectId || null, data.type, data.prompt || null, data.status || 'queued', metadata);

    return id;
  }

  updateHistoryEntry(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.generationTime !== undefined) {
      fields.push('generation_time = ?');
      values.push(updates.generationTime);
    }
    if (updates.vramUsage !== undefined) {
      fields.push('vram_usage_mb = ?');
      values.push(updates.vramUsage);
    }
    if (updates.errorMessage !== undefined) {
      fields.push('error_message = ?');
      values.push(updates.errorMessage);
    }
    if (updates.assetId !== undefined) {
      fields.push('asset_id = ?');
      values.push(updates.assetId);
    }
    if (updates.status === 'complete' || updates.status === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(
      `UPDATE generation_history SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  getHistoryEntry(id) {
    const entry = this.db.prepare('SELECT * FROM generation_history WHERE id = ?').get(id);
    if (entry && entry.metadata) {
      try { entry.metadata = JSON.parse(entry.metadata); } catch (_e) { /* keep as string */ }
    }
    return entry || null;
  }

  listHistory(options = {}) {
    let sql = 'SELECT * FROM generation_history';
    const conditions = [];
    const params = [];

    if (options.projectId) {
      conditions.push('project_id = ?');
      params.push(options.projectId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (options.type) {
      conditions.push('type = ?');
      params.push(options.type);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT ${options.limit || 50}`;

    const entries = this.db.prepare(sql).all(...params);
    return entries.map((e) => {
      if (e.metadata) {
        try { e.metadata = JSON.parse(e.metadata); } catch (_e) { /* keep as string */ }
      }
      return e;
    });
  }

  /**
   * Get aggregate stats for the dashboard.
   */
  getStats() {
    const totalGenerations = this.db.prepare(
      'SELECT COUNT(*) as count FROM generation_history'
    ).get().count;

    const completedGenerations = this.db.prepare(
      'SELECT COUNT(*) as count FROM generation_history WHERE status = \'complete\''
    ).get().count;

    const failedGenerations = this.db.prepare(
      'SELECT COUNT(*) as count FROM generation_history WHERE status = \'failed\''
    ).get().count;

    const avgGenerationTime = this.db.prepare(
      'SELECT AVG(generation_time) as avg FROM generation_history WHERE status = \'complete\' AND generation_time IS NOT NULL'
    ).get().avg || 0;

    const totalProjects = this.db.prepare(
      'SELECT COUNT(*) as count FROM projects'
    ).get().count;

    const totalAssets = this.db.prepare(
      'SELECT COUNT(*) as count FROM assets'
    ).get().count;

    return {
      totalGenerations,
      completedGenerations,
      failedGenerations,
      failureRate: totalGenerations > 0 ? (failedGenerations / totalGenerations * 100).toFixed(1) : '0.0',
      avgGenerationTime: Math.round(avgGenerationTime * 100) / 100,
      totalProjects,
      totalAssets
    };
  }

  /**
   * Find incomplete generations (for crash recovery).
   */
  findIncomplete() {
    return this.db.prepare(
      'SELECT * FROM generation_history WHERE status IN (\'queued\', \'processing\') ORDER BY created_at ASC'
    ).all();
  }
}

// Singleton
const forge3dDb = new Forge3DDatabase();
export default forge3dDb;
export { Forge3DDatabase };

// --test block (guarded so imports don't trigger it)
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[DB] Running self-test...');

  const testDbPath = join(__dirname, '../../data/forge3d_test.db');
  const db = new Forge3DDatabase(testDbPath);
  db.open();

  // Test integrity
  console.assert(db.integrityCheck(), 'Integrity check should pass');

  // Test projects
  const project = db.createProject('Test Project', 'A test project');
  console.assert(project.name === 'Test Project', 'Project name should match');
  console.assert(project.id.length === 12, 'ID should be 12 chars');

  const projects = db.listProjects();
  console.assert(projects.length >= 1, 'Should have at least 1 project');

  // Test assets
  const asset = db.createAsset(project.id, {
    name: 'test_mesh.glb',
    type: 'mesh',
    filePath: '/data/output/test.glb',
    fileSize: 1024,
    metadata: { vertices: 100, faces: 50 }
  });
  console.assert(asset.name === 'test_mesh.glb', 'Asset name should match');
  console.assert(asset.type === 'mesh', 'Asset type should be mesh');

  const assets = db.listAssets(project.id);
  console.assert(assets.length === 1, 'Should have 1 asset');

  // Test history
  const histId = db.createHistoryEntry({
    projectId: project.id,
    type: 'mesh',
    prompt: 'test prompt',
    status: 'queued'
  });

  db.updateHistoryEntry(histId, {
    status: 'complete',
    generationTime: 45.2,
    vramUsage: 6000
  });

  const entry = db.getHistoryEntry(histId);
  console.assert(entry.status === 'complete', 'Status should be complete');
  console.assert(entry.generation_time === 45.2, 'Generation time should match');

  // Test stats
  const stats = db.getStats();
  console.assert(stats.totalGenerations >= 1, 'Should have at least 1 generation');
  console.assert(stats.totalProjects >= 1, 'Should have at least 1 project');

  // Cleanup
  db.deleteProject(project.id);
  db.close();

  // Remove test DB file
  const { unlinkSync } = await import('fs');
  try { unlinkSync(testDbPath); } catch (_e) { /* ok */ }
  try { unlinkSync(testDbPath + '-wal'); } catch (_e) { /* ok */ }
  try { unlinkSync(testDbPath + '-shm'); } catch (_e) { /* ok */ }

  console.log('[DB] Self-test passed');
  process.exit(0);
}
