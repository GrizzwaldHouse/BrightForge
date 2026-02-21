/**
 * DeepSeek API Provider
 *
 * Adapter for DeepSeek chat and reasoning (R1) endpoints.
 * OpenAI-compatible /chat/completions with reasoning_content extraction.
 *
 * Security: No hardcoded credentials. API key from env only.
 * Input validation on all public methods.
 */

import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

const MODELS = {
  chat: 'deepseek-chat',
  reasoner: 'deepseek-reasoner',
  coder: 'deepseek-chat' // DeepSeek V3 handles code well
};

const COST_PER_1M_TOKENS = {
  'deepseek-chat': { input: 0.14, output: 0.28 },
  'deepseek-reasoner': { input: 0.55, output: 2.19 }
};

class DeepSeekProvider {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || DEEPSEEK_BASE_URL;
    this.apiKeyEnv = options.apiKeyEnv || 'DEEPSEEK_API_KEY';
    this.timeout = options.timeout || 120000; // R1 can be slow
    this.maxRetries = options.maxRetries || 3;
    this.usage = { requests: 0, tokens: 0, cost: 0 };
  }

  /**
   * Get API key from environment (never hardcoded)
   */
  getApiKey() {
    const key = process.env[this.apiKeyEnv];
    if (!key) {
      throw new Error(
        `DeepSeek API key not found. Set ${this.apiKeyEnv} in .env.local`
      );
    }
    return key;
  }

  /**
   * Check if the provider is available
   */
  isAvailable() {
    return !!process.env[this.apiKeyEnv];
  }

  /**
   * Validate messages array structure
   */
  validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('messages must be a non-empty array');
    }
    for (const msg of messages) {
      if (!msg.role || typeof msg.role !== 'string') {
        throw new Error('Each message must have a string "role" field');
      }
      if (!msg.content || typeof msg.content !== 'string') {
        throw new Error('Each message must have a string "content" field');
      }
      if (!['system', 'user', 'assistant'].includes(msg.role)) {
        throw new Error(`Invalid message role: ${msg.role}`);
      }
    }
  }

  /**
   * Validate and clamp numeric parameters
   */
  validateParams(params) {
    const validated = {};
    if (params.temperature !== undefined) {
      validated.temperature = Math.max(0, Math.min(2, Number(params.temperature) || 0.7));
    }
    if (params.max_tokens !== undefined) {
      validated.max_tokens = Math.max(1, Math.min(65536, Math.floor(Number(params.max_tokens) || 2048)));
    }
    if (params.top_p !== undefined) {
      validated.top_p = Math.max(0, Math.min(1, Number(params.top_p) || 1));
    }
    return validated;
  }

  /**
   * Calculate cost from usage
   */
  calculateCost(model, usage) {
    const pricing = COST_PER_1M_TOKENS[model];
    if (!pricing) return 0;
    const inputCost = (usage.prompt_tokens / 1_000_000) * pricing.input;
    const outputCost = (usage.completion_tokens / 1_000_000) * pricing.output;
    return inputCost + outputCost;
  }

  /**
   * Make a raw API call with retry logic
   */
  async callApi(endpoint, body, retryCount = 0) {
    const apiKey = this.getApiKey();
    const url = `${this.baseUrl}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`DeepSeek API error (${response.status}): ${errorText}`);
        error.status = response.status;

        // Retry on 429 (rate limit) or 5xx (server error)
        if ((response.status === 429 || response.status >= 500) && retryCount < this.maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          console.warn(`[DEEPSEEK] Retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.callApi(endpoint, body, retryCount + 1);
        }

        throw error;
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'TimeoutError' && retryCount < this.maxRetries) {
        const delay = Math.pow(2, retryCount) * 1000;
        console.warn(`[DEEPSEEK] Timeout, retrying in ${delay}ms (attempt ${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callApi(endpoint, body, retryCount + 1);
      }
      throw error;
    }
  }

  /**
   * Standard chat completion
   */
  async chat(messages, options = {}) {
    this.validateMessages(messages);
    const params = this.validateParams(options);
    const model = options.model || MODELS.chat;
    const endTimer = telemetryBus.startTimer('deepseek_request', { model, type: 'chat' });

    try {
      const data = await this.callApi('/chat/completions', {
        model,
        messages,
        temperature: params.temperature ?? 0.7,
        max_tokens: params.max_tokens || 2048,
        ...(params.top_p !== undefined && { top_p: params.top_p })
      });

      const content = data.choices?.[0]?.message?.content || '';
      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const cost = this.calculateCost(model, usage);

      this.usage.requests++;
      this.usage.tokens += usage.total_tokens;
      this.usage.cost += cost;

      telemetryBus.emit('deepseek', {
        type: 'chat',
        model,
        tokens: usage.total_tokens,
        cost
      });

      endTimer({ status: 'success', tokens: usage.total_tokens, cost });

      return {
        content,
        model: data.model || model,
        provider: 'deepseek',
        usage,
        cost
      };
    } catch (error) {
      endTimer({ status: 'failed', error: error.message });
      errorHandler.report('provider_error', error, { provider: 'deepseek', type: 'chat' });
      throw error;
    }
  }

  /**
   * Reasoning completion via DeepSeek-R1
   * Returns both the reasoning trace and final answer
   */
  async reason(prompt, options = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('prompt must be a non-empty string');
    }

    const params = this.validateParams(options);
    const model = MODELS.reasoner;
    const endTimer = telemetryBus.startTimer('deepseek_request', { model, type: 'reason' });

    const messages = [{ role: 'user', content: prompt }];

    // R1 does not support system messages or temperature
    try {
      const data = await this.callApi('/chat/completions', {
        model,
        messages,
        max_tokens: params.max_tokens || 8192
      });

      const choice = data.choices?.[0]?.message || {};
      const content = choice.content || '';
      const reasoningContent = choice.reasoning_content || '';
      const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const cost = this.calculateCost(model, usage);

      this.usage.requests++;
      this.usage.tokens += usage.total_tokens;
      this.usage.cost += cost;

      // Parse thinking blocks if present
      let thinkingSteps = [];
      if (options.extractThinking !== false && reasoningContent) {
        thinkingSteps = this.parseThinkingSteps(reasoningContent);
      }

      telemetryBus.emit('deepseek', {
        type: 'reason',
        model,
        tokens: usage.total_tokens,
        cost,
        thinkingSteps: thinkingSteps.length
      });

      endTimer({ status: 'success', tokens: usage.total_tokens, cost });

      return {
        content,
        reasoning: reasoningContent,
        thinkingSteps,
        model: data.model || model,
        provider: 'deepseek',
        usage,
        cost
      };
    } catch (error) {
      endTimer({ status: 'failed', error: error.message });
      errorHandler.report('provider_error', error, { provider: 'deepseek', type: 'reason' });
      throw error;
    }
  }

  /**
   * Code-specialized query
   */
  async code(prompt, options = {}) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('prompt must be a non-empty string');
    }

    const language = options.language || 'javascript';
    const task = options.task || 'generate';

    const systemPrompt = this.buildCodeSystemPrompt(language, task);
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt }
    ];

    return this.chat(messages, {
      ...options,
      model: MODELS.coder,
      temperature: task === 'generate' ? 0.3 : 0.5
    });
  }

  /**
   * Multi-step analysis: reason first, then produce actionable output
   */
  async analyze(question, options = {}) {
    if (!question || typeof question !== 'string') {
      throw new Error('question must be a non-empty string');
    }

    const depth = options.depth || 'standard';
    const code = options.code || '';

    // Step 1: Reason about the question
    const reasoningPrompt = code
      ? `Analyze the following code and answer: ${question}\n\n\`\`\`\n${code}\n\`\`\``
      : question;

    const reasoning = await this.reason(reasoningPrompt, {
      max_tokens: depth === 'deep' ? 16384 : depth === 'quick' ? 2048 : 4096
    });

    // Step 2: If deep analysis, feed reasoning into chat for structured output
    if (depth === 'deep' && reasoning.reasoning) {
      const structuredMessages = [
        {
          role: 'system',
          content: 'You are an expert code analyst. Given a reasoning trace and question, produce a structured analysis with: Summary, Key Findings, Recommendations, and Risk Assessment.'
        },
        {
          role: 'user',
          content: `Based on this reasoning:\n\n${reasoning.reasoning}\n\nProvide a structured analysis for: ${question}`
        }
      ];

      const structured = await this.chat(structuredMessages, {
        temperature: 0.3,
        max_tokens: 4096
      });

      return {
        ...structured,
        reasoning: reasoning.reasoning,
        thinkingSteps: reasoning.thinkingSteps,
        depth,
        multiStep: true
      };
    }

    return { ...reasoning, depth, multiStep: false };
  }

  /**
   * Parse R1 reasoning content into structured steps
   */
  parseThinkingSteps(reasoning) {
    if (!reasoning) return [];

    const steps = [];
    const lines = reasoning.split('\n');
    let currentStep = null;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      // Detect numbered steps or section headers
      const numberedMatch = trimmed.match(/^(\d+)\.\s+(.+)/);
      const headerMatch = trimmed.match(/^(?:#{1,3}|[-*])\s+(.+)/);

      if (numberedMatch) {
        if (currentStep) steps.push(currentStep);
        currentStep = { step: parseInt(numberedMatch[1], 10), text: numberedMatch[2], details: [] };
      } else if (headerMatch && !currentStep) {
        currentStep = { step: steps.length + 1, text: headerMatch[1], details: [] };
      } else if (currentStep) {
        currentStep.details.push(trimmed);
      } else {
        steps.push({ step: steps.length + 1, text: trimmed, details: [] });
      }
    }

    if (currentStep) steps.push(currentStep);
    return steps;
  }

  /**
   * Build code system prompt based on language and task
   */
  buildCodeSystemPrompt(language, task) {
    const taskPrompts = {
      generate: `You are an expert ${language} developer. Generate clean, production-ready code. Follow best practices: proper error handling, no hardcoded values, input validation at boundaries.`,
      review: `You are a senior code reviewer specializing in ${language}. Analyze code for: bugs, security vulnerabilities (OWASP Top 10), performance issues, and maintainability. Be specific and actionable.`,
      explain: `You are a ${language} expert teacher. Explain the code clearly, covering: purpose, key logic, edge cases, and potential issues.`,
      fix: `You are a ${language} debugging expert. Identify the bug, explain the root cause, and provide the corrected code with explanation.`
    };

    return taskPrompts[task] || taskPrompts.generate;
  }

  /**
   * Get usage statistics
   */
  getUsageStats() {
    return { ...this.usage };
  }

  /**
   * Health check - verify API connectivity
   */
  async healthCheck() {
    if (!this.isAvailable()) {
      return { healthy: false, reason: 'API key not configured' };
    }

    try {
      const result = await this.chat(
        [{ role: 'user', content: 'ping' }],
        { max_tokens: 5, temperature: 0 }
      );
      return { healthy: true, model: result.model, latencyMs: 0 };
    } catch (error) {
      return { healthy: false, reason: error.message };
    }
  }
}

// Singleton export
const deepseekProvider = new DeepSeekProvider();
export default deepseekProvider;
export { DeepSeekProvider, MODELS, COST_PER_1M_TOKENS };

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing DeepSeek Provider...\n');

  const provider = new DeepSeekProvider();

  // Test 1: Availability check
  console.log('1. Availability check:');
  console.log(`   Available: ${provider.isAvailable()}`);

  // Test 2: Input validation
  console.log('\n2. Input validation:');
  try {
    provider.validateMessages([]);
    console.log('   FAIL: Should reject empty array');
  } catch (e) {
    console.log(`   PASS: Rejects empty array - ${e.message}`);
  }

  try {
    provider.validateMessages([{ role: 'invalid', content: 'test' }]);
    console.log('   FAIL: Should reject invalid role');
  } catch (e) {
    console.log(`   PASS: Rejects invalid role - ${e.message}`);
  }

  try {
    provider.validateMessages([{ role: 'user', content: 'hello' }]);
    console.log('   PASS: Accepts valid message');
  } catch (e) {
    console.log(`   FAIL: ${e.message}`);
  }

  // Test 3: Parameter validation
  console.log('\n3. Parameter validation:');
  const params = provider.validateParams({ temperature: 5, max_tokens: -1, top_p: 2 });
  console.log(`   temperature: ${params.temperature} (clamped from 5 to 2)`);
  console.log(`   max_tokens: ${params.max_tokens} (clamped from -1 to 1)`);
  console.log(`   top_p: ${params.top_p} (clamped from 2 to 1)`);

  // Test 4: Cost calculation
  console.log('\n4. Cost calculation:');
  const cost = provider.calculateCost('deepseek-chat', {
    prompt_tokens: 1000,
    completion_tokens: 500,
    total_tokens: 1500
  });
  console.log(`   1000 input + 500 output tokens: $${cost.toFixed(6)}`);

  // Test 5: Thinking steps parser
  console.log('\n5. Thinking steps parser:');
  const testReasoning = `1. First, analyze the input\n   Check for edge cases\n2. Then process the data\n3. Return the result`;
  const steps = provider.parseThinkingSteps(testReasoning);
  console.log(`   Parsed ${steps.length} steps from reasoning trace`);
  for (const step of steps) {
    console.log(`   Step ${step.step}: ${step.text} (${step.details.length} details)`);
  }

  // Test 6: Code system prompt builder
  console.log('\n6. Code system prompts:');
  for (const task of ['generate', 'review', 'explain', 'fix']) {
    const prompt = provider.buildCodeSystemPrompt('javascript', task);
    console.log(`   ${task}: ${prompt.substring(0, 60)}...`);
  }

  // Test 7: Live API test (if key available)
  if (provider.isAvailable()) {
    console.log('\n7. Live API test:');
    try {
      const result = await provider.chat(
        [{ role: 'user', content: 'Say "DeepSeek MCP test OK" in exactly those words.' }],
        { max_tokens: 20, temperature: 0 }
      );
      console.log(`   Provider: ${result.provider}`);
      console.log(`   Model: ${result.model}`);
      console.log(`   Content: ${result.content}`);
      console.log(`   Cost: $${result.cost.toFixed(6)}`);
    } catch (error) {
      console.log(`   API call failed (expected without valid key): ${error.message}`);
    }
  } else {
    console.log('\n7. Live API test: SKIPPED (no DEEPSEEK_API_KEY)');
  }

  console.log('\nAll DeepSeek Provider tests completed.');
}
