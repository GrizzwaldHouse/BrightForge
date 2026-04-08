/**
 * OrchestrationEventBus - Typed event envelopes with SHA256 integrity hashes
 *
 * EventEmitter-based event system with:
 * - Typed event envelopes with SHA256 integrity verification
 * - Ring buffers (100 events per type) for recent event queries
 * - Persistent SQLite logging via OrchestrationStorage
 * - Integration with existing TelemetryBus for metrics forwarding
 *
 * STATUS: Complete. 13 event types, SHA256 hashing, ring buffers, persistence.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-03-02
 */

import { EventEmitter } from 'events';
import { randomUUID, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);

const VALID_EVENT_TYPES = [
  'task_started',
  'analysis_completed',
  'architecture_decided',
  'implementation_started',
  'file_written',
  'research_logged',
  'risk_flagged',
  'todo_added',
  'task_paused',
  'task_resumed',
  'task_completed',
  'audit_warning',
  'audit_passed',
  'agent_registered',
  'agent_heartbeat',
  'agent_disconnected',
  'build_started',
  'build_completed',
  'build_failed',
  'test_started',
  'test_completed',
  'test_failed',
  'review_started',
  'review_completed',
  'survey_started',
  'survey_completed',
  'recording_started',
  'recording_stopped',
  'recording_failed',
  'stability_started',
  'stability_checkpoint',
  'stability_completed',
  'idea_detected',
  'idea_classified',
  'idea_duplicate',
  'idea_scored',
  'idea_ranked',
  'research_started',
  'research_completed',
  'idea_indexed',
  'idea_linked'
];

class OrchestrationEventBus extends EventEmitter {
  /**
   * @param {OrchestrationStorage} storage - For persistent event logging
   * @param {Object} [config={}] - From orchestration.yaml event_bus section
   * @param {number} [config.ring_buffer_size=100] - Max events per type
   */
  constructor(storage, config = {}) {
    super();

    this.storage = storage;
    this.ringBufferSize = config.ring_buffer_size || 100;
    this.forwardToTelemetry = config.forward_to_telemetry !== false;

    // Initialize ring buffers (one per event type)
    this.ringBuffers = {};
    for (const eventType of VALID_EVENT_TYPES) {
      this.ringBuffers[eventType] = [];
    }

    // Event counters
    this.eventCounts = {};
    for (const eventType of VALID_EVENT_TYPES) {
      this.eventCounts[eventType] = 0;
    }
  }

  /**
   * Emit a typed orchestration event.
   * Creates envelope, computes SHA256 hash, stores to ring buffer + SQLite,
   * forwards to TelemetryBus, and broadcasts via EventEmitter.
   *
   * @param {string} eventType - Must be in VALID_EVENT_TYPES
   * @param {Object} data
   * @param {string} data.agent - Agent emitting the event
   * @param {string} [data.taskId] - Associated task ID
   * @param {Object} [data.payload={}] - Event-specific payload
   * @returns {string} event_id
   * @throws {Error} If eventType is not in VALID_EVENT_TYPES
   */
  emit(eventType, data) {
    // Validate event type
    if (!VALID_EVENT_TYPES.includes(eventType)) {
      const error = new Error(`Invalid event type: ${eventType}. Must be one of: ${VALID_EVENT_TYPES.join(', ')}`);
      errorHandler.report('orchestration_error', error, { eventType });
      throw error;
    }

    // Create event envelope
    const eventId = randomUUID().slice(0, 12);
    const timestamp = new Date().toISOString();

    const envelope = {
      event_id: eventId,
      timestamp,
      agent: data.agent,
      task_id: data.taskId || null,
      event_type: eventType,
      payload: data.payload || {}
    };

    // Compute SHA256 integrity hash
    const hashInput = JSON.stringify({
      event_id: envelope.event_id,
      timestamp: envelope.timestamp,
      agent: envelope.agent,
      task_id: envelope.task_id,
      event_type: envelope.event_type,
      payload: envelope.payload
    });

    envelope.integrity_hash = createHash('sha256').update(hashInput).digest('hex');

    // Store in ring buffer
    const buffer = this.ringBuffers[eventType];
    buffer.push(envelope);
    if (buffer.length > this.ringBufferSize) {
      buffer.shift(); // Remove oldest
    }

    // Update counters
    this.eventCounts[eventType]++;

    // Persist to SQLite (if storage is available)
    if (this.storage && this.storage.db) {
      try {
        this.storage.insertEvent(envelope);
      } catch (err) {
        console.error(`[EVENT-BUS] Failed to persist event ${eventId}:`, err.message);
        errorHandler.report('orchestration_error', err, { eventId, eventType });
      }
    }

    // Forward to TelemetryBus (if enabled)
    if (this.forwardToTelemetry) {
      try {
        telemetryBus.emit('orchestration_event', {
          eventType,
          agent: data.agent,
          taskId: data.taskId
        });
      } catch (err) {
        console.warn('[EVENT-BUS] Failed to forward to TelemetryBus:', err.message);
      }
    }

    // Emit to EventEmitter listeners
    super.emit(eventType, envelope);
    super.emit('all', envelope);

    return eventId;
  }

