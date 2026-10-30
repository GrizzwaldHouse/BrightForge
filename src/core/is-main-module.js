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

/**
 * True when the module is the entry point AND `--test` was passed.
 * @param {string} metaUrl - pass `import.meta.url`
 * @returns {boolean}
 */
export function isSelfTest(metaUrl) {
  return process.argv.includes('--test') && isMainModule(metaUrl);
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
