/**
 * MultiStepPlanner - Decomposes complex tasks into sequential sub-tasks
 *
 * Responsibilities:
 * - Heuristically detect if a task needs decomposition
 * - Use LLM to break complex tasks into 2-5 sequential sub-tasks
 * - Execute each sub-task via MasterAgent with accumulated context
 * - Aggregate plans and costs across all steps
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MultiStepPlanner {
  constructor(masterAgent, options = {}) {
    this.masterAgent = masterAgent;
    this.maxSteps = options.maxSteps || 5;
  }

  /**
   * Determine if task needs decomposition using heuristics (NO LLM call).
   * @param {string} task
   * @returns {{needsDecomposition: boolean, reason: string}}
   */
  shouldDecompose(task) {
    // Check 1: Task has 3+ sentences
    const sentences = task.split(/[.!?]/).filter(s => s.trim().length > 0);
    if (sentences.length >= 3) {
      return {
        needsDecomposition: true,
        reason: `Task has ${sentences.length} sentences (threshold: 3+)`
      };
    }

    // Check 2: Contains sequential language patterns
    const sequentialPatterns = [
      'and then',
      'first...then',
      'step 1',
      'after that',
      'followed by'
    ];
    const taskLower = task.toLowerCase();
    for (const pattern of sequentialPatterns) {
      if (taskLower.includes(pattern)) {
        return {
          needsDecomposition: true,
          reason: `Task contains sequential pattern: "${pattern}"`
        };
      }
    }

    // Check 3: Length > 300 characters
    if (task.length > 300) {
      return {
        needsDecomposition: true,
        reason: `Task length ${task.length} exceeds 300 characters`
      };
    }

    // Default: no decomposition needed
    return {
      needsDecomposition: false,
      reason: 'Task is simple enough for single-step'
    };
  }

  /**
   * Decompose task into sequential sub-tasks using LLM.
   * @param {string} task
   * @param {Object} context - Additional context for decomposition
   * @returns {Promise<Array<{step: number, subtask: string}>>}
   */
  async decompose(task, _context = {}) {
    console.log('[MULTI-STEP] Decomposing task into sub-tasks...');

    try {
      // Load system prompt
      const systemPromptPath = join(__dirname, '../prompts/decompose-system.txt');
      const systemPrompt = readFileSync(systemPromptPath, 'utf8');

      // Build messages
      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: task }
      ];

      // Call LLM
      const result = await this.masterAgent.llmClient.chat(messages, {
        task: 'task_decomposition',
        max_tokens: 2048,
        temperature: 0.3
      });

      // Parse numbered list from response
      const lines = result.content.split('\n');
      const steps = [];

      for (const line of lines) {
        const match = line.match(/^(\d+)\.\s+(.+)$/);
        if (match) {
          const stepNum = parseInt(match[1], 10);
          const subtask = match[2].trim();
          steps.push({ step: stepNum, subtask });
        }
      }

      // Validate and limit to maxSteps
      if (steps.length === 0) {
        console.warn('[MULTI-STEP] LLM response contained no numbered list, falling back to single-step');
        return [{ step: 1, subtask: task }];
      }

      if (steps.length > this.maxSteps) {
        console.warn(`[MULTI-STEP] LLM returned ${steps.length} steps, limiting to ${this.maxSteps}`);
        steps.splice(this.maxSteps);
      }

      console.log(`[MULTI-STEP] Decomposed into ${steps.length} sub-tasks`);
      return steps;

    } catch (error) {
      console.error(`[MULTI-STEP] Decomposition failed: ${error.message}`);
      console.log('[MULTI-STEP] Falling back to single-step execution');
      return [{ step: 1, subtask: task }];
    }
  }

  /**
   * Execute all sub-tasks sequentially, accumulating context.
   * @param {Array<{step: number, subtask: string}>} steps
   * @param {string} projectRoot
   * @param {Object} callbacks - { onPlanGenerated, onApproval, onApplied }
   * @returns {Promise<{plans: Array, totalCost: number, status: string, error?: string}>}
   */
  async executeSteps(steps, projectRoot, callbacks = {}) {
    const plans = [];
    let totalCost = 0;
    let accumulatedContext = '';

    for (const step of steps) {
      console.log(`[MULTI-STEP] Step ${step.step}/${steps.length}: ${step.subtask}`);

      // Build task with accumulated context from prior steps
      const taskWithContext = accumulatedContext
        ? `Previous completed steps:\n${accumulatedContext}\n\nCurrent task: ${step.subtask}`
        : step.subtask;

      try {
        const plan = await this.masterAgent.run(taskWithContext, projectRoot);
        totalCost += plan.cost || 0;

        if (callbacks.onPlanGenerated) {
          await callbacks.onPlanGenerated(plan, step);
        }

        plans.push(plan);

        // Add this step's summary to accumulated context
        accumulatedContext += `\nStep ${step.step}: ${step.subtask} - ${plan.summary || 'completed'}\n`;
        accumulatedContext += `Files: ${(plan.operations || []).map(op => op.filePath).join(', ')}\n`;

      } catch (error) {
        console.error(`[MULTI-STEP] Step ${step.step} failed: ${error.message}`);
        return {
          plans,
          totalCost,
          status: 'partial_failure',
          error: error.message
        };
      }
    }

    return { plans, totalCost, status: 'completed' };
  }
}

