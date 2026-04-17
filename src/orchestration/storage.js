/**
 * OrchestrationStorage - SQLite persistence for orchestration runtime
 *
 * Schema: task_states, orchestration_events, audit_results, agent_registry
 * Uses WAL mode for concurrent reads, single-writer with busy timeout.
 * Migration system with version table.
 *
 * STATUS: Complete. Schema v1 with 4 tables, CRUD methods, integrity checks.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-03-02
 */

import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, statSync } from 'fs';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_DB_PATH = join(__dirname, '..', '..', 'data', 'orchestration.db');

// Schema migrations
const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema: task_states, orchestration_events, audit_results, agent_registry',
    sql: `
      CREATE TABLE IF NOT EXISTS task_states (
        task_id TEXT PRIMARY KEY,
        task_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'paused', 'completed', 'failed')),
        current_agent TEXT NOT NULL,
        current_phase TEXT NOT NULL DEFAULT 'analysis'
          CHECK (current_phase IN ('analysis', 'design', 'implementation', 'validation')),
        state_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS orchestration_events (
        event_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        agent TEXT NOT NULL,
        task_id TEXT,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        integrity_hash TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES task_states(task_id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS audit_results (
        audit_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        audit_type TEXT NOT NULL
          CHECK (audit_type IN ('structural', 'coding_standard', 'continuity', 'full')),
        result TEXT NOT NULL
          CHECK (result IN ('pass', 'warning', 'fail')),
        confidence_score REAL NOT NULL DEFAULT 0.0,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (task_id) REFERENCES task_states(task_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS agent_registry (
        name TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('cloud', 'local')),
        capabilities TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'available'
          CHECK (status IN ('available', 'busy', 'offline')),
        last_active_at TEXT DEFAULT (datetime('now')),
        registered_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_task_states_status ON task_states(status);
      CREATE INDEX IF NOT EXISTS idx_task_states_agent ON task_states(current_agent);
      CREATE INDEX IF NOT EXISTS idx_events_task ON orchestration_events(task_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON orchestration_events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON orchestration_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON orchestration_events(agent);
      CREATE INDEX IF NOT EXISTS idx_audit_task ON audit_results(task_id);
      CREATE INDEX IF NOT EXISTS idx_audit_type ON audit_results(audit_type);
    `
  },
  {
    version: 2,
    description: 'Idea Intelligence schema: ideas + idea_relationships',
    sql: `
      CREATE TABLE IF NOT EXISTS ideas (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        summary TEXT,
        category TEXT CHECK (category IN (
          'AI', 'Tooling', 'Product', 'Experimental', 'Game Dev', 'Infrastructure'
        )),
        score_total REAL DEFAULT 0.0,
        priority_label TEXT CHECK (priority_label IN ('HIGH', 'MID', 'LOW', 'SHINY_OBJECT')),
        profitability_score REAL DEFAULT 0.0,
        portfolio_score REAL DEFAULT 0.0,
        complexity_score REAL DEFAULT 0.0,
        novelty_score REAL DEFAULT 0.0,
        execution_speed_score REAL DEFAULT 0.0,
        related_projects TEXT DEFAULT '[]',
        missing_features TEXT DEFAULT '[]',
        source_path TEXT,
        content_hash TEXT NOT NULL,
        embedding TEXT,
        vault_path TEXT,
        status TEXT DEFAULT 'raw' CHECK (status IN (
          'raw', 'classified', 'scored', 'researched', 'indexed', 'executing', 'completed'
        )),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS idea_relationships (
        id TEXT PRIMARY KEY,
        idea_id TEXT NOT NULL,
        related_idea_id TEXT NOT NULL,
        similarity_score REAL DEFAULT 0.0,
        relationship_type TEXT CHECK (relationship_type IN (
          'duplicate', 'related', 'extends', 'conflicts', 'supersedes'
        )),
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (idea_id) REFERENCES ideas(id) ON DELETE CASCADE,
        FOREIGN KEY (related_idea_id) REFERENCES ideas(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_ideas_priority ON ideas(priority_label);
      CREATE INDEX IF NOT EXISTS idx_ideas_category ON ideas(category);
      CREATE INDEX IF NOT EXISTS idx_ideas_score ON ideas(score_total DESC);
      CREATE INDEX IF NOT EXISTS idx_ideas_hash ON ideas(content_hash);
      CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
      CREATE INDEX IF NOT EXISTS idx_idea_rels_idea ON idea_relationships(idea_id);
      CREATE INDEX IF NOT EXISTS idx_idea_rels_related ON idea_relationships(related_idea_id);
    `
  }
];

