/**
 * Universal LLM Client - OpenAI-Compatible API
 *
 * Supports: Ollama, Groq, Cerebras, Together, Mistral, Gemini, Claude, OpenAI, OpenRouter
 * All providers use the same OpenAI-compatible chat/completions endpoint
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date January 27, 2026
 */

import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import errorHandler from './error-handler.js';
import telemetryBus from './telemetry-bus.js';
import contextAdapter from './context-adapter.js';
import selfHealingOrchestrator from './self-healing-orchestrator.js';
import { isSelfTest } from './is-main-module.js';
import { ModelUnavailableError, toCandidates, findInstalled, roleEnvVar } from './model-resolver.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load provider config
const configPath = join(__dirname, '../../config/llm-providers.yaml');

// How long the list of installed Ollama models is reused before asking again.
// Override per install with providers.ollama.model_cache_ttl_ms.
const DEFAULT_MODEL_CACHE_TTL_MS = 30000;
// Timeout for the lightweight /api/tags probe.
const DEFAULT_OLLAMA_PROBE_TIMEOUT_MS = 2000;
// Chat roles that the global OLLAMA_MODEL override applies to.
const OLLAMA_CHAT_ROLES = ['code', 'fast', 'default'];
// Roles that can always be pinned by environment even if absent from config.
const OLLAMA_PINNABLE_ROLES = [...OLLAMA_CHAT_ROLES, 'embed'];

class UniversalLLMClient {
  constructor(configOverride = null) {
    try {
      const configContent = readFileSync(configPath, 'utf8');
      this.config = parseYaml(configContent);
    } catch (error) {
      console.warn('Could not load config, using defaults:', error.message);
      this.config = configOverride || this.getDefaultConfig();
    }

    this.providers = this.config.providers || {};
    // "provider:role" keys pinned by environment; pinned models are used as given
    this.pinnedModels = new Set();
    this._applyOllamaEnv(process.env);
    this.taskRouting = this.config.task_routing || {};
    this.budget = this.config.budget || { daily_limit_usd: 1.0 };

    // Track daily usage
    this.dailyUsage = {
      date: new Date().toISOString().split('T')[0],
      cost_usd: 0,
      requests: {},
      tokens: {}
    };

    // Cache for provider health (e.g. Ollama availability) to avoid repeated timeouts
    this.healthCache = new Map();
    // Cache for the installed Ollama model list ({ models: string[]|null, timestamp })
    this.ollamaModelCache = null;
  }

  /**
   * Environment overrides for the local Ollama provider, so the endpoint,
   * model and timeout never need code changes:
   *   OLLAMA_BASE_URL   e.g. http://127.0.0.1:11434 (with or without /v1)
   *   OLLAMA_MODEL      model tag used for code/fast/default routing
   *   OLLAMA_MODEL_<ROLE> model tag for one role, e.g. OLLAMA_MODEL_EMBED
   *   OLLAMA_TIMEOUT_MS per-request timeout for Ollama calls
   * @private
   */
  _applyOllamaEnv(env) {
    const ollama = this.providers.ollama;
    if (!ollama) return;
    if (env.OLLAMA_BASE_URL) {
      ollama.base_url = `${env.OLLAMA_BASE_URL.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1`;
    }
    const models = { ...(ollama.models || {}) };
    if (env.OLLAMA_MODEL) {
      for (const role of OLLAMA_CHAT_ROLES) {
        models[role] = env.OLLAMA_MODEL;
        this.pinnedModels.add(`ollama:${role}`);
      }
    }
    for (const role of new Set([...Object.keys(models), ...OLLAMA_PINNABLE_ROLES])) {
      const pinned = env[roleEnvVar(role)];
      if (pinned) {
        models[role] = pinned;
        this.pinnedModels.add(`ollama:${role}`);
      }
    }
    ollama.models = models;
    const timeout = Number.parseInt(env.OLLAMA_TIMEOUT_MS, 10);
    if (Number.isFinite(timeout) && timeout > 0) {
      ollama.timeout_ms = timeout;
    }
  }

  /**
   * Ollama server root (base_url without the OpenAI-compatible /v1 suffix).
   * @returns {string}
   */
  ollamaRootUrl() {
    const base = this.providers.ollama?.base_url || 'http://127.0.0.1:11434/v1';
    return base.replace(/\/+$/, '').replace(/\/v1$/, '');
  }

