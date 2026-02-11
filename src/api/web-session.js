/**
 * WebSession - HTTP-friendly session wrapper
 *
 * Unlike ConversationSession (CLI), this class separates plan generation
 * from plan application for 2-step web API workflow.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { randomUUID } from 'crypto';
import { MasterAgent } from '../agents/master-agent.js';
import { DiffApplier } from '../core/diff-applier.js';
import { SessionLog } from '../core/session-log.js';
import { MessageHistory } from '../core/message-history.js';
import { MultiStepPlanner } from '../core/multi-step-planner.js';

export class WebSession {
  constructor({ projectRoot, sessionsDir }) {
    this.id = randomUUID();
    this.projectRoot = projectRoot;
    this.sessionsDir = sessionsDir;
    this.createdAt = new Date().toISOString();
    this.lastActivity = Date.now();

    this.masterAgent = new MasterAgent();
    this.diffApplier = new DiffApplier();
    this.sessionLog = new SessionLog();
    this.history = new MessageHistory();
    this.planner = new MultiStepPlanner(this.masterAgent);

    this.pendingPlan = null;
    this.plans = [];
    this.totalCost = 0;
    this.turns = 0;
  }

  touch() {
    this.lastActivity = Date.now();
  }

  async generatePlan(message) {
    this.touch();
    this.turns++;
    this.history.addUser(message);

    console.log(`[WEB] Session ${this.id.slice(0, 8)} - generating plan for: ${message.slice(0, 80)}`);

    try {
      // Check if task needs decomposition
      const { needsDecomposition, reason } = this.planner.shouldDecompose(message);

      if (needsDecomposition) {
        // For complex tasks, decompose into steps
        console.log(`[WEB] Multi-step needed: ${reason}`);
        const steps = await this.planner.decompose(message, this.projectRoot);

        // Generate plan for first step (or all steps combined)
        const plan = await this.masterAgent.run(message, this.projectRoot);

        plan.steps = steps;
        plan.id = randomUUID();
        this.pendingPlan = plan;
        this.plans.push(plan);
        this.totalCost += plan.cost || 0;

        const responseMsg = `Generated plan with ${plan.operations?.length || 0} file operation(s) across ${steps.length} step(s). Review and approve to apply.`;
        this.history.addAssistant(responseMsg);

        return {
          plan: this.sanitizePlan(plan),
          steps,
          status: 'pending_approval',
          message: responseMsg,
          sessionId: this.id
        };
      }

      // Simple task - generate plan directly
      const plan = await this.masterAgent.run(message, this.projectRoot);
      plan.id = randomUUID();
      this.pendingPlan = plan;
      this.plans.push(plan);
      this.totalCost += plan.cost || 0;

      const responseMsg = plan.operations?.length > 0
        ? `Generated plan with ${plan.operations.length} file operation(s). Review and approve to apply.`
        : 'No file operations generated. The LLM may not have understood the task. Try rephrasing.';

      this.history.addAssistant(responseMsg);

      return {
        plan: this.sanitizePlan(plan),
        status: plan.operations?.length > 0 ? 'pending_approval' : 'no_changes',
        message: responseMsg,
        sessionId: this.id
      };

    } catch (error) {
      console.error(`[WEB] Plan generation failed: ${error.message}`);
      const errorMsg = `Error generating plan: ${error.message}`;
      this.history.addAssistant(errorMsg);

      return {
        plan: null,
        status: 'error',
        message: errorMsg,
        sessionId: this.id
      };
    }
  }

  async approvePlan(planId) {
    this.touch();

    if (!this.pendingPlan) {
      return { status: 'error', message: 'No pending plan to approve' };
    }

    if (planId && this.pendingPlan.id !== planId) {
      return { status: 'error', message: 'Plan ID mismatch' };
    }

    console.log(`[WEB] Session ${this.id.slice(0, 8)} - approving plan`);

    try {
      const result = await this.diffApplier.apply(this.pendingPlan, this.projectRoot);

      this.pendingPlan.status = result.failed > 0 ? 'partial' : 'applied';

      // Log session
      await this.sessionLog.record(this.pendingPlan, this.sessionsDir);

      const plan = this.pendingPlan;
      this.pendingPlan = null;

      return {
        status: plan.status,
        applied: result.applied || 0,
        failed: result.failed || 0,
        errors: result.errors || [],
        cost: plan.cost || 0,
        provider: plan.provider,
        model: plan.model
      };
    } catch (error) {
      console.error(`[WEB] Apply failed: ${error.message}`);
      return {
        status: 'error',
        message: `Apply failed: ${error.message}`,
        applied: 0,
        failed: 0,
        errors: [error.message]
      };
    }
  }

  async rejectPlan(planId) {
    this.touch();

    if (!this.pendingPlan) {
      return { status: 'error', message: 'No pending plan to reject' };
    }

    if (planId && this.pendingPlan.id !== planId) {
      return { status: 'error', message: 'Plan ID mismatch' };
    }

    console.log(`[WEB] Session ${this.id.slice(0, 8)} - rejecting plan`);

    this.pendingPlan.status = 'rejected';
    await this.sessionLog.record(this.pendingPlan, this.sessionsDir);
    this.pendingPlan = null;

    this.history.addAssistant('Plan rejected. No files were modified.');

    return { status: 'rejected' };
  }

  async rollbackLast() {
    this.touch();

    console.log(`[WEB] Session ${this.id.slice(0, 8)} - rolling back`);

    try {
      const lastPlan = await this.sessionLog.loadLast(this.sessionsDir);

      if (!lastPlan) {
        return { status: 'error', message: 'No session found to rollback' };
      }

      if (lastPlan.status !== 'applied') {
        return { status: 'error', message: `Cannot rollback - last plan status is "${lastPlan.status}"` };
      }

      const result = await this.diffApplier.rollback(lastPlan, this.projectRoot);

      lastPlan.status = 'rolled_back';
      await this.sessionLog.record(lastPlan, this.sessionsDir);

      this.history.addAssistant(`Rolled back ${result.restored} file(s).`);

      return {
        status: 'rolled_back',
        restored: result.restored || 0,
        errors: result.errors || []
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Rollback failed: ${error.message}`,
        restored: 0,
        errors: [error.message]
      };
    }
  }

  sanitizePlan(plan) {
    // Return plan data safe for JSON API response (no circular refs, no internal objects)
    return {
      id: plan.id,
      task: plan.task,
      complexity: plan.complexity,
      provider: plan.provider,
      model: plan.model,
      cost: plan.cost || 0,
      operations: (plan.operations || []).map(op => ({
        action: op.type,
        file: op.filePath,
        content: op.modified,
        original: op.original
      })),
      risks: plan.risks || [],
      status: plan.status || 'pending_approval'
    };
  }

  getStatus() {
    return {
      id: this.id,
      projectRoot: this.projectRoot,
      createdAt: this.createdAt,
      turns: this.turns,
      totalCost: this.totalCost,
      planCount: this.plans.length,
      hasPendingPlan: !!this.pendingPlan,
      lastActivity: this.lastActivity
    };
  }

  getHistory() {
    return this.history.getMessages();
  }

  toJSON() {
    return {
      id: this.id,
      projectRoot: this.projectRoot,
      createdAt: this.createdAt,
      turns: this.turns,
      totalCost: this.totalCost,
      planCount: this.plans.length,
      history: this.history.toJSON()
    };
  }
}

export default WebSession;

// --test Block
if (process.argv.includes('--test')) {
  console.log('Testing WebSession...\n');

  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');
  const { join } = await import('path');

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
      async chat(messages, options) {
        return {
          content: '## SUMMARY\nTest\n\n## FILE: test.js\n## ACTION: create\n## DESCRIPTION: Test\n```javascript\nconsole.log("test");\n```',
          provider: 'mock',
          model: 'mock',
          cost: 0,
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
        };
      }
    };

    const { MasterAgent } = await import('../agents/master-agent.js');
    const mockMasterAgent = new MasterAgent({ llmClient: mockClient });

    // Use a temp sessions dir for testing
    const tempSessionsDir = mkdtempSync(join(tmpdir(), 'llcapp-web-test-'));
    console.log(`Test directory: ${tempSessionsDir}`);

    const session = new WebSession({
      projectRoot: process.cwd(),
      sessionsDir: tempSessionsDir
    });

    // Test 1: generatePlan creates pending plan
    console.log('[TEST] Testing generatePlan()...');
    session.masterAgent = mockMasterAgent;
    const planResult = await session.generatePlan('create a test file');

    if (planResult.status !== 'pending_approval' && planResult.status !== 'no_changes') {
      throw new Error(`Expected pending_approval or no_changes, got ${planResult.status}`);
    }
    if (!session.pendingPlan) {
      console.warn('[TEST] Warning: pendingPlan is null (LLM may have failed to generate operations)');
    }
    console.log('[TEST] generatePlan verified: PASSED');

    // Test 2: getStatus returns correct info
    console.log('\n[TEST] Testing getStatus()...');
    const status = session.getStatus();
    if (!status.id || status.id !== session.id) {
      throw new Error('Status ID mismatch');
    }
    if (status.turns !== 1) {
      throw new Error(`Expected 1 turn, got ${status.turns}`);
    }
    console.log('[TEST] getStatus verified: PASSED');

    // Test 3: getHistory returns messages
    console.log('\n[TEST] Testing getHistory()...');
    const history = session.getHistory();
    if (!Array.isArray(history)) {
      throw new Error('getHistory should return an array');
    }
    if (history.length < 1) {
      throw new Error('getHistory should have at least 1 message');
    }
    console.log('[TEST] getHistory verified: PASSED');

    // Test 4: toJSON serialization
    console.log('\n[TEST] Testing toJSON()...');
    const json = session.toJSON();
    if (!json.id || !json.history) {
      throw new Error('toJSON missing required fields');
    }
    console.log('[TEST] toJSON verified: PASSED');

    // Test 5: touch updates lastActivity
    console.log('\n[TEST] Testing touch()...');
    const before = session.lastActivity;
    await new Promise(resolve => setTimeout(resolve, 10));
    session.touch();
    const after = session.lastActivity;
    if (after <= before) {
      throw new Error('touch() did not update lastActivity');
    }
    console.log('[TEST] touch verified: PASSED');

    console.log('\n[TEST] All tests PASSED!');
    console.log('WebSession test PASSED');

    // Clean up
    rmSync(tempSessionsDir, { recursive: true, force: true });
    console.log(`\n[TEST] Cleaned up temp directory: ${tempSessionsDir}`);

  } catch (error) {
    console.error('\n[TEST] Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
