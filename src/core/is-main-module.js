/**
 * is-main-module.js - Entry-point detection for self-test blocks.
 *
 * Every module carries a `--test` block. That block must run only when the
 * module itself is the program entry point (`node path/to/module.js --test`),
 * never when the module is merely imported by another module that was started
 * with `--test`. A bare `process.argv.includes('--test')` guard, or a basename
 * comparison, runs the wrong suite (and can process.exit the importer).
 *
 * Usage at the bottom of a module:
 *   import { isSelfTest } from '../core/is-main-module.js';
 *   if (isSelfTest(import.meta.url)) { ... }
 */

import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { realpathSync } from 'fs';

function canonical(filePath) {
  let resolved = resolve(filePath);
  try {
    resolved = realpathSync(resolved);
  } catch (_err) {
    // Fall back to the resolved path when the file cannot be stat'ed
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * True when the module identified by `metaUrl` is the process entry point.
 * @param {string} metaUrl - pass `import.meta.url`
 * @returns {boolean}
 */
export function isMainModule(metaUrl) {
  const entry = process.argv[1];
  if (!entry || !metaUrl) return false;
  let modulePath;
  try {
    modulePath = fileURLToPath(metaUrl);
  } catch (_err) {
    return false;
  }
  return canonical(modulePath) === canonical(entry);
}

let assertionGuardInstalled = false;

/**
 * Make console.assert failures fail the self-test.
 *
 * Node's console.assert only prints "Assertion failed" and carries on, so a
 * self-test built on it exits 0 even when assertions fail. While a module's
 * self-test runs, failed assertions are counted and the process exit code is
 * forced to 1 (including over an explicit process.exit(0)). Control flow is
 * unchanged.
 */
function installAssertionGuard() {
  if (assertionGuardInstalled) return;
  assertionGuardInstalled = true;

  let failures = 0;
  const originalAssert = console.assert.bind(console);
  console.assert = (condition, ...details) => {
    if (!condition) {
      failures++;
      originalAssert(condition, ...details);
    }
  };

  const report = () => {
    if (failures > 0) {
      console.error(`[SELF-TEST] ${failures} console.assert failure(s); exiting with code 1`);
    }
  };

  const originalExit = process.exit.bind(process);
  process.exit = (code) => {
    if (failures > 0 && (code === undefined || code === 0)) {
      report();
      return originalExit(1);
    }
    return originalExit(code);
  };

  process.on('exit', (code) => {
    if (failures > 0 && code === 0) {
      report();
      process.exitCode = 1;
    }
  });
}

/**
 * True when the module is the entry point AND `--test` was passed.
 * Also installs the console.assert guard for the self-test run.
 * @param {string} metaUrl - pass `import.meta.url`
 * @returns {boolean}
 */
export function isSelfTest(metaUrl) {
  const active = process.argv.includes('--test') && isMainModule(metaUrl);
  if (active) installAssertionGuard();
  return active;
}

/**
 * True when the module is the entry point and `--test` was NOT passed
 * (the module's normal CLI run).
 * @param {string} metaUrl - pass `import.meta.url`
 * @returns {boolean}
 */
export function isMainRun(metaUrl) {
  return !process.argv.includes('--test') && isMainModule(metaUrl);
}

export default isSelfTest;
