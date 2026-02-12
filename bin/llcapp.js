#!/usr/bin/env node

/**
 * LLCApp CLI - DEPRECATED
 *
 * This command has been renamed to `brightforge`.
 * Please use `brightforge` instead.
 *
 * @deprecated Use `brightforge` instead
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Print deprecation warning
console.warn('\x1b[33m%s\x1b[0m', '⚠️  DEPRECATED: The "llcapp" command has been renamed to "brightforge"');
console.warn('\x1b[33m%s\x1b[0m', '   Please use "brightforge" instead. This wrapper will be removed in a future version.');
console.warn('');

// Forward to brightforge
const brightforgePath = join(__dirname, 'brightforge.js');
const args = process.argv.slice(2);

const child = spawn('node', [brightforgePath, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code || 0);
});
