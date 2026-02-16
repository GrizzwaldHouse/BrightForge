/**
 * ConversationSession - Multi-Turn Chat Mode for LLCApp
 *
 * Manages stateful conversation sessions with:
 * - Multi-turn message history
 * - Plan generation and approval workflow
 * - Multi-step task decomposition
 * - Slash commands (/help, /status, /rollback, etc.)
 * - Auto-save on exit
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { MasterAgent } from '../agents/master-agent.js';
import { DiffApplier } from './diff-applier.js';
import { SessionLog } from './session-log.js';
import { MessageHistory } from './message-history.js';
import { MultiStepPlanner } from './multi-step-planner.js';
import { Terminal } from '../ui/terminal.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class ConversationSession {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.cwd();
    this.sessionsDir = options.sessionsDir || join(dirname(fileURLToPath(import.meta.url)), '../../sessions');
    this.id = `chat-${Date.now()}`;
    this.terminal = options.terminal || new Terminal();
    this.masterAgent = options.masterAgent || new MasterAgent();
    this.multiStepPlanner = new MultiStepPlanner(this.masterAgent);
    this.diffApplier = new DiffApplier();
    this.sessionLog = new SessionLog();
    this.history = new MessageHistory();
    this.plans = []; // all plans generated in this session
  }

  /**
   * Process one conversation turn.
   * @param {string} userMessage - User's input message
   * @returns {Promise<{plan: Object|null, plans: Array<Object>|null, status: string, message: string}>}
   */
  async handleTurn(userMessage) {
    this.history.addUser(userMessage);

    // Check if task needs multi-step decomposition
    const { needsDecomposition, reason } = this.multiStepPlanner.shouldDecompose(userMessage);

    if (needsDecomposition) {
      console.log(`[CHAT] Multi-step needed: ${reason}`);
      this.terminal.log(`Decomposing task (${reason})...`, 'info');

      const steps = await this.multiStepPlanner.decompose(userMessage);
      this.terminal.log(`Decomposed into ${steps.length} sub-tasks:`, 'info');
      steps.forEach(s => this.terminal.log(`  ${s.step}. ${s.subtask}`, 'info'));
      console.log('');

      const result = await this.multiStepPlanner.executeSteps(steps, this.projectRoot, {
        onPlanGenerated: async (plan, step) => {
          this.terminal.log(`Step ${step.step}/${steps.length}: ${step.subtask}`, 'info');
          this.terminal.showSummary(plan);
          this.terminal.showPlan(plan);

          const decision = await this.terminal.promptApproval(`Apply step ${step.step}? [y/n] `);
          if (decision === 'approve') {
            const applyResult = await this.diffApplier.apply(plan, this.projectRoot);
            if (applyResult.failed > 0) {
              this.terminal.log(`${applyResult.applied} applied, ${applyResult.failed} failed`, 'warning');
              plan.status = 'failed';
            } else {
              this.terminal.log(`Step ${step.step} applied (${applyResult.applied} files)`, 'success');
              plan.status = 'applied';
            }
          } else {
            plan.status = 'rejected';
            this.terminal.log(`Step ${step.step} skipped`, 'info');
          }

          this.plans.push(plan);
          await this.sessionLog.record(plan, this.sessionsDir);
        }
      });

      const summary = `Multi-step task completed: ${result.plans.length} steps, ${result.status}, cost: $${result.totalCost.toFixed(4)}`;
      this.history.addAssistant(summary, { cost: result.totalCost });
      this.terminal.log(summary, result.status === 'completed' ? 'success' : 'warning');

      return { plans: result.plans, status: result.status, message: summary };
    }

    // Single-step: standard plan generation
    const spin = this.terminal.spinner('Generating plan...');
    let plan;
    try {
      // Pass conversation history to the agent via context string
      const historyContext = this.history.turnCount > 1 ? this.history.toContextString() : null;
      // Note: We pass the history context by building the task string with it
      // MasterAgent.run() doesn't directly support history, so we prepend it to the task
      const taskWithHistory = historyContext
        ? `${userMessage}\n\nContext from our conversation:\n${historyContext}`
        : userMessage;

      plan = await this.masterAgent.run(taskWithHistory, this.projectRoot);
      spin.stop('Plan generated');
    } catch (error) {
      spin.stop('Plan generation failed');
      this.terminal.log(`Error: ${error.message}`, 'error');
      this.history.addAssistant(`Error: ${error.message}`);
      return { plan: null, status: 'error', message: error.message };
    }

    if (!plan.operations || plan.operations.length === 0) {
      this.terminal.log('No file operations generated.', 'warning');
      this.history.addAssistant('No operations generated for this task.');
      return { plan: null, status: 'empty', message: 'No operations generated' };
    }

    // Show plan and prompt
    this.terminal.showSummary(plan);
    this.terminal.showPlan(plan);

    const decision = await this.terminal.promptApproval('Apply these changes? [y/n] ');

    if (decision === 'approve') {
      const result = await this.diffApplier.apply(plan, this.projectRoot);
      if (result.failed > 0) {
        this.terminal.log(`Applied ${result.applied}, ${result.failed} failed`, 'warning');
        plan.status = 'failed';
      } else {
        this.terminal.log(`Applied ${result.applied} file change(s)`, 'success');
        plan.status = 'applied';
      }
    } else {
      plan.status = 'rejected';
      this.terminal.log('Changes rejected.', 'info');
    }

    this.plans.push(plan);
    await this.sessionLog.record(plan, this.sessionsDir);

    const summary = `${plan.status}: ${plan.summary || userMessage} (${plan.operations.length} files, $${(plan.cost || 0).toFixed(4)})`;
    this.history.addAssistant(summary, {
      planId: plan.id,
      provider: plan.provider,
      model: plan.model,
      cost: plan.cost,
      operationCount: plan.operations.length
    });

    return { plan, status: plan.status, message: summary };
  }

  /**
   * Handle slash commands.
   * @param {string} command - Command string (e.g., '/help')
   * @returns {Promise<{handled: boolean, shouldExit: boolean, message: string}>}
   */
  async handleCommand(command) {
    const cmd = command.trim().toLowerCase();

    if (cmd === '/exit' || cmd === '/quit' || cmd === '/q') {
      this.terminal.log('Exiting conversation mode.', 'info');
      return { handled: true, shouldExit: true, message: 'Goodbye!' };
    }

    if (cmd === '/help') {
      console.log('');
      this.terminal.log('Available commands:', 'info');
      console.log('  /help       Show this help');
      console.log('  /status     Show session status');
      console.log('  /history    Show conversation history');
      console.log('  /rollback   Rollback last applied plan');
      console.log('  /save       Save conversation to disk');
      console.log('  /reset      Clear conversation history');
      console.log('  /exit       Exit conversation mode');
      console.log('');
      return { handled: true, shouldExit: false, message: 'Help displayed' };
    }

    if (cmd === '/status') {
      console.log('');
      this.terminal.log(`Session: ${this.id}`, 'info');
      this.terminal.log(`Project: ${this.projectRoot}`, 'info');
      this.terminal.log(`Turns: ${this.history.turnCount}`, 'info');
      this.terminal.log(`Plans: ${this.plans.length}`, 'info');
      this.terminal.log(`Tokens used: ~${this.history.estimatedTokens}`, 'info');
      const totalCost = this.plans.reduce((sum, p) => sum + (p.cost || 0), 0);
      this.terminal.log(`Total cost: $${totalCost.toFixed(4)}`, 'info');
      console.log('');
      return { handled: true, shouldExit: false, message: 'Status displayed' };
    }

    if (cmd === '/history') {
      console.log('');
      const context = this.history.toContextString();
      if (context) {
        console.log(context);
      } else {
        this.terminal.log('No conversation history yet.', 'info');
      }
      console.log('');
      return { handled: true, shouldExit: false, message: 'History displayed' };
    }

    if (cmd === '/rollback') {
      const appliedPlans = this.plans.filter(p => p.status === 'applied');
      if (appliedPlans.length === 0) {
        this.terminal.log('No applied plans to rollback.', 'warning');
        return { handled: true, shouldExit: false, message: 'Nothing to rollback' };
      }
      const lastPlan = appliedPlans[appliedPlans.length - 1];
      this.terminal.log(`Rolling back: ${lastPlan.task || lastPlan.summary}`, 'info');
      const result = await this.diffApplier.rollback(lastPlan, this.projectRoot);
      lastPlan.status = 'rolled_back';
      this.terminal.log(`Restored ${result.restored} file(s)`, 'success');
      await this.sessionLog.record(lastPlan, this.sessionsDir);
      return { handled: true, shouldExit: false, message: `Rolled back ${result.restored} files` };
    }

    if (cmd === '/save') {
      const savePath = await this.save();
      this.terminal.log(`Conversation saved: ${savePath}`, 'success');
      return { handled: true, shouldExit: false, message: `Saved to ${savePath}` };
    }

    if (cmd === '/reset') {
      this.history.clear();
      this.plans = [];
      this.terminal.log('Conversation history cleared.', 'success');
      return { handled: true, shouldExit: false, message: 'History cleared' };
    }

    return { handled: false, shouldExit: false, message: `Unknown command: ${command}` };
  }

  /**
   * Main REPL loop for conversation mode.
   * @returns {Promise<void>}
   */
  async run() {
    this.terminal.header('LLCApp Chat Mode');
    this.terminal.log(`Project: ${this.projectRoot}`, 'info');
    this.terminal.log('Type a coding task, or /help for commands. /exit to quit.', 'info');
    console.log('');

    // eslint-disable-next-line no-constant-condition
    while (true) {
      let input;
      try {
        input = await this.terminal.promptInput('llcapp> ');
      } catch (error) {
        // Handle Ctrl+C or readline close
        console.log('');
        this.terminal.log('Session ended.', 'info');
        break;
      }

      // Skip empty input
      if (!input) continue;

      // Handle slash commands
      if (input.startsWith('/')) {
        const result = await this.handleCommand(input);
        if (result.shouldExit) break;
        if (!result.handled) {
          this.terminal.log(result.message, 'warning');
        }
        continue;
      }

      // Process as a task
      try {
        await this.handleTurn(input);
      } catch (error) {
        this.terminal.log(`Unexpected error: ${error.message}`, 'error');
        console.error('[CHAT] Error details:', error);
      }

      console.log(''); // blank line between turns
    }

    // Auto-save on exit
    if (this.history.turnCount > 0) {
      try {
        const savePath = await this.save();
        this.terminal.log(`Conversation auto-saved: ${savePath}`, 'info');
      } catch (error) {
        console.error(`[CHAT] Auto-save failed: ${error.message}`);
      }
    }
  }

  /**
   * Save conversation to disk.
   * @returns {Promise<string>} Path to saved file
   */
  async save() {
    if (!existsSync(this.sessionsDir)) {
      mkdirSync(this.sessionsDir, { recursive: true });
    }

    const fileName = `${new Date().toISOString().split('T')[0]}_${this.id}.json`;
    const filePath = join(this.sessionsDir, fileName);

    const data = {
      id: this.id,
      projectRoot: this.projectRoot,
      history: this.history.toJSON(),
      planCount: this.plans.length,
      totalCost: this.plans.reduce((sum, p) => sum + (p.cost || 0), 0),
      savedAt: new Date().toISOString()
    };

    writeFileSync(filePath, JSON.stringify(data, null, 2));
    console.log(`[CHAT] Conversation saved to ${filePath}`);
    return filePath;
  }

  /**
   * Load conversation from disk.
   * @param {string} sessionPath - Path to saved session file
   * @returns {Promise<void>}
   */
  async load(sessionPath) {
    const raw = readFileSync(sessionPath, 'utf8');
    const data = JSON.parse(raw);

    this.id = data.id;
    this.projectRoot = data.projectRoot;
    this.history = MessageHistory.fromJSON(data.history);

    console.log(`[CHAT] Loaded conversation ${this.id} (${this.history.turnCount} turns)`);
  }
}

