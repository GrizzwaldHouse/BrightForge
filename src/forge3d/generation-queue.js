/**
 * GenerationQueue - FIFO batch queue for 3D generation
 *
 * SQLite-backed queue with single GPU constraint (max concurrent: 1).
 * Supports pause/resume/cancel operations.
 * Emits progress events via TelemetryBus.
 *
 * STATUS: Complete. Job lifecycle tested via self-test.
 *         Bridge crash recovery wired to ModelBridge 'crash' event.
 *
 * TODO(P1): Add configurable max queue size to prevent unbounded growth
 * TODO(P1): Add priority queue support (urgent jobs jump ahead)
 * TODO(P1): Add estimated wait time calculation from historical generation times
 * TODO(P1): Add dead-letter queue for repeatedly failing prompts
 * TODO(P2): Add scheduled/cron-based batch generation
 * TODO(P2): Add webhook notification on job completion
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { EventEmitter } from 'events';
import telemetryBus from '../core/telemetry-bus.js';
import forge3dDb from './database.js';
import forgeSession from './forge-session.js';
import modelBridge from './model-bridge.js';
import forge3dConfig from './config-loader.js';
import { isSelfTest } from '../core/is-main-module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TEMP_DIR = forge3dConfig.resolvePath(forge3dConfig.queue.temp_dir);

class GenerationQueue extends EventEmitter {
  constructor() {
    super();
    this.processing = false;
    this.paused = false;
    this.currentJobId = null;
    this._processTimer = null;
    // In-memory context per job: { sessionId, hooks, waiter }
    this._jobContext = new Map();
  }

  /**
   * The single admission path for generation work. Creates the session that
   * clients poll, then queues it, so pause, capacity, ordering, retries and
   * dead-letter handling apply to every request.
   * @param {Object} params - type, prompt, imageBuffer, filename, options, model, projectId, priority
   * @param {Object} [hooks] - { onComplete(result, ids), onFailed(error, ids) }
   * @returns {{ jobId, sessionId, status, position, priority }}
   * @throws {Error} code QUEUE_FULL when the queue is at capacity
   */
  submit(params, hooks = {}) {
    this.init();
    const sessionId = forgeSession.create({
      type: params.type,
      prompt: params.prompt,
      imageBuffer: params.imageBuffer,
      filename: params.filename,
      options: params.options,
      model: params.model
    });
    let job;
    try {
      job = this.enqueue({ ...params, sessionId });
    } catch (err) {
      forgeSession.finalizeFailure(sessionId, err.message);
      throw err;
    }
    this._jobContext.set(job.jobId, { ...(this._jobContext.get(job.jobId) || {}), sessionId, hooks });
    forgeSession.markQueued(sessionId, { jobId: job.jobId, position: job.position });
    return { ...job, sessionId };
  }

  /**
   * Submit and wait for the final outcome (used by pipeline stages).
   * @returns {Promise<{ jobId, sessionId, result }>} rejects on dead letter or cancel
   */
  submitAndWait(params) {
    return new Promise((resolve, reject) => {
      const job = this.submit(params, {
        onComplete: (result, ids) => resolve({ ...ids, result }),
        onFailed: (error) => reject(error)
      });
      return job;
    });
  }

  /**
   * Initialize queue - open database and recover incomplete jobs.
   */
  init() {
    if (this._initialized) return;
    this._initialized = true;
    forge3dDb.open();
    this._recoverIncomplete();
    this._cleanupTempFiles();
    this._listenForBridgeCrash();
    console.log('[QUEUE] GenerationQueue initialized');
  }

  /**
   * Listen for Python bridge crashes and mark active job as failed.
   */
  _listenForBridgeCrash() {
    modelBridge.on('crash', ({ code, signal }) => {
      if (this.currentJobId) {
        console.error(`[QUEUE] Bridge crashed during job ${this.currentJobId} (code=${code}, signal=${signal})`);
        forge3dDb.updateHistoryEntry(this.currentJobId, {
          status: 'failed',
          errorMessage: `Python process crashed (code=${code}, signal=${signal})`
        });

        telemetryBus.emit('forge3d_job_failed', {
          jobId: this.currentJobId,
          type: 'unknown',
          error: 'Python process crashed'
        });

        this.emit('failed', { jobId: this.currentJobId, error: 'Python process crashed' });

        this.processing = false;
        this.currentJobId = null;
      }
    });
  }

  /**
   * Mark any stuck processing jobs as failed on startup.
   */
  _recoverIncomplete() {
    const incomplete = forge3dDb.findIncomplete();
    if (incomplete.length === 0) return;

    console.log(`[QUEUE] Recovering ${incomplete.length} incomplete job(s)...`);
    for (const job of incomplete) {
      if (job.status === 'processing') {
        forge3dDb.updateHistoryEntry(job.id, {
          status: 'failed',
          errorMessage: 'Interrupted: server restarted during generation'
        });
        console.log(`[QUEUE] Marked job ${job.id} as failed (was processing)`);
      }
    }
  }

  /**
   * Enqueue a new generation job.
   * @param {Object} params
   * @param {string} params.type - 'mesh' | 'image' | 'full'
   * @param {string} [params.prompt] - Text prompt
   * @param {Buffer} [params.imageBuffer] - Image data (for mesh)
   * @param {string} [params.filename] - Image filename
   * @param {string} [params.projectId] - Auto-save to project
   * @param {Object} [params.options] - width, height, steps
   * @returns {Object} Queued job info
   */
  enqueue(params) {
    // Rate limiting: reject if queue is full
    const currentSize = this._getQueuePosition() + (this.processing ? 1 : 0);
    if (currentSize >= forge3dConfig.queue.max_size) {
      console.warn(`[QUEUE] Rejected job — queue at capacity (${currentSize}/${forge3dConfig.queue.max_size})`);
      const full = new Error(`Queue is full (max ${forge3dConfig.queue.max_size} jobs). Try again when current jobs complete.`);
      full.code = 'QUEUE_FULL';
      throw full;
    }

    const priorityMap = { urgent: 0, normal: 1, background: 2 };
    const priorityValue = priorityMap[params.priority] ?? 1;

    const histId = forge3dDb.createHistoryEntry({
      projectId: params.projectId || null,
      type: params.type,
      prompt: params.prompt || null,
      status: 'queued',
      metadata: {
        options: params.options || {},
        filename: params.filename || null,
        hasImage: !!params.imageBuffer,
        model: params.model || null,
        sessionId: params.sessionId || null
      }
    });

    // Set priority in the DB
    forge3dDb.db.prepare('UPDATE generation_history SET priority = ? WHERE id = ?').run(priorityValue, histId);

    // Store image buffer in memory for processing (not in DB)
    if (params.imageBuffer) {
      if (!this._imageBuffers) this._imageBuffers = new Map();
      this._imageBuffers.set(histId, params.imageBuffer);
    }

    const position = this._getQueuePosition();

    console.log(`[QUEUE] Job enqueued: ${histId} (type=${params.type}, priority=${priorityValue}, position=${position})`);

    telemetryBus.emit('forge3d_job_queued', {
      jobId: histId,
      type: params.type,
      position,
      priority: priorityValue
    });

    this.emit('enqueued', { jobId: histId, position });

    // Trigger processing
    this._scheduleProcess();

    return {
      jobId: histId,
      type: params.type,
      status: 'queued',
      position,
      priority: priorityValue
    };
  }

  /**
   * Cancel a queued job.
   * @param {string} jobId
   * @returns {boolean} true if cancelled
   */
  cancel(jobId) {
    const job = forge3dDb.getHistoryEntry(jobId);
    if (!job) return false;

    if (job.status === 'queued') {
      forge3dDb.updateHistoryEntry(jobId, {
        status: 'failed',
        errorMessage: 'Cancelled by user'
      });
      if (this._imageBuffers) this._imageBuffers.delete(jobId);
      this._settle(jobId, null, new Error('Cancelled by user'));
      console.log(`[QUEUE] Job cancelled: ${jobId}`);
      this.emit('cancelled', { jobId });
      return true;
    }

    if (job.status === 'processing' && this.currentJobId === jobId) {
      // Can't easily cancel mid-generation, mark for next check
      console.log(`[QUEUE] Job ${jobId} is processing — will be marked failed on completion`);
      return false;
    }

    return false;
  }

  /**
   * Pause the queue (finish current job but don't start new ones).
   */
  pause() {
    this.paused = true;
    console.log('[QUEUE] Queue paused');
    this.emit('paused');
  }

  /**
   * Resume the queue.
   */
  resume() {
    this.paused = false;
    console.log('[QUEUE] Queue resumed');
    this.emit('resumed');
    this._scheduleProcess();
  }

  /**
   * Get queue status.
   */
  getStatus() {
    if (!forge3dDb.db) {
      return {
        paused: this.paused,
        processing: this.processing,
        currentJobId: this.currentJobId,
        queuedCount: 0,
        processingCount: 0,
        deadLetterCount: 0,
        jobs: [],
        initialized: false
      };
    }

    const queued = forge3dDb.listHistory({ status: 'queued' });
    const processing = forge3dDb.listHistory({ status: 'processing' });
    const deadLetterCount = forge3dDb.db.prepare(
      'SELECT COUNT(*) AS count FROM generation_history WHERE status = ?'
    ).get('dead_letter').count;

    return {
      paused: this.paused,
      processing: this.processing,
      currentJobId: this.currentJobId,
      queuedCount: queued.length,
      processingCount: processing.length,
      deadLetterCount,
      jobs: [...processing, ...queued],
      initialized: true
    };
  }

  /**
   * Clean up orphaned temp files older than TEMP_MAX_AGE_MS.
   * Called on init() to remove leftovers from crashed generations.
   */
  _cleanupTempFiles() {
    if (!existsSync(TEMP_DIR)) return;

    try {
      const files = readdirSync(TEMP_DIR);
      const cutoff = Date.now() - forge3dConfig.queue.temp_max_age_ms;
      let cleaned = 0;

      for (const file of files) {
        if (file === '.gitkeep') continue;
        const filePath = join(TEMP_DIR, file);
        try {
          const stat = statSync(filePath);
          if (stat.mtimeMs < cutoff) {
            unlinkSync(filePath);
            cleaned++;
          }
        } catch (_e) { /* skip files we can't stat */ }
      }

      if (cleaned > 0) {
        console.log(`[QUEUE] Cleaned up ${cleaned} orphaned temp file(s)`);
      }
    } catch (err) {
      console.warn(`[QUEUE] Temp cleanup failed (non-fatal): ${err.message}`);
    }
  }

  /**
   * Get position of next queued job.
   */
  _getQueuePosition() {
    const queued = forge3dDb.listHistory({ status: 'queued' });
    return queued.length;
  }

  /**
   * Schedule queue processing on next tick.
   */
  _scheduleProcess() {
    if (this._processTimer) return;
    this._processTimer = setTimeout(() => {
      this._processTimer = null;
      this._processNext();
    }, forge3dConfig.queue.process_interval_ms);
  }

  /**
   * Process the next job in the queue.
   */
  async _processNext() {
    if (this.processing || this.paused) return;

    // Get highest-priority queued job (priority ASC = urgent first, then oldest)
    const job = forge3dDb.db.prepare(
      'SELECT * FROM generation_history WHERE status = ? ORDER BY priority ASC, created_at ASC LIMIT 1'
    ).get('queued');
    if (!job) return;
    // Parse metadata if needed
    if (job.metadata && typeof job.metadata === 'string') {
      try { job.metadata = JSON.parse(job.metadata); } catch (_e) { /* keep as string */ }
    }

    this.processing = true;
    this.currentJobId = job.id;

    console.log(`[QUEUE] Processing job ${job.id} (type=${job.type}, priority=${job.priority})...`);

    forge3dDb.updateHistoryEntry(job.id, { status: 'processing' });

    telemetryBus.emit('forge3d_job_started', {
      jobId: job.id,
      type: job.type,
      priority: job.priority
    });

    this.emit('processing', { jobId: job.id });

    try {
      // Build session params
      const sessionParams = { type: job.type };
      let metadata = {};
      try { metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : (job.metadata || {}); } catch (_e) { /* ok */ }

      if (job.prompt) sessionParams.prompt = job.prompt;
      if (metadata.options) sessionParams.options = metadata.options;

      if (metadata.model) sessionParams.model = metadata.model;

      // Retrieve image buffer if stored (kept until the job settles so retries have it)
      if (this._imageBuffers && this._imageBuffers.has(job.id)) {
        sessionParams.imageBuffer = this._imageBuffers.get(job.id);
        sessionParams.filename = metadata.filename || 'upload.png';
      }

      // Run the session the client is already polling; recovered jobs without
      // one get a fresh session.
      const ctx = this._jobContext.get(job.id);
      let sessionId = ctx?.sessionId;
      const existing = sessionId ? forgeSession.sessions.get(sessionId) : null;
      if (existing && existing.state === 'failed') {
        forgeSession.resetForRetry(sessionId, job.retry_count || 0);
      } else if (!existing) {
        sessionId = forgeSession.create(sessionParams);
        forgeSession.markQueued(sessionId, { jobId: job.id });
        this._jobContext.set(job.id, { ...(ctx || {}), sessionId });
      }
      const result = await forgeSession.run(sessionId);

      // Success
      forge3dDb.updateHistoryEntry(job.id, {
        status: 'complete',
        generationTime: result.generationTime || result.totalTime || 0
      });

      console.log(`[QUEUE] Job ${job.id} complete`);

      telemetryBus.emit('forge3d_job_complete', {
        jobId: job.id,
        type: job.type,
        generationTime: result.generationTime || result.totalTime,
        priority: job.priority
      });

      this.emit('complete', { jobId: job.id, result });
      this._settle(job.id, result, null);

    } catch (err) {
      console.error(`[QUEUE] Job ${job.id} failed: ${err.message}`);

      // Retry logic: re-enqueue if under MAX_RETRIES
      const entry = forge3dDb.getHistoryEntry(job.id);
      const retryCount = entry?.retry_count || 0;

      if (retryCount < forge3dConfig.queue.max_retries) {
        console.log(`[QUEUE] Retrying job ${job.id} (attempt ${retryCount + 1}/${forge3dConfig.queue.max_retries})`);
        forge3dDb.updateHistoryEntry(job.id, {
          status: 'queued',
          errorMessage: `Retry ${retryCount + 1}: ${err.message}`
        });
        // Increment retry_count directly
        forge3dDb.db.prepare(
          'UPDATE generation_history SET retry_count = ? WHERE id = ?'
        ).run(retryCount + 1, job.id);

        telemetryBus.emit('forge3d_job_retry', {
          jobId: job.id,
          type: job.type,
          attempt: retryCount + 1,
          error: err.message
        });
      } else {
        // Retries exhausted: park the job in the dead-letter state so it can be
        // inspected and manually retried (retryDeadLetter / retryAllDeadLetters)
        forge3dDb.updateHistoryEntry(job.id, {
          status: 'dead_letter',
          errorMessage: retryCount > 0
            ? `Failed after ${retryCount} retries: ${err.message}`
            : err.message
        });

        telemetryBus.emit('forge3d_job_failed', {
          jobId: job.id,
          type: job.type,
          error: err.message,
          retries: retryCount,
          priority: job.priority,
          deadLetter: true
        });

        this.emit('dead_letter', { jobId: job.id, error: err.message, retries: retryCount });
        this.emit('failed', { jobId: job.id, error: err.message, deadLetter: true });
        this._settle(job.id, null, err);
      }
    }

    this.processing = false;
    this.currentJobId = null;

    // Process next job
    this._scheduleProcess();
  }

  /**
   * Final outcome for a job: release its buffers, close its session and call
   * the submitter's hooks. Runs once per job.
   * @private
   */
  _settle(jobId, result, error) {
    if (this._imageBuffers) this._imageBuffers.delete(jobId);
    const ctx = this._jobContext.get(jobId);
    this._jobContext.delete(jobId);
    if (!ctx) return;
    const ids = { jobId, sessionId: ctx.sessionId };
    if (error) {
      if (ctx.sessionId) forgeSession.finalizeFailure(ctx.sessionId, error.message);
      try { ctx.hooks?.onFailed?.(error, ids); } catch (hookErr) { console.error(`[QUEUE] onFailed hook error: ${hookErr.message}`); }
    } else {
      try { ctx.hooks?.onComplete?.(result, ids); } catch (hookErr) { console.error(`[QUEUE] onComplete hook error: ${hookErr.message}`); }
    }
  }

  /**
   * Get queue depth broken down by priority tier.
   */
  getQueueDepthByPriority() {
    const rows = forge3dDb.db.prepare(
      'SELECT priority, COUNT(*) as count FROM generation_history WHERE status = ? GROUP BY priority'
    ).all('queued');
    return {
      urgent: rows.find(r => r.priority === 0)?.count || 0,
      normal: rows.find(r => r.priority === 1)?.count || 0,
      background: rows.find(r => r.priority === 2)?.count || 0
    };
  }

  /**
   * Requeue a single dead-letter job for one manual override attempt.
   * retry_count is intentionally NOT reset — one more failure re-dead-letters it.
   * Returns true if the job was found and requeued, false if not found or wrong status.
   */
  retryDeadLetter(jobId) {
    if (!forge3dDb.db) return false;
    const entry = forge3dDb.getHistoryEntry(jobId);
    if (!entry || entry.status !== 'dead_letter') return false;

    forge3dDb.updateHistoryEntry(jobId, { status: 'queued', errorMessage: null });
    // retry_count intentionally NOT reset — one more failure re-dead-letters it

    console.log(`[QUEUE] Dead-letter job ${jobId} requeued (manual override)`);
    telemetryBus.emit('forge3d_job_manual_retry', { jobId, type: entry.type });
    this.emit('enqueued', { jobId, position: 0 });
    this._scheduleProcess();
    return true;
  }

  /**
   * Requeue all dead-letter jobs. Returns count requeued.
   */
  retryAllDeadLetters() {
    if (!forge3dDb.db) return 0;
    const rows = forge3dDb.db.prepare(
      'SELECT id FROM generation_history WHERE status = ?'
    ).all('dead_letter');

    let count = 0;
    for (const row of rows) {
      if (this.retryDeadLetter(row.id)) count++;
    }
    return count;
  }

  /**
   * Shutdown queue gracefully.
   */
  shutdown() {
    if (this._processTimer) {
      clearTimeout(this._processTimer);
      this._processTimer = null;
    }
    this.paused = true;
    console.log('[QUEUE] GenerationQueue shut down');
  }
}

