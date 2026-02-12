#!/usr/bin/env node

/**
 * LLCApp Desktop - DEPRECATED
 *
 * This command has been renamed to `brightforge-desktop`.
 * Please use `brightforge-desktop` instead.
 *
 * @deprecated Use `brightforge-desktop` instead
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Print deprecation warning
console.warn('\x1b[33m%s\x1b[0m', '⚠️  DEPRECATED: The "llcapp-desktop" command has been renamed to "brightforge-desktop"');
console.warn('\x1b[33m%s\x1b[0m', '   Please use "brightforge-desktop" instead. This wrapper will be removed in a future version.');
console.warn('');

// Forward to brightforge-desktop
const brightforgePath = join(__dirname, 'brightforge-desktop.js');
const args = process.argv.slice(2);

const child = spawn('node', [brightforgePath, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code || 0);
});
