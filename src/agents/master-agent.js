/**
 * MasterAgent - Orchestrator for plan-review-run workflow
 *
 * Responsibilities:
 * - Classify task complexity (simple/moderate/complex)
 * - Select appropriate agent (LocalAgent or CloudAgent)
 * - Scan project files for context
 * - Generate structured plans via LLM
 * - Parse and validate plans
 * - Generate diffs for file operations
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { UniversalLLMClient } from '../core/llm-client.js';
import { PlanEngine } from '../core/plan-engine.js';
import { FileContext } from '../core/file-context.js';
import { LocalAgent } from './local-agent.js';
import { CloudAgent } from './cloud-agent.js';
import telemetryBus from '../core/telemetry-bus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class MasterAgent {
  constructor(options = {}) {
    // Load agent config
    const configPath = join(__dirname, '../../config/agent-config.yaml');
    try {
      const fullConfig = parseYaml(readFileSync(configPath, 'utf8'));
      this.config = fullConfig.master_agent;
    } catch (error) {
      console.warn('[MASTER] Could not load config, using defaults:', error.message);
      this.config = this.getDefaultConfig();
    }

    // Initialize components
    this.llmClient = options.llmClient || new UniversalLLMClient();
    this.planEngine = new PlanEngine();
    this.fileContext = new FileContext();
    this.localAgent = new LocalAgent(this.llmClient);
    this.cloudAgent = new CloudAgent(this.llmClient);
  }

  getDefaultConfig() {
    return {
      classification: {
        simple_keywords: ['fix', 'typo', 'rename', 'comment', 'format', 'lint', 'remove', 'delete'],
        complex_keywords: ['refactor', 'redesign', 'migrate', 'integrate', 'architecture', 'across modules'],
        complex_char_threshold: 200
      },
      file_context: {
        max_files: 15,
        max_file_size: 10000,
        max_total_tokens: 8000
      }
    };
  }

  /**
   * Classify task complexity using heuristics (NO LLM call).
   * @param {string} task
   * @returns {'simple' | 'moderate' | 'complex'}
   */
  classifyTask(task) {
    const taskLower = task.toLowerCase();

    // Check complex keywords first
    const complexKeywords = this.config.complexity_classifier?.complex?.keywords ||
                           this.config.classification?.complex_keywords ||
                           ['refactor', 'redesign', 'migrate', 'integrate', 'architecture', 'across modules'];

    for (const keyword of complexKeywords) {
      if (taskLower.includes(keyword)) {
        console.log(`[MASTER] Task classified as COMPLEX (keyword: "${keyword}")`);
        return 'complex';
      }
    }

    // Check task length threshold
    const threshold = this.config.classification?.complex_char_threshold || 200;
    if (task.length > threshold) {
      console.log(`[MASTER] Task classified as COMPLEX (length: ${task.length} > ${threshold})`);
      return 'complex';
    }

    // Check simple keywords
    const simpleKeywords = this.config.complexity_classifier?.simple?.keywords ||
                          this.config.classification?.simple_keywords ||
                          ['fix', 'typo', 'rename', 'comment', 'format', 'lint', 'remove', 'delete'];

    for (const keyword of simpleKeywords) {
      if (taskLower.includes(keyword)) {
        console.log(`[MASTER] Task classified as SIMPLE (keyword: "${keyword}")`);
        return 'simple';
      }
    }

    // Default to moderate
    console.log('[MASTER] Task classified as MODERATE (default)');
    return 'moderate';
  }

  /**
   * Select the appropriate agent based on complexity.
   * @param {'simple' | 'moderate' | 'complex'} complexity
   * @returns {import('./base-agent.js').BaseAgent}
   */
  selectAgent(complexity) {
    if (complexity === 'complex') {
      console.log('[MASTER] Selected CloudAgent for complex task');
      return this.cloudAgent;
    }
    console.log('[MASTER] Selected LocalAgent for simple/moderate task');
    return this.localAgent;
  }

  /**
   * Main entry: run the full plan generation workflow.
   * Does NOT handle approval/apply - that's the CLI's job.
   * @param {string} task - User's task description
   * @param {string} projectRoot - Absolute path to target project
   * @param {Object} options - { maxFiles, maxTokens }
   * @returns {Promise<Object>} Plan object
   */
  async run(task, projectRoot, options = {}) {
    console.log(`[MASTER] Starting task: "${task}"`);
    console.log(`[MASTER] Project root: ${projectRoot}`);
    const endTimer = telemetryBus.startTimer('plan_generated', { projectRoot });

    // 1. Scan project files for context
    console.log('[MASTER] Scanning project files...');
    const contextResult = await this.fileContext.scan(projectRoot, {
      maxFiles: options.maxFiles || this.config.file_context?.max_files,
      maxFileSize: options.maxFileSize || this.config.file_context?.max_file_size
    });
    console.log(`[MASTER] Found ${contextResult.files.length} files (~${contextResult.totalTokensEstimate} tokens)`);

    // 2. Classify task complexity
    const complexity = this.classifyTask(task);

    // 3. Select agent
    const agent = this.selectAgent(complexity);

    // 4. Generate plan via LLM
    console.log(`[MASTER] Generating plan with ${agent.name} agent...`);
    const llmResult = await agent.generatePlan(task, {
      files: contextResult.files,
      projectRoot
    }, {
      maxTokens: options.maxTokens || 4096
    });

    // 5. Parse LLM output into structured plan
    const plan = this.planEngine.parse(llmResult.content, task, {
      agent: agent.name,
      provider: llmResult.provider,
      model: llmResult.model,
      cost: llmResult.cost
    });

    // 6. For 'modify' operations, load original file content and generate diffs
    for (const op of plan.operations) {
      if (op.type === 'modify') {
        const fullPath = join(projectRoot, op.filePath);
        try {
          op.original = readFileSync(fullPath, 'utf8');
          op.diff = this.planEngine.generateDiff(op.original, op.modified, op.filePath);
        } catch (error) {
          console.warn(`[MASTER] Could not read original file ${op.filePath}: ${error.message}`);
          op.original = null;
          op.diff = `New file (original not found): ${op.filePath}`;
        }
      } else if (op.type === 'create') {
        // For create, diff is just all additions
        op.original = null;
        if (op.modified) {
          op.diff = this.planEngine.generateDiff('', op.modified, op.filePath);
        }
      } else if (op.type === 'delete') {
        const fullPath = join(projectRoot, op.filePath);
        try {
          op.original = readFileSync(fullPath, 'utf8');
          op.diff = this.planEngine.generateDiff(op.original, '', op.filePath);
        } catch (error) {
          op.original = null;
          op.diff = `Delete file: ${op.filePath}`;
        }
      }
    }

    // 7. Validate plan
    const validation = this.planEngine.validate(plan, projectRoot);
    if (!validation.valid) {
      console.warn('[MASTER] Plan validation warnings:');
      for (const error of validation.errors) {
        console.warn(`  - ${error}`);
      }
    }

    // 8. Log usage summary
    const usage = this.llmClient.getUsageSummary();
    console.log(`[MASTER] Plan generated. Cost: $${plan.cost.toFixed(4)}, Budget remaining: $${usage.budget_remaining.toFixed(4)}`);

    endTimer({ operations: plan.operations?.length || 0, cost: plan.cost, agent: agent.name });
    return plan;
  }
}

