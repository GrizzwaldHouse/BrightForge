#!/usr/bin/env node

/**
 * BrightForge CLI - Hybrid Developer Coding Agent
 *
 * Usage:
 *   brightforge <task>                    Generate a plan for a coding task
 *   brightforge <task> --project <path>   Target a specific project directory
 *   brightforge --rollback                Rollback last applied changes
 *   brightforge --history                 Show recent session history
 *   brightforge --auto-approve            Skip approval prompt (use with caution)
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
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
import { ConversationSession } from '../src/core/conversation-session.js';
import errorHandler from '../src/core/error-handler.js';

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
    chat: false,
    design: false,
    designStyle: 'default',
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
    } else if (arg === '--chat' || arg === '-c') {
      args.chat = true;
    } else if (arg === '--design' || arg === '-d') {
      args.design = true;
    } else if (arg === '--style' || arg === '-s') {
      args.designStyle = raw[++i];
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
  terminal.header('BrightForge Coding Agent');
  console.log('Usage:');
  console.log('  brightforge <task>                    Generate a coding plan');
  console.log('  brightforge <task> --project <path>   Target a specific project');
  console.log('  brightforge --chat                    Interactive conversation mode');
  console.log('  brightforge --design <prompt>         Generate AI-powered design');
  console.log('  brightforge --rollback                Undo last applied changes');
  console.log('  brightforge --history                 Show session history');
  console.log('');
  console.log('Options:');
  console.log('  --project, -p <path>   Target project directory (default: cwd)');
  console.log('  --auto-approve, -y     Skip approval prompt');
  console.log('  --chat, -c             Enter interactive conversation mode');
  console.log('  --design, -d <prompt>  Generate design with AI images + layout');
  console.log('  --style, -s <name>     Design style (default, blue-glass, dark-industrial)');
  console.log('  --rollback             Rollback last applied plan');
  console.log('  --history              Show recent session logs');
  console.log('  --help, -h             Show this help message');
  console.log('');
  console.log('Examples:');
  console.log('  brightforge "add a loading spinner to index.html"');
  console.log('  brightforge "create a REST API endpoint for users" --project ./my-api');
  console.log('  brightforge --design "landing page for a coffee shop"');
  console.log('  brightforge --design "portfolio site" --style blue-glass');
  console.log('  brightforge --rollback --project ./my-api');
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

  terminal.header('BrightForge Coding Agent');
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
 * Run interactive conversation mode.
 */
async function runChat(projectRoot, sessionsDir, terminal) {
  // Validate project directory
  if (!existsSync(projectRoot)) {
    terminal.log(`Project directory not found: ${projectRoot}`, 'error');
    process.exit(1);
  }

  const session = new ConversationSession({
    projectRoot,
    sessionsDir,
    terminal
  });

  await session.run();
}

/**
 * Run design generation mode.
 */
async function runDesign(prompt, style, terminal) {
  terminal.header('BrightForge Design Engine');
  terminal.log(`Design Brief: ${prompt}`, 'info');
  terminal.log(`Style: ${style}`, 'info');
  console.log('');

  // Import design engine
  const { designEngine } = await import('../src/core/design-engine.js');

  // Generate design
  const spin = terminal.spinner('Generating design (this may take 30-60 seconds)...');
  let design;
  try {
    design = await designEngine.generateDesign(prompt, {
      styleName: style
    });
    spin.stop('Design generated');
  } catch (error) {
    spin.stop('Design generation failed');
    terminal.log(`Error: ${error.message}`, 'error');
    process.exit(1);
  }

  // Show design preview
  terminal.log('Design generated successfully!', 'success');
  console.log('');
  console.log(`Images generated: ${design.images.length}`);
  design.images.forEach((img, i) => {
    console.log(`  ${i + 1}. ${img.role}: ${img.path}`);
  });
  console.log('');
  console.log(`HTML length: ${design.html.length} characters`);
  console.log(`Total cost: $${design.cost.toFixed(4)}`);
  console.log('');

  // Prompt for approval
  const decision = await terminal.promptApproval('Export design to output/designs/? [y/n] ');

  if (decision === 'approve') {
    try {
      const outputPath = await designEngine.exportDesign(design);
      terminal.log(`Design exported to: ${outputPath}`, 'success');
    } catch (error) {
      terminal.log(`Export failed: ${error.message}`, 'error');
      process.exit(1);
    }
  } else {
    terminal.log('Design discarded. No files were saved.', 'info');
  }
}

/**
 * Entry point.
 */
async function main() {
  const terminal = new Terminal();
  const args = parseArgs(process.argv);
  const sessionsDir = join(args.project, '..', 'sessions');
  // Use BrightForge's sessions dir, not the target project's
  const appSessionsDir = join(__dirname, '../sessions');

  // Initialize error handler (observer-pattern error broadcasting)
  errorHandler.initialize(appSessionsDir);

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

  if (args.chat) {
    await runChat(args.project, appSessionsDir, terminal);
    process.exit(0);
  }

  if (args.design) {
    if (!args.task) {
      showHelp(terminal);
      terminal.log('Error: No design prompt provided. Use --design "your prompt here"', 'error');
      process.exit(1);
    }
    await runDesign(args.task, args.designStyle, terminal);
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
  errorHandler.report('fatal', error, { source: 'cli-main' });
  process.exit(1);
});
