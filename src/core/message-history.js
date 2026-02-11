/**
 * Message History - Conversation Context Management
 *
 * Manages conversation history for multi-turn dialogues with token budget constraints.
 * Stores user/assistant turns with metadata and provides formatted context strings.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MessageHistory {
  /**
   * Create a new message history manager.
   * @param {Object} options - Configuration options
   * @param {number} options.maxTurns - Maximum number of turns to keep (default: 20)
   * @param {number} options.maxTokens - Maximum token budget for context (default: 6000)
   */
  constructor(options = {}) {
    this.maxTurns = options.maxTurns || 20;
    this.maxTokens = options.maxTokens || 6000;
    this.turns = [];
  }

  /**
   * Estimate token count for text (rough approximation: 1 token ~ 4 chars)
   * @param {string} text - Text to estimate
   * @returns {number} Estimated token count
   */
  estimateTokens(text) {
    if (!text || typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
  }

  /**
   * Add a user turn to the history.
   * @param {string} content - User message content
   * @returns {Object} The created turn object
   */
  addUser(content) {
    const turn = {
      role: 'user',
      content,
      timestamp: new Date().toISOString()
    };

    this.turns.push(turn);
    console.log(`[HISTORY] Added user turn (${this.turns.length} total)`);

    return turn;
  }

  /**
   * Add an assistant turn to the history.
   * @param {string} content - Assistant message content
   * @param {Object} meta - Optional metadata (planId, provider, model, cost, operationCount)
   * @returns {Object} The created turn object
   */
  addAssistant(content, meta = {}) {
    const turn = {
      role: 'assistant',
      content,
      meta: {
        planId: meta.planId || null,
        provider: meta.provider || null,
        model: meta.model || null,
        cost: meta.cost || 0,
        operationCount: meta.operationCount || 0
      },
      timestamp: new Date().toISOString()
    };

    this.turns.push(turn);
    console.log(`[HISTORY] Added assistant turn (${this.turns.length} total)`);

    return turn;
  }

  /**
   * Get messages formatted for LLM consumption, trimmed to token budget.
   * Returns only {role, content} - no system prompt (that's BaseAgent's job).
   * @returns {Array<Object>} Array of {role, content} messages
   */
  getMessages() {
    if (this.turns.length === 0) return [];

    // Start with all turns
    let messages = this.turns.map(turn => ({
      role: turn.role,
      content: turn.content
    }));

    // Calculate total tokens
    let totalTokens = messages.reduce((sum, msg) => {
      return sum + this.estimateTokens(msg.content);
    }, 0);

    // If under budget, return all
    if (totalTokens <= this.maxTokens) {
      return messages;
    }

    // Trim oldest turns, but keep at minimum the last 2 turns (1 user + 1 assistant pair)
    const minTurns = 2;
    while (messages.length > minTurns && totalTokens > this.maxTokens) {
      const removed = messages.shift();
      totalTokens -= this.estimateTokens(removed.content);
    }

    console.log(`[HISTORY] Trimmed to ${messages.length} messages (${totalTokens} tokens)`);
    return messages;
  }

  /**
   * Get conversation context as a formatted string for injection into user messages.
   * @returns {string} Formatted conversation context
   */
  toContextString() {
    if (this.turns.length === 0) return '';

    const lines = ['Previous conversation:'];

    for (const turn of this.turns) {
      const roleLabel = turn.role === 'user' ? 'User' : 'Assistant';

      // Truncate content to 200 chars if needed
      let content = turn.content;
      if (content.length > 200) {
        content = content.substring(0, 197) + '...';
      }

      lines.push(`[${roleLabel}]: ${content}`);
    }

    return lines.join('\n');
  }

  /**
   * Get the number of turns in history.
   * @returns {number} Turn count
   */
  get turnCount() {
    return this.turns.length;
  }

  /**
   * Get estimated total token count for all turns.
   * @returns {number} Estimated token count
   */
  get estimatedTokens() {
    return this.turns.reduce((sum, turn) => {
      return sum + this.estimateTokens(turn.content);
    }, 0);
  }

  /**
   * Clear all history.
   */
  clear() {
    this.turns = [];
    console.log('[HISTORY] Cleared all turns');
  }

  /**
   * Serialize history to JSON for persistence.
   * @returns {Object} Serialized state
   */
  toJSON() {
    return {
      maxTurns: this.maxTurns,
      maxTokens: this.maxTokens,
      turns: this.turns,
      turnCount: this.turnCount,
      estimatedTokens: this.estimatedTokens
    };
  }

  /**
   * Restore history from serialized JSON.
   * @param {Object} data - Serialized state
   * @returns {MessageHistory} Restored instance
   */
  static fromJSON(data) {
    const history = new MessageHistory({
      maxTurns: data.maxTurns,
      maxTokens: data.maxTokens
    });

    history.turns = data.turns || [];
    console.log(`[HISTORY] Restored ${history.turns.length} turns from JSON`);

    return history;
  }
}

// Export singleton instance (default configuration)
const history = new MessageHistory();
export default history;

