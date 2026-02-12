#!/usr/bin/env node

/**
 * LLCApp Server - DEPRECATED
 *
 * This command has been renamed to `brightforge-server`.
 * Please use `brightforge-server` instead.
 *
 * @deprecated Use `brightforge-server` instead
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Print deprecation warning
console.warn('\x1b[33m%s\x1b[0m', '⚠️  DEPRECATED: The "llcapp-server" command has been renamed to "brightforge-server"');
console.warn('\x1b[33m%s\x1b[0m', '   Please use "brightforge-server" instead. This wrapper will be removed in a future version.');
console.warn('');

// Forward to brightforge-server
const brightforgePath = join(__dirname, 'brightforge-server.js');
const args = process.argv.slice(2);

const child = spawn('node', [brightforgePath, ...args], {
  stdio: 'inherit',
  env: process.env
});

child.on('close', (code) => {
  process.exit(code || 0);
});