// Export for use
export default MasterAgent;

// --test Block
if (process.argv.includes('--test')) {
  console.log('Testing MasterAgent...\n');

  // Test classification
  const mockClient = {
    providers: {},
    taskRouting: {},
    budget: { daily_limit_usd: 1.0 },
    dailyUsage: { date: new Date().toISOString().split('T')[0], cost_usd: 0, requests: {}, tokens: {} },
    getUsageSummary() {
      return { ...this.dailyUsage, budget_remaining: this.budget.daily_limit_usd - this.dailyUsage.cost_usd };
    },
    async chat(_messages, _options) {
      return {
        content: '## SUMMARY\nAdded greeting function\n\n## FILE: index.js\n## ACTION: create\n## DESCRIPTION: Create index.js with greeting\n```javascript\nexport function greet(name) {\n  return `Hello, ${name}!`;\n}\n```',
        provider: 'mock',
        model: 'mock-model',
        cost: 0,
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 }
      };
    }
  };

  const master = new MasterAgent({ llmClient: mockClient });

  // Test classification
  console.log('Classification tests:');
  console.log(`  "fix typo in readme" -> ${master.classifyTask('fix typo in readme')}`);
  console.log(`  "add a login form" -> ${master.classifyTask('add a login form')}`);
  console.log(`  "refactor the auth module" -> ${master.classifyTask('refactor the auth module')}`);
  console.log(`  "${'a'.repeat(201)}" -> ${master.classifyTask('a'.repeat(201))}`);

  // Test agent selection
  console.log('\nAgent selection:');
  console.log(`  simple -> ${master.selectAgent('simple').name}`);
  console.log(`  moderate -> ${master.selectAgent('moderate').name}`);
  console.log(`  complex -> ${master.selectAgent('complex').name}`);

  console.log('\nMasterAgent test PASSED');
}