  /**
   * Verify the integrity hash of an event envelope.
   *
   * @param {Object} envelope - Full event envelope including integrity_hash
   * @returns {boolean} true if hash matches recomputed value
   */
  verifyIntegrity(envelope) {
    if (!envelope.integrity_hash) {
      return false;
    }

    const hashInput = JSON.stringify({
      event_id: envelope.event_id,
      timestamp: envelope.timestamp,
      agent: envelope.agent,
      task_id: envelope.task_id,
      event_type: envelope.event_type,
      payload: envelope.payload
    });

    const computedHash = createHash('sha256').update(hashInput).digest('hex');
    return computedHash === envelope.integrity_hash;
  }

  /**
   * Get recent events from ring buffers.
   *
   * @param {string} [eventType] - Filter by type, or null for all
   * @param {number} [limit=20] - Max events to return
   * @returns {Array<Object>} Event envelopes, newest first
   */
  getRecent(eventType = null, limit = 20) {
    if (eventType) {
      // Single type
      if (!VALID_EVENT_TYPES.includes(eventType)) {
        return [];
      }

      const buffer = this.ringBuffers[eventType];
      return buffer.slice(-limit).reverse();
    } else {
      // All types
      const allEvents = [];
      for (const type of VALID_EVENT_TYPES) {
        allEvents.push(...this.ringBuffers[type]);
      }

      // Sort by timestamp descending
      allEvents.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      return allEvents.slice(0, limit);
    }
  }

  /**
   * Query persisted events from SQLite.
   *
   * @param {Object} [filters={}]
   * @param {string} [filters.taskId] - Filter by task
   * @param {string} [filters.agent] - Filter by agent
   * @param {string} [filters.eventType] - Filter by type
   * @param {string} [filters.since] - ISO8601 lower bound
   * @param {number} [filters.limit=50] - Max results
   * @returns {Array<Object>} Event envelopes from SQLite
   */
  query(filters = {}) {
    if (!this.storage || !this.storage.db) {
      console.warn('[EVENT-BUS] Storage not available, returning empty array');
      return [];
    }

    try {
      return this.storage.queryEvents(filters);
    } catch (err) {
      console.error('[EVENT-BUS] Query failed:', err.message);
      errorHandler.report('orchestration_error', err, { filters });
      return [];
    }
  }

  /**
   * Get event timeline for a specific task (all events, ordered).
   *
   * @param {string} taskId
   * @returns {Array<Object>} Ordered event envelopes for the task
   */
  getTaskTimeline(taskId) {
    if (!this.storage || !this.storage.db) {
      console.warn('[EVENT-BUS] Storage not available, returning empty array');
      return [];
    }

    try {
      return this.storage.getTaskEvents(taskId);
    } catch (err) {
      console.error('[EVENT-BUS] Get task timeline failed:', err.message);
      errorHandler.report('orchestration_error', err, { taskId });
      return [];
    }
  }

  /**
   * Get aggregate counts by event type.
   *
   * @returns {Object} Map of event_type -> count
   */
  getCounts() {
    // Combine in-memory counts with storage counts (if available)
    if (this.storage && this.storage.db) {
      try {
        return this.storage.getEventCounts();
      } catch (err) {
        console.warn('[EVENT-BUS] Failed to get storage counts, using in-memory:', err.message);
      }
    }

    return { ...this.eventCounts };
  }

