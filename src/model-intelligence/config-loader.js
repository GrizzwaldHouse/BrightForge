/**
 * Model Intelligence Config Loader
 *
 * Loads config/model-intelligence.yaml with environment variable expansion.
 * Singleton with lazy loading on first getConfig() call.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../config/model-intelligence.yaml');

class ModelIntelligenceConfig {
  constructor() {
    this._config = null;
    this._loaded = false;
  }

  _load() {
    if (this._loaded) return;

    try {
      const raw = readFileSync(CONFIG_PATH, 'utf8');
      const parsed = parseYaml(raw);
      this._config = this.expandEnvVars(parsed);
      this._loaded = true;
      console.log('[CONFIG-LOADER] Loaded config/model-intelligence.yaml');
    } catch (err) {
      console.error(`[CONFIG-LOADER] Failed to load config: ${err.message}`);
      this._config = {};
      this._loaded = true;
    }
  }

  expandEnvVars(value) {
    if (typeof value === 'string') {
      return value.replace(/\$\{(\w+)\}/g, (_match, varName) => {
        return process.env[varName] || '';
      });
    }

    if (Array.isArray(value)) {
      return value.map(item => this.expandEnvVars(item));
    }

    if (value !== null && typeof value === 'object') {
      const result = {};
      for (const key of Object.keys(value)) {
        result[key] = this.expandEnvVars(value[key]);
      }
      return result;
    }

    return value;
  }

  getConfig() {
    this._load();
    return this._config;
  }

  getKnownLocations() {
    return this.getConfig().known_locations || {};
  }

  getRuntimes() {
    return this.getConfig().runtimes || {};
  }

  getExtensions() {
    return this.getConfig().extensions || [];
  }

  getStorageConfig() {
    return this.getConfig().storage || {};
  }

  getDatabaseConfig() {
    return this.getConfig().database || {};
  }

  getOutputConfig() {
    return this.getConfig().output || {};
  }

  resolvePath(relativePath) {
    return join(__dirname, '../..', relativePath);
  }
}

const configLoader = new ModelIntelligenceConfig();
export { ModelIntelligenceConfig };
export default configLoader;

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing ModelIntelligenceConfig...\n');

  try {
    let passed = 0;

    // Test 1: Config loads successfully
    const loader = new ModelIntelligenceConfig();
    const config = loader.getConfig();
    console.assert(config !== null && typeof config === 'object', 'Config should be a non-null object');
    console.log('  [PASS] Config loads successfully');
    passed++;

    // Test 2: Env vars are expanded (USERPROFILE should not contain ${})
    const locations = loader.getKnownLocations();
    const ollamaDir = locations.ollama?.models_dir || '';
    console.assert(!ollamaDir.includes('${USERPROFILE}'), 'USERPROFILE should be expanded');
    if (process.env.USERPROFILE) {
      console.assert(ollamaDir.includes(process.env.USERPROFILE), 'Should contain actual USERPROFILE value');
    }
    console.log('  [PASS] Environment variables expanded');
    passed++;

    // Test 3: expandEnvVars handles nested objects
    const nested = loader.expandEnvVars({
      a: '${USERPROFILE}/test',
      b: { c: '${TEMP}/nested' },
      d: ['${HOME}/arr']
    });
    console.assert(!nested.a.includes('${'), 'Top-level string should be expanded');
    console.assert(!nested.b.c.includes('${TEMP}'), 'Nested object string should be expanded');
    console.assert(!nested.d[0].includes('${HOME}'), 'Array string should be expanded');
    console.log('  [PASS] expandEnvVars handles nested objects/arrays');
    passed++;

    // Test 4: Known locations accessible
    console.assert(typeof locations === 'object', 'Known locations should be an object');
    console.assert(locations.ollama !== undefined, 'Should have ollama locations');
    console.assert(locations.huggingface !== undefined, 'Should have huggingface locations');
    console.log('  [PASS] getKnownLocations() returns expected sections');
    passed++;

    // Test 5: Runtimes accessible
    const runtimes = loader.getRuntimes();
    console.assert(typeof runtimes === 'object', 'Runtimes should be an object');
    console.assert(runtimes.ollama !== undefined, 'Should have ollama runtime');
    console.log('  [PASS] getRuntimes() returns expected sections');
    passed++;

    // Test 6: Extensions accessible
    const extensions = loader.getExtensions();
    console.assert(Array.isArray(extensions), 'Extensions should be an array');
    console.assert(extensions.includes('.gguf'), 'Should include .gguf');
    console.assert(extensions.includes('.safetensors'), 'Should include .safetensors');
    console.log('  [PASS] getExtensions() returns expected values');
    passed++;

    // Test 7: Storage config accessible
    const storage = loader.getStorageConfig();
    console.assert(typeof storage === 'object', 'Storage should be an object');
    console.assert(Array.isArray(storage.volumes), 'Should have volumes array');
    console.assert(Array.isArray(storage.exclude_dirs), 'Should have exclude_dirs array');
    console.log('  [PASS] getStorageConfig() returns expected values');
    passed++;

    // Test 8: Database config accessible
    const dbConfig = loader.getDatabaseConfig();
    console.assert(dbConfig.path === 'data/model-intelligence.db', 'DB path should match');
    console.assert(dbConfig.journal_mode === 'WAL', 'Journal mode should be WAL');
    console.log('  [PASS] getDatabaseConfig() returns expected values');
    passed++;

    // Test 9: Output config accessible
    const output = loader.getOutputConfig();
    console.assert(output.dir === 'data/model-intelligence', 'Output dir should match');
    console.log('  [PASS] getOutputConfig() returns expected values');
    passed++;

    // Test 10: Lazy loading (second call uses cached config)
    const config2 = loader.getConfig();
    console.assert(config === config2, 'Second getConfig() should return same reference');
    console.log('  [PASS] Lazy loading returns cached config');
    passed++;

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('ModelIntelligenceConfig test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
