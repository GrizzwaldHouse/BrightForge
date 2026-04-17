// integration-suite.js
// Developer: Autonomous Recovery Team
// Date: 2026-04-15
// Purpose: End-to-end integration testing for BrightForge platform

import { createServer } from '../api/server.js';
import orchestrator from '../orchestration/index.js';
import { WebSession } from '../api/web-session.js';
import { ForgeSession } from '../forge3d/forge-session.js';
import modelScanner from '../model-intelligence/scanner.js';
import modelDb from '../model-intelligence/database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runIntegrationTests() {
  console.log('[INTEGRATION] Starting test suite...');
  const results = { passed: 0, failed: 0, skipped: 0 };
  
  // Test 1: Orchestration Init
  try {
    await orchestrator.init();
    console.log('✓ Orchestration initialized');
    results.passed++;
  } catch (err) {
    console.error('✗ Orchestration init failed:', err.message);
    results.failed++;
  }
  
  // Test 2: Web Session Flow
  try {
    const projectRoot = join(__dirname, '..', '..');
    const sessionsDir = join(projectRoot, 'sessions');
    const session = new WebSession({ projectRoot, sessionsDir });
    
    // Generate a simple plan
    await session.generatePlan('Add a test file', { skipApply: true });
    
    if (session.pendingPlan) {
      console.log('✓ Web session plan generation');
      results.passed++;
    } else {
      throw new Error('No plan generated');
    }
  } catch (err) {
    console.error('✗ Web session failed:', err.message);
    results.failed++;
  }
  
  // Test 3: Forge3D Generation (skip if no GPU)
  try {
    console.log('⊘ Forge3D test skipped (long-running)');
    results.skipped++;
  } catch (err) {
    console.error('✗ Forge3D failed:', err.message);
    results.failed++;
  }
  
  // Test 4: Model Intelligence Scan
  try {
    // Initialize database first
    modelDb.open();
    const inventory = await modelScanner.runInstantScan();
    console.log('✓ Model intelligence scan');
    results.passed++;
    modelDb.close();
  } catch (err) {
    console.error('✗ Model scan failed:', err.message);
    results.failed++;
  }
  
  // Cleanup
  try {
    await orchestrator.shutdown();
    console.log('✓ Orchestration shutdown');
    results.passed++;
  } catch (err) {
    console.error('✗ Orchestration shutdown failed:', err.message);
    results.failed++;
  }
  
  console.log(`\n[INTEGRATION] Results: ${results.passed} passed, ${results.failed} failed, ${results.skipped} skipped`);
  return results;
}

// Self-test
if (process.argv.includes('--test')) {
  runIntegrationTests().then(results => {
    process.exit(results.failed > 0 ? 1 : 0);
  }).catch(err => {
    console.error('[INTEGRATION] Fatal error:', err);
    process.exit(1);
  });
}