// Export for use
export default MultiStepPlanner;

// --test Block
if (process.argv.includes('--test')) {
  console.log('Testing MultiStepPlanner...\n');

  // Mock MasterAgent
  const mockMasterAgent = {
    llmClient: {
      async chat() {
        throw new Error('mock failure');
      }
    },
    async run(_task) {
      return {
        summary: 'mock plan',
        cost: 0,
        operations: [],
        provider: 'mock',
        model: 'mock'
      };
    }
  };

  const planner = new MultiStepPlanner(mockMasterAgent);

  // Test 1: Simple task should not need decomposition
  console.log('Test 1: Simple task');
  const simple = planner.shouldDecompose('fix typo');
  console.log(`  Result: ${simple.needsDecomposition} (expected: false)`);
  console.log(`  Reason: ${simple.reason}`);
  if (simple.needsDecomposition) {
    throw new Error('Test 1 failed: simple task incorrectly flagged for decomposition');
  }

  // Test 2: Complex multi-sentence task should need decomposition
  console.log('\nTest 2: Complex multi-sentence task');
  const complex = planner.shouldDecompose('First create the database schema. Then implement the API endpoints. After that, add authentication middleware.');
  console.log(`  Result: ${complex.needsDecomposition} (expected: true)`);
  console.log(`  Reason: ${complex.reason}`);
  if (!complex.needsDecomposition) {
    throw new Error('Test 2 failed: complex task not flagged for decomposition');
  }

  // Test 3: Long task (>300 chars) should need decomposition
  console.log('\nTest 3: Long task (>300 chars)');
  const longTask = 'a'.repeat(301);
  const long = planner.shouldDecompose(longTask);
  console.log(`  Result: ${long.needsDecomposition} (expected: true)`);
  console.log(`  Reason: ${long.reason}`);
  if (!long.needsDecomposition) {
    throw new Error('Test 3 failed: long task not flagged for decomposition');
  }

  // Test 4: Decompose fallback when LLM fails
  console.log('\nTest 4: Decompose fallback on LLM failure');
  (async () => {
    const steps = await planner.decompose('create a user auth system');
    console.log(`  Result: ${steps.length} step(s) (expected: 1)`);
    console.log(`  Step 1 subtask: "${steps[0].subtask}"`);
    if (steps.length !== 1 || steps[0].subtask !== 'create a user auth system') {
      throw new Error('Test 4 failed: fallback did not return single-step with original task');
    }

    console.log('\nMultiStepPlanner test PASSED');
  })();
}
