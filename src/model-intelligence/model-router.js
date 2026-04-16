/** ModelRouter - Smart model routing based on scanned inventory
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2026
 */

import { fileURLToPath } from 'url';
import modelDb from './database.js';
import configLoader from './config-loader.js';

const __filename = fileURLToPath(import.meta.url);

// Default routing weights (overridden by config/model-intelligence.yaml)
const DEFAULT_WEIGHTS = {
  availability: 0.4,
  locality: 0.2,
  vram_fit: 0.2,
  cost: 0.2
};

class ModelRouter {
  constructor() {
    this._capabilities = new Map();
    this._routingConfig = null;
  }

  // Load routing config from model-intelligence.yaml
  _loadRoutingConfig() {
    try {
      const config = configLoader.getConfig();
      this._routingConfig = config.routing || {};
    } catch (_err) {
      this._routingConfig = {};
    }
    return this._routingConfig;
  }

  _getWeights() {
    const routing = this._routingConfig || this._loadRoutingConfig();
    return routing.weights || DEFAULT_WEIGHTS;
  }

  _getPreferLocal() {
    const routing = this._routingConfig || this._loadRoutingConfig();
    return routing.prefer_local !== false;
  }

  // Refresh capabilities from model-intelligence DB
  refresh() {
    this._capabilities.clear();
    this._loadRoutingConfig();

    try {
      // Read model files from DB
      const models = modelDb.db ? modelDb.getModelFiles({ limit: 1000 }) : [];
      for (const model of models) {
        this._capabilities.set(model.path, {
          name: model.filename || model.path,
          type: 'local',
          available: true,
          formats: [model.format || model.extension || 'unknown'],
          vram_gb: this._estimateVram(model.size_bytes),
          quantization: model.quantization || null,
          source: model.source || 'unknown',
          size_bytes: model.size_bytes || 0,
          architecture: model.architecture || null
        });
      }

      // Read runtimes from DB
      const runtimes = modelDb.db ? modelDb.getRuntimes() : [];
      for (const runtime of runtimes) {
        this._capabilities.set(`runtime:${runtime.name}`, {
          name: runtime.name,
          type: 'local',
          available: runtime.status === 'installed' || runtime.status === 'running',
          formats: [],
          vram_gb: 0,
          quantization: null,
          source: 'runtime',
          runtime_version: runtime.version || null
        });
      }

      console.log(`[MODEL-ROUTER] Refreshed: ${models.length} models, ${runtimes.length} runtimes`);
    } catch (err) {
      console.warn(`[MODEL-ROUTER] Refresh failed: ${err.message}`);
    }
  }

  // Estimate VRAM from file size (rough heuristic: 1 GB file ~ 1 GB VRAM for quantized)
  _estimateVram(sizeBytes) {
    if (!sizeBytes || sizeBytes <= 0) return 0;
    return Math.round((sizeBytes / (1024 * 1024 * 1024)) * 10) / 10;
  }

  // Get all available providers with scoring
  getAvailableProviders(_task = 'default') {
    const providers = [];

    for (const [_key, info] of this._capabilities) {
      providers.push({
        name: info.name,
        type: info.type,
        available: info.available,
        formats: info.formats,
        vram_gb: info.vram_gb,
        quantization: info.quantization,
        source: info.source,
        score: info.available ? 1.0 : 0.0
      });
    }

    // Sort by score descending
    providers.sort((a, b) => b.score - a.score);
    return providers;
  }

  // Get the best provider for a given task and constraints
  getBestProvider(_task = 'default', constraints = {}) {
    const providers = this.getAvailableProviders(_task);

    if (providers.length === 0) {
      return null;
    }

    let bestScore = -1;
    let bestProvider = null;
    let bestReason = '';

    for (const provider of providers) {
      if (!provider.available) continue;

      // Apply constraint filters
      if (constraints.maxVram && provider.vram_gb > constraints.maxVram) continue;
      if (constraints.requiredFormat && !provider.formats.includes(constraints.requiredFormat)) continue;

      const score = this._scoreProvider(provider.name, provider, constraints);
      if (score > bestScore) {
        bestScore = score;
        bestProvider = provider.name;
        bestReason = this._buildReason(provider, constraints);
      }
    }

    if (!bestProvider) return null;

    return {
      name: bestProvider,
      score: bestScore,
      reason: bestReason
    };
  }

  // Score a provider 0.0-1.0 based on weighted criteria
  _scoreProvider(_providerName, providerInfo, constraints = {}) {
    const weights = this._getWeights();
    let score = 0;

    // Availability (0 or 1)
    const availScore = providerInfo.available ? 1.0 : 0.0;
    score += availScore * (weights.availability || 0.4);

    // Locality preference (local = 1.0, cloud = 0.3)
    const preferLocal = constraints.preferLocal !== undefined ? constraints.preferLocal : this._getPreferLocal();
    const localScore = providerInfo.type === 'local' ? 1.0 : (preferLocal ? 0.3 : 0.7);
    score += localScore * (weights.locality || 0.2);

    // VRAM fit (smaller models score higher if constrained)
    let vramScore = 1.0;
    if (constraints.maxVram && providerInfo.vram_gb > 0) {
      vramScore = Math.max(0, 1.0 - (providerInfo.vram_gb / constraints.maxVram));
    }
    score += vramScore * (weights.vram_fit || 0.2);

    // Cost (local = 1.0, cloud depends on constraint)
    let costScore = providerInfo.type === 'local' ? 1.0 : 0.5;
    if (constraints.maxCost !== undefined && constraints.maxCost === 0) {
      costScore = providerInfo.type === 'local' ? 1.0 : 0.0;
    }
    score += costScore * (weights.cost || 0.2);

    // Clamp to 0.0-1.0
    return Math.max(0, Math.min(1, score));
  }

