/**
 * Sandbox - Safe subprocess execution with environment isolation
 *
 * Hardened in P2:
 *   - spawnSync with shell:false — no shell interpolation ever
 *   - realpathSync confinement — symlink/junction escape blocked
 *   - Command path resolved via which/where to absolute path before exec
 *   - Deny-all env with SAFE_ENV_KEYS allowlist (not strip-sensitive)
 *   - maxBuffer: 10MB to prevent truncation on large outputs
 *   - Timeout enforced at spawnSync level
 *   - Metrics tracking: commandsBlocked, pathViolations, envKeysStripped, timeouts
 *
 * @author Marcus Daley (GrizzwaldHouse)
 */

import { spawnSync } from 'child_process';
import { resolve, normalize } from 'path';
import { existsSync, realpathSync } from 'fs';
import { fileURLToPath } from 'url';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';

// Deny-all: only these env keys are forwarded to child processes
const SAFE_ENV_KEYS = new Set([
  'PATH',
  'PATHEXT',           // Windows: executable extensions
  'HOME',
  'USERPROFILE',       // Windows: home dir
  'HOMEDRIVE',         // Windows
  'HOMEPATH',          // Windows
  'TEMP',
  'TMP',
  'TMPDIR',
  'NODE_ENV',
  'NODE_PATH',
  'NODE_OPTIONS',
  'npm_execpath',
  'npm_config_cache',
  'npm_lifecycle_event',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'FORCE_COLOR',
  'NO_COLOR',
  'SYSTEMROOT',        // Windows: needed by many tools
  'SYSTEMDRIVE',       // Windows
  'WINDIR',            // Windows
  'COMSPEC',           // Windows: cmd.exe path (needed by npx)
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS'
]);

// Commands that may be invoked via the sandbox
const ALLOWED_COMMANDS = new Set(['node', 'npx', 'python', 'python3', 'py']);

// Per-process lifetime metrics
const metrics = {
  commandsBlocked: 0,
  pathViolations: 0,
  envKeysStripped: 0,
  timeouts: 0,
  executions: 0
};

/**
 * Resolve command name to absolute path using OS which/where.
 * Returns null if command not found.
 * @param {string} base - bare command name (e.g. 'node')
 * @returns {string|null}
 */
function resolveCommandPath(base) {
  const isWindows = process.platform === 'win32';
  const whichCmd = isWindows ? 'where' : 'which';

  const result = spawnSync(whichCmd, [base], {
    shell: false,
    encoding: 'utf8',
    timeout: 5000,
    stdio: 'pipe'
  });

  if (result.status !== 0 || !result.stdout) return null;

  // `where` returns multiple lines on Windows; take the first
  const first = result.stdout.trim().split('\n')[0].trim();
  return first || null;
}

class Sandbox {
  /**
   * Build a clean env object using SAFE_ENV_KEYS allowlist.
   * Every key NOT in the allowlist is dropped.
   */
  buildEnv() {
    const safe = {};
    let stripped = 0;

    for (const [key, value] of Object.entries(process.env)) {
      if (SAFE_ENV_KEYS.has(key)) {
        safe[key] = value;
      } else {
        stripped++;
      }
    }

    metrics.envKeysStripped += stripped;
    return safe;
  }

  /**
   * Validate that filePath stays within projectRoot using realpathSync.
   * Resolves symlinks/junctions before comparing — prevents escape via symlink.
   *
   * @param {string} filePath - Absolute or relative file path
   * @param {string} projectRoot - Trusted project root
   * @returns {string} Real absolute path
   * @throws {Error} If path escapes project root
   */
  confinePath(filePath, projectRoot) {
    const root = resolve(projectRoot);
    const target = resolve(root, filePath);

    // If the target exists, resolve symlinks to get the real path
    let realTarget = target;
    if (existsSync(target)) {
      try {
        realTarget = realpathSync(target);
      } catch {
        // If realpath fails, fall back to logical path (file may be a new file not yet created)
        realTarget = target;
      }
    }

    // Also resolve symlinks in root
    let realRoot = root;
    try {
      realRoot = realpathSync(root);
    } catch {
      realRoot = root;
    }

    // Normalize separators to avoid bypass via mixed slashes
    const normalRoot = normalize(realRoot + '/');
    const normalTarget = normalize(realTarget);

    if (!normalTarget.startsWith(normalRoot) && normalTarget !== realRoot) {
      metrics.pathViolations++;
      throw new Error(`[SANDBOX] Path escape blocked: "${filePath}" escapes project root`);
    }

    return realTarget;
  }

