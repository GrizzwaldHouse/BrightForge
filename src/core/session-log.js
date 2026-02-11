/**
 * Session Log - Record Plan-Review-Run Cycles
 *
 * Logs completed plan-review-run sessions to JSON files for history tracking.
 * Stores session files in sessions/ directory with timestamp-based naming.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class SessionLog {
  /**
   * Record a completed plan-review-run cycle.
   * @param {Object} plan - Plan object
   * @param {string} sessionsDir - Absolute path to sessions/ directory
   * @returns {Promise<string>} Path to the log file
   */
  async record(plan, sessionsDir) {
    console.log(`[SESSION] Recording plan ${plan.id}`);

    // Ensure sessions directory exists
    if (!existsSync(sessionsDir)) {
      mkdirSync(sessionsDir, { recursive: true });
      console.log(`[SESSION] Created sessions directory: ${sessionsDir}`);
    }

    // Generate filename: YYYY-MM-DD_<plan.id>.json
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const filename = `${date}_${plan.id}.json`;
    const filePath = join(sessionsDir, filename);

    // Add timestamp to plan if not present
    if (!plan.timestamp) {
      plan.timestamp = new Date().toISOString();
    }

    // Write plan to file
    const content = JSON.stringify(plan, null, 2);
    writeFileSync(filePath, content, 'utf8');

    console.log(`[SESSION] Recorded to: ${filename}`);
    return filePath;
  }

  /**
   * Load recent session logs.
   * @param {string} sessionsDir - Absolute path to sessions/ directory
   * @param {number} limit - Max sessions to return
   * @returns {Promise<Object[]>} Array of plan objects
   */
  async loadRecent(sessionsDir, limit = 10) {
    console.log(`[SESSION] Loading recent sessions (limit: ${limit})`);

    if (!existsSync(sessionsDir)) {
      console.log('[SESSION] Sessions directory does not exist');
      return [];
    }

    // List all JSON files
    const files = readdirSync(sessionsDir)
      .filter(file => file.endsWith('.json'))
      .sort()
      .reverse(); // Sort descending (newest first)

    // Read and parse files up to limit
    const sessions = [];
    const filesToRead = files.slice(0, limit);

    for (const file of filesToRead) {
      try {
        const filePath = join(sessionsDir, file);
        const content = readFileSync(filePath, 'utf8');
        const plan = JSON.parse(content);
        sessions.push(plan);
      } catch (error) {
        console.error(`[SESSION] Failed to read ${file}: ${error.message}`);
      }
    }

    console.log(`[SESSION] Loaded ${sessions.length} sessions`);
    return sessions;
  }

  /**
   * Load the most recent session.
   * @param {string} sessionsDir - Absolute path to sessions/ directory
   * @returns {Promise<Object|null>}
   */
  async loadLast(sessionsDir) {
    console.log('[SESSION] Loading last session');

    const sessions = await this.loadRecent(sessionsDir, 1);

    if (sessions.length === 0) {
      console.log('[SESSION] No sessions found');
      return null;
    }

    console.log(`[SESSION] Loaded last session: ${sessions[0].id}`);
    return sessions[0];
  }
}

// Export singleton instance
const logger = new SessionLog();
export default logger;

// CLI test
if (process.argv.includes('--test')) {
  console.log('Testing SessionLog...\n');

  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  // Create temp sessions directory
  const tempDir = mkdtempSync(join(tmpdir(), 'llcapp-sessions-'));
  console.log(`Test directory: ${tempDir}`);

  try {
    const testLogger = new SessionLog();

    // Create mock plan
    const mockPlan = {
      id: 'plan_1707600000000',
      description: 'Test plan for session logging',
      operations: [
        {
          type: 'create',
          filePath: 'test.js',
          modified: 'console.log("test");'
        }
      ],
      status: 'completed',
      timestamp: new Date().toISOString()
    };

    // Test record
    console.log('[TEST] Recording mock plan...');
    const recordedPath = await testLogger.record(mockPlan, tempDir);
    console.log(`[TEST] Recorded to: ${recordedPath}`);

    // Verify file exists
    if (!existsSync(recordedPath)) {
      throw new Error('Session file was not created');
    }
    console.log('[TEST] Session file verified: EXISTS');

    // Test loadRecent
    console.log('\n[TEST] Loading recent sessions...');
    const recentSessions = await testLogger.loadRecent(tempDir, 10);

    if (recentSessions.length !== 1) {
      throw new Error(`Expected 1 session, got ${recentSessions.length}`);
    }

    const loadedPlan = recentSessions[0];
    if (loadedPlan.id !== mockPlan.id) {
      throw new Error(`Plan ID mismatch. Expected: ${mockPlan.id}, Got: ${loadedPlan.id}`);
    }
    if (loadedPlan.description !== mockPlan.description) {
      throw new Error('Plan description mismatch');
    }
    console.log('[TEST] loadRecent verified: PASSED');

    // Test loadLast
    console.log('\n[TEST] Loading last session...');
    const lastSession = await testLogger.loadLast(tempDir);

    if (!lastSession) {
      throw new Error('loadLast returned null');
    }
    if (lastSession.id !== mockPlan.id) {
      throw new Error(`Last session ID mismatch. Expected: ${mockPlan.id}, Got: ${lastSession.id}`);
    }
    console.log('[TEST] loadLast verified: PASSED');

    // Test with multiple sessions
    console.log('\n[TEST] Recording multiple sessions...');
    const mockPlan2 = {
      id: 'plan_1707600001000',
      description: 'Second test plan',
      operations: [],
      status: 'completed',
      timestamp: new Date().toISOString()
    };
    await testLogger.record(mockPlan2, tempDir);

    const multipleSessions = await testLogger.loadRecent(tempDir, 10);
    if (multipleSessions.length !== 2) {
      throw new Error(`Expected 2 sessions, got ${multipleSessions.length}`);
    }

    // Verify newest first (plan2 should be first)
    if (multipleSessions[0].id !== mockPlan2.id) {
      throw new Error('Sessions not sorted correctly (newest first)');
    }
    console.log('[TEST] Multiple sessions verified: PASSED');

    // Test limit
    console.log('\n[TEST] Testing limit parameter...');
    const limitedSessions = await testLogger.loadRecent(tempDir, 1);
    if (limitedSessions.length !== 1) {
      throw new Error(`Expected 1 session with limit, got ${limitedSessions.length}`);
    }
    console.log('[TEST] Limit parameter verified: PASSED');

    // Test empty directory
    console.log('\n[TEST] Testing empty directory...');
    const emptyDir = mkdtempSync(join(tmpdir(), 'llcapp-empty-'));
    const emptySessions = await testLogger.loadRecent(emptyDir, 10);
    if (emptySessions.length !== 0) {
      throw new Error(`Expected 0 sessions from empty dir, got ${emptySessions.length}`);
    }
    rmSync(emptyDir, { recursive: true, force: true });
    console.log('[TEST] Empty directory verified: PASSED');

    console.log('\n[TEST] All tests passed!');

  } catch (error) {
    console.error('\n[TEST] Test failed:', error.message);
    process.exit(1);
  } finally {
    // Clean up temp directory
    rmSync(tempDir, { recursive: true, force: true });
    console.log(`[TEST] Cleaned up temp directory: ${tempDir}`);
  }
}
