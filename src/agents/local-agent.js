/**
 * LocalAgent - Routes tasks to local LLM (Ollama) via the provider chain
 * Uses 'code_generation' task routing (prefers ollama:code)
 */

import { BaseAgent } from './base-agent.js';

export class LocalAgent extends BaseAgent {
  constructor(llmClient) {
    super('local', llmClient, { taskKey: 'code_generation' });
  }
}

// Export singleton-compatible
export default LocalAgent;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing LocalAgent...\n');

  const mockClient = {
    async chat(messages, options) {
      console.log(`  Routing key: ${options.task}`);
      return {
        content: '## SUMMARY\nLocal test',
        provider: 'ollama',
        model: 'qwen2.5-coder:14b',
        cost: 0
      };
    }
  };

  const agent = new LocalAgent(mockClient);
  console.log(`  Agent: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const result = await agent.generatePlan('fix typo', { files: [], projectRoot: '.' });
  console.log(`  Provider: ${result.provider}`);
  console.log(`  Cost: $${result.cost}`);
  console.log('\nLocalAgent test PASSED');
}
