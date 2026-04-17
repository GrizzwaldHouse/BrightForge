/**
 * SurveyAgent - Specialized agent for codebase analysis and pattern detection
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { BaseAgent } from './base-agent.js';
import { FileContext } from '../core/file-context.js';

export class SurveyAgent extends BaseAgent {
  constructor(llmClient) {
    super('survey', llmClient, { taskKey: 'code_generation' });
  }

  async generatePlan(task, context, options = {}) {
    // Scan project structure if not already provided
    let files = context.files || [];

    if (files.length === 0 && context.projectRoot) {
      const fileContext = new FileContext();
      const scanResult = await fileContext.scan(context.projectRoot);
      files = scanResult.files.slice(0, 50); // Limit to first 50 for context
    }

    // Build enhanced context with file list
    const enhancedContext = {
      ...context,
      files,
      fileList: files.map(f => f.path)
    };

    return super.generatePlan(task, enhancedContext, options);
  }

  buildMessages(task, context, conversationHistory = null) {
    // Inject project memory into system prompt if available
    const systemContent = context.memoryContext
      ? this.systemPrompt + '\n\n' + context.memoryContext
      : this.systemPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    const files = context.fileList || [];

    // Enhanced prompt for codebase survey
    let userContent = `CODEBASE SURVEY MODE

Analyze this project and identify architectural patterns.

Project files (${files.length} total):
${files.slice(0, 50).join('\n')}
${files.length > 50 ? `... and ${files.length - 50} more` : ''}

Survey request: ${task}

Identify:
- Tech stack (frameworks, libraries)
- Architecture patterns (MVC, event-driven, etc)
- Code organization conventions
- Testing strategy
- Build/deployment patterns

Output as JSON tech stack report.

`;

    if (conversationHistory) {
      userContent += `CONVERSATION CONTEXT:\n${conversationHistory}\n\n`;
    }

    if (context.files && context.files.length > 0) {
      userContent += 'SAMPLE PROJECT FILES:\n\n';
      for (const file of context.files.slice(0, 5)) {
        userContent += `--- ${file.path} ---\n${file.content.substring(0, 500)}...\n\n`;
      }
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

const instance = new SurveyAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing SurveyAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nTech stack analysis\n\n## FILE: tech-stack.json\n## ACTION: create\n## DESCRIPTION: Analysis\n```json\n{"framework":"Node.js","language":"JavaScript"}\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new SurveyAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const plan = await agent.generatePlan('Analyze tech stack', { files: [], projectRoot: process.cwd() });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);
  console.log('\nSurveyAgent test PASSED');
  process.exit(0);
}