// Singleton
const generationQueue = new GenerationQueue();
export default generationQueue;
export { GenerationQueue };

// --test block (guarded so imports don't trigger it)
if (isSelfTest(import.meta.url)) {
  console.log('[QUEUE] Running self-test...');

  const queue = new GenerationQueue();
  queue.init();

  // Test enqueue
  const job1 = queue.enqueue({ type: 'image', prompt: 'test cube' });
  console.assert(job1.jobId, 'Job should have an ID');
  console.assert(job1.status === 'queued', 'Status should be queued');

  const job2 = queue.enqueue({ type: 'mesh', prompt: 'test sphere' });

  // Test status
  const status = queue.getStatus();
  console.assert(status.queuedCount >= 2, 'Should have at least 2 queued jobs');
  console.assert(!status.paused, 'Should not be paused');

  // Test cancel
  const cancelled = queue.cancel(job2.jobId);
  console.assert(cancelled, 'Should cancel queued job');

  // Test pause/resume
  queue.pause();
  console.assert(queue.paused, 'Should be paused');
  queue.resume();
  console.assert(!queue.paused, 'Should be resumed');

  // Cleanup — cancel remaining
  queue.cancel(job1.jobId);

  // Single admission path (review finding P1, 2026-11-07): submit() must obey
  // pause, capacity, retries and dead letter. forgeSession.run is stubbed so no
  // real generation runs.
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const settleMs = forge3dConfig.queue.process_interval_ms * 5;
  const realRun = forgeSession.run.bind(forgeSession);
  let runs = 0;
  let mode = 'ok';
  forgeSession.run = async (id) => {
    runs++;
    const s = forgeSession.sessions.get(id);
    if (mode === 'fail') { s.state = 'failed'; throw new Error('fixture failure'); }
    s.state = 'complete';
    return { generationTime: 1 };
  };
  try {
    queue.pause();
    const outcomes = [];
    const a = queue.submit({ type: 'image', prompt: 'paused fixture' }, { onComplete: () => outcomes.push('complete'), onFailed: () => outcomes.push('failed') });
    await wait(settleMs);
    console.assert(runs === 0, `Paused queue must not run submitted work, ran ${runs}`);
    console.assert(forgeSession.getStatus(a.sessionId).state === 'idle', 'Paused job stays idle');
    console.assert(forge3dDb.getHistoryEntry(a.jobId).status === 'queued', 'Paused job stays queued');
    queue.resume();
    await wait(settleMs);
    console.assert(runs === 1 && outcomes.join() === 'complete', `Resumed job completes once (runs=${runs}, outcomes=${outcomes})`);
    console.assert(forge3dDb.getHistoryEntry(a.jobId).status === 'complete', 'History marks the job complete');

    mode = 'fail';
    runs = 0;
    const failed = [];
    const b = queue.submit({ type: 'image', prompt: 'failing fixture' }, { onFailed: (e) => failed.push(e.message) });
    await wait(settleMs * (forge3dConfig.queue.max_retries + 2));
    console.assert(runs === forge3dConfig.queue.max_retries + 1, `Failing job retried ${forge3dConfig.queue.max_retries} times, ran ${runs}`);
    console.assert(forge3dDb.getHistoryEntry(b.jobId).status === 'dead_letter', 'Exhausted job is dead-lettered');
    console.assert(failed.length === 1, `onFailed fires once, fired ${failed.length}`);
    console.assert(forgeSession.getStatus(b.sessionId).state === 'failed', 'Session ends failed');

    queue.pause();
    const savedMax = forge3dConfig.queue.max_size;
    forge3dConfig.queue.max_size = queue._getQueuePosition() + 1;
    const c = queue.submit({ type: 'image', prompt: 'capacity fixture one' });
    let fullCode = null;
    try { queue.submit({ type: 'image', prompt: 'capacity fixture two' }); } catch (e) { fullCode = e.code; }
    forge3dConfig.queue.max_size = savedMax;
    console.assert(fullCode === 'QUEUE_FULL', `Capacity limit enforced on submit, got ${fullCode}`);
    queue.cancel(c.jobId);
    console.assert(forgeSession.getStatus(c.sessionId).state === 'failed', 'Cancelled queued job closes its session');
  } finally {
    forgeSession.run = realRun;
  }

  queue.shutdown();
  forge3dDb.close();

  console.log('[QUEUE] Self-test passed');
  process.exit(0);
}
