/**
 * Universal Mesh Client - Provider Chain for 3D Mesh Generation
 *
 * Mirrors the UniversalLLMClient pattern for mesh generation.
 * Routes mesh generation requests through local models (Hunyuan3D, Shap-E)
 * and cloud providers (Meshy.ai, TencentCloud) with budget tracking
 * and automatic fallback.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 5, 2026
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';
import modelBridge from './model-bridge.js';
import modelRouter from '../model-intelligence/model-router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const CONFIG_PATH = join(__dirname, '../../config/mesh-providers.yaml');

class UniversalMeshClient {
  constructor(configOverride = null) {
    if (configOverride) {
      this.config = configOverride;
    } else {
      try {
        const raw = readFileSync(CONFIG_PATH, 'utf8');
        this.config = parseYaml(raw);
      } catch (err) {
        console.warn(`[MESH-CLIENT] Could not load mesh-providers.yaml: ${err.message}`);
        this.config = this._getDefaultConfig();
      }
    }

    this.providers = this.config.providers || {};
    this.taskRouting = this.config.task_routing || {};
    this.budget = this.config.budget || { daily_limit_usd: 5.0 };

    // Daily usage tracking (cloud providers only — local is always free)
    this.dailyUsage = {
      date: new Date().toISOString().split('T')[0],
      cost_usd: 0,
      requests: {},
      generations: 0
    };

    // Cloud client loaded lazily to avoid circular dependency
    this._cloudClient = null;

    console.log(`[MESH-CLIENT] Initialized with ${Object.keys(this.providers).length} providers`);
  }

  // -- Provider chain -------------------------------------------------------

  /**
   * Generate a mesh using the provider chain.
   * Tries providers in priority order based on task routing.
   *
   * @param {Buffer} imageBuffer - Input image data
   * @param {string} filename - Input filename
   * @param {string} jobId - Session/job ID
   * @param {Object} options - { model, task, signal }
   * @returns {Promise<Object>} { glbBuffer, fbxBuffer, metadata, provider, routingLog }
   */
  async generateMesh(imageBuffer, filename, jobId, options = {}) {
    // If a specific model is requested, try it directly
    if (options.model && this.providers[options.model]) {
      return this._callProvider(options.model, imageBuffer, filename, jobId, options);
    }

    const task = options.task || 'default';
    const routing = this.taskRouting[task] || this.taskRouting.default || { prefer: ['hunyuan3d', 'shap-e'] };
    let preferList = [...routing.prefer];

    const errors = [];
    const routingLog = [];
    const endTimer = telemetryBus.startTimer('mesh_generation', { task });

    // Consult model router for smart ordering (non-fatal if unavailable)
    try {
      const recommendation = modelRouter.getBestProvider(task);
      if (recommendation && recommendation.name) {
        // Move recommended provider to front of the list if it's in the chain
        const idx = preferList.indexOf(recommendation.name);
        if (idx > 0) {
          preferList.splice(idx, 1);
          preferList.unshift(recommendation.name);
        }
        routingLog.push({
          provider: recommendation.name,
          status: 'router_recommended',
          score: recommendation.score,
          reason: recommendation.reason
        });
        console.log(`[MESH-CLIENT] Router recommends: ${recommendation.name} (score: ${recommendation.score.toFixed(2)})`);
      }
    } catch (routerErr) {
      console.warn(`[MESH-CLIENT] Router consultation failed (proceeding with default): ${routerErr.message}`);
    }

    // Try preferred providers in order
    for (const providerName of preferList) {
      // Check cancellation
      if (options.signal?.aborted) {
        const cancelError = new Error('Mesh generation cancelled');
        cancelError.routingLog = routingLog;
        throw cancelError;
      }

      if (!this.isProviderAvailable(providerName)) {
        routingLog.push({ provider: providerName, status: 'skipped', reason: 'Not available' });
        errors.push({ provider: providerName, error: 'Not available' });
        continue;
      }

      const budgetCheck = this.checkBudget(providerName);
      if (!budgetCheck.allowed) {
        routingLog.push({ provider: providerName, status: 'skipped', reason: budgetCheck.reason });
        errors.push({ provider: providerName, error: budgetCheck.reason });
        continue;
      }

      try {
        console.log(`[MESH-CLIENT] Trying ${providerName}...`);
        const result = await this._callProvider(providerName, imageBuffer, filename, jobId, options);

        const cost = this.calculateCost(providerName);
        this.trackUsage(providerName, cost);

        routingLog.push({ provider: providerName, status: 'success', cost });
        console.log(`[MESH-CLIENT] Success with ${providerName}, cost: $${cost.toFixed(4)}`);
        endTimer({ provider: providerName, status: 'success', cost });

        return { ...result, provider: providerName, routingLog };

      } catch (error) {
        console.warn(`[MESH-CLIENT] ${providerName} failed: ${error.message}`);
        routingLog.push({ provider: providerName, status: 'failed', error: error.message });
        errorHandler.report('forge3d_error', error, {
          provider: providerName,
          task,
          severity: 'warning'
        });
        endTimer({ provider: providerName, status: 'failed', error: error.message });
        errors.push({ provider: providerName, error: error.message });
        continue;
      }
    }

    // Try fallback provider
    const fallback = routing.fallback;
    if (fallback && this.isProviderAvailable(fallback)) {
      const budgetCheck = this.checkBudget(fallback);
      if (budgetCheck.allowed) {
        try {
          console.log(`[MESH-CLIENT] Trying fallback: ${fallback}...`);
          const result = await this._callProvider(fallback, imageBuffer, filename, jobId, options);

          const cost = this.calculateCost(fallback);
          this.trackUsage(fallback, cost);

          routingLog.push({ provider: fallback, status: 'success', cost, fallback: true });
          console.log(`[MESH-CLIENT] Fallback ${fallback} succeeded, cost: $${cost.toFixed(4)}`);

          return { ...result, provider: fallback, routingLog };

        } catch (error) {
          routingLog.push({ provider: fallback, status: 'failed', error: error.message, fallback: true });
          errors.push({ provider: fallback, error: error.message });
        }
      }
    }

    // All providers failed
    const allErrors = errors.map(e => `${e.provider}: ${e.error}`).join('; ');
    const finalError = new Error(`All mesh providers failed: ${allErrors}`);
    finalError.routingLog = routingLog;
    throw finalError;
  }

  // -- Provider dispatch ----------------------------------------------------

  /**
   * Call a specific provider (local or cloud).
   * @param {string} providerName - Provider to call
   * @param {Buffer} imageBuffer - Input image
   * @param {string} filename - Input filename
   * @param {string} jobId - Session/job ID
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} Generation result
   */
  async _callProvider(providerName, imageBuffer, filename, jobId, options = {}) {
    const provider = this.providers[providerName];
    if (!provider) {
      throw new Error(`Unknown mesh provider: ${providerName}`);
    }

    if (provider.type === 'local') {
      return this._callLocalModel(providerName, imageBuffer, filename, jobId);
    }

    if (provider.type === 'cloud') {
      return this._callCloudModel(providerName, imageBuffer, filename, jobId, options);
    }

    throw new Error(`Unknown provider type: ${provider.type}`);
  }

  /**
   * Call a local model via the Python bridge.
   */
  async _callLocalModel(providerName, imageBuffer, filename, jobId) {
    return modelBridge.generateMesh(imageBuffer, filename, jobId, providerName);
  }

  /**
   * Call a cloud model via the CloudMeshClient.
   */
  async _callCloudModel(providerName, imageBuffer, filename, jobId, options) {
    const client = await this._getCloudClient();
    return client.generate(providerName, imageBuffer, {
      ...options,
      jobId,
      filename,
      providerConfig: this.providers[providerName]
    });
  }

  /**
   * Lazy-load the cloud mesh client.
   */
  async _getCloudClient() {
    if (!this._cloudClient) {
      const { default: cloudMeshClient } = await import('./cloud-mesh-client.js');
      this._cloudClient = cloudMeshClient;
    }
    return this._cloudClient;
  }

  // -- Availability & budget ------------------------------------------------

  /**
   * Check if a provider is available.
   * Local: bridge must be running.
   * Cloud: API key must exist in environment.
   */
  isProviderAvailable(providerName) {
    const provider = this.providers[providerName];
    if (!provider || !provider.enabled) return false;

    if (provider.type === 'local') {
      return modelBridge.state === 'running';
    }

    if (provider.type === 'cloud') {
      const keyEnv = provider.api_key_env;
      return keyEnv ? !!process.env[keyEnv] : false;
    }

    return false;
  }

  /**
   * Check if budget allows a generation with this provider.
   */
  checkBudget(providerName) {
    const provider = this.providers[providerName];
    if (!provider) return { allowed: false, reason: 'Unknown provider' };

    // Local models are always free
    if (provider.cost_per_generation === 0) {
      return { allowed: true };
    }

    // Reset daily tracking if new day
    const today = new Date().toISOString().split('T')[0];
    if (this.dailyUsage.date !== today) {
      this.dailyUsage = {
        date: today,
        cost_usd: 0,
        requests: {},
        generations: 0
      };
    }

    if (this.dailyUsage.cost_usd >= this.budget.daily_limit_usd) {
      return { allowed: false, reason: 'Daily budget exceeded' };
    }

    // Check if this single generation would exceed the budget
    const projectedCost = this.dailyUsage.cost_usd + provider.cost_per_generation;
    if (projectedCost > this.budget.daily_limit_usd) {
      return { allowed: false, reason: 'Would exceed daily budget' };
    }

    return { allowed: true };
  }

  /**
   * Calculate cost for a single generation with this provider.
   */
  calculateCost(providerName) {
    const provider = this.providers[providerName];
    if (!provider) return 0;
    return provider.cost_per_generation || 0;
  }

  /**
   * Track usage after a successful generation.
   */
  trackUsage(providerName, cost) {
    const today = new Date().toISOString().split('T')[0];

    if (this.dailyUsage.date !== today) {
      this.dailyUsage = {
        date: today,
        cost_usd: 0,
        requests: {},
        generations: 0
      };
    }

    this.dailyUsage.cost_usd += cost;
    this.dailyUsage.requests[providerName] = (this.dailyUsage.requests[providerName] || 0) + 1;
    this.dailyUsage.generations += 1;

    // Emit alert if approaching budget threshold
    const alertThreshold = this.budget.alert_threshold_usd || this.budget.daily_limit_usd * 0.5;
    if (this.dailyUsage.cost_usd >= alertThreshold) {
      telemetryBus.emit('mesh_budget_alert', {
        dailyCost: this.dailyUsage.cost_usd,
        limit: this.budget.daily_limit_usd,
        provider: providerName
      });
    }
  }

  // -- Info for frontend ----------------------------------------------------

  /**
   * Get engine info with capability metadata from Python bridge.
   * Used by GET /api/forge3d/engines.
   * @returns {Promise<Array>} Engine info with capabilities
   */
  async getEngineInfo() {
    const engines = [];

    // Get Python adapter info if bridge is running
    if (modelBridge.state === 'running') {
      try {
        const bridgeInfo = await modelBridge.getModels();
        if (bridgeInfo.models) {
          for (const model of bridgeInfo.models) {
            engines.push({
              name: model.name,
              type: 'local',
              model_type: model.model_type,
              textured: model.textured || false,
              capabilities: model.capabilities || [],
              input_types: model.input_types || [],
              output_formats: model.output_formats || [],
              vram_requirement_gb: model.vram_requirement_gb || 0,
              loaded: model.loaded || false,
              enabled: true,
              available: true
            });
          }
        }
      } catch (err) {
        console.warn(`[MESH-CLIENT] Failed to get Python bridge models: ${err.message}`);
      }
    }

    // Add cloud providers from config
    for (const [name, provider] of Object.entries(this.providers)) {
      if (provider.type === 'cloud') {
        engines.push({
          name,
          type: 'cloud',
          model_type: 'mesh',
          textured: provider.textured || false,
          capabilities: provider.capabilities || ['image_to_mesh'],
          input_types: provider.input_types || ['image'],
          output_formats: provider.output_formats || ['glb'],
          vram_requirement_gb: 0,
          loaded: false,
          enabled: provider.enabled || false,
          available: this.isProviderAvailable(name),
          cost_per_generation: provider.cost_per_generation || 0
        });
      }
    }

    return engines;
  }

  /**
   * Get provider info for the frontend (cost estimates, tiers, availability).
   * Used by GET /api/forge3d/providers.
   */
  getProviderInfo() {
    const info = [];

    for (const [name, provider] of Object.entries(this.providers)) {
      info.push({
        name,
        type: provider.type,
        tier: provider.tier || 'free',
        enabled: provider.enabled || false,
        available: this.isProviderAvailable(name),
        cost_per_generation: provider.cost_per_generation || 0,
        avg_generation_time_s: provider.avg_generation_time_s || 0,
        description: provider.description || name,
        vram_required_gb: provider.vram_required_gb || 0
      });
    }

    return info;
  }

  /**
   * Get daily usage summary.
   */
  getUsageSummary() {
    return {
      ...this.dailyUsage,
      budget: this.budget
    };
  }

  // -- Default config -------------------------------------------------------

  _getDefaultConfig() {
    return {
      providers: {
        'hunyuan3d': {
          enabled: true,
          type: 'local',
          priority: 1,
          cost_per_generation: 0,
          vram_required_gb: 12,
          avg_generation_time_s: 300,
          tier: 'default'
        },
        'shap-e': {
          enabled: true,
          type: 'local',
          priority: 2,
          cost_per_generation: 0,
          vram_required_gb: 4,
          avg_generation_time_s: 30,
          tier: 'free'
        }
      },
      task_routing: {
        default: { prefer: ['hunyuan3d', 'shap-e'], fallback: null }
      },
      budget: { daily_limit_usd: 5.0, alert_threshold_usd: 2.5 }
    };
  }
}

