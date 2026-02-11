/**
 * Diff Applier - Apply Plan Operations to Filesystem
 *
 * Applies file operations from plans with backup/rollback support.
 * Creates .llcapp-backup files before modifying originals.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, copyFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import errorHandler from './error-handler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DiffApplier {
  /**
   * Apply all operations in a plan to the filesystem.
   * Creates .llcapp-backup files before modifying.
   * @param {Object} plan - Plan object with operations array
   * @param {string} projectRoot - Absolute path to project root
   * @returns {Promise<{ applied: number, failed: number, errors: string[] }>}
   */
  async apply(plan, projectRoot) {
    console.log(`[APPLY] Starting apply for plan ${plan.id}`);

    const results = {
      applied: 0,
      failed: 0,
      errors: []
    };

    if (!plan.operations || plan.operations.length === 0) {
      console.log('[APPLY] No operations to apply');
      return results;
    }

    for (const operation of plan.operations) {
      const filePath = join(projectRoot, operation.filePath);
      const backupPath = `${filePath}.llcapp-backup`;

      try {
        switch (operation.type) {
          case 'modify': {
            console.log(`[APPLY] Modifying: ${operation.filePath}`);

            // Create backup of original
            if (existsSync(filePath)) {
              copyFileSync(filePath, backupPath);
            }

            // Write modified content
            const parentDir = dirname(filePath);
            if (!existsSync(parentDir)) {
              mkdirSync(parentDir, { recursive: true });
            }
            writeFileSync(filePath, operation.modified, 'utf8');

            results.applied++;
            break;
          }

          case 'create': {
            console.log(`[APPLY] Creating: ${operation.filePath}`);

            // Ensure parent directory exists
            const parentDir = dirname(filePath);
            if (!existsSync(parentDir)) {
              mkdirSync(parentDir, { recursive: true });
            }

            // Write new file
            writeFileSync(filePath, operation.modified, 'utf8');

            results.applied++;
            break;
          }

          case 'delete': {
            console.log(`[APPLY] Deleting: ${operation.filePath}`);

            // Create backup before deleting
            if (existsSync(filePath)) {
              copyFileSync(filePath, backupPath);
              unlinkSync(filePath);
            } else {
              console.warn(`[APPLY] File not found for deletion: ${operation.filePath}`);
            }

            results.applied++;
            break;
          }

          default:
            throw new Error(`Unknown operation type: ${operation.type}`);
        }

      } catch (error) {
        console.error(`[APPLY] Failed to ${operation.type} ${operation.filePath}: ${error.message}`);
        errorHandler.report('apply_error', error, {
          operation: operation.type,
          filePath: operation.filePath,
          planId: plan.id
        });
        results.failed++;
        results.errors.push(`${operation.filePath}: ${error.message}`);
      }
    }

    // Update plan status
    if (results.failed === 0) {
      plan.status = 'applied';
      console.log(`[APPLY] Successfully applied ${results.applied} operations`);
    } else {
      plan.status = 'failed';
      console.error(`[APPLY] Failed ${results.failed}/${plan.operations.length} operations`);
    }

    return results;
  }

  /**
   * Rollback a previously applied plan using backup files.
   * @param {Object} plan - Plan object with operations array
   * @param {string} projectRoot - Absolute path to project root
   * @returns {Promise<{ restored: number, errors: string[] }>}
   */
  async rollback(plan, projectRoot) {
    console.log(`[APPLY] Starting rollback for plan ${plan.id}`);

    const results = {
      restored: 0,
      errors: []
    };

    if (!plan.operations || plan.operations.length === 0) {
      console.log('[APPLY] No operations to rollback');
      return results;
    }

    // Process operations in reverse order
    for (let i = plan.operations.length - 1; i >= 0; i--) {
      const operation = plan.operations[i];
      const filePath = join(projectRoot, operation.filePath);
      const backupPath = `${filePath}.llcapp-backup`;

      try {
        switch (operation.type) {
          case 'modify': {
            console.log(`[APPLY] Restoring modified file: ${operation.filePath}`);

            if (existsSync(backupPath)) {
              copyFileSync(backupPath, filePath);
              unlinkSync(backupPath);
              results.restored++;
            } else {
              console.warn(`[APPLY] No backup found for: ${operation.filePath}`);
            }
            break;
          }

          case 'create': {
            console.log(`[APPLY] Removing created file: ${operation.filePath}`);

            if (existsSync(filePath)) {
              unlinkSync(filePath);
              results.restored++;
            } else {
              console.warn(`[APPLY] Created file not found: ${operation.filePath}`);
            }
            break;
          }

          case 'delete': {
            console.log(`[APPLY] Restoring deleted file: ${operation.filePath}`);

            if (existsSync(backupPath)) {
              const parentDir = dirname(filePath);
              if (!existsSync(parentDir)) {
                mkdirSync(parentDir, { recursive: true });
              }
              copyFileSync(backupPath, filePath);
              unlinkSync(backupPath);
              results.restored++;
            } else {
              console.warn(`[APPLY] No backup found for deleted file: ${operation.filePath}`);
            }
            break;
          }

          default:
            console.warn(`[APPLY] Unknown operation type for rollback: ${operation.type}`);
        }

      } catch (error) {
        console.error(`[APPLY] Failed to rollback ${operation.filePath}: ${error.message}`);
        results.errors.push(`${operation.filePath}: ${error.message}`);
      }
    }

    console.log(`[APPLY] Rollback complete: ${results.restored} operations restored`);
    return results;
  }
}

