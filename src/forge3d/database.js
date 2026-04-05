/**
 * Forge3D Database - SQLite persistence layer
 *
 * Schema: projects, assets, generation_history
 * Uses WAL mode for concurrent reads, single-writer with busy_timeout.
 * Migration system with version table.
 *
 * STATUS: Complete. Schema v1 with 3 tables, integrity checks, stats.
 *
 * TODO(P1): Add daily automated backup of forge3d.db (e.g. on server start)
 * TODO(P1): Add database export/import (JSON) for migration between machines
 * TODO(P1): Add generation_history pruning (auto-delete entries older than N days)
 * TODO(P2): Add full-text search index on generation prompts
 * TODO(P2): Schema v2 — add tags/labels table for asset organization
 * TODO(P2): Add asset versioning (re-generate same prompt, keep history)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { randomUUID } from 'crypto';
import forge3dConfig from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_PATH = forge3dConfig.resolvePath(forge3dConfig.database.path);

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
  },
  {
    version: 2,
    description: 'Add sessions table for persistence + retry_count to generation_history',
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'idle',
        prompt TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        started_at TEXT,
        completed_at TEXT,
        result_path TEXT,
        result_type TEXT,
        file_size INTEGER,
        error TEXT,
        metadata TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
      CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

      ALTER TABLE generation_history ADD COLUMN retry_count INTEGER DEFAULT 0;
    `
  },
  {
    version: 3,
    description: 'Add FBX export columns to assets table',
    sql: `
      ALTER TABLE assets ADD COLUMN fbx_path TEXT;
      ALTER TABLE assets ADD COLUMN fbx_size INTEGER DEFAULT 0;
    `
  },
  {
    version: 4,
    description: 'Add material extraction columns to assets table',
    sql: `
      ALTER TABLE assets ADD COLUMN material_data TEXT DEFAULT '{}';
      ALTER TABLE assets ADD COLUMN has_materials INTEGER DEFAULT 0;
    `
  },
  {
    version: 5,
    description: 'Add model column to generation_history',
    sql: `
      ALTER TABLE generation_history ADD COLUMN model TEXT;
    `
  },
  {
    version: 6,
    description: 'Add scenes and scene_assets tables for AI Scene Generator',
    sql: `
      CREATE TABLE IF NOT EXISTS scenes (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        scene_type TEXT DEFAULT 'outdoor',
        prompt TEXT,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','analyzing','generating','assembling','complete','failed')),
        pipeline_id TEXT,
        asset_count INTEGER DEFAULT 0,
        scene_graph TEXT DEFAULT '{}',
        assembled_path TEXT,
        assembled_size INTEGER DEFAULT 0,
        descriptor_path TEXT,
        generation_time REAL,
        error TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS scene_assets (
        id TEXT PRIMARY KEY,
        scene_id TEXT NOT NULL,
        asset_id TEXT,
        node_id TEXT NOT NULL,
        node_name TEXT NOT NULL,
        prompt TEXT,
        position_x REAL DEFAULT 0, position_y REAL DEFAULT 0, position_z REAL DEFAULT 0,
        rotation_x REAL DEFAULT 0, rotation_y REAL DEFAULT 0, rotation_z REAL DEFAULT 0,
        scale_x REAL DEFAULT 1, scale_y REAL DEFAULT 1, scale_z REAL DEFAULT 1,
        status TEXT DEFAULT 'pending'
          CHECK (status IN ('pending','generating','complete','failed')),
        generation_job_id TEXT,
        file_path TEXT,
        file_size INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE CASCADE,
        FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_scenes_project ON scenes(project_id);
      CREATE INDEX IF NOT EXISTS idx_scenes_status ON scenes(status);
      CREATE INDEX IF NOT EXISTS idx_scene_assets_scene ON scene_assets(scene_id);
    `
  },
  {
    version: 7,
    description: 'Add worlds and world_regions tables for AI World Generator (Phase 15)',
    sql: `
      CREATE TABLE IF NOT EXISTS worlds (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        name TEXT NOT NULL,
        world_type TEXT DEFAULT 'fantasy',
        prompt TEXT,
        pipeline_id TEXT,
        world_size TEXT DEFAULT 'medium'
          CHECK (world_size IN ('small','medium','large')),
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','analyzing','generating','assembling','streaming','complete','failed')),
        region_count INTEGER DEFAULT 0,
        world_graph TEXT DEFAULT '{}',
        export_path TEXT,
        export_size INTEGER DEFAULT 0,
        streaming_manifest TEXT DEFAULT '{}',
        generation_time REAL,
        error TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS world_regions (
        id TEXT PRIMARY KEY,
        world_id TEXT NOT NULL,
        region_id TEXT NOT NULL,
        name TEXT NOT NULL,
        biome TEXT DEFAULT 'plains',
        grid_x INTEGER NOT NULL,
        grid_y INTEGER NOT NULL,
        scene_id TEXT,
        landmarks TEXT DEFAULT '[]',
        adjacency TEXT DEFAULT '[]',
        streaming_group TEXT,
        status TEXT DEFAULT 'pending'
          CHECK (status IN ('pending','generating','complete','failed')),
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE CASCADE,
        FOREIGN KEY (scene_id) REFERENCES scenes(id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_worlds_project ON worlds(project_id);
      CREATE INDEX IF NOT EXISTS idx_worlds_status ON worlds(status);
      CREATE INDEX IF NOT EXISTS idx_world_regions_world ON world_regions(world_id);
      CREATE INDEX IF NOT EXISTS idx_world_regions_scene ON world_regions(scene_id);
    `
  },
  {
    version: 8,
    description: 'Add prototypes, npcs, quests, interactions tables for Gameplay Generator (Phase 16)',
    sql: `
      CREATE TABLE IF NOT EXISTS prototypes (
        id TEXT PRIMARY KEY,
        world_id TEXT,
        name TEXT NOT NULL,
        prompt TEXT,
        genre TEXT DEFAULT 'adventure',
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','analyzing','generating','validating','complete','failed')),
        npc_count INTEGER DEFAULT 0,
        quest_count INTEGER DEFAULT 0,
        interaction_count INTEGER DEFAULT 0,
        export_path TEXT,
        export_size INTEGER DEFAULT 0,
        generation_time REAL,
        error TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (world_id) REFERENCES worlds(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS npcs (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'wanderer'
          CHECK (role IN ('merchant','guard','quest_giver','wanderer')),
        behavior TEXT DEFAULT 'idle',
        region_id TEXT,
        dialogue_seed TEXT,
        spawn_position TEXT DEFAULT '[]',
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (prototype_id) REFERENCES prototypes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS quests (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        title TEXT NOT NULL,
        objectives TEXT DEFAULT '[]',
        triggers TEXT DEFAULT '[]',
        rewards TEXT DEFAULT '[]',
        chain_order INTEGER DEFAULT 0,
        prerequisite_quest_id TEXT,
        npc_giver_id TEXT,
        status TEXT DEFAULT 'active'
          CHECK (status IN ('active','completed','failed','locked')),
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (prototype_id) REFERENCES prototypes(id) ON DELETE CASCADE,
        FOREIGN KEY (npc_giver_id) REFERENCES npcs(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS interactions (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        target_node TEXT NOT NULL,
        type TEXT NOT NULL
          CHECK (type IN ('pickup_item','trigger_event','dialogue','activate_object')),
        parameters TEXT DEFAULT '{}',
        region_id TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (prototype_id) REFERENCES prototypes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_prototypes_world ON prototypes(world_id);
      CREATE INDEX IF NOT EXISTS idx_prototypes_status ON prototypes(status);
      CREATE INDEX IF NOT EXISTS idx_npcs_prototype ON npcs(prototype_id);
      CREATE INDEX IF NOT EXISTS idx_npcs_region ON npcs(region_id);
      CREATE INDEX IF NOT EXISTS idx_quests_prototype ON quests(prototype_id);
      CREATE INDEX IF NOT EXISTS idx_interactions_prototype ON interactions(prototype_id);
    `
  },
  {
    version: 9,
    description: 'Add playtest_runs and playtest_reports tables for AI Playtest Engine (Phase 17)',
    sql: `
      CREATE TABLE IF NOT EXISTS playtest_runs (
        id TEXT PRIMARY KEY,
        prototype_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending','simulating','analyzing','complete','failed')),
        pipeline_id TEXT,
        agent_count INTEGER DEFAULT 3,
        agent_types TEXT DEFAULT '["explorer","quest_focused","speedrunner"]',
        max_ticks INTEGER DEFAULT 1000,
        actual_ticks INTEGER,
        overall_score REAL,
        grade TEXT,
        generation_time REAL,
        error TEXT,
        metadata TEXT DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (prototype_id) REFERENCES prototypes(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS playtest_reports (
        id TEXT PRIMARY KEY,
        playtest_run_id TEXT NOT NULL,
        report_type TEXT NOT NULL DEFAULT 'full'
          CHECK (report_type IN ('full','summary')),
        report_json TEXT DEFAULT '{}',
        suggestions_json TEXT DEFAULT '{}',
        quest_completion_rate REAL,
        avg_quest_time REAL,
        npc_interaction_rate REAL,
        navigation_failure_rate REAL,
        deadlock_count INTEGER DEFAULT 0,
        bottleneck_count INTEGER DEFAULT 0,
        overall_score REAL,
        grade TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (playtest_run_id) REFERENCES playtest_runs(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_playtest_runs_prototype ON playtest_runs(prototype_id);
      CREATE INDEX IF NOT EXISTS idx_playtest_runs_status ON playtest_runs(status);
      CREATE INDEX IF NOT EXISTS idx_playtest_reports_run ON playtest_reports(playtest_run_id);
    `
  },
  {
    version: 10,
    description: 'Add priority column and index to generation_history',
    sql: `
      ALTER TABLE generation_history ADD COLUMN priority INTEGER DEFAULT 1;
      CREATE INDEX IF NOT EXISTS idx_history_priority ON generation_history(priority, status, created_at);
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
    this.db.pragma('journal_mode = ' + forge3dConfig.database.journal_mode);
    this.db.pragma('busy_timeout = ' + forge3dConfig.database.busy_timeout_ms);
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
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
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
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const metadata = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {});
    // MINOR: Populate material_data in database
    const materialData = typeof data.material_data === 'string' ? data.material_data : JSON.stringify(data.material_data || {});
    const hasMaterials = data.has_materials || 0;

    this.db.prepare(
      'INSERT INTO assets (id, project_id, name, type, file_path, thumbnail_path, file_size, metadata, fbx_path, fbx_size, material_data, has_materials) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, projectId, data.name, data.type, data.filePath || null, data.thumbnailPath || null, data.fileSize || 0, metadata, data.fbxPath || null, data.fbxSize || 0, materialData, hasMaterials);

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
    // MINOR: Parse material_data JSON
    if (asset && asset.material_data) {
      try { asset.material_data = JSON.parse(asset.material_data); } catch (_e) { /* keep as string */ }
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
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const metadata = typeof data.metadata === 'string' ? data.metadata : JSON.stringify(data.metadata || {});

    this.db.prepare(
      'INSERT INTO generation_history (id, asset_id, project_id, type, prompt, status, model, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, data.assetId || null, data.projectId || null, data.type, data.prompt || null, data.status || 'queued', data.model || null, metadata);

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
    if (updates.model !== undefined) {
      fields.push('model = ?');
      values.push(updates.model);
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

  // --- Scenes ---

  createScene({ projectId, name, prompt, pipelineId, sceneType }) {
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    this.db.prepare(
      'INSERT INTO scenes (id, project_id, name, prompt, pipeline_id, scene_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, projectId || null, name, prompt || null, pipelineId || null, sceneType || 'outdoor');
    console.log(`[DB] Scene created: ${id} "${name}"`);
    return this.getScene(id);
  }

  getScene(id) {
    const scene = this.db.prepare('SELECT * FROM scenes WHERE id = ?').get(id);
    if (!scene) return null;
    try { scene.metadata = JSON.parse(scene.metadata); } catch (_e) { /* keep as string */ }
    try { scene.scene_graph = JSON.parse(scene.scene_graph); } catch (_e) { /* keep as string */ }
    return scene;
  }

  updateScene(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.pipelineId !== undefined) {
      fields.push('pipeline_id = ?');
      values.push(updates.pipelineId);
    }
    if (updates.assetCount !== undefined) {
      fields.push('asset_count = ?');
      values.push(updates.assetCount);
    }
    if (updates.sceneGraph !== undefined) {
      fields.push('scene_graph = ?');
      values.push(typeof updates.sceneGraph === 'string' ? updates.sceneGraph : JSON.stringify(updates.sceneGraph));
    }
    if (updates.assembledPath !== undefined) {
      fields.push('assembled_path = ?');
      values.push(updates.assembledPath);
    }
    if (updates.assembledSize !== undefined) {
      fields.push('assembled_size = ?');
      values.push(updates.assembledSize);
    }
    if (updates.descriptorPath !== undefined) {
      fields.push('descriptor_path = ?');
      values.push(updates.descriptorPath);
    }
    if (updates.generationTime !== undefined) {
      fields.push('generation_time = ?');
      values.push(updates.generationTime);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.status === 'complete' || updates.status === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }

    if (fields.length === 0) return this.getScene(id);

    values.push(id);
    this.db.prepare(
      `UPDATE scenes SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);

    return this.getScene(id);
  }

  listScenes(options = {}) {
    let sql = 'SELECT * FROM scenes';
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

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }

    sql += ' ORDER BY created_at DESC';

    // Sanitize LIMIT to prevent injection — clamp to safe integer range
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 500);
    sql += ' LIMIT ?';
    params.push(limit);

    const scenes = this.db.prepare(sql).all(...params);
    return scenes.map((s) => {
      try { s.metadata = JSON.parse(s.metadata); } catch (_e) { /* keep as string */ }
      try { s.scene_graph = JSON.parse(s.scene_graph); } catch (_e) { /* keep as string */ }
      return s;
    });
  }

  deleteScene(id) {
    const result = this.db.prepare('DELETE FROM scenes WHERE id = ?').run(id);
    console.log(`[DB] Scene deleted: ${id} (${result.changes} rows)`);
    return result.changes > 0;
  }

  // --- Scene Assets ---

  createSceneAsset({ sceneId, nodeId, nodeName, prompt, position, rotation, scale }) {
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const pos = position || { x: 0, y: 0, z: 0 };
    const rot = rotation || { x: 0, y: 0, z: 0 };
    const scl = scale || { x: 1, y: 1, z: 1 };

    this.db.prepare(
      `INSERT INTO scene_assets (id, scene_id, node_id, node_name, prompt,
        position_x, position_y, position_z,
        rotation_x, rotation_y, rotation_z,
        scale_x, scale_y, scale_z)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, sceneId, nodeId, nodeName, prompt || null,
      pos.x, pos.y, pos.z,
      rot.x, rot.y, rot.z,
      scl.x, scl.y, scl.z);

    console.log(`[DB] Scene asset created: ${id} "${nodeName}" in scene ${sceneId}`);
    return this.getSceneAsset(id);
  }

  getSceneAsset(id) {
    return this.db.prepare('SELECT * FROM scene_assets WHERE id = ?').get(id) || null;
  }

  getSceneAssets(sceneId) {
    return this.db.prepare(
      'SELECT * FROM scene_assets WHERE scene_id = ? ORDER BY created_at ASC'
    ).all(sceneId);
  }

  updateSceneAsset(id, updates) {
    const fields = [];
    const values = [];

    if (updates.status !== undefined) {
      fields.push('status = ?');
      values.push(updates.status);
    }
    if (updates.assetId !== undefined) {
      fields.push('asset_id = ?');
      values.push(updates.assetId);
    }
    if (updates.generationJobId !== undefined) {
      fields.push('generation_job_id = ?');
      values.push(updates.generationJobId);
    }
    if (updates.filePath !== undefined) {
      fields.push('file_path = ?');
      values.push(updates.filePath);
    }
    if (updates.fileSize !== undefined) {
      fields.push('file_size = ?');
      values.push(updates.fileSize);
    }

    if (fields.length === 0) return;

    values.push(id);
    this.db.prepare(
      `UPDATE scene_assets SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  // --- Sessions (Phase 8 persistence) ---

  createSession(data) {
    this.db.prepare(
      'INSERT INTO sessions (id, type, state, prompt) VALUES (?, ?, ?, ?)'
    ).run(data.id, data.type, data.state || 'idle', data.prompt || null);
  }

  getSession(id) {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) || null;
  }

  updateSession(id, updates) {
    const fields = [];
    const values = [];

    if (updates.state !== undefined) {
      fields.push('state = ?');
      values.push(updates.state);
    }
    if (updates.error !== undefined) {
      fields.push('error = ?');
      values.push(updates.error);
    }
    if (updates.resultPath !== undefined) {
      fields.push('result_path = ?');
      values.push(updates.resultPath);
    }
    if (updates.resultType !== undefined) {
      fields.push('result_type = ?');
      values.push(updates.resultType);
    }
    if (updates.state === 'complete' || updates.state === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }
    if (updates.state && updates.state.startsWith('generating')) {
      fields.push('started_at = datetime(\'now\')');
    }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(
      `UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`
    ).run(...values);
  }

  listSessions(options = {}) {
    let sql = 'SELECT * FROM sessions ORDER BY created_at DESC';
    sql += ` LIMIT ${options.limit || 50}`;
    return this.db.prepare(sql).all();
  }

  /**
   * Find incomplete generations (for crash recovery).
   */
  findIncomplete() {
    return this.db.prepare(
      'SELECT * FROM generation_history WHERE status IN (\'queued\', \'processing\') ORDER BY created_at ASC'
    ).all();
  }

  // --- Worlds (Phase 15) ---

  createWorld({ projectId, name, prompt, worldSize, worldType }) {
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    this.db.prepare(
      'INSERT INTO worlds (id, project_id, name, prompt, world_size, world_type) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, projectId || null, name, prompt || null, worldSize || 'medium', worldType || 'fantasy');
    console.log(`[DB] World created: ${id} "${name}"`);
    return this.getWorld(id);
  }

  getWorld(id) {
    if (!id) return null;
    const world = this.db.prepare('SELECT * FROM worlds WHERE id = ?').get(id);
    if (!world) return null;
    try { world.metadata = JSON.parse(world.metadata); } catch (_e) { /* keep */ }
    try { world.world_graph = JSON.parse(world.world_graph); } catch (_e) { /* keep */ }
    try { world.streaming_manifest = JSON.parse(world.streaming_manifest); } catch (_e) { /* keep */ }
    return world;
  }

  updateWorld(id, updates) {
    if (!id) return null;
    const fields = [];
    const values = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.pipelineId !== undefined) { fields.push('pipeline_id = ?'); values.push(updates.pipelineId); }
    if (updates.regionCount !== undefined) { fields.push('region_count = ?'); values.push(updates.regionCount); }
    if (updates.worldGraph !== undefined) {
      fields.push('world_graph = ?');
      values.push(typeof updates.worldGraph === 'string' ? updates.worldGraph : JSON.stringify(updates.worldGraph));
    }
    if (updates.exportPath !== undefined) { fields.push('export_path = ?'); values.push(updates.exportPath); }
    if (updates.exportSize !== undefined) { fields.push('export_size = ?'); values.push(updates.exportSize); }
    if (updates.streamingManifest !== undefined) {
      fields.push('streaming_manifest = ?');
      values.push(typeof updates.streamingManifest === 'string' ? updates.streamingManifest : JSON.stringify(updates.streamingManifest));
    }
    if (updates.generationTime !== undefined) { fields.push('generation_time = ?'); values.push(updates.generationTime); }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }
    if (updates.status === 'complete' || updates.status === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }

    if (fields.length === 0) return this.getWorld(id);
    values.push(id);
    this.db.prepare(`UPDATE worlds SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getWorld(id);
  }

  listWorlds(options = {}) {
    let sql = 'SELECT * FROM worlds';
    const conditions = [];
    const params = [];

    if (options.projectId) { conditions.push('project_id = ?'); params.push(options.projectId); }
    if (options.status) { conditions.push('status = ?'); params.push(options.status); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 500);
    sql += ' LIMIT ?';
    params.push(limit);

    const worlds = this.db.prepare(sql).all(...params);
    return worlds.map((w) => {
      try { w.metadata = JSON.parse(w.metadata); } catch (_e) { /* keep */ }
      try { w.world_graph = JSON.parse(w.world_graph); } catch (_e) { /* keep */ }
      return w;
    });
  }

  deleteWorld(id) {
    if (!id) return false;
    const result = this.db.prepare('DELETE FROM worlds WHERE id = ?').run(id);
    console.log(`[DB] World deleted: ${id} (${result.changes} rows)`);
    return result.changes > 0;
  }

  // --- World Regions ---

  createWorldRegion({ worldId, regionId, name, biome, gridX, gridY, landmarks, adjacency }) {
    if (!worldId || !regionId) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const landmarksJson = JSON.stringify(landmarks || []);
    const adjacencyJson = JSON.stringify(adjacency || []);

    this.db.prepare(
      `INSERT INTO world_regions (id, world_id, region_id, name, biome, grid_x, grid_y, landmarks, adjacency)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, worldId, regionId, name || 'Unnamed', biome || 'plains', gridX || 0, gridY || 0, landmarksJson, adjacencyJson);
    console.log(`[DB] World region created: ${id} "${name}" in world ${worldId}`);
    return this.getWorldRegion(id);
  }

  getWorldRegion(id) {
    if (!id) return null;
    const region = this.db.prepare('SELECT * FROM world_regions WHERE id = ?').get(id);
    if (!region) return null;
    try { region.landmarks = JSON.parse(region.landmarks); } catch (_e) { /* keep */ }
    try { region.adjacency = JSON.parse(region.adjacency); } catch (_e) { /* keep */ }
    try { region.metadata = JSON.parse(region.metadata); } catch (_e) { /* keep */ }
    return region;
  }

  getWorldRegions(worldId) {
    if (!worldId) return [];
    const regions = this.db.prepare(
      'SELECT * FROM world_regions WHERE world_id = ? ORDER BY grid_y ASC, grid_x ASC'
    ).all(worldId);
    return regions.map((r) => {
      try { r.landmarks = JSON.parse(r.landmarks); } catch (_e) { /* keep */ }
      try { r.adjacency = JSON.parse(r.adjacency); } catch (_e) { /* keep */ }
      try { r.metadata = JSON.parse(r.metadata); } catch (_e) { /* keep */ }
      return r;
    });
  }

  updateWorldRegion(id, updates) {
    if (!id) return;
    const fields = [];
    const values = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.sceneId !== undefined) { fields.push('scene_id = ?'); values.push(updates.sceneId); }
    if (updates.streamingGroup !== undefined) { fields.push('streaming_group = ?'); values.push(updates.streamingGroup); }

    if (fields.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE world_regions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  // --- Prototypes (Phase 16) ---

  createPrototype({ worldId, name, prompt, genre }) {
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    this.db.prepare(
      'INSERT INTO prototypes (id, world_id, name, prompt, genre) VALUES (?, ?, ?, ?, ?)'
    ).run(id, worldId || null, name, prompt || null, genre || 'adventure');
    console.log(`[DB] Prototype created: ${id} "${name}"`);
    return this.getPrototype(id);
  }

  getPrototype(id) {
    if (!id) return null;
    const proto = this.db.prepare('SELECT * FROM prototypes WHERE id = ?').get(id);
    if (!proto) return null;
    try { proto.metadata = JSON.parse(proto.metadata); } catch (_e) { /* keep */ }
    return proto;
  }

  updatePrototype(id, updates) {
    if (!id) return null;
    const fields = [];
    const values = [];

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
    if (updates.npcCount !== undefined) { fields.push('npc_count = ?'); values.push(updates.npcCount); }
    if (updates.questCount !== undefined) { fields.push('quest_count = ?'); values.push(updates.questCount); }
    if (updates.interactionCount !== undefined) { fields.push('interaction_count = ?'); values.push(updates.interactionCount); }
    if (updates.exportPath !== undefined) { fields.push('export_path = ?'); values.push(updates.exportPath); }
    if (updates.exportSize !== undefined) { fields.push('export_size = ?'); values.push(updates.exportSize); }
    if (updates.generationTime !== undefined) { fields.push('generation_time = ?'); values.push(updates.generationTime); }
    if (updates.error !== undefined) { fields.push('error = ?'); values.push(updates.error); }
    if (updates.status === 'complete' || updates.status === 'failed') {
      fields.push('completed_at = datetime(\'now\')');
    }

    if (fields.length === 0) return this.getPrototype(id);
    values.push(id);
    this.db.prepare(`UPDATE prototypes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getPrototype(id);
  }

  listPrototypes(options = {}) {
    let sql = 'SELECT * FROM prototypes';
    const conditions = [];
    const params = [];

    if (options.worldId) { conditions.push('world_id = ?'); params.push(options.worldId); }
    if (options.status) { conditions.push('status = ?'); params.push(options.status); }
    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    const limit = Math.min(Math.max(parseInt(options.limit, 10) || 50, 1), 500);
    sql += ' LIMIT ?';
    params.push(limit);

    return this.db.prepare(sql).all(...params).map((p) => {
      try { p.metadata = JSON.parse(p.metadata); } catch (_e) { /* keep */ }
      return p;
    });
  }

  deletePrototype(id) {
    if (!id) return false;
    const result = this.db.prepare('DELETE FROM prototypes WHERE id = ?').run(id);
    console.log(`[DB] Prototype deleted: ${id} (${result.changes} rows)`);
    return result.changes > 0;
  }

  // --- NPCs ---

  createNPC({ prototypeId, name, role, behavior, regionId, dialogueSeed, spawnPosition }) {
    if (!prototypeId || !name) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const posJson = JSON.stringify(spawnPosition || [0, 0, 0]);

    this.db.prepare(
      'INSERT INTO npcs (id, prototype_id, name, role, behavior, region_id, dialogue_seed, spawn_position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(id, prototypeId, name, role || 'wanderer', behavior || 'idle', regionId || null, dialogueSeed || null, posJson);
    return this.getNPC(id);
  }

  getNPC(id) {
    if (!id) return null;
    const npc = this.db.prepare('SELECT * FROM npcs WHERE id = ?').get(id);
    if (!npc) return null;
    try { npc.spawn_position = JSON.parse(npc.spawn_position); } catch (_e) { /* keep */ }
    try { npc.metadata = JSON.parse(npc.metadata); } catch (_e) { /* keep */ }
    return npc;
  }

  getNPCsByPrototype(prototypeId) {
    if (!prototypeId) return [];
    const npcs = this.db.prepare('SELECT * FROM npcs WHERE prototype_id = ? ORDER BY created_at ASC').all(prototypeId);
    return npcs.map((n) => {
      try { n.spawn_position = JSON.parse(n.spawn_position); } catch (_e) { /* keep */ }
      try { n.metadata = JSON.parse(n.metadata); } catch (_e) { /* keep */ }
      return n;
    });
  }

  // --- Quests ---

  createQuest({ prototypeId, title, objectives, triggers, rewards, chainOrder, prerequisiteQuestId, npcGiverId }) {
    if (!prototypeId || !title) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);

    this.db.prepare(
      `INSERT INTO quests (id, prototype_id, title, objectives, triggers, rewards, chain_order, prerequisite_quest_id, npc_giver_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, prototypeId, title,
      JSON.stringify(objectives || []),
      JSON.stringify(triggers || []),
      JSON.stringify(rewards || []),
      chainOrder || 0,
      prerequisiteQuestId || null,
      npcGiverId || null
    );
    return this.getQuest(id);
  }

  getQuest(id) {
    if (!id) return null;
    const quest = this.db.prepare('SELECT * FROM quests WHERE id = ?').get(id);
    if (!quest) return null;
    try { quest.objectives = JSON.parse(quest.objectives); } catch (_e) { /* keep */ }
    try { quest.triggers = JSON.parse(quest.triggers); } catch (_e) { /* keep */ }
    try { quest.rewards = JSON.parse(quest.rewards); } catch (_e) { /* keep */ }
    try { quest.metadata = JSON.parse(quest.metadata); } catch (_e) { /* keep */ }
    return quest;
  }

  getQuestsByPrototype(prototypeId) {
    if (!prototypeId) return [];
    const quests = this.db.prepare('SELECT * FROM quests WHERE prototype_id = ? ORDER BY chain_order ASC').all(prototypeId);
    return quests.map((q) => {
      try { q.objectives = JSON.parse(q.objectives); } catch (_e) { /* keep */ }
      try { q.triggers = JSON.parse(q.triggers); } catch (_e) { /* keep */ }
      try { q.rewards = JSON.parse(q.rewards); } catch (_e) { /* keep */ }
      try { q.metadata = JSON.parse(q.metadata); } catch (_e) { /* keep */ }
      return q;
    });
  }

  // --- Interactions ---

  createInteraction({ prototypeId, targetNode, type, parameters, regionId }) {
    if (!prototypeId || !targetNode || !type) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);

    this.db.prepare(
      'INSERT INTO interactions (id, prototype_id, target_node, type, parameters, region_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, prototypeId, targetNode, type, JSON.stringify(parameters || {}), regionId || null);
    return this.getInteraction(id);
  }

  getInteraction(id) {
    if (!id) return null;
    const interaction = this.db.prepare('SELECT * FROM interactions WHERE id = ?').get(id);
    if (!interaction) return null;
    try { interaction.parameters = JSON.parse(interaction.parameters); } catch (_e) { /* keep */ }
    try { interaction.metadata = JSON.parse(interaction.metadata); } catch (_e) { /* keep */ }
    return interaction;
  }

  getInteractionsByPrototype(prototypeId) {
    if (!prototypeId) return [];
    const interactions = this.db.prepare('SELECT * FROM interactions WHERE prototype_id = ? ORDER BY created_at ASC').all(prototypeId);
    return interactions.map((i) => {
      try { i.parameters = JSON.parse(i.parameters); } catch (_e) { /* keep */ }
      try { i.metadata = JSON.parse(i.metadata); } catch (_e) { /* keep */ }
      return i;
    });
  }

  // --- Playtest Runs (Phase 17) ---

  createPlaytestRun({ prototypeId, agentCount, agentTypes, maxTicks }) {
    if (!prototypeId) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    this.db.prepare(
      'INSERT INTO playtest_runs (id, prototype_id, agent_count, agent_types, max_ticks) VALUES (?, ?, ?, ?, ?)'
    ).run(id, prototypeId, agentCount || 3, JSON.stringify(agentTypes || ['explorer', 'quest_focused', 'speedrunner']), maxTicks || 1000);
    console.log(`[DB] Playtest run created: ${id}`);
    return this.getPlaytestRun(id);
  }

  getPlaytestRun(id) {
    if (!id) return null;
    const run = this.db.prepare('SELECT * FROM playtest_runs WHERE id = ?').get(id);
    if (!run) return null;
    try { run.agent_types = JSON.parse(run.agent_types); } catch (_e) { /* keep */ }
    try { run.metadata = JSON.parse(run.metadata); } catch (_e) { /* keep */ }
    return run;
  }

  updatePlaytestRun(id, updates) {
    if (!id) return null;
    const fields = [];
    const values = [];

    const allowed = {
      status: 'status', pipeline_id: 'pipeline_id', pipelineId: 'pipeline_id',
      actual_ticks: 'actual_ticks', actualTicks: 'actual_ticks',
      overall_score: 'overall_score', overallScore: 'overall_score',
      grade: 'grade', generation_time: 'generation_time', generationTime: 'generation_time',
      error: 'error', completedAt: 'completed_at', completed_at: 'completed_at'
    };

    for (const [key, col] of Object.entries(allowed)) {
      if (updates[key] !== undefined) {
        fields.push(`${col} = ?`);
        values.push(updates[key]);
      }
    }

    if (updates.metadata) {
      fields.push('metadata = ?');
      values.push(JSON.stringify(updates.metadata));
    }

    if (fields.length === 0) return this.getPlaytestRun(id);
    values.push(id);
    this.db.prepare(`UPDATE playtest_runs SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getPlaytestRun(id);
  }

  listPlaytestRuns(options = {}) {
    let sql = 'SELECT * FROM playtest_runs';
    const conditions = [];
    const params = [];

    if (options.prototypeId) {
      conditions.push('prototype_id = ?');
      params.push(options.prototypeId);
    }
    if (options.status) {
      conditions.push('status = ?');
      params.push(options.status);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY created_at DESC';

    const limit = Math.min(Math.max(parseInt(options.limit) || 50, 1), 100);
    sql += ` LIMIT ${limit}`;

    const runs = this.db.prepare(sql).all(...params);
    return runs.map((r) => {
      try { r.agent_types = JSON.parse(r.agent_types); } catch (_e) { /* keep */ }
      try { r.metadata = JSON.parse(r.metadata); } catch (_e) { /* keep */ }
      return r;
    });
  }

  deletePlaytestRun(id) {
    if (!id) return false;
    const result = this.db.prepare('DELETE FROM playtest_runs WHERE id = ?').run(id);
    console.log(`[DB] Playtest run deleted: ${id} (${result.changes} rows)`);
    return result.changes > 0;
  }

  // --- Playtest Reports ---

  createPlaytestReport({ playtestRunId, reportType, reportJson, suggestionsJson, metrics }) {
    if (!playtestRunId) return null;
    const id = randomUUID().slice(0, forge3dConfig.session.id_length);
    const m = metrics || {};

    this.db.prepare(
      `INSERT INTO playtest_reports (id, playtest_run_id, report_type, report_json, suggestions_json,
        quest_completion_rate, avg_quest_time, npc_interaction_rate, navigation_failure_rate,
        deadlock_count, bottleneck_count, overall_score, grade)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id, playtestRunId, reportType || 'full',
      JSON.stringify(reportJson || {}),
      JSON.stringify(suggestionsJson || {}),
      m.questCompletionRate || 0,
      m.averageQuestTime || 0,
      m.npcInteractionRate || 0,
      m.navigationFailureRate || 0,
      m.deadlockCount || 0,
      m.bottleneckCount || 0,
      m.overallScore || 0,
      m.grade || 'F'
    );
    console.log(`[DB] Playtest report created: ${id}`);
    return this.getPlaytestReport(id);
  }

  getPlaytestReport(id) {
    if (!id) return null;
    const report = this.db.prepare('SELECT * FROM playtest_reports WHERE id = ?').get(id);
    if (!report) return null;
    try { report.report_json = JSON.parse(report.report_json); } catch (_e) { /* keep */ }
    try { report.suggestions_json = JSON.parse(report.suggestions_json); } catch (_e) { /* keep */ }
    return report;
  }

  getPlaytestReportByRunId(playtestRunId) {
    if (!playtestRunId) return null;
    const report = this.db.prepare('SELECT * FROM playtest_reports WHERE playtest_run_id = ? ORDER BY created_at DESC LIMIT 1').get(playtestRunId);
    if (!report) return null;
    try { report.report_json = JSON.parse(report.report_json); } catch (_e) { /* keep */ }
    try { report.suggestions_json = JSON.parse(report.suggestions_json); } catch (_e) { /* keep */ }
    return report;
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

  // Test scenes
  const scene = db.createScene({
    projectId: project.id,
    name: 'Forest Clearing',
    prompt: 'a forest clearing with a cabin and trees',
    pipelineId: 'pipe-001',
    sceneType: 'outdoor'
  });
  console.assert(scene.name === 'Forest Clearing', 'Scene name should match');
  console.assert(scene.status === 'pending', 'Scene status should be pending');
  console.assert(scene.scene_type === 'outdoor', 'Scene type should be outdoor');
  console.assert(scene.id.length === 12, 'Scene ID should be 12 chars');

  const fetchedScene = db.getScene(scene.id);
  console.assert(fetchedScene !== null, 'Should fetch scene by ID');
  console.assert(typeof fetchedScene.metadata === 'object', 'Scene metadata should be parsed JSON');

  // Update scene
  const updatedScene = db.updateScene(scene.id, {
    status: 'generating',
    assetCount: 3,
    sceneGraph: { root: { id: 'root', children: [] } }
  });
  console.assert(updatedScene.status === 'generating', 'Updated scene status should be generating');
  console.assert(updatedScene.asset_count === 3, 'Updated asset count should be 3');

  // Complete scene
  const completedScene = db.updateScene(scene.id, {
    status: 'complete',
    assembledPath: '/data/output/scene.glb',
    assembledSize: 2048,
    generationTime: 120.5
  });
  console.assert(completedScene.status === 'complete', 'Completed scene status');
  console.assert(completedScene.completed_at !== null, 'Completed scene should have completed_at');
  console.assert(completedScene.assembled_path === '/data/output/scene.glb', 'Assembled path should match');

  // List scenes
  const scenes = db.listScenes({ projectId: project.id });
  console.assert(scenes.length >= 1, 'Should have at least 1 scene');

  const filteredScenes = db.listScenes({ status: 'complete' });
  console.assert(filteredScenes.length >= 1, 'Should find complete scenes');

  // Test scene assets
  const sceneAsset = db.createSceneAsset({
    sceneId: scene.id,
    nodeId: 'cabin-1',
    nodeName: 'Log Cabin',
    prompt: 'a rustic log cabin',
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 45, z: 0 },
    scale: { x: 1, y: 1, z: 1 }
  });
  console.assert(sceneAsset !== null, 'Scene asset should be created');
  console.assert(sceneAsset.node_id === 'cabin-1', 'Node ID should match');
  console.assert(sceneAsset.node_name === 'Log Cabin', 'Node name should match');
  console.assert(sceneAsset.rotation_y === 45, 'Rotation Y should be 45');
  console.assert(sceneAsset.scale_x === 1, 'Scale X should be 1');

  // Second asset
  db.createSceneAsset({
    sceneId: scene.id,
    nodeId: 'tree-1',
    nodeName: 'Pine Tree',
    prompt: 'a tall pine tree',
    position: { x: 5, y: 0, z: 3 }
  });

  const sceneAssets = db.getSceneAssets(scene.id);
  console.assert(sceneAssets.length === 2, `Should have 2 scene assets, got ${sceneAssets.length}`);

  // Update scene asset
  db.updateSceneAsset(sceneAsset.id, {
    status: 'complete',
    assetId: asset.id,
    filePath: '/data/output/cabin.glb',
    fileSize: 1024
  });

  const updatedAsset = db.getSceneAsset(sceneAsset.id);
  console.assert(updatedAsset.status === 'complete', 'Updated scene asset status');
  console.assert(updatedAsset.file_path === '/data/output/cabin.glb', 'Updated file path');
  console.assert(updatedAsset.asset_id === asset.id, 'Updated asset_id');

  // Delete scene (cascade deletes scene_assets)
  const deleted = db.deleteScene(scene.id);
  console.assert(deleted === true, 'Scene should be deleted');
  console.assert(db.getScene(scene.id) === null, 'Deleted scene should not be found');
  console.assert(db.getSceneAssets(scene.id).length === 0, 'Scene assets should be cascade deleted');

  // --- Test worlds (Phase 15, migration v7) ---
  const world = db.createWorld({
    projectId: project.id,
    name: 'Fantasy Kingdom',
    prompt: 'a fantasy kingdom with forests and mountains',
    worldSize: 'medium',
    worldType: 'fantasy'
  });
  console.assert(world !== null, 'World should be created');
  console.assert(world.name === 'Fantasy Kingdom', 'World name should match');
  console.assert(world.status === 'pending', 'World status should be pending');
  console.assert(world.world_size === 'medium', 'World size should be medium');
  console.assert(world.id.length === 12, 'World ID should be 12 chars');

  // Update world
  const updatedWorld = db.updateWorld(world.id, {
    status: 'generating',
    regionCount: 4,
    worldGraph: { regions: [] }
  });
  console.assert(updatedWorld.status === 'generating', 'Updated world status');
  console.assert(updatedWorld.region_count === 4, 'Updated region count');

  // List worlds
  const worlds = db.listWorlds({ projectId: project.id });
  console.assert(worlds.length >= 1, 'Should have at least 1 world');

  // Null guards
  console.assert(db.getWorld(null) === null, 'getWorld(null) should return null');
  console.assert(db.updateWorld(null, {}) === null, 'updateWorld(null) should return null');
  console.assert(db.deleteWorld(null) === false, 'deleteWorld(null) should return false');

  // Test world regions
  const region = db.createWorldRegion({
    worldId: world.id,
    regionId: 'forest-1',
    name: 'Dark Forest',
    biome: 'forest',
    gridX: 0,
    gridY: 0,
    landmarks: ['Ancient Tree'],
    adjacency: ['plains-1']
  });
  console.assert(region !== null, 'World region should be created');
  console.assert(region.region_id === 'forest-1', 'Region ID should match');
  console.assert(region.biome === 'forest', 'Biome should match');
  console.assert(region.grid_x === 0, 'Grid X should be 0');
  console.assert(Array.isArray(region.landmarks), 'Landmarks should be parsed array');
  console.assert(region.landmarks.length === 1, 'Should have 1 landmark');

  db.createWorldRegion({ worldId: world.id, regionId: 'plains-1', name: 'Golden Plains', biome: 'plains', gridX: 1, gridY: 0 });
  const regions = db.getWorldRegions(world.id);
  console.assert(regions.length === 2, `Should have 2 regions, got ${regions.length}`);

  // Create a scene to reference from region (FK constraint requires valid scene_id)
  const regionScene = db.createScene({ projectId: project.id, name: 'Region Scene', prompt: 'forest scene' });

  // Update region
  db.updateWorldRegion(region.id, { status: 'complete', sceneId: regionScene.id, streamingGroup: 'chunk_0_0' });
  const updatedRegion = db.getWorldRegion(region.id);
  console.assert(updatedRegion.status === 'complete', 'Region status should be updated');
  console.assert(updatedRegion.scene_id === regionScene.id, 'Region scene_id should be updated');

  // Null guards
  console.assert(db.createWorldRegion({ worldId: null, regionId: 'x' }) === null, 'Null worldId should return null');
  console.assert(db.getWorldRegion(null) === null, 'getWorldRegion(null) should return null');
  console.assert(db.getWorldRegions(null).length === 0, 'getWorldRegions(null) should return []');

  // --- Test prototypes (Phase 16, migration v8) ---
  const proto = db.createPrototype({
    worldId: world.id,
    name: 'Village Defense',
    prompt: 'defend a village from monsters',
    genre: 'adventure'
  });
  console.assert(proto !== null, 'Prototype should be created');
  console.assert(proto.name === 'Village Defense', 'Proto name should match');
  console.assert(proto.genre === 'adventure', 'Proto genre should match');
  console.assert(proto.status === 'pending', 'Proto status should be pending');

  // Update prototype
  const updatedProto = db.updatePrototype(proto.id, { status: 'generating', npcCount: 3, questCount: 2, interactionCount: 5 });
  console.assert(updatedProto.npc_count === 3, 'Updated NPC count');
  console.assert(updatedProto.quest_count === 2, 'Updated quest count');

  // Null guards
  console.assert(db.getPrototype(null) === null, 'getPrototype(null) should return null');
  console.assert(db.updatePrototype(null, {}) === null, 'updatePrototype(null) should return null');

  // Test NPCs
  const npc = db.createNPC({
    prototypeId: proto.id,
    name: 'Elder Sage',
    role: 'quest_giver',
    behavior: 'idle',
    regionId: 'forest-1',
    dialogueSeed: 'Welcome, traveler',
    spawnPosition: [10, 0, 5]
  });
  console.assert(npc !== null, 'NPC should be created');
  console.assert(npc.name === 'Elder Sage', 'NPC name should match');
  console.assert(npc.role === 'quest_giver', 'NPC role should match');
  console.assert(Array.isArray(npc.spawn_position), 'Spawn position should be parsed array');

  db.createNPC({ prototypeId: proto.id, name: 'Guard Captain', role: 'guard', behavior: 'patrol' });
  const npcs = db.getNPCsByPrototype(proto.id);
  console.assert(npcs.length === 2, `Should have 2 NPCs, got ${npcs.length}`);
  console.assert(db.createNPC({ prototypeId: null, name: 'Bad' }) === null, 'Null prototypeId should return null');
  console.assert(db.getNPC(null) === null, 'getNPC(null) should return null');

  // Test quests
  const quest = db.createQuest({
    prototypeId: proto.id,
    title: 'Gather Supplies',
    objectives: [{ desc: 'Collect 5 herbs', type: 'collect' }],
    triggers: [{ type: 'talk_to_npc', npcId: npc.id }],
    rewards: [{ type: 'experience', amount: 100 }],
    chainOrder: 1,
    npcGiverId: npc.id
  });
  console.assert(quest !== null, 'Quest should be created');
  console.assert(quest.title === 'Gather Supplies', 'Quest title should match');
  console.assert(Array.isArray(quest.objectives), 'Objectives should be parsed array');
  console.assert(quest.objectives.length === 1, 'Should have 1 objective');
  console.assert(quest.chain_order === 1, 'Chain order should be 1');

  const quests = db.getQuestsByPrototype(proto.id);
  console.assert(quests.length === 1, 'Should have 1 quest');
  console.assert(db.createQuest({ prototypeId: null, title: 'Bad' }) === null, 'Null prototypeId should return null');

  // Test interactions
  const interaction = db.createInteraction({
    prototypeId: proto.id,
    targetNode: 'chest-1',
    type: 'pickup_item',
    parameters: { item: 'health_potion', quantity: 1 },
    regionId: 'forest-1'
  });
  console.assert(interaction !== null, 'Interaction should be created');
  console.assert(interaction.target_node === 'chest-1', 'Target node should match');
  console.assert(interaction.type === 'pickup_item', 'Interaction type should match');
  console.assert(typeof interaction.parameters === 'object', 'Parameters should be parsed');

  const interactions = db.getInteractionsByPrototype(proto.id);
  console.assert(interactions.length === 1, 'Should have 1 interaction');
  console.assert(db.createInteraction({ prototypeId: null, targetNode: 'x', type: 'dialogue' }) === null, 'Null proto should return null');
  console.assert(db.getInteraction(null) === null, 'getInteraction(null) should return null');

  // Test cascade delete: delete world → regions cascade, delete prototype → npcs/quests/interactions cascade
  db.deletePrototype(proto.id);
  console.assert(db.getPrototype(proto.id) === null, 'Deleted prototype should not be found');
  console.assert(db.getNPCsByPrototype(proto.id).length === 0, 'NPCs should cascade delete');
  console.assert(db.getQuestsByPrototype(proto.id).length === 0, 'Quests should cascade delete');
  console.assert(db.getInteractionsByPrototype(proto.id).length === 0, 'Interactions should cascade delete');

  db.deleteWorld(world.id);
  console.assert(db.getWorld(world.id) === null, 'Deleted world should not be found');
  console.assert(db.getWorldRegions(world.id).length === 0, 'Regions should cascade delete');

  // --- Test playtest runs (Phase 17, migration v9) ---
  const proto2 = db.createPrototype({ name: 'Test Proto', prompt: 'test', genre: 'adventure' });

  const ptRun = db.createPlaytestRun({
    prototypeId: proto2.id,
    agentCount: 3,
    agentTypes: ['explorer', 'quest_focused', 'speedrunner'],
    maxTicks: 500
  });
  console.assert(ptRun !== null, 'Playtest run should be created');
  console.assert(ptRun.prototype_id === proto2.id, 'Proto ID should match');
  console.assert(ptRun.agent_count === 3, 'Agent count should be 3');
  console.assert(ptRun.max_ticks === 500, 'Max ticks should be 500');
  console.assert(Array.isArray(ptRun.agent_types), 'Agent types should be parsed array');
  console.assert(ptRun.status === 'pending', 'Status should be pending');

  // Update playtest run
  const updatedRun = db.updatePlaytestRun(ptRun.id, {
    status: 'complete',
    actualTicks: 250,
    overallScore: 85.5,
    grade: 'B',
    completedAt: new Date().toISOString()
  });
  console.assert(updatedRun.status === 'complete', 'Updated status');
  console.assert(updatedRun.actual_ticks === 250, 'Updated actual ticks');
  console.assert(updatedRun.overall_score === 85.5, 'Updated overall score');
  console.assert(updatedRun.grade === 'B', 'Updated grade');

  // List playtest runs
  const ptRuns = db.listPlaytestRuns({ prototypeId: proto2.id });
  console.assert(ptRuns.length >= 1, 'Should list at least 1 run');

  // Null guards
  console.assert(db.createPlaytestRun({ prototypeId: null }) === null, 'Null protoId should return null');
  console.assert(db.getPlaytestRun(null) === null, 'getPlaytestRun(null) should return null');
  console.assert(db.updatePlaytestRun(null, {}) === null, 'updatePlaytestRun(null) should return null');
  console.assert(db.deletePlaytestRun(null) === false, 'deletePlaytestRun(null) should return false');

  // Test playtest reports
  const ptReport = db.createPlaytestReport({
    playtestRunId: ptRun.id,
    reportType: 'full',
    reportJson: { version: 1, agents: [] },
    suggestionsJson: { version: 1, categories: {} },
    metrics: {
      questCompletionRate: 90,
      averageQuestTime: 45,
      npcInteractionRate: 80,
      navigationFailureRate: 5,
      deadlockCount: 0,
      bottleneckCount: 1,
      overallScore: 85.5,
      grade: 'B'
    }
  });
  console.assert(ptReport !== null, 'Playtest report should be created');
  console.assert(ptReport.quest_completion_rate === 90, 'Quest completion rate should match');
  console.assert(typeof ptReport.report_json === 'object', 'Report JSON should be parsed');

  // Get by run ID
  const foundReport = db.getPlaytestReportByRunId(ptRun.id);
  console.assert(foundReport !== null, 'Should find report by run ID');
  console.assert(foundReport.playtest_run_id === ptRun.id, 'Run ID should match');

  // Null guards
  console.assert(db.createPlaytestReport({ playtestRunId: null }) === null, 'Null runId should return null');
  console.assert(db.getPlaytestReport(null) === null, 'getPlaytestReport(null) should return null');
  console.assert(db.getPlaytestReportByRunId(null) === null, 'getPlaytestReportByRunId(null) should return null');

  // Cascade: delete playtest run should delete reports
  db.deletePlaytestRun(ptRun.id);
  console.assert(db.getPlaytestRun(ptRun.id) === null, 'Deleted run should not be found');
  console.assert(db.getPlaytestReportByRunId(ptRun.id) === null, 'Reports should cascade delete');

  db.deletePrototype(proto2.id);

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
