/**
 * BuilderAgent - Specialized agent for code implementation
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { BaseAgent } from './base-agent.js';

export class BuilderAgent extends BaseAgent {
  constructor(llmClient) {
    super('builder', llmClient, { taskKey: 'code_generation' });
  }

  buildMessages(task, context, conversationHistory = null) {
    // Inject project memory into system prompt if available
    const systemContent = context.memoryContext
      ? this.systemPrompt + '\n\n' + context.memoryContext
      : this.systemPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    // Enhanced prompt for implementation
    let userContent = `IMPLEMENTATION MODE

Generate working code from this specification. Follow existing patterns in the codebase.

Specification: ${task}

Requirements:
- Use ESM imports (import/export)
- Follow singleton + named export pattern
- Add proper error handling
- Include self-test block
- Match existing code style

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
      userContent += 'No existing project files provided. Create new files as needed.\n';
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

const instance = new BuilderAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing BuilderAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nCreate calculator module\n\n## FILE: calculator.js\n## ACTION: create\n## DESCRIPTION: Simple calculator\n```javascript\nexport function add(a, b) { return a + b; }\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new BuilderAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const plan = await agent.generatePlan('Create a simple calculator module', { files: [], projectRoot: '.' });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);
  console.log('\nBuilderAgent test PASSED');
  process.exit(0);
}