  /**
   * Validate command against allowlist and resolve to absolute path.
   * @param {string} cmd
   * @returns {string} Absolute resolved command path
   * @throws {Error} If command not allowed or not found
   */
  validateCommand(cmd) {
    const base = cmd.split(/[\\/]/).pop().replace(/\.exe$/i, '').toLowerCase();
    if (!ALLOWED_COMMANDS.has(base)) {
      metrics.commandsBlocked++;
      throw new Error(`[SANDBOX] Command not allowed: "${cmd}". Permitted: ${[...ALLOWED_COMMANDS].join(', ')}`);
    }

    // Resolve to absolute path — prevents PATH manipulation attacks
    const resolved = resolveCommandPath(base);
    if (!resolved) {
      metrics.commandsBlocked++;
      throw new Error(`[SANDBOX] Command "${base}" not found on PATH`);
    }

    return resolved;
  }

  /**
   * Get current sandbox metrics snapshot.
   */
  getMetrics() {
    return { ...metrics };
  }

  /**
   * Run a command safely inside the sandbox.
   *
   * @param {string} cmd - Command binary (e.g. 'node', 'npx')
   * @param {string[]} args - Arguments as an array (never shell-interpolated)
   * @param {Object} options
   * @param {string} [options.cwd] - Working directory (must be inside projectRoot if projectRoot set)
   * @param {string} [options.projectRoot] - Confines cwd to this root when provided
   * @param {number} [options.timeout=30000] - Timeout in ms
   * @returns {{ stdout: string, stderr: string, status: number, timedOut: boolean }}
   */
  run(cmd, args, options = {}) {
    const { timeout = 30000, projectRoot } = options;

    const resolvedCmd = this.validateCommand(cmd);

    // Resolve and validate cwd
    let cwd = options.cwd || process.cwd();
    if (projectRoot) {
      try {
        cwd = this.confinePath(cwd, projectRoot);
      } catch {
        cwd = resolve(projectRoot);
      }
    }

    if (!existsSync(cwd)) {
      throw new Error(`[SANDBOX] Working directory does not exist: "${cwd}"`);
    }

    const endTimer = telemetryBus.startTimer('sandbox_exec', { cmd, cwd });
    metrics.executions++;

    const result = spawnSync(resolvedCmd, args, {
      shell: false,
      cwd,
      env: this.buildEnv(),
      encoding: 'utf8',
      timeout,
      maxBuffer: 10 * 1024 * 1024,  // 10MB
      stdio: 'pipe'
    });

    const timedOut = result.signal === 'SIGTERM' || result.error?.code === 'ETIMEDOUT';
    if (timedOut) metrics.timeouts++;

    endTimer({
      status: result.status,
      timedOut,
      cmd
    });

    if (result.error && !timedOut) {
      errorHandler.report('agent_error', result.error, { cmd, cwd });
    }

    return {
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      status: result.status ?? 1,
      timedOut
    };
  }

  /**
   * Run a JS file with node --test flag, confined to projectRoot.
   */
  runNodeTest(filePath, projectRoot, timeout = 30000) {
    const confined = this.confinePath(filePath, projectRoot);
    return this.run('node', [confined, '--test'], { cwd: projectRoot, timeout });
  }

  /**
   * Run ESLint on a list of files, confined to projectRoot.
   */
  runEslint(files, projectRoot, timeout = 30000) {
    const confined = files.map(f => this.confinePath(f, projectRoot));
    return this.run('npx', ['eslint', ...confined, '--format', 'json'], {
      cwd: projectRoot,
      timeout
    });
  }
}

const sandbox = new Sandbox();
export default sandbox;
export { Sandbox };

