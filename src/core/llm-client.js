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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load provider config
const configPath = join(__dirname, '../../config/llm-providers.yaml');

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
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
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
    const providerConfig = this.providers[provider];
    if (!providerConfig?.models) return null;

    // If modelHint matches a model key (code, fast, default, etc.)
    if (modelHint && providerConfig.models[modelHint]) {
      return providerConfig.models[modelHint];
    }

    // If modelHint is an actual model name
    if (modelHint && Object.values(providerConfig.models).includes(modelHint)) {
      return modelHint;
    }

    // Fall back to complexity-based selection
    if (providerConfig.models[complexity]) {
      return providerConfig.models[complexity];
    }

    return providerConfig.models.default || Object.values(providerConfig.models)[0];
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
    const model = this.getModel(providerName, options.modelHint, options.complexity);

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
        signal: options.signal || AbortSignal.timeout(options.timeout || 60000)
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

    const data = await response.json();

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
      content = data.choices?.[0]?.message?.content || '';
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
    const routing = this.taskRouting[task] || { prefer: ['groq', 'ollama'], fallback: null };

    const errors = [];
    const routingLog = [];
    const endTimer = telemetryBus.startTimer('llm_request', { task });

    // Adapt context for target providers
    const adaptedMessages = contextAdapter.adaptContext(messages, routing.prefer[0] || 'groq', options.modelHint);

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

      if (this.isProviderAvailable(fallbackProvider)) {
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

  /**
   * Force a specific provider for "Upgrade this response" feature.
   * @param {Array} messages - Chat messages
   * @param {string} providerName - Provider to use
   * @param {Object} options - Standard chat options
   * @returns {Promise<Object>} { content, provider, model, usage, cost, routingLog }
   */
  async chatWithProvider(messages, providerName, options = {}) {
    if (!this.isProviderAvailable(providerName)) {
      throw new Error(`Provider ${providerName} is not available`);
    }

    const result = await this.callProvider(providerName, messages, options);
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
if (process.argv.includes('--test')) {
  console.log('Testing LLM Client...\n');

  const testClient = new UniversalLLMClient();

  console.log('Available providers:');
  for (const [name, config] of Object.entries(testClient.providers)) {
    const available = testClient.isProviderAvailable(name);
    console.log(`  ${name}: ${available ? 'AVAILABLE' : 'NOT AVAILABLE'} (priority: ${config.priority})`);
  }

  console.log('\nTesting chat...');
  try {
    const result = await testClient.chat([
      { role: 'user', content: 'Say "Hello from Bob!" in exactly 5 words.' }
    ], { task: 'morning_brief' });

    console.log('\nResult:');
    console.log(`  Provider: ${result.provider}`);
    console.log(`  Model: ${result.model}`);
    console.log(`  Content: ${result.content}`);
    console.log(`  Cost: $${result.cost.toFixed(4)}`);
  } catch (error) {
    console.error('Test failed:', error.message);
  }
}