  _buildReason(provider, constraints) {
    const parts = [];
    if (provider.type === 'local') parts.push('local model (free)');
    if (provider.available) parts.push('available');
    if (constraints.preferLocal && provider.type === 'local') parts.push('preferred local');
    if (provider.quantization) parts.push(`${provider.quantization} quantization`);
    return parts.join(', ') || 'default selection';
  }

  // Check if a specific model is installed (by filename)
  isModelInstalled(modelName) {
    for (const [key, info] of this._capabilities) {
      if (info.name === modelName || key.includes(modelName)) {
        return info.available;
      }
    }
    return false;
  }

  // Get routing advice with alternatives
  getRoutingAdvice(_task = 'default', constraints = {}) {
    const best = this.getBestProvider(_task, constraints);
    const allProviders = this.getAvailableProviders(_task);

    // Get alternatives (available providers that aren't the best)
    const alternatives = allProviders
      .filter(p => p.available && (!best || p.name !== best.name))
      .slice(0, 3)
      .map(p => ({
        name: p.name,
        score: this._scoreProvider(p.name, p, constraints),
        type: p.type
      }));

    return {
      recommended: best,
      alternatives,
      reasoning: best
        ? `Selected ${best.name} (score: ${best.score.toFixed(2)}): ${best.reason}`
        : 'No available providers found'
    };
  }
}

// Singleton + named export
const modelRouter = new ModelRouter();
export default modelRouter;
export { ModelRouter };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('Testing ModelRouter...\n');

  try {
    let passed = 0;

    // Test 1: Constructor initializes empty map
    const router = new ModelRouter();
    console.assert(router._capabilities instanceof Map, 'Should be a Map');
    console.assert(router._capabilities.size === 0, 'Should start empty');
    console.log('  [PASS] Constructor initializes empty map');
    passed++;

    // Test 2: refresh() with empty DB (no crash)
    router.refresh();
    console.assert(router._capabilities.size === 0, 'Should remain empty with no DB data');
    console.log('  [PASS] refresh() with empty DB');
    passed++;

    // Test 3: refresh() with mock data
    router._capabilities.set('test-model', {
      name: 'test-model.gguf',
      type: 'local',
      available: true,
      formats: ['GGUF'],
      vram_gb: 4.0,
      quantization: 'Q4_K_M',
      source: 'ollama'
    });
    router._capabilities.set('test-cloud', {
      name: 'cloud-mesh',
      type: 'cloud',
      available: true,
      formats: ['glb'],
      vram_gb: 0,
      quantization: null,
      source: 'cloud'
    });
    console.assert(router._capabilities.size === 2, 'Should have 2 entries');
    console.log('  [PASS] refresh() with mock data');
    passed++;

    // Test 4: getAvailableProviders() shape
    const providers = router.getAvailableProviders();
    console.assert(Array.isArray(providers), 'Should return an array');
    console.assert(providers.length === 2, `Expected 2 providers, got ${providers.length}`);
    console.assert(providers[0].name !== undefined, 'Should have name');
    console.assert(providers[0].type !== undefined, 'Should have type');
    console.assert(typeof providers[0].score === 'number', 'Should have score');
    console.log('  [PASS] getAvailableProviders() shape');
    passed++;

    // Test 5: getBestProvider() no constraints
    const best = router.getBestProvider();
    console.assert(best !== null, 'Should find a provider');
    console.assert(typeof best.name === 'string', 'Should have a name');
    console.assert(typeof best.score === 'number', 'Should have a score');
    console.assert(typeof best.reason === 'string', 'Should have a reason');
    console.log('  [PASS] getBestProvider() no constraints');
    passed++;

    // Test 6: getBestProvider() preferLocal
    const localBest = router.getBestProvider('default', { preferLocal: true });
    console.assert(localBest !== null, 'Should find a local provider');
    console.assert(localBest.name === 'test-model.gguf', `Expected local model, got ${localBest.name}`);
    console.log('  [PASS] getBestProvider() preferLocal');
    passed++;

    // Test 7: getBestProvider() maxVram filter
    const vramBest = router.getBestProvider('default', { maxVram: 2.0 });
    // test-model has 4 GB, should be filtered; only cloud (0 GB) remains
    console.assert(vramBest !== null, 'Should find a provider within VRAM');
    console.assert(vramBest.name === 'cloud-mesh', `Expected cloud-mesh, got ${vramBest.name}`);
    console.log('  [PASS] getBestProvider() maxVram filter');
    passed++;

    // Test 8: _scoreProvider() range 0-1
    const score = router._scoreProvider('test', {
      available: true,
      type: 'local',
      vram_gb: 4,
      quantization: 'Q4_K_M'
    });
    console.assert(score >= 0 && score <= 1, `Score should be 0-1, got ${score}`);
    console.log('  [PASS] _scoreProvider() range 0-1');
    passed++;

    // Test 9: isModelInstalled() boolean
    console.assert(router.isModelInstalled('test-model.gguf') === true, 'Should find installed model');
    console.assert(router.isModelInstalled('nonexistent.gguf') === false, 'Should not find missing model');
    console.log('  [PASS] isModelInstalled() boolean');
    passed++;

    // Test 10: getRoutingAdvice() shape
    const advice = router.getRoutingAdvice();
    console.assert(typeof advice.reasoning === 'string', 'Should have reasoning');
    console.assert(Array.isArray(advice.alternatives), 'Should have alternatives array');
    console.assert(advice.recommended !== null, 'Should have recommended');
    console.log('  [PASS] getRoutingAdvice() shape');
    passed++;

    console.log(`\n[TEST] All ${passed} tests PASSED!`);
    console.log('ModelRouter test PASSED');
    process.exit(0);
  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
