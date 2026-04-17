/**
 * PlannerAgent - Specialized agent for architectural planning and task decomposition
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { BaseAgent } from './base-agent.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class PlannerAgent extends BaseAgent {
  constructor(llmClient) {
    super('planner', llmClient, { taskKey: 'code_generation' });

    // Load decomposition system prompt
    const promptPath = join(__dirname, '../prompts/decompose-system.txt');
    try {
      this.decompositionPrompt = readFileSync(promptPath, 'utf8');
    } catch (error) {
      console.warn('[PLANNER] Could not load decompose-system.txt:', error.message);
      this.decompositionPrompt = 'Break down complex tasks into smaller sequential sub-tasks.';
    }
  }

  buildMessages(task, context, conversationHistory = null) {
    // Override to use decomposition prompt + enhanced user prompt
    const systemContent = context.memoryContext
      ? this.decompositionPrompt + '\n\n' + context.memoryContext
      : this.decompositionPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    // Enhanced prompt for task decomposition
    let userContent = `TASK DECOMPOSITION MODE

Break down this request into atomic subtasks with dependencies.

User Request: ${task}

Output format:
## TASK BREAKDOWN
1. [Task name] - [description]
   Dependencies: [comma-separated task numbers or "none"]
   Agent: [planner|builder|tester|reviewer|survey|recorder]

2. [Next task]
   Dependencies: 1
   Agent: builder

...

## EXECUTION ORDER
Wave 1: Tasks 1, 2 (parallel)
Wave 2: Task 3 (depends on 1)
Wave 3: Task 4 (depends on 2, 3)
`;

    if (conversationHistory) {
      userContent += `\nCONVERSATION CONTEXT:\n${conversationHistory}\n`;
    }

    if (context.files && context.files.length > 0) {
      userContent += '\nPROJECT FILES:\n\n';
      for (const file of context.files) {
        userContent += `--- ${file.path} ---\n${file.content}\n\n`;
      }
    }

    messages.push({ role: 'user', content: userContent });
    return messages;
  }
}

const instance = new PlannerAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing PlannerAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## TASK BREAKDOWN\n1. Create login form - HTML form with email/password\n   Dependencies: none\n   Agent: builder\n\n## EXECUTION ORDER\nWave 1: Task 1',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new PlannerAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);
  console.log(`  Decomposition prompt loaded: ${agent.decompositionPrompt.length > 0 ? 'YES' : 'NO'}`);

  const plan = await agent.generatePlan('Add a login button', { files: [], projectRoot: '.' });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);
  console.log('\nPlannerAgent test PASSED');
  process.exit(0);
}
