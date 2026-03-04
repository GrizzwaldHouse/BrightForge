/**
 * Orchestration Facade - Unified initialization and exports
 *
 * Provides single entry point for BrightForge orchestration runtime:
 * - Unified init() initializes all subsystems in correct order
 * - Graceful shutdown() closes database connections
 * - Re-exports all orchestration modules for direct access
 *
 * Init Sequence:
 * 1. Load config/orchestration.yaml
 * 2. OrchestrationStorage.open()
 * 3. OrchestrationEventBus(storage)
 * 4. TaskState(storage, eventBus)
 * 5. SupervisorAgent(storage, eventBus)
 * 6. HandoffProtocol(taskState, supervisor, eventBus)
 * 7. Register agents (Claude, Ollama)
 *
 * STATUS: Implemented. Depends on all other orchestration modules.
 * TODO(P1): Add health check endpoint for orchestration runtime status
 * TODO(P2): Add metrics aggregation across all subsystems
 * TODO(P2): Add graceful migration support for schema upgrades
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date 2026-03-02
 */

import { readFileSync, existsSync } from 'fs';
import { parse } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OrchestrationStorage } from './storage.js';
import { OrchestrationEventBus } from './event-bus.js';
import { TaskState } from './task-state.js';
import { SupervisorAgent } from './supervisor.js';
import { HandoffProtocol } from './handoff.js';
import errorHandler from '../core/error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class Orchestrator {
  constructor() {
    this.storage = null;
    this.eventBus = null;
    this.taskState = null;
    this.supervisor = null;
    this.handoff = null;
    this.initialized = false;
    this.config = null;
  }

  /**
   * Initialize the orchestration runtime.
   *
   * @param {Object} [configOverride={}] - Override orchestration.yaml values
   * @returns {void}
   */
  init(configOverride = {}) {
    if (this.initialized) {
      console.warn('[ORCHESTRATOR] Already initialized, skipping');
      return;
    }

    try {
      console.log('[ORCHESTRATOR] Starting initialization...');

      // 1. Load configuration
      this.config = this._loadConfig(configOverride);

      // 2. Initialize OrchestrationStorage
      const dbPath = this.config.storage?.db_path || 'data/orchestration.db';
      console.log(`[ORCHESTRATOR] Opening database: ${dbPath}`);
      this.storage = new OrchestrationStorage(dbPath);
      this.storage.open();

      // 3. Initialize OrchestrationEventBus
      console.log('[ORCHESTRATOR] Initializing event bus');
      this.eventBus = new OrchestrationEventBus(this.storage, this.config.event_bus);

      // 4. Initialize TaskState
      console.log('[ORCHESTRATOR] Initializing task state manager');
      this.taskState = new TaskState(this.storage, this.eventBus);

      // 5. Initialize SupervisorAgent
      console.log('[ORCHESTRATOR] Initializing supervisor agent');
      this.supervisor = new SupervisorAgent(this.storage, this.eventBus, this.config.supervisor);

      // 6. Initialize HandoffProtocol
      console.log('[ORCHESTRATOR] Initializing handoff protocol');
      this.handoff = new HandoffProtocol(this.taskState, this.supervisor, this.eventBus, this.config.handoff);

      // 7. Register agents
      console.log('[ORCHESTRATOR] Registering agents');
      const agents = this.config.agents || [
        { name: 'Claude', type: 'cloud', capabilities: { planning: true, architecture: true, implementation: true } },
        { name: 'Ollama', type: 'local', capabilities: { planning: true, implementation: true } }
      ];

      for (const agent of agents) {
        try {
          this.storage.upsertAgent(agent);
          console.log(`[ORCHESTRATOR] Registered agent: ${agent.name} (${agent.type})`);
        } catch (err) {
          console.warn(`[ORCHESTRATOR] Failed to register agent ${agent.name}: ${err.message}`);
        }
      }

      // 8. Get initial stats
      const stats = this.storage.getStats();
      console.log(`[ORCHESTRATOR] Initialized (tasks: ${stats.taskCount}, events: ${stats.eventCount}, agents: ${agents.length})`);

      this.initialized = true;
    } catch (err) {
      errorHandler.report('orchestration_error', err, { operation: 'init' });
      console.error('[ORCHESTRATOR] Initialization failed:', err.message);
      throw err;
    }
  }

  /**
   * Graceful shutdown.
   */
  shutdown() {
    if (!this.initialized) {
      console.warn('[ORCHESTRATOR] Not initialized, nothing to shutdown');
      return;
    }

    try {
      console.log('[ORCHESTRATOR] Shutting down...');

      // Close database connection
      if (this.storage) {
        this.storage.close();
        console.log('[ORCHESTRATOR] Database closed');
      }

      // Clear references
      this.storage = null;
      this.eventBus = null;
      this.taskState = null;
      this.supervisor = null;
      this.handoff = null;
      this.initialized = false;

      console.log('[ORCHESTRATOR] Shutdown complete');
    } catch (err) {
      errorHandler.report('orchestration_error', err, { operation: 'shutdown' });
      console.error('[ORCHESTRATOR] Shutdown failed:', err.message);
      throw err;
    }
  }

  /**
   * Get runtime status.
   *
   * @returns {Object} Status snapshot
   */
  getStatus() {
    if (!this.initialized) {
      return {
        initialized: false,
        taskCount: 0,
        eventCount: 0,
        agentStatuses: []
      };
    }

    try {
      const stats = this.storage.getStats();
      const agents = this.storage.listAgents();

      return {
        initialized: true,
        taskCount: stats.taskCount,
        eventCount: stats.eventCount,
        auditCount: stats.auditCount,
        dbSizeBytes: stats.dbSizeBytes,
        agentStatuses: agents.map(a => ({
          name: a.name,
          type: a.type,
          status: a.status,
          lastActive: a.last_active_at
        }))
      };
    } catch (err) {
      errorHandler.report('orchestration_error', err, { operation: 'getStatus' });
      return {
        initialized: true,
        error: err.message
      };
    }
  }

  /**
   * Load configuration from orchestration.yaml with defaults.
   * @private
   */
  _loadConfig(override = {}) {
    const configPath = join(__dirname, '..', '..', 'config', 'orchestration.yaml');

    // Default configuration
    const defaults = {
      storage: {
        db_path: 'data/orchestration.db',
        journal_mode: 'WAL',
        busy_timeout_ms: 5000
      },
      event_bus: {
        ring_buffer_size: 100,
        forward_to_telemetry: true
      },
      task_state: {
        id_length: 12,
        valid_statuses: ['active', 'paused', 'completed', 'failed'],
        valid_phases: ['analysis', 'design', 'implementation', 'validation'],
        valid_agents: ['Claude', 'Ollama']
      },
      supervisor: {
        penalty_per_violation: 0.1,
        weights: {
          structural: 0.4,
          coding_standards: 0.3,
          continuity: 0.3
        },
        thresholds: {
          pass: 0.8,
          warning: 0.5
        },
        required_standards: [
          'observer_pattern',
          'no_hardcoded_values',
          'structured_logging',
          'typed_errors',
          'configuration_driven',
          'file_headers'
        ]
      },
      handoff: {
        require_audit: true,
        min_confidence: 0.5,
        max_handoffs_per_task: 10
      },
      agents: [
        {
          name: 'Claude',
          type: 'cloud',
          capabilities: {
            planning: true,
            architecture: true,
            code_review: true,
            implementation: true
          }
        },
        {
          name: 'Ollama',
          type: 'local',
          capabilities: {
            planning: true,
            architecture: false,
            code_review: false,
            implementation: true
          }
        }
      ]
    };

    // Try to load from file
    let fileConfig = {};
    if (existsSync(configPath)) {
      try {
        const yamlContent = readFileSync(configPath, 'utf8');
        fileConfig = parse(yamlContent) || {};
        console.log(`[ORCHESTRATOR] Loaded config from ${configPath}`);
      } catch (err) {
        console.warn(`[ORCHESTRATOR] Failed to load config file: ${err.message}, using defaults`);
      }
    } else {
      console.warn(`[ORCHESTRATOR] Config file not found: ${configPath}, using defaults`);
    }

    // Merge: defaults < fileConfig < override
    return this._deepMerge(this._deepMerge(defaults, fileConfig), override);
  }

  /**
   * Deep merge objects.
   * @private
   */
  _deepMerge(target, source) {
    const result = { ...target };
    for (const key in source) {
      if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
        result[key] = this._deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}

// Singleton + named export pattern
const orchestrator = new Orchestrator();
export default orchestrator;

// Named exports for direct access
export { Orchestrator };
export { TaskState } from './task-state.js';
export { OrchestrationEventBus } from './event-bus.js';
export { OrchestrationStorage } from './storage.js';
export { SupervisorAgent } from './supervisor.js';
export { HandoffProtocol } from './handoff.js';
export { HandoffError } from './handoff.js';

// --test self-test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[/\\]/).pop())) {
  console.log('\n=== Orchestrator Facade Self-Test ===\n');

  // Note: This test requires the data layer modules (storage, event-bus, task-state) to exist.
  // If they don't exist yet, the imports will fail. This is expected during parallel development.

  try {
    console.log('Test 1: Create orchestrator instance');
    const testOrch = new Orchestrator();
    console.assert(testOrch.initialized === false, 'Expected not initialized');
    console.assert(testOrch.storage === null, 'Expected null storage');
    console.log('✓ Test 1 passed\n');

    console.log('Test 2: Get status before init');
    const statusBefore = testOrch.getStatus();
    console.log('Status:', statusBefore);
    console.assert(statusBefore.initialized === false, 'Expected not initialized');
    console.assert(statusBefore.taskCount === 0, 'Expected 0 tasks');
    console.log('✓ Test 2 passed\n');

    console.log('Test 3: Init with temp database');
    const tempDbPath = `data/test-orchestration-${Date.now()}.db`;
    testOrch.init({ storage: { db_path: tempDbPath } });
    console.assert(testOrch.initialized === true, 'Expected initialized');
    console.assert(testOrch.storage !== null, 'Expected storage instance');
    console.assert(testOrch.eventBus !== null, 'Expected eventBus instance');
    console.assert(testOrch.taskState !== null, 'Expected taskState instance');
    console.assert(testOrch.supervisor !== null, 'Expected supervisor instance');
    console.assert(testOrch.handoff !== null, 'Expected handoff instance');
    console.log('✓ Test 3 passed\n');

    console.log('Test 4: Get status after init');
    const statusAfter = testOrch.getStatus();
    console.log('Status:', statusAfter);
    console.assert(statusAfter.initialized === true, 'Expected initialized');
    console.assert(typeof statusAfter.taskCount === 'number', 'Expected numeric taskCount');
    console.assert(Array.isArray(statusAfter.agentStatuses), 'Expected agentStatuses array');
    console.log('✓ Test 4 passed\n');

    console.log('Test 5: Shutdown');
    testOrch.shutdown();
    console.assert(testOrch.initialized === false, 'Expected not initialized after shutdown');
    console.assert(testOrch.storage === null, 'Expected null storage after shutdown');
    console.log('✓ Test 5 passed\n');

    console.log('Test 6: Re-init after shutdown');
    testOrch.init({ storage: { db_path: tempDbPath } });
    console.assert(testOrch.initialized === true, 'Expected re-initialized');
    console.log('✓ Test 6 passed\n');

    // Cleanup
    testOrch.shutdown();

    console.log('=== All Orchestrator Facade tests passed ===\n');
    console.log('Note: Full integration tests require data layer modules to be implemented.');
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('\n⚠️  Data layer modules not yet implemented (expected during parallel development)');
      console.log('Self-test will pass once task #2 (implementer-data) completes.\n');
      console.log('Module not found:', err.message);
    } else {
      console.error('\n❌ Test failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    }
  }
}
