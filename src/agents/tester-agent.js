/**
 * TesterAgent - Specialized agent for test generation and validation
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { BaseAgent } from './base-agent.js';

export class TesterAgent extends BaseAgent {
  constructor(llmClient) {
    super('tester', llmClient, { taskKey: 'code_generation' });
  }

  buildMessages(task, context, conversationHistory = null) {
    // Inject project memory into system prompt if available
    const systemContent = context.memoryContext
      ? this.systemPrompt + '\n\n' + context.memoryContext
      : this.systemPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    // Enhanced prompt for test generation
    let userContent = `TEST GENERATION MODE

Create comprehensive test coverage for this implementation.

Code to test: ${task}

Test requirements:
- Happy path cases
- Error cases
- Edge cases (null, undefined, empty, boundary values)
- Integration points
- Performance (if applicable)

Output tests as self-test blocks that can run with --test flag.

`;

    if (conversationHistory) {
      userContent += `CONVERSATION CONTEXT:\n${conversationHistory}\n\n`;
    }

    if (context.files && context.files.length > 0) {
      userContent += 'PROJECT FILES:\n\n';
      for (const file of context.files) {
        userContent += `--- ${file.path} ---\n${file.content}\n\n`;
      }
    } else {
      userContent += 'No existing project files provided. Create new test files as needed.\n';
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

const instance = new TesterAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing TesterAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nAdd tests for add function\n\n## FILE: test.js\n## ACTION: create\n## DESCRIPTION: Test suite\n```javascript\nconsole.log("Testing add(2,3):", add(2,3) === 5);\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new TesterAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const plan = await agent.generatePlan('function add(a, b) { return a + b; }', { files: [], projectRoot: '.' });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);
  console.log('\nTesterAgent test PASSED');
  process.exit(0);
}
