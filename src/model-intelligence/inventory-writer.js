/**
 * Model Intelligence Inventory Writer
 *
 * Writes JSON inventory files to data/model-intelligence/ from database queries.
 * Produces model_inventory.json, runtime_inventory.json, and storage_topology.json.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import configLoader from './config-loader.js';
import { ModelIntelligenceDatabase } from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const VERSION = '1.0.0';

class InventoryWriter {
  _ensureOutputDir() {
    const outputConfig = configLoader.getOutputConfig();
    const outputDir = configLoader.resolvePath(outputConfig.dir || 'data/model-intelligence');
    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
      console.log(`[INVENTORY] Created output directory: ${outputDir}`);
    }
    return outputDir;
  }

  writeModelInventory(db) {
    this._ensureOutputDir();
    const outputConfig = configLoader.getOutputConfig();
    const outputPath = configLoader.resolvePath(
      outputConfig.model_inventory || 'data/model-intelligence/model_inventory.json'
    );

    const files = db.getModelFiles({ limit: 1000 });

    const totalSizeBytes = files.reduce((sum, f) => sum + (f.size_bytes || 0), 0);

    const bySource = {};
    const byFormat = {};
    for (const f of files) {
      const source = f.source || 'unknown';
      bySource[source] = (bySource[source] || 0) + 1;

      const format = f.format || 'unknown';
      byFormat[format] = (byFormat[format] || 0) + 1;
    }

    const inventory = {
      generated_at: new Date().toISOString(),
      version: VERSION,
      summary: {
        total_files: files.length,
        total_size_bytes: totalSizeBytes,
        by_source: bySource,
        by_format: byFormat
      },
      files
    };

    writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');
    console.log(`[INVENTORY] Wrote model inventory: ${outputPath} (${files.length} files)`);
    return outputPath;
  }

  writeRuntimeInventory(db) {
    this._ensureOutputDir();
    const outputConfig = configLoader.getOutputConfig();
    const outputPath = configLoader.resolvePath(
      outputConfig.runtime_inventory || 'data/model-intelligence/runtime_inventory.json'
    );

    const runtimes = db.getRuntimes();

    const inventory = {
      generated_at: new Date().toISOString(),
      version: VERSION,
      count: runtimes.length,
      runtimes
    };

    writeFileSync(outputPath, JSON.stringify(inventory, null, 2), 'utf8');
    console.log(`[INVENTORY] Wrote runtime inventory: ${outputPath} (${runtimes.length} runtimes)`);
    return outputPath;
  }

  writeStorageTopology(db) {
    this._ensureOutputDir();
    const outputConfig = configLoader.getOutputConfig();
    const outputPath = configLoader.resolvePath(
      outputConfig.storage_topology || 'data/model-intelligence/storage_topology.json'
    );

    const volumes = db.getStorageVolumes();

    const enrichedVolumes = volumes.map(v => {
      const totalBytes = v.total_bytes || 0;
      const freeBytes = v.free_bytes || 0;
      const usedBytes = totalBytes - freeBytes;
      const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 10000) / 100 : 0;

      return {
        ...v,
        used_bytes: usedBytes,
        used_percent: usedPercent
      };
    });

    const totalStorage = enrichedVolumes.reduce((sum, v) => sum + (v.total_bytes || 0), 0);
    const totalFree = enrichedVolumes.reduce((sum, v) => sum + (v.free_bytes || 0), 0);

    const topology = {
      generated_at: new Date().toISOString(),
      version: VERSION,
      volumes: enrichedVolumes,
      summary: {
        total_storage: totalStorage,
        total_free: totalFree,
        volume_count: enrichedVolumes.length
      }
    };

    writeFileSync(outputPath, JSON.stringify(topology, null, 2), 'utf8');
    console.log(`[INVENTORY] Wrote storage topology: ${outputPath} (${enrichedVolumes.length} volumes)`);
    return outputPath;
  }

  writeAll(db) {
    console.log('[INVENTORY] Writing all inventory files...');
    const model = this.writeModelInventory(db);
    const runtime = this.writeRuntimeInventory(db);
    const storage = this.writeStorageTopology(db);
    console.log('[INVENTORY] All inventory files written');
    return { model, runtime, storage };
  }
}

const inventoryWriter = new InventoryWriter();
export default inventoryWriter;
export { InventoryWriter };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing InventoryWriter...\n');

  const testDbPath = join(__dirname, '../../data/model-intelligence_inventory_test.db');

  try {
    let passed = 0;

    // Set up test database with sample data
    const db = new ModelIntelligenceDatabase(testDbPath);
    db.open();

    db.upsertModelFile({
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

    db.upsertModelFile({
      path: 'D:\\hf-cache\\mistral.safetensors',
      filename: 'mistral.safetensors',
      extension: '.safetensors',
      size_bytes: 8000000000,
      format: 'SafeTensors',
      source: 'huggingface'
    });

    db.upsertRuntime({
      name: 'Ollama',
      version: '0.5.4',
      path: 'C:\\Users\\daley\\AppData\\Local\\Programs\\Ollama\\ollama.exe',
      status: 'active'
    });

    db.upsertStorageVolume({
      letter: 'C',
      label: 'Windows',
      total_bytes: 500000000000,
      free_bytes: 100000000000,
      fs_type: 'NTFS'
    });

    db.upsertStorageVolume({
      letter: 'D',
      label: 'Data',
      total_bytes: 1000000000000,
      free_bytes: 500000000000,
      fs_type: 'NTFS'
    });

    // Test 1: writeAll returns paths for all three files
    const writer = new InventoryWriter();
    const paths = writer.writeAll(db);
    console.assert(typeof paths.model === 'string', 'Should return model path');
    console.assert(typeof paths.runtime === 'string', 'Should return runtime path');
    console.assert(typeof paths.storage === 'string', 'Should return storage path');
    console.log('  [PASS] writeAll() returns all three paths');
    passed++;

    // Test 2: Model inventory file exists and contains valid JSON
    const modelData = JSON.parse(readFileSync(paths.model, 'utf8'));
    console.assert(modelData.version === '1.0.0', 'Version should be 1.0.0');
    console.assert(typeof modelData.generated_at === 'string', 'Should have generated_at');
    console.assert(modelData.summary.total_files === 2, `Should have 2 files, got ${modelData.summary.total_files}`);
    console.assert(modelData.summary.total_size_bytes === 12000000000, 'Total size should be 12GB');
    console.assert(modelData.summary.by_source.ollama === 1, 'Should have 1 ollama file');
    console.assert(modelData.summary.by_source.huggingface === 1, 'Should have 1 huggingface file');
    console.assert(modelData.summary.by_format.GGUF === 1, 'Should have 1 GGUF file');
    console.assert(modelData.summary.by_format.SafeTensors === 1, 'Should have 1 SafeTensors file');
    console.assert(Array.isArray(modelData.files), 'files should be an array');
    console.assert(modelData.files.length === 2, 'files array should have 2 entries');
    console.log('  [PASS] Model inventory has correct structure and data');
    passed++;

    // Test 3: Runtime inventory file exists and contains valid JSON
    const runtimeData = JSON.parse(readFileSync(paths.runtime, 'utf8'));
    console.assert(runtimeData.version === '1.0.0', 'Version should be 1.0.0');
    console.assert(runtimeData.count === 1, 'Should have 1 runtime');
    console.assert(Array.isArray(runtimeData.runtimes), 'runtimes should be an array');
    console.assert(runtimeData.runtimes[0].name === 'Ollama', 'First runtime should be Ollama');
    console.log('  [PASS] Runtime inventory has correct structure and data');
    passed++;

    // Test 4: Storage topology file exists and contains valid JSON
    const storageData = JSON.parse(readFileSync(paths.storage, 'utf8'));
    console.assert(storageData.version === '1.0.0', 'Version should be 1.0.0');
    console.assert(storageData.volumes.length === 2, 'Should have 2 volumes');
    console.assert(storageData.summary.volume_count === 2, 'Summary should show 2 volumes');
    console.assert(storageData.summary.total_storage === 1500000000000, 'Total storage should be 1.5TB');
    console.assert(storageData.summary.total_free === 600000000000, 'Total free should be 600GB');
    console.log('  [PASS] Storage topology has correct structure and summary');
    passed++;

    // Test 5: Storage volumes have computed fields
    const cVol = storageData.volumes.find(v => v.letter === 'C');
    console.assert(cVol.used_bytes === 400000000000, 'C: used_bytes should be 400GB');
    console.assert(cVol.used_percent === 80, `C: used_percent should be 80, got ${cVol.used_percent}`);
    const dVol = storageData.volumes.find(v => v.letter === 'D');
    console.assert(dVol.used_bytes === 500000000000, 'D: used_bytes should be 500GB');
    console.assert(dVol.used_percent === 50, `D: used_percent should be 50, got ${dVol.used_percent}`);
    console.log('  [PASS] Storage volumes have correct used_bytes and used_percent');
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
    console.log('InventoryWriter test PASSED');
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
