/**
 * ReviewerAgent - Specialized agent for code review and quality audits
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { BaseAgent } from './base-agent.js';

export class ReviewerAgent extends BaseAgent {
  constructor(llmClient) {
    super('reviewer', llmClient, { taskKey: 'code_generation' });
  }

  buildMessages(task, context, conversationHistory = null) {
    // Inject project memory into system prompt if available
    const systemContent = context.memoryContext
      ? this.systemPrompt + '\n\n' + context.memoryContext
      : this.systemPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    // Enhanced prompt for code review
    let userContent = `CODE REVIEW MODE

Audit this code for quality and standards compliance.

Code to review: ${task}

Check for:
- Architecture violations (hardcoding, global state, polling)
- Error handling (no silent failures)
- Comment style (// only, explain WHY not WHAT)
- ESM compliance
- Security issues (SQL injection, path traversal)

Output review as:
## REVIEW SUMMARY
[PASS/WARNING/FAIL]

## FINDINGS
- [severity: error/warning/info] [description]
- [severity: error/warning/info] [description]

## RECOMMENDATIONS
- [action item]

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
      userContent += 'No existing project files provided.\n';
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

const instance = new ReviewerAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing ReviewerAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## REVIEW SUMMARY\nWARNING\n\n## FINDINGS\n- [severity: warning] Missing error handling\n\n## RECOMMENDATIONS\n- Add try-catch block',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new ReviewerAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);

  const plan = await agent.generatePlan('const data = fetchData(); // TODO: handle errors', { files: [], projectRoot: '.' });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);
  console.log('\nReviewerAgent test PASSED');
  process.exit(0);
}
