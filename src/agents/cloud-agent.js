/**
 * CloudAgent - Routes tasks to cloud LLMs for complex tasks
 * Uses 'code_generation_complex' task routing (prefers groq, together, claude)
 */

import { BaseAgent } from './base-agent.js';

export class CloudAgent extends BaseAgent {
  constructor(llmClient) {
    super('cloud', llmClient, { taskKey: 'code_generation_complex' });
  }
}

// Export singleton-compatible
export default CloudAgent;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing CloudAgent...\n');

  const mockClient = {
    async chat(messages, options) {
      console.log(`  Routing key: ${options.task}`);
      return {
        content: '## SUMMARY\nCloud test',
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        cost: 0
      };
    }
  };

  const agent = new CloudAgent(mockClient);
  console.log(`  Agent: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const result = await agent.generatePlan('refactor auth module', { files: [], projectRoot: '.' });
  console.log(`  Provider: ${result.provider}`);
  console.log(`  Cost: $${result.cost}`);
  console.log('\nCloudAgent test PASSED');
}
