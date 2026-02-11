/**
 * plan-engine.js
 * Parses LLM output into structured Plan objects and generates unified diffs.
 *
 * @module core/plan-engine
 */

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import fs from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * PlanEngine - Parses LLM output into structured Plan objects
 */
export class PlanEngine {
  /**
   * Parse LLM output into a structured Plan object.
   * @param {string} llmOutput - Raw text from LLM
   * @param {string} task - Original task description
   * @param {Object} meta - { agent, provider, model, cost }
   * @returns {Object} Plan object
   */
  parse(llmOutput, task, meta = {}) {
    console.log('[PLAN] Parsing LLM output...');

    const plan = {
      id: `plan_${Date.now()}`,
      task: task || 'No task description',
      agent: meta.agent || 'unknown',
      provider: meta.provider || 'unknown',
      model: meta.model || 'unknown',
      cost: meta.cost || 0.0,
      createdAt: new Date().toISOString(),
      status: 'pending',
      summary: '',
      operations: []
    };

    // Extract summary
    const summaryMatch = llmOutput.match(/##\s*SUMMARY\s*\n+(.*?)(?=\n##|\n```|$)/is);
    if (summaryMatch) {
      plan.summary = summaryMatch[1].trim();
    } else {
      plan.summary = 'No summary provided';
    }

    // Split on ## FILE: to get file blocks
    const fileBlocks = llmOutput.split(/(?=##\s*FILE:)/g).filter(block => block.includes('## FILE:'));

    console.log(`[PLAN] Found ${fileBlocks.length} file blocks`);

    for (const block of fileBlocks) {
      const operation = this._parseFileBlock(block);
      if (operation) {
        plan.operations.push(operation);
      }
    }

    console.log(`[PLAN] Parsed plan with ${plan.operations.length} operations`);
    return plan;
  }

  /**
   * Parse a single file block from LLM output
   * @private
   */
  _parseFileBlock(block) {
    // Extract file path
    const filePathMatch = block.match(/##\s*FILE:\s*(.+?)(?=\n|$)/i);
    if (!filePathMatch) {
      console.warn('[PLAN] Could not extract file path from block');
      return null;
    }
    const filePath = filePathMatch[1].trim();

    // Extract action
    const actionMatch = block.match(/##\s*ACTION:\s*(.+?)(?=\n|$)/i);
    if (!actionMatch) {
      console.warn(`[PLAN] Could not extract action for file: ${filePath}`);
      return null;
    }
    const action = actionMatch[1].trim().toLowerCase();

    // Validate action type
    if (!['create', 'modify', 'delete'].includes(action)) {
      console.warn(`[PLAN] Invalid action type "${action}" for file: ${filePath}`);
      return null;
    }

    // Extract description
    const descriptionMatch = block.match(/##\s*DESCRIPTION:\s*(.+?)(?=\n|$)/i);
    const description = descriptionMatch ? descriptionMatch[1].trim() : 'No description';

    // Extract content from code block
    const codeBlockMatch = block.match(/```(?:\w+)?\s*\n([\s\S]*?)```/);
    const content = codeBlockMatch ? codeBlockMatch[1] : null;

    // Build operation object
    const operation = {
      type: action,
      filePath: filePath,
      description: description,
      original: null,
      modified: null,
      diff: null
    };

    // Set original/modified based on action type
    if (action === 'create') {
      operation.modified = content;
      operation.diff = this.generateDiff('', content || '', filePath);
    } else if (action === 'modify') {
      operation.modified = content;
      // original will be loaded later by master-agent
      // For now, we'll generate a placeholder diff
      operation.diff = '--- Original content will be loaded at runtime\n+++ Modified content provided';
    } else if (action === 'delete') {
      operation.original = content; // May be null
      operation.diff = this.generateDiff(content || '', '', filePath);
    }

    return operation;
  }

  /**
   * Generate a unified diff string for a file modification.
   * Simple line-by-line comparison without external libraries.
   * @param {string} original - Original file content
   * @param {string} modified - Modified file content
   * @param {string} filePath - File path for diff header
   * @returns {string} Unified diff format
   */
  generateDiff(original, modified, filePath) {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');

    const diff = [];
    diff.push(`--- a/${filePath}`);
    diff.push(`+++ b/${filePath}`);
    diff.push(`@@ -1,${originalLines.length} +1,${modifiedLines.length} @@`);

    // Simple line-by-line diff
    const maxLines = Math.max(originalLines.length, modifiedLines.length);

    for (let i = 0; i < maxLines; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];

      if (origLine === undefined && modLine !== undefined) {
        // Line added
        diff.push(`+${modLine}`);
      } else if (modLine === undefined && origLine !== undefined) {
        // Line removed
        diff.push(`-${origLine}`);
      } else if (origLine !== modLine) {
        // Line changed
        diff.push(`-${origLine}`);
        diff.push(`+${modLine}`);
      } else {
        // Line unchanged (context)
        diff.push(` ${origLine}`);
      }
    }

    return diff.join('\n');
  }

  /**
   * Validate a plan's operations.
   * @param {Object} plan - Plan object to validate
   * @param {string} projectRoot - Absolute path to project root
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(plan, projectRoot) {
    console.log('[PLAN] Validating plan...');

    const errors = [];

    if (!plan || !plan.operations) {
      errors.push('Invalid plan structure: missing operations');
      return { valid: false, errors };
    }

    for (const op of plan.operations) {
      // Check for path traversal attempts
      const absolutePath = path.resolve(projectRoot, op.filePath);
      if (!absolutePath.startsWith(path.resolve(projectRoot))) {
        errors.push(`Security error: File path "${op.filePath}" attempts to escape project root`);
        continue;
      }

      // Check file existence based on operation type
      const fileExists = fs.existsSync(absolutePath);

      if (op.type === 'modify' && !fileExists) {
        errors.push(`Warning: Cannot modify "${op.filePath}" - file does not exist`);
      } else if (op.type === 'create' && fileExists) {
        errors.push(`Warning: Cannot create "${op.filePath}" - file already exists`);
      } else if (op.type === 'delete' && !fileExists) {
        errors.push(`Warning: Cannot delete "${op.filePath}" - file does not exist`);
      }

      // Validate operation structure
      if (!op.filePath) {
        errors.push('Invalid operation: missing filePath');
      }
      if (!op.type || !['create', 'modify', 'delete'].includes(op.type)) {
        errors.push(`Invalid operation type: ${op.type}`);
      }
    }

    const valid = errors.length === 0;
    console.log(`[PLAN] Validation ${valid ? 'passed' : 'failed'} with ${errors.length} error(s)`);

    return { valid, errors };
  }
}

// Singleton instance
const planEngine = new PlanEngine();
export default planEngine;

// --test block
if (process.argv.includes('--test')) {
  console.log('\n[PLAN] Running self-test...\n');

  // Sample LLM output
  const sampleLlmOutput = `## SUMMARY
Added a greeting function to index.js and created a new utility file

## FILE: src/index.js
## ACTION: modify
## DESCRIPTION: Add greeting function
\`\`\`javascript
// index.js - Main entry point
export function greet(name) {
  return \`Hello, \${name}!\`;
}

export function main() {
  console.log(greet('World'));
}
\`\`\`

## FILE: src/utils.js
## ACTION: create
## DESCRIPTION: New utility file for helper functions
\`\`\`javascript
// utils.js - Utility functions
export function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function formatDate(date) {
  return date.toISOString().split('T')[0];
}
\`\`\`

## FILE: src/old-file.js
## ACTION: delete
## DESCRIPTION: Remove deprecated file
\`\`\`javascript
// This file is no longer needed
\`\`\`
`;

  // Parse the output
  const plan = planEngine.parse(sampleLlmOutput, 'Add greeting functionality', {
    agent: 'local',
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    cost: 0.0
  });

  // Display results
  console.log('Plan ID:', plan.id);
  console.log('Task:', plan.task);
  console.log('Summary:', plan.summary);
  console.log('Agent:', plan.agent);
  console.log('Provider:', plan.provider);
  console.log('Model:', plan.model);
  console.log('Cost:', plan.cost);
  console.log('Status:', plan.status);
  console.log('Created At:', plan.createdAt);
  console.log('\nOperations:', plan.operations.length);

  for (let i = 0; i < plan.operations.length; i++) {
    const op = plan.operations[i];
    console.log(`\n--- Operation ${i + 1} ---`);
    console.log('Type:', op.type);
    console.log('File Path:', op.filePath);
    console.log('Description:', op.description);
    console.log('\nDiff Preview (first 20 lines):');
    const diffLines = op.diff.split('\n').slice(0, 20);
    console.log(diffLines.join('\n'));
    if (op.diff.split('\n').length > 20) {
      console.log('... (truncated)');
    }
  }

  // Test validation
  console.log('\n--- Validation Test ---');
  const validation = planEngine.validate(plan, process.cwd());
  console.log('Valid:', validation.valid);
  console.log('Errors:', validation.errors);

  // Test diff generation
  console.log('\n--- Diff Generation Test ---');
  const originalContent = 'line 1\nline 2\nline 3';
  const modifiedContent = 'line 1\nline 2 modified\nline 3\nline 4';
  const diff = planEngine.generateDiff(originalContent, modifiedContent, 'test.txt');
  console.log(diff);

  // Write sample output to test directory
  const testDir = path.join(path.dirname(__dirname), '..', 'test');
  if (!fs.existsSync(testDir)) {
    fs.mkdirSync(testDir, { recursive: true });
  }

  const sampleOutputPath = path.join(testDir, 'sample-llm-output.txt');
  fs.writeFileSync(sampleOutputPath, sampleLlmOutput, 'utf8');
  console.log(`\n[PLAN] Sample LLM output written to: ${sampleOutputPath}`);

  console.log('\n[PLAN] Self-test completed successfully!\n');
}