// Singleton
const universalMeshClient = new UniversalMeshClient();
export default universalMeshClient;
export { UniversalMeshClient };

// --test block
const __testFile = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] && __testFile.endsWith(process.argv[1].split(/[\\/]/).pop())) {
  console.log('[MESH-CLIENT] Running self-test...');

  const client = new UniversalMeshClient({
    providers: {
      'test-local': {
        enabled: true,
        type: 'local',
        priority: 1,
        cost_per_generation: 0,
        tier: 'free'
      },
      'test-cloud': {
        enabled: true,
        type: 'cloud',
        api_key_env: 'TEST_MESH_KEY',
        priority: 2,
        cost_per_generation: 0.25,
        tier: 'premium'
      },
      'test-disabled': {
        enabled: false,
        type: 'cloud',
        priority: 3,
        cost_per_generation: 0.50,
        tier: 'premium'
      }
    },
    task_routing: {
      default: { prefer: ['test-local', 'test-cloud'], fallback: null }
    },
    budget: { daily_limit_usd: 1.0, alert_threshold_usd: 0.5 }
  });

  // Test provider info
  const info = client.getProviderInfo();
  console.assert(info.length === 3, `Expected 3 providers, got ${info.length}`);
  console.assert(info[0].name === 'test-local', 'First provider should be test-local');
  console.assert(info[0].tier === 'free', 'test-local tier should be free');
  console.assert(info[1].cost_per_generation === 0.25, 'test-cloud cost should be 0.25');

  // Test availability (bridge not running, no API key)
  console.assert(!client.isProviderAvailable('test-local'), 'Local should be unavailable (no bridge)');
  console.assert(!client.isProviderAvailable('test-cloud'), 'Cloud should be unavailable (no API key)');
  console.assert(!client.isProviderAvailable('test-disabled'), 'Disabled should be unavailable');

  // Test budget checks
  const budgetOk = client.checkBudget('test-local');
  console.assert(budgetOk.allowed === true, 'Free provider should always pass budget');

  // Simulate spending
  client.trackUsage('test-cloud', 0.25);
  client.trackUsage('test-cloud', 0.25);
  client.trackUsage('test-cloud', 0.25);
  client.trackUsage('test-cloud', 0.25);
  console.assert(client.dailyUsage.cost_usd === 1.0, `Cost should be 1.0, got ${client.dailyUsage.cost_usd}`);

  const budgetExceeded = client.checkBudget('test-cloud');
  console.assert(budgetExceeded.allowed === false, 'Should exceed daily budget');
  console.assert(budgetExceeded.reason === 'Daily budget exceeded', `Wrong reason: ${budgetExceeded.reason}`);

  // Free providers bypass budget
  const freeCheck = client.checkBudget('test-local');
  console.assert(freeCheck.allowed === true, 'Free provider should bypass budget');

  // Test calculate cost
  console.assert(client.calculateCost('test-local') === 0, 'Local cost should be 0');
  console.assert(client.calculateCost('test-cloud') === 0.25, 'Cloud cost should be 0.25');
  console.assert(client.calculateCost('nonexistent') === 0, 'Unknown provider cost should be 0');

  // Test usage summary
  const summary = client.getUsageSummary();
  console.assert(summary.generations === 4, `Expected 4 generations, got ${summary.generations}`);
  console.assert(summary.requests['test-cloud'] === 4, 'Should have 4 cloud requests');

  // Test daily reset
  client.dailyUsage.date = '2020-01-01';
  const resetCheck = client.checkBudget('test-cloud');
  console.assert(resetCheck.allowed === true, 'Budget should reset on new day');
  console.assert(client.dailyUsage.cost_usd === 0, 'Cost should reset to 0');

  console.log('[MESH-CLIENT] Self-test passed');
  process.exit(0);
}
