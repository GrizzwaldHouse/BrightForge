/**
 * Diff Applier - Apply Plan Operations to Filesystem
 *
 * Applies file operations from plans with backup/rollback support.
 * Creates .brightforge-backup files before modifying originals.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date February 10, 2026
 */

import { readFileSync, writeFileSync, unlinkSync, mkdirSync, existsSync, copyFileSync, realpathSync } from 'fs';
import { join, dirname, resolve, sep } from 'path';

/**
 * Resolve a plan file path against the project root, or return null when the
 * result would land outside it (e.g. "../x"). Absolute plan paths are treated
 * as relative to the root, matching how they were joined before.
 */
export function resolveInsideRoot(projectRoot, filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) return null;
  const root = resolve(projectRoot);
  const target = resolve(join(root, filePath));
  // A filesystem root ('/', 'C:\\') already ends with the separator
  const prefix = root.endsWith(sep) ? root : root + sep;
  if (!target.startsWith(prefix)) return null;
  // A symlink inside the project must not lead outside it: compare the real
  // location of the nearest existing ancestor with the real root.
  try {
    let probe = target;
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
    const realRoot = realpathSync(root);
    const realProbe = realpathSync(probe);
    const realPrefix = realRoot.endsWith(sep) ? realRoot : realRoot + sep;
    if (realProbe !== realRoot && !realProbe.startsWith(realPrefix)) return null;
  } catch (_err) {
    return null;
  }
  return target;
}
import { fileURLToPath } from 'url';
import errorHandler from './error-handler.js';
import telemetryBus from './telemetry-bus.js';
import gitCheckpointer from './git-checkpointer.js';
import { isSelfTest } from './is-main-module.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export class DiffApplier {
  /**
   * Apply all operations in a plan to the filesystem.
   * Creates .brightforge-backup files before modifying.
   * @param {Object} plan - Plan object with operations array
   * @param {string} projectRoot - Absolute path to project root
   * @returns {Promise<{ applied: number, failed: number, errors: string[] }>}
   */
  async apply(plan, projectRoot) {
    console.log(`[APPLY] Starting apply for plan ${plan.id}`);
    const endTimer = telemetryBus.startTimer('apply_operation', { planId: plan.id });

    const results = {
      applied: 0,
      failed: 0,
      refused: 0,
      errors: []
    };

    if (!plan.operations || plan.operations.length === 0) {
      console.log('[APPLY] No operations to apply');
      endTimer({ status: 'skipped', operations: 0 });
      return results;
    }

    // Every operation escapes the project root: refuse the whole plan before
    // any checkpoint or write, so there is nothing to roll back.
    const escaping = plan.operations.filter(op => !resolveInsideRoot(projectRoot, op.filePath));
    if (escaping.length === plan.operations.length) {
      for (const op of escaping) {
        console.error(`[APPLY] Refused: "${op.filePath}" is outside the project root`);
        results.errors.push(`Refused: "${op.filePath}" is outside the project root`);
      }
      results.failed = escaping.length;
      results.refused = escaping.length;
      plan.status = 'refused';
      endTimer({ status: 'refused', operations: 0, failed: results.failed });
      return results;
    }

    // Git checkpoint before applying changes
    const label = plan.task || plan.description || `plan ${plan.id}`;
    const checkpoint = gitCheckpointer.checkpoint(projectRoot, label);
    if (checkpoint.commitHash) {
      plan._checkpointHash = checkpoint.commitHash;
    }

    for (const operation of plan.operations) {
      const filePath = resolveInsideRoot(projectRoot, operation.filePath);
      if (!filePath) {
        console.error(`[APPLY] Refused: "${operation.filePath}" is outside the project root`);
        results.failed++;
        results.refused++;
        results.errors.push(`Refused: "${operation.filePath}" is outside the project root`);
        continue;
      }
      const backupPath = `${filePath}.brightforge-backup`;

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
      endTimer({ status: 'success', operations: results.applied });

      // Git commit after successful apply
      const postCommit = gitCheckpointer.commitAfter(projectRoot, label);
      if (postCommit.commitHash) {
        plan._appliedHash = postCommit.commitHash;
      }
    } else {
      plan.status = 'failed';
      console.error(`[APPLY] Failed ${results.failed}/${plan.operations.length} operations`);
      endTimer({ status: 'failed', operations: results.applied, failed: results.failed });
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

    // Try git revert first if we have the applied commit hash
    if (plan._appliedHash) {
      console.log(`[APPLY] Attempting git revert of ${plan._appliedHash.slice(0, 8)}`);
      const revertResult = gitCheckpointer.revert(projectRoot, plan._appliedHash);
      if (revertResult.success) {
        console.log('[APPLY] Git revert successful');
        return { restored: plan.operations.length, errors: [] };
      }
      console.warn(`[APPLY] Git revert failed: ${revertResult.error}, falling back to backup restoration`);
    }

    // Fallback: restore from .brightforge-backup files
    // Process operations in reverse order
    for (let i = plan.operations.length - 1; i >= 0; i--) {
      const operation = plan.operations[i];
      const filePath = resolveInsideRoot(projectRoot, operation.filePath);
      if (!filePath) {
        results.errors.push(`Refused: "${operation.filePath}" is outside the project root`);
        continue;
      }
      const backupPath = `${filePath}.brightforge-backup`;

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
if (isSelfTest(import.meta.url)) {
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
    const backupPath = `${testFilePath}.brightforge-backup`;
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