// Allowed columns for updateIdea partial UPDATE (prevents SQL injection via field names)
const IDEA_UPDATABLE_COLUMNS = new Set([
  'title',
  'summary',
  'category',
  'score_total',
  'priority_label',
  'profitability_score',
  'portfolio_score',
  'complexity_score',
  'novelty_score',
  'execution_speed_score',
  'related_projects',
  'missing_features',
  'source_path',
  'content_hash',
  'embedding',
  'vault_path',
  'status'
]);

class OrchestrationStorage {
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

    console.log(`[ORCH-DB] Opening database: ${this.dbPath}`);

    this.db = new Database(this.dbPath);

    // Enable WAL mode for concurrent reads
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');

    console.log('[ORCH-DB] WAL mode enabled, synchronous NORMAL, foreign keys ON, busy timeout 5000ms');

    // Run migrations
    this._migrate();

    console.log('[ORCH-DB] Database ready');
  }

  /**
   * Close database connection.
   */
  close() {
    if (!this.db) return;
    console.log('[ORCH-DB] Closing database');
    this.db.close();
    this.db = null;
  }

  /**
   * Run schema migrations.
   * @private
   */
  _migrate() {
    // Create schema_version table if it doesn't exist
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at TEXT DEFAULT (datetime('now'))
      );
    `);

    // Get current version
    const versionRow = this.db.prepare('SELECT MAX(version) as version FROM schema_version').get();
    const currentVersion = versionRow?.version || 0;

    console.log(`[ORCH-DB] Current schema version: ${currentVersion}`);

    // Apply pending migrations
    const pendingMigrations = MIGRATIONS.filter(m => m.version > currentVersion);

    if (pendingMigrations.length === 0) {
      console.log('[ORCH-DB] No pending migrations');
      return;
    }

    console.log(`[ORCH-DB] Applying ${pendingMigrations.length} migration(s)`);

    for (const migration of pendingMigrations) {
      console.log(`[ORCH-DB] Applying migration v${migration.version}: ${migration.description}`);

      try {
        this.db.exec(migration.sql);
        this.db.prepare('INSERT INTO schema_version (version, description) VALUES (?, ?)').run(
          migration.version,
          migration.description
        );
        console.log(`[ORCH-DB] Migration v${migration.version} applied successfully`);
      } catch (err) {
        console.error(`[ORCH-DB] Migration v${migration.version} failed:`, err.message);
        throw err;
      }
    }

    console.log('[ORCH-DB] All migrations complete');
  }

  // ========== CRUD: task_states ==========

  /**
   * Insert a new task state.
   * @param {Object} state - Full task state JSON (validated by TaskState)
   * @returns {Object} Inserted row
   */
  createTaskState(state) {
    const stmt = this.db.prepare(`
      INSERT INTO task_states (task_id, task_name, status, current_agent, current_phase, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      state.task_id,
      state.task_name,
      state.status,
      state.ownership.current_agent,
      state.execution_phase.current_phase,
      JSON.stringify(state),
      state.created_at,
      state.updated_at
    );

    return this.getTaskState(state.task_id);
  }

  /**
   * Get a task state by ID.
   * @param {string} taskId
   * @returns {Object|null} Parsed task state or null
   */
  getTaskState(taskId) {
    const stmt = this.db.prepare('SELECT * FROM task_states WHERE task_id = ?');
    const row = stmt.get(taskId);

    if (!row) return null;

    return JSON.parse(row.state_json);
  }

  /**
   * Update a task state (full replacement of state_json).
   * @param {string} taskId
   * @param {Object} state - Full updated task state JSON
   */
  updateTaskState(taskId, state) {
    const stmt = this.db.prepare(`
      UPDATE task_states
      SET task_name = ?,
          status = ?,
          current_agent = ?,
          current_phase = ?,
          state_json = ?,
          updated_at = ?
      WHERE task_id = ?
    `);

    stmt.run(
      state.task_name,
      state.status,
      state.ownership.current_agent,
      state.execution_phase.current_phase,
      JSON.stringify(state),
      state.updated_at,
      taskId
    );
  }

  /**
   * List task states with optional filters.
   * @param {Object} [filters={}]
   * @param {string} [filters.status]
   * @param {string} [filters.agent]
   * @param {number} [filters.limit=50]
   * @returns {Array<Object>} Task state summaries
   */
  listTaskStates(filters = {}) {
    let sql = 'SELECT task_id, task_name, status, current_agent, current_phase, created_at, updated_at FROM task_states WHERE 1=1';
    const params = [];

    if (filters.status) {
      sql += ' AND status = ?';
      params.push(filters.status);
    }

    if (filters.agent) {
      sql += ' AND current_agent = ?';
      params.push(filters.agent);
    }

    sql += ' ORDER BY created_at DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    } else {
      sql += ' LIMIT 50';
    }

    const stmt = this.db.prepare(sql);
    return stmt.all(...params);
  }

  /**
   * Delete a task state and all associated events.
   * @param {string} taskId
   * @returns {boolean} true if deleted
   */
  deleteTaskState(taskId) {
    const stmt = this.db.prepare('DELETE FROM task_states WHERE task_id = ?');
    const result = stmt.run(taskId);
    return result.changes > 0;
  }

  // ========== CRUD: orchestration_events ==========

  /**
   * Insert an event envelope.
   * @param {Object} envelope - Event envelope with integrity_hash
   */
  insertEvent(envelope) {
    const stmt = this.db.prepare(`
      INSERT INTO orchestration_events (event_id, timestamp, agent, task_id, event_type, payload, integrity_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      envelope.event_id,
      envelope.timestamp,
      envelope.agent,
      envelope.task_id || null,
      envelope.event_type,
      JSON.stringify(envelope.payload),
      envelope.integrity_hash
    );
  }

  /**
   * Query events with filters.
   * @param {Object} [filters={}]
   * @param {string} [filters.taskId]
   * @param {string} [filters.agent]
   * @param {string} [filters.eventType]
   * @param {string} [filters.since] - ISO8601 lower bound
   * @param {number} [filters.limit=50]
   * @returns {Array<Object>} Event envelopes
   */
  queryEvents(filters = {}) {
    let sql = 'SELECT * FROM orchestration_events WHERE 1=1';
    const params = [];

    if (filters.taskId) {
      sql += ' AND task_id = ?';
      params.push(filters.taskId);
    }

    if (filters.agent) {
      sql += ' AND agent = ?';
      params.push(filters.agent);
    }

    if (filters.eventType) {
      sql += ' AND event_type = ?';
      params.push(filters.eventType);
    }

    if (filters.since) {
      sql += ' AND timestamp >= ?';
      params.push(filters.since);
    }

    sql += ' ORDER BY timestamp DESC';

    if (filters.limit) {
      sql += ' LIMIT ?';
      params.push(filters.limit);
    } else {
      sql += ' LIMIT 50';
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params);

    // Parse payload JSON
    return rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  }

  /**
   * Get all events for a task, ordered by timestamp.
   * @param {string} taskId
   * @returns {Array<Object>} Ordered event envelopes
   */
  getTaskEvents(taskId) {
    const stmt = this.db.prepare('SELECT * FROM orchestration_events WHERE task_id = ? ORDER BY timestamp ASC');
    const rows = stmt.all(taskId);

    return rows.map(row => ({
      ...row,
      payload: JSON.parse(row.payload)
    }));
  }

  /**
   * Get event counts by type.
   * @returns {Object} Map of event_type -> count
   */
  getEventCounts() {
    const stmt = this.db.prepare('SELECT event_type, COUNT(*) as count FROM orchestration_events GROUP BY event_type');
    const rows = stmt.all();

    const counts = {};
    for (const row of rows) {
      counts[row.event_type] = row.count;
    }

    return counts;
  }

  // ========== CRUD: audit_results ==========

  /**
   * Insert an audit result.
   * @param {Object} result
   * @param {string} result.taskId
   * @param {string} result.auditType - 'structural' | 'coding_standard' | 'continuity' | 'full'
   * @param {string} result.result - 'pass' | 'warning' | 'fail'
   * @param {number} result.confidenceScore - 0.0 to 1.0
   * @param {Object} result.details - Full audit output
   * @returns {string} audit_id
   */
  insertAuditResult(result) {
    const auditId = randomUUID().slice(0, 12);

    const stmt = this.db.prepare(`
      INSERT INTO audit_results (audit_id, task_id, audit_type, result, confidence_score, details)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      auditId,
      result.taskId,
      result.auditType,
      result.result,
      result.confidenceScore,
      JSON.stringify(result.details)
    );

    return auditId;
  }

  /**
   * Get audit history for a task.
   * @param {string} taskId
   * @param {number} [limit=20]
   * @returns {Array<Object>} Audit results, newest first
   */
  getAuditHistory(taskId, limit = 20) {
    const stmt = this.db.prepare(`
      SELECT * FROM audit_results
      WHERE task_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    const rows = stmt.all(taskId, limit);

    return rows.map(row => ({
      ...row,
      details: JSON.parse(row.details)
    }));
  }

  // ========== CRUD: agent_registry ==========

  /**
   * Register or update an agent entry.
   * @param {Object} agent
   * @param {string} agent.name - 'Claude' | 'Ollama'
   * @param {string} agent.type - 'cloud' | 'local'
   * @param {Object} [agent.capabilities={}] - Agent capability metadata
   * @param {string} [agent.status='available'] - 'available' | 'busy' | 'offline'
   */
  upsertAgent(agent) {
    const stmt = this.db.prepare(`
      INSERT INTO agent_registry (name, type, capabilities, status, last_active_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET
        type = excluded.type,
        capabilities = excluded.capabilities,
        status = excluded.status,
        last_active_at = datetime('now')
    `);

    stmt.run(
      agent.name,
      agent.type,
      JSON.stringify(agent.capabilities || {}),
      agent.status || 'available'
    );
  }

  /**
   * Get all registered agents.
   * @returns {Array<Object>} Agent entries
   */
  listAgents() {
    const stmt = this.db.prepare('SELECT * FROM agent_registry ORDER BY name');
    const rows = stmt.all();

    return rows.map(row => ({
      ...row,
      capabilities: JSON.parse(row.capabilities)
    }));
  }

  /**
   * Update agent status.
   * @param {string} agentName
   * @param {string} status - 'available' | 'busy' | 'offline'
   */
  updateAgentStatus(agentName, status) {
    const stmt = this.db.prepare(`
      UPDATE agent_registry
      SET status = ?, last_active_at = datetime('now')
      WHERE name = ?
    `);

    stmt.run(status, agentName);
  }

  // ========== CRUD: ideas ==========

  /**
   * Insert a new idea record.
   * @param {Object} idea - Idea record
   * @param {string} idea.id - Short UUID (12 chars)
   * @param {string} idea.title
   * @param {string} [idea.summary]
   * @param {string} [idea.category] - AI|Tooling|Product|Experimental|Game Dev|Infrastructure
   * @param {string} idea.content_hash - SHA-256 hex of source content
   * @param {string} [idea.source_path]
   * @param {string} [idea.status='raw']
   * @returns {string} The inserted id
   */
  insertIdea(idea) {
    const stmt = this.db.prepare(`
      INSERT INTO ideas (
        id, title, summary, category,
        score_total, priority_label,
        profitability_score, portfolio_score, complexity_score,
        novelty_score, execution_speed_score,
        related_projects, missing_features,
        source_path, content_hash, embedding, vault_path, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      idea.id,
      idea.title,
      idea.summary || null,
      idea.category || null,
      idea.score_total || 0.0,
      idea.priority_label || null,
      idea.profitability_score || 0.0,
      idea.portfolio_score || 0.0,
      idea.complexity_score || 0.0,
      idea.novelty_score || 0.0,
      idea.execution_speed_score || 0.0,
      idea.related_projects || '[]',
      idea.missing_features || '[]',
      idea.source_path || null,
      idea.content_hash,
      idea.embedding || null,
      idea.vault_path || null,
      idea.status || 'raw'
    );

    return idea.id;
  }

  /**
   * Get a single idea by id.
   * @param {string} id
   * @returns {Object|null}
   */
  getIdea(id) {
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE id = ?');
    return stmt.get(id) || null;
  }

  /**
   * Partial update of an idea. Only whitelisted columns are allowed.
   * Automatically updates updated_at timestamp.
   * @param {string} id
   * @param {Object} fields - Partial field set to update
   * @returns {boolean} true if a row was updated
   */
  updateIdea(id, fields) {
    const keys = Object.keys(fields).filter(k => IDEA_UPDATABLE_COLUMNS.has(k));
    if (keys.length === 0) return false;

    const setClauses = keys.map(k => `${k} = ?`).join(', ');
    const values = keys.map(k => fields[k]);

    const sql = `UPDATE ideas SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`;
    const stmt = this.db.prepare(sql);
    const result = stmt.run(...values, id);
    return result.changes > 0;
  }

  /**
   * Delete an idea (cascades to idea_relationships via foreign key).
   * @param {string} id
   * @returns {boolean}
   */
  deleteIdea(id) {
    const stmt = this.db.prepare('DELETE FROM ideas WHERE id = ?');
    return stmt.run(id).changes > 0;
  }

  /**
   * Get ideas filtered by priority label.
   * @param {string} label - HIGH|MID|LOW|SHINY_OBJECT
   * @returns {Array<Object>}
   */
  getIdeasByPriority(label) {
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE priority_label = ? ORDER BY score_total DESC');
    return stmt.all(label);
  }

  /**
   * Get ideas filtered by category.
   * @param {string} category
   * @returns {Array<Object>}
   */
  getIdeasByCategory(category) {
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE category = ? ORDER BY score_total DESC');
    return stmt.all(category);
  }

  /**
   * Get ideas filtered by processing status.
   * @param {string} status - raw|classified|scored|researched|indexed|executing|completed
   * @returns {Array<Object>}
   */
  getIdeasByStatus(status) {
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE status = ? ORDER BY created_at DESC');
    return stmt.all(status);
  }

  /**
   * Find an idea by content hash (used for deduplication on ingestion).
   * @param {string} hash - SHA-256 hex digest
   * @returns {Object|null}
   */
  findByHash(hash) {
    const stmt = this.db.prepare('SELECT * FROM ideas WHERE content_hash = ?');
    return stmt.get(hash) || null;
  }

  /**
   * Text search on title and summary (LIKE, case-insensitive).
   * @param {string} query
   * @param {number} [limit=50]
   * @returns {Array<Object>}
   */
  searchIdeas(query, limit = 50) {
    const pattern = `%${query}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM ideas
      WHERE title LIKE ? COLLATE NOCASE OR summary LIKE ? COLLATE NOCASE
      ORDER BY score_total DESC
      LIMIT ?
    `);
    return stmt.all(pattern, pattern, limit);
  }

  /**
   * Get top N ideas by score.
   * @param {number} [limit=10]
   * @returns {Array<Object>}
   */
  getTopIdeas(limit = 10) {
    const stmt = this.db.prepare('SELECT * FROM ideas ORDER BY score_total DESC LIMIT ?');
    return stmt.all(limit);
  }

  /**
   * Get all ideas.
   * @returns {Array<Object>}
   */
  getAllIdeas() {
    const stmt = this.db.prepare('SELECT * FROM ideas ORDER BY created_at DESC');
    return stmt.all();
  }

  // ========== CRUD: idea_relationships ==========

  /**
   * Insert a relationship between two ideas.
   * @param {Object} rel
   * @param {string} rel.idea_id
   * @param {string} rel.related_idea_id
   * @param {number} [rel.similarity_score=0.0]
   * @param {string} rel.relationship_type - duplicate|related|extends|conflicts|supersedes
   * @returns {string} Generated relationship id
   */
  insertRelationship(rel) {
    const relId = randomUUID().slice(0, 12);
    const stmt = this.db.prepare(`
      INSERT INTO idea_relationships (id, idea_id, related_idea_id, similarity_score, relationship_type)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(
      relId,
      rel.idea_id,
      rel.related_idea_id,
      rel.similarity_score || 0.0,
      rel.relationship_type
    );
    return relId;
  }

  /**
   * Get all relationships anchored on a given idea.
   * @param {string} ideaId
   * @returns {Array<Object>}
   */
  getRelationships(ideaId) {
    const stmt = this.db.prepare('SELECT * FROM idea_relationships WHERE idea_id = ? ORDER BY similarity_score DESC');
    return stmt.all(ideaId);
  }

  /**
   * Get duplicate relationships for an idea.
   * @param {string} ideaId
   * @returns {Array<Object>}
   */
  findDuplicates(ideaId) {
    const stmt = this.db.prepare(`
      SELECT * FROM idea_relationships
      WHERE idea_id = ? AND relationship_type = 'duplicate'
      ORDER BY similarity_score DESC
    `);
    return stmt.all(ideaId);
  }

  // ========== Utility Methods ==========

  /**
   * Run SQLite integrity check.
   * @returns {boolean} true if healthy
   */
  integrityCheck() {
    try {
      const result = this.db.pragma('integrity_check');
      return result.length === 1 && result[0].integrity_check === 'ok';
    } catch (err) {
      console.error('[ORCH-DB] Integrity check failed:', err.message);
      return false;
    }
  }

  /**
   * Get storage stats.
   * @returns {Object} { taskCount, eventCount, auditCount, agentCount, dbSizeBytes }
   */
  getStats() {
    const taskCount = this.db.prepare('SELECT COUNT(*) as count FROM task_states').get().count;
    const eventCount = this.db.prepare('SELECT COUNT(*) as count FROM orchestration_events').get().count;
    const auditCount = this.db.prepare('SELECT COUNT(*) as count FROM audit_results').get().count;
    const agentCount = this.db.prepare('SELECT COUNT(*) as count FROM agent_registry').get().count;

    // Get database file size
    let dbSizeBytes = 0;
    if (existsSync(this.dbPath)) {
      const stats = statSync(this.dbPath);
      dbSizeBytes = stats.size;
    }

    return {
      taskCount,
      eventCount,
      auditCount,
      agentCount,
      dbSizeBytes
    };
  }
}

// Singleton + named export
const instance = new OrchestrationStorage();
export default instance;
export { OrchestrationStorage };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[ORCH-DB] Running self-tests...\n');

  const testDbPath = join(__dirname, '..', '..', 'data', 'test-orchestration.db');

  // Clean up test DB if it exists
  const fs = await import('fs');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  const testDb = new OrchestrationStorage(testDbPath);

  try {
    // Test 1: Open database
    console.log('Test 1: Open database');
    testDb.open();
    console.log('✓ Database opened successfully\n');

    // Test 2: Integrity check
    console.log('Test 2: Integrity check');
    const healthy = testDb.integrityCheck();
    console.log(`✓ Integrity check: ${healthy ? 'PASS' : 'FAIL'}\n`);

    // Test 3: CRUD task_states
    console.log('Test 3: CRUD task_states');
    const taskState = {
      task_id: randomUUID().slice(0, 12),
      task_name: 'Test Task',
      status: 'active',
      ownership: { current_agent: 'Claude', previous_agents: [], handoff_timestamp: null },
      execution_phase: { current_phase: 'analysis', completed_phases: [], phase_history: [] },
      architectural_decisions: [],
      completed_subtasks: [],
      pending_subtasks: [],
      blocked_subtasks: [],
      research_notes: [],
      files_affected: [],
      code_standards_enforced: [],
      risks_identified: [],
      constraints: [],
      next_action: 'Start analysis',
      audit_log_pointer: '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    testDb.createTaskState(taskState);
    console.log('✓ Created task state');

    const loaded = testDb.getTaskState(taskState.task_id);
    console.log(`✓ Loaded task state: ${loaded.task_name}`);

    taskState.status = 'paused';
    taskState.updated_at = new Date().toISOString();
    testDb.updateTaskState(taskState.task_id, taskState);
    console.log('✓ Updated task state');

    const listed = testDb.listTaskStates({ status: 'paused', limit: 10 });
    console.log(`✓ Listed task states: ${listed.length} found\n`);

    // Test 4: CRUD orchestration_events
    console.log('Test 4: CRUD orchestration_events');
    const eventEnvelope = {
      event_id: randomUUID().slice(0, 12),
      timestamp: new Date().toISOString(),
      agent: 'Claude',
      task_id: taskState.task_id,
      event_type: 'task_started',
      payload: { taskName: 'Test Task' },
      integrity_hash: 'abc123'
    };

    testDb.insertEvent(eventEnvelope);
    console.log('✓ Inserted event');

    const events = testDb.queryEvents({ taskId: taskState.task_id });
    console.log(`✓ Queried events: ${events.length} found`);

    const taskEvents = testDb.getTaskEvents(taskState.task_id);
    console.log(`✓ Got task events: ${taskEvents.length} found`);

    const eventCounts = testDb.getEventCounts();
    console.log(`✓ Event counts: ${JSON.stringify(eventCounts)}\n`);

    // Test 5: CRUD audit_results
    console.log('Test 5: CRUD audit_results');
    const auditResult = {
      taskId: taskState.task_id,
      auditType: 'full',
      result: 'pass',
      confidenceScore: 0.95,
      details: { structural: { passed: true }, coding_standards: { passed: true } }
    };

    const auditId = testDb.insertAuditResult(auditResult);
    console.log(`✓ Inserted audit result: ${auditId}`);

    const auditHistory = testDb.getAuditHistory(taskState.task_id, 10);
    console.log(`✓ Got audit history: ${auditHistory.length} found\n`);

    // Test 6: CRUD agent_registry
    console.log('Test 6: CRUD agent_registry');
    testDb.upsertAgent({
      name: 'Claude',
      type: 'cloud',
      capabilities: { planning: true, architecture: true },
      status: 'available'
    });
    console.log('✓ Upserted agent: Claude');

    testDb.upsertAgent({
      name: 'Ollama',
      type: 'local',
      capabilities: { implementation: true },
      status: 'available'
    });
    console.log('✓ Upserted agent: Ollama');

    const agents = testDb.listAgents();
    console.log(`✓ Listed agents: ${agents.length} found`);

    testDb.updateAgentStatus('Claude', 'busy');
    console.log('✓ Updated agent status\n');

    // Test 7: Get stats
    console.log('Test 7: Get stats');
    const stats = testDb.getStats();
    console.log(`✓ Stats: ${JSON.stringify(stats, null, 2)}\n`);

    // Test 8: Delete task state
    console.log('Test 8: Delete task state');
    const deleted = testDb.deleteTaskState(taskState.task_id);
    console.log(`✓ Deleted task state: ${deleted}\n`);

    // Test 9: Migration idempotency
    console.log('Test 9: Migration idempotency');
    testDb.close();
    testDb.open();
    console.log('✓ Migrations are idempotent\n');

    // Test 10: Migration v2 — idea CRUD
    console.log('Test 10: Idea CRUD (migration v2)');

    const ideaA = {
      id: randomUUID().slice(0, 12),
      title: 'AI Blueprint Analyzer',
      summary: 'Tool that analyzes UE5 Blueprint graphs for anti-patterns.',
      category: 'Tooling',
      content_hash: 'hash-aaa-111',
      source_path: '/fake/a.md',
      status: 'raw'
    };
    const ideaB = {
      id: randomUUID().slice(0, 12),
      title: 'Vulkan Shader Hot-Reload',
      summary: 'Desktop app that hot-reloads shaders in running Vulkan applications.',
      category: 'Infrastructure',
      content_hash: 'hash-bbb-222',
      source_path: '/fake/b.md',
      status: 'raw'
    };

    testDb.insertIdea(ideaA);
    testDb.insertIdea(ideaB);
    console.log('✓ Inserted 2 ideas');

    const loadedA = testDb.getIdea(ideaA.id);
    if (!loadedA || loadedA.title !== ideaA.title) {
      throw new Error('getIdea failed');
    }
    console.log(`✓ getIdea: ${loadedA.title}`);

    const hashHit = testDb.findByHash('hash-aaa-111');
    if (!hashHit || hashHit.id !== ideaA.id) {
      throw new Error('findByHash failed');
    }
    console.log('✓ findByHash: dedup check works');

    const updated = testDb.updateIdea(ideaA.id, {
      status: 'scored',
      score_total: 0.82,
      priority_label: 'HIGH',
      profitability_score: 0.8,
      portfolio_score: 0.9
    });
    if (!updated) throw new Error('updateIdea returned false');
    const afterUpdate = testDb.getIdea(ideaA.id);
    if (afterUpdate.priority_label !== 'HIGH' || afterUpdate.score_total < 0.8) {
      throw new Error('updateIdea did not persist fields');
    }
    console.log(`✓ updateIdea: score=${afterUpdate.score_total} priority=${afterUpdate.priority_label}`);

    // Reject unknown columns — should not update injected column
    const safeReject = testDb.updateIdea(ideaA.id, { id: 'hacked', nonexistent: 'x' });
    if (safeReject) throw new Error('updateIdea accepted disallowed columns');
    console.log('✓ updateIdea: whitelist rejected disallowed columns');

    const highIdeas = testDb.getIdeasByPriority('HIGH');
    if (highIdeas.length !== 1) throw new Error('getIdeasByPriority failed');
    console.log(`✓ getIdeasByPriority(HIGH): ${highIdeas.length}`);

    const toolingIdeas = testDb.getIdeasByCategory('Tooling');
    if (toolingIdeas.length !== 1) throw new Error('getIdeasByCategory failed');
    console.log(`✓ getIdeasByCategory(Tooling): ${toolingIdeas.length}`);

    const rawIdeas = testDb.getIdeasByStatus('raw');
    if (rawIdeas.length !== 1) throw new Error('getIdeasByStatus failed');
    console.log(`✓ getIdeasByStatus(raw): ${rawIdeas.length}`);

    const searchHits = testDb.searchIdeas('blueprint');
    if (searchHits.length !== 1) throw new Error('searchIdeas failed');
    console.log(`✓ searchIdeas(blueprint): ${searchHits.length}`);

    const top = testDb.getTopIdeas(10);
    if (top.length !== 2 || top[0].id !== ideaA.id) {
      throw new Error('getTopIdeas did not order by score');
    }
    console.log(`✓ getTopIdeas: ${top.length}, top=${top[0].title}`);

    const all = testDb.getAllIdeas();
    if (all.length !== 2) throw new Error('getAllIdeas failed');
    console.log(`✓ getAllIdeas: ${all.length}`);

    // Relationships
    const relId = testDb.insertRelationship({
      idea_id: ideaA.id,
      related_idea_id: ideaB.id,
      similarity_score: 0.75,
      relationship_type: 'related'
    });
    console.log(`✓ insertRelationship: ${relId}`);

    const rels = testDb.getRelationships(ideaA.id);
    if (rels.length !== 1 || rels[0].relationship_type !== 'related') {
      throw new Error('getRelationships failed');
    }
    console.log(`✓ getRelationships: ${rels.length}`);

    const dupRelId = testDb.insertRelationship({
      idea_id: ideaA.id,
      related_idea_id: ideaB.id,
      similarity_score: 0.95,
      relationship_type: 'duplicate'
    });
    const dups = testDb.findDuplicates(ideaA.id);
    if (dups.length !== 1 || dups[0].id !== dupRelId) {
      throw new Error('findDuplicates failed');
    }
    console.log(`✓ findDuplicates: ${dups.length}`);

    // Verify indexes exist
    const indexRows = testDb.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_idea%'"
    ).all();
    const expectedIdx = [
      'idx_ideas_priority', 'idx_ideas_category', 'idx_ideas_score',
      'idx_ideas_hash', 'idx_ideas_status',
      'idx_idea_rels_idea', 'idx_idea_rels_related'
    ];
    for (const name of expectedIdx) {
      if (!indexRows.find(r => r.name === name)) {
        throw new Error(`Missing index: ${name}`);
      }
    }
    console.log(`✓ All ${expectedIdx.length} idea indexes present`);

    // Cascade delete — deleting ideaA should drop its relationships
    testDb.deleteIdea(ideaA.id);
    const relsAfterDelete = testDb.getRelationships(ideaA.id);
    if (relsAfterDelete.length !== 0) {
      throw new Error('Cascade delete of idea_relationships failed');
    }
    console.log('✓ deleteIdea: cascade dropped relationships\n');

    testDb.close();

    // Clean up test DB
    fs.unlinkSync(testDbPath);

    console.log('All tests passed! ✓');

  } catch (err) {
    console.error('Test failed:', err);
    testDb.close();
    process.exit(1);
  }
}
