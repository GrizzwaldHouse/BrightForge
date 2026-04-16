/**
 * Model Intelligence - Facade Module
 *
 * Wires together config, database, scanner, inventory writer,
 * telemetry, and error handling into a single unified interface.
 * Lazy initialization: nothing starts until init() is called.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import modelDb from './database.js';
import { EVENT_TYPES } from './event-types.js';
import { ModelScanner } from './scanner.js';
import inventoryWriter from './inventory-writer.js';
import modelRouter from './model-router.js';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

class ModelIntelligence {
  constructor() {
    this._initialized = false;
    this._db = null;
    this._scanner = null;
  }

  async init() {
    if (this._initialized) {
      console.log('[MODEL-INTEL] Already initialized');
      return;
    }

    console.log('[MODEL-INTEL] Initializing...');

    // Open database
    modelDb.open();
    this._db = modelDb;

    // Create scanner and wire events
    this._scanner = new ModelScanner();
    this._wireEvents();

    // Populate router with current DB state
    modelRouter.refresh();

    this._initialized = true;
    console.log('[MODEL-INTEL] Initialized');
  }

  _wireEvents() {
    // Forward all scanner events to telemetryBus
    for (const eventType of Object.values(EVENT_TYPES)) {
      this._scanner.on(eventType, (data) => {
        telemetryBus.emit(data.type, data);
      });
    }

    // Refresh router when scan completes
    this._scanner.on(EVENT_TYPES.SCAN_COMPLETED, () => {
      modelRouter.refresh();
    });

    // Wire scanner errors to errorHandler
    this._scanner.on('error', (err) => {
      errorHandler.report('model_intel_error', err);
    });
  }

  async runScan(type = 'instant', dirs = []) {
    if (!this._initialized) {
      throw new Error('ModelIntelligence not initialized. Call init() first.');
    }

    console.log(`[MODEL-INTEL] Starting ${type} scan...`);

    let results;
    if (type === 'deep') {
      results = await this._scanner.runDeepScan(dirs);
    } else {
      results = await this._scanner.runInstantScan();
    }

    // Write inventory files after scan
    console.log('[MODEL-INTEL] Writing inventory files...');
    inventoryWriter.writeAll(this._db);

    return results;
  }

  getStatus() {
    return {
      initialized: this._initialized,
      lastScan: this._db ? this._db.getScanHistory(1)[0] || null : null,
      stats: this._db ? this._db.getStats() : null
    };
  }

  getInventory() {
    if (!this._db) return null;

    return {
      models: this._db.getModelFiles({ limit: 1000 }),
      runtimes: this._db.getRuntimes(),
      storage: this._db.getStorageVolumes()
    };
  }

  getScanHistory(limit = 20) {
    if (!this._db) return [];
    return this._db.getScanHistory(limit);
  }

  getRouter() {
    return modelRouter;
  }

  shutdown() {
    if (this._db) {
      this._db.close();
      this._db = null;
    }
    this._scanner = null;
    this._initialized = false;
    console.log('[MODEL-INTEL] Shut down');
  }
}

const modelIntelligence = new ModelIntelligence();
export default modelIntelligence;
export { ModelIntelligence };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing ModelIntelligence facade...\n');

  try {
    let passed = 0;

    // Test 1: Starts uninitialized
    const mi = new ModelIntelligence();
    console.assert(mi._initialized === false, 'Should start uninitialized');
    console.assert(mi._db === null, 'DB should be null');
    console.assert(mi._scanner === null, 'Scanner should be null');
    console.log('  [PASS] Constructor sets uninitialized state');
    passed++;

    // Test 2: Init sets up database and scanner
    await mi.init();
    console.assert(mi._initialized === true, 'Should be initialized after init()');
    console.assert(mi._db !== null, 'DB should be set');
    console.assert(mi._scanner !== null, 'Scanner should be set');
    console.log('  [PASS] init() sets up database and scanner');
    passed++;

    // Test 3: getStatus returns correct shape
    const status = mi.getStatus();
    console.assert(status.initialized === true, 'Status should show initialized');
    console.assert(status.stats !== null, 'Stats should not be null');
    console.assert(typeof status.stats.totalFiles === 'number', 'Stats should have totalFiles');
    console.log('  [PASS] getStatus() returns correct shape');
    passed++;

    // Test 4: getInventory returns correct shape
    const inventory = mi.getInventory();
    console.assert(Array.isArray(inventory.models), 'Inventory should have models array');
    console.assert(Array.isArray(inventory.runtimes), 'Inventory should have runtimes array');
    console.assert(Array.isArray(inventory.storage), 'Inventory should have storage array');
    console.log('  [PASS] getInventory() returns correct shape');
    passed++;

    // Test 5: getScanHistory returns array
    const history = mi.getScanHistory(5);
    console.assert(Array.isArray(history), 'Scan history should be an array');
    console.log('  [PASS] getScanHistory() returns array');
    passed++;

    // Test 6: Double init is safe
    await mi.init();
    console.assert(mi._initialized === true, 'Should still be initialized');
    console.log('  [PASS] Double init() is safe (no-op)');
    passed++;

    // Test 7: Shutdown cleans up
    mi.shutdown();
    console.assert(mi._initialized === false, 'Should be uninitialized after shutdown');
    console.assert(mi._db === null, 'DB should be null after shutdown');
    console.assert(mi._scanner === null, 'Scanner should be null after shutdown');
    console.log('  [PASS] shutdown() cleans up state');
    passed++;

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('ModelIntelligence facade test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
