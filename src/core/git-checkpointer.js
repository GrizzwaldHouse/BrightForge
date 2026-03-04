/**
 * GitCheckpointer - Git-based plan checkpoints with timeline
 *
 * Creates git commits before/after plan application for reliable rollback.
 * Falls back gracefully if the project is not a git repo.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

const COMMIT_PREFIX = 'brightforge:';
const AUTHOR = 'BrightForge <noreply@brightforge.dev>';

class GitCheckpointer {
  constructor() {
    this._repoCache = new Map();
  }

  /**
   * Check if a directory is inside a git repository.
   * @param {string} projectRoot
   * @returns {boolean}
   */
  isGitRepo(projectRoot) {
    const cached = this._repoCache.get(projectRoot);
    if (cached !== undefined) return cached;

    try {
      // Check for .git directory or if git recognizes it
      if (existsSync(join(projectRoot, '.git'))) {
        this._repoCache.set(projectRoot, true);
        return true;
      }

      execSync('git rev-parse --is-inside-work-tree', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 5000
      });
      this._repoCache.set(projectRoot, true);
      return true;
    } catch {
      this._repoCache.set(projectRoot, false);
      return false;
    }
  }

  /**
   * Create a checkpoint commit before applying a plan.
   * @param {string} projectRoot
   * @param {string} label - Short description (e.g., task summary)
   * @returns {{ success: boolean, commitHash?: string, error?: string }}
   */
  checkpoint(projectRoot, label) {
    if (!this.isGitRepo(projectRoot)) {
      console.log('[GIT] Not a git repo, skipping checkpoint');
      return { success: false, error: 'Not a git repo' };
    }

    try {
      // Check if there are any changes to commit
      const status = execSync('git status --porcelain', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      }).toString().trim();

      if (!status) {
        console.log('[GIT] No changes to checkpoint');
        return { success: true, commitHash: null };
      }

      // Stage all changes and commit
      execSync('git add -A', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      });

      const safeLabel = label.replace(/"/g, '\\"').slice(0, 100);
      const message = `${COMMIT_PREFIX} checkpoint before ${safeLabel}`;

      execSync(`git commit -m "${message}" --author="${AUTHOR}"`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 15000
      });

      const hash = execSync('git rev-parse HEAD', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 5000
      }).toString().trim();

      console.log(`[GIT] Checkpoint created: ${hash.slice(0, 8)} - ${message}`);
      return { success: true, commitHash: hash };
    } catch (error) {
      console.warn(`[GIT] Checkpoint failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Create a commit after applying a plan.
   * @param {string} projectRoot
   * @param {string} label
   * @returns {{ success: boolean, commitHash?: string, error?: string }}
   */
  commitAfter(projectRoot, label) {
    if (!this.isGitRepo(projectRoot)) {
      return { success: false, error: 'Not a git repo' };
    }

    try {
      const status = execSync('git status --porcelain', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      }).toString().trim();

      if (!status) {
        console.log('[GIT] No changes after apply');
        return { success: true, commitHash: null };
      }

      execSync('git add -A', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      });

      const safeLabel = label.replace(/"/g, '\\"').slice(0, 100);
      const message = `${COMMIT_PREFIX} applied ${safeLabel}`;

      execSync(`git commit -m "${message}" --author="${AUTHOR}"`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 15000
      });

      const hash = execSync('git rev-parse HEAD', {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 5000
      }).toString().trim();

      console.log(`[GIT] Post-apply commit: ${hash.slice(0, 8)} - ${message}`);
      return { success: true, commitHash: hash };
    } catch (error) {
      console.warn(`[GIT] Post-apply commit failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Revert a specific commit by hash.
   * @param {string} projectRoot
   * @param {string} commitHash
   * @returns {{ success: boolean, error?: string }}
   */
  revert(projectRoot, commitHash) {
    if (!this.isGitRepo(projectRoot)) {
      return { success: false, error: 'Not a git repo' };
    }

    try {
      execSync(`git revert --no-edit ${commitHash}`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 30000
      });

      console.log(`[GIT] Reverted commit: ${commitHash.slice(0, 8)}`);
      return { success: true };
    } catch (error) {
      console.warn(`[GIT] Revert failed: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get timeline of BrightForge commits.
   * @param {string} projectRoot
   * @param {number} limit - Max entries to return
   * @returns {Array<{ hash, date, message, filesChanged }>}
   */
  getTimeline(projectRoot, limit = 50) {
    if (!this.isGitRepo(projectRoot)) {
      return [];
    }

    try {
      const log = execSync(
        `git log --all --oneline --format="%H|%aI|%s" --grep="${COMMIT_PREFIX}" -n ${limit}`,
        {
          cwd: projectRoot,
          stdio: 'pipe',
          timeout: 10000
        }
      ).toString().trim();

      if (!log) return [];

      return log.split('\n').map(line => {
        const [hash, date, ...msgParts] = line.split('|');
        const message = msgParts.join('|');

        // Get files changed in this commit
        let filesChanged = [];
        try {
          const diff = execSync(`git diff-tree --no-commit-id --name-only -r ${hash}`, {
            cwd: projectRoot,
            stdio: 'pipe',
            timeout: 5000
          }).toString().trim();
          filesChanged = diff ? diff.split('\n') : [];
        } catch {
          // Ignore diff errors
        }

        return {
          hash,
          date,
          message: message.replace(`${COMMIT_PREFIX} `, ''),
          type: message.includes('checkpoint before') ? 'checkpoint' : 'applied',
          filesChanged
        };
      });
    } catch (error) {
      console.warn(`[GIT] Failed to get timeline: ${error.message}`);
      return [];
    }
  }

  /**
   * Get diff for a specific commit.
   * @param {string} projectRoot
   * @param {string} commitHash
   * @returns {string} Unified diff output
   */
  getDiff(projectRoot, commitHash) {
    if (!this.isGitRepo(projectRoot)) {
      return '';
    }

    try {
      return execSync(`git show --format= ${commitHash}`, {
        cwd: projectRoot,
        stdio: 'pipe',
        timeout: 10000
      }).toString();
    } catch (error) {
      console.warn(`[GIT] Failed to get diff: ${error.message}`);
      return '';
    }
  }
}

// Singleton
const gitCheckpointer = new GitCheckpointer();
export default gitCheckpointer;
export { GitCheckpointer };

// --test block
if (process.argv.includes('--test')) {
  console.log('Testing GitCheckpointer...\n');

  const { mkdtempSync, writeFileSync, rmSync } = await import('fs');
  const { tmpdir } = await import('os');

  const tempDir = mkdtempSync(join(tmpdir(), 'bf-git-test-'));
  console.log(`[TEST] Temp dir: ${tempDir}`);

  try {
    const gcp = new GitCheckpointer();

    // Test 1: Non-git directory
    console.log('[TEST] Test 1: Non-git directory...');
    if (gcp.isGitRepo(tempDir)) throw new Error('Should not be a git repo');
    console.log('[TEST] PASSED');

    // Test 2: Initialize git repo
    console.log('[TEST] Test 2: Initialize git repo...');
    execSync('git init', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tempDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tempDir, stdio: 'pipe' });
    gcp._repoCache.clear();
    if (!gcp.isGitRepo(tempDir)) throw new Error('Should be a git repo now');
    console.log('[TEST] PASSED');

    // Test 3: Checkpoint with changes
    console.log('[TEST] Test 3: Checkpoint with changes...');
    writeFileSync(join(tempDir, 'test.txt'), 'hello world');
    const cp = gcp.checkpoint(tempDir, 'initial setup');
    if (!cp.success) throw new Error(`Checkpoint failed: ${cp.error}`);
    if (!cp.commitHash) throw new Error('No commit hash returned');
    console.log(`[TEST] PASSED (hash: ${cp.commitHash.slice(0, 8)})`);

    // Test 4: Checkpoint with no changes
    console.log('[TEST] Test 4: Checkpoint with no changes...');
    const cp2 = gcp.checkpoint(tempDir, 'nothing changed');
    if (!cp2.success) throw new Error('Should succeed with no changes');
    if (cp2.commitHash !== null) throw new Error('Should have null hash when no changes');
    console.log('[TEST] PASSED');

    // Test 5: Commit after
    console.log('[TEST] Test 5: Commit after apply...');
    writeFileSync(join(tempDir, 'test.txt'), 'modified content');
    const ca = gcp.commitAfter(tempDir, 'update test file');
    if (!ca.success) throw new Error(`CommitAfter failed: ${ca.error}`);
    console.log('[TEST] PASSED');

    // Test 6: Timeline
    console.log('[TEST] Test 6: Timeline...');
    const timeline = gcp.getTimeline(tempDir);
    if (timeline.length < 2) throw new Error(`Expected at least 2 entries, got ${timeline.length}`);
    console.log(`[TEST] PASSED (${timeline.length} entries)`);

    // Test 7: Get diff
    console.log('[TEST] Test 7: Get diff...');
    const diff = gcp.getDiff(tempDir, ca.commitHash);
    if (!diff.includes('modified content')) throw new Error('Diff should contain modified content');
    console.log('[TEST] PASSED');

    // Test 8: Revert
    console.log('[TEST] Test 8: Revert...');
    const rv = gcp.revert(tempDir, ca.commitHash);
    if (!rv.success) throw new Error(`Revert failed: ${rv.error}`);
    const { readFileSync: readF } = await import('fs');
    const content = readF(join(tempDir, 'test.txt'), 'utf8');
    if (content !== 'hello world') throw new Error(`Expected reverted content, got: ${content}`);
    console.log('[TEST] PASSED');

    console.log('\n[TEST] All GitCheckpointer tests PASSED!');
  } catch (error) {
    console.error(`\n[TEST] FAILED: ${error.message}`);
    console.error(error.stack);
    process.exit(1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
