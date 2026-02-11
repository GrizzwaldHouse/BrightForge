#!/usr/bin/env node

/**
 * LLCApp Desktop Launcher
 *
 * Starts the Electron desktop application.
 * Usage: npm run desktop
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const electronPath = join(__dirname, '../node_modules/.bin/electron');
const mainPath = join(__dirname, '../desktop/main.js');

console.log('[LAUNCHER] Starting LLCApp Desktop...');

const child = spawn(electronPath, [mainPath], {
  stdio: 'inherit',
  env: process.env,
  shell: true
});

child.on('close', (code) => {
  console.log(`[LAUNCHER] LLCApp Desktop exited with code ${code}`);
  process.exit(code || 0);
});