// --test block
const __sbFilename = fileURLToPath(import.meta.url);
if (process.argv.includes('--test') && process.argv[1] === __sbFilename) {
  console.log('\n[SANDBOX] Running self-test (P2 hardened)...\n');

  const { dirname: _dirname } = await import('path');
  const projectRoot = _dirname(__sbFilename);

  let passed = 0;
  let failed = 0;

  const assert = (label, condition) => {
    if (condition) {
      console.log(`  ✓ ${label}`);
      passed++;
    } else {
      console.error(`  ✗ ${label}`);
      failed++;
    }
  };

  // 1. buildEnv — deny-all: API keys are excluded
  {
    const origKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'test-secret';
    const env = sandbox.buildEnv();
    assert('buildEnv excludes GROQ_API_KEY (deny-all)', !('GROQ_API_KEY' in env));
    process.env.GROQ_API_KEY = origKey;
  }

  // 2. buildEnv — allows PATH
  {
    const env = sandbox.buildEnv();
    assert('buildEnv allows PATH', 'PATH' in env);
  }

  // 3. buildEnv — NODE_ENV allowed
  {
    process.env.NODE_ENV = 'test';
    const env = sandbox.buildEnv();
    assert('buildEnv allows NODE_ENV', env.NODE_ENV === 'test');
  }

  // 4. buildEnv — random non-allowlisted key excluded
  {
    process.env.__BRIGHTFORGE_TEST_SECRET = 'leaked';
    const env = sandbox.buildEnv();
    assert('buildEnv excludes arbitrary keys', !('__BRIGHTFORGE_TEST_SECRET' in env));
    delete process.env.__BRIGHTFORGE_TEST_SECRET;
  }

  // 5. confinePath — safe path
  {
    try {
      const result = sandbox.confinePath('src/core/diff-applier.js', projectRoot);
      assert('confinePath accepts safe path', typeof result === 'string' && result.length > 0);
    } catch {
      assert('confinePath accepts safe path', false);
    }
  }

  // 6. confinePath — traversal blocked
  {
    try {
      sandbox.confinePath('../../etc/passwd', projectRoot);
      assert('confinePath blocks traversal', false);
    } catch (e) {
      assert('confinePath blocks traversal', e.message.includes('Path escape blocked'));
    }
  }

  // 7. validateCommand — allowed command resolves to absolute path
  {
    try {
      const resolved = sandbox.validateCommand('node');
      assert('validateCommand resolves node to absolute path', resolved.includes('node'));
    } catch {
      assert('validateCommand resolves node to absolute path', false);
    }
  }

  // 8. validateCommand — blocked command
  {
    try {
      sandbox.validateCommand('rm');
      assert('validateCommand blocks rm', false);
    } catch (e) {
      assert('validateCommand blocks rm', e.message.includes('not allowed'));
    }
  }

  // 9. validateCommand — blocks .exe bypass on Windows
  {
    try {
      sandbox.validateCommand('cmd.exe');
      assert('validateCommand blocks cmd.exe', false);
    } catch (e) {
      assert('validateCommand blocks cmd.exe', e.message.includes('not allowed'));
    }
  }

  // 10. run — real node execution
  {
    const result = sandbox.run('node', ['-e', 'process.stdout.write("hello")'], {
      cwd: projectRoot
    });
    assert('run executes node -e', result.stdout === 'hello' && result.status === 0);
  }

  // 11. run — shell injection in args is inert
  {
    const malicious = '; echo INJECTED';
    const result = sandbox.run('node', ['-e', 'process.exit(0)', malicious], {
      cwd: projectRoot
    });
    assert('run treats injected arg as literal (no INJECTED in stdout)', !result.stdout.includes('INJECTED'));
  }

  // 12. metrics incremented correctly
  {
    const m = sandbox.getMetrics();
    assert('metrics.executions > 0', m.executions > 0);
    assert('metrics.commandsBlocked >= 2 (rm + cmd.exe)', m.commandsBlocked >= 2);
    assert('metrics.pathViolations >= 1', m.pathViolations >= 1);
  }

  // 13. pathViolations counter increments on traversal
  {
    const before = sandbox.getMetrics().pathViolations;
    try { sandbox.confinePath('../../../windows/system32', projectRoot); } catch (_e) { /* expected */ }
    const after = sandbox.getMetrics().pathViolations;
    assert('pathViolations counter increments', after > before);
  }

  console.log(`\n[SANDBOX] ${passed} passed, ${failed} failed\n`);
  process.exit(failed > 0 ? 1 : 0);
}