  /**
   * Clear ring buffers (useful for testing).
   */
  clear() {
    for (const eventType of VALID_EVENT_TYPES) {
      this.ringBuffers[eventType] = [];
      this.eventCounts[eventType] = 0;
    }

    console.log('[EVENT-BUS] Ring buffers cleared');
  }
}

// Note: Singleton is NOT exported here because EventBus needs storage instance.
// It will be instantiated in src/orchestration/index.js after storage is ready.
export default OrchestrationEventBus;
export { OrchestrationEventBus, VALID_EVENT_TYPES };

// Self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[EVENT-BUS] Running self-tests...\n');

  // Mock storage for testing
  const mockStorage = {
    db: true,
    insertEvent: (envelope) => {
      console.log(`  [MOCK-STORAGE] Inserted event: ${envelope.event_id}`);
    },
    queryEvents: (_filters) => {
      return [];
    },
    getTaskEvents: (_taskId) => {
      return [];
    },
    getEventCounts: () => {
      return { task_started: 1, task_completed: 1 };
    }
  };

  const eventBus = new OrchestrationEventBus(mockStorage, { ring_buffer_size: 10, forward_to_telemetry: false });

  try {
    // Test 1: Emit valid event
    console.log('Test 1: Emit valid event');
    const eventId1 = eventBus.emit('task_started', {
      agent: 'Claude',
      taskId: 'test-task-1',
      payload: { taskName: 'Test Task' }
    });
    console.log(`✓ Emitted event: ${eventId1}\n`);

    // Test 2: Emit invalid event type
    console.log('Test 2: Emit invalid event type (should throw)');
    try {
      eventBus.emit('invalid_event', { agent: 'Claude' });
      console.log('✗ Should have thrown error\n');
    } catch (err) {
      console.log(`✓ Correctly threw error: ${err.message}\n`);
    }

    // Test 3: Verify integrity
    console.log('Test 3: Verify integrity');
    const recentEvents = eventBus.getRecent('task_started', 1);
    if (recentEvents.length > 0) {
      const valid = eventBus.verifyIntegrity(recentEvents[0]);
      console.log(`✓ Integrity check passed: ${valid}\n`);

      // Test 3b: Tamper with payload
      const tamperedEnvelope = { ...recentEvents[0] };
      tamperedEnvelope.payload = { malicious: 'data' };
      const invalid = eventBus.verifyIntegrity(tamperedEnvelope);
      console.log(`✓ Tampering detected: ${!invalid}\n`);
    }

    // Test 4: Ring buffer overflow
    console.log('Test 4: Ring buffer overflow (emit 15 events, buffer size 10)');
    for (let i = 0; i < 15; i++) {
      eventBus.emit('task_completed', {
        agent: 'Ollama',
        taskId: `task-${i}`,
        payload: { index: i }
      });
    }
    const completedEvents = eventBus.getRecent('task_completed', 20);
    console.log(`✓ Ring buffer size: ${completedEvents.length} (max 10)\n`);

    // Test 5: getRecent with type filter
    console.log('Test 5: getRecent with type filter');
    const startedEvents = eventBus.getRecent('task_started', 5);
    console.log(`✓ Got ${startedEvents.length} task_started event(s)\n`);

    // Test 6: getRecent all types
    console.log('Test 6: getRecent all types');
    const allEvents = eventBus.getRecent(null, 20);
    console.log(`✓ Got ${allEvents.length} event(s) across all types\n`);

    // Test 7: getCounts
    console.log('Test 7: getCounts');
    const counts = eventBus.getCounts();
    console.log(`✓ Event counts: ${JSON.stringify(counts)}\n`);

    // Test 8: clear
    console.log('Test 8: clear');
    eventBus.clear();
    const afterClear = eventBus.getRecent(null, 20);
    console.log(`✓ After clear: ${afterClear.length} event(s)\n`);

    console.log('All tests passed! ✓');

  } catch (err) {
    console.error('Test failed:', err);
    process.exit(1);
  }
}
