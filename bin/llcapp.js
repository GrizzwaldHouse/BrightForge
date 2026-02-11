#!/usr/bin/env node

/**
 * LLCApp CLI - Hybrid Developer Coding Agent
 *
 * Usage:
 *   llcapp <task>                    Generate a plan for a coding task
 *   llcapp <task> --project <path>   Target a specific project directory
 *   llcapp --rollback                Rollback last applied changes
 *   llcapp --history                 Show recent session history
 *   llcapp --auto-approve            Skip approval prompt (use with caution)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../.env.local') });

// Import components
import { MasterAgent } from '../src/agents/master-agent.js';
import { DiffApplier } from '../src/core/diff-applier.js';
import { SessionLog } from '../src/core/session-log.js';
import { Terminal } from '../src/ui/terminal.js';

/**
 * Parse CLI arguments into a structured object.
 */
function parseArgs(argv) {
  const args = {
    task: null,
    project: process.cwd(),
    rollback: false,
    history: false,
    autoApprove: false,
    help: false
  };

  const raw = argv.slice(2);
  const taskParts = [];

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];

    if (arg === '--project' || arg === '-p') {
      args.project = raw[++i];
    } else if (arg === '--rollback') {
      args.rollback = true;
    } else if (arg === '--history') {
      args.history = true;
    } else if (arg === '--auto-approve' || arg === '--yes' || arg === '-y') {
      args.autoApprove = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (!arg.startsWith('--')) {
      taskParts.push(arg);
    }
  }

  if (taskParts.length > 0) {
    args.task = taskParts.join(' ');
  }

  // Resolve project path to absolute
  args.project = resolve(args.project);

  return args;
}

/**
 * Print usage help.
 */
function showHelp(terminal) {
  terminal.header('LLCApp Coding Agent');
  console.log('Usage:');
  console.log('  llcapp <task>                    Generate a coding plan');
  console.log('  llcapp <task> --project <path>   Target a specific project');
  console.log('  llcapp --rollback                Undo last applied changes');
  console.log('  llcapp --history                 Show session history');
  console.log('');
  console.log('Options:');
  console.log('  --project, -p <path>   Target project directory (default: cwd)');
  console.log('  --auto-approve, -y     Skip approval prompt');
  console.log('  --rollback             Rollback last applied plan');
  console.log('  --history              Show recent session logs');
  console.log('  --help, -h             Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  llcapp "add a loading spinner to index.html"');
  console.log('  llcapp "create a REST API endpoint for users" --project ./my-api');
  console.log('  llcapp --rollback --project ./my-api');
}

/**
 * Show recent session history.
 */
async function showHistory(sessionsDir, terminal) {
  const sessionLog = new SessionLog();
  const sessions = await sessionLog.loadRecent(sessionsDir, 10);

  if (sessions.length === 0) {
    terminal.log('No session history found.', 'info');
    return;
  }

  terminal.header('Session History');
  for (const session of sessions) {
    const opCount = session.operations ? session.operations.length : 0;
    const cost = session.cost != null ? `$${session.cost.toFixed(4)}` : '$0.0000';
    const status = session.status || 'unknown';
    console.log(`  ${session.createdAt || 'unknown date'} | ${status} | ${cost} | ${opCount} file(s)`);
    console.log(`    Task: ${session.task || 'unknown'}`);
    console.log(`    Provider: ${session.provider || 'unknown'} (${session.model || 'unknown'})`);
    console.log('');
  }
}

/**
 * Rollback the most recent applied plan.
 */
async function rollbackLast(projectRoot, sessionsDir, terminal) {
  const sessionLog = new SessionLog();
  const lastPlan = await sessionLog.loadLast(sessionsDir);

  if (!lastPlan) {
    terminal.log('No session found to rollback.', 'error');
    return;
  }

  if (lastPlan.status !== 'applied') {
    terminal.log(`Last session status is "${lastPlan.status}" - can only rollback "applied" plans.`, 'warning');
    return;
  }

  terminal.log(`Rolling back plan: ${lastPlan.task}`, 'info');
  terminal.log(`${lastPlan.operations.length} operation(s) to restore`, 'info');

  const applier = new DiffApplier();
  const result = await applier.rollback(lastPlan, projectRoot);

  if (result.errors && result.errors.length > 0) {
    for (const err of result.errors) {
      terminal.log(err, 'error');
    }
  }

  terminal.log(`Restored ${result.restored} file(s)`, 'success');

  // Update session status
  lastPlan.status = 'rolled_back';
  await sessionLog.record(lastPlan, sessionsDir);
}

