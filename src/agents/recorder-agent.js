/**
 * RecorderAgent - Specialized agent for session recording and replay
 * @author Autonomous Recovery Team
 * @date 2026-04-16
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { BaseAgent } from './base-agent.js';
import { SessionLog } from '../core/session-log.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class RecorderAgent extends BaseAgent {
  constructor(llmClient) {
    super('recorder', llmClient, { taskKey: 'code_generation' });
    this.sessionLog = new SessionLog();
    this.sessionsDir = join(__dirname, '../../sessions');
  }

  buildMessages(task, context, conversationHistory = null) {
    // Inject project memory into system prompt if available
    const systemContent = context.memoryContext
      ? this.systemPrompt + '\n\n' + context.memoryContext
      : this.systemPrompt;

    const messages = [
      { role: 'system', content: systemContent }
    ];

    // Enhanced prompt for recording
    let userContent = `RECORDING MODE

Session recording active. Capturing interaction for replay.

User request: ${task}

Generate plan with full detail for replay:
- Exact commands to run
- Expected outputs
- State changes
- File modifications

This will be used to reproduce the session later.

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

  async replaySession(limit = 10) {
    const sessions = await this.sessionLog.loadRecent(this.sessionsDir, limit);
    console.log(`[RECORDER] Found ${sessions.length} recorded sessions`);

    for (const session of sessions) {
      console.log(`  - ${session.timestamp}: ${session.id}`);
    }

    return sessions;
  }
}

const instance = new RecorderAgent();
export default instance;

// Self-test
if (process.argv.includes('--test')) {
  console.log('Testing RecorderAgent...\n');

  const mockClient = {
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nRecord test interaction\n\n## FILE: record.log\n## ACTION: create\n## DESCRIPTION: Session log\n```\nRecorded interaction\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0
      };
    }
  };

  const agent = new RecorderAgent(mockClient);
  console.log(`  Agent name: ${agent.name}`);
  console.log(`  Task key: ${agent.taskKey}`);
  console.log(`  SessionLog initialized: ${agent.sessionLog ? 'YES' : 'NO'}`);
  console.log(`  Sessions directory: ${agent.sessionsDir}`);

  const plan = await agent.generatePlan('Test recording', { files: [], projectRoot: '.' });
  console.log(`  Generated plan with ${plan.content.length} characters`);
  console.log(`  Provider: ${plan.provider}`);

  const sessions = await agent.replaySession(5);
  console.log(`  Can access sessions: ${Array.isArray(sessions) ? 'YES' : 'NO'}`);

  console.log('\nRecorderAgent test PASSED');
  process.exit(0);
}
