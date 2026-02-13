/**
 * BaseAgent - Abstract base class for coding agents
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class BaseAgent {
  constructor(name, llmClient, options = {}) {
    this.name = name;
    this.llmClient = llmClient;
    this.taskKey = options.taskKey || 'code_generation';

    // Load system prompt
    const promptPath = join(__dirname, '../prompts/plan-system.txt');
    try {
      this.systemPrompt = readFileSync(promptPath, 'utf8');
    } catch (error) {
      console.warn(`[${this.name.toUpperCase()}] Could not load system prompt:`, error.message);
      this.systemPrompt = 'You are a coding agent. Generate file changes in a structured format.';
    }
  }

  /**
   * Generate a plan for the given task.
   * @param {string} task - User's task description
   * @param {Object} context - { files: [{path, content}], projectRoot: string }
   * @param {Object} options - { maxTokens, temperature }
   * @returns {Promise<{content: string, provider: string, model: string, cost: number}>}
   */
  async generatePlan(task, context, options = {}) {
    const messages = this.buildMessages(task, context);

    console.log(`[${this.name.toUpperCase()}] Generating plan with task routing: ${this.taskKey}`);

    const result = await this.llmClient.chat(messages, {
      task: this.taskKey,
      max_tokens: options.maxTokens || 4096,
      temperature: options.temperature ?? 0.3
    });

    return result;
  }

  /**
   * Build the messages array for the LLM call.
   * @param {string} task
   * @param {Object} context
   * @param {string|null} conversationHistory - Optional conversation context
   * @returns {Array<{role: string, content: string}>}
   */
  buildMessages(task, context, conversationHistory = null) {
    const messages = [
      { role: 'system', content: this.systemPrompt }
    ];

    // Build user message with task and file context
    let userContent = `TASK: ${task}\n\n`;

    if (conversationHistory) {
      userContent += `CONVERSATION CONTEXT:\n${conversationHistory}\n\n`;
    }

    if (context.files && context.files.length > 0) {
      userContent += 'PROJECT FILES:\n\n';
      for (const file of context.files) {
        userContent += `--- ${file.path} ---\n${file.content}\n\n`;
      }
    } else {
      userContent += 'No existing project files provided. Create new files as needed.\n';
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing BaseAgent...\n');

  // Create a mock LLM client
  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nTest plan\n\n## FILE: test.js\n## ACTION: create\n## DESCRIPTION: Test file\n```javascript\nconsole.log("test");\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new BaseAgent('test', mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);
  console.log(`  System prompt loaded: ${agent.systemPrompt.length > 0 ? 'YES' : 'NO'} (${agent.systemPrompt.length} chars)`);

  // Test generatePlan
  const result = await agent.generatePlan('test task', { files: [], projectRoot: '.' });
  console.log(`  Plan generated: ${result.content.substring(0, 50)}...`);
  console.log(`  Provider: ${result.provider}`);
  console.log('\nBaseAgent test PASSED');
}
