/**
 * GitCheckpointer - Git-based plan checkpoints with timeline
 *
 * Creates git commits before/after plan application for reliable rollback.
 * Falls back gracefully if the project is not a git repo.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date March 2, 2026
 */

import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { isSelfTest } from './is-main-module.js';

const COMMIT_PREFIX = 'brightforge:';
const AUTHOR = 'BrightForge <noreply@brightforge.dev>';
const COMMIT_HASH_PATTERN = /^[0-9a-f]{7,40}$/i;
const MAX_LABEL_LENGTH = 100;

/**
 * True when `value` looks like an abbreviated or full git object id.
 * Anything else (refs, ranges, shell metacharacters) is rejected.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidCommitHash(value) {
  return typeof value === 'string' && COMMIT_HASH_PATTERN.test(value);
}

/**
 * Make a label safe and short for a single commit-message argument.
 * Control characters are replaced; the value is never passed to a shell.
 * @param {unknown} label
 * @returns {string}
 */
function sanitizeLabel(label) {
  const printable = Array.from(String(label ?? ''), (ch) => {
    const code = ch.charCodeAt(0);
    return code < 0x20 || code === 0x7f ? ' ' : ch;
  }).join('');
  return printable.trim().slice(0, MAX_LABEL_LENGTH);
}

class GitCheckpointer {
  constructor() {
    this._repoCache = new Map();
  }

  /**
   * Run git with an argument vector. No shell is involved, so arguments
   * are never interpreted (no `;`, `$()`, backticks, globbing).
   * @param {string} projectRoot
   * @param {string[]} args
   * @param {number} timeout
   * @returns {string} stdout
   */
  _git(projectRoot, args, timeout = 10000) {
    return execFileSync('git', args, {
      cwd: projectRoot,
      stdio: 'pipe',
      timeout,
      shell: false,
      windowsHide: true
    }).toString();
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

      this._git(projectRoot, ['rev-parse', '--is-inside-work-tree'], 5000);
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
      const status = this._git(projectRoot, ['status', '--porcelain']).trim();

      if (!status) {
        console.log('[GIT] No changes to checkpoint');
        return { success: true, commitHash: null };
      }

      // Stage all changes and commit
      this._git(projectRoot, ['add', '-A']);

      const message = `${COMMIT_PREFIX} checkpoint before ${sanitizeLabel(label)}`;
      this._git(projectRoot, ['commit', '-m', message, `--author=${AUTHOR}`], 15000);

      const hash = this._git(projectRoot, ['rev-parse', 'HEAD'], 5000).trim();

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
      const status = this._git(projectRoot, ['status', '--porcelain']).trim();

      if (!status) {
        console.log('[GIT] No changes after apply');
        return { success: true, commitHash: null };
      }

      this._git(projectRoot, ['add', '-A']);

      const message = `${COMMIT_PREFIX} applied ${sanitizeLabel(label)}`;
      this._git(projectRoot, ['commit', '-m', message, `--author=${AUTHOR}`], 15000);

      const hash = this._git(projectRoot, ['rev-parse', 'HEAD'], 5000).trim();

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
    if (!isValidCommitHash(commitHash)) {
      return { success: false, error: 'Invalid commit hash', code: 'INVALID_HASH' };
    }
    if (!this.isGitRepo(projectRoot)) {
      return { success: false, error: 'Not a git repo' };
    }

    try {
      // Only BrightForge checkpoint commits may be reverted through this API
      let subject;
      try {
        subject = this._git(projectRoot, ['log', '-1', '--format=%s', `${commitHash}^{commit}`, '--'], 5000).trim();
      } catch {
        return { success: false, error: 'Commit not found', code: 'NOT_FOUND' };
      }
      if (!subject.startsWith(COMMIT_PREFIX)) {
        return { success: false, error: 'Not a BrightForge checkpoint commit', code: 'NOT_CHECKPOINT' };
      }

      this._git(projectRoot, ['revert', '--no-edit', commitHash], 30000);

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
      const max = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 500));
      const log = this._git(projectRoot, [
        'log', '--all', '--format=%H|%aI|%s', `--grep=${COMMIT_PREFIX}`, '-n', String(max)
      ]).trim();

      if (!log) return [];

      return log.split('\n').map(line => {
        const [hash, date, ...msgParts] = line.split('|');
        const message = msgParts.join('|');

        // Get files changed in this commit
        let filesChanged = [];
        try {
          const diff = isValidCommitHash(hash)
            ? this._git(projectRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', hash], 5000).trim()
            : '';
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

    if (!isValidCommitHash(commitHash)) {
      return '';
    }

    try {
      return this._git(projectRoot, ['show', '--format=', commitHash, '--']);
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
if (isSelfTest(import.meta.url)) {
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
    execFileSync('git', ['init'], { cwd: tempDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tempDir, stdio: 'pipe' });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tempDir, stdio: 'pipe' });
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

    // Security regression: shell metacharacters must never execute
    const { existsSync: exists } = await import('fs');
    const sentinel = join(tempDir, 'PWNED');

    console.log('[TEST] Test 9: Revert rejects injected hash...');
    for (const payload of [`HEAD;touch ${sentinel}`, `$(touch ${sentinel})`, `\`touch ${sentinel}\``, 'HEAD', 'main', '--help', `${ca.commitHash};id`]) {
      const res = gcp.revert(tempDir, payload);
      if (res.success) throw new Error(`Revert accepted invalid hash: ${payload}`);
    }
    if (exists(sentinel)) throw new Error('Injected command executed (sentinel file created)');
    console.log('[TEST] PASSED');

    console.log('[TEST] Test 10: Revert refuses non-checkpoint commits...');
    writeFileSync(join(tempDir, 'manual.txt'), 'manual');
    execFileSync('git', ['add', '-A'], { cwd: tempDir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'manual commit'], { cwd: tempDir, stdio: 'pipe' });
    const manualHash = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: tempDir }).toString().trim();
    const nc = gcp.revert(tempDir, manualHash);
    if (nc.success || nc.code !== 'NOT_CHECKPOINT') throw new Error(`Expected NOT_CHECKPOINT, got ${JSON.stringify(nc)}`);
    const nf = gcp.revert(tempDir, 'deadbeefdeadbeef');
    if (nf.success || nf.code !== 'NOT_FOUND') throw new Error(`Expected NOT_FOUND, got ${JSON.stringify(nf)}`);
    console.log('[TEST] PASSED');

    console.log('[TEST] Test 11: Commit label with shell metacharacters is stored literally...');
    writeFileSync(join(tempDir, 'label.txt'), 'x');
    const label = `"; touch ${sentinel}; " $(touch ${sentinel}) \`touch ${sentinel}\``;
    const lc = gcp.checkpoint(tempDir, label);
    if (!lc.success) throw new Error(`Checkpoint failed: ${lc.error}`);
    if (exists(sentinel)) throw new Error('Label was executed by a shell (sentinel file created)');
    const subject = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: tempDir }).toString();
    if (!subject.includes('$(touch')) throw new Error(`Label not stored literally: ${subject}`);
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
