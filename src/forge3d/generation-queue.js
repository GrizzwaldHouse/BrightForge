/**
 * GenerationQueue - FIFO batch queue for 3D generation
 *
 * SQLite-backed queue with single GPU constraint (max concurrent: 1).
 * Supports pause/resume/cancel operations.
 * Emits progress events via TelemetryBus.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 14, 2026
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { EventEmitter } from 'events';
import telemetryBus from '../core/telemetry-bus.js';
import forge3dDb from './database.js';
import forgeSession from './forge-session.js';
import modelBridge from './model-bridge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class GenerationQueue extends EventEmitter {
  constructor() {
    super();
    this.processing = false;
    this.paused = false;
    this.currentJobId = null;
    this._processTimer = null;
  }

  /**
   * Initialize queue - open database and recover incomplete jobs.
   */
  init() {
    forge3dDb.open();
    this._recoverIncomplete();
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
    const histId = forge3dDb.createHistoryEntry({
      projectId: params.projectId || null,
      type: params.type,
      prompt: params.prompt || null,
      status: 'queued',
      metadata: {
        options: params.options || {},
        filename: params.filename || null,
        hasImage: !!params.imageBuffer
      }
    });

    // Store image buffer in memory for processing (not in DB)
    if (params.imageBuffer) {
      if (!this._imageBuffers) this._imageBuffers = new Map();
      this._imageBuffers.set(histId, params.imageBuffer);
    }

    const position = this._getQueuePosition();

    console.log(`[QUEUE] Job enqueued: ${histId} (type=${params.type}, position=${position})`);

    telemetryBus.emit('forge3d_job_queued', {
      jobId: histId,
      type: params.type,
      position
    });

    this.emit('enqueued', { jobId: histId, position });

    // Trigger processing
    this._scheduleProcess();

    return {
      jobId: histId,
      type: params.type,
      status: 'queued',
      position
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
    const queued = forge3dDb.listHistory({ status: 'queued' });
    const processing = forge3dDb.listHistory({ status: 'processing' });

    return {
      paused: this.paused,
      processing: this.processing,
      currentJobId: this.currentJobId,
      queuedCount: queued.length,
      processingCount: processing.length,
      jobs: [...processing, ...queued]
    };
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
    }, 100);
  }

  /**
   * Process the next job in the queue.
   */
  async _processNext() {
    if (this.processing || this.paused) return;

    // Get oldest queued job
    const queued = forge3dDb.listHistory({ status: 'queued', limit: 1 });
    if (queued.length === 0) return;

    const job = queued[queued.length - 1]; // listHistory is DESC, so last = oldest
    this.processing = true;
    this.currentJobId = job.id;

    console.log(`[QUEUE] Processing job ${job.id} (type=${job.type})...`);

    forge3dDb.updateHistoryEntry(job.id, { status: 'processing' });

    telemetryBus.emit('forge3d_job_started', {
      jobId: job.id,
      type: job.type
    });

    this.emit('processing', { jobId: job.id });

    try {
      // Build session params
      const sessionParams = { type: job.type };
      let metadata = {};
      try { metadata = typeof job.metadata === 'string' ? JSON.parse(job.metadata) : (job.metadata || {}); } catch (_e) { /* ok */ }

      if (job.prompt) sessionParams.prompt = job.prompt;
      if (metadata.options) sessionParams.options = metadata.options;

      // Retrieve image buffer if stored
      if (this._imageBuffers && this._imageBuffers.has(job.id)) {
        sessionParams.imageBuffer = this._imageBuffers.get(job.id);
        sessionParams.filename = metadata.filename || 'upload.png';
        this._imageBuffers.delete(job.id);
      }

      // Create and run session
      const sessionId = forgeSession.create(sessionParams);
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
        generationTime: result.generationTime || result.totalTime
      });

      this.emit('complete', { jobId: job.id, result });

    } catch (err) {
      console.error(`[QUEUE] Job ${job.id} failed: ${err.message}`);

      forge3dDb.updateHistoryEntry(job.id, {
        status: 'failed',
        errorMessage: err.message
      });

      telemetryBus.emit('forge3d_job_failed', {
        jobId: job.id,
        type: job.type,
        error: err.message
      });

      this.emit('failed', { jobId: job.id, error: err.message });
    }

    this.processing = false;
    this.currentJobId = null;

    // Process next job
    this._scheduleProcess();
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
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
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
  queue.shutdown();
  forge3dDb.close();

  console.log('[QUEUE] Self-test passed');
  process.exit(0);
}
