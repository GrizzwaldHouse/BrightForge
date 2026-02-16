/**
 * ForgeSession - Generation Lifecycle Manager
 *
 * Manages a single 3D generation request through its lifecycle:
 *   idle -> generating_image -> generating_mesh -> complete | failed
 *
 * Emits progress events via TelemetryBus for dashboard tracking.
 *
 * STATUS: Complete. Session creation and state tracking tested.
 *         In-memory store with 20-session limit and 1-hour TTL.
 *
 * TODO(P1): Add progress percentage estimation from historical generation times
 * TODO(P1): Add session persistence to SQLite (survives server restart)
 * TODO(P1): Add generation parameter presets (quality vs speed tradeoffs)
 * TODO(P2): Add batch session support (multiple generations in one session)
 * TODO(P2): Add generation comparison (A/B testing different prompts)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { fileURLToPath } from 'url';
import telemetryBus from '../core/telemetry-bus.js';
import modelBridge from './model-bridge.js';
import forge3dDb from './database.js';

const SESSION_STATES = {
  IDLE: 'idle',
  GENERATING_IMAGE: 'generating_image',
  GENERATING_MESH: 'generating_mesh',
  COMPLETE: 'complete',
  FAILED: 'failed'
};

class ForgeSession extends EventEmitter {
  constructor() {
    super();
    // TODO(phase8-high): Session persistence — hybrid in-memory + DB.
    // Active sessions (idle/generating) stay in Map for fast access.
    // Completed/failed sessions are persisted to the 'sessions' table (migration v2).
    // On init(), recent completed sessions are loaded from DB into Map.
    // On getStatus(), if not in Map, check DB (for sessions from previous server runs).
    this.sessions = new Map();
    this._dbReady = false;
  }

  /**
   * Initialize with database persistence.
   * Loads recent completed sessions from DB into memory.
   */
  init() {
    if (this._dbReady) return;
    try {
      // Load recent completed sessions from DB
      const rows = forge3dDb.listSessions({ limit: 50 });
      for (const row of rows) {
        if (!this.sessions.has(row.id)) {
          this.sessions.set(row.id, {
            id: row.id,
            type: row.type,
            prompt: row.prompt,
            imageBuffer: null,
            filename: null,
            options: {},
            state: row.state,
            createdAt: new Date(row.created_at).getTime(),
            startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
            completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
            result: row.result_path ? { _persisted: true, resultPath: row.result_path, resultType: row.result_type } : null,
            error: row.error,
            progress: row.state === 'complete' ? { stage: 'complete', percent: 100 } : { stage: null, percent: 0 }
          });
        }
      }
      this._dbReady = true;
      console.log(`[FORGE] Loaded ${rows.length} sessions from database`);
    } catch (err) {
      console.warn(`[FORGE] Session DB init failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Create a new generation session.
   * @param {Object} params - Generation parameters
   * @param {string} params.type - 'mesh' | 'image' | 'full'
   * @param {string} [params.prompt] - Text prompt (for image/full)
   * @param {Buffer} [params.imageBuffer] - Image data (for mesh)
   * @param {string} [params.filename] - Image filename (for mesh)
   * @param {Object} [params.options] - Additional options (width, height, steps)
   * @returns {string} Session ID
   */
  create(params) {
    const id = randomUUID().slice(0, 12);

    const session = {
      id,
      type: params.type,
      prompt: params.prompt || null,
      imageBuffer: params.imageBuffer || null,
      filename: params.filename || null,
      options: params.options || {},
      state: SESSION_STATES.IDLE,
      createdAt: Date.now(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
      progress: { stage: null, percent: 0 }
    };

    this.sessions.set(id, session);

    // Persist to DB if available
    if (this._dbReady) {
      try {
        forge3dDb.createSession({
          id,
          type: params.type,
          state: SESSION_STATES.IDLE,
          prompt: params.prompt || null
        });
      } catch (err) {
        console.warn(`[FORGE] Session DB write failed (non-fatal): ${err.message}`);
      }
    }

    console.log(`[FORGE] Session created: ${id} (type=${params.type})`);
    return id;
  }

  /**
   * Start generation for a session.
   * @param {string} sessionId - Session ID
   * @returns {Promise<Object>} Generation result
   */
  async run(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    if (session.state !== SESSION_STATES.IDLE) {
      throw new Error(`Session ${sessionId} is not idle (state: ${session.state})`);
    }

    session.startedAt = Date.now();

    telemetryBus.emit('forge3d_generation_start', {
      sessionId,
      type: session.type,
      prompt: session.prompt ? session.prompt.slice(0, 80) : null
    });

    try {
      let result;

      switch (session.type) {
      case 'mesh':
        result = await this._runMesh(session);
        break;
      case 'image':
        result = await this._runImage(session);
        break;
      case 'full':
        result = await this._runFull(session);
        break;
      default:
        throw new Error(`Unknown generation type: ${session.type}`);
      }

      session.state = SESSION_STATES.COMPLETE;
      session.completedAt = Date.now();
      session.result = result;
      session.progress = { stage: 'complete', percent: 100 };

      const duration = session.completedAt - session.startedAt;
      console.log(`[FORGE] Session ${sessionId} complete in ${duration}ms`);

      // TODO(phase8-high): Emit Python performance metrics to TelemetryBus.
      // Parse generation time from result and emit for dashboard trends.
      if (result.generationTime) {
        telemetryBus.emit('forge3d_perf', {
          sessionId,
          type: session.type,
          generationTime: result.generationTime,
          fileSize: result.fileSize || 0
        });
      }

      // Persist completion to DB
      this._persistState(sessionId, SESSION_STATES.COMPLETE);

      telemetryBus.emit('forge3d_generation_complete', {
        sessionId,
        type: session.type,
        duration,
        result
      });

      this.emit('complete', { sessionId, result });
      return result;

    } catch (err) {
      session.state = SESSION_STATES.FAILED;
      session.completedAt = Date.now();
      session.error = err.message;

      const duration = session.completedAt - session.startedAt;
      console.error(`[FORGE] Session ${sessionId} failed after ${duration}ms: ${err.message}`);

      // Persist failure to DB
      this._persistState(sessionId, SESSION_STATES.FAILED, err.message);

      telemetryBus.emit('forge3d_generation_failed', {
        sessionId,
        type: session.type,
        duration,
        error: err.message
      });

      this.emit('failed', { sessionId, error: err.message });
      throw err;
    }
  }

  /**
   * Image -> Mesh generation.
   */
  async _runMesh(session) {
    session.state = SESSION_STATES.GENERATING_MESH;
    session.progress = { stage: 'mesh', percent: 10 };
    this.emit('progress', { sessionId: session.id, progress: session.progress });

    const result = await modelBridge.generateMesh(
      session.imageBuffer,
      session.filename || 'input.png',
      session.id
    );

    session.progress = { stage: 'mesh', percent: 100 };
    return {
      type: 'mesh',
      meshBuffer: result.buffer,
      generationTime: parseFloat(result.headers.generationTime) || 0,
      fileSize: parseInt(result.headers.fileSize) || result.buffer.length
    };
  }

  /**
   * Text -> Image generation.
   */
  async _runImage(session) {
    session.state = SESSION_STATES.GENERATING_IMAGE;
    session.progress = { stage: 'image', percent: 10 };
    this.emit('progress', { sessionId: session.id, progress: session.progress });

    const result = await modelBridge.generateImage(session.prompt, {
      ...session.options,
      jobId: session.id
    });

    session.progress = { stage: 'image', percent: 100 };
    return {
      type: 'image',
      imageBuffer: result.buffer,
      generationTime: parseFloat(result.headers.generationTime) || 0,
      fileSize: parseInt(result.headers.fileSize) || result.buffer.length
    };
  }

  /**
   * Text -> Image -> Mesh (full pipeline).
   */
  async _runFull(session) {
    // Stage 1: Image generation
    session.state = SESSION_STATES.GENERATING_IMAGE;
    session.progress = { stage: 'image', percent: 10 };
    this.emit('progress', { sessionId: session.id, progress: session.progress });

    const fullResult = await modelBridge.generateFull(session.prompt, {
      ...session.options,
      jobId: session.id
    });

    // Stage 2 happened server-side; update progress
    session.state = SESSION_STATES.GENERATING_MESH;
    session.progress = { stage: 'mesh', percent: 80 };
    this.emit('progress', { sessionId: session.id, progress: session.progress });

    // Download the generated files
    const [imageBuffer, meshBuffer] = await Promise.all([
      modelBridge.downloadFile(session.id, 'generated_image.png'),
      modelBridge.downloadFile(session.id, 'generated_mesh.glb')
    ]);

    session.progress = { stage: 'complete', percent: 100 };

    return {
      type: 'full',
      imageBuffer,
      meshBuffer,
      totalTime: fullResult.total_time,
      stages: fullResult.stages,
      vramAfter: fullResult.vram_after
    };
  }

  /**
   * Get session status.
   * @param {string} sessionId
   * @returns {Object|null} Session state info
   */
  getStatus(sessionId) {
    let session = this.sessions.get(sessionId);

    // Fallback: check DB for sessions from previous server runs
    if (!session && this._dbReady) {
      try {
        const row = forge3dDb.getSession(sessionId);
        if (row) {
          return {
            id: row.id,
            type: row.type,
            state: row.state,
            progress: row.state === 'complete' ? { stage: 'complete', percent: 100 } : { stage: null, percent: 0 },
            createdAt: new Date(row.created_at).getTime(),
            startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
            completedAt: row.completed_at ? new Date(row.completed_at).getTime() : null,
            error: row.error,
            hasResult: !!row.result_path
          };
        }
      } catch (_e) { /* non-fatal */ }
    }

    if (!session) return null;

    return {
      id: session.id,
      type: session.type,
      state: session.state,
      progress: session.progress,
      createdAt: session.createdAt,
      startedAt: session.startedAt,
      completedAt: session.completedAt,
      error: session.error,
      hasResult: session.result !== null
    };
  }

  /**
   * List all sessions.
   * @param {number} [limit=20] - Maximum sessions to return
   * @returns {Array} Session summaries, newest first
   */
  list(limit = 20) {
    const sessions = Array.from(this.sessions.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return sessions.map((s) => ({
      id: s.id,
      type: s.type,
      state: s.state,
      createdAt: s.createdAt,
      completedAt: s.completedAt,
      error: s.error
    }));
  }

  /**
   * Get the result data for a completed session.
   * @param {string} sessionId
   * @returns {Object|null} Result data
   */
  getResult(sessionId) {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== SESSION_STATES.COMPLETE) return null;
    return session.result;
  }

  /**
   * Persist session state to database.
   * @param {string} sessionId
   * @param {string} state
   * @param {string} [error]
   */
  _persistState(sessionId, state, error = null) {
    if (!this._dbReady) return;
    try {
      forge3dDb.updateSession(sessionId, { state, error });
    } catch (err) {
      console.warn(`[FORGE] Session persist failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Clean up old sessions from memory.
   * @param {number} [maxAge=3600000] - Max age in ms (default 1 hour)
   */
  cleanup(maxAge = 3600000) {
    const cutoff = Date.now() - maxAge;
    let count = 0;

    for (const [id, session] of this.sessions) {
      if (session.completedAt && session.completedAt < cutoff) {
        this.sessions.delete(id);
        count++;
      }
    }

    if (count > 0) {
      console.log(`[FORGE] Cleaned up ${count} old sessions`);
    }
  }
}

// Singleton
const forgeSession = new ForgeSession();
export default forgeSession;
export { ForgeSession, SESSION_STATES };

// --test block (guarded so imports don't trigger it)
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[FORGE] Running self-test...');

  const fs = new ForgeSession();

  // Test session creation
  const id = fs.create({ type: 'mesh', imageBuffer: Buffer.from('test') });
  console.assert(typeof id === 'string', 'ID should be a string');
  console.assert(id.length === 12, 'ID should be 12 chars');

  // Test status
  const status = fs.getStatus(id);
  console.assert(status.state === 'idle', 'Initial state should be idle');
  console.assert(status.type === 'mesh', 'Type should be mesh');

  // Test list
  const list = fs.list();
  console.assert(list.length === 1, 'Should have 1 session');
  console.assert(list[0].id === id, 'Listed session should match');

  // Test null for unknown session
  console.assert(fs.getStatus('nonexistent') === null, 'Unknown session should return null');

  // Test result before completion
  console.assert(fs.getResult(id) === null, 'No result before completion');

  console.log('[FORGE] Self-test passed');
  process.exit(0);
}