// Export singleton instance
const applier = new DiffApplier();
export default applier;

// CLI test
if (process.argv.includes('--test')) {
  console.log('Testing DiffApplier...\n');

  const { mkdtempSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  // Create temp directory
  const tempDir = mkdtempSync(join(tmpdir(), 'llcapp-test-'));
  console.log(`Test directory: ${tempDir}`);

  try {
    // Create initial test file
    const testFile = 'test.txt';
    const testFilePath = join(tempDir, testFile);
    const originalContent = 'Original content';
    const modifiedContent = 'Modified content';

    writeFileSync(testFilePath, originalContent, 'utf8');
    console.log('[TEST] Created test file with original content');

    // Build mock plan
    const mockPlan = {
      id: 'test-plan-1',
      description: 'Test plan for diff applier',
      operations: [
        {
          type: 'modify',
          filePath: testFile,
          original: originalContent,
          modified: modifiedContent
        }
      ],
      status: 'pending'
    };

    // Test apply
    const testApplier = new DiffApplier();
    const applyResult = await testApplier.apply(mockPlan, tempDir);

    console.log('\n[TEST] Apply results:', applyResult);

    // Verify file was changed
    const currentContent = readFileSync(testFilePath, 'utf8');
    if (currentContent !== modifiedContent) {
      throw new Error(`File content mismatch. Expected: "${modifiedContent}", Got: "${currentContent}"`);
    }
    console.log('[TEST] File content verified: MODIFIED');

    // Verify backup exists
    const backupPath = `${testFilePath}.llcapp-backup`;
    if (!existsSync(backupPath)) {
      throw new Error('Backup file was not created');
    }
    const backupContent = readFileSync(backupPath, 'utf8');
    if (backupContent !== originalContent) {
      throw new Error('Backup content does not match original');
    }
    console.log('[TEST] Backup file verified: EXISTS');

    // Test rollback
    const rollbackResult = await testApplier.rollback(mockPlan, tempDir);
    console.log('\n[TEST] Rollback results:', rollbackResult);

    // Verify file was restored
    const restoredContent = readFileSync(testFilePath, 'utf8');
    if (restoredContent !== originalContent) {
      throw new Error(`File not restored. Expected: "${originalContent}", Got: "${restoredContent}"`);
    }
    console.log('[TEST] File content verified: RESTORED');

    // Verify backup was cleaned up
    if (existsSync(backupPath)) {
      throw new Error('Backup file was not cleaned up after rollback');
    }
    console.log('[TEST] Backup file verified: CLEANED UP');

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