// Export singleton instance (optional)
export default ConversationSession;

// CLI test
if (process.argv.includes('--test')) {
  console.log('Testing ConversationSession...\n');

  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  try {
    // Mock LLM client
    const mockClient = {
      providers: {},
      taskRouting: {},
      budget: { daily_limit_usd: 1.0 },
      dailyUsage: { date: new Date().toISOString().split('T')[0], cost_usd: 0, requests: {}, tokens: {} },
      getUsageSummary() {
        return { ...this.dailyUsage, budget_remaining: 1.0 };
      },
      async chat(_messages, _options) {
        return {
          content: '## SUMMARY\nTest\n\n## FILE: test.js\n## ACTION: create\n## DESCRIPTION: Test\n```javascript\nconsole.log("test");\n```',
          provider: 'mock',
          model: 'mock',
          cost: 0,
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        };
      }
    };

    const mockMasterAgent = new MasterAgent({ llmClient: mockClient });

    // Use a temp sessions dir for testing
    const tempSessionsDir = mkdtempSync(join(tmpdir(), 'llcapp-chat-test-'));
    console.log(`Test directory: ${tempSessionsDir}`);

    const session = new ConversationSession({
      projectRoot: process.cwd(),
      sessionsDir: tempSessionsDir,
      masterAgent: mockMasterAgent
    });

    // Test 1: handleCommand /help
    console.log('[TEST] Testing /help command...');
    const helpResult = await session.handleCommand('/help');
    if (!helpResult.handled || helpResult.shouldExit) {
      throw new Error('Help command should be handled but not exit');
    }
    console.log('[TEST] /help command verified: PASSED');

    // Test 2: handleCommand /status
    console.log('\n[TEST] Testing /status command...');
    const statusResult = await session.handleCommand('/status');
    if (!statusResult.handled || statusResult.shouldExit) {
      throw new Error('Status command should be handled but not exit');
    }
    console.log('[TEST] /status command verified: PASSED');

    // Test 3: handleCommand /exit
    console.log('\n[TEST] Testing /exit command...');
    const exitResult = await session.handleCommand('/exit');
    if (!exitResult.handled || !exitResult.shouldExit) {
      throw new Error('Exit command should be handled and trigger exit');
    }
    console.log('[TEST] /exit command verified: PASSED');

    // Test 4: handleCommand /unknown
    console.log('\n[TEST] Testing unknown command...');
    const unknownResult = await session.handleCommand('/unknown');
    if (unknownResult.handled) {
      throw new Error('Unknown command should not be handled');
    }
    console.log('[TEST] Unknown command verified: PASSED');

    // Test 5: save() creates a file
    console.log('\n[TEST] Testing save()...');
    const savePath = await session.save();
    if (!existsSync(savePath)) {
      throw new Error('Save file was not created');
    }
    console.log(`[TEST] Save file verified: ${savePath}`);

    // Test 6: load() restores session
    console.log('\n[TEST] Testing load()...');
    const newSession = new ConversationSession({
      projectRoot: process.cwd(),
      sessionsDir: tempSessionsDir,
      masterAgent: mockMasterAgent
    });
    await newSession.load(savePath);
    if (newSession.id !== session.id) {
      throw new Error('Loaded session ID does not match original');
    }
    console.log('[TEST] Load verified: PASSED');

    console.log('\n[TEST] All tests PASSED!');
    console.log('ConversationSession test PASSED');

    // Clean up
    rmSync(tempSessionsDir, { recursive: true, force: true });
    console.log(`\n[TEST] Cleaned up temp directory: ${tempSessionsDir}`);

  } catch (error) {
    console.error('\n[TEST] Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
