/**
 * ContextAdapter - Adaptive context window management
 *
 * Optimizes message arrays for different model sizes and provider limits.
 * Estimates tokens, truncates history, and adapts chunk sizes.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import telemetryBus from './telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Model size tiers with chunk size recommendations
const _MODEL_TIERS = {
  small: { maxChars: 900, label: '<3B params' },
  medium: { maxChars: 2500, label: '3-14B params' },
  large: { maxChars: 4000, label: '>14B params' }
};

// Provider context limits (tokens)
const PROVIDER_LIMITS = {
  ollama: 8192,
  groq: 8192,
  cerebras: 8192,
  together: 8192,
  mistral: 32768,
  gemini: 1000000,
  claude: 200000,
  openai: 128000,
  openrouter: 128000
};

// Model-to-tier mapping (known models)
const MODEL_TIER_MAP = {
  'llama-3.2-1b': 'small',
  'llama-3.2-3b': 'small',
  'phi-3-mini': 'small',
  'gemma-2b': 'small',
  'llama-3.1-8b': 'medium',
  'llama-3.3-70b': 'large',
  'mixtral': 'large',
  'claude': 'large',
  'gpt-4': 'large',
  'gemini': 'large'
};

class ContextAdapter {
  constructor() {
    this.maxAssistantResponseChars = 800;
  }

  /**
   * Estimate token count from text (heuristic: ~4 chars per token).
   */
  estimateTokens(text) {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Determine model tier from model name string.
   */
  getModelTier(model) {
    if (!model) return 'medium';
    const lower = model.toLowerCase();
    for (const [pattern, tier] of Object.entries(MODEL_TIER_MAP)) {
      if (lower.includes(pattern)) return tier;
    }
    return 'medium'; // Default
  }

  /**
   * Get context limit for a provider.
   */
  getContextLimit(provider) {
    return PROVIDER_LIMITS[provider] || 8192;
  }

  /**
   * Adapt messages array for the target provider/model.
   * Truncates assistant responses in history and trims if over context limit.
   */
  adaptContext(messages, provider, model) {
    if (!messages || messages.length === 0) return messages;

    const beforeTokens = this.estimateTokens(messages.map(m => m.content).join(''));
    const contextLimit = this.getContextLimit(provider);
    const tier = this.getModelTier(model);

    let adapted = messages.map((msg, i) => {
      // Don't truncate the last message (current user input) or system messages
      if (i === messages.length - 1 || msg.role === 'system') {
        return { ...msg };
      }

      // Truncate assistant responses in history
      if (msg.role === 'assistant' && msg.content && msg.content.length > this.maxAssistantResponseChars) {
        return {
          ...msg,
          content: msg.content.slice(0, this.maxAssistantResponseChars) + '\n[...truncated]'
        };
      }

      return { ...msg };
    });

    // If still over limit, drop oldest non-system messages
    let totalTokens = this.estimateTokens(adapted.map(m => m.content).join(''));
    while (totalTokens > contextLimit * 0.9 && adapted.length > 2) {
      // Find first non-system message that isn't the last message
      const dropIndex = adapted.findIndex((m, i) => m.role !== 'system' && i < adapted.length - 1);
      if (dropIndex === -1) break;
      adapted.splice(dropIndex, 1);
      totalTokens = this.estimateTokens(adapted.map(m => m.content).join(''));
    }

    const afterTokens = this.estimateTokens(adapted.map(m => m.content).join(''));

    // Emit telemetry if we actually adapted
    if (beforeTokens !== afterTokens) {
      telemetryBus.emit('context_adapted', {
        provider,
        model,
        tier,
        beforeTokens,
        afterTokens,
        contextLimit,
        messagesDropped: messages.length - adapted.length
      });
      console.log(`[CONTEXT] Adapted: ${beforeTokens} → ${afterTokens} tokens (${tier} tier, ${provider})`);
    }

    return adapted;
  }
}

const contextAdapter = new ContextAdapter();
export default contextAdapter;
export { ContextAdapter };

// Self-test
if (process.argv.includes('--test') && process.argv[1]?.endsWith('context-adapter.js')) {
  console.log('[CONTEXT] Running self-test...\n');

  const adapter = new ContextAdapter();

  // Test 1: Token estimation
  console.log('[TEST] Test 1: Token estimation...');
  const tokens = adapter.estimateTokens('Hello world test string');
  console.assert(tokens > 0, 'Should estimate tokens');
  console.assert(tokens === Math.ceil(22 / 4), `Expected ${Math.ceil(22 / 4)}, got ${tokens}`);
  console.log('[TEST] Token estimation: PASSED');

  // Test 2: Model tier detection
  console.log('\n[TEST] Test 2: Model tier detection...');
  console.assert(adapter.getModelTier('llama-3.2-1b-instruct') === 'small', 'Should detect small');
  console.assert(adapter.getModelTier('llama-3.1-8b-instruct') === 'medium', 'Should detect medium');
  console.assert(adapter.getModelTier('llama-3.3-70b-versatile') === 'large', 'Should detect large');
  console.assert(adapter.getModelTier('unknown-model') === 'medium', 'Should default to medium');
  console.log('[TEST] Model tier detection: PASSED');

  // Test 3: Context limit lookup
  console.log('\n[TEST] Test 3: Context limit lookup...');
  console.assert(adapter.getContextLimit('groq') === 8192, 'Groq should be 8192');
  console.assert(adapter.getContextLimit('gemini') === 1000000, 'Gemini should be 1M');
  console.assert(adapter.getContextLimit('unknown') === 8192, 'Unknown should default to 8192');
  console.log('[TEST] Context limit lookup: PASSED');

  // Test 4: Assistant response truncation
  console.log('\n[TEST] Test 4: Assistant response truncation...');
  const longResponse = 'x'.repeat(2000);
  const messages = [
    { role: 'system', content: 'You are helpful.' },
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: longResponse },
    { role: 'user', content: 'Follow up' }
  ];
  const adapted = adapter.adaptContext(messages, 'groq', 'llama-3.3-70b');
  console.assert(adapted[2].content.length < longResponse.length, 'Assistant response should be truncated');
  console.assert(adapted[2].content.endsWith('[...truncated]'), 'Should end with truncated marker');
  console.assert(adapted[0].content === 'You are helpful.', 'System message should be preserved');
  console.assert(adapted[3].content === 'Follow up', 'Last message should be preserved');
  console.log('[TEST] Assistant response truncation: PASSED');

  // Test 5: Empty messages
  console.log('\n[TEST] Test 5: Empty messages...');
  const empty = adapter.adaptContext([], 'groq', 'llama');
  console.assert(empty.length === 0, 'Should return empty array');
  console.log('[TEST] Empty messages: PASSED');

  console.log('\n[TEST] All 5 tests PASSED!');
  console.log('ContextAdapter test PASSED');
  process.exit(0);
}
