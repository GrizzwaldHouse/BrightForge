import { createInterface } from 'readline';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m'
};

/**
 * Terminal output utility for plan-review-run workflow.
 * Provides colored output using ANSI escape codes.
 */
export class Terminal {
  /**
   * Display a plan's operations as colored diffs.
   * @param {Object} plan - Plan object with operations array
   */
  showPlan(plan) {
    if (!plan.operations || plan.operations.length === 0) {
      this.log('No operations in plan', 'warning');
      return;
    }

    console.log('');
    for (const operation of plan.operations) {
      // File header
      console.log(`${colors.cyan}--- ${operation.type.toUpperCase()} ${operation.filePath}${colors.reset}`);

      // Description
      if (operation.description) {
        console.log(`${colors.dim}${operation.description}${colors.reset}`);
      }

      // Diff output
      if (operation.diff) {
        console.log('');
        const lines = operation.diff.split('\n');
        for (const line of lines) {
          if (line.startsWith('+')) {
            console.log(`${colors.green}${line}${colors.reset}`);
          } else if (line.startsWith('-')) {
            console.log(`${colors.red}${line}${colors.reset}`);
          } else if (line.startsWith('@@')) {
            console.log(`${colors.magenta}${line}${colors.reset}`);
          } else {
            console.log(`${colors.dim}${line}${colors.reset}`);
          }
        }
      }

      // Separator
      console.log(`${colors.dim}${'─'.repeat(80)}${colors.reset}`);
      console.log('');
    }
  }

  /**
   * Prompt user for approval: y/n (yes/no).
   * Uses Node.js readline module.
   * @param {string} prompt - Prompt text
   * @returns {Promise<'approve' | 'reject'>}
   */
  async promptApproval(prompt = 'Apply these changes? [y/n] ') {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`${colors.yellow}${prompt}${colors.reset}`, (answer) => {
        rl.close();
        const normalized = answer.trim().toLowerCase();
        resolve(normalized === 'y' || normalized === 'yes' ? 'approve' : 'reject');
      });
    });
  }

  /**
   * Show a spinner during async operations.
   * @param {string} message - Message to show
   * @returns {{ stop: (finalMessage?: string) => void }}
   */
  spinner(message) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;
    const interval = setInterval(() => {
      process.stdout.write(`\r${colors.cyan}${frames[i]}${colors.reset} ${message}`);
      i = (i + 1) % frames.length;
    }, 80);

    return {
      stop: (finalMessage) => {
        clearInterval(interval);
        const msg = finalMessage || message;
        process.stdout.write(`\r${colors.green}✓${colors.reset} ${msg}\n`);
      }
    };
  }

  /**
   * Print a status message with color.
   * @param {string} message
   * @param {'info' | 'success' | 'warning' | 'error'} level
   */
  log(message, level = 'info') {
    const symbols = {
      info: `${colors.blue}ℹ${colors.reset}`,
      success: `${colors.green}✓${colors.reset}`,
      warning: `${colors.yellow}⚠${colors.reset}`,
      error: `${colors.red}✗${colors.reset}`
    };

    const symbol = symbols[level] || symbols.info;
    console.log(`${symbol} ${message}`);
  }

  /**
   * Print a header/banner.
   * @param {string} text
   */
  header(text) {
    const width = Math.max(text.length + 4, 30);
    const padding = Math.floor((width - text.length - 2) / 2);
    const leftPad = ' '.repeat(padding);
    const rightPad = ' '.repeat(width - text.length - padding - 2);

    console.log('');
    console.log(`${colors.bold}${colors.cyan}╔${'═'.repeat(width)}╗${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}║${leftPad}${text}${rightPad}║${colors.reset}`);
    console.log(`${colors.bold}${colors.cyan}╚${'═'.repeat(width)}╝${colors.reset}`);
    console.log('');
  }

  /**
   * Print plan summary (cost, provider, model).
   * @param {Object} plan
   */
  showSummary(plan) {
    console.log('');
    console.log(`${colors.bold}Provider:${colors.reset} ${plan.provider || 'unknown'} | ${colors.bold}Model:${colors.reset} ${plan.model || 'unknown'} | ${colors.bold}Cost:${colors.reset} $${(plan.cost || 0).toFixed(4)}`);

    if (plan.task) {
      console.log(`${colors.bold}Task:${colors.reset} ${plan.task}`);
    }

    if (plan.summary) {
      console.log(`${colors.bold}Summary:${colors.reset} ${plan.summary}`);
    }

    const opCount = plan.operations ? plan.operations.length : 0;
    console.log(`${colors.bold}Operations:${colors.reset} ${opCount} file(s)`);
    console.log('');
  }

  /**
   * Prompt user for free-form text input in conversation mode.
   * @param {string} prompt - Prompt text (default: 'brightforge> ')
   * @returns {Promise<string>} User's input text (empty string if no input)
   */
  async promptInput(prompt = 'brightforge> ') {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    return new Promise((resolve) => {
      rl.question(`${colors.cyan}${prompt}${colors.reset}`, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }
}

// Singleton instance
const terminal = new Terminal();
export default terminal;

// Self-test
if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`) {
  console.log('Running Terminal self-test...\n');

  // Sample plan
  const samplePlan = {
    provider: 'ollama',
    model: 'qwen2.5-coder:14b',
    cost: 0.0000,
    task: 'Add user authentication',
    summary: 'Implement JWT-based authentication with login and logout',
    operations: [
      {
        type: 'modify',
        filePath: 'src/auth/login.js',
        description: 'Add JWT token generation',
        diff: `@@ -10,6 +10,8 @@ export function login(username, password) {
   if (!user) {
     throw new Error('Invalid credentials');
   }
+  const token = jwt.sign({ userId: user.id }, SECRET_KEY);
+  return { user, token };
-  return { user };
 }`
      },
      {
        type: 'create',
        filePath: 'src/auth/middleware.js',
        description: 'Create authentication middleware'
      }
    ]
  };

  // Test header
  terminal.header('BrightForge Coding Agent');

  // Test summary
  terminal.showSummary(samplePlan);

  // Test log levels
  terminal.log('Starting plan execution', 'info');
  terminal.log('Validation passed', 'success');
  terminal.log('Deprecation warning', 'warning');
  terminal.log('Operation failed', 'error');
  console.log('');

  // Test plan display
  terminal.showPlan(samplePlan);

  // Test spinner
  console.log('Testing spinner...');
  const spin = terminal.spinner('Processing');
  setTimeout(() => {
    spin.stop('Processing complete');
    console.log('\nTerminal self-test complete!');
  }, 2000);
}