// CLI test
if (process.argv.includes('--test')) {
  console.log('Testing MessageHistory...\n');

  try {
    // Test 1: Create instance and add turns
    console.log('[TEST] Creating history and adding turns...');
    const testHistory = new MessageHistory();

    testHistory.addUser('Hello, can you help me?');
    testHistory.addAssistant('Yes, I can help you. What do you need?', {
      provider: 'groq',
      model: 'llama-3.3-70b',
      cost: 0.001
    });

    testHistory.addUser('I need to create a new file');
    testHistory.addAssistant('Sure, I can create a file for you.', {
      provider: 'ollama',
      model: 'qwen2.5-coder',
      operationCount: 1
    });

    testHistory.addUser('Thanks!');
    testHistory.addAssistant('You are welcome!');

    if (testHistory.turnCount !== 6) {
      throw new Error(`Expected 6 turns, got ${testHistory.turnCount}`);
    }
    console.log('[TEST] Turn count verified: 6 turns');

    // Test 2: Verify getMessages() returns correct format
    console.log('\n[TEST] Testing getMessages()...');
    const messages = testHistory.getMessages();

    if (!Array.isArray(messages)) {
      throw new Error('getMessages() should return an array');
    }

    if (messages.length !== 6) {
      throw new Error(`Expected 6 messages, got ${messages.length}`);
    }

    const firstMsg = messages[0];
    if (!firstMsg.role || !firstMsg.content) {
      throw new Error('Message should have role and content properties');
    }

    if (firstMsg.role !== 'user') {
      throw new Error(`Expected first message role to be 'user', got '${firstMsg.role}'`);
    }

    console.log('[TEST] getMessages() format verified');

    // Test 3: Verify toContextString() format
    console.log('\n[TEST] Testing toContextString()...');
    const contextString = testHistory.toContextString();

    if (!contextString.includes('[User]:')) {
      throw new Error('Context string should contain [User]: labels');
    }

    if (!contextString.includes('[Assistant]:')) {
      throw new Error('Context string should contain [Assistant]: labels');
    }

    if (!contextString.includes('Previous conversation:')) {
      throw new Error('Context string should start with "Previous conversation:"');
    }

    console.log('[TEST] toContextString() format verified');

    // Test 4: Verify toJSON() and fromJSON() roundtrip
    console.log('\n[TEST] Testing JSON serialization...');
    const serialized = testHistory.toJSON();

    if (serialized.turnCount !== 6) {
      throw new Error(`Serialized turnCount should be 6, got ${serialized.turnCount}`);
    }

    const restored = MessageHistory.fromJSON(serialized);

    if (restored.turnCount !== 6) {
      throw new Error(`Restored turnCount should be 6, got ${restored.turnCount}`);
    }

    if (restored.maxTurns !== testHistory.maxTurns) {
      throw new Error('Restored maxTurns should match original');
    }

    if (restored.maxTokens !== testHistory.maxTokens) {
      throw new Error('Restored maxTokens should match original');
    }

    const restoredMessages = restored.getMessages();
    if (restoredMessages[0].content !== messages[0].content) {
      throw new Error('Restored message content should match original');
    }

    console.log('[TEST] JSON roundtrip verified');

    // Test 5: Test token trimming
    console.log('\n[TEST] Testing token trimming...');
    const smallHistory = new MessageHistory({ maxTokens: 100 });

    // Add messages that will exceed budget
    const longMessage = 'A'.repeat(200); // ~50 tokens
    smallHistory.addUser(longMessage);
    smallHistory.addAssistant(longMessage);
    smallHistory.addUser(longMessage);
    smallHistory.addAssistant(longMessage);
    smallHistory.addUser('short');
    smallHistory.addAssistant('short');

    const trimmedMessages = smallHistory.getMessages();

    // Should keep at least last 2 turns
    if (trimmedMessages.length < 2) {
      throw new Error('Should keep at least 2 messages (minimum turns)');
    }

    // Should have trimmed some old messages
    if (trimmedMessages.length === 6) {
      throw new Error('Should have trimmed some messages due to token budget');
    }

    console.log(`[TEST] Token trimming verified: ${trimmedMessages.length} messages kept`);

    // Test 6: Test estimatedTokens property
    console.log('\n[TEST] Testing estimatedTokens property...');
    const tokenHistory = new MessageHistory();
    tokenHistory.addUser('Hello'); // ~2 tokens
    tokenHistory.addAssistant('Hi there!'); // ~3 tokens

    const estimated = tokenHistory.estimatedTokens;
    if (estimated <= 0) {
      throw new Error('estimatedTokens should be positive');
    }

    console.log(`[TEST] estimatedTokens verified: ${estimated} tokens`);

    // Test 7: Test clear()
    console.log('\n[TEST] Testing clear()...');
    testHistory.clear();

    if (testHistory.turnCount !== 0) {
      throw new Error('turnCount should be 0 after clear()');
    }

    if (testHistory.estimatedTokens !== 0) {
      throw new Error('estimatedTokens should be 0 after clear()');
    }

    console.log('[TEST] clear() verified');

    console.log('\n[TEST] All tests PASSED!');
    console.log('MessageHistory test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test failed:', error.message);
    process.exit(1);
  }
}
