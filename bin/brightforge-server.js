#!/usr/bin/env node

/**
 * BrightForge Server - Express HTTP API + Web Dashboard
 *
 * Starts the Express server that serves:
 * - REST API for chat, plan management, sessions
 * - Static web dashboard frontend
 *
 * Usage:
 *   brightforge-server                     Start on default port (3847)
 *   PORT=8080 brightforge-server           Start on custom port
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 11, 2026
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
config({ path: join(__dirname, '../.env.local') });

// Import server factory
import { createServer } from '../src/api/server.js';
import { UniversalLLMClient } from '../src/core/llm-client.js';
import errorHandler from '../src/core/error-handler.js';

/**
 * Start the HTTP server.
 */
async function main() {
  const port = parseInt(process.env.PORT || '3847', 10);
  const sessionsDir = join(__dirname, '../sessions');

  // Ensure sessions directory exists
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }

  // Initialize error handler (observer-pattern error broadcasting)
  errorHandler.initialize(sessionsDir);

  // Create Express app
  const { app, store } = createServer({
    sessionsDir,
    sessionTimeout: 30 * 60 * 1000  // 30 minutes
  });

  // Check provider availability
  const client = new UniversalLLMClient();
  const providers = Object.keys(client.providers);
  const available = providers.filter(p => client.isProviderAvailable(p));

  // Check Ollama
  let ollamaRunning = false;
  try {
    ollamaRunning = await client.checkOllamaRunning();
  } catch {
    ollamaRunning = false;
  }

  // Start server
  app.listen(port, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║    BrightForge Server v3.1.0         ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log('');
    console.log(`  [SERVER] Listening on http://localhost:${port}`);
    console.log(`  [SERVER] Dashboard: http://localhost:${port}`);
    console.log(`  [SERVER] API Base:  http://localhost:${port}/api`);
    console.log('');
    console.log(`  [SERVER] Ollama: ${ollamaRunning ? '🟢 Running' : '🔴 Not detected'}`);
    console.log(`  [SERVER] Providers: ${available.length}/${providers.length} available`);

    for (const name of providers) {
      const isAvail = client.isProviderAvailable(name);
      const icon = name === 'ollama'
        ? (ollamaRunning ? '🟢' : '🔴')
        : (isAvail ? '🟢' : '🔴');
      console.log(`           ${icon} ${name}`);
    }

    console.log('');
    console.log(`  [SERVER] Sessions dir: ${sessionsDir}`);
    console.log(`  [SERVER] Session timeout: 30 min`);
    console.log('');
    console.log('  Press Ctrl+C to stop');
    console.log('');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n  [SERVER] Shutting down...');
    store.destroy();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\n  [SERVER] Shutting down...');
    store.destroy();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error(`[FATAL] ${error.message}`);
  errorHandler.report('fatal', error, { source: 'server-main' });
  process.exit(1);
});