/**
 * Main: run the plan-review-run workflow.
 */
async function runTask(task, projectRoot, autoApprove, sessionsDir, terminal) {
  // Validate project directory
  if (!existsSync(projectRoot)) {
    terminal.log(`Project directory not found: ${projectRoot}`, 'error');
    process.exit(1);
  }

  terminal.header('LLCApp Coding Agent');
  terminal.log(`Task: ${task}`, 'info');
  terminal.log(`Project: ${projectRoot}`, 'info');
  console.log('');

  // 1. Generate plan
  const spin = terminal.spinner('Generating plan...');
  let plan;
  try {
    const master = new MasterAgent();
    plan = await master.run(task, projectRoot);
    spin.stop('Plan generated');
  } catch (error) {
    spin.stop('Plan generation failed');
    terminal.log(`Error: ${error.message}`, 'error');
    process.exit(1);
  }

  // 2. Check if plan has operations
  if (!plan.operations || plan.operations.length === 0) {
    terminal.log('No file operations generated. The LLM may not have understood the task.', 'warning');
    terminal.log('Try rephrasing your task or providing more context.', 'info');
    process.exit(0);
  }

  // 3. Display plan summary and diffs
  terminal.showSummary(plan);
  terminal.showPlan(plan);

  // 4. Prompt for approval (unless auto-approve)
  let decision;
  if (autoApprove) {
    terminal.log('Auto-approve enabled - applying changes', 'warning');
    decision = 'approve';
  } else {
    decision = await terminal.promptApproval('Apply these changes? [y/n] ');
  }

  if (decision === 'reject') {
    plan.status = 'rejected';
    terminal.log('Changes rejected. No files were modified.', 'info');

    // Log the rejected plan
    const sessionLog = new SessionLog();
    await sessionLog.record(plan, sessionsDir);
    return;
  }

  // 5. Apply changes
  terminal.log('Applying changes...', 'info');
  const applier = new DiffApplier();
  const result = await applier.apply(plan, projectRoot);

  if (result.failed > 0) {
    terminal.log(`Applied ${result.applied} file(s), ${result.failed} failed`, 'warning');
    for (const err of result.errors) {
      terminal.log(err, 'error');
    }
    plan.status = 'failed';
  } else {
    terminal.log(`Successfully applied ${result.applied} file change(s)`, 'success');
    plan.status = 'applied';
  }

  // 6. Log session
  const sessionLog = new SessionLog();
  const logPath = await sessionLog.record(plan, sessionsDir);
  terminal.log(`Session logged: ${logPath}`, 'info');

  // 7. Show usage summary
  console.log('');
  terminal.log(`Cost: $${plan.cost.toFixed(4)} | Provider: ${plan.provider} | Model: ${plan.model}`, 'info');
  terminal.log('Run with --rollback to undo these changes', 'info');
}

/**
 * Entry point.
 */
async function main() {
  const terminal = new Terminal();
  const args = parseArgs(process.argv);
  const sessionsDir = join(args.project, '..', 'sessions');
  // Use LLCApp's sessions dir, not the target project's
  const appSessionsDir = join(__dirname, '../sessions');

  if (args.help) {
    showHelp(terminal);
    process.exit(0);
  }

  if (args.history) {
    await showHistory(appSessionsDir, terminal);
    process.exit(0);
  }

  if (args.rollback) {
    await rollbackLast(args.project, appSessionsDir, terminal);
    process.exit(0);
  }

  if (!args.task) {
    showHelp(terminal);
    terminal.log('Error: No task provided. Pass a task description as the first argument.', 'error');
    process.exit(1);
  }

  await runTask(args.task, args.project, args.autoApprove, appSessionsDir, terminal);
}

main().catch((error) => {
  console.error(`[FATAL] ${error.message}`);
  process.exit(1);
});
