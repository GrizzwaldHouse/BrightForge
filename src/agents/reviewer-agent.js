/**
 * ReviewerAgent - Code review and quality audit
 *
 * Performs structural checks, coding standards validation, and
 * produces review reports with recommendations.
 *
 * @author Marcus Daley (GrizzwaldHouse)
 * @date April 6, 2026
 */

import { EventEmitter } from 'events';
import { existsSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import telemetryBus from '../core/telemetry-bus.js';
import errorHandler from '../core/error-handler.js';
// Phase 20B2 — typed pipeline rejection event. Imported at module top so
// the dependency is explicit; emit is wrapped in try/catch so reviewer
// self-tests do not require a live orchestrator.
import orchestrator from '../orchestration/index.js';
import { isSelfTest } from '../core/is-main-module.js';

class ReviewerAgent extends EventEmitter {
  constructor() {
    super();
    this.name = 'Reviewer';
    this.type = 'validation';
    this.status = 'idle'; // idle | reviewing | complete | error
    this.currentReview = null;
  }

  /**
   * Review test results and build artifacts.
   * @param {Object} testResults - Result from TesterAgent
   * @param {Object} buildArtifacts - Artifacts from BuilderAgent
   * @param {Object} options - { strict: false }
   * @returns {{ reviewId, score, findings: [], recommendations: [], verdict }}
   */
  async review(testResults, buildArtifacts, options = {}) {
    this.status = 'reviewing';
    const reviewId = randomUUID().slice(0, 12);
    const endTimer = telemetryBus.startTimer('agent_action', { agent: this.name, action: 'review' });

    try {
      console.log(`[REVIEWER] Starting review ${reviewId}`);
      this.emit('review_start', { reviewId, testId: testResults.testId });

      const findings = [];
      const recommendations = [];

      // Check 1: Test results
      const testScore = this._checkTestResults(testResults, findings, recommendations);

      // Check 2: File structure
      const structureScore = this._checkStructure(buildArtifacts, findings, recommendations);

      // Check 3: Coding standards
      const standardsScore = this._checkStandards(buildArtifacts, findings, recommendations);

      // Calculate overall score (0-100)
      const score = Math.round((testScore + structureScore + standardsScore) / 3);

      // Determine verdict
      let verdict = 'approved';
      if (score < 60) {
        verdict = 'rejected';
      } else if (score < 80 || findings.some(f => f.severity === 'critical')) {
        verdict = 'needs-changes';
      }

      // Stricter in strict mode
      if (options.strict && score < 90) {
        verdict = 'needs-changes';
      }

      const review = {
        reviewId,
        testId: testResults.testId,
        score,
        findings,
        recommendations,
        verdict,
        summary: `Score: ${score}/100, Verdict: ${verdict}, ${findings.length} findings`,
        createdAt: new Date().toISOString()
      };

      this.currentReview = review;
      this.status = 'complete';

      endTimer({ reviewId, score, verdict, findingsCount: findings.length, status: 'success' });

      this.emit('review_complete', review);
      console.log(`[REVIEWER] Review ${reviewId} complete: ${review.summary}`);

      // Phase 20B2 — when the score drops below the pilot reject threshold (60)
      // emit a typed orchestration event so PipelineTasksPanel can render a red
      // card with feedback. Wrapped in try/catch so reviewer self-tests never
      // fail just because the orchestrator event bus is offline.
      if (verdict === 'rejected' && orchestrator && orchestrator.eventBus) {
        try {
          orchestrator.eventBus.emit('pipeline_review_rejected', {
            agent: this.name,
            taskId: options.taskId || reviewId,
            payload: {
              taskId: options.taskId || reviewId,
              verdict: 'REJECTED',
              score,
              feedback: review.summary,
              findings
            }
          });
        } catch (emitErr) {
          console.warn(`[REVIEWER] orchestrator emit skipped: ${emitErr.message}`);
        }
      }

      return review;
    } catch (err) {
      this.status = 'error';
      endTimer({ reviewId, status: 'failed', error: err.message });
      errorHandler.report('agent_error', err, { agent: this.name, reviewId, testId: testResults.testId });
      this.emit('review_error', { reviewId, error: err.message });
      throw err;
    }
  }

  _checkTestResults(testResults, findings, recommendations) {
    let score = 100;

    // Deduct for failed tests
    if (testResults.failed.length > 0) {
      score -= testResults.failed.length * 20;
      findings.push({
        category: 'tests',
        severity: 'critical',
        message: `${testResults.failed.length} test(s) failed`,
        details: testResults.failed.map(f => f.file)
      });
      recommendations.push('Fix failing tests before proceeding');
    }

    // Deduct for lint errors
    if (testResults.lintErrors.length > 0) {
      score -= testResults.lintErrors.length * 5;
      findings.push({
        category: 'lint',
        severity: 'warning',
        message: `${testResults.lintErrors.length} lint error(s) found`,
        details: testResults.lintErrors.map(e => e.file)
      });
      recommendations.push('Run npm run lint:fix to auto-fix formatting issues');
    }

    return Math.max(0, score);
  }

  /**
   * Read a JS artifact for review. Returns null when it does not exist.
   * @private
   */
  _readArtifact(path) {
    if (!existsSync(path)) return null;
    try {
      return readFileSync(path, 'utf8');
    } catch (_e) {
      return null;
    }
  }

  _checkStructure(buildArtifacts, findings, recommendations) {
    let score = 100;
    let issueCount = 0;
    const artifacts = buildArtifacts ?? [];

    for (const artifact of artifacts) {
      if (artifact.type !== 'file' || !artifact.path.endsWith('.js')) continue;

      const content = this._readArtifact(artifact.path);

      // A claimed artifact that does not exist is a critical finding
      if (content === null) {
        issueCount += 3;
        findings.push({
          category: 'structure',
          severity: 'critical',
          message: 'Artifact not found on disk',
          file: artifact.path
        });
        recommendations.push(`Produce ${artifact.path} or remove it from the build artifacts`);
        continue;
      }

      const hasHeader = /^(#!.*\r?\n)?\s*\/\*\*/.test(content);
      const hasSelfTest = /isSelfTest\(import\.meta\.url\)/.test(content);
      const hasExports = /^export default /m.test(content) && /^export \{/m.test(content);

      if (!hasHeader) {
        issueCount++;
        findings.push({
          category: 'structure',
          severity: 'info',
          message: 'Missing file header documentation',
          file: artifact.path
        });
        recommendations.push(`Add JSDoc header to ${artifact.path}`);
      }

      if (!hasSelfTest) {
        issueCount++;
        findings.push({
          category: 'structure',
          severity: 'warning',
          message: 'Missing self-test block',
          file: artifact.path
        });
        recommendations.push(`Add --test block to ${artifact.path}`);
      }

      if (!hasExports) {
        issueCount++;
        findings.push({
          category: 'structure',
          severity: 'critical',
          message: 'Missing exports (singleton + named class)',
          file: artifact.path
        });
        recommendations.push(`Add singleton and named exports to ${artifact.path}`);
      }
    }

    score -= issueCount * 10;
    return Math.max(0, score);
  }

  _checkStandards(buildArtifacts, findings, recommendations) {
    let score = 100;
    let issueCount = 0;
    const artifacts = buildArtifacts ?? [];

    for (const artifact of artifacts) {
      if (artifact.type !== 'file' || !artifact.path.endsWith('.js')) continue;

      // Missing artifacts are already reported by the structure check
      const content = this._readArtifact(artifact.path);
      if (content === null) continue;

      const lines = content.split(/\r?\n/);
      const tabIndented = lines.filter((l) => /^\t/.test(l)).length;
      const oddIndented = lines.filter((l) => /^( {2})* \S/.test(l) && !/^\s*\*/.test(l)).length;
      const doubleQuoted = lines.filter((l) => /^\s*(import .* from |.*= )"[^"'`]*";?\s*$/.test(l)).length;

      if (tabIndented + oddIndented > 0) {
        issueCount++;
        findings.push({
          category: 'standards',
          severity: 'info',
          message: `Use 2-space indentation (${tabIndented + oddIndented} line(s))`,
          file: artifact.path
        });
      }

      if (doubleQuoted > 0) {
        issueCount++;
        findings.push({
          category: 'standards',
          severity: 'info',
          message: `Use single quotes for strings (${doubleQuoted} line(s))`,
          file: artifact.path
        });
      }
    }

    score -= issueCount * 5;

    if (issueCount > 0) {
      recommendations.push('Run npm run lint:fix to auto-fix style issues');
    }

    return Math.max(0, score);
  }

  getStatus() {
    return {
      name: this.name,
      status: this.status,
      currentReview: this.currentReview ? {
        reviewId: this.currentReview.reviewId,
        score: this.currentReview.score,
        verdict: this.currentReview.verdict,
        findingsCount: this.currentReview.findings.length,
        createdAt: this.currentReview.createdAt
      } : null
    };
  }

  reset() {
    this.status = 'idle';
    this.currentReview = null;
    console.log('[REVIEWER] Reset to idle state');
  }
}

const reviewerAgent = new ReviewerAgent();
export default reviewerAgent;
export { ReviewerAgent };

// Self-test
if (isSelfTest(import.meta.url)) {
  console.log('Testing ReviewerAgent...\n');

  try {
    // Test 1: Create instance
    console.log('[TEST] Test 1: Create instance...');
    const agent = new ReviewerAgent();
    if (agent.name !== 'Reviewer') throw new Error('Name should be Reviewer');
    if (agent.status !== 'idle') throw new Error('Initial status should be idle');
    console.log('[TEST] Create instance: PASSED');

    // Test 2: Review with all passing
    console.log('\n[TEST] Test 2: Review with all passing...');
    let reviewStartEmitted = false;
    let reviewCompleteEmitted = false;

    agent.on('review_start', () => { reviewStartEmitted = true; });
    agent.on('review_complete', () => { reviewCompleteEmitted = true; });

    const mockTestResults = {
      testId: 'test-123',
      passed: [{ file: 'test1.js' }, { file: 'test2.js' }],
      failed: [],
      lintErrors: []
    };

    const mockArtifacts = [
      { type: 'file', path: 'src/test1.js' },
      { type: 'file', path: 'src/test2.js' }
    ];

    const review = await agent.review(mockTestResults, mockArtifacts);

    if (!review.reviewId) throw new Error('Review should have reviewId');
    if (typeof review.score !== 'number') throw new Error('Review should have numeric score');
    if (!Array.isArray(review.findings)) throw new Error('Review should have findings array');
    if (!Array.isArray(review.recommendations)) throw new Error('Review should have recommendations array');
    if (!review.verdict) throw new Error('Review should have verdict');
    if (!['approved', 'needs-changes', 'rejected'].includes(review.verdict)) {
      throw new Error(`Invalid verdict: ${review.verdict}`);
    }
    if (!reviewStartEmitted) throw new Error('review_start event should be emitted');
    if (!reviewCompleteEmitted) throw new Error('review_complete event should be emitted');
    if (agent.status !== 'complete') throw new Error('Status should be complete');
    console.log('[TEST] Review with all passing: PASSED');

    // Test 3: Review with failures
    console.log('\n[TEST] Test 3: Review with failures...');
    const failedTestResults = {
      testId: 'test-456',
      passed: [],
      failed: [{ file: 'test1.js', error: 'Test failed' }],
      lintErrors: [{ file: 'test2.js', errorCount: 3 }]
    };

    const failedReview = await agent.review(failedTestResults, mockArtifacts);

    if (failedReview.score >= 100) throw new Error('Score should be reduced for failures');
    if (failedReview.findings.length === 0) throw new Error('Should have findings for failures');

    // Should find test failures
    const hasTestFinding = failedReview.findings.some(f => f.category === 'tests');
    if (!hasTestFinding) throw new Error('Should have test failure finding');

    // Should find lint errors
    const hasLintFinding = failedReview.findings.some(f => f.category === 'lint');
    if (!hasLintFinding) throw new Error('Should have lint error finding');

    console.log('[TEST] Review with failures: PASSED');

    // Test 4: Verdict logic
    console.log('\n[TEST] Test 4: Verdict logic...');

    // High score = approved
    if (review.score >= 80 && review.verdict !== 'approved' && review.verdict !== 'needs-changes') {
      throw new Error(`High score (${review.score}) should result in approved or needs-changes`);
    }

    // Low score with critical = rejected or needs-changes
    if (failedReview.findings.some(f => f.severity === 'critical')) {
      if (failedReview.verdict === 'approved') {
        throw new Error('Critical findings should not result in approved');
      }
    }

    console.log('[TEST] Verdict logic: PASSED');

    // Test 5: Strict mode
    console.log('\n[TEST] Test 5: Strict mode...');
    const strictReview = await agent.review(mockTestResults, mockArtifacts, { strict: true });

    // In strict mode, even good scores might need changes
    // We can't guarantee verdict since score is randomized, but we can verify it runs
    if (!strictReview.reviewId) throw new Error('Strict review should complete');
    console.log('[TEST] Strict mode: PASSED');

    // Test 6: Finding structure
    console.log('\n[TEST] Test 6: Finding structure...');
    if (failedReview.findings.length > 0) {
      const firstFinding = failedReview.findings[0];
      if (!firstFinding.category) throw new Error('Finding should have category');
      if (!firstFinding.severity) throw new Error('Finding should have severity');
      if (!firstFinding.message) throw new Error('Finding should have message');
    }
    console.log('[TEST] Finding structure: PASSED');

    // Test 7: getStatus
    console.log('\n[TEST] Test 7: getStatus...');
    const status = agent.getStatus();
    if (status.name !== 'Reviewer') throw new Error('Status should include name');
    if (status.status !== 'complete') throw new Error('Status should be complete');
    if (!status.currentReview) throw new Error('Status should include currentReview');
    if (status.currentReview.reviewId !== strictReview.reviewId) throw new Error('Status reviewId mismatch');
    console.log('[TEST] getStatus: PASSED');

    // Test 8: Reset
    console.log('\n[TEST] Test 8: Reset...');
    agent.reset();
    if (agent.status !== 'idle') throw new Error('Status should be idle after reset');
    if (agent.currentReview !== null) throw new Error('currentReview should be null after reset');
    console.log('[TEST] Reset: PASSED');

    // Test 9: Error handling
    console.log('\n[TEST] Test 9: Error handling...');
    let errorEmitted = false;
    agent.on('review_error', () => { errorEmitted = true; });

    // Force an error
    const originalCheck = agent._checkTestResults;
    agent._checkTestResults = () => { throw new Error('Test error'); };

    try {
      await agent.review(mockTestResults, mockArtifacts);
      throw new Error('Should have thrown error');
    } catch (err) {
      if (err.message !== 'Test error') throw err;
      if (!errorEmitted) throw new Error('review_error event should be emitted');
      if (agent.status !== 'error') throw new Error('Status should be error');
    }

    // Restore
    agent._checkTestResults = originalCheck;
    console.log('[TEST] Error handling: PASSED');

    // Test 10: Deterministic, artifact-based review
    console.log('\n[TEST] Test 10: Deterministic review of real artifacts...');
    agent.reset?.();
    const realArtifacts = [
      { type: 'file', path: fileURLToPath(import.meta.url) },
      { type: 'file', path: '/nonexistent/brightforge/artifact.js' }
    ];
    const okTests = { testId: 't-det', passed: [], failed: [], lintErrors: [] };
    const r1 = await agent.review(okTests, realArtifacts);
    const r2 = await agent.review(okTests, realArtifacts);
    if (r1.score !== r2.score || r1.findings.length !== r2.findings.length) throw new Error(`Review is not deterministic: ${r1.score} vs ${r2.score}`);
    if (!r1.findings.some(f => f.severity === 'critical' && /not found/i.test(f.message))) throw new Error('Missing artifact must be a critical finding');
    if (r1.findings.some(f => f.file === realArtifacts[0].path && f.category === 'structure')) throw new Error('This file has header, self-test and exports; no structure findings expected');
    if (r1.verdict === 'approved') throw new Error('A missing artifact must not be approved');
    console.log(`[TEST] Deterministic review: PASSED (score ${r1.score}, verdict ${r1.verdict})`);

    console.log('\n[TEST] All 10 tests PASSED!');
    console.log('ReviewerAgent test PASSED');

  } catch (error) {
    console.error('\n[TEST] Test FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}