  /**
   * Ollama health: server reachable, installed models, and which configured
   * candidate for the code role is installed. Never pulls or downloads a model.
   * @param {{ timeoutMs?: number }} [opts]
   * @returns {Promise<{ running: boolean, models: string[], model: string|null, modelAvailable: boolean, candidates: string[], error?: string }>}
   */
  async getOllamaHealth({ timeoutMs = DEFAULT_OLLAMA_PROBE_TIMEOUT_MS } = {}) {
    const candidates = this.getModelCandidates('ollama', this._modelRole('ollama', 'code') || 'code');
    const model = candidates[0] || null;
    try {
      const response = await fetch(`${this.ollamaRootUrl()}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        return { running: false, models: [], model, modelAvailable: false, candidates, error: `HTTP ${response.status}` };
      }
      const data = await response.json();
      const models = Array.isArray(data?.models) ? data.models.map((m) => m.name || m.model).filter(Boolean) : [];
      const installedModel = findInstalled(candidates, models);
      return { running: true, models, model: installedModel || model, modelAvailable: Boolean(installedModel), candidates };
    } catch (err) {
      return { running: false, models: [], model, modelAvailable: false, candidates, error: err.name === 'TimeoutError' ? 'timeout' : err.message };
    }
  }

  getDefaultConfig() {
    return {
      providers: {
        groq: {
          enabled: true,
          base_url: 'https://api.groq.com/openai/v1',
          api_key_env: 'GROQ_API_KEY',
          models: { default: 'llama-3.3-70b-versatile' },
          priority: 2,
          cost_per_1k_tokens: 0
        }
      },
      task_routing: {
        default: { prefer: ['groq'], fallback: null }
      }
    };
  }

  /**
   * Get API key from environment variable
   */
  getApiKey(provider) {
    const providerConfig = this.providers[provider];
    if (!providerConfig) return null;

    if (providerConfig.api_key) return providerConfig.api_key;
    if (providerConfig.api_key_env) {
      return process.env[providerConfig.api_key_env];
    }
    return null;
  }

  /**
   * Check if provider is available (enabled + has API key if needed)
   */
  isProviderAvailable(providerName) {
    const provider = this.providers[providerName];
    if (!provider || !provider.enabled) return false;

    // Ollama doesn't need an API key - availability checked at runtime
    if (providerName === 'ollama') {
      return true; // Optimistic - actual connectivity checked during LLM call
    }

    const apiKey = this.getApiKey(providerName);
    return !!apiKey;
  }

  /**
   * Check if Ollama is running locally
   */
  async checkOllamaRunning() {
    const cacheKey = 'ollama';
    const cached = this.healthCache.get(cacheKey);
    const cacheTTL = 30000; // 30 seconds

    if (cached && (Date.now() - cached.timestamp < cacheTTL)) {
      return cached.status;
    }

    try {
      const response = await fetch(`${this.ollamaRootUrl()}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000)
      });
      const isRunning = response.ok;
      this.healthCache.set(cacheKey, { status: isRunning, timestamp: Date.now() });
      return isRunning;
    } catch {
      this.healthCache.set(cacheKey, { status: false, timestamp: Date.now() });
      return false;
    }
  }

  /**
   * Parse provider:model string
   */
  parseProviderModel(providerSpec) {
    if (providerSpec.includes(':')) {
      const [provider, model] = providerSpec.split(':');
      return { provider, modelHint: model };
    }
    return { provider: providerSpec, modelHint: null };
  }

  /**
   * Get model name for provider
   */
  getModel(provider, modelHint = null, complexity = 'default') {
    const role = this._modelRole(provider, modelHint, complexity);
    if (role === undefined) return null;
    if (role === null) return modelHint; // modelHint is an explicit configured model name
    return this.getModelCandidates(provider, role)[0] || null;
  }

  /**
   * Ordered model candidates configured for a provider role. A role may be a
   * single tag or a list in config/llm-providers.yaml.
   * @param {string} provider
   * @param {string} role
   * @returns {string[]}
   */
  getModelCandidates(provider, role) {
    return toCandidates(this.providers[provider]?.models?.[role]);
  }

  /**
   * Which config role a request maps to.
   * @returns {string|null|undefined} role key; null when modelHint is itself a
   *   configured model name; undefined when the provider has no models
   * @private
   */
  _modelRole(provider, modelHint = null, complexity = 'default') {
    const models = this.providers[provider]?.models;
    if (!models) return undefined;
    const hasRole = (key) => key && toCandidates(models[key]).length > 0;

    if (hasRole(modelHint)) return modelHint;
    if (modelHint && Object.values(models).some((value) => toCandidates(value).includes(modelHint))) return null;
    if (hasRole(complexity)) return complexity;
    if (hasRole('default')) return 'default';
    return Object.keys(models).find(hasRole);
  }

  /**
   * Installed Ollama model tags, cached for model_cache_ttl_ms.
   * @returns {Promise<string[]|null>} null when the server cannot be reached
   */
  async getInstalledOllamaModels({ timeoutMs = DEFAULT_OLLAMA_PROBE_TIMEOUT_MS } = {}) {
    const ttl = this.providers.ollama?.model_cache_ttl_ms ?? DEFAULT_MODEL_CACHE_TTL_MS;
    const cached = this.ollamaModelCache;
    if (cached && Date.now() - cached.timestamp < ttl) return cached.models;

    let models = null;
    try {
      const response = await fetch(`${this.ollamaRootUrl()}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      if (response.ok) {
        const data = await response.json();
        models = Array.isArray(data?.models) ? data.models.map((m) => m.name || m.model).filter(Boolean) : [];
      }
    } catch (_err) {
      models = null;
    }
    this.ollamaModelCache = { models, timestamp: Date.now() };
    return models;
  }

  /** Forget the cached installed-model list (e.g. after pulling a model). */
  invalidateModelCache() {
    this.ollamaModelCache = null;
  }

  /**
   * Model to use for a request. For Ollama, the first configured candidate
   * that is installed wins; environment-pinned models are used as given.
   * @throws {ModelUnavailableError} Ollama is reachable but no candidate is installed
   */
  async resolveModel(provider, modelHint = null, complexity = 'default') {
    const role = this._modelRole(provider, modelHint, complexity);
    if (role === undefined) return null;
    if (role === null) return modelHint;

    const candidates = this.getModelCandidates(provider, role);
    if (provider !== 'ollama' || this.pinnedModels.has(`${provider}:${role}`)) {
      return candidates[0] || null;
    }

    const installed = await this.getInstalledOllamaModels();
    if (installed === null) return candidates[0] || null; // unreachable: the request reports it

    const hit = findInstalled(candidates, installed);
    if (hit) return hit;
    throw new ModelUnavailableError({ provider, role, candidates, installed });
  }

  /**
   * Build headers for API request
   */
  buildHeaders(provider, apiKey) {
    const headers = {
      'Content-Type': 'application/json'
    };

    // Provider-specific auth headers
    if (provider === 'claude') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === 'gemini') {
      // Gemini uses API key in query params, not headers
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    // OpenRouter needs additional headers
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/GrizzwaldHouse/BrightForge';
      headers['X-Title'] = 'BrightForge Coding Agent';
    }

    return headers;
  }

  /**
   * Convert messages to Claude format if needed
   */
  formatMessagesForClaude(messages) {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    return {
      system: systemMessages.map(m => m.content).join('\n\n') || undefined,
      messages: otherMessages
    };
  }

  /**
   * Convert messages to Google Gemini format
   */
  formatMessagesForGemini(messages) {
    const systemMessages = messages.filter(m => m.role === 'system');
    const otherMessages = messages.filter(m => m.role !== 'system');

    return {
      systemInstruction: systemMessages.length > 0
        ? { parts: [{ text: systemMessages.map(m => m.content).join('\n\n') }] }
        : undefined,
      contents: otherMessages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    };
  }

  /**
   * Make API request to provider
   */
  async callProvider(providerName, messages, options = {}) {
    const provider = this.providers[providerName];
    if (!provider) throw new Error(`Unknown provider: ${providerName}`);

    const apiKey = this.getApiKey(providerName);
    const model = await this.resolveModel(providerName, options.modelHint, options.complexity);

    if (!model) throw new Error(`No model available for provider: ${providerName}`);

    const headers = this.buildHeaders(providerName, apiKey);

    let body;
    let endpoint = `${provider.base_url}/chat/completions`;

    // Provider-specific API formats
    if (providerName === 'gemini') {
      const { systemInstruction, contents } = this.formatMessagesForGemini(messages);
      endpoint = `${provider.base_url}/models/${model}:generateContent?key=${apiKey}`;
      body = JSON.stringify({
        systemInstruction,
        contents,
        generationConfig: {
          temperature: options.temperature ?? 0.7,
          maxOutputTokens: options.max_tokens || 2048
        }
      });
    } else if (providerName === 'claude') {
      const { system, messages: claudeMessages } = this.formatMessagesForClaude(messages);
      endpoint = `${provider.base_url}/messages`;
      body = JSON.stringify({
        model,
        max_tokens: options.max_tokens || 2048,
        temperature: options.temperature ?? 0.7,
        system,
        messages: claudeMessages
      });
    } else {
      // OpenAI-compatible format (Groq, Cerebras, Together, Mistral, OpenAI, Ollama, OpenRouter)
      body = JSON.stringify({
        model,
        messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.max_tokens || 2048
      });
    }

    let response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body,
        signal: this._requestSignal(options.signal, options.timeout || provider.timeout_ms || 60000)
      });
    } catch (fetchErr) {
      // Strip any URL (which may contain API key for Gemini) from the error message
      const safeMessage = fetchErr.message.replace(/https?:\/\/[^\s]*/g, '[url-redacted]');
      throw new Error(`${providerName} network error: ${safeMessage}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${providerName} API error (${response.status}): ${errorText}`);
    }

    let data;
    try {
      data = await response.json();
    } catch (_parseErr) {
      throw new Error(`${providerName} returned a malformed response (not JSON)`);
    }

    // Normalize response format
    let content, usage;

    if (providerName === 'gemini') {
      content = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      usage = {
        prompt_tokens: data.usageMetadata?.promptTokenCount || 0,
        completion_tokens: data.usageMetadata?.candidatesTokenCount || 0,
        total_tokens: data.usageMetadata?.totalTokenCount || 0
      };
    } else if (providerName === 'claude') {
      content = data.content?.[0]?.text || '';
      usage = {
        prompt_tokens: data.usage?.input_tokens || 0,
        completion_tokens: data.usage?.output_tokens || 0,
        total_tokens: (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0)
      };
    } else {
      if (!Array.isArray(data?.choices) || typeof data.choices[0]?.message?.content !== 'string') {
        throw new Error(`${providerName} returned a malformed response (no choices[0].message.content)`);
      }
      content = data.choices[0].message.content;
      usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    }

    // Calculate cost
    const cost = this.calculateCost(providerName, model, usage);
    this.trackUsage(providerName, usage, cost);

    return {
      content,
      provider: providerName,
      model: data.model || model,
      usage,
      cost
    };
  }

  /**
   * Combine a caller's AbortSignal with a request timeout (a caller signal
   * must not disable the timeout).
   * @private
   */
  _requestSignal(callerSignal, timeoutMs) {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    if (!callerSignal) return timeoutSignal;
    if (typeof AbortSignal.any === 'function') return AbortSignal.any([callerSignal, timeoutSignal]);
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (callerSignal.aborted || timeoutSignal.aborted) controller.abort();
    callerSignal.addEventListener('abort', abort, { once: true });
    timeoutSignal.addEventListener('abort', abort, { once: true });
    return controller.signal;
  }

  /**
   * Calculate cost for usage
   */
  calculateCost(providerName, model, usage) {
    const provider = this.providers[providerName];
    if (!provider) return 0;

    let costPer1k = provider.cost_per_1k_tokens;

    // Handle per-model costs
    if (typeof costPer1k === 'object') {
      // Find matching model cost
      const modelKey = Object.keys(costPer1k).find(k => model.includes(k));
      costPer1k = modelKey ? costPer1k[modelKey] : 0;
    }

    if (!costPer1k || costPer1k === 0) return 0;

    return (usage.total_tokens / 1000) * costPer1k;
  }

  /**
   * Track usage for budget management
   */
  trackUsage(provider, usage, cost) {
    const today = new Date().toISOString().split('T')[0];

    // Reset if new day
    if (this.dailyUsage.date !== today) {
      this.dailyUsage = {
        date: today,
        cost_usd: 0,
        requests: {},
        tokens: {}
      };
    }

    this.dailyUsage.cost_usd += cost;
    this.dailyUsage.requests[provider] = (this.dailyUsage.requests[provider] || 0) + 1;
    this.dailyUsage.tokens[provider] = (this.dailyUsage.tokens[provider] || 0) + usage.total_tokens;
    this.dailyUsage.costs = this.dailyUsage.costs || {};
    this.dailyUsage.costs[provider] = (this.dailyUsage.costs[provider] || 0) + cost;
  }

  /**
   * Check if budget allows request
   */
  checkBudget(providerName) {
    if (this.dailyUsage.cost_usd >= this.budget.daily_limit_usd) {
      return { allowed: false, reason: 'Daily budget exceeded' };
    }

    const providerBudget = this.budget.per_provider?.[providerName];
    if (providerBudget) {
      const providerCost = this.dailyUsage.costs?.[providerName] || 0;
      if (providerBudget.max_cost_usd && providerCost >= providerBudget.max_cost_usd) {
        return { allowed: false, reason: `${providerName} budget exceeded` };
      }
    }

    return { allowed: true };
  }

  /**
   * Main chat method - tries providers in priority order.
   * Supports AbortSignal for cancellation, routing callbacks, and returns routingLog.
   * @param {Array} messages - Chat messages
   * @param {Object} options - { task, signal, onProviderTrying, onProviderFailed, ... }
   * @returns {Promise<Object>} { content, provider, model, usage, cost, routingLog }
   */
  async chat(messages, options = {}) {
    const task = options.task || 'default';

    // Explicit provider (e.g. /api/chat/upgrade): no routing, no fallback
    if (options.forceProvider) {
      return this.chatWithProvider(messages, options.forceProvider, options);
    }

    const routing = this.taskRouting[task] || { prefer: ['groq', 'ollama'], fallback: null };

    // Adapt context for target providers (outside healing scope — pure transform, no I/O)
    const adaptedMessages = contextAdapter.adaptContext(messages, routing.prefer[0] || 'groq', options.modelHint);

    const healingResult = await selfHealingOrchestrator.execute({
      name: 'llm_chat',
      correlationId: options.correlationId,
      context: { task: options.task },
      operation: async () => {
        const errors = [];
        const routingLog = [];
        const endTimer = telemetryBus.startTimer('llm_request', { task });

        // Try preferred providers in order
        for (const providerSpec of routing.prefer) {
          const { provider, modelHint } = this.parseProviderModel(providerSpec);

          // Check if cancelled before trying next provider
          if (options.signal?.aborted) {
            const cancelError = new Error('Request cancelled');
            cancelError.routingLog = routingLog;
            throw cancelError;
          }

          if (!this.isProviderAvailable(provider)) {
            routingLog.push({ provider, status: 'skipped', reason: 'Not available' });
            errors.push({ provider, error: 'Not available' });
            continue;
          }

          const budgetCheck = this.checkBudget(provider);
          if (!budgetCheck.allowed) {
            routingLog.push({ provider, status: 'skipped', reason: budgetCheck.reason });
            errors.push({ provider, error: budgetCheck.reason });
            continue;
          }

          try {
            const model = this.getModel(provider, modelHint, options.complexity);
            console.log(`[LLM] Trying ${provider}${modelHint ? ':' + modelHint : ''}...`);

            if (options.onProviderTrying) {
              options.onProviderTrying(provider, model);
            }

            const result = await this.callProvider(provider, adaptedMessages, {
              ...options,
              modelHint,
              max_tokens: routing.max_tokens || options.max_tokens
            });

            routingLog.push({ provider, model: result.model, status: 'success', cost: result.cost });
            console.log(`[LLM] Success with ${provider} (${result.model}), cost: $${result.cost.toFixed(4)}`);
            endTimer({ provider, status: 'success', tokens: result.usage?.total_tokens || 0, cost: result.cost });
            return { ...result, routingLog };

          } catch (error) {
            console.warn(`[LLM] ${provider} failed: ${error.message}`);
            routingLog.push({ provider, status: 'failed', error: error.message });

            if (options.onProviderFailed) {
              options.onProviderFailed(provider, error);
            }

            errorHandler.report('provider_error', error, { provider, task, severity: 'warning' });
            endTimer({ provider, status: 'failed', error: error.message });
            errors.push({ provider, error: error.message });
            continue;
          }
        }

        // Try fallback if all preferred failed
        if (routing.fallback) {
          const { provider: fallbackProvider, modelHint } = this.parseProviderModel(routing.fallback);

          const fallbackBudget = this.checkBudget(fallbackProvider);
          if (!fallbackBudget.allowed) {
            routingLog.push({ provider: fallbackProvider, status: 'skipped', reason: fallbackBudget.reason, fallback: true });
            errors.push({ provider: fallbackProvider, error: fallbackBudget.reason });
          } else if (this.isProviderAvailable(fallbackProvider)) {
            try {
              const model = this.getModel(fallbackProvider, modelHint, options.complexity);
              console.log(`[LLM] Trying fallback: ${routing.fallback}...`);

              if (options.onProviderTrying) {
                options.onProviderTrying(fallbackProvider, model);
              }

              const result = await this.callProvider(fallbackProvider, adaptedMessages, {
                ...options,
                modelHint,
                max_tokens: routing.max_tokens || options.max_tokens
              });

              routingLog.push({ provider: fallbackProvider, model: result.model, status: 'success', cost: result.cost, fallback: true });
              return { ...result, routingLog };

            } catch (error) {
              routingLog.push({ provider: fallbackProvider, status: 'failed', error: error.message, fallback: true });

              if (options.onProviderFailed) {
                options.onProviderFailed(fallbackProvider, error);
              }

              errors.push({ provider: fallbackProvider, error: error.message });
            }
          }
        }

        // All providers failed
        const allFailedError = new Error(`All LLM providers failed:\n${errors.map(e => `  - ${e.provider}: ${e.error}`).join('\n')}`);
        allFailedError.routingLog = routingLog;
        errorHandler.report('provider_error', allFailedError, { task, allProvidersFailed: true, providers: errors });
        throw allFailedError;
      }
    });

    if (!healingResult.success) {
      const err = new Error(healingResult.failure.reason);
      err.failure = healingResult.failure;
      err.routingLog = [];
      throw err;
    }

    return healingResult.result;
  }

  /**
   * Force a specific provider for "Upgrade this response" feature.
   * @param {Array} messages - Chat messages
   * @param {string} providerName - Provider to use
   * @param {Object} options - Standard chat options
   * @returns {Promise<Object>} { content, provider, model, usage, cost, routingLog }
   */
  async chatWithProvider(messages, providerName, options = {}) {
    if (!this.providers[providerName]) {
      throw new Error(`Unknown provider: ${providerName}`);
    }
    if (!this.isProviderAvailable(providerName)) {
      throw new Error(`Provider ${providerName} is not available`);
    }
    const budgetCheck = this.checkBudget(providerName);
    if (!budgetCheck.allowed) {
      const err = new Error(budgetCheck.reason);
      err.code = 'BUDGET_EXCEEDED';
      throw err;
    }

    const { forceProvider: _forced, ...callOptions } = options;
    const result = await this.callProvider(providerName, messages, callOptions);
    const routingLog = [{ provider: providerName, model: result.model, status: 'success', cost: result.cost, forced: true }];
    return { ...result, routingLog };
  }

  /**
   * Get daily usage summary
   */
  getUsageSummary() {
    return {
      ...this.dailyUsage,
      budget_remaining: this.budget.daily_limit_usd - this.dailyUsage.cost_usd
    };
  }
}

// Export singleton instance
const client = new UniversalLLMClient();
export default client;
export { UniversalLLMClient };

// CLI test
if (isSelfTest(import.meta.url)) {
  // Deterministic contract tests (fake provider server; no keys, no network).
  // OLLAMA_LIVE=1 adds an opt-in check against a real local Ollama.
  const { runProviderContractTests } = await import('../tests/llm-provider-contract.js');
  const ok = await runProviderContractTests({ Client: UniversalLLMClient });
  process.exit(ok ? 0 : 1);
}
